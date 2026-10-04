# VentureCouncil

Multi-agent AI system that evaluates creator–brand sponsorship deals for
**Nitrix Talent Media** and returns an auditable **Accept / Negotiate / Reject**
verdict.

Five specialist agents assess a proposed deal **in parallel**, then a
rule-constrained Supervisor consolidates their findings. Comparable past deals
are retrieved by vector similarity search, so pricing is argued against real
precedent rather than model intuition.

College mini-project — AI & Data Science.

**What makes it different:** most influencer tools answer *"who should we hire?"*.
VentureCouncil answers *"should we sign this specific offer?"* — with a score, a
plain-English reason, and contract protection the AI cannot talk its way around.

---

## Architecture

```
                        ┌─ Audience Fit ─┐
  deal + creator ──────▶├─ Engagement ───┤──▶ gate ──▶ Negotiation ──▶ Supervisor ──▶ verdict
  (Supabase)            ├─ Pricing ──────┤                                 │
                        └─ Risk ─────────┘                          weighted score
                                                                  + hard policy rule
```

- The four upstream agents run **concurrently** (LangGraph fan-out).
- **Negotiation is gated** — it cannot start until all four have reported,
  because it reasons over their findings rather than re-deriving them.
- The **Supervisor** is not an LLM. It applies fixed weights
  (pricing 0.35, audience 0.30, engagement 0.25, negotiation 0.10) and
  thresholds (**≥50 Accept, ≥45 Negotiate**, else Reject) — calibrated against
  11 labelled deals, see `tools/calibrate_thresholds.py`.
- **Risk is not weighted** — it acts as a veto. "High risk" floors the verdict
  at Negotiate and can never produce an Accept. That rule is deterministic
  Python, not model discretion, which is what makes the verdict defensible.
- **Every verdict is explained in plain English.** A "Why this verdict" card gives the
  brand the reason, the main concern and what to do next. The headline is built in code from
  the decision and the AI is told the decision is final, so the explanation can never overturn
  it; if the AI's text recommends the opposite, or the call fails, a template built from the
  findings is used instead.
- **Contract clauses are checked by fixed rules, not just the AI.** A fair deal
  with a contract demanding perpetual usage rights or unpaid exclusivity was once
  rated only "medium risk" by the model and Accepted. Now a critical clause forces
  "high risk", so the veto fires: the same deal goes ACCEPT → NEGOTIATE.

### Two ways in, one evaluation

| Path | Starting point | Flow |
|---|---|---|
| **A — Discovery** | A free-text brief and a budget | pgvector search → ranked creators → tick up to 5 → evaluate |
| **B — Direct** | A creator and an offer (optionally a contract) | evaluate straight away |

Both end in the same five-agent evaluation.

| Layer | What |
|---|---|
| Engine | Python · LangGraph · 5 agents + Supervisor |
| LLM | Groq `openai/gpt-oss-120b` (pluggable: Groq / Gemini / xAI) |
| Data | Supabase (Postgres + pgvector) — 649 creators, 18 brands, 52 past deals |
| Embeddings | `sentence-transformers` all-MiniLM-L6-v2, 384-dim, local and free |
| API | FastAPI — `/health` `/creators` `/brands` `/discover` `/evaluate` `/campaign` |
| Frontend | React 19 · Vite · Tailwind 4 · React Router · Recharts |

---

## Quickstart

### Prerequisites

| | Built and verified against |
|---|---|
| Python | 3.13.7 (3.10+ works) |
| Node.js | 22.13.1 (20+ works) |

### 1. Clone and configure

```bash
git clone https://github.com/singhniharikaa/VentureCouncil.git
cd VentureCouncil
```

Copy `.env.example` to `.env` and fill in three values:

```
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
SUPABASE_CONN_STRING=postgresql://postgres.<ref>:<password>@...pooler.supabase.com:6543/postgres
```

