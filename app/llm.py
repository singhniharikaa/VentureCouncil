"""
Provider-agnostic LLM layer.

The five agents all call `call_llm_json(prompt)` and neither know nor care
which provider answers. Switch providers with one line in .env:

    LLM_PROVIDER=gemini     # Google Gemini            (default)
    LLM_PROVIDER=groq       # Groq Cloud - open models, free tier
    LLM_PROVIDER=grok       # xAI Grok - NOT the same as groq

Why this exists: Gemini's free tier allows 5 requests/minute and 20/day per
model. The graph fires four agents concurrently, so a single evaluation
saturates the per-minute ceiling and a second one in the same minute fails.
Grok's Tier 0 is 150 requests/SECOND, which removes that ceiling entirely.
Keeping both behind one interface means the choice stays reversible and the
Gemini results already recorded for the write-up stay reproducible.

Two protections apply to BOTH providers:

  * a concurrency cap (LLM_MAX_CONCURRENCY) so the parallel fan-out can never
    exceed the provider's per-second/per-minute limit, and
  * retry with exponential backoff on rate-limit errors, honouring the
    server's own retry hint when it sends one.

Without these, one rate-limited agent raises and kills the entire graph run
mid-evaluation - which is exactly what happened on 2026-08-22.
"""
import json
import os
import random
import threading
import time

DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"
DEFAULT_GROK_MODEL = "grok-4.3"  # cheapest of the general text models
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"  # most capable text model on Groq
GROK_BASE_URL = "https://api.x.ai/v1"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

MAX_RATE_LIMIT_RETRIES = 4
MAX_BACKOFF_SECONDS = 60.0

_clients = {}
_clients_lock = threading.Lock()
_semaphore = None
_semaphore_lock = threading.Lock()


DEFAULT_PROVIDER = "groq"  # pinned 2026-08-22: free tier, 1000 req/day, JSON mode


def provider() -> str:
    return os.environ.get("LLM_PROVIDER", DEFAULT_PROVIDER).strip().lower()


def model_name() -> str:
    p = provider()
    if p == "grok":
        return os.environ.get("GROK_MODEL", DEFAULT_GROK_MODEL)
    if p == "groq":
        return os.environ.get("GROQ_MODEL", DEFAULT_GROQ_MODEL)
    return os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def _max_concurrency() -> int:
    """
    Cap on simultaneous in-flight LLM calls.

    Default 4 matches the graph's widest fan-out (audience_fit, engagement,
    pricing, risk). On Gemini free tier drop this to 2 and you will stay
    under 5 RPM; on Grok you can raise it well past 4.
    """
    try:
        return max(1, int(os.environ.get("LLM_MAX_CONCURRENCY", "4")))
    except ValueError:
        return 4


def _get_semaphore():
    global _semaphore
    with _semaphore_lock:
        if _semaphore is None:
            _semaphore = threading.BoundedSemaphore(_max_concurrency())
        return _semaphore


def _is_rate_limit(exc) -> bool:
    """True for a 429 / quota-exhausted error from either provider."""
    if type(exc).__name__ in ("ResourceExhausted", "RateLimitError", "TooManyRequests"):
        return True
    if getattr(exc, "status_code", None) == 429:
        return True
    text = str(exc).lower()
    return "429" in text or "rate limit" in text or "quota" in text


def _backoff_seconds(exc, attempt: int) -> float:
    """Honour the server's retry hint if it sent one, else exponential backoff."""
    hint = getattr(exc, "retry_delay", None)
    seconds = getattr(hint, "seconds", None)
    if seconds:
        return float(seconds) + random.uniform(0.0, 1.0)
    return min(MAX_BACKOFF_SECONDS, 2.0 ** attempt) + random.uniform(0.0, 1.0)


# --------------------------------------------------------------------------
# providers
# --------------------------------------------------------------------------

def _gemini_client():
    with _clients_lock:
        if "gemini" not in _clients:
            import google.generativeai as genai

            key = os.environ.get("GEMINI_API_KEY")
            if not key:
                raise RuntimeError(
                    "LLM_PROVIDER=gemini but GEMINI_API_KEY is not set. Get a key "
                    "from https://aistudio.google.com/apikey and add it to .env as:"
                    "  GEMINI_API_KEY=your-key-here"
                )
            genai.configure(api_key=key)
            _clients["gemini"] = genai.GenerativeModel(model_name())
        return _clients["gemini"]


