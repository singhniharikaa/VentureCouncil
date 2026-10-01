"""
The Supervisor is the only component that decides anything.

It is also the only part of the pipeline that is NOT an LLM: fixed weights, two
fixed thresholds, and one hard rule. That makes it both the most important
thing to protect and the easiest thing to test — which is why these tests exist
first.
"""
import pytest

from app.supervisor import WEIGHTS, run
from tests.conftest import agent


def build(audience=50, engagement=50, pricing=50, negotiation=50, risk_component="low risk"):
    return {
        "audience_fit_result": agent(audience),
        "engagement_result": agent(engagement),
        "pricing_result": agent(pricing),
        "negotiation_result": agent(negotiation),
        "risk_result": agent(80, risk_component),
    }


def score_of(state):
    return run(state)["verdict"]["weighted_score"]


def verdict_of(state):
    return run(state)["verdict"]["verdict"]


# --------------------------------------------------------------- weights

def test_weights_sum_to_one():
    """A drifting weight set would silently rescale every verdict."""
    assert sum(WEIGHTS.values()) == pytest.approx(1.0)


def test_risk_is_not_weighted():
    """Risk must act as a veto, never as a contributing score."""
    assert "risk_result" not in WEIGHTS


def test_weighted_score_is_the_dot_product():
    state = build(audience=100, engagement=0, pricing=100, negotiation=0)
    expected = 100 * WEIGHTS["audience_fit_result"] + 100 * WEIGHTS["pricing_result"]
    assert score_of(state) == pytest.approx(expected, abs=0.05)


def test_all_fifty_scores_fifty():
    assert score_of(build()) == pytest.approx(50.0)


def test_missing_agent_result_defaults_to_fifty():
    """A crashed agent must not be read as a zero, which would force a Reject."""
    state = build(audience=100, engagement=100, pricing=100, negotiation=100)
    del state["pricing_result"]
    # pricing (0.35) falls back to 50, the rest stay at 100
    assert score_of(state) == pytest.approx(100 * 0.65 + 50 * 0.35, abs=0.05)


# ------------------------------------------------------------ thresholds

@pytest.mark.parametrize(
    "uniform, expected",
    [
        (100, "Accept"),
        (70, "Accept"),      # boundary: >= 70
        (69, "Negotiate"),
        (45, "Negotiate"),   # boundary: >= 45
        (44, "Reject"),
        (0, "Reject"),
    ],
)
def test_threshold_bands(uniform, expected):
    state = build(uniform, uniform, uniform, uniform)
    assert verdict_of(state) == expected


# -------------------------------------------------------- the hard rule

def test_high_risk_cannot_produce_accept():
    """The rule that makes this 'rule-constrained' rather than 'the model said so'."""
    state = build(100, 100, 100, 100, risk_component="high risk")
    out = run(state)["verdict"]
    assert out["weighted_score"] >= 70          # would have been Accept
    assert out["verdict"] == "Negotiate"        # floored
    assert out["hard_rule_applied"] is True


def test_high_risk_does_not_worsen_a_negotiate():
    """The floor only pulls Accept down; it must not push Negotiate to Reject."""
    state = build(50, 50, 50, 50, risk_component="high risk")
    out = run(state)["verdict"]
    assert out["verdict"] == "Negotiate"
    assert out["hard_rule_applied"] is False


def test_high_risk_leaves_a_reject_alone():
    state = build(0, 0, 0, 0, risk_component="high risk")
    out = run(state)["verdict"]
    assert out["verdict"] == "Reject"
    assert out["hard_rule_applied"] is False


@pytest.mark.parametrize("component", ["low risk", "medium risk"])
def test_non_high_risk_never_fires_the_rule(component):
    state = build(100, 100, 100, 100, risk_component=component)
    out = run(state)["verdict"]
    assert out["verdict"] == "Accept"
    assert out["hard_rule_applied"] is False


def test_missing_risk_result_is_treated_as_medium_not_as_safe():
    """A missing Risk agent must not be read as 'low risk' and waved through."""
    state = build(100, 100, 100, 100)
    del state["risk_result"]
    out = run(state)["verdict"]
    assert out["hard_rule_applied"] is False     # medium does not floor
    assert out["verdict"] == "Accept"


# ------------------------------------------------------------- the shape

def test_breakdown_carries_every_agent():
    """The audit trail must show all five, including the unweighted Risk agent."""
    out = run(build())["verdict"]
    assert set(out["agent_breakdown"]) == {
        "audience_fit", "engagement", "pricing", "risk", "negotiation",
    }


def test_verdict_is_one_of_three():
    for s in range(0, 101, 5):
        assert verdict_of(build(s, s, s, s)) in {"Accept", "Negotiate", "Reject"}
