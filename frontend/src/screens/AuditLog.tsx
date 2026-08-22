import { useState } from 'react'
import { useStore } from '../lib/store'
import { Card, EmptyState, PillButton, VerdictBadge } from '../components/ui'

/**
 * Raw agent I/O per evaluation, timestamped. This is the observability surface —
 * everything an auditor would need to reconstruct why a verdict was reached.
 */
export function AuditLog() {
  const { evaluations } = useStore()
  const [openId, setOpenId] = useState<string | null>(evaluations[0]?.id ?? null)

  function exportJson(id: string) {
    const record = evaluations.find((e) => e.id === id)
    if (!record) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `${record.dealRef.replace('#', '')}-audit.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (evaluations.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="display text-5xl">Audit Logs</h1>
        <div className="mt-8">
          <EmptyState
            title="No records yet"
            body="Each council run writes a full, timestamped record of every agent input and output here."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="display text-5xl">Audit Logs</h1>
      <p className="mt-4 max-w-xl text-sm text-ink-soft">
        Raw agent input and output per evaluation, timestamped. Exportable for legal or dispute
        reference.
      </p>

      <div className="mt-8 space-y-4">
        {evaluations.map((e) => {
          const open = openId === e.id
          return (
            <Card key={e.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : e.id)}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-4 p-5 text-left"
              >
                <div className="min-w-0">
                  <div className="mono text-xs text-ink-faint">{e.dealRef}</div>
                  <div className="mt-1 truncate font-semibold">
                    {e.creatorName} × {e.brandName}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-soft">
                    {new Date(e.createdAt).toLocaleString()} · ₹
                    {e.amountInr.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {e.verdict && <VerdictBadge verdict={e.verdict.decision} />}
                  <span className="text-xs text-ink-soft">{open ? 'Hide' : 'Open'}</span>
                </div>
              </button>

              {open && (
                <div className="border-t border-line bg-paper p-5">
                  {e.verdict?.override.fired && (
                    <div className="mb-4 rounded-xl border border-reject/30 bg-reject-bg px-4 py-3 text-xs">
                      <span className="mono font-semibold text-reject">
                        {e.verdict.override.rule}
                      </span>
                      <p className="mt-1 text-ink">{e.verdict.override.reason}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    {e.agents.map((a) => (
                      <div key={a.id} className="rounded-xl border border-line bg-surface p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-bold uppercase tracking-tight">
                            {a.label}
                          </span>
                          <span className="mono text-[11px] text-ink-faint">
                            {a.model} · {a.latencyMs}ms · conf{' '}
                            {Math.round(a.confidence * 100)}%
                          </span>
                        </div>

                        <div className="scroll-slim mt-3 max-h-40 space-y-0.5 overflow-y-auto">
                          {a.trace.map((l, i) => (
                            <div key={i} className="flex gap-3 text-[11px]">
                              <span className="mono shrink-0 text-ink-faint">{l.t}</span>
                              <span
                                className={
                                  l.tone === 'alert'
                                    ? 'text-reject'
                                    : l.tone === 'signal'
                                      ? 'text-accept'
                                      : 'text-ink-soft'
                                }
                              >
                                {l.text}
                              </span>
                            </div>
                          ))}
                        </div>

                        <pre className="mono scroll-slim mt-3 max-h-40 overflow-auto rounded-lg bg-paper p-3 text-[11px] leading-relaxed">
                          {JSON.stringify(a.typed, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5">
                    <PillButton variant="outline" onClick={() => exportJson(e.id)}>
                      Export JSON
                    </PillButton>
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
