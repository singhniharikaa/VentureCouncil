"""
FastAPI layer joining the React frontend to the real Python engine.

Before this existed the frontend ran its own deterministic TypeScript council
over a stale 282-row YouTube CSV, while the Groq-backed agents, pgvector
comparables and the 775-creator Supabase roster sat unused behind a CLI.
This module is the bridge:

    GET  /api/health     is the engine reachable, which model is pinned
    GET  /api/creators   all 775 creators from Supabase, both platforms
    GET  /api/brands     seeded brands, for the intake form
    POST /api/discover   Path A: free-text brief -> ranked creator candidates
    POST /api/evaluate   Path B: runs the real 5-agent LangGraph pipeline
    POST /api/campaign   several creators, one total budget (Path A -> B, in bulk)

Run it with:
    python -m uvicorn api.server:app --reload --port 8000
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

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
from app.campaign import aggregate_budget
from app.discovery import discover_creators, summarise_filters
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


class DiscoverRequest(BaseModel):
    """Path A: what the brand wants, in words plus hard constraints."""

    brief: str = Field(min_length=3, max_length=2000)
    platform: str | None = None
    niche: str | None = None
    budgetMin: int | None = None
    budgetMax: int | None = None
    minFollowers: int | None = None
    maxFollowers: int | None = None
    realPriceOnly: bool = False
    minConfidence: int | None = None
    limit: int = Field(default=20, ge=1, le=100)


MAX_CAMPAIGN_CREATORS = 5   # Groq free tier: ~2 evaluations/minute, see CLAUDE.md
CAMPAIGN_WORKERS = 2        # creators evaluated at once; llm.py also caps calls


class CampaignCreator(BaseModel):
    creatorId: str
    # Optional. Defaults to the creator's own listed price, the simplest offer
    # to explain: "we offered each creator their quoted rate".
    amountInr: int | None = Field(default=None, gt=0)


class CampaignRequest(BaseModel):
    creators: list[CampaignCreator] = Field(min_length=1, max_length=MAX_CAMPAIGN_CREATORS)
    brandName: str = Field(min_length=1)
    brandCategory: str = ""
    totalBudget: int | None = Field(default=None, gt=0)
    dealType: str = "integration"
    deliverables: list[str] = []


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


@app.post("/api/discover")
def discover(req: DiscoverRequest):
    """
    Path A — rank creators against a free-text brief.

    Hard constraints (budget, platform, reach) filter the pool in SQL; the
    vector search only orders what survives. This is deliberately cheap: no
    LLM is involved, so a brand can explore the roster freely and only spend
    agent calls on the handful of creators it actually shortlists.
    """
    filters = dict(
        platform=req.platform,
        niche=req.niche,
        budget_min=req.budgetMin,
        budget_max=req.budgetMax,
        min_followers=req.minFollowers,
        max_followers=req.maxFollowers,
        real_price_only=req.realPriceOnly,
        min_confidence=req.minConfidence,
    )

    conn = get_connection()
    try:
        rows = discover_creators(conn, req.brief, limit=req.limit, **filters)
    except Exception as exc:
        raise HTTPException(502, f"Discovery failed: {type(exc).__name__}: {exc}")
    finally:
        conn.close()

    candidates = []
    for r in rows:
        creator = creator_to_frontend(r)
        creator["similarity"] = r.get("similarity")
        creator["distance"] = r.get("distance")
        candidates.append(creator)

    return {
        "candidates": candidates,
        "filters": summarise_filters(**filters),
        "meta": {"brief": req.brief, "returned": len(candidates), "limit": req.limit},
    }


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
    # 0 means "not measured" in this roster, not "no engagement" - see the
    # note in app/agents/engagement.py. Must match the agent, or the UI would
    # report a percentile the agent never used.
    if not rate:
        return None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT (COUNT(*) FILTER (WHERE engagement_rate < %s))::float
                   / NULLIF(COUNT(*) FILTER (WHERE engagement_rate > 0), 0) * 100
            FROM creators WHERE platform = %s AND engagement_rate > 0
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
    return run_evaluation(req)


def run_evaluation(req: EvaluateRequest) -> dict:
    """
    One full five-agent evaluation of one creator and one deal.

    Kept separate from the route so /api/campaign can run it once per selected
    creator through exactly the same code path - a campaign must not have its
    own slightly different copy of the evaluation.
    """
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


def _resolve_offer(creator_id: str, amount: int | None) -> tuple[int, str]:
    """(offer, creator name). Uses the creator's listed price unless one is given."""
    pk = _creator_pk(creator_id)
    conn = get_connection()
    try:
        creator = _load_creator(conn, pk)
    finally:
        conn.close()
    offer = amount or creator.get("price_inr")
    if not offer:
        raise HTTPException(
            422, f"{creator['creator_name']} has no listed price - give an amount for them."
        )
    return int(offer), creator["creator_name"]


