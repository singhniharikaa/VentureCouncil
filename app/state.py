"""
The shared state object that flows through every agent and the Supervisor.
Each agent reads the deal/creator/brand fields and writes only its own
`*_result` key — this is what makes them safe to run in parallel.
"""
from typing import TypedDict, Optional


class DealState(TypedDict, total=False):
    # --- creator info (from Supabase creators table) ---
    creator_id: int
    creator_name: str
    platform: str
    niche: Optional[str]
    followers_count: Optional[int]
    engagement_rate: Optional[float]
    price_inr: Optional[float]
    price_estimated: bool
    data_confidence_score: Optional[int]

    # --- brand info ---
    brand_name: str
    brand_budget_min: int
    brand_budget_max: int
    brand_target_niche: str
    brand_platform_preference: str

    # --- deal specifics ---
    proposed_amount: int
    deliverable: str
    contract_text: Optional[str]  # optional free text, used by the Risk agent

    # --- agent outputs (each agent writes only its own key) ---
    audience_fit_result: dict
    engagement_result: dict
    pricing_result: dict
    risk_result: dict
    negotiation_result: dict

    # --- final ---
    verdict: dict


def load_creator(conn, creator_id: int) -> dict:
    """Fetch a creator row from Supabase and shape it into DealState fields."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT creator_id, name, platform, niche, followers_count,
                   engagement_rate, price_inr, price_estimated, data_confidence_score
            FROM creators WHERE creator_id = %s
        """, (creator_id,))
        row = cur.fetchone()
    if not row:
        raise ValueError(f"No creator found with id {creator_id}")
    keys = ["creator_id", "creator_name", "platform", "niche", "followers_count",
            "engagement_rate", "price_inr", "price_estimated", "data_confidence_score"]
    return dict(zip(keys, row))
