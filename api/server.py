"""
FastAPI layer joining the React frontend to the real Python engine.

Before this existed the frontend ran its own deterministic TypeScript council
over a stale 282-row YouTube CSV, while the Groq-backed agents, pgvector
comparables and the 775-creator Supabase roster sat unused behind a CLI.
This module is the bridge:

    GET  /api/health     is the engine reachable, which model is pinned
    GET  /api/creators   all 775 creators from Supabase, both platforms
    GET  /api/brands     seeded brands, for the intake form
    POST /api/evaluate   runs the real 5-agent LangGraph pipeline

Run it with:
    python -m uvicorn api.server:app --reload --port 8000
"""
from __future__ import annotations

import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from api.adapter import (
    agent_to_frontend,
    comp_to_frontend,
    creator_to_frontend,
    verdict_to_frontend,
)
from app.config import VECTOR_PROBES_SQL, embed_text, get_connection
from app.graph import build_graph
from app.llm import model_name, provider

app = FastAPI(title="VentureCouncil API", version="1.0.0")

# The Vite dev server runs on 5174; the built bundle may be served anywhere.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:4173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

AGENT_ORDER = ["audience_fit", "engagement", "pricing", "risk", "negotiation"]
RESULT_KEY = {a: f"{a}_result" for a in AGENT_ORDER}

_graph = None


def graph():
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph


class EvaluateRequest(BaseModel):
    creatorId: str
    brandName: str
    brandCategory: str = ""
    amountInr: int = Field(gt=0)
    dealType: str = "integration"
    deliverables: list[str] = []
    brandBudgetMin: int | None = None
    brandBudgetMax: int | None = None
    brandTargetNiche: str | None = None
    contractText: str | None = None


def _creator_pk(creator_id: str) -> int:
    raw = creator_id[3:] if creator_id.startswith("cr_") else creator_id
    try:
        return int(raw)
    except ValueError:
        raise HTTPException(400, f"Unrecognised creator id '{creator_id}'")


@app.get("/api/health")
def health():
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM creators")
            creators = cur.fetchone()[0]
        conn.close()
    except Exception as exc:  # surfaced to the UI rather than swallowed
        raise HTTPException(503, f"Supabase unreachable: {exc}")
    return {
        "ok": True,
        "creators": creators,
        "provider": provider(),
        "model": model_name(),
    }


@app.get("/api/creators")
def creators():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT creator_id, name, platform, niche, followers_count,
                       engagement_rate, integration_price_inr, dedicated_price_inr,
                       price_inr, price_estimated, data_confidence_score, profile_url
                FROM creators
                ORDER BY followers_count DESC NULLS LAST
                """
            )
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()
    return {"creators": [creator_to_frontend(r) for r in rows]}


@app.get("/api/brands")
def brands():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT brand_id, name, industry, platform_preference,
                          budget_min, budget_max, target_niche
                   FROM brands ORDER BY name"""
            )
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()
    return {"brands": rows}


def _load_creator(conn, pk: int) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT creator_id, name, platform, niche, followers_count,
                   engagement_rate, price_inr, price_estimated, data_confidence_score
            FROM creators WHERE creator_id = %s
            """,
            (pk,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, f"No creator with id {pk}")
    keys = [
        "creator_id", "creator_name", "platform", "niche", "followers_count",
        "engagement_rate", "price_inr", "price_estimated", "data_confidence_score",
    ]
    return dict(zip(keys, row))


def _percentile(conn, platform: str, rate: float | None):
    if rate is None:
        return None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT (COUNT(*) FILTER (WHERE engagement_rate < %s))::float
                   / NULLIF(COUNT(*) FILTER (WHERE engagement_rate IS NOT NULL), 0) * 100
            FROM creators WHERE platform = %s
            """,
            (rate, platform),
        )
        val = cur.fetchone()[0]
    return round(val, 1) if val is not None else None


