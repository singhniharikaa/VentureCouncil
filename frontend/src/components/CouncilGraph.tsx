/**
 * Council graph - the live topology of a council run, flowing top to bottom.
 *
 *   Deal intake
 *        |
 *   [Audience Fit] [Engagement] [Pricing] [Risk]     <- four agents, in parallel
 *        |
 *      Gate                                          <- waits until all four report
 *        |
 *   Negotiation                                      <- reads their findings
 *        |
 *   Supervisor                                       <- consolidates everything
 *
 * Ported from the "Deal Room Live" Claude Design canvas, then redrawn vertically:
 * the original was a fixed 960px-wide horizontal diagram that overflowed and was
 * clipped on anything narrower than a wide desktop. This one is laid out in a
 * fixed design space and scaled to whatever width it is given, so it never needs
 * to scroll sideways.
 *
 * Everything shown comes from real `AgentResult` data - node states, confidence,
 * chips and receipts - never from a scripted timeline.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AgentId, AgentResult, Recommendation, Verdict } from '../types'

/* ------------------------------------------------------------------ layout
   Everything below is in "design pixels". The whole diagram is scaled as one
   piece, so these numbers never need to change with screen size. */
const W = 900
const H = 712

const INTAKE = { left: 330, top: 0, w: 240, h: 84 }

const AGENT_W = 204
const AGENT_H = 104
const AGENT_TOP = 170
const AGENT_GAP = 24
const UPSTREAM: AgentId[] = ['audience_fit', 'engagement', 'pricing', 'risk']
const agentLeft = (i: number) => 6 + i * (AGENT_W + AGENT_GAP)
const agentCx = (i: number) => agentLeft(i) + AGENT_W / 2
const AGENT_BOTTOM = AGENT_TOP + AGENT_H

const GATE = { size: 64, left: 418, top: 336 }
const NEGO = { left: 330, top: 440, w: 240, h: 92 }
const SUP = { left: 270, top: 604, w: 360, h: 104 }
const CX = W / 2

const IN_PATHS: Record<string, string> = {}
const GATE_PATHS: Record<string, string> = {}
UPSTREAM.forEach((id, i) => {
  const cx = agentCx(i)
  IN_PATHS[id] = `M${CX},${INTAKE.top + INTAKE.h} C${CX},127 ${cx},127 ${cx},${AGENT_TOP}`
  GATE_PATHS[id] = `M${cx},${AGENT_BOTTOM} C${cx},305 ${CX},305 ${CX},${GATE.top}`
})
const GATE_OUT = `M${CX},${GATE.top + GATE.size} L${CX},${NEGO.top}`
const NEGO_OUT = `M${CX},${NEGO.top + NEGO.h} L${CX},${SUP.top}`

// Each agent also reports straight to the Supervisor. Those edges run down the
// outer sides so they do not tangle with the gate edges in the middle.
const SUP_PATHS: Record<string, string> = {
  audience_fit: `M${agentCx(0) - 52},${AGENT_BOTTOM} C${agentCx(0) - 52},520 150,656 ${SUP.left},656`,
  engagement: `M${agentCx(1) - 52},${AGENT_BOTTOM} C${agentCx(1) - 52},520 ${SUP.left},600 ${SUP.left},630`,
  pricing: `M${agentCx(2) + 52},${AGENT_BOTTOM} C${agentCx(2) + 52},520 ${SUP.left + SUP.w},600 ${SUP.left + SUP.w},630`,
  risk: `M${agentCx(3) + 52},${AGENT_BOTTOM} C${agentCx(3) + 52},520 750,656 ${SUP.left + SUP.w},656`,
}

const STATIC_EDGES = [
  ...Object.values(IN_PATHS),
  ...Object.values(GATE_PATHS),
  ...Object.values(SUP_PATHS),
  GATE_OUT,
  NEGO_OUT,
]

const REC_COLOR: Record<Recommendation, string> = {
  accept: 'var(--color-accept)',
  negotiate: 'var(--color-negotiate)',
  reject: 'var(--color-reject)',
}
const REC_BG: Record<Recommendation, string> = {
  accept: 'var(--color-accept-bg)',
  negotiate: 'var(--color-negotiate-bg)',
  reject: 'var(--color-reject-bg)',
}

const PACKET_MS = 1000

type Packet = { key: string; path: string; label: string }

