"""
How the LLM layer behaves when the provider has a bad moment.

Found on demo day, three different ways:
  * gpt-oss-120b's 200,000 tokens/DAY ran out, and every evaluation came back as
    an opaque 502 after ~30 s of pointless retrying;
  * Groq's JSON mode occasionally answers 400 "Failed to generate JSON", which
    was not retried, so one hiccup killed a whole evaluation (and one creator in
    a campaign);
  * both of those are different from the per-MINUTE limit, which the backoff
    already handled.

The errors below copy the real provider messages.
"""
import pytest

from app import llm
from app.llm import DailyLimitReached, call_llm_json

DAILY = (
    "Error code: 429 - {'error': {'message': 'Rate limit reached for model "
    "`openai/gpt-oss-120b` ... on tokens per day (TPD): Limit 200000, Used 199598, "
    "Requested 644. Please try again in 1m44.545s.'}}"
)
PER_MINUTE = "Error code: 429 - Rate limit reached ... on tokens per minute (TPM): Limit 8000"
JSON_FAIL = "Error code: 400 - {'error': {'message': 'Failed to generate JSON. Please adjust your prompt.'}}"


class ProviderError(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.status_code = status


@pytest.fixture
def script(monkeypatch):
    """Replace the provider call with a scripted sequence of replies / errors."""
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)      # never really wait
    monkeypatch.setattr(llm.random, "uniform", lambda a, b: 0)
    llm.reset_clients()

    def install(*steps):
        calls = {"n": 0}
        queue = list(steps)

        def fake(prompt):
            calls["n"] += 1
            step = queue.pop(0)
            if isinstance(step, Exception):
                raise step
            return step

        monkeypatch.setattr(llm, "_generate", fake)
        return calls

    return install


# ------------------------------------------------------------- daily limit

def test_a_spent_daily_allowance_fails_at_once_not_after_retries(script):
    calls = script(ProviderError(DAILY, 429))
    with pytest.raises(DailyLimitReached):
        call_llm_json("x")
    assert calls["n"] == 1          # no pointless backoff loop


def test_the_daily_limit_message_says_what_to_do(script):
    script(ProviderError(DAILY, 429))
    with pytest.raises(DailyLimitReached) as e:
        call_llm_json("x")
    msg = str(e.value)
    assert "1m44.545s" in msg                  # when to try again, from the provider
    assert "GROQ_MODEL" in msg                 # how to get unstuck
    assert "used up" in msg


def test_a_daily_limit_message_without_a_retry_hint_still_works(script):
    script(ProviderError("tokens per day (TPD): Limit 200000", 429))
    with pytest.raises(DailyLimitReached) as e:
        call_llm_json("x")
    assert "retry in about" not in str(e.value)


def test_the_daily_limit_is_a_runtime_error_so_existing_handlers_catch_it():
    assert issubclass(DailyLimitReached, RuntimeError)


# ------------------------------------------------------ per-minute limit

def test_a_per_minute_limit_is_still_retried(script):
    calls = script(ProviderError(PER_MINUTE, 429), ProviderError(PER_MINUTE, 429), '{"score": 5}')
    assert call_llm_json("x") == {"score": 5}
    assert calls["n"] == 3


def test_a_per_minute_limit_gives_up_after_the_retry_budget(script):
    calls = script(*[ProviderError(PER_MINUTE, 429)] * (llm.MAX_RATE_LIMIT_RETRIES + 1))
    with pytest.raises(RuntimeError, match="stayed rate limited"):
        call_llm_json("x")
    assert calls["n"] == llm.MAX_RATE_LIMIT_RETRIES + 1


# ------------------------------------------------- the provider's JSON 400

def test_a_failed_json_generation_is_retried(script):
    calls = script(ProviderError(JSON_FAIL, 400), '{"score": 70}')
    assert call_llm_json("x") == {"score": 70}
    assert calls["n"] == 2


def test_json_failures_are_retried_a_bounded_number_of_times(script):
    calls = script(*[ProviderError(JSON_FAIL, 400)] * (llm.MAX_JSON_RETRIES + 1))
    with pytest.raises(ProviderError):
        call_llm_json("x")
    assert calls["n"] == llm.MAX_JSON_RETRIES + 1


def test_an_unrelated_400_is_not_retried(script):
    """A bad request that is not about JSON is a real bug; retrying would hide it."""
    calls = script(ProviderError("Error code: 400 - model does not exist", 400))
    with pytest.raises(ProviderError):
        call_llm_json("x")
    assert calls["n"] == 1


def test_other_errors_are_raised_unchanged(script):
    calls = script(ProviderError("Error code: 401 - invalid api key", 401))
    with pytest.raises(ProviderError):
        call_llm_json("x")
    assert calls["n"] == 1


# ------------------------------------------------ malformed text still works

def test_text_that_is_not_json_is_retried_once_with_a_nudge(script, monkeypatch):
    seen = []
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    replies = ["definitely not json", '{"ok": true}']

    def fake(prompt):
        seen.append(prompt)
        return replies.pop(0)

    monkeypatch.setattr(llm, "_generate", fake)
    assert call_llm_json("original prompt") == {"ok": True}
    assert "not valid JSON" in seen[1] and seen[1].startswith("original prompt")


def test_text_that_never_becomes_json_eventually_raises(script):
    script("nope", "still nope")
    with pytest.raises(Exception):
        call_llm_json("x")


def test_markdown_fenced_json_is_accepted(script):
    script('```json\n{"score": 9}\n```')
    assert call_llm_json("x") == {"score": 9}
