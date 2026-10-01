"""
The engine->frontend contract.

`api/adapter.py` is where the two halves of the project meet, and it is the
easiest place for a quiet lie to creep in: a field the UI renders confidently
that the engine never actually produced. These tests pin down that everything
the adapter adds is derived from real data, and that "we don't know" survives
the translation instead of becoming a number.
"""
import pytest

from api.adapter import (
    ACCEPT_AT,
    NEGOTIATE_AT,
    agent_to_frontend,
    comp_to_frontend,
    creator_to_frontend,
    verdict_to_frontend,
)
from tests.conftest import agent

TRACE = [{"t": "+100ms", "text": "reported."}]


def to_fe(agent_id, result, state, **kw):
    kw.setdefault("latency_ms", 1234)
    kw.setdefault("model", "groq/openai/gpt-oss-120b")
    kw.setdefault("trace", TRACE)
    return agent_to_frontend(agent_id, result, state, **kw)


# ------------------------------------------------- recommendation bands

@pytest.mark.parametrize(
    "score, expected",
    [(100, "accept"), (ACCEPT_AT, "accept"), (ACCEPT_AT - 1, "negotiate"),
     (NEGOTIATE_AT, "negotiate"), (NEGOTIATE_AT - 1, "reject"), (0, "reject")],
)
def test_agent_recommendation_follows_the_supervisor_bands(score, expected, state):
    """Per-agent chips must not contradict the verdict they roll up into."""
    out = to_fe("pricing", agent(score, "fair"), state)
    assert out["recommendation"] == expected


@pytest.mark.parametrize(
    "component, recommendation, severity",
    [("low risk", "accept", "low"),
     ("medium risk", "negotiate", "medium"),
     ("high risk", "reject", "high")],
)
def test_risk_maps_by_component_not_by_score(component, recommendation, severity, state):
    """Risk scores run backwards (100 = safe), so banding on score would invert it."""
    out = to_fe("risk", agent(95, component), state)
    assert out["recommendation"] == recommendation
    assert out["severity"] == severity


# ------------------------------------------------------ insufficient data

@pytest.mark.parametrize("rate", [None, 0, 0.0])
def test_engagement_with_no_usable_rate_is_marked_insufficient(rate, state):
    """
    This roster stores 0 for "not measured" - 126 of 775 creators, including
    accounts with millions of followers. Read as a real score it put them in
    the bottom percentile and flipped correct verdicts, so 0 must behave
    exactly like NULL.
    """
    state["engagement_rate"] = rate
    out = to_fe("engagement", agent(40, "unknown"), state)
    assert out["insufficientData"] is True
    assert any("No usable engagement rate" in f for f in out["flags"])


def test_complete_engagement_is_not_marked_insufficient(state):
    out = to_fe("engagement", agent(37, "average engagement"), state)
    assert out["insufficientData"] is False


def test_missing_niche_is_flagged_on_audience_fit(state):
    state["niche"] = None
    out = to_fe("audience_fit", agent(48, "weak fit"), state)
    assert any("niche missing" in f for f in out["flags"])


# --------------------------------------------------------- risk flags

def test_low_confidence_and_estimated_price_are_flagged(state):
    state["data_confidence_score"] = 25
    state["price_estimated"] = True
    out = to_fe("risk", agent(30, "high risk"), state,
                extra={"price_per_follower": 0.0097})
    joined = " ".join(out["flags"])
    assert "Low data confidence (25/100)" in joined
    assert "KNN-estimated" in joined
    assert "outside the Rs.0.05-0.50 norm" in joined


def test_normal_price_per_follower_is_not_flagged(state):
    out = to_fe("risk", agent(95, "low risk"), state,
                extra={"price_per_follower": 0.1159})
    assert not any("per follower" in f for f in out["flags"])


def test_typed_fields_come_from_the_deal_not_from_the_model(state):
    out = to_fe("pricing", agent(70, "fair"), state, extra={"comps_used": 5})
    assert out["typed"]["proposed_amount_inr"] == 35_000
    assert out["typed"]["creator_price_inr"] == 30_000
    assert out["typed"]["comps_used"] == 5


def test_latency_and_model_are_passed_through_not_invented(state):
    out = to_fe("pricing", agent(70, "fair"), state, latency_ms=4835,
                model="groq/openai/gpt-oss-120b")
    assert out["latencyMs"] == 4835
    assert out["model"] == "groq/openai/gpt-oss-120b"


# ------------------------------------------------------------- verdict

def test_hard_rule_is_reported_as_an_override():
    summary = {"verdict": "Negotiate", "weighted_score": 76.0, "hard_rule_applied": True}
    out = verdict_to_frontend(summary, [])
    assert out["decision"] == "negotiate"
    assert out["override"]["fired"] is True
    assert out["override"]["rule"] == "HIGH_RISK_NO_ACCEPT"
    assert out["override"]["floor"] == "negotiate"


def test_no_override_when_no_rule_fired():
    summary = {"verdict": "Accept", "weighted_score": 79.9, "hard_rule_applied": False}
    out = verdict_to_frontend(summary, [])
    assert out["override"]["fired"] is False


def test_council_split_needs_both_extremes():
    summary = {"verdict": "Negotiate", "weighted_score": 60.0, "hard_rule_applied": False}
    both = [{"recommendation": "accept"}, {"recommendation": "reject"}]
    mild = [{"recommendation": "accept"}, {"recommendation": "negotiate"}]
    assert verdict_to_frontend(summary, both)["councilSplit"] is True
    assert verdict_to_frontend(summary, mild)["councilSplit"] is False


# ------------------------------------------------------------- creator

def test_creator_id_is_prefixed_so_the_api_can_resolve_it():
    """/api/evaluate parses 'cr_<pk>' back to the Supabase primary key."""
    out = creator_to_frontend({"creator_id": 43, "name": "Bulky", "platform": "youtube",
                               "followers_count": 302_000, "price_inr": 30_000})
    assert out["id"] == "cr_43"
    assert out["channelId"] == "43"


def test_instagram_followers_map_onto_the_shared_count_field():
    out = creator_to_frontend({"creator_id": 7, "name": "Nidhi", "platform": "instagram",
                               "followers_count": 2_112_662})
    assert out["platform"] == "instagram"
    assert out["subscriberCount"] == out["followersCount"] == 2_112_662


def test_missing_followers_do_not_crash_the_mapping():
    out = creator_to_frontend({"creator_id": 1, "name": "x", "platform": "instagram",
                               "followers_count": None})
    assert out["subscriberCount"] == 0


# ---------------------------------------------------------------- comps

@pytest.mark.parametrize(
    "followers, tier",
    [(5_000, "Nano"), (50_000, "Micro"), (300_000, "Mid"),
     (700_000, "Macro"), (2_000_000, "Mega")],
)
def test_comp_tier_bands(followers, tier):
    out = comp_to_frontend({"followers_count": followers, "deal_amount": 1,
                            "similarity": 0.8}, 0)
    assert out["tier"] == tier


def test_comp_distance_is_the_inverse_of_similarity():
    out = comp_to_frontend({"followers_count": 1, "deal_amount": 30_000,
                            "similarity": 0.829, "deliverables": "1 integration video"}, 0)
    assert out["distance"] == pytest.approx(0.171)
    assert out["dealType"] == "integration"


def test_dedicated_deliverable_is_classified_as_dedicated():
    out = comp_to_frontend({"followers_count": 1, "deal_amount": 1, "similarity": 0.5,
                            "deliverables": "1 dedicated video"}, 0)
    assert out["dealType"] == "dedicated"
