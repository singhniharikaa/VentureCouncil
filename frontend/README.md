# VentureCouncil — Frontend

Multi-agent business intelligence for creator–brand deal evaluation.

Five specialist agents (Audience Fit, Engagement, Pricing, Risk & Legitimacy, Negotiation)
assess a proposed deal in parallel and report to a rule-constrained Supervisor, which issues
an auditable **Accept / Negotiate / Reject** verdict.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:5174.

No backend or API key is needed — the council runs locally in the browser.

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

## How the council works

`src/lib/council.ts` holds the decision logic. It is **not random mock data** — every score is
computed from the actual deal input, so a bad deal looks bad for the same reason it will in
production:

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

## Stack

React 19 · TypeScript · Tailwind v4 · React Router · Recharts · PapaParse

State persists to `localStorage`. `src/lib/store.tsx` is the seam where the Postgres/Supabase
backend will plug in — every mutation maps one-to-one onto a REST call, so swapping the storage
layer touches no component.

## Backend status

The council currently runs client-side. Wiring a backend means replacing `runCouncil` in
`src/lib/council.ts` with an SSE stream that emits the same `AgentResult` shape — the components
already render progressively, so nothing else changes.

For the LLM layer, Groq (`llama-3.3-70b`) and Gemini both have free tiers that suit this
workload; the agent prompts and the typed output contracts are provider-independent.