def _evaluate_one_for_campaign(c: CampaignCreator, req: CampaignRequest) -> dict:
    """One creator inside a campaign. A failure here must not sink the others."""
    try:
        offer, name = _resolve_offer(c.creatorId, c.amountInr)
    except HTTPException as exc:
        return {"creatorId": c.creatorId, "name": c.creatorId, "offerInr": 0,
                "status": "error", "error": str(exc.detail), "evaluation": None}

    # The brand's acceptable range is anchored to the creator's MARKET RATE
    # (80%-130% of their listed price), not to the offer and not to the
    # campaign total. See app/campaign.py for why.
    rate = offer
    try:
        conn = get_connection()
        try:
            listed = _load_creator(conn, _creator_pk(c.creatorId)).get("price_inr")
        finally:
            conn.close()
        rate = int(listed or offer)
    except Exception:
        pass

    try:
        evaluation = run_evaluation(
            EvaluateRequest(
                creatorId=c.creatorId,
                brandName=req.brandName,
                brandCategory=req.brandCategory,
                amountInr=offer,
                dealType=req.dealType,
                deliverables=req.deliverables,
                brandBudgetMin=int(rate * 0.8),
                brandBudgetMax=int(rate * 1.3),
                brandTargetNiche=req.brandCategory or None,
            )
        )
    except HTTPException as exc:
        return {"creatorId": c.creatorId, "name": name, "offerInr": offer,
                "status": "error", "error": str(exc.detail), "evaluation": None}
    except Exception as exc:  # never let one creator take down the campaign
        return {"creatorId": c.creatorId, "name": name, "offerInr": offer,
                "status": "error", "error": f"{type(exc).__name__}: {exc}", "evaluation": None}

    return {"creatorId": c.creatorId, "name": name, "offerInr": offer,
            "status": "ok", "error": None, "evaluation": evaluation}


def run_campaign(req: CampaignRequest) -> dict:
    started = time.perf_counter()

    # Two creators at a time. Evaluating them all at once would just trip
    # Groq's tokens-per-minute limit and spend the time in retries; app/llm.py
    # also caps total in-flight LLM calls, so this is a second, gentler layer.
    with ThreadPoolExecutor(max_workers=CAMPAIGN_WORKERS) as pool:
        results = list(pool.map(lambda c: _evaluate_one_for_campaign(c, req), req.creators))

    rows = [
        {
            "creator_id": r["creatorId"],
            "name": r["name"],
            "offer": r["offerInr"],
            "decision": (r["evaluation"]["verdict"]["decision"] if r["evaluation"] else "error"),
        }
        for r in results
    ]
    return {
        "results": results,
        "budget": aggregate_budget(rows, req.totalBudget),
        "meta": {
            "provider": provider(),
            "model": model_name(),
            "creators": len(req.creators),
            "totalMs": int((time.perf_counter() - started) * 1000),
        },
    }


@app.post("/api/campaign")
def campaign(req: CampaignRequest):
    """
    Several creators, one total budget.

    Each creator goes through the SAME five-agent evaluation as /api/evaluate
    (run_evaluation), then the verdicts are added up against the budget. This
    is where Path A (discovery picks N creators) turns into Path B (judge each).
    """
    return run_campaign(req)
