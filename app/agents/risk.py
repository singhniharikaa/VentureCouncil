"""
Risk Agent — is there anything concerning about this creator or this deal?
Checks data_confidence_score, price-per-follower sanity, and (if the brand
supplied contract text) common contract red flags. This is the one agent
that can force the Supervisor's hand: high risk -> verdict floor is
"negotiate", never "accept".
"""
from app.config import call_llm_json
from app.state import DealState


def run(state: DealState) -> dict:
    followers = state.get("followers_count") or 0
    price = state.get("proposed_amount") or 0
    price_per_follower = round(price / followers, 4) if followers > 0 else None

    contract_section = ""
    if state.get("contract_text"):
        contract_section = f"""
Contract terms provided by the brand:
\"\"\"{state['contract_text']}\"\"\"
Also check these for red flags: excessive exclusivity periods, unclear or
unlimited content usage rights, unfavorable payment terms (e.g. no advance,
long payment delays), missing cancellation terms."""

    prompt = f"""You are the Risk Agent in a creator-brand deal evaluation system.

Creator data quality:
- data_confidence_score: {state.get('data_confidence_score')}/100 (100 = niche, real price, engagement rate, and contact info all present)
- Followers: {followers:,}
- Proposed amount: Rs.{state.get('proposed_amount'):,}
- Price per follower: Rs.{price_per_follower if price_per_follower else 'N/A'}
- This creator's price is {'ESTIMATED (not from real data)' if state.get('price_estimated') else 'real data'}
{contract_section}

Flag concerns such as: low data confidence (below 50), price-per-follower far
outside a normal range (normal is roughly Rs.0.05-0.50 per follower for
integration deals), or any contract red flags mentioned above.
Do NOT hard-reject — flag concerns as "proceed with caution" rather than blocking.

Respond ONLY with valid JSON, no markdown, no preamble:
{{
  "score": <0-100, where 100 = no concerns, 0 = severe concerns>,
  "verdict_component": "<low risk | medium risk | high risk>",
  "reasoning": "<2-3 sentences>",
  "confidence": <0.0-1.0>
}}"""
    result = call_llm_json(prompt)
    return {"risk_result": result}
