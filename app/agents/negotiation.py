"""
Negotiation Agent — if the price doesn't fit, what should the counter-offer be?
Reads the Pricing Agent's verdict rather than re-deriving comparables itself.
Must run after Pricing in the graph.
"""
from app.config import call_llm_json
from app.state import DealState


def run(state: DealState) -> dict:
    pricing = state.get("pricing_result", {})

    prompt = f"""You are the Negotiation Agent in a creator-brand deal evaluation system.

Deal:
- Creator: {state.get('creator_name')}
- Proposed amount: Rs.{state.get('proposed_amount'):,}
- Deliverable: {state.get('deliverable')}
- Brand's budget range: Rs.{state.get('brand_budget_min'):,} - Rs.{state.get('brand_budget_max'):,}

Pricing Agent's assessment: {pricing.get('verdict_component', 'unknown')}
Pricing Agent's reasoning: {pricing.get('reasoning', 'not available')}

If the price is fair, no negotiation is needed — say so.
If overpriced or outside budget, propose a specific counter-offer amount and/or
an adjusted deliverable (e.g. swap a dedicated video for an integration slot).

Respond ONLY with valid JSON, no markdown, no preamble:
{{
  "score": <0-100, how much negotiation is needed - 100 means none needed>,
  "verdict_component": "<no negotiation needed | counter-offer suggested>",
  "reasoning": "<2-3 sentences, include a specific counter-offer amount if applicable>",
  "confidence": <0.0-1.0>
}}"""
    result = call_llm_json(prompt)
    return {"negotiation_result": result}
