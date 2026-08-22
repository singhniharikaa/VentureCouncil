"""
Supervisor — consolidates the 5 agent outputs into one final verdict.
Applies the hard rule first (high risk -> floor at "negotiate"), then a
weighted combination of the remaining scores.
"""
from app.state import DealState

WEIGHTS = {
    "audience_fit_result": 0.30,
    "engagement_result": 0.25,
    "pricing_result": 0.35,
    "negotiation_result": 0.10,
}


def run(state: DealState) -> dict:
    risk = state.get("risk_result", {})
    risk_level = risk.get("verdict_component", "medium risk")

    weighted_score = sum(
        state.get(key, {}).get("score", 50) * weight
        for key, weight in WEIGHTS.items()
    )

    if weighted_score >= 70:
        verdict = "Accept"
    elif weighted_score >= 45:
        verdict = "Negotiate"
    else:
        verdict = "Reject"

    # hard rule: high risk can never result in Accept
    hard_rule_applied = False
    if risk_level == "high risk" and verdict == "Accept":
        verdict = "Negotiate"
        hard_rule_applied = True

    summary = {
        "verdict": verdict,
        "weighted_score": round(weighted_score, 1),
        "hard_rule_applied": hard_rule_applied,
        "agent_breakdown": {
            "audience_fit": state.get("audience_fit_result", {}),
            "engagement": state.get("engagement_result", {}),
            "pricing": state.get("pricing_result", {}),
            "risk": state.get("risk_result", {}),
            "negotiation": state.get("negotiation_result", {}),
        },
    }
    return {"verdict": summary}
