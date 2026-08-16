import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { runCouncil } from '../lib/council'
import type { CouncilProgress } from '../lib/council'
import { useStore } from '../lib/store'
import { AgentCard } from '../components/AgentCard'
import { DebateView } from '../components/DebateView'
import { CompExplorer, VerdictPanel } from '../components/VerdictPanel'
import { Card, EmptyState, PillButton, VerdictBadge } from '../components/ui'
import type { AgentResult, DealInput, Evaluation, Recommendation } from '../types'

export function DealRoom() {
  const location = useLocation()
  const navigate = useNavigate()
  const { creators, saveEvaluation, updateEvaluation, evaluations } = useStore()

  const input = (location.state as { input?: DealInput } | null)?.input
  const [progress, setProgress] = useState<CouncilProgress | null>(null)
  const savedId = useRef<string | null>(null)

  useEffect(() => {
    if (!input) return
    const creator = creators.find((c) => c.id === input.creatorId)
    if (!creator) return

    savedId.current = `ev_${Date.now().toString(36)}`
    const cancel = runCouncil(input, creator, creators, setProgress)
    return cancel
    // Re-running only when the submitted deal changes is intentional; creators
    // updating mid-run should not restart the council.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input])

  // Persist once the run completes so History and Audit Log pick it up.
  useEffect(() => {
    if (!progress?.done || !input || !savedId.current) return
    const creator = creators.find((c) => c.id === input.creatorId)
    if (!creator) return
    const record: Evaluation = {
      id: savedId.current,
      dealRef: `#${savedId.current.slice(-5).toUpperCase()}`,
      createdAt: new Date().toISOString(),
      creatorId: creator.id,
      creatorName: creator.name,
      brandName: input.brandName,
      brandCategory: input.brandCategory,
      amountInr: input.amountInr,
      dealType: input.dealType,
      deliverables: input.deliverables,
      agents: progress.agents,
      verdict: progress.verdict,
      comps: progress.comps,
      humanReviewed: false,
      humanOverride: null,
      humanNote: '',
    }
    saveEvaluation(record)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.done])

  if (!input) {
    const recent = evaluations[0]
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="display text-4xl">Deal Room</h1>
        <p className="mt-3 text-sm text-ink-soft">
          Run an evaluation to open a council session here.
        </p>
        <div className="mt-8">
          {recent ? (
            <Card className="p-6">
              <div className="eyebrow mb-2">Most recent</div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold">
                    {recent.creatorName} × {recent.brandName}
                  </div>
                  <div className="text-sm text-ink-soft">
                    ₹{recent.amountInr.toLocaleString('en-IN')} ·{' '}
                    {new Date(recent.createdAt).toLocaleString()}
                  </div>
                </div>
                {recent.verdict && <VerdictBadge verdict={recent.verdict.decision} size="lg" />}
              </div>
              <div className="mt-5">
                <PillButton variant="outline" onClick={() => navigate(`/deal/${recent.id}`)}>
                  Open full trace
                </PillButton>
              </div>
            </Card>
          ) : (
            <EmptyState
              title="No council sessions yet"
              body="Start a new evaluation to see the five agents run in parallel and reach a verdict."
            />
          )}
        </div>
        <div className="mt-6">
          <PillButton onClick={() => navigate('/evaluate')}>New evaluation</PillButton>
        </div>
      </div>
    )
  }

  const creator = creators.find((c) => c.id === input.creatorId)
  const agents = progress?.agents ?? []
  const verdict = progress?.verdict ?? null
  const doneCount = agents.filter((a) => a.status === 'done').length

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="eyebrow flex items-center gap-2">
            <PulseIcon /> Verdict &amp; agent debate
          </div>
          <h1 className="display mt-3 text-5xl lg:text-6xl">
            {verdict?.councilSplit ? (
              <>
                Cluster
                <br />
                Disagreement
              </>
            ) : (
              <>
                Council
                <br />
                Session
              </>
            )}
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-soft">
            {creator?.name} × {input.brandName} · ₹{input.amountInr.toLocaleString('en-IN')}
            {verdict
              ? verdict.councilSplit
                ? ' — a consensus has not been reached between evaluating agents.'
                : ' — council run complete.'
              : ` — ${doneCount}/5 agents reported.`}
          </p>
        </div>

        {verdict && (
          <div className="flex flex-col items-end gap-3">
            <VerdictBadge verdict={verdict.decision} size="lg" />
            <PillButton onClick={() => navigate(`/deal/${savedId.current}`)}>
              Open full record
            </PillButton>
          </div>
        )}
      </div>

      {verdict && (
        <div className="mt-9">
          <VerdictPanel verdict={verdict} />
        </div>
      )}

      <section className="mt-9">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="eyebrow">Live council trace</h2>
          <span className="mono text-xs text-ink-faint">{doneCount}/5 complete</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      </section>

      {verdict?.councilSplit && <DebateView agents={agents} reason={verdict.splitReason} />}

      {progress && progress.comps.length > 0 && (
        <section className="mt-9 grid gap-5 lg:grid-cols-[1fr_360px]">
          <PricingBasis pricing={agents.find((a) => a.id === 'pricing')} />
          <CompExplorer comps={progress.comps} />
        </section>
      )}

      {verdict && savedId.current && (
        <ReviewBar
          dealId={savedId.current}
          systemVerdict={verdict.decision}
          onSave={(v, note) =>
            updateEvaluation(savedId.current!, {
              humanReviewed: true,
              humanOverride: v,
              humanNote: note,
            })
          }
        />
      )}
    </div>
  )
}

