# VentureCouncil — Project Context

Multi-agent AI system evaluating creator-brand deals for Nitrix Talent Media (college AI & Data Science mini-project). Produces Accept/Negotiate/Reject verdicts.

## Tech stack
- **DB**: Supabase (Postgres + pgvector). Connection string in `app/config.py`.
- **Secrets**: `GEMINI_API_KEY` lives in `.env` in the project root (gitignored, loaded via
  `python-dotenv`). Copy `.env.example` to `.env` and fill it in — one time, per machine.
  Never hardcode the key in `app/config.py`; that file is committed, `.env` is not.
- **Embeddings**: `sentence-transformers` (`all-MiniLM-L6-v2`, 384-dim). Local, free, no API key.
- **LLM**: pluggable. `app/llm.py` is a provider-agnostic layer; the five agents just call
  `call_llm_json()` and never know which provider answered. Set `LLM_PROVIDER=gemini|grok`
  in `.env`. Only the selected provider's key is required.
- **Gemini** (`google-generativeai`), default model `gemini-3.6-flash`.
  2.5 Flash is still listed by `list_models()` but 404s for keys created after its cutoff
  ("no longer available to new users").
- **Groq** (`openai` SDK against `https://api.groq.com/openai/v1`), default model
  `openai/gpt-oss-120b`. **This is the one we actually have a key for.** Free tier,
  key prefix `gsk_`. Uses OpenAI JSON mode (`response_format={"type":"json_object"}`),
  which removes the "model wrapped its JSON in prose" failure class entirely.
- **Grok / xAI** (`openai` SDK against `https://api.x.ai/v1`), default `grok-4.3`.
  Implemented but **never tested — we have no xAI key.** Note Groq != Grok: different
  companies, similar names. A `gsk_` key is Groq; xAI keys start with `xai-`.

### Rate limits — this drove the provider work

| | per minute | per day |
|---|---|---|
| Gemini free, flash | 5 RPM | 20 RPD |
| Gemini free, flash-**lite** | 15 RPM | 50 RPD |
| **Groq free** (`gpt-oss-120b`) | 8,000 tokens/min | **1,000 RPD** |
| Grok Tier 0 (zero spend) | 150 **per second** | no documented daily cap |

Groq's 1,000 requests/day = **200 evaluations/day**, versus 4 on Gemini flash. Its binding
constraint is tokens/minute, not requests: 5 calls at ~600-900 tokens each is ~3-4.5k tokens,
so roughly 2 evaluations/minute before a 429. The retry/backoff in `app/llm.py` absorbs that.

One evaluation = 5 LLM calls, **4 of them concurrent** (the fan-out). So on Gemini flash a
single evaluation saturates the 5 RPM ceiling and a second one in the same minute 429s.
Multi-creator campaigns (a stated design goal) are impossible on Gemini flash: 3 creators in
parallel = 15 concurrent calls. Grok Tier 0 removes the ceiling entirely; xAI grants $25 free
signup credit, and at ~$0.006/evaluation that is roughly 4,000 evaluations.

`app/llm.py` protects both providers with a concurrency cap (`LLM_MAX_CONCURRENCY`, default 4)
and retry-with-backoff on 429 that honours the server's own retry hint. Before this, one
rate-limited agent raised and killed the whole graph run mid-evaluation.
- **Orchestration**: LangGraph.
- **Frontend**: React 19 + Vite + Tailwind 4 + react-router + recharts, in `frontend/`.
  Run with `npm install && npm run dev --prefix frontend` (port 5174), or via
  `.claude/launch.json`. Source of truth: https://github.com/singhniharikaa/VentureCouncil
- **API**: FastAPI in `api/` — `api/server.py` (endpoints) + `api/adapter.py` (shape
  translation). Run with `python -m uvicorn api.server:app --reload --port 8000`.
  Vite proxies `/api` to port 8000, so the frontend stays origin-relative.

## Current state — what's actually done vs. untested

**Done and verified:**
- Data cleaned and seeded into Supabase: 279 YouTube + ~496 Instagram creators, 18 brands, 61 past_deals, all with pgvector embeddings.
- `app/graph.py` LangGraph wiring — **structurally tested with mocked functions** (see "Known gotchas" below for the bug that was caught).

**Now verified end-to-end against real Supabase + Gemini** (2026-08-22):
- All 5 agent files, `app/supervisor.py`, and `main.py` run clean.
- Spot-checked 3 creators: `Bulky` (youtube, complete data -> Accept 79.9),
  `Chirag Sajnani` (instagram, complete -> Negotiate 69.3), and
  `Harjinder Singh Kukreja` (instagram, NULL niche + NULL engagement + estimated
  price + confidence 25 -> Negotiate 65.2, Risk correctly returned "high risk").
