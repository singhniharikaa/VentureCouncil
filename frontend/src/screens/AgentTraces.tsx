import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useStore } from '../lib/store'
import { Card, EmptyState, Stat } from '../components/ui'
import type { AgentId } from '../types'

const AGENT_ORDER: AgentId[] = ['audience_fit', 'engagement', 'pricing', 'risk', 'negotiation']

/** Cross-run view of how each agent behaves — latency, confidence, flag frequency. */
export function AgentTraces() {
  const { evaluations } = useStore()

  const stats = useMemo(() => {
    const acc = new Map<AgentId, { label: string; runs: number; conf: number; latency: number; flags: number }>()
    for (const e of evaluations) {
      for (const a of e.agents) {
        const cur = acc.get(a.id) ?? { label: a.label, runs: 0, conf: 0, latency: 0, flags: 0 }
        cur.runs += 1
        cur.conf += a.confidence
        cur.latency += a.latencyMs
        cur.flags += a.flags.length
        acc.set(a.id, cur)
      }
    }
    return AGENT_ORDER.filter((id) => acc.has(id)).map((id) => {
      const s = acc.get(id)!
      return {
        id,
        label: s.label,
        runs: s.runs,
        avgConfidence: Math.round((s.conf / s.runs) * 100),
        avgLatency: Math.round(s.latency / s.runs),
        avgFlags: +(s.flags / s.runs).toFixed(1),
      }
    })
  }, [evaluations])

  const overrides = evaluations.filter((e) => e.verdict?.override.fired).length
  const splits = evaluations.filter((e) => e.verdict?.councilSplit).length

  if (stats.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="display text-5xl">Agent Traces</h1>
        <div className="mt-8">
          <EmptyState
            title="No traces yet"
            body="Once evaluations have run, per-agent latency, confidence and flag rates appear here."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="display text-5xl">Agent Traces</h1>
      <p className="mt-4 max-w-xl text-sm text-ink-soft">
        How each agent behaves across runs. Useful for spotting an agent that is systematically
        over-confident or slow.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Card className="p-6">
          <Stat label="Council runs" value={evaluations.length} />
        </Card>
        <Card className="p-6">
          <Stat label="Policy overrides" value={overrides} />
        </Card>
        <Card className="p-6">
          <Stat label="Council splits" value={splits} />
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-base font-bold uppercase tracking-tight">Average confidence by agent</h2>
        <div className="mt-6 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats} margin={{ left: -18, right: 8 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#e4e4e0" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#5c5c5c' }}
                axisLine={{ stroke: '#e4e4e0' }}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: '#909090' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(10,10,10,0.04)' }}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #e4e4e0',
                  fontSize: 12,
                }}
                formatter={(v) => [`${v}%`, 'Avg confidence']}
              />
              <Bar dataKey="avgConfidence" radius={[6, 6, 0, 0]}>
                {stats.map((s) => (
                  <Cell key={s.id} fill="#0a0a0a" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {['Agent', 'Runs', 'Avg confidence', 'Avg latency', 'Avg flags'].map((h) => (
                  <th key={h} className="eyebrow px-5 py-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-4 font-medium">{s.label}</td>
                  <td className="px-5 py-4 text-ink-soft">{s.runs}</td>
                  <td className="px-5 py-4">{s.avgConfidence}%</td>
                  <td className="mono px-5 py-4 text-ink-soft">{s.avgLatency}ms</td>
                  <td className="px-5 py-4">{s.avgFlags}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
