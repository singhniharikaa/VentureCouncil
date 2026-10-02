"""
Campaign budget aggregation.

A brand picks several creators and has one TOTAL budget for the campaign. Each
creator is judged separately by the five agents; this module only adds up what
those verdicts commit the brand to. There is no AI here - it is arithmetic, so
it can be tested exactly and explained in one sentence.

How each verdict is counted:

  Accept     -> COMMITTED. The brand would sign at the offered price.
  Negotiate  -> TENTATIVE. The deal might happen, but the price is likely to
                move, so it is shown separately rather than silently counted
                as spent.
  Reject     -> excluded. No money is attached to it.

The total budget is applied HERE, to the sum. It is deliberately not given to
the agents: each agent judges a single creator against that creator's market
rate, and feeding them a campaign-wide number would make a fair price look
"in budget" or "out of budget" depending on how many other creators were
picked - the same trap that made calibration look broken when the budget was
derived from the offer.
"""
from __future__ import annotations

from typing import Optional

COUNTED = ("accept", "negotiate")


def aggregate_budget(rows: list[dict], total_budget: Optional[int]) -> dict:
    """
    rows: in the order the brand ranked them, each with
          {"creator_id", "name", "offer", "decision"} where decision is
          'accept' | 'negotiate' | 'reject' | 'error'.

    Returns the totals plus, for every row, a running total so the UI can show
    exactly which creator tips the campaign over budget.
    """
    committed = 0
    tentative = 0
    counts = {"accept": 0, "negotiate": 0, "reject": 0, "error": 0}
    running = 0
    out_rows = []

    for r in rows:
        decision = r.get("decision", "error")
        offer = int(r.get("offer") or 0)
        counts[decision] = counts.get(decision, 0) + 1

        row = {
            "creator_id": r.get("creator_id"),
            "name": r.get("name"),
            "offer": offer,
            "decision": decision,
            "running_total": None,
            "fits_budget": None,
        }
        if decision in COUNTED:
            running += offer
            row["running_total"] = running
            if total_budget:
                row["fits_budget"] = running <= total_budget
            if decision == "accept":
                committed += offer
            else:
                tentative += offer
        out_rows.append(row)

    has_budget = bool(total_budget) and total_budget > 0
    return {
        "total_budget": total_budget if has_budget else None,
        "committed": committed,
        "tentative": tentative,
        "if_all_close": committed + tentative,
        "remaining": (total_budget - committed) if has_budget else None,
        "remaining_if_all_close": (total_budget - committed - tentative) if has_budget else None,
        "over_budget": bool(has_budget and committed > total_budget),
        "tentative_over_budget": bool(has_budget and committed + tentative > total_budget),
        "counts": counts,
        "rows": out_rows,
    }


DEFAULT_MAX_CREATORS = 5   # matches the campaign limit (Groq free-tier pacing)


def suggest_within_budget(
    ranked: list[dict],
    total_budget: Optional[int],
    max_creators: int = DEFAULT_MAX_CREATORS,
) -> dict:
    """
    "I have Rs.X for the whole campaign - who should I pick?"

    `ranked` is the candidate list in the order the search ranked it, best match
    first, each item {"id", "price"}. Walk it in that order and take every
    creator whose price still fits in what is left, until the budget or the
    creator limit runs out.

    Deliberately greedy on MATCH QUALITY, not on head-count: the best-matching
    creators come first and cheaper ones only fill the leftover. It does not
    scan for the combination that squeezes in the most creators, because a brand
    asking for the right creators would rather have 3 strong matches than 5 weak
    ones. A creator that does not fit is skipped, not treated as the end of the
    list - a cheaper match further down may still fit.

    Creators with no price are never suggested: a budget cannot be checked
    against an unknown cost.
    """
    if not total_budget or total_budget <= 0:
        return {"ids": [], "total": 0, "remaining": None, "count": 0, "skipped": 0}

    ids: list[str] = []
    spent = 0
    skipped = 0
    for item in ranked:
        if len(ids) >= max_creators:
            break
        price = item.get("price")
        if not price or price <= 0:
            skipped += 1
            continue
        if spent + price <= total_budget:
            ids.append(item["id"])
            spent += int(price)
        else:
            skipped += 1

    return {
        "ids": ids,
        "total": spent,
        "remaining": total_budget - spent,
        "count": len(ids),
        "skipped": skipped,
    }