- Bugs fixed during that first run: a broken f-string conditional in `audience_fit.py`,
  `:,` formatting crashing on NULL `followers_count`/`price_inr` in `pricing.py`,
  the pgvector binding and probes issues (gotchas 5 and 6 below), and the model 404.

## Database schema (Supabase, already seeded)

```sql
creators (
  creator_id, platform, name, niche, followers_count, engagement_rate,
  integration_price_inr, dedicated_price_inr, price_inr, price_estimated,
  data_confidence_score, whatsapp, profile_url, embedding_text, embedding VECTOR(384)
)
brands (
  brand_id, name, industry, platform_preference, budget_min, budget_max, target_niche
)
past_deals (
  deal_id, creator_id, brand_id, deal_amount, outcome, deliverables,
  embedding_text, embedding VECTOR(384)
)
```

## Key design decisions (don't relitigate these without reason)

- **`price_estimated` flag**: many creator prices are KNN-estimated (nearest neighbors by log-subscriber/log-views), not real Nitrix data. Always check this flag before treating a price as ground truth.
- **`data_confidence_score` (0-100)**: +25 each for niche present, real (non-estimated) price, engagement_rate present, whatsapp present. Feeds the Risk agent.
- **Engagement comparison is percentile-based, not raw**: YouTube and Instagram engagement rates aren't on the same scale even after fixing the calculation, so the Engagement agent ranks a creator against same-platform peers via a SQL percentile query, not the raw number.
- **Betting/non-betting classification was dropped** from Risk agent scope — data coverage was too sparse (24% YouTube, 0% Instagram) to be reliable. Don't re-add without new data.
- **Contract evaluation was folded into the Risk agent**, not built as a 6th agent — avoid scope creep; only add contract_text analysis (already stubbed in `risk.py`) when there's actual contract text to evaluate (Path B optional field).
- **Two entry paths**: Path A (discovery — brand free-text → pgvector match → brand picks N creators) and Path B (direct — creator + deal given). Both converge into the same 5-agent evaluation. Path A's discovery/matching code is NOT built yet — only the evaluation engine is.
- **Multi-creator support**: each selected creator runs the full pipeline independently in parallel. Budget aggregation (summing accepted/negotiated deals against a brand's total campaign budget) is a query-time input, NOT a stored `brands` table field — campaign budgets vary per campaign.
- **No live external API calls during evaluation** was an intentional scope decision for the mini-project (academic defensibility) — this refers to NOT calling live YouTube/Instagram APIs during deal evaluation. It does NOT mean avoiding Gemini/embeddings, which are core to the architecture.

## Known gotchas (learned the hard way, don't repeat)

1. **LangGraph fan-in requires list-syntax edges.** `graph.add_edge(node, target)` called separately for each of 4 predecessors does NOT make target wait for all 4 — it fires once per predecessor, running target multiple times. Fix: `graph.add_edge([node1, node2, node3, node4], target)` — this creates a proper join. This was caught via a mocked dry-run before ever touching real data; verify it's still working if the graph structure changes.
2. **Windows CSV round-tripping mangles phone numbers** — pandas auto-infers all-digit strings as floats (`7007161584.0`, sometimes truncating a leading digit). Always read with `dtype={"whatsapp": str}` and validate 10-digit length after any CSV round-trip.
3. **Regex niche-matching bugs are easy to introduce** — e.g. a pattern for `r'game'` does NOT match `"gaming"` (different letter sequence). Always dry-run a regex against the actual unique value set before trusting it, not just a few examples.
4. **pgvector needs the embedding as a STRING, not a list.** `embed_text()` returns a Python
   list; psycopg2 adapts a list to `ARRAY[...]`, which will not cast via `%s::vector`. Always
   wrap it: `str(embed_text(text))`.
5. **ivfflat indexes on these tables silently return too few, and WRONG, rows.** Both
   `creators` (775 rows) and `past_deals` (61 rows) have ivfflat indexes built with pgvector's
   default `lists=100`, leaving under ~8 rows per list. With the default `ivfflat.probes = 1`,
   a `LIMIT 5` returned only 3 rows — and not the nearest ones (best similarity 0.60 vs 0.83
   once fixed). This silently fed the Pricing agent Rs.15k reel deals instead of the Rs.30k
   integration-video match at the creator's actual rate. Every vector query must run
   `config.VECTOR_PROBES_SQL` first. **This will bite Path A discovery too** — `creators` has
   the same defect.
6. **Use `SET LOCAL`, never a session-level `SET`, on the Supabase pooler.** The connection
   string uses port 6543 (pgbouncer, *transaction* mode), so consecutive transactions can land
   on different backends. A session `SET ivfflat.probes` appears to work in a sequential script
   and is then silently lost once the graph runs its agents in parallel — the failure only shows
   up under concurrency. `SET LOCAL` is scoped to the current transaction, which is always one
   backend. Requires `autocommit=False` (psycopg2's default).
7. **File paths in scripts must be relative**, not sandbox-absolute (`/mnt/user-data/outputs/...`) — always double check before handing off a script to run locally on Windows.

## The two halves are now wired together (2026-08-22)

The frontend originally shipped its own council: `frontend/src/lib/council.ts` (~700 lines
of TS) reimplemented all five agents **in the browser** with deterministic arithmetic and
**no LLM at all** (`model: 'council-local'`), reading a stale 282-row YouTube-only CSV.
Its "thinking" was hardcoded `setTimeout` delays (900/1150/1500/1850/2700/3100ms) and
hardcoded `latencyMs` constants. It returned in ~3s because it never called anything.

`api/` now joins the halves:

| endpoint | what it does |
|---|---|
| `GET /api/health` | engine reachable? which provider/model is pinned |
| `GET /api/creators` | all **775** Supabase creators, **both platforms** |
| `GET /api/brands` | the 18 seeded brands |
| `POST /api/evaluate` | runs the real 5-agent LangGraph pipeline on Groq |

`api/adapter.py` translates the engine's `{score, verdict_component, reasoning,
confidence}` into the frontend's richer `AgentResult`. Everything it adds is derived from
real data — measured per-agent latencies from `graph.stream()`, actual creator facts,
the real model id, pgvector comps joined to creator names. Nothing is invented to fill a
field; where the engine has nothing to say, `insufficientData` is set instead.

**The local TS council is now only an offline fallback.** `lib/seed.ts` tries the engine
first and falls back to the CSV; `DealRoom` uses `/api/evaluate` when the engine is up and
`runCouncil` when it is not. The UI states which mode produced the verdict — a green
"Live engine" banner or an amber "Offline mode — no AI model was used" one. Do not remove
that banner: the two modes differ in kind, not just quality.

The sidebar used to read "Council runs locally. No deal data leaves this machine." That
became false the moment the engine was wired in (deal and creator details go to Groq), so
it now reports the live engine state instead.

### Two follow-on fixes (same day, found by running it)

1. **A cached CSV roster used to outlive the engine coming back.** The store only seeded
   when no roster was cached, so a browser that had loaded the 282-row fallback while the
   API was down kept showing 282 forever — with the sidebar saying "Engine: groq". The
   app was in live mode displaying fallback data. `Persisted.source` is now stored: a
   cached `engine` roster is kept as-is (it may carry local edits), a cached `csv` roster
   is shown immediately and then upgraded in place once the engine answers.
2. **History could not tell real verdicts from fake ones.** Runs from the local
   rule-based council looked identical to runs from the five LLM agents. `Evaluation` now
   carries `engine: 'live' | 'local'` and `model`, and the dashboard shows an
   "AI agents" / "local rules" badge. Records written before this show "unknown".
   Do not remove this — the two are not comparable, and a mixed history that hides the
   difference is worse than no history.

Screens: `/` dashboard, `/evaluate` intake, `/deal-room` live trace, `/deal/:id` replay,
`/creators` roster + CSV import/export, `/traces` agent stats, `/audit` raw I/O.

### Council graph (`components/CouncilGraph.tsx`)

Ported 2026-08-22 from the "Deal Room Live" Claude Design canvas
(project `0ce549d3-8473-4a2d-ad39-9b90381eb875`, read via the DesignSync tool).
The canvas ran a scripted demo timeline; the port is driven by the real council, so
node states, confidence values, chips and receipts all come from actual `AgentResult`
data. It visualises the run's *topology* — four agents in parallel, a gate holding
Negotiation until all four report, then Supervisor consolidation — which the old card
grid could not show.

Notes for anyone touching it:
- Geometry is a fixed 960x520 diagram inside an `overflow-x-auto` container. It
  deliberately does not reflow; a rewrapped graph is an unreadable graph.
- The clock uses `setInterval` over wall-clock timestamps, **not**
  `requestAnimationFrame`. rAF does not fire in a hidden document, so a backgrounded
  tab froze the clock at 0.0s. Do not "optimise" it back to rAF.
- Packet animations use CSS `offset-path`; keyframes (`flow`, `dash`, `halo`, `rise`)
  live in `index.css` and are disabled under `prefers-reduced-motion`.
- Replaying re-runs the council for the visual only. The council is deterministic, so
  a replay must not write a second history record — `savedOnce` in `DealRoom` guards it.

**Decide which is the real system before building more on either side.** For an AI &
Data Science project the Python engine is the defensible one — the TS council contains
no model.

### Betting removed from the frontend too (2026-08-22)

The frontend had reinstated betting/non-betting as a first-class concept — a `ContentFlag`
type, a roster column, a risk penalty, and a `BETTING_BRAND_CONFLICT` hard-Reject override.
That contradicted the decision already recorded above for the Python side, and the data
backs the original call: **216 of 282 rows carry no notes value at all**. All of it is now
removed (types, CSV parsing, risk scoring, supervisor override, roster UI, intake warning,
`Betting` brand category). Build and lint clean; a full council run still produces a verdict.
Do not reintroduce without new data.

## Team
4-person team: Niharika Singh, Shubham Singh, Tushar Singh, Akash Warde. Guided by Prof. Megha Jain. No task ownership assigned in tracker by preference.

## PINNED PROVIDER: Groq (decided 2026-08-22)

`DEFAULT_PROVIDER = "groq"` in `app/llm.py`, model `openai/gpt-oss-120b`. All reported
numbers must come from this provider — say so in the write-up.

### Groq scores markedly harsher than Gemini — all three verdicts changed

| creator | Gemini 3.6 Flash | Groq gpt-oss-120b |
|---|---|---|
| Bulky, Rs.35,000 | Accept **79.9** | Negotiate **69.2** |
| Chirag Sajnani, Rs.6,000 | Negotiate **69.3** | Reject **40.2** |
| Harjinder Singh Kukreja, Rs.20,000 | Negotiate **65.2** | Reject **37.2** |

This is not noise — it is a systematic shift, and **nothing in the sample now scores Accept**.
Two things follow:

1. **The 70/45 thresholds were implicitly tuned against Gemini's more generous scoring.**
   They likely need recalibrating for Groq, or the sample will look like the system rejects
   everything. Do this deliberately with a spread of deals, not by nudging until Bulky passes.
2. **Groq's reasoning is arguably better on at least one case.** On Chirag it scored
   negotiation 20 (vs Gemini's 100) because it noticed the Rs.6,000 offer sits far below the
   brand's Rs.25,000 minimum — the exact self-contradiction Gemini produced ("falls
   significantly below the brand's minimum ... no negotiation needed"). Harsher here means
   more correct.

Also worth reporting the numeric score next to every verdict: Bulky at 69.2 is 0.8 off a
different answer, and the verdict alone hides how close the call was.

`demo_fixtures.json` now holds Groq recordings (each tagged with `recorded_provider`,
`recorded_model`, `recorded_at`). Regenerate any time with `demo.py --record`.

## Demoing

- `python demo.py` streams the graph agent-by-agent with scores, reasoning, per-agent
  timings, and the Supervisor's weighted arithmetic shown as a table. ASCII-only output
  so it renders correctly in cmd/PowerShell.
- `python demo.py --offline` replays a recorded real run from `demo_fixtures.json` —
  no API calls, no quota, no network, no DB. **Use this for the actual presentation**;
  a live run can die on quota or wifi.
- `python demo.py "Name" AMOUNT --model gemini-3.1-flash-lite` runs live against a
  model with separate quota. `--provider grok` switches provider for one run;
  `--concurrency 2` throttles the fan-out to stay under Gemini's 5 RPM.
- Recorded runs available offline: `Bulky 35000`, `Chirag Sajnani 6000`,
  `Harjinder Singh Kukreja 20000` — all on Groq `gpt-oss-120b`.
- `python demo.py "Name" AMOUNT --record` runs live and saves the result into
  `demo_fixtures.json` for later `--offline` replay. Re-record after changing
  prompts, weights, thresholds, or provider.

## Immediate next steps
1. ~~Run `python main.py "Bulky" 35000`, fix whatever breaks.~~ Done 2026-08-22.
2. ~~Spot-check 2-3 more creators across both platforms.~~ Done — see "Current state".
3. ~~Wire the frontend to the Python engine.~~ Done 2026-08-22 — see the API section.
4. Build Path A (discovery): free-text brand query → embed → pgvector search against `creators.embedding` → return ranked matches.
5. Build budget aggregation function (pure Python, no LLM needed) for multi-creator campaigns.
6. ~~FastAPI layer~~ Done 2026-08-22.
7. FastAPI extras still missing wrapping `main.py`'s logic into `/discover` and `/evaluate` endpoints.
7. ~~React frontend.~~ Added 2026-08-22 (see above).
