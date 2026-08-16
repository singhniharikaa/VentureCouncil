import type { Comp, Verdict } from '../types'
import { Card, VerdictBadge } from './ui'

const DECISION_COPY: Record<string, string> = {
  accept: 'Accept',
  negotiate: 'Negotiate',
  reject: 'Reject',
}

const TONE: Record<string, string> = {
  accept: 'border-accept/30 bg-accept-bg',
  negotiate: 'border-negotiate/30 bg-negotiate-bg',
  reject: 'border-reject/30 bg-reject-bg',
}

const TEXT: Record<string, string> = {
  accept: 'text-accept',
  negotiate: 'text-negotiate',
  reject: 'text-reject',
}

export function VerdictPanel({ verdict }: { verdict: Verdict }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
      <Card className={`p-7 ${TONE[verdict.decision]}`}>
        <div className="eyebrow">Council verdict</div>
        <div className={`display mt-3 text-6xl ${TEXT[verdict.decision]}`}>
          {DECISION_COPY[verdict.decision]}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink">{verdict.summary}</p>
      </Card>

      <div className="grid gap-5">
        {verdict.override.fired ? (
          <Card className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <ShieldIcon />
              <h3 className="text-base font-bold uppercase tracking-tight">Policy override</h3>
            </div>
            <p className="text-sm leading-relaxed text-ink-soft">
              Triggered by rule{' '}
              <code className="mono rounded bg-paper px-1.5 py-0.5 text-[11px] text-ink">
                {verdict.override.rule}
              </code>
              . {verdict.override.reason}
            </p>
            <p className="mt-3 rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink-soft">
              This is a deterministic policy rule, <strong className="text-ink">not model judgment</strong>.
              The narrative layer cannot argue past it.
            </p>
          </Card>
        ) : (
          <Card className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <ShieldIcon />
              <h3 className="text-base font-bold uppercase tracking-tight">No policy override</h3>
            </div>
            <p className="text-sm leading-relaxed text-ink-soft">
              No hard rule fired. This verdict comes from the weighted council consolidation, within
              the bounds the policy rules allow.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}

export function CompExplorer({ comps, onOpen }: { comps: Comp[]; onOpen?: (c: Comp) => void }) {
  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-2">
        <DbIcon />
        <h3 className="text-base font-bold uppercase tracking-tight">
          Retrieved comps (K={comps.length})
        </h3>
      </div>
      <div className="eyebrow mb-4">Vector distance &lt; 0.15</div>

      <div className="space-y-3">
        {comps.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen?.(c)}
            className="w-full rounded-2xl border border-line bg-paper p-4 text-left transition hover:border-ink"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-semibold">
                {c.creatorName} &amp; {c.brandName}
              </span>
              <VerdictBadge verdict={c.outcome} />
            </div>
            <div className="mt-2 flex items-end justify-between">
              <span className="text-xs text-ink-soft">
                {c.tier} tier / {c.category}
              </span>
              <span className="text-lg font-bold tracking-tight">
                ₹{c.amountInr.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="mono mt-2 border-t border-line pt-2 text-[11px] text-ink-faint">
              dist: {c.distance.toFixed(3)}
            </div>
          </button>
        ))}
      </div>
    </Card>
  )
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2.5 4 4.8v4.4c0 3.4 2.4 6.5 6 8.3 3.6-1.8 6-4.9 6-8.3V4.8L10 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m7.5 10 1.8 1.8 3.4-3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DbIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <ellipse cx="10" cy="5" rx="6" ry="2.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 5v10c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 10c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