/** Shows whichever basis the Pricing agent actually used — rate card, comps, or neither. */
function PricingBasis({ pricing }: { pricing?: AgentResult }) {
  if (!pricing || pricing.status !== 'done') {
    return (
      <Card className="p-6">
        <h3 className="text-base font-bold uppercase tracking-tight">Pricing basis</h3>
        <p className="mt-2 text-sm text-ink-soft">Waiting for the Pricing agent…</p>
      </Card>
    )
  }

  const rateCard = pricing.typed.rate_card_inr
  const compMedian = pricing.typed.comp_median_inr
  const deviation = pricing.typed.deviation_pct

  const tiles: { label: string; value: string }[] = []
  if (typeof rateCard === 'number') {
    tiles.push({ label: 'Creator rate card', value: `₹${rateCard.toLocaleString('en-IN')}` })
  } else if (typeof compMedian === 'number') {
    tiles.push({ label: 'Comparable median', value: `₹${compMedian.toLocaleString('en-IN')}` })
  }
  if (typeof deviation === 'number') {
    tiles.push({ label: 'Offer deviation', value: `${deviation >= 0 ? '+' : ''}${deviation}%` })
  }
  if (typeof pricing.typed.comps_used === 'number') {
    tiles.push({ label: 'Comps retrieved', value: String(pricing.typed.comps_used) })
  }

  return (
    <Card className="p-6">
      <h3 className="text-base font-bold uppercase tracking-tight">Pricing basis</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        {typeof rateCard === 'number'
          ? "Priced against the creator's own quoted rate — the strongest basis available."
          : pricing.insufficientData
            ? 'No rate card and no comparables. There is no basis to judge this offer.'
            : 'The creator has no rate on file for this deal type, so the offer is judged against comparable creators. Treat this as inferred, not quoted.'}
      </p>
      {tiles.length > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line bg-paper p-4">
              <div className="text-xl font-bold tracking-tight">{t.value}</div>
              <div className="eyebrow mt-1">{t.label}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function ReviewBar({
  systemVerdict,
  onSave,
}: {
  dealId: string
  systemVerdict: Recommendation
  onSave: (v: Recommendation | null, note: string) => void
}) {
  const [choice, setChoice] = useState<Recommendation>(systemVerdict)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const isOverride = choice !== systemVerdict

  if (saved) {
    return (
      <Card className="mt-9 border-accept/30 bg-accept-bg p-5 text-sm">
        <strong>Review recorded.</strong>{' '}
        {isOverride
          ? `Overridden to "${choice}" — the system's "${systemVerdict}" is kept alongside it in the audit log.`
          : `Confirmed the council's "${systemVerdict}" verdict.`}
      </Card>
    )
  }

  return (
    <Card className="mt-9 p-6">
      <h3 className="text-base font-bold uppercase tracking-tight">Human review</h3>
      <p className="mt-1.5 text-sm text-ink-soft">
        Nothing acts on this verdict automatically. Confirm it, or override it and say why — both
        are stored.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {(['accept', 'negotiate', 'reject'] as Recommendation[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setChoice(v)}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium capitalize transition ${
              choice === v ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink'
            }`}
          >
            {v}
            {v === systemVerdict && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                  choice === v ? 'bg-white/20' : 'bg-paper text-ink-faint'
                }`}
              >
                council
              </span>
            )}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder={isOverride ? 'Why are you overriding the council? (recommended)' : 'Optional note'}
        className="mt-4 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-ink"
      />
      <div className="mt-4">
        <PillButton
          onClick={() => {
            onSave(isOverride ? choice : null, note)
            setSaved(true)
          }}
        >
          {isOverride ? 'Record override' : 'Confirm verdict'}
        </PillButton>
      </div>
    </Card>
  )
}

function PulseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1 8h3l2-4 3 8 2-4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
