"""
Supervisor — consolidates the 5 agent outputs into one final verdict.
Applies the hard rule first (high risk -> floor at "negotiate"), then a
weighted combination of the remaining scores.
"""
from app.state import DealState

# Verdict bands, calibrated 2026-10-02 against 11 labelled deals run through
# the real engine (tools/calibrate_thresholds.py, results in
# tools/calibration.json). The agents do not use the top of the 0-100 range:
# genuinely good deals scored 52.8-76.8, borderline ones 45.1-46.5, and bad
# ones 25.2-43.7. The old Accept bar of 70 was therefore unreachable for half
# of the deals that deserved it. These values sit at the MIDPOINTS of the two
# observed gaps (43.7->45.1 and 46.5->52.8) rather than at the edge of the
# optimal range, so they keep a margin against run-to-run variance.
#
# Caveat for anyone revisiting: n=11. Re-run the calibration before trusting
# these to more decimal places than they deserve.
ACCEPT_AT = 50
NEGOTIATE_AT = 45

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

    if weighted_score >= ACCEPT_AT:
        verdict = "Accept"
    elif weighted_score >= NEGOTIATE_AT:
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