def _openai_compatible_client(name, base_url, env_names, console_url):
    """Groq and xAI both expose an OpenAI-compatible API - same client, different host."""
    with _clients_lock:
        if name not in _clients:
            from openai import OpenAI

            key = next((os.environ[e] for e in env_names if os.environ.get(e)), None)
            if not key:
                raise RuntimeError(
                    f"LLM_PROVIDER={name} but {env_names[0]} is not set. Create a "
                    f"key at {console_url} and add it to .env as: "
                    f"{env_names[0]}=your-key-here"
                )
            _clients[name] = OpenAI(api_key=key, base_url=base_url)
        return _clients[name]


def _groq_client():
    return _openai_compatible_client(
        "groq", GROQ_BASE_URL, ["GROQ_API_KEY"], "https://console.groq.com/keys")


def _grok_client():
    with _clients_lock:
        if "grok" not in _clients:
            from openai import OpenAI  # xAI exposes an OpenAI-compatible API

            key = os.environ.get("GROK_API_KEY") or os.environ.get("XAI_API_KEY")
            if not key:
                raise RuntimeError(
                    "LLM_PROVIDER=grok but GROK_API_KEY is not set. Create a key "
                    "at https://console.x.ai and add it to .env as:"
                    "  GROK_API_KEY=your-key-here"
                )
            _clients["grok"] = OpenAI(api_key=key, base_url=GROK_BASE_URL)
        return _clients["grok"]


def _generate(prompt: str) -> str:
    """One raw completion from whichever provider is selected."""
    p = provider()
    if p in ("grok", "groq"):
        client = _grok_client() if p == "grok" else _groq_client()
        kwargs = {
            "model": model_name(),
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
        }
        # Groq supports OpenAI-style JSON mode, which removes the whole class
        # of "model wrapped its JSON in prose" failures.
        if p == "groq":
            kwargs["response_format"] = {"type": "json_object"}
        response = client.chat.completions.create(**kwargs)
        return response.choices[0].message.content
    return _gemini_client().generate_content(prompt).text


def _extract_json(text: str) -> str:
    """Strip markdown fences some models wrap around JSON."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else text
        text = text.removeprefix("json").strip()
        if text.endswith("```"):
            text = text[: -3]
    return text.strip()


def reset_clients():
    """Drop cached clients - call after changing LLM_PROVIDER or the model."""
    global _semaphore
    with _clients_lock:
        _clients.clear()
    with _semaphore_lock:
        _semaphore = None


# --------------------------------------------------------------------------
# public entry point
# --------------------------------------------------------------------------

def call_llm_json(prompt: str) -> dict:
    """
    Send a prompt, parse the JSON response, return it as a dict.

    Retries once if the model returns something that is not valid JSON, and
    up to MAX_RATE_LIMIT_RETRIES times with backoff on rate-limit errors.
    """
    attempt_prompt = prompt
    parse_retries_left = 1

    for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
        try:
            with _get_semaphore():
                raw = _generate(attempt_prompt)
        except Exception as exc:
            if _is_rate_limit(exc) and attempt < MAX_RATE_LIMIT_RETRIES:
                delay = _backoff_seconds(exc, attempt)
                print(
                    f"  [llm] rate limited by {provider()} "
                    f"({model_name()}), retrying in {delay:.1f}s "
                    f"[{attempt + 1}/{MAX_RATE_LIMIT_RETRIES}]"
                )
                time.sleep(delay)
                continue
            raise

        try:
            return json.loads(_extract_json(raw))
        except json.JSONDecodeError:
            if parse_retries_left:
                parse_retries_left -= 1
                attempt_prompt = prompt + (
                    "\n\nYour last response was not valid JSON. Respond with "
                    "ONLY the JSON object, nothing else."
                )
                continue
            raise

    raise RuntimeError(
        f"{provider()} ({model_name()}) stayed rate limited after "
        f"{MAX_RATE_LIMIT_RETRIES} retries. Wait for the quota window to reset, "
        f"lower LLM_MAX_CONCURRENCY, or switch provider in .env."
    )
