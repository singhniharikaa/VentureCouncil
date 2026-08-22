/**
 * Council graph — the live topology of a council run.
 *
 * Ported from the "Deal Room Live" Claude Design canvas. The canvas version
 * animated a scripted timeline; this one is driven by the real council, so
 * every node state, chip, confidence and receipt comes from actual
 * `AgentResult` data rather than a hardcoded sequence.
 *
 * What it shows that a grid of cards cannot: the *shape* of the run — four
 * agents genuinely in parallel, a gate that holds Negotiation back until all
 * four have reported, and a Supervisor that consolidates only at the end.
 */
import { useEffect, useRef, useState } from 'react'
import type { AgentId, AgentResult, Recommendation, Verdict } from '../types'

/* Geometry is fixed: the graph is a 960x520 diagram that scrolls horizontally
   on narrow screens rather than reflowing into something unreadable. */
const W = 960
const H = 520

const IN_PATHS: Record<string, string> = {
  audience_fit: 'M150,260 C185,260 175,84 210,84',
  engagement: 'M150,260 C185,260 175,204 210,204',
  pricing: 'M150,260 C185,260 175,324 210,324',
  risk: 'M150,260 C185,260 175,444 210,444',
}
const SUP_PATHS: Record<string, string> = {
  audience_fit: 'M440,84 C600,30 740,20 840,216',
  engagement: 'M440,204 C580,140 720,100 840,238',
  pricing: 'M440,324 C580,380 720,420 840,282',
  risk: 'M440,444 C600,490 740,500 840,304',
}
const GATE_PATHS: Record<string, string> = {
  audience_fit: 'M440,84 C475,84 465,260 500,260',
  engagement: 'M440,204 C475,204 465,260 500,260',
  pricing: 'M440,324 C475,324 465,260 500,260',
  risk: 'M440,444 C475,444 465,260 500,260',
}
const GATE_OUT = 'M564,260 L604,260'
const NEGO_OUT = 'M794,260 L840,260'

const STATIC_EDGES = [
  ...Object.values(IN_PATHS),
  ...Object.values(GATE_PATHS),
  GATE_OUT,
  NEGO_OUT,
  ...Object.values(SUP_PATHS),
]

const UPSTREAM: AgentId[] = ['audience_fit', 'engagement', 'pricing', 'risk']
const TOPS: Record<string, number> = {
  audience_fit: 40,
  engagement: 160,
  pricing: 280,
  risk: 400,
}

const REC_COLOR: Record<Recommendation, string> = {
  accept: 'var(--color-accept)',
  negotiate: 'var(--color-negotiate)',
  reject: 'var(--color-reject)',
}

const PACKET_MS = 1000

type Packet = { key: string; path: string; label: string }

/** A short, human-readable chip for the payload travelling to the Supervisor. */
function chipFor(a: AgentResult): string {
  const t = a.typed
  const n = (v: unknown) => (typeof v === 'number' ? v : null)

  const fit = n(t.fit_score)
  if (a.id === 'audience_fit' && fit !== null) return `fit ${fit}`

  const vtr = n(t.view_through_rate ?? t.vtr)
  if (a.id === 'engagement' && vtr !== null) {
    return `vtr ${vtr <= 1 ? (vtr * 100).toFixed(1) : vtr.toFixed(1)}%`
  }

  const dev = n(t.deviation_pct)
  if (a.id === 'pricing' && dev !== null) return `dev ${dev >= 0 ? '+' : ''}${dev}%`

  if (a.id === 'risk' && typeof t.severity === 'string') return `sev ${t.severity}`
  if (a.id === 'negotiation') return 'counter-ask'

  return a.insufficientData ? 'insufficient data' : `score ${a.score}`
}

/** Compact one-line rendering of the agent's typed output, for the receipt log. */
function payloadFor(a: AgentResult): string {
  const parts = Object.entries(a.typed)
    .filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .slice(0, 3)
    .map(([k, v]) => `${k}:${Array.isArray(v) ? `[${v.length}]` : JSON.stringify(v)}`)
  const body = parts.length ? `{${parts.join(', ')}}` : '{}'
  return `${body} · conf ${a.confidence.toFixed(2)} · ${a.latencyMs}ms · council-local`
}

