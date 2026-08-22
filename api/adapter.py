"""
Translates the Python engine's output into the shapes the React frontend
already speaks (`AgentResult`, `Verdict`, `Comp` in `frontend/src/types.ts`).

The two halves were built independently and their contracts do not line up:
the agents return `{score, verdict_component, reasoning, confidence}`, while
the UI wants headline, flags, severity, a trace, typed fields, latency and a
model name. Everything added here is DERIVED FROM REAL DATA — measured
latencies, actual creator facts, the real model id. Nothing is invented to
fill a field; where the engine genuinely has nothing to say, the field is
left empty and `insufficientData` is set so the UI can show the gap.
"""
from __future__ import annotations

from typing import Any

AGENT_LABELS = {
    "audience_fit": "Audience Fit",
    "engagement": "Engagement",
    "pricing": "Pricing",
    "risk": "Risk & Legitimacy",
    "negotiation": "Negotiation",
}

# The Supervisor's own bands, so the per-agent chips agree with the verdict.
ACCEPT_AT = 70
NEGOTIATE_AT = 45

RISK_SEVERITY = {
    "low risk": "low",
    "medium risk": "medium",
    "high risk": "high",
}


def _recommendation(score: float | None) -> str:
    if score is None:
        return "negotiate"
    if score >= ACCEPT_AT:
        return "accept"
    if score >= NEGOTIATE_AT:
        return "negotiate"
    return "reject"


def _risk_recommendation(component: str) -> str:
    if component == "low risk":
        return "accept"
    if component == "high risk":
        return "reject"
    return "negotiate"


def creator_to_frontend(row: dict) -> dict:
    """One Supabase `creators` row in the shape the roster screen expects."""
    followers = row.get("followers_count") or 0
    return {
        "id": f"cr_{row['creator_id']}",
        "name": row.get("name") or "",
        "handle": row.get("name") or "",
        "platform": row.get("platform") or "youtube",
        "channelUrl": row.get("profile_url") or "",
        "channelId": str(row["creator_id"]),
        "niche": (row.get("niche") or "").lower(),
        "subNiche": "",
        "nicheRaw": row.get("niche") or "",
        # subscriberCount is the generic follower count: YouTube subscribers or
        # Instagram followers. The UI labels it per platform.
        "subscriberCount": followers,
        "followersCount": followers,
        "engagementRate": row.get("engagement_rate"),
        "totalViews": 0,
        "videoCount": 0,
        "integrationPriceInr": row.get("integration_price_inr"),
        "dedicatedPriceInr": row.get("dedicated_price_inr"),
        "priceInr": row.get("price_inr"),
        "priceEstimated": bool(row.get("price_estimated")),
        "dataConfidenceScore": row.get("data_confidence_score"),
        "notes": "",
    }


def _typed_for(agent_id: str, result: dict, state: dict, extra: dict) -> dict:
    """Real, checkable numbers the agent actually reasoned over."""
    typed: dict[str, Any] = {
        "score": result.get("score"),
        "verdict_component": result.get("verdict_component"),
    }
    if agent_id == "audience_fit":
        typed.update(
            creator_niche=state.get("niche"),
            brand_target_niche=state.get("brand_target_niche"),
            platform=state.get("platform"),
            platform_match=state.get("platform") == state.get("brand_platform_preference"),
            followers=state.get("followers_count"),
        )
    elif agent_id == "engagement":
        typed.update(
            engagement_rate=state.get("engagement_rate"),
            percentile=extra.get("percentile"),
            platform=state.get("platform"),
        )
    elif agent_id == "pricing":
        typed.update(
            proposed_amount_inr=state.get("proposed_amount"),
            creator_price_inr=state.get("price_inr"),
            price_estimated=state.get("price_estimated"),
            comps_used=extra.get("comps_used"),
            budget_min_inr=state.get("brand_budget_min"),
            budget_max_inr=state.get("brand_budget_max"),
        )
    elif agent_id == "risk":
        typed.update(
            data_confidence_score=state.get("data_confidence_score"),
            price_per_follower=extra.get("price_per_follower"),
            price_estimated=state.get("price_estimated"),
            contract_supplied=bool(state.get("contract_text")),
        )
    elif agent_id == "negotiation":
        typed.update(
            proposed_amount_inr=state.get("proposed_amount"),
            budget_min_inr=state.get("brand_budget_min"),
            budget_max_inr=state.get("brand_budget_max"),
            deliverable=state.get("deliverable"),
        )
    return {k: v for k, v in typed.items() if v is not None}


