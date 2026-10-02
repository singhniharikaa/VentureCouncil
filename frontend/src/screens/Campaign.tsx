/**
 * Campaign - several creators, one total budget.
 *
 * Reached from Discover: the brand ticks up to five creators, sets a total
 * budget, and each creator goes through the same five-agent evaluation as a
 * single deal. The verdicts are then added up against the budget.
 *
 * How the money is counted (arithmetic in app/campaign.py, no AI):
 *   Accept    -> committed   (the brand would sign at this price)
 *   Negotiate -> tentative   (likely to close, but the price may move)
 *   Reject    -> not counted
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { runCampaign, useEngine } from '../lib/api'
import type { CampaignResponse } from '../lib/api'
import { useStore } from '../lib/store'
import { Card, EmptyState, Eyebrow, PillButton, VerdictBadge } from '../components/ui'
import type { Evaluation } from '../types'

export interface CampaignState {
  creators: { creatorId: string; name: string }[]
  brandName: string
  brandCategory: string
  totalBudget?: number
  brief?: string
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

export function Campaign() {
  const navigate = useNavigate()
  const engine = useEngine()
  const { saveEvaluation } = useStore()
  const input = (useLocation().state as CampaignState | null) ?? null

  const [result, setResult] = useState<CampaignResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  // React StrictMode runs effects twice in development. A campaign is ~25 LLM
  // calls, so a duplicate run would silently burn a minute of Groq quota and
  // write every evaluation to history twice. Guard both.
  const started = useRef(false)
  const saved = useRef(false)

  useEffect(() => {
    if (!input || engine.status !== 'live' || started.current) return
    started.current = true
    runCampaign({
      creators: input.creators.map((c) => ({ creatorId: c.creatorId })),
      brandName: input.brandName,
      brandCategory: input.brandCategory,
      totalBudget: input.totalBudget,
    })
      .then(setResult)
      .catch((e) => setError(String((e as Error)?.message ?? e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.status])

  // wall-clock timer while waiting, so the screen visibly shows it is working
  useEffect(() => {
    if (!input || result || error || engine.status !== 'live') return
    const t0 = Date.now()
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500)
    return () => window.clearInterval(id)
  }, [result, error, engine.status, input])

  // Every evaluated creator also goes into history, so Dashboard, Agent Traces
  // and Audit Log fill up and each row can open its full record.
  const [ids, setIds] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!result || !input || saved.current) return
    saved.current = true
    const stamp = Date.now().toString(36)
    const map: Record<string, string> = {}
    result.results.forEach((r, i) => {
      if (r.status !== 'ok' || !r.evaluation) return
      const id = `ev_${stamp}${i}`
      map[r.creatorId] = id
      const record: Evaluation = {
        id,
        dealRef: `#${id.slice(-5).toUpperCase()}`,
        createdAt: new Date().toISOString(),
        creatorId: r.creatorId,
        creatorName: r.name,
        brandName: input.brandName,
        brandCategory: input.brandCategory,
        amountInr: r.offerInr,
        dealType: 'integration',
        deliverables: [],
        engine: 'live',
        model: `${result.meta.provider}/${result.meta.model}`,
        agents: r.evaluation.agents,
        verdict: r.evaluation.verdict,
        narrative: r.evaluation.narrative ?? null,
        comps: r.evaluation.comps,
        humanReviewed: false,
        humanOverride: null,
        humanNote: '',
      }
      saveEvaluation(record)
    })
    setIds(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  if (!input) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="display text-4xl">Campaign</h1>
        <div className="mt-6">
          <EmptyState
            title="No campaign yet"
            body="Search for creators on the Discover screen, tick up to five, set a total budget and press Evaluate."
          />
        </div>
        <div className="mt-6">
          <PillButton onClick={() => navigate('/discover')}>Go to Discover</PillButton>
        </div>
      </div>
    )
  }

  if (engine.status === 'offline') {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="display text-4xl">Campaign</h1>
        <Card className="mt-6 border-reject/30 bg-reject-bg p-5 text-sm">
          <strong>The AI engine is not connected.</strong> A campaign needs the five agents,
          so it can't run in fake mode. Start it with <code className="mono">start_demo.bat</code>.
        </Card>
      </div>
    )
  }

  const n = input.creators.length

  return (
    <div className="mx-auto max-w-[1100px]">
      <Eyebrow>Campaign &middot; {input.brandName}</Eyebrow>
      <h1 className="display mt-3 text-5xl lg:text-6xl">
        Campaign
        <br />
        Result
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-soft">
        {n} creator{n === 1 ? '' : 's'}, each judged separately by five AI agents at their own
        listed price, then added up against
        {input.totalBudget ? ` your ${inr(input.totalBudget)} budget.` : ' the budget.'}
      </p>

      {error && (
        <Card className="mt-6 border-reject/30 bg-reject-bg p-4 text-sm">
          <strong>The campaign failed.</strong> {error}
        </Card>
      )}

      {!result && !error && (
        <Card className="mt-8 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-base font-bold tracking-tight">
                Running {n * 5} agent calls across {n} creator{n === 1 ? '' : 's'}…
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                About one to two minutes. The free AI tier only allows around two
                evaluations a minute, so they are paced rather than rushed.
              </p>
            </div>
            <div className="mono text-2xl tabular-nums">{elapsed}s</div>
          </div>
          <ul className="mt-5 divide-y divide-line">
            {input.creators.map((c) => (
              <li key={c.creatorId} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="pulse-soft text-xs text-ink-faint">being evaluated…</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {result && (
        <>
          <BudgetCard budget={result.budget} />

          <section className="mt-8">
            <h2 className="eyebrow mb-4">Each creator</h2>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      {['Creator', 'Offer', 'Verdict', 'Score', 'Running total', ''].map((h) => (
                        <th key={h} className="eyebrow px-4 py-3 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((r) => {
                      const row = result.budget.rows.find((b) => b.creator_id === r.creatorId)
                      const verdict = r.evaluation?.verdict
                      return (
                        <tr key={r.creatorId} className="border-b border-line last:border-0">
                          <td className="px-4 py-3 font-medium">{r.name}</td>
                          <td className="px-4 py-3">{inr(r.offerInr)}</td>
                          <td className="px-4 py-3">
                            {verdict ? (
                              <VerdictBadge verdict={verdict.decision} />
                            ) : (
                              <span className="text-xs text-reject" title={r.error ?? ''}>
                                failed
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-ink-soft">
                            {verdict?.weightedScore != null ? `${verdict.weightedScore}/100` : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {row?.running_total != null ? (
                              <span className={row.fits_budget === false ? 'text-reject' : ''}>
                                {inr(row.running_total)}
                                {row.fits_budget === false && ' · over'}
                              </span>
                            ) : (
                              <span className="text-xs text-ink-faint">not counted</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {ids[r.creatorId] && (
                              <button
                                type="button"
                                onClick={() => navigate(`/deal/${ids[r.creatorId]}`)}
                                className="text-xs font-semibold text-ink underline-offset-4 hover:underline"
                              >
                                Open full record
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
            <p className="mt-3 text-xs text-ink-faint">
              Running total adds Accept and Negotiate deals in the order shown, so it reads "if
              everything above closes". Rejected deals are never counted.
            </p>
          </section>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PillButton variant="outline" onClick={() => navigate('/discover')}>
              Back to Discover
            </PillButton>
            <span className="mono text-xs text-ink-faint">
              {result.meta.provider}/{result.meta.model} &middot;{' '}
              {Math.round(result.meta.totalMs / 1000)}s
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function BudgetCard({ budget: b }: { budget: CampaignResponse['budget'] }) {
  const total = b.total_budget
  // Bar scale: the budget, or the larger of the totals if the budget is exceeded,
  // so an overspend is visible as a bar that runs past its track.
  const scale = Math.max(total ?? 0, b.if_all_close, 1)
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`

  return (
    <Card className="mt-8 p-6">
      <div className="grid gap-5 sm:grid-cols-3">
        <Stat label="Committed" value={inr(b.committed)} note="Accepted deals" tone="accept" />
        <Stat label="Tentative" value={inr(b.tentative)} note="Negotiate, price may move" tone="negotiate" />
        <Stat
          label="Remaining"
          value={b.remaining != null ? inr(b.remaining) : '—'}
          note={total ? `of ${inr(total)}` : 'no budget set'}
          tone={b.over_budget ? 'reject' : 'plain'}
        />
      </div>

      {total != null && (
        <div className="mt-6">
          <div className="relative h-3 overflow-hidden rounded-full bg-track">
            <div
              className="absolute inset-y-0 left-0 bg-accept"
              style={{ width: pct(b.committed) }}
            />
            <div
              className="absolute inset-y-0 bg-negotiate"
              style={{ left: pct(b.committed), width: pct(b.tentative) }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint">
            <span>₹0</span>
            <span>budget {inr(total)}</span>
          </div>
        </div>
      )}

      {b.over_budget && (
        <p className="mt-4 rounded-lg border border-reject/30 bg-reject-bg px-3 py-2 text-sm text-reject">
          Over budget: the accepted deals alone cost {inr(b.committed)}, which is{' '}
          {inr(b.committed - (total ?? 0))} more than the budget.
        </p>
      )}
      {!b.over_budget && b.tentative_over_budget && (
        <p className="mt-4 rounded-lg border border-negotiate/30 bg-negotiate-bg px-3 py-2 text-sm text-negotiate">
          The accepted deals fit, but if the negotiable ones also close the total reaches{' '}
          {inr(b.if_all_close)}, which is over the {inr(total ?? 0)} budget.
        </p>
      )}
      <p className="mt-4 text-xs text-ink-faint">
        {b.counts.accept ?? 0} accepted &middot; {b.counts.negotiate ?? 0} to negotiate &middot;{' '}
        {b.counts.reject ?? 0} rejected
        {(b.counts.error ?? 0) > 0 && ` · ${b.counts.error} failed`}
      </p>
    </Card>
  )
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: string
  tone: 'accept' | 'negotiate' | 'reject' | 'plain'
}) {
  const color =
    tone === 'accept'
      ? 'text-accept'
      : tone === 'negotiate'
        ? 'text-negotiate'
        : tone === 'reject'
          ? 'text-reject'
          : 'text-ink'
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <div className={`text-2xl font-bold tracking-tight ${color}`}>{value}</div>
      <div className="eyebrow mt-1">{label}</div>
      <div className="mt-0.5 text-xs text-ink-faint">{note}</div>
    </div>
  )
}