export function CouncilGraph({
  agents,
  verdict,
  amountInr,
  onReplay,
}: {
  agents: AgentResult[]
  verdict: Verdict | null
  amountInr: number
  onReplay?: () => void
}) {
  const byId = (id: AgentId) => agents.find((a) => a.id === id)
  const upstream = UPSTREAM.map(byId).filter(Boolean) as AgentResult[]
  const nego = byId('negotiation')

  const doneUpstream = upstream.filter((a) => a.status === 'done').length
  const gateOpen = doneUpstream === UPSTREAM.length && upstream.length === UPSTREAM.length
  const doneCount = agents.filter((a) => a.status === 'done').length
  const started = agents.length > 0

  /* ---- packets ------------------------------------------------------- */
  const [packets, setPackets] = useState<Packet[]>([])
  const seen = useRef<Set<string>>(new Set())
  const timers = useRef<number[]>([])

  const emit = (key: string, path: string, label: string) => {
    if (seen.current.has(key)) return
    seen.current.add(key)
    setPackets((p) => [...p, { key, path, label }])
    timers.current.push(
      window.setTimeout(
        () => setPackets((p) => p.filter((x) => x.key !== key)),
        PACKET_MS,
      ),
    )
  }

  // Dispatch from intake the moment the run starts.
  useEffect(() => {
    if (!started) return
    UPSTREAM.forEach((id) => emit(`in-${id}`, IN_PATHS[id], 'deal payload'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started])

  // Each agent fires a packet to the Supervisor as it reports.
  useEffect(() => {
    upstream.forEach((a) => {
      if (a.status === 'done') emit(`sup-${a.id}`, SUP_PATHS[a.id], chipFor(a))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstream.map((a) => a.status).join(',')])

  // Gate release: the findings bundle crosses into Negotiation.
  useEffect(() => {
    if (!gateOpen) return
    UPSTREAM.forEach((id) => {
      const a = byId(id)
      if (a) emit(`gate-${id}`, GATE_PATHS[id], chipFor(a))
    })
    emit('gate-out', GATE_OUT, 'findings bundle')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateOpen])

  useEffect(() => {
    if (nego?.status === 'done') emit('nego-out', NEGO_OUT, 'counter-ask')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nego?.status])

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  /* ---- clock ---------------------------------------------------------
     Driven off wall-clock timestamps on an interval, deliberately NOT
     requestAnimationFrame: rAF does not fire while the document is hidden, so
     a backgrounded tab would freeze the clock mid-run and then jump. An
     interval keeps ticking (throttled) and, because elapsed is derived from
     the start timestamp rather than accumulated, it stays correct either way. */
  const [elapsed, setElapsed] = useState(0)
  const origin = useRef<number>(Date.now())
  useEffect(() => {
    if (verdict) {
      setElapsed(Date.now() - origin.current) // freeze on the exact finish time
      return
    }
    const id = window.setInterval(() => setElapsed(Date.now() - origin.current), 100)
    return () => window.clearInterval(id)
  }, [verdict])

  /* ---- receipts ------------------------------------------------------ */
  const receipts: { key: string; t: string; route: string; color: string; payload: string }[] = []
  const stamp = (a: AgentResult) =>
    a.trace.length ? a.trace[a.trace.length - 1].t : `+${a.latencyMs}ms`

  agents
    .filter((a) => a.status === 'done')
    .forEach((a) =>
      receipts.push({
        key: `r-${a.id}`,
        t: stamp(a),
        route: `${a.id.toUpperCase().replace('_', ' ')} → SUPERVISOR`,
        color: REC_COLOR[a.recommendation],
        payload: payloadFor(a),
      }),
    )
  if (gateOpen) {
    receipts.push({
      key: 'r-gate',
      t: '—',
      route: 'GATE ↳ NEGOTIATION unlocked',
      color: 'var(--color-ink)',
      payload: `${UPSTREAM.length}/${UPSTREAM.length} upstream agents reported · findings bundle handed over`,
    })
  }
  if (verdict) {
    receipts.push({
      key: 'r-verdict',
      t: '—',
      route: 'SUPERVISOR ⇒ VERDICT',
      color: REC_COLOR[verdict.decision],
      payload: `consolidated ${doneCount} findings · policy rules checked, ${
        verdict.override.fired ? `"${verdict.override.rule}" fired` : 'none fired'
      } · decision "${verdict.decision}"`,
    })
  }
  receipts.reverse()

  const supState = verdict
    ? { bg: 'var(--color-negotiate-bg)', fg: REC_COLOR[verdict.decision], border: 'var(--color-line-strong)', status: `verdict: ${verdict.decision}`, halo: false }
    : started
      ? { bg: 'var(--color-ink)', fg: '#fff', border: 'var(--color-ink)', status: `receiving ${doneCount}/5`, halo: true }
      : { bg: 'var(--color-paper)', fg: 'var(--color-ink-faint)', border: 'var(--color-line-strong)', status: 'idle', halo: false }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="card relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
          <div className="eyebrow text-ink-faint">
            Council graph — parallel assess → gate → counter-draft → consolidation
          </div>
          <div className="flex items-center gap-3">
            <span className="mono text-lg tabular-nums">
              <span className="eyebrow mr-1.5 text-ink-faint">t+</span>
              {(elapsed / 1000).toFixed(1)}s
            </span>
            {onReplay && (
              <button
                type="button"
                onClick={() => {
                  seen.current.clear()
                  setPackets([])
                  origin.current = Date.now()
                  onReplay()
                }}
                className="rounded-full border border-line-strong bg-surface px-4 py-2 text-xs font-semibold transition hover:border-ink"
              >
                Replay run
              </button>
            )}
            <span className="mono rounded-full border border-line bg-surface px-3 py-2 text-[11px] text-ink-soft">
              {doneCount}/5 reported
            </span>
          </div>
        </div>

        <div className="scroll-slim overflow-x-auto px-6 pb-6 pt-4">
          <div className="relative" style={{ width: W, height: H }}>
            <svg
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              className="absolute inset-0 overflow-visible"
              aria-hidden="true"
            >
              <g fill="none" stroke="var(--color-line)" strokeWidth="1.5">
                {STATIC_EDGES.map((d) => (
                  <path key={d} d={d} />
                ))}
              </g>
              <g
                className="edge-live"
                fill="none"
                stroke="var(--color-ink)"
                strokeWidth="1.5"
                strokeDasharray="3 9"
                strokeLinecap="round"
              >
                {packets.map((p) => (
                  <path key={`e-${p.key}`} d={p.path} opacity="0.4" />
                ))}
              </g>
            </svg>

            {packets.map((p) => (
              <div
                key={p.key}
                className="packet mono pointer-events-none absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-[10px] text-white"
                style={{
                  boxShadow: '0 4px 14px rgba(10,10,10,.22)',
                  offsetPath: `path("${p.path}")`,
                  offsetRotate: '0deg',
                  offsetDistance: '0%',
                  animation: `flow ${PACKET_MS}ms linear forwards`,
                }}
              >
                <span className="h-[5px] w-[5px] flex-none rounded-full bg-current" />
                {p.label}
              </div>
            ))}

            {/* deal intake */}
            <div
              className="absolute flex flex-col justify-between rounded-[18px] border border-line-strong bg-ink px-4 py-3.5 text-white"
              style={{ left: 0, top: 210, width: 150, height: 100 }}
            >
              <div className="eyebrow text-white/60">Deal intake</div>
              <div>
                <div className="text-[15px] font-bold tracking-tight">
                  ₹{amountInr.toLocaleString('en-IN')}
                </div>
                <div className="mono mt-1 text-[10px] text-white/55">
                  {UPSTREAM.length} payloads dispatched
                </div>
              </div>
            </div>

            {/* the four parallel agents */}
            {UPSTREAM.map((id) => {
              const a = byId(id)
              const top = TOPS[id]
              if (!a) return null
              const isDone = a.status === 'done'
              const isRunning = a.status === 'running'
              return (
                <div
                  key={id}
                  className={`absolute flex flex-col gap-2.5 rounded-[18px] bg-surface px-[15px] py-[13px] ${
                    isRunning ? 'node-halo' : ''
                  }`}
                  style={{
                    left: 210,
                    top,
                    width: 230,
                    minHeight: 92,
                    boxSizing: 'border-box',
                    border: `1px ${isDone || isRunning ? 'solid' : 'dashed'} ${
                      isDone ? 'var(--color-line)' : isRunning ? 'var(--color-ink)' : 'var(--color-line-strong)'
                    }`,
                    opacity: isDone || isRunning ? 1 : 0.55,
                  }}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="whitespace-nowrap text-[13.5px] font-bold uppercase leading-tight tracking-tight">
                        {a.label}
                      </div>
                      <div
                        className="mono mt-1 text-[10px] uppercase tracking-wider"
                        style={{
                          color: isDone ? REC_COLOR[a.recommendation] : isRunning ? 'var(--color-ink)' : 'var(--color-ink-faint)',
                        }}
                      >
                        {isDone ? `reported · ${a.recommendation}` : isRunning ? 'thinking' : 'queued'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className="text-[22px] font-bold leading-none tracking-tight"
                        style={{ color: isDone ? 'var(--color-ink)' : 'var(--color-line-strong)' }}
                      >
                        {isDone ? `${Math.round(a.confidence * 100)}%` : isRunning ? '··' : '—'}
                      </div>
                      <div className="eyebrow mt-1 text-[9px] text-ink-faint">
                        {isDone ? 'confidence' : isRunning ? 'working' : 'queued'}
                      </div>
                    </div>
                  </div>
                  <div className="h-[3px] overflow-hidden rounded-full bg-[#f0f0ed]">
                    <div
                      className={`h-full rounded-full ${isRunning ? 'pulse-soft' : ''}`}
                      style={{
                        width: isDone ? `${Math.round(a.confidence * 100)}%` : isRunning ? '38%' : '0%',
                        background: isDone ? REC_COLOR[a.recommendation] : 'var(--color-ink)',
                      }}
                    />
                  </div>
                </div>
              )
            })}

            {/* the gate that holds Negotiation back */}
            <div
              className="absolute flex flex-col items-center justify-center gap-[3px] rounded-full bg-paper"
              style={{
                left: 500,
                top: 228,
                width: 64,
                height: 64,
                boxSizing: 'border-box',
                border: `1px ${gateOpen ? 'solid' : 'dashed'} ${gateOpen ? 'var(--color-ink)' : 'var(--color-line-strong)'}`,
                color: gateOpen ? 'var(--color-ink)' : 'var(--color-ink-faint)',
              }}
              title={gateOpen ? 'Gate open — all four upstream agents reported' : 'Gate locked — waiting for all four upstream agents'}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="3" y="7" width="10" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
                <path
                  d={gateOpen ? 'M5.5 7V5.3a2.5 2.5 0 0 1 5 0' : 'M5.5 7V5.3a2.5 2.5 0 0 1 5 0V7'}
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </svg>
              <span className="text-[8px] font-semibold uppercase tracking-widest">Gate</span>
            </div>

            {/* negotiation */}
            {nego && (
              <div
                className={`absolute flex flex-col justify-between rounded-[18px] bg-surface px-[15px] py-[13px] ${
                  nego.status === 'running' ? 'node-halo' : ''
                }`}
                style={{
                  left: 604,
                  top: 216,
                  width: 190,
                  height: 88,
                  boxSizing: 'border-box',
                  border: `1px ${nego.status === 'pending' ? 'dashed' : 'solid'} ${
                    nego.status === 'done'
                      ? 'var(--color-line)'
                      : nego.status === 'running'
                        ? 'var(--color-ink)'
                        : 'var(--color-line-strong)'
                  }`,
                  opacity: nego.status === 'pending' ? 0.55 : 1,
                }}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div>
                    <div className="text-sm font-bold uppercase tracking-tight">Negotiation</div>
                    <div
                      className="mono mt-1 text-[10px] uppercase tracking-wider"
                      style={{
                        color:
                          nego.status === 'done'
                            ? REC_COLOR[nego.recommendation]
                            : nego.status === 'running'
                              ? 'var(--color-ink)'
                              : 'var(--color-ink-faint)',
                      }}
                    >
                      {nego.status === 'done'
                        ? `reported · ${nego.recommendation}`
                        : nego.status === 'running'
                          ? 'drafting counter-ask'
                          : 'gated — waits for four'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-[22px] font-bold leading-none tracking-tight"
                      style={{ color: nego.status === 'done' ? 'var(--color-ink)' : 'var(--color-line-strong)' }}
                    >
                      {nego.status === 'done' ? `${Math.round(nego.confidence * 100)}%` : nego.status === 'running' ? '··' : '—'}
                    </div>
                    <div className="eyebrow mt-1 text-[9px] text-ink-faint">
                      {nego.status === 'done' ? 'confidence' : nego.status === 'running' ? 'working' : 'locked'}
                    </div>
                  </div>
                </div>
                <div className="h-[3px] overflow-hidden rounded-full bg-[#f0f0ed]">
                  <div
                    className={`h-full rounded-full ${nego.status === 'running' ? 'pulse-soft' : ''}`}
                    style={{
                      width: nego.status === 'done' ? `${Math.round(nego.confidence * 100)}%` : nego.status === 'running' ? '52%' : '0%',
                      background: nego.status === 'done' ? REC_COLOR[nego.recommendation] : 'var(--color-ink)',
                    }}
                  />
                </div>
              </div>
            )}

            {/* supervisor */}
            <div
              className={`absolute flex flex-col items-start justify-between rounded-[18px] p-3.5 ${
                supState.halo ? 'node-halo' : ''
              }`}
              style={{
                left: 840,
                top: 195,
                width: 120,
                height: 130,
                boxSizing: 'border-box',
                background: supState.bg,
                color: supState.fg,
                border: `1px solid ${supState.border}`,
              }}
            >
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M10 2.5 4 4.8v4.4c0 3.4 2.4 6.5 6 8.3 3.6-1.8 6-4.9 6-8.3V4.8L10 2.5Z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
                <path
                  d="m7.5 10 1.8 1.8 3.4-3.6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div>
                <div className="text-[13px] font-bold uppercase leading-tight tracking-tight">
                  Supervisor
                </div>
                <div className="mono mt-1.5 text-[10px] uppercase tracking-wider opacity-70">
                  {supState.status}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* transfer receipts */}
      <div className="card flex max-h-[660px] flex-col overflow-hidden">
        <div className="border-b border-line px-5 pb-3.5 pt-5">
          <div className="eyebrow">Transfer receipts</div>
          <div className="mono mt-1 text-[10px] text-ink-faint">
            every payload handed between agents
          </div>
        </div>
        <div className="scroll-slim flex-1 overflow-y-auto px-3.5 pb-4 pt-2">
          {receipts.length === 0 ? (
            <p className="px-2 py-6 text-xs text-ink-faint">
              Receipts appear here as each agent reports.
            </p>
          ) : (
            receipts.map((r) => (
              <div key={r.key} className="trace-line border-b border-[#f0f0ed] px-1.5 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="mono text-[10px] text-ink-faint">{r.t}</span>
                  <span
                    className="mono text-[10.5px] font-medium leading-snug tracking-wide"
                    style={{ color: r.color }}
                  >
                    {r.route}
                  </span>
                </div>
                <div className="mono mt-1 break-all pl-0.5 text-[10px] leading-relaxed text-ink-soft">
                  {r.payload}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
