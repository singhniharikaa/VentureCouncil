"""
RUN THIS ON YOUR OWN LAPTOP, NOT IN CLAUDE.

End-to-end test: loads a real creator from Supabase by name, sets up a
hypothetical brand + deal, runs the full 5-agent graph, prints the verdict.

Setup:
  pip install psycopg2-binary sentence-transformers google-generativeai langgraph

Before running: edit app/config.py with your Gemini API key.

Usage:
  python main.py "Bulky" 35000
"""
import sys
from app.config import get_connection
from app.graph import build_graph
from app.display import asciify, init_stdout

init_stdout()


def load_creator_by_name(conn, name: str) -> dict:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT creator_id, name, platform, niche, followers_count,
                   engagement_rate, price_inr, price_estimated, data_confidence_score
            FROM creators WHERE name = %s LIMIT 1
        """, (name,))
        row = cur.fetchone()
    if not row:
        raise ValueError(f"No creator found with name '{name}'")
    keys = ["creator_id", "creator_name", "platform", "niche", "followers_count",
            "engagement_rate", "price_inr", "price_estimated", "data_confidence_score"]
    return dict(zip(keys, row))


def main():
    if len(sys.argv) < 3:
        print("Usage: python main.py \"Creator Name\" proposed_amount")
        sys.exit(1)

    creator_name = sys.argv[1]
    proposed_amount = int(sys.argv[2])

    conn = get_connection()
    try:
        creator_data = load_creator_by_name(conn, creator_name)
    finally:
        conn.close()

    # hypothetical brand for this test run
    state = {
        **creator_data,
        "brand_name": "GameFuel Energy",
        "brand_budget_min": 25000,
        "brand_budget_max": 40000,
        "brand_target_niche": "gaming",
        "brand_platform_preference": creator_data["platform"],
        "proposed_amount": proposed_amount,
        "deliverable": "1 integration video",
        "contract_text": None,
    }

    print(f"Evaluating: {creator_data['creator_name']} for Rs.{proposed_amount:,}\n")

    graph = build_graph()
    result = graph.invoke(state)

    verdict = result["verdict"]
    print(f"{'='*50}")
    print(f"FINAL VERDICT: {verdict['verdict']}")
    print(f"Weighted score: {verdict['weighted_score']}")
    print(f"Hard risk rule applied: {verdict['hard_rule_applied']}")
    print(f"{'='*50}\n")

    for agent_name, agent_result in verdict["agent_breakdown"].items():
        print(f"[{agent_name}] {asciify(agent_result.get('verdict_component', 'N/A'))} "
              f"(score: {agent_result.get('score', 'N/A')})")
        print(f"  {asciify(agent_result.get('reasoning', 'no reasoning'))}\n")


if __name__ == "__main__":
    main()
