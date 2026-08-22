import type { AgentResult } from '../types'

/**
 * Council-split debate view.
 *
 * Renders only when the council actually disagrees. This is the flagship
 * differentiator — disagreement is shown as a transcript rather than averaged
 * into a single number, so the reviewer sees the minority position instead of
 * it being silently outvoted.
 */
export function DebateView({ agents, reason }: { agents: AgentResult[]; reason: string }) {
  const accepts = agents.filter((a) => a.recommendation === 'accept' && a.confidence >= 0.6)
  const rejects = agents.filter((a) => a.recommendation === 'reject' && a.confidence >= 0.6)

  return (
    <section className="mt-8">
      <div className="mb-4 flex items-center gap-2">
        <ChatIcon />
        <h2 className="eyebrow">Agent debate transcripts</h2>
      </div>

      <div className="card mb-5 border-negotiate/30 bg-negotiate-bg p-5">
        <div className="flex items-start gap-3">
          <SplitIcon />
          <div>
            <h3 className="text-sm font-bold uppercase tracking-tight text-negotiate">
              Council split detected
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-ink">{reason}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {[...rejects, ...accepts].map((agent) => (
          <DebateColumn key={agent.id} agent={agent} />
        ))}
      </div>
    </section>
  )
}

function DebateColumn({ agent }: { agent: AgentResult }) {
  const isReject = agent.recommendation === 'reject'
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-line p-5">
        <div>
          <h3 className="text-lg font-bold uppercase tracking-tight">{agent.label}</h3>
          <div
            className={`mt-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${
              isReject ? 'text-reject' : 'text-accept'
            }`}
          >
            {isReject ? <CrossIcon /> : <TickIcon />}
            Recommendation: {agent.recommendation}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-4xl font-bold leading-none tracking-tight">
            {Math.round(agent.confidence * 100)}%
          </div>
          <div className="eyebrow mt-1">Confidence</div>
        </div>
      </div>

      <div className="space-y-0.5 p-4">
        {agent.trace.map((line, i) => (
          <div
            key={i}
            className={`trace-line flex gap-3 rounded-md px-2.5 py-2 text-xs leading-relaxed ${
              line.tone === 'alert'
                ? 'bg-reject-bg text-reject'
                : line.tone === 'signal'
                  ? 'bg-accept-bg text-accept'
                  : ''
            }`}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <span className="mono shrink-0 text-ink-faint">{line.t}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>

      <div className="border-t-2 border-ink px-5 py-4">
        <div className="mono text-[11px] text-ink-faint">FINAL OUTPUT</div>
        <p className="mt-1 text-sm font-semibold leading-snug">{agent.headline}</p>
      </div>
    </div>
  )
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-ink-soft" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v5A1.5 1.5 0 0 1 12.5 11H6l-3 2.5V11h-.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function SplitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="mt-0.5 shrink-0 text-negotiate" aria-hidden="true">
      <path d="M10 3v14M4 7l3-3 3 3M16 13l-3 3-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TickIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
      <path d="m3.8 6.1 1.5 1.5 2.9-2.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
      <path d="m4.3 4.3 3.4 3.4M7.7 4.3 4.3 7.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
