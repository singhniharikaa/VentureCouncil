import { useState } from 'react'
import type { AgentResult } from '../types'

const REC_STYLE: Record<string, string> = {
  accept: 'text-accept',
  negotiate: 'text-negotiate',
  reject: 'text-reject',
}

export function AgentCard({ agent }: { agent: AgentResult }) {
  const [open, setOpen] = useState(false)
  const locked = agent.status === 'pending'
  const running = agent.status === 'running'

  return (
    <div
      className={`card overflow-hidden transition ${locked ? 'opacity-55' : ''}`}
      aria-busy={running}
    >
      <div className="flex items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-bold uppercase tracking-tight">{agent.label}</h3>
            {locked && <LockIcon />}
          </div>

          <div className="mt-1.5 text-xs">
            {locked ? (
              <span className="text-ink-faint">Gated — waits for the other four</span>
            ) : running ? (
              <span className="flex items-center gap-2 text-ink-soft">
                <Spinner />
                Running…
              </span>
            ) : (
              <span className={`font-semibold uppercase tracking-wider ${REC_STYLE[agent.recommendation]}`}>
                Recommends: {agent.recommendation}
              </span>
            )}
          </div>

          {agent.status === 'done' && (
            <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">{agent.headline}</p>
          )}
        </div>

        {agent.status === 'done' && (
          <div className="shrink-0 text-right">
            <div className="text-3xl font-bold leading-none tracking-tight">
              {Math.round(agent.confidence * 100)}%
            </div>
            <div className="eyebrow mt-1">Confidence</div>
          </div>
        )}
      </div>

      {agent.status === 'done' && (
        <>
          {agent.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-5 pb-4">
              {agent.flags.slice(0, 3).map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] text-ink-soft"
                >
                  {f}
                </span>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-full items-center justify-between border-t border-line px-5 py-3 text-xs font-semibold uppercase tracking-wider text-ink-soft transition hover:text-ink"
          >
            {open ? 'Hide reasoning' : 'Show reasoning'}
            <Chevron open={open} />
          </button>

          {open && (
            <div className="border-t border-line bg-paper px-5 py-4">
              <p className="text-sm leading-relaxed">{agent.reasoning}</p>

              {Object.keys(agent.typed).length > 0 && (
                <div className="mt-4">
                  <div className="eyebrow mb-2">Typed output</div>
                  <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                    {Object.entries(agent.typed).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3 border-b border-line py-1">
                        <dt className="mono text-ink-faint">{k}</dt>
                        <dd className="text-right font-medium">
                          {Array.isArray(v) ? v.length || '—' : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              <div className="mt-4">
                <div className="eyebrow mb-2">Execution trace</div>
                <div className="scroll-slim max-h-56 space-y-0.5 overflow-y-auto">
                  {agent.trace.map((line, i) => (
                    <div
                      key={i}
                      className={`trace-line flex gap-3 rounded px-2 py-1.5 text-xs ${
                        line.tone === 'alert'
                          ? 'bg-reject-bg text-reject'
                          : line.tone === 'signal'
                            ? 'bg-accept-bg text-accept'
                            : ''
                      }`}
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <span className="mono shrink-0 text-ink-faint">{line.t}</span>
                      <span>{line.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mono mt-3 text-[11px] text-ink-faint">
                {agent.model} · {agent.latencyMs}ms
              </div>
            </div>
          )}
        </>
      )}

      {running && (
        <div className="h-1 w-full overflow-hidden bg-line">
          <div className="pulse-soft h-full w-1/3 bg-ink" />
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="animate-spin" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.25" />
      <path d="M10.5 6A4.5 4.5 0 0 0 6 1.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-ink-faint" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5.3a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={`transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
