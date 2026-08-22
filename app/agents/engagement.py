"""
Engagement Agent — is this creator's engagement genuinely strong?
Ranks the creator's engagement_rate against same-platform peers (percentile),
since YouTube and Instagram engagement rates aren't on comparable raw scales.
"""
from app.config import get_connection, call_llm_json
from app.state import DealState


def get_percentile(conn, platform: str, engagement_rate: float) -> float:
    """What % of same-platform creators have LOWER engagement than this one."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                (COUNT(*) FILTER (WHERE engagement_rate < %s))::float
                / NULLIF(COUNT(*) FILTER (WHERE engagement_rate IS NOT NULL), 0) * 100
            FROM creators WHERE platform = %s
        """, (engagement_rate, platform))
        result = cur.fetchone()[0]
    return round(result, 1) if result is not None else None


def run(state: DealState) -> dict:
    engagement_rate = state.get("engagement_rate")
    platform = state.get("platform")

    if engagement_rate is None:
        return {"engagement_result": {
            "score": 40, "verdict_component": "unknown",
            "reasoning": "No engagement rate data available for this creator.",
            "confidence": 0.3
        }}

    conn = get_connection()
    try:
        percentile = get_percentile(conn, platform, engagement_rate)
    finally:
        conn.close()

    prompt = f"""You are the Engagement Agent in a creator-brand deal evaluation system.

Creator:
- Platform: {platform}
- Engagement rate: {engagement_rate}%
- Percentile among same-platform peers: {percentile}th percentile

Note: engagement rate scales differ across platforms, so judge this creator
relative to their OWN platform's peers (the percentile), not the raw number alone.

Respond ONLY with valid JSON, no markdown, no preamble:
{{
  "score": <0-100>,
  "verdict_component": "<strong engagement | average engagement | weak engagement>",
  "reasoning": "<2-3 sentences, reference the percentile>",
  "confidence": <0.0-1.0>
}}"""
    result = call_llm_json(prompt)
    return {"engagement_result": result}
