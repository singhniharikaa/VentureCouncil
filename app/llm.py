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
            # Temperature 0: these agents classify and score, they do not
            # write prose that benefits from variety. At 0.2 the same deal
            # scored 66.0 and then 40.3 on consecutive identical runs (pricing
            # 70->30, negotiation 100->20), which makes verdicts irreproducible
            # and makes threshold calibration impossible. 0 reduces that sharply
            # but does NOT eliminate it - provider-side batching still varies.
            "temperature": 0,
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

class DailyLimitReached(RuntimeError):
    """
    The provider's per-DAY allowance is spent.

    Retrying cannot help for minutes, so this fails at once with a message a
    person can act on, instead of burning ~30 s of backoff and then surfacing a
    raw provider error. Found on demo day: gpt-oss-120b's 200,000 tokens/day were
    used up, and every evaluation returned an opaque 502.
    """


MAX_JSON_RETRIES = 2   # provider-side "failed to generate JSON" 400s


def _is_daily_limit(exc) -> bool:
    text = str(exc).lower()
    return "tokens per day" in text or "requests per day" in text or "(tpd)" in text


def _daily_limit_message(exc) -> str:
    """e.g. 'Please try again in 1m44.5s' -> 'about 1m44.5s'. Plain string ops, no regex."""
    text = str(exc)
    when = ""
    marker = "try again in "
    i = text.lower().find(marker)
    if i >= 0:
        when = text[i + len(marker):].split()[0].rstrip(".,'\"")
    return (
        f"The free AI allowance for {model_name()} is used up for today"
        + (f" (the provider says to retry in about {when})" if when else "")
        + ". Wait, switch GROQ_MODEL in .env to another model (for example openai/gpt-oss-20b), "
        "or use a key from a different Groq account."
    )


def _is_json_generation_failure(exc) -> bool:
    """Groq's JSON mode sometimes answers 400 'Failed to generate JSON'. It is transient."""
    return getattr(exc, "status_code", None) == 400 and "json" in str(exc).lower()


def call_llm_json(prompt: str) -> dict:
    """
    Send a prompt, parse the JSON response, return it as a dict.

    Three kinds of trouble get three different treatments:
      * rate limit (per minute)  -> back off and retry, up to MAX_RATE_LIMIT_RETRIES
      * daily limit              -> fail at once with DailyLimitReached; retrying is futile
      * the model's JSON is bad  -> retry (the provider's own "failed to generate
        JSON" 400, or text that does not parse), a couple of times
    Anything else is a real error and is raised unchanged.
    """
    attempt_prompt = prompt
    rate_retries = 0
    json_retries = 0
    parse_retries = 0

    while True:
        try:
            with _get_semaphore():
                raw = _generate(attempt_prompt)
        except Exception as exc:
            if _is_daily_limit(exc):
                raise DailyLimitReached(_daily_limit_message(exc)) from exc

            if _is_rate_limit(exc):
                if rate_retries >= MAX_RATE_LIMIT_RETRIES:
                    raise RuntimeError(
                        f"{provider()} ({model_name()}) stayed rate limited after "
                        f"{MAX_RATE_LIMIT_RETRIES} retries. Wait for the quota window to "
                        f"reset, lower LLM_MAX_CONCURRENCY, or switch provider in .env."
                    ) from exc
                delay = _backoff_seconds(exc, rate_retries)
                rate_retries += 1
                print(
                    f"  [llm] rate limited by {provider()} ({model_name()}), "
                    f"retrying in {delay:.1f}s [{rate_retries}/{MAX_RATE_LIMIT_RETRIES}]"
                )
                time.sleep(delay)
                continue

            if _is_json_generation_failure(exc) and json_retries < MAX_JSON_RETRIES:
                json_retries += 1
                print(f"  [llm] {provider()} failed to generate JSON, retrying "
                      f"[{json_retries}/{MAX_JSON_RETRIES}]")
                continue

            raise

        try:
            return json.loads(_extract_json(raw))
        except json.JSONDecodeError:
            if parse_retries < 1:
                parse_retries += 1
                attempt_prompt = prompt + (
                    "\n\nYour last response was not valid JSON. Respond with "
                    "ONLY the JSON object, nothing else."
                )
                continue
            raise