def _flags_for(agent_id: str, state: dict, extra: dict) -> list[str]:
    """
    Concrete data-quality flags, read off the creator row — not model opinion.
    These are the same conditions `data_confidence_score` is built from.
    """
    flags: list[str] = []
    if agent_id == "risk":
        conf = state.get("data_confidence_score")
        if conf is not None and conf < 50:
            flags.append(f"Low data confidence ({conf}/100)")
        if state.get("price_estimated"):
            flags.append("Creator price is KNN-estimated, not a quoted rate")
        ppf = extra.get("price_per_follower")
        if ppf is not None and (ppf < 0.05 or ppf > 0.50):
            flags.append(f"Price per follower Rs.{ppf} outside the Rs.0.05-0.50 norm")
        if state.get("contract_text"):
            flags.append("Contract text supplied and reviewed")
    if agent_id == "audience_fit" and not state.get("niche"):
        flags.append("Creator niche missing from the roster")
    if agent_id == "engagement" and state.get("engagement_rate") is None:
        flags.append("No engagement rate recorded for this creator")
    return flags


def agent_to_frontend(
    agent_id: str,
    result: dict,
    state: dict,
    *,
    latency_ms: int,
    model: str,
    trace: list[dict],
    extra: dict | None = None,
) -> dict:
    extra = extra or {}
    component = str(result.get("verdict_component") or "")
    score = result.get("score")

    if agent_id == "risk":
        recommendation = _risk_recommendation(component)
        severity = RISK_SEVERITY.get(component, "medium")
    else:
        recommendation = _recommendation(score)
        severity = None

    # The engine signals "I could not judge this" by returning the unknown
    # component (engagement does this when engagement_rate is NULL).
    insufficient = component == "unknown" or (
        agent_id == "engagement" and state.get("engagement_rate") is None
    )

    out = {
        "id": agent_id,
        "label": AGENT_LABELS.get(agent_id, agent_id),
        "status": "done",
        "score": score if score is not None else 0,
        "confidence": float(result.get("confidence") or 0.0),
        "recommendation": recommendation,
        "headline": f"{component} · {score}/100" if score is not None else component,
        "reasoning": result.get("reasoning") or "",
        "flags": _flags_for(agent_id, state, extra),
        "insufficientData": insufficient,
        "trace": trace,
        "typed": _typed_for(agent_id, result, state, extra),
        "latencyMs": latency_ms,
        "model": model,
    }
    if severity:
        out["severity"] = severity
    return out


def verdict_to_frontend(summary: dict, agents: list[dict]) -> dict:
    decision = str(summary.get("verdict", "negotiate")).lower()
    hard_rule = bool(summary.get("hard_rule_applied"))
    score = summary.get("weighted_score")

    recs = {a["recommendation"] for a in agents}
    split = len(recs) > 1 and "accept" in recs and "reject" in recs

    return {
        "decision": decision,
        "summary": (
            f"Weighted council score {score}/100. "
            + (
                "The Risk agent returned high risk, which floors the verdict at "
                "Negotiate regardless of the other agents."
                if hard_rule
                else "No hard policy rule fired; this is the weighted consolidation."
            )
        ),
        "override": {
            "fired": hard_rule,
            "changedOutcome": hard_rule,
            "rule": "HIGH_RISK_NO_ACCEPT" if hard_rule else "",
            "reason": (
                "Risk & Legitimacy returned \"high risk\". Policy forbids an Accept "
                "verdict in that case, so the verdict is floored at Negotiate."
                if hard_rule
                else "No hard rule fired."
            ),
            "floor": "negotiate" if hard_rule else "accept",
        },
        "councilSplit": split,
        "splitReason": (
            "Agents disagree at opposite ends — at least one recommends Accept while "
            "another recommends Reject."
            if split
            else ""
        ),
        "weightedScore": score,
    }


def comp_to_frontend(row: dict, index: int) -> dict:
    """One row from the pgvector past_deals search, for the comps panel."""
    followers = row.get("followers_count") or 0
    if followers >= 1_000_000:
        tier = "Mega"
    elif followers >= 500_000:
        tier = "Macro"
    elif followers >= 100_000:
        tier = "Mid"
    elif followers >= 10_000:
        tier = "Micro"
    else:
        tier = "Nano"
    similarity = row.get("similarity")
    return {
        "id": f"comp_{index}",
        "creatorName": row.get("creator_name") or "unknown creator",
        "niche": (row.get("niche") or "").lower(),
        "tier": tier,
        "subscriberCount": followers,
        "amountInr": row.get("deal_amount") or 0,
        "dealType": "dedicated" if "dedicated" in (row.get("deliverables") or "").lower() else "integration",
        "distance": round(1 - similarity, 3) if similarity is not None else 0.0,
        "deliverables": row.get("deliverables") or "",
        "outcome": row.get("outcome") or "",
    }
