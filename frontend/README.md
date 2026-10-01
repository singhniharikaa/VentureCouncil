# VentureCouncil — Frontend

Multi-agent business intelligence for creator–brand deal evaluation.

Five specialist agents (Audience Fit, Engagement, Pricing, Risk & Legitimacy, Negotiation)
assess a proposed deal in parallel and report to a rule-constrained Supervisor, which issues
an auditable **Accept / Negotiate / Reject** verdict.

> **This is the frontend only.** For full setup — the Python engine, secrets and
> the two run commands — see the [root README](../README.md).

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:5174.

The UI runs without the backend, but **what it computes is then completely
different**. With the Python engine running on port 8000 (Vite proxies `/api`
to it), verdicts come from five LLM agents over 775 Supabase creators. Without
it, the app falls back to the local rule-based council described below: no
model, 282 YouTube-only creators from a bundled CSV snapshot.

The app states which mode it is in — a green **Live engine** banner or an amber
**Offline mode — no AI model was used** one — and records `engine` and `model`
on every evaluation. Do not remove those: the two modes differ in kind, not
just in quality.

## Screens

| Route | What it does |
|---|---|
| `/` | Dashboard — evaluation history, filter by verdict, click a row to replay |
| `/evaluate` | Structured deal intake with client-side validation |
| `/deal-room` | Live council trace — 5 agent cards populating async, verdict, debate view |
| `/deal/:id` | Read-only replay of a stored evaluation |
| `/creators` | Creator roster — add, edit, delete, CSV import/export |
| `/traces` | Cross-run agent stats — confidence, latency, flag rates |
| `/audit` | Raw timestamped agent I/O per evaluation, exportable as JSON |

## How the offline council works

`src/lib/council.ts` is the **fallback** council — used only when the engine is
unreachable. It is **not random mock data**; every score is computed from the
actual deal input. But it is deterministic arithmetic with no LLM involved, and
its roster is a stale snapshot, so treat its verdicts as a smoke test rather
than a result:

- **Audience Fit** — distance between the creator's demographics and the brand-category ICP.
- **Engagement** — observed engagement rate against the expected band for that follower count.
  A large gap reads as inflation rather than a quiet audience.
- **Pricing** — fair range derived from retrieved comparables, then the offer's deviation from it.
- **Risk & Legitimacy** — clause text matched against a red-flag reference library, plus the
  brand's registration status.
- **Negotiation** — gated until the other four finish; drafts counter-asks from their findings.

### Policy rules

Two deterministic rules sit under the consolidation step and can only make the verdict
*more* cautious:

| Rule | Effect |
|---|---|
| `BRAND_LEGITIMACY_UNVERIFIED` | Hard Reject, no discretion |
| `RISK_SEVERITY_CRITICAL` | Verdict floor of Negotiate |

A rule is reported as **fired** whenever its condition is met, and separately records whether it
*changed* the outcome. Hiding a matched rule just because the council independently agreed would
tell an auditor "no policy concern" about a deal that actually tripped one.

### Council split

When agents disagree — some confidently accepting while others confidently reject — the verdict
renders a debate transcript instead of averaging the disagreement into a single number. This is
the point where a correct minority position would otherwise be silently outvoted.

## CSV import

`/creators` accepts a CSV. Headers are matched case- and space-insensitively with common aliases
(`subscribers` → `followers`, `er` → `engagement_rate`, and so on), and shares accept either
`0–1` or `0–100`. Rows are matched on handle, so re-importing updates rather than duplicates.

Download a template from the Creators screen.

## Talking to the engine

`src/lib/api.ts` is the client for the Python engine:

| | |
|---|---|
| `GET /api/health` | is the engine up, which provider/model is pinned |
| `GET /api/creators` | the full Supabase roster — 775, both platforms |
| `POST /api/evaluate` | runs the real five-agent pipeline |

`src/lib/seed.ts` loads the roster from the engine and falls back to
`public/creators.csv` only if that fails. `src/lib/store.tsx` persists to
`localStorage`, and records which source the cached roster came from so a stale
CSV snapshot gets upgraded once the engine returns.

`DealRoom` calls `/api/evaluate` when the engine is live and `runCouncil` when
it is not.

## Council graph

`components/CouncilGraph.tsx` renders the live topology of a run — four agents
in parallel, the gate holding Negotiation until all four report, then Supervisor
consolidation. Ported from a Claude Design canvas but driven by real agent data.
See `CLAUDE.md` for notes before changing it.

## Stack

React 19 · TypeScript · Tailwind v4 · React Router · Recharts · PapaParse
