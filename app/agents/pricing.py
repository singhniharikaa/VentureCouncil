"""
Pricing Agent — is the proposed amount fair, given comparable past deals?
Uses pgvector similarity search over past_deals, then Gemini reasons over
the retrieved comparables.
"""
from app.config import get_connection, embed_text, call_llm_json, VECTOR_PROBES_SQL
from app.state import DealState


def find_similar_deals(conn, niche: str, platform: str, amount: int, k: int = 5):
    query_text = f"{niche or 'general'} niche deal, {platform} platform, amount {amount}"
    # pgvector needs the literal "[0.1,0.2,...]" string form — psycopg2 would
    # otherwise adapt a Python list to ARRAY[...], which will not cast to vector.
    query_embedding = str(embed_text(query_text))

    with conn.cursor() as cur:
        cur.execute(VECTOR_PROBES_SQL)  # same transaction as the query below
        cur.execute("""
            SELECT deal_amount, outcome, deliverables,
                   1 - (embedding <=> %s::vector) AS similarity
            FROM past_deals
            ORDER BY embedding <=> %s::vector
            LIMIT %s
        """, (query_embedding, query_embedding, k))
        return cur.fetchall()


def run(state: DealState) -> dict:
    followers = state.get("followers_count")
    followers_str = f"{followers:,}" if followers else "unknown"
    listed_price = state.get("price_inr")
    listed_price_str = f"Rs.{listed_price:,.0f}" if listed_price else "not listed"

    conn = get_connection()
    try:
        similar_deals = find_similar_deals(
            conn, state.get("niche"), state.get("platform"), state.get("proposed_amount")
        )
    finally:
        conn.close()

    comparables_text = "\n".join(
        f"- Rs.{amt:,} for a {deliv}, outcome: {outcome} (similarity: {sim:.2f})"
        for amt, outcome, deliv, sim in similar_deals
    ) or "No comparable past deals found."

    prompt = f"""You are the Pricing Agent in a creator-brand deal evaluation system.

Deal to evaluate:
- Creator: {state.get('creator_name')} ({state.get('platform')}, {state.get('niche')} niche, {followers_str} followers)
- Proposed amount: Rs.{state.get('proposed_amount'):,}
- This creator's own listed price: {listed_price_str} (estimated: {state.get('price_estimated')})
- Brand's budget range: Rs.{state.get('brand_budget_min'):,} - Rs.{state.get('brand_budget_max'):,}

Similar past deals found via similarity search:
{comparables_text}

Respond ONLY with valid JSON, no markdown, no preamble:
{{
  "score": <0-100, how fair this price is>,
  "verdict_component": "<fair | overpriced | underpriced>",
  "reasoning": "<2-3 sentences, reference the comparable deals>",
  "confidence": <0.0-1.0>
}}"""
    result = call_llm_json(prompt)
    return {"pricing_result": result}
