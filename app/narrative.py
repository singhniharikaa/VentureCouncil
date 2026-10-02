"""
The written explanation of a verdict, for the brand.

The Supervisor produces a decision and a number. A brand manager needs a
sentence: why, what the main concern is, and what to do next. This layer writes
it AFTER the decision is made.

The decision is never the AI's to make here:

  * The headline ("ACCEPT: Bulky at Rs.35,000") is built in code from the
    Supervisor's result. The model never writes it, so it cannot change it.
  * The model is told the decision is final and is asked only for the "why".
  * If its text argues the opposite ("we recommend rejecting" under an Accept),
    it is discarded and the template is used instead.
  * If the call fails, returns something malformed, or is too thin to be useful,
    the template is used. The page always shows an explanation.

The template is built purely from the agents' own findings, so even with no AI at
all the brand still gets a correct, if plainer, account.

Campaigns use the template only: five creators already mean 25 LLM calls against
a free tier that allows about two evaluations a minute, and a sixth call per
creator would slow the one screen that is already the slowest.
"""
from __future__ import annotations

import re
from typing import Optional

from app.llm import call_llm_json, model_name, provider

MAX_EXPLANATION = 760
MAX_STEP = 170
MAX_STEPS = 3

# What would make the text contradict the decision the Supervisor reached.
# Deliberately about RECOMMENDING the opposite, not about the words appearing:
# "Do not sign until the payment terms are confirmed" is an ordinary next step
# under an Accept and must not be thrown away as a contradiction.
_REC = r"(?:recommend|advise|suggest|urge)\w*\s+(?:that\s+)?(?:you\s+)?(?:to\s+)?"
_CONTRADICTIONS = {
    "accept": [
        _REC + r"(?:reject|decline|walk away|not\s+(?:to\s+)?(?:accept|sign|proceed))",
        r"\b(?:we|i)\s+(?:would\s+)?(?:reject|decline)\b",
        r"\bshould\s+(?:be\s+)?(?:rejected|declined)\b",
        r"\bdo not accept (?:this|the) (?:deal|offer)\b",
    ],
    "reject": [
        _REC + r"(?:accept|sign|proceed|go ahead)",
        r"\b(?:we|i)\s+(?:would\s+)?(?:accept|sign)\b",
        r"\bshould\s+(?:be\s+)?(?:accepted|signed)\b",
    ],
    "negotiate": [
        r"\b(?:accept|sign)\w*\s+(?:this\s+)?(?:deal\s+)?as[- ]is\b",
        r"\bsign\s+(?:immediately|right away)\b",
        _REC + r"(?:reject|decline|walk away)",
    ],
}

LABEL = {
    "audience_fit": "audience fit",
    "engagement": "engagement",
    "pricing": "pricing",
    "risk": "contract and data risk",
    "negotiation": "negotiation",
}


def _inr(n) -> str:
    try:
        return f"Rs.{int(round(float(n))):,}"
    except (TypeError, ValueError):
        return "an unknown amount"


def build_facts(creator: dict, state: dict, agents: list[dict], verdict: dict) -> dict:
    """Everything the explanation may cite, in one plain dict."""
    offer = state.get("proposed_amount")
    rate = creator.get("price_inr")
    delta = None
    if offer and rate:
        delta = round((float(offer) / float(rate) - 1) * 100)

    return {
        "decision": str(verdict.get("decision", "negotiate")).lower(),
        "score": verdict.get("weightedScore"),
        "override_fired": bool((verdict.get("override") or {}).get("fired")),
        "creator": creator.get("creator_name") or "the creator",
        "platform": creator.get("platform"),
        "niche": creator.get("niche"),
        "followers": creator.get("followers_count"),
        "brand": state.get("brand_name") or "the brand",
        "deliverable": state.get("deliverable") or "the deliverable",
        "offer": offer,
        "rate": rate,
        "delta_pct": delta,
        "agents": [
            {
                "id": a.get("id"),
                "score": a.get("score"),
                "recommendation": a.get("recommendation"),
                "component": (a.get("typed") or {}).get("verdict_component"),
                "reasoning": (a.get("reasoning") or "").strip(),
                "insufficient": bool(a.get("insufficientData")),
                "flags": list(a.get("flags") or []),
            }
            for a in agents
        ],
    }


def make_headline(facts: dict) -> str:
    """Built in code from the Supervisor's decision. The model never writes this."""
    return f"{facts['decision'].upper()}: {facts['creator']} at {_inr(facts['offer'])}"


# ------------------------------------------------------------------ template

def _price_clause(f: dict) -> str:
    d, rate = f.get("delta_pct"), f.get("rate")
    if d is None or not rate:
        return f"The offer is {_inr(f['offer'])}."
    if abs(d) < 3:
        return f"The offer of {_inr(f['offer'])} matches their listed rate of {_inr(rate)}."
    return (f"The offer of {_inr(f['offer'])} is {abs(d)}% {'above' if d > 0 else 'below'} "
            f"their listed rate of {_inr(rate)}.")


