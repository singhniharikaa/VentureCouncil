"""
The rate-limit and parsing layer.

These are the paths that only run when something has already gone wrong, which
is exactly why they are worth testing: a bug here shows up as a whole
evaluation dying mid-run, in front of whoever is watching the demo.
"""
import pytest

from app import llm


# ------------------------------------------------- rate-limit detection

class _RateLimitError(Exception):
    """Mimics openai.RateLimitError (Groq / xAI) by class name."""


class _ResourceExhausted(Exception):
    """Mimics google.api_core.exceptions.ResourceExhausted (Gemini)."""


class _WithStatus(Exception):
    status_code = 429


@pytest.mark.parametrize(
    "exc",
    [
        _RateLimitError("429 Too Many Requests"),
        _ResourceExhausted("429 quota exceeded for generate_content_free_tier"),
        _WithStatus("something"),
        Exception("Rate limit reached for model gpt-oss-120b"),
        Exception("You exceeded your current quota"),
    ],
    ids=["groq-class", "gemini-class", "status-429", "message-rate-limit", "message-quota"],
)
def test_rate_limits_are_recognised_across_provider_shapes(exc):
    assert llm._is_rate_limit(exc) is True


@pytest.mark.parametrize(
    "exc",
    [Exception("connection reset by peer"),
     Exception("invalid api key"),
     Exception("model not found"),
     ValueError("bad json")],
)
def test_ordinary_errors_are_not_mistaken_for_rate_limits(exc):
    """Retrying a bad key four times just makes the failure slower."""
    assert llm._is_rate_limit(exc) is False


# ------------------------------------------------------------- backoff

def test_backoff_grows_and_is_capped():
    delays = [llm._backoff_seconds(Exception("x"), i) for i in range(12)]
    assert delays[0] < delays[3] < delays[6]
    assert max(delays) <= llm.MAX_BACKOFF_SECONDS + 1.0


def test_backoff_honours_the_server_retry_hint():
    """Google sends retry_delay; ignoring it means retrying too early."""

    class Hint:
        seconds = 31

    class WithHint(Exception):
        retry_delay = Hint()

    delay = llm._backoff_seconds(WithHint(), 0)
    assert 31.0 <= delay <= 32.0


def test_backoff_is_jittered():
    """Identical delays would make four concurrent agents retry in lockstep."""
    delays = {llm._backoff_seconds(Exception("x"), 3) for _ in range(20)}
    assert len(delays) > 1


# --------------------------------------------------------- json parsing

@pytest.mark.parametrize(
    "raw",
    ['{"a":1}',
     '```json\n{"a":1}\n```',
     '```\n{"a":1}\n```',
     '   {"a":1}   ',
     '```json\n{"a":1}```'],
)
def test_markdown_fences_are_stripped(raw):
    assert llm._extract_json(raw) == '{"a":1}'


def test_extract_json_survives_empty_input():
    assert llm._extract_json(None) == ""
    assert llm._extract_json("") == ""


# ------------------------------------------------- provider selection

def test_groq_is_the_pinned_default(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert llm.provider() == "groq"
    assert llm.model_name() == llm.DEFAULT_GROQ_MODEL


@pytest.mark.parametrize(
    "provider_name, default_attr",
    [("groq", "DEFAULT_GROQ_MODEL"),
     ("grok", "DEFAULT_GROK_MODEL"),
     ("gemini", "DEFAULT_GEMINI_MODEL")],
)
def test_each_provider_has_its_own_default_model(provider_name, default_attr, monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", provider_name)
    for var in ("GROQ_MODEL", "GROK_MODEL", "GEMINI_MODEL"):
        monkeypatch.delenv(var, raising=False)
    assert llm.model_name() == getattr(llm, default_attr)


def test_provider_is_case_and_whitespace_tolerant(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "  GROQ  ")
    assert llm.provider() == "groq"


def test_model_can_be_overridden_per_provider(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_MODEL", "openai/gpt-oss-20b")
    assert llm.model_name() == "openai/gpt-oss-20b"


# ------------------------------------------------------ concurrency cap

def test_concurrency_defaults_to_the_graph_fan_out(monkeypatch):
    """Four upstream agents run at once; the cap must not be lower by accident."""
    monkeypatch.delenv("LLM_MAX_CONCURRENCY", raising=False)
    assert llm._max_concurrency() == 4


@pytest.mark.parametrize("value, expected", [("1", 1), ("8", 8), ("0", 1), ("-3", 1)])
def test_concurrency_is_clamped_to_at_least_one(value, expected, monkeypatch):
    monkeypatch.setenv("LLM_MAX_CONCURRENCY", value)
    assert llm._max_concurrency() == expected


def test_garbage_concurrency_falls_back_instead_of_crashing(monkeypatch):
    monkeypatch.setenv("LLM_MAX_CONCURRENCY", "four")
    assert llm._max_concurrency() == 4


# ----------------------------------------------------- missing API key

def test_missing_key_raises_an_actionable_error(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    llm.reset_clients()
    with pytest.raises(RuntimeError, match="GROQ_API_KEY"):
        llm._groq_client()
    llm.reset_clients()
