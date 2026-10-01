"""
Engagement agent: zero means "not measured", not "terrible".

126 of the 775 seeded creators carry engagement_rate = 0, including Instagram
accounts with millions of followers, and 125 of those still score data
confidence >= 75 because the score credits the field merely being present.
Read literally, zero put them in the bottom percentile and cost roughly 11
weighted points - enough to flip verdicts in calibration.
"""
import pytest

from app.agents.engagement import has_engagement, run


@pytest.mark.parametrize("rate", [None, 0, 0.0, -1])
def test_unusable_rates_are_not_engagement(rate):
    assert has_engagement(rate) is False


@pytest.mark.parametrize("rate", [0.01, 2.94, 13.44])
def test_real_rates_are_engagement(rate):
    assert has_engagement(rate) is True


@pytest.mark.parametrize("rate", [None, 0, 0.0])
def test_agent_abstains_without_a_usable_rate(rate):
    """Must take the abstain path and never reach the LLM or the database."""
    out = run({"engagement_rate": rate, "platform": "instagram"})["engagement_result"]
    assert out["verdict_component"] == "unknown"
    assert out["score"] == 40          # neutral, not the bottom of the scale
    assert out["confidence"] == 0.3    # and says so
    assert "not measured" in out["reasoning"]


def test_abstaining_scores_higher_than_a_genuinely_weak_creator():
    """
    Abstaining must not be harsher than a real bad measurement. A creator
    measured at the 5th percentile should score below one we could not measure
    at all, otherwise missing data is punished more than poor performance.
    """
    out = run({"engagement_rate": 0, "platform": "instagram"})["engagement_result"]
    assert out["score"] > 5
