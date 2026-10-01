"""
Engagement Agent — is this creator's engagement genuinely strong?
Ranks the creator's engagement_rate against same-platform peers (percentile),
since YouTube and Instagram engagement rates aren't on comparable raw scales.

IMPORTANT: a stored engagement_rate of 0 means "could not be computed", not
"nobody engages". 126 of the 775 seeded creators carry 0, including accounts
with millions of followers, and 33.6% of Instagram rows sit there. Read
literally it put those creators in the bottom percentile and cost the deal
roughly 11 weighted points, flipping correct verdicts: in calibration it turned
a fair Instagram offer into Negotiate and a negotiable one into Reject. Zero is
therefore treated exactly like NULL throughout this module.
"""
from app.config import get_connection, call_llm_json
from app.state import DealState


def has_engagement(rate) -> bool:
    """True only for a real, usable measurement. 0 and NULL both mean 'unknown'."""
    return rate is not None and float(rate) > 0


def get_percentile(conn, platform: str, engagement_rate: float) -> float:
    """
    What % of same-platform creators have LOWER engagement than this one.

    The comparison population excludes zero rows for the same reason the input
    does: counting 126 unmeasured creators as the worst in the roster inflates
    everyone else's percentile and makes the ranking meaningless.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                (COUNT(*) FILTER (WHERE engagement_rate < %s))::float
                / NULLIF(COUNT(*) FILTER (WHERE engagement_rate > 0), 0) * 100
            FROM creators WHERE platform = %s AND engagement_rate > 0
        """, (engagement_rate, platform))
        result = cur.fetchone()[0]
    return round(result, 1) if result is not None else None


def run(state: DealState) -> dict:
    engagement_rate = state.get("engagement_rate")
    platform = state.get("platform")

    if not has_engagement(engagement_rate):
        return {"engagement_result": {
            "score": 40, "verdict_component": "unknown",
            "reasoning": (
                "No usable engagement rate for this creator — the field is "
                "missing or recorded as zero, which this roster uses to mean "
                "'not measured' rather than 'no engagement'. Abstaining rather "
                "than scoring it as weak."
            ),
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