def _comps(conn, niche, platform, amount, k=5):
    """Same pgvector search the Pricing agent runs, joined to creator context."""
    query = str(embed_text(f"{niche or 'general'} niche deal, {platform} platform, amount {amount}"))
    with conn.cursor() as cur:
        cur.execute(VECTOR_PROBES_SQL)  # must share the query's transaction
        cur.execute(
            """
            SELECT d.deal_amount, d.outcome, d.deliverables,
                   c.name AS creator_name, c.niche, c.followers_count,
                   1 - (d.embedding <=> %s::vector) AS similarity
            FROM past_deals d
            LEFT JOIN creators c ON c.creator_id = d.creator_id
            ORDER BY d.embedding <=> %s::vector
            LIMIT %s
            """,
            (query, query, k),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


@app.post("/api/evaluate")
def evaluate(req: EvaluateRequest):
    pk = _creator_pk(req.creatorId)

    conn = get_connection()
    try:
        creator = _load_creator(conn, pk)
        percentile = _percentile(conn, creator["platform"], creator["engagement_rate"])
        comps = _comps(conn, creator["niche"], creator["platform"], req.amountInr)
    finally:
        conn.close()

    budget_min = req.brandBudgetMin if req.brandBudgetMin is not None else int(req.amountInr * 0.75)
    budget_max = req.brandBudgetMax if req.brandBudgetMax is not None else int(req.amountInr * 1.25)
    deliverable = ", ".join(req.deliverables) if req.deliverables else f"1 {req.dealType} video"

    state = {
        **creator,
        "brand_name": req.brandName,
        "brand_budget_min": budget_min,
        "brand_budget_max": budget_max,
        "brand_target_niche": req.brandTargetNiche or req.brandCategory or creator.get("niche") or "",
        "brand_platform_preference": creator["platform"],
        "proposed_amount": req.amountInr,
        "deliverable": deliverable,
        "contract_text": req.contractText,
    }

    followers = creator.get("followers_count") or 0
    price_per_follower = round(req.amountInr / followers, 4) if followers else None
    extras = {
        "audience_fit": {},
        "engagement": {"percentile": percentile},
        "pricing": {"comps_used": len(comps)},
        "risk": {"price_per_follower": price_per_follower},
        "negotiation": {},
    }

    # Stream the graph so each agent's real completion time is captured. All
    # four upstream agents start together, so latency is measured from run
    # start; negotiation is measured from when pricing returned, since that is
    # when it actually becomes runnable.
    started = time.perf_counter()
    finished_at: dict[str, float] = {}
    final: dict = dict(state)

    try:
        for update in graph().stream(state, stream_mode="updates"):
            now = time.perf_counter()
            for node, payload in update.items():
                if node in RESULT_KEY:
                    finished_at[node] = now
                final.update(payload or {})
    except Exception as exc:
        raise HTTPException(502, f"Council run failed: {type(exc).__name__}: {exc}")

    model_id = f"{provider()}/{model_name()}"
    agents = []
    for agent_id in AGENT_ORDER:
        result = final.get(RESULT_KEY[agent_id])
        if not result:
            continue
        end = finished_at.get(agent_id, time.perf_counter())
        if agent_id == "negotiation" and "pricing" in finished_at:
            latency = int((end - finished_at["pricing"]) * 1000)
        else:
            latency = int((end - started) * 1000)

        trace = [{"t": f"+{int((end - started) * 1000)}ms", "text": f"{agent_id} reported."}]
        if agent_id == "engagement" and percentile is not None:
            trace.insert(0, {"t": "+0ms", "text": f"Ranked against same-platform peers: {percentile}th percentile.", "tone": "signal"})
        if agent_id == "pricing":
            trace.insert(0, {"t": "+0ms", "text": f"pgvector search returned {len(comps)} comparable past deals.", "tone": "signal"})

        agents.append(
            agent_to_frontend(
                agent_id, result, state,
                latency_ms=max(latency, 0),
                model=model_id,
                trace=trace,
                extra=extras.get(agent_id),
            )
        )

    summary = final.get("verdict")
    if not summary:
        raise HTTPException(502, "Council finished without producing a verdict")

    return {
        "agents": agents,
        "verdict": verdict_to_frontend(summary, agents),
        "comps": [comp_to_frontend(c, i) for i, c in enumerate(comps)],
        "creator": creator_to_frontend(
            {
                "creator_id": creator["creator_id"],
                "name": creator["creator_name"],
                "platform": creator["platform"],
                "niche": creator["niche"],
                "followers_count": creator["followers_count"],
                "engagement_rate": creator["engagement_rate"],
                "price_inr": creator["price_inr"],
                "price_estimated": creator["price_estimated"],
                "data_confidence_score": creator["data_confidence_score"],
            }
        ),
        "meta": {
            "provider": provider(),
            "model": model_name(),
            "totalMs": int((time.perf_counter() - started) * 1000),
            "percentile": percentile,
        },
    }