- **Groq key** — free, no card, at [console.groq.com/keys](https://console.groq.com/keys).
  The free tier is 1,000 requests/day **per key**, so everyone on the team should
  create their own rather than sharing one.
- **Supabase string** — ask a teammate; it is not in the repo and never should be.
  Use the **Transaction pooler (port 6543)** string, not the direct connection —
  the vector search depends on it (see *Known gotchas* in `CLAUDE.md`).

Nothing starts without these. `app/config.py` fails loudly rather than silently
falling back.

### 2. Install

```bash
pip install -r requirements.txt
npm install --prefix frontend
```

> `sentence-transformers` pulls torch (~2 GB) — this is the slow step. On the
> first run it also downloads the embedding model (~90 MB) once, then caches it.

### 3. Run

**Easiest:** double-click `start_demo.bat`. It starts the engine and the website, waits
until the engine answers, and opens the browser. Or by hand, in two terminals that both
stay open:

```bash
python -m uvicorn api.server:app --reload --port 8000
```

```bash
npm run dev --prefix frontend
```

Open **http://localhost:5174**. Vite proxies `/api` to port 8000, so there is no
CORS configuration to do.

### 4. Verify

```bash
curl http://127.0.0.1:8000/api/health
# {"ok":true,"creators":649,"provider":"groq","model":"openai/gpt-oss-120b"}
```

In the browser the sidebar should read **“Engine: groq”** and the roster should
show **649 creators**.

---

## Live engine vs offline fallback — read this

The frontend ships with a second, **rule-based** council in
`frontend/src/lib/council.ts`. It runs entirely in the browser, contains **no
LLM at all**, and reads a bundled 282-row YouTube-only CSV snapshot. It exists
only so the UI still works with the backend down.

The app always tells you which one produced a verdict:

| Banner | Meaning |
|---|---|
| 🟢 **Live engine** | Five LLM agents, 649 Supabase creators, pgvector comparables |
| 🟠 **Offline mode — no AI model was used** | Local arithmetic over the stale CSV |

History records `engine` and `model` per evaluation for the same reason. **The
two are not comparable.** If the banner is amber, you are not looking at the AI
system — start the API.

---

## Command line

```bash
python main.py "Bulky" 35000          # evaluate one creator, print the verdict
python demo.py                         # streamed walkthrough, agent by agent
python demo.py --offline               # replay a recorded run: no API, no network
python demo.py "Bulky" 35000 --record  # run live and save as a replay fixture
```

`demo.py` shows each agent as it reports — score, confidence, reasoning,
measured latency — then the Supervisor's weighted arithmetic as a table. Use
`--offline` for presentations; a live run can die on quota or wifi.

---

## Project layout

```
app/          engine: agents, LangGraph wiring, supervisor, LLM layer
  agents/     audience_fit · engagement · pricing · risk · negotiation
  supervisor.py weighted score, thresholds, high-risk veto (no LLM)
  contract.py fixed-rule contract clause checks
  narrative.py  "Why this verdict" explanation (AI text, template fallback)
  campaign.py   multi-creator budget arithmetic + budget-fit suggestion
  discovery.py  Path A: filtered pgvector search over the roster
  graph.py    fan-out / gate / fan-in wiring
  llm.py      provider-agnostic LLM calls, concurrency cap, 429 backoff
  config.py   Supabase connection, embeddings, secrets from .env
api/          FastAPI: /health /creators /brands /discover /evaluate /campaign
  adapter.py  engine output -> frontend contract
frontend/     React app (see frontend/README.md)
  screens/    Dashboard · Discover · NewEvaluation · DealRoom · DealDetail ·
              Campaign · Creators · AgentTraces · AuditLog
tools/        calibrate_thresholds.py + calibration.json (threshold evidence)
tests/        249 tests, no DB / key / network needed
main.py       CLI entry point
demo.py       presentation walkthrough (+ demo_fixtures.json for --offline)
start_demo.bat  one-click launcher for the engine and website
CLAUDE.md     design decisions and hard-won gotchas — read before changing things
```

---

## Rate limits

One evaluation = **5 LLM calls**, four of them concurrent.

| Provider | Per minute | Per day |
|---|---|---|
| **Groq** `gpt-oss-120b` (pinned) | 8,000 tokens | 1,000 requests ≈ 200 evaluations |
| Gemini free, flash | 5 requests | 20 requests ≈ 4 evaluations |

`app/llm.py` caps concurrency (`LLM_MAX_CONCURRENCY`, default 4) and retries on
429 with backoff. Without that, one rate-limited agent killed the whole run.

---

## Tests

```bash
python -m pytest
```

249 tests, ~30 seconds, and they need **no database, no API key and no network** —
everything worth protecting in this system is pure logic:

| File | What it pins down |
|---|---|
| `test_supervisor.py` | weighted scoring, the 50/45 bands and boundaries, the high-risk veto |
| `test_adapter.py` | the engine→frontend contract; "we don't know" survives translation |
| `test_llm.py`, `test_llm_resilience.py` | rate-limit detection, backoff, JSON parsing, spent daily quota |
| `test_graph.py` | fan-out/gate/fan-in topology — every node runs exactly once |
| `test_contract.py` | fixed contract rules: a critical clause forces "high risk" |
| `test_campaign.py` | budget arithmetic and multi-creator orchestration |
| `test_discovery.py`, `test_engagement.py` | vector-search gotchas; zero engagement = "not measured" |
| `test_narrative.py` | the "Why this verdict" text can never overturn the decision |

`test_graph.py` is the regression test for CLAUDE.md gotcha #1. It was verified
by reintroducing the bug: the Supervisor then runs twice and the test fails.

## Path A — discovery

A brand describes what it wants in free text and gets ranked creator
candidates, with **no LLM involved** — so exploring the roster is free, and
agent calls are only spent on the shortlist.

```bash
curl -X POST localhost:8000/api/discover -H 'Content-Type: application/json' -d '{
  "brief": "energy drink launch aimed at mobile gaming audiences",
  "platform": "youtube", "niche": "gaming",
  "budgetMax": 50000, "realPriceOnly": true, "minFollowers": 10000, "limit": 5
}'
```

Hard constraints (budget, platform, reach, data quality) filter in SQL; vector
similarity only orders what survives. A creator who matches the brief but costs
triple the budget is not a match. Results carry `cr_<id>` keys that feed
straight into `/api/evaluate`.

Worth knowing: `creators.embedding` was built from a fixed template, not prose,
so the query is rebuilt in that same shape before embedding. Without it a
mobile-gaming brief scored 0.274 and returned *cricket* creators; with it,
0.654 and actual gaming creators. See gotcha 7 in `CLAUDE.md`.

The `/discover` screen drives all of this from the browser: brief, filters, ranked
cards with match strength, and an "Evaluate this deal" button that carries the creator
into the normal intake form.

## Campaigns — several creators, one budget

On `/discover`, either type a **total campaign budget** and get the best-matching set of
creators that fits inside it pre-ticked (best matches first, never over budget), or tick
creators yourself. Either way you can tick up to **five** creators, enter a brand and a total budget, and press
*Evaluate*. Each creator gets the same five-agent evaluation as a single deal (at their own
listed price), two at a time, then the verdicts are added up:

| Verdict | Counted as |
|---|---|
| Accept | **committed** — the brand would sign |
| Negotiate | **tentative** — likely, but the price may move |
| Reject | not counted |

You get a budget bar, a per-creator table with a running total, and a warning if the accepted
deals — or the accepted plus negotiable ones — go over budget. Five creators take roughly
1–2 minutes because the free Groq tier allows about two evaluations a minute. One creator
failing never sinks the rest. `POST /api/campaign` is the API behind it.

## Calibration

Thresholds were fitted on 11 labelled deals (`python tools/calibrate_thresholds.py`):
Accept 52.8–76.8, Negotiate 45.1–46.5, Reject 25.2–43.7, with two clean gaps. 50/45 scores
11/11 where the original 70/45 scored 9/11. **n = 11** — treat it as indicative, not proof.
Groq scores noticeably harsher than Gemini, so every reported number comes from the pinned
provider. Always read the numeric score next to the verdict word.

## Roadmap

Ideas discussed but **not built**:

- **Live YouTube refresh** — the YouTube Data API (10,000 free units/day) can refresh
  subscribers and recent-video engagement for the 274 YouTube creators. Instagram has no
  equivalent free API. Would run as a separate refresh job, keeping evaluations free of
  live external calls.
- **Cost tracking** — a per-call `llm_usage` table (tokens, cost, latency, retries) with
  budget limits, so cost per evaluation is measured rather than estimated.
- **Outcome logging** — record what brands accepted and actually paid, to build a real-deal dataset.

## Known limitations

- `data_confidence_score` is stored and over-credits creators whose
  engagement rate is recorded as zero; correcting it needs a reseed.
- Agent Traces and Audit Log read `localStorage`, so they only show runs from
  one browser.

---

## Team

Niharika Singh · Shubham Singh · Tushar Singh · Akash Warde
Guided by Prof. Megha Jain.