/**
 * A short, human-readable chip for the payload travelling to the Supervisor.
 *
 * The two engines emit different `typed` keys - the offline TS council uses
 * fit_score / vtr / deviation_pct, while the Python adapter uses percentile /
 * comps_used / data_confidence_score. Both are handled so the graph stays
 * meaningful in either mode; falling through to "score 70" tells the viewer
 * nothing the node is not already showing.
 */
function chipFor(a: AgentResult): string {
  const t = a.typed
  const n = (v: unknown) => (typeof v === 'number' ? v : null)

  if (a.insufficientData) return 'insufficient data'

  if (a.id === 'audience_fit') {
    const fit = n(t.fit_score)
    if (fit !== null) return `fit ${fit}`
    if (typeof t.creator_niche === 'string' && t.creator_niche) return `niche ${t.creator_niche}`
    if (t.platform_match === true) return 'platform match'
  }

  if (a.id === 'engagement') {
    const pct = n(t.percentile)
    if (pct !== null) return `p${Math.round(pct)} vs peers`
    const vtr = n(t.view_through_rate ?? t.vtr)
    if (vtr !== null) return `vtr ${vtr <= 1 ? (vtr * 100).toFixed(1) : vtr.toFixed(1)}%`
    const er = n(t.engagement_rate)
    if (er !== null) return `er ${er.toFixed(2)}%`
  }

  if (a.id === 'pricing') {
    const dev = n(t.deviation_pct)
    if (dev !== null) return `dev ${dev >= 0 ? '+' : ''}${dev}%`
    const comps = n(t.comps_used)
    if (comps !== null) return `${comps} comps`
  }

  if (a.id === 'risk') {
    if (typeof a.severity === 'string') return `sev ${a.severity}`
    if (typeof t.severity === 'string') return `sev ${t.severity}`
    const conf = n(t.data_confidence_score)
    if (conf !== null) return `conf ${conf}/100`
  }

  if (a.id === 'negotiation') return 'counter-ask'

  return `score ${a.score}`
}

/** Compact one-line rendering of the agent's typed output, for the receipt log. */
function payloadFor(a: AgentResult): string {
  const parts = Object.entries(a.typed)
    .filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .slice(0, 3)
    .map(([k, v]) => `${k}:${Array.isArray(v) ? `[${v.length}]` : JSON.stringify(v)}`)
  const body = parts.length ? `{${parts.join(', ')}}` : '{}'
  return `${body} · conf ${a.confidence.toFixed(2)} · ${a.latencyMs}ms · ${a.model || 'council-local'}`
}

/**
 * Scale the fixed-size diagram to the width it is given.
 *
 * Never scales UP past 1 (a huge, blurry diagram helps nobody) and centres when
 * the container is wider than the diagram.
 */