def template_narrative(facts: dict) -> dict:
    """A correct explanation built only from the agents' findings. No AI."""
    f = facts
    dec = f["decision"]
    scored = [a for a in f["agents"] if a["id"] != "negotiation" and not a["insufficient"]
              and isinstance(a["score"], (int, float))]
    # Risk scores run 100 = safe, so "weakest" works the same way for all four.
    strong = [a for a in scored if a["recommendation"] == "accept"]
    weak = sorted([a for a in scored if a["recommendation"] != "accept"], key=lambda a: a["score"])
    missing = [LABEL.get(a["id"], a["id"]) for a in f["agents"] if a["insufficient"]]

    sentences: list[str] = []
    if dec == "accept":
        sentences.append(f"{f['creator']} is a good fit for {f['brand']} at this price.")
    elif dec == "negotiate":
        sentences.append(f"{f['creator']} could work for {f['brand']}, but the deal is not ready to sign as offered.")
    else:
        sentences.append(f"This deal with {f['creator']} should not go ahead as offered.")

    sentences.append(_price_clause(f))
    if strong:
        sentences.append("In its favour: " + ", ".join(LABEL.get(a["id"], a["id"]) for a in strong[:3]) + " looked sound.")
    if weak:
        w = weak[0]
        sentences.append(f"The main concern is {LABEL.get(w['id'], w['id'])}"
                         + (f" ({w['component']})" if w.get("component") else "") + ".")
    if f["override_fired"]:
        sentences.append("A fixed policy rule capped this at Negotiate because the risk was rated high, "
                         "whatever the other findings said.")
    if missing:
        sentences.append("Not enough data was available for " + ", ".join(missing) + ", so those findings were left out.")

    steps_by_decision = {
        "accept": ["Confirm the deliverables and payment terms in writing before signing.",
                   "Keep the contract free of unlimited usage rights or unpaid exclusivity."],
        "negotiate": ["Counter on the concern above rather than accepting as offered.",
                      "Ask for the clauses or price that caused it to be changed, then re-run the evaluation."],
        "reject": ["Do not proceed at this price or on these terms.",
                   "Revisit the budget, the creator, or the contract, then evaluate again."],
    }
    return {
        "headline": make_headline(f),
        "explanation": " ".join(sentences)[:MAX_EXPLANATION],
        "next_steps": steps_by_decision.get(dec, steps_by_decision["negotiate"]),
        "source": "template",
        "model": None,
    }


# ------------------------------------------------------------------------ AI

def build_prompt(facts: dict) -> str:
    f = facts
    dec = f["decision"].upper()
    lines = []
    for a in f["agents"]:
        label = LABEL.get(a["id"], a["id"]).capitalize()
        tail = " (not enough data)" if a["insufficient"] else ""
        lines.append(f"- {label}: {a['score']}/100{tail}. {a['reasoning']}")
    override = ("\nA fixed policy rule capped the decision at Negotiate because the contract or data "
                "risk was rated high. Mention this.\n") if f["override_fired"] else ""
    return f"""You are writing the final explanation of a creator-brand sponsorship evaluation for a brand manager who is not technical.

The decision has ALREADY been made by a fixed, rule-based process: {dec}. Do not question it, soften it, or hint at a different outcome.

THE DEAL
- Brand: {f['brand']}
- Creator: {f['creator']} ({f['platform']}, {f['niche'] or 'niche unknown'}, {f['followers'] or 'unknown'} followers)
- Deliverable: {f['deliverable']}
- Offer: {_inr(f['offer'])}. The creator's own listed rate is {_inr(f['rate']) if f['rate'] else 'unknown'}.

WHAT THE FIVE SPECIALIST CHECKS FOUND
{chr(10).join(lines)}
{override}
Write:
1. "explanation": three to four plain sentences saying WHY the decision is {dec}. Cite two or three specific facts taken from the findings above. Use only numbers that appear above; never invent one. Name the single biggest strength or concern.
2. "next_steps": one to three short, concrete actions for the brand. For NEGOTIATE say what to ask for. For ACCEPT say what to confirm before signing. For REJECT say what would have to change.

Plain English. No markdown. Do not use the words "agent" or "supervisor".

Respond ONLY with JSON: {{"explanation": "...", "next_steps": ["...", "..."]}}"""


def _clip(text: str, n: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


def contradicts(text: str, decision: str) -> bool:
    return any(re.search(p, text, re.IGNORECASE) for p in _CONTRADICTIONS.get(decision, []))


def _valid(raw: object, decision: str) -> Optional[tuple[str, list[str]]]:
    """Return (explanation, steps) only if the model's answer is usable and consistent."""
    if not isinstance(raw, dict):
        return None
    explanation = raw.get("explanation")
    steps = raw.get("next_steps")
    if not isinstance(explanation, str) or len(explanation.split()) < 12:
        return None
    if isinstance(steps, str):
        steps = [steps]
    if not isinstance(steps, list):
        steps = []
    steps = [_clip(s, MAX_STEP) for s in steps if isinstance(s, str) and s.strip()][:MAX_STEPS]
    if contradicts(explanation, decision) or any(contradicts(s, decision) for s in steps):
        return None
    return _clip(explanation, MAX_EXPLANATION), steps


def write_narrative(facts: dict, use_ai: bool = True) -> dict:
    """
    The explanation for one verdict. Never raises: any failure of the AI path
    degrades to the template, so a verdict is never shown without an explanation.
    """
    fallback = template_narrative(facts)
    if not use_ai:
        return fallback
    try:
        got = _valid(call_llm_json(build_prompt(facts)), facts["decision"])
    except Exception:
        return fallback
    if got is None:
        return fallback
    explanation, steps = got
    return {
        "headline": make_headline(facts),          # code-owned, always
        "explanation": explanation,
        "next_steps": steps or fallback["next_steps"],
        "source": "ai",
        "model": f"{provider()}/{model_name()}",
    }
