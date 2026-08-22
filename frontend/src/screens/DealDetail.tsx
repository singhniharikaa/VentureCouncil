import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import { AgentCard } from '../components/AgentCard'
import { DebateView } from '../components/DebateView'
import { CompExplorer, VerdictPanel } from '../components/VerdictPanel'
import { Card, EmptyState, PillButton, VerdictBadge } from '../components/ui'

/** Read-only replay of a stored evaluation, rebuilt from the audit record. */
export function DealDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { evaluations } = useStore()
  const deal = evaluations.find((e) => e.id === id)

  if (!deal) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Evaluation not found"
          body="This record may have been cleared from local storage."
        />
        <div className="mt-6">
          <PillButton onClick={() => navigate('/')}>Back to dashboard</PillButton>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 text-sm text-ink-soft hover:text-ink"
      >
        ← Back
      </button>

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="eyebrow">Replay · {deal.dealRef}</div>
          <h1 className="display mt-3 text-4xl lg:text-5xl">
            {deal.creatorName}
            <br />× {deal.brandName}
          </h1>
          <p className="mt-4 text-sm text-ink-soft">
            ₹{deal.amountInr.toLocaleString('en-IN')} · {deal.deliverables.length} deliverable(s) ·{' '}
            {new Date(deal.createdAt).toLocaleString()}
          </p>
        </div>
        {deal.verdict && <VerdictBadge verdict={deal.verdict.decision} size="lg" />}
      </div>

      {deal.humanReviewed && (
        <Card className="mt-7 p-5 text-sm">
          <div className="eyebrow mb-1.5">Human review</div>
          {deal.humanOverride ? (
            <p>
              Overridden to <strong className="capitalize">{deal.humanOverride}</strong> by a
              reviewer. The council's own verdict is retained above.
            </p>
          ) : (
            <p>Reviewer confirmed the council verdict.</p>
          )}
          {deal.humanNote && <p className="mt-2 text-ink-soft">“{deal.humanNote}”</p>}
        </Card>
      )}

      {deal.verdict && (
        <div className="mt-7">
          <VerdictPanel verdict={deal.verdict} />
        </div>
      )}

      <section className="mt-9">
        <h2 className="eyebrow mb-4">Agent outputs</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {deal.agents.map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      </section>

      {deal.verdict?.councilSplit && (
        <DebateView agents={deal.agents} reason={deal.verdict.splitReason} />
      )}

      {deal.comps.length > 0 && (
        <section className="mt-9 max-w-md">
          <CompExplorer comps={deal.comps} />
        </section>
      )}
    </div>
  )
}
