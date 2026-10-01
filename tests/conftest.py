"""
Shared test setup.

Every test in this suite runs with NO database and NO LLM provider. That is
deliberate: the logic worth protecting — the Supervisor's arithmetic, its hard
risk rule, the engine->frontend contract, and the graph's fan-in — is all pure
and can be checked in milliseconds without spending Groq quota or depending on
Supabase being awake.

`app.config` raises at import time when SUPABASE_CONN_STRING is unset, so a
dummy value is injected here. Nothing in these tests ever opens a connection.
"""
import os

import pytest

# Must be set before anything imports app.config.
os.environ.setdefault(
    "SUPABASE_CONN_STRING", "postgresql://test:test@localhost:5432/test_never_connected"
)
os.environ.setdefault("LLM_PROVIDER", "groq")
os.environ.setdefault("GROQ_API_KEY", "test-key-never-used")


def agent(score, component="moderate fit", confidence=0.9, reasoning="because."):
    """A Python-engine agent result, in the shape the agents actually return."""
    return {
        "score": score,
        "verdict_component": component,
        "reasoning": reasoning,
        "confidence": confidence,
    }


@pytest.fixture
def state():
    """A complete DealState, mirroring a real Supabase creator row."""
    return {
        "creator_id": 43,
        "creator_name": "Bulky",
        "platform": "youtube",
        "niche": "gaming",
        "followers_count": 302_000,
        "engagement_rate": 2.94,
        "price_inr": 30_000,
        "price_estimated": False,
        "data_confidence_score": 100,
        "brand_name": "GameFuel Energy",
        "brand_budget_min": 25_000,
        "brand_budget_max": 40_000,
        "brand_target_niche": "gaming",
        "brand_platform_preference": "youtube",
        "proposed_amount": 35_000,
        "deliverable": "1 integration video",
        "contract_text": None,
    }