function useFitScale(designWidth: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, left: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      const scale = Math.min(1, w / designWidth)
      setFit({ scale, left: Math.max(0, (w - designWidth * scale) / 2) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [designWidth])

  return { ref, ...fit }
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

  const { ref, scale, left } = useFitScale(W)

  /* ---- packets ------------------------------------------------------- */
  const [packets, setPackets] = useState<Packet[]>([])
  const seen = useRef<Set<string>>(new Set())
  const timers = useRef<number[]>([])

  const emit = (key: string, path: string, label: string) => {
    if (seen.current.has(key)) return
    seen.current.add(key)
    setPackets((p) => [...p, { key, path, label }])
    timers.current.push(
      window.setTimeout(() => setPackets((p) => p.filter((x) => x.key !== key)), PACKET_MS),
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
     a backgrounded tab would freeze the clock mid-run and then jump. */
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

  // The Supervisor box takes the colour of the verdict it reached.
  const sup = verdict
    ? {
        bg: REC_BG[verdict.decision],
        fg: REC_COLOR[verdict.decision],
        border: `color-mix(in srgb, ${REC_COLOR[verdict.decision]} 45%, transparent)`,
        status: `verdict: ${verdict.decision}`,
        halo: false,
      }
    : started
      ? {
          bg: 'var(--color-ink)',
          fg: 'var(--color-on-ink)',
          border: 'var(--color-ink)',
          status: `receiving ${doneCount}/5`,
          halo: true,
        }
      : {
          bg: 'var(--color-paper)',
          fg: 'var(--color-ink-faint)',
          border: 'var(--color-line-strong)',
          status: 'idle',
          halo: false,
        }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="card relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
          <div className="eyebrow text-ink-faint">Council graph</div>
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

        <div className="px-6 pb-6 pt-4">
          {/* The outer box takes the SCALED height; the inner box is the fixed
              design space, scaled as one piece. */}
          <div ref={ref} className="relative w-full" style={{ height: H * scale }}>
            <div
              className="absolute top-0"
              style={{
                left,
                width: W,
                height: H,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            >
              <svg
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
                className="absolute inset-0 overflow-visible"
                aria-hidden="true"
              >
                <g fill="none" stroke="var(--color-line-strong)" strokeWidth="1.5" opacity="0.7">
                  {STATIC_EDGES.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </g>
                <g
                  className="edge-live"
                  fill="none"
                  stroke="var(--color-ink)"
                  strokeWidth="1.8"
                  strokeDasharray="3 9"
                  strokeLinecap="round"
                >
                  {packets.map((p) => (
                    <path key={`e-${p.key}`} d={p.path} opacity="0.55" />
                  ))}
                </g>
              </svg>

              {packets.map((p) => (
                <div
                  key={p.key}
                  className="packet mono pointer-events-none absolute left-0 top-0 z-20 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-[10px] text-on-ink"
                  style={{
                    boxShadow: '0 4px 14px rgba(0,0,0,.35)',
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

              {/* 1. deal intake */}
              <div
                className="absolute flex flex-col justify-between rounded-[18px] border border-line-strong bg-ink px-4 py-3.5 text-on-ink"
                style={{ left: INTAKE.left, top: INTAKE.top, width: INTAKE.w, height: INTAKE.h }}
              >
                <div className="eyebrow text-on-ink/60">Deal intake</div>
                <div className="flex items-end justify-between gap-2">
                  <div className="text-[20px] font-bold leading-none tracking-tight">
                    ₹{amountInr.toLocaleString('en-IN')}
                  </div>
                  <div className="mono text-[10px] text-on-ink/60">
                    {UPSTREAM.length} payloads sent
                  </div>
                </div>
              </div>

              {/* 2. the four parallel agents */}
              {UPSTREAM.map((id, i) => {
                const a = byId(id)
                if (!a) return null
                const isDone = a.status === 'done'
                const isRunning = a.status === 'running'
                const statusColor = isDone
                  ? REC_COLOR[a.recommendation]
                  : isRunning
                    ? 'var(--color-ink)'
                    : 'var(--color-ink-faint)'
                return (
                  <div
                    key={id}
                    className={`absolute flex flex-col justify-between rounded-[18px] bg-surface px-4 py-3.5 ${
                      isRunning ? 'node-halo' : ''
                    }`}
                    style={{
                      left: agentLeft(i),
                      top: AGENT_TOP,
                      width: AGENT_W,
                      height: AGENT_H,
                      boxSizing: 'border-box',
                      border: `1px ${isDone || isRunning ? 'solid' : 'dashed'} ${
                        isDone
                          ? 'var(--color-line-strong)'
                          : isRunning
                            ? 'var(--color-ink)'
                            : 'var(--color-line-strong)'
                      }`,
                      opacity: isDone || isRunning ? 1 : 0.55,
                    }}
                  >
                    <div className="whitespace-nowrap text-[13px] font-bold uppercase leading-tight tracking-tight">
                      {a.label}
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div
                        className="mono max-w-[100px] text-[10px] uppercase leading-tight tracking-wider"
                        style={{ color: statusColor }}
                      >
                        {isDone ? `reported · ${a.recommendation}` : isRunning ? 'thinking…' : 'queued'}
                      </div>
                      <div className="text-right">
                        <div
                          className="text-[24px] font-bold leading-none tracking-tight"
                          style={{ color: isDone ? 'var(--color-ink)' : 'var(--color-ink-faint)' }}
                        >
                          {isDone ? `${Math.round(a.confidence * 100)}%` : isRunning ? '··' : '—'}
                        </div>
                        <div className="eyebrow mt-0.5 text-[9px] text-ink-faint">
                          {isDone ? 'confidence' : isRunning ? 'working' : 'queued'}
                        </div>
                      </div>
                    </div>
                    <div className="h-[3px] overflow-hidden rounded-full bg-track">
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

              {/* 3. the gate that holds Negotiation back */}
              <div
                className="absolute flex flex-col items-center justify-center gap-[3px] rounded-full bg-paper"
                style={{
                  left: GATE.left,
                  top: GATE.top,
                  width: GATE.size,
                  height: GATE.size,
                  boxSizing: 'border-box',
                  border: `1px ${gateOpen ? 'solid' : 'dashed'} ${
                    gateOpen ? 'var(--color-ink)' : 'var(--color-line-strong)'
                  }`,
                  color: gateOpen ? 'var(--color-ink)' : 'var(--color-ink-faint)',
                }}
                title={
                  gateOpen
                    ? 'Gate open - all four upstream agents reported'
                    : 'Gate locked - waiting for all four upstream agents'
                }
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
              <div
                className="mono absolute text-[10px] uppercase tracking-wider text-ink-faint"
                style={{ left: GATE.left + GATE.size + 14, top: GATE.top + 24 }}
              >
                {gateOpen ? 'open · 4/4 reported' : `locked · ${doneUpstream}/4 reported`}
              </div>

              {/* 4. negotiation */}
              {nego && (
                <div
                  className={`absolute flex flex-col justify-between rounded-[18px] bg-surface px-4 py-3.5 ${
                    nego.status === 'running' ? 'node-halo' : ''
                  }`}
                  style={{
                    left: NEGO.left,
                    top: NEGO.top,
                    width: NEGO.w,
                    height: NEGO.h,
                    boxSizing: 'border-box',
                    border: `1px ${nego.status === 'pending' ? 'dashed' : 'solid'} ${
                      nego.status === 'running' ? 'var(--color-ink)' : 'var(--color-line-strong)'
                    }`,
                    opacity: nego.status === 'pending' ? 0.55 : 1,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold uppercase leading-tight tracking-tight">
                        Negotiation
                      </div>
                      <div
                        className="mono mt-1 text-[10px] uppercase leading-tight tracking-wider"
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
                            ? 'drafting counter-ask…'
                            : 'gated · waits for all four'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className="text-[24px] font-bold leading-none tracking-tight"
                        style={{
                          color: nego.status === 'done' ? 'var(--color-ink)' : 'var(--color-ink-faint)',
                        }}
                      >
                        {nego.status === 'done'
                          ? `${Math.round(nego.confidence * 100)}%`
                          : nego.status === 'running'
                            ? '··'
                            : '—'}
                      </div>
                      <div className="eyebrow mt-0.5 text-[9px] text-ink-faint">
                        {nego.status === 'done' ? 'confidence' : nego.status === 'running' ? 'working' : 'locked'}
                      </div>
                    </div>
                  </div>
                  <div className="h-[3px] overflow-hidden rounded-full bg-track">
                    <div
                      className={`h-full rounded-full ${nego.status === 'running' ? 'pulse-soft' : ''}`}
                      style={{
                        width:
                          nego.status === 'done'
                            ? `${Math.round(nego.confidence * 100)}%`
                            : nego.status === 'running'
                              ? '52%'
                              : '0%',
                        background:
                          nego.status === 'done' ? REC_COLOR[nego.recommendation] : 'var(--color-ink)',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* 5. supervisor */}
              <div
                className={`absolute flex flex-col justify-between rounded-[18px] p-4 ${
                  sup.halo ? 'node-halo' : ''
                }`}
                style={{
                  left: SUP.left,
                  top: SUP.top,
                  width: SUP.w,
                  height: SUP.h,
                  boxSizing: 'border-box',
                  background: sup.bg,
                  color: sup.fg,
                  border: `1px solid ${sup.border}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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
                  <div className="text-[14px] font-bold uppercase leading-tight tracking-tight">
                    Supervisor
                  </div>
                </div>
                <div>
                  <div className="mono text-[11px] uppercase tracking-wider opacity-80">{sup.status}</div>
                  {verdict && typeof verdict.weightedScore === 'number' && (
                    <div className="mono mt-0.5 text-[10px] uppercase tracking-wider opacity-60">
                      weighted score {verdict.weightedScore}/100
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* transfer receipts */}
      <div className="card flex max-h-[780px] flex-col overflow-hidden xl:sticky xl:top-24 xl:self-start">
        <div className="border-b border-line px-5 pb-3.5 pt-5">
          <div className="eyebrow">Transfer receipts</div>
          <div className="mono mt-1 text-[10px] text-ink-faint">every payload handed between agents</div>
        </div>
        <div className="scroll-slim flex-1 overflow-y-auto px-3.5 pb-4 pt-2">
          {receipts.length === 0 ? (
            <p className="px-2 py-6 text-xs text-ink-faint">Receipts appear here as each agent reports.</p>
          ) : (
            receipts.map((r) => (
              <div key={r.key} className="trace-line border-b border-line px-1.5 py-2.5">
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
