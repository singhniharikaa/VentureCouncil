# VentureCouncil

Multi-agent AI system that evaluates creator–brand sponsorship deals for
**Nitrix Talent Media** and returns an auditable **Accept / Negotiate / Reject**
verdict.

Five specialist agents assess a proposed deal **in parallel**, then a
rule-constrained Supervisor consolidates their findings. Comparable past deals
are retrieved by vector similarity search, so pricing is argued against real
precedent rather than model intuition.

College mini-project — AI & Data Science.

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
  thresholds (≥70 Accept, ≥45 Negotiate, else Reject).
- **Risk is not weighted** — it acts as a veto. "High risk" floors the verdict
  at Negotiate and can never produce an Accept. That rule is deterministic
  Python, not model discretion, which is what makes the verdict defensible.

| Layer | What |
|---|---|
| Engine | Python · LangGraph · 5 agents + Supervisor |
| LLM | Groq `openai/gpt-oss-120b` (pluggable: Groq / Gemini / xAI) |
| Data | Supabase (Postgres + pgvector) — 775 creators, 18 brands, 61 past deals |
| Embeddings | `sentence-transformers` all-MiniLM-L6-v2, 384-dim, local and free |
| API | FastAPI |
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

### 3. Run — two terminals, both must stay open

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
# {"ok":true,"creators":775,"provider":"groq","model":"openai/gpt-oss-120b"}
```

In the browser the sidebar should read **“Engine: groq”** and the roster should
show **775 creators**.

---

## Live engine vs offline fallback — read this

The frontend ships with a second, **rule-based** council in
`frontend/src/lib/council.ts`. It runs entirely in the browser, contains **no
LLM at all**, and reads a bundled 282-row YouTube-only CSV snapshot. It exists
only so the UI still works with the backend down.

The app always tells you which one produced a verdict:

| Banner | Meaning |
|---|---|
| 🟢 **Live engine** | Five LLM agents, 775 Supabase creators, pgvector comparables |
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
  discovery.py  Path A: filtered pgvector search over the roster
  graph.py    fan-out / gate / fan-in wiring
  llm.py      provider-agnostic LLM calls, concurrency cap, 429 backoff
  config.py   Supabase connection, embeddings, secrets from .env
api/          FastAPI: /health /creators /brands /discover /evaluate
  adapter.py  engine output -> frontend contract
frontend/     React app (see frontend/README.md)
main.py       CLI entry point
demo.py       presentation walkthrough
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

85 tests, ~40 seconds, and they need **no database, no API key and no network** —
everything worth protecting in this system is pure logic:

| File | What it pins down |
|---|---|
| `test_supervisor.py` | weighted scoring, the 70/45 bands, and the high-risk veto |
| `test_adapter.py` | the engine→frontend contract; "we don't know" survives translation |
| `test_llm.py` | rate-limit detection across provider shapes, backoff, JSON parsing |
| `test_graph.py` | fan-out/gate/fan-in topology — every node runs exactly once |

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

## Not built yet

- **Discovery UI** — the engine and API exist; there is no screen for it yet.
- **Multi-creator campaigns** and budget aggregation.
- Verdict thresholds are still tuned against an earlier model and need
  recalibrating for Groq.

---

## Team

Niharika Singh · Shubham Singh · Tushar Singh · Akash Warde
Guided by Prof. Megha Jain.
