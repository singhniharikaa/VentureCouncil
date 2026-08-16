import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { Card, EmptyState, PillButton, Stat, VerdictBadge } from '../components/ui'
import type { Recommendation } from '../types'

const FILTERS: (Recommendation | 'all')[] = ['all', 'accept', 'negotiate', 'reject']

export function Dashboard() {
  const { evaluations, creators } = useStore()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Recommendation | 'all'>('all')
  const [sortDesc, setSortDesc] = useState(true)

  const rows = useMemo(() => {
    const list = evaluations.filter(
      (e) => filter === 'all' || e.verdict?.decision === filter,
    )
    return [...list].sort((a, b) =>
      sortDesc
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt),
    )
  }, [evaluations, filter, sortDesc])

  const counts = useMemo(() => {
    const c = { accept: 0, negotiate: 0, reject: 0 }
    for (const e of evaluations) if (e.verdict) c[e.verdict.decision] += 1
    return c
  }, [evaluations])

  const overrides = evaluations.filter((e) => e.verdict?.override.fired).length

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="display text-5xl lg:text-6xl">
            Deal
            <br />
            Performance
          </h1>
          <p className="mt-4 text-sm text-ink-soft">
            Every council run, with the verdict and what triggered it.
          </p>
        </div>
        <PillButton onClick={() => navigate('/evaluate')}>New evaluation</PillButton>
      </div>

      <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-6">
          <Stat label="Evaluations" value={evaluations.length} />
        </Card>
        <Card className="p-6">
          <Stat label="Creators on roster" value={creators.length} />
        </Card>
        <Card className="p-6">
          <Stat label="Policy overrides" value={overrides} />
        </Card>
        <Card className="p-6">
          <Stat
            label="Accept / Neg / Reject"
            value={
              <span className="text-2xl">
                {counts.accept} / {counts.negotiate} / {counts.reject}
              </span>
            }
          />
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-5">
          <h2 className="text-base font-bold uppercase tracking-tight">History</h2>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition ${
                  filter === f ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink'
                }`}
              >
                {f}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSortDesc((s) => !s)}
              className="rounded-full border border-line-strong px-3 py-1.5 text-xs font-medium transition hover:border-ink"
            >
              Date {sortDesc ? '↓' : '↑'}
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing here yet"
              body="Run an evaluation and it will appear in this table with its verdict and trigger."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {['Creator', 'Brand', 'Amount', 'Verdict', 'Trigger', 'Date'].map((h) => (
                    <th key={h} className="eyebrow px-5 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => navigate(`/deal/${e.id}`)}
                    className="cursor-pointer border-b border-line transition last:border-0 hover:bg-paper"
                  >
                    <td className="px-5 py-4 font-medium">{e.creatorName}</td>
                    <td className="px-5 py-4 text-ink-soft">{e.brandName}</td>
                    <td className="px-5 py-4 font-semibold">
                      ₹{e.amountInr.toLocaleString('en-IN')}
                    </td>
                    <td className="px-5 py-4">
                      {e.verdict ? <VerdictBadge verdict={e.verdict.decision} /> : '—'}
                    </td>
                    <td className="px-5 py-4">
                      {e.verdict?.override.fired ? (
                        <span className="mono text-[11px] text-reject">
                          {e.verdict.override.rule}
                        </span>
                      ) : e.verdict?.councilSplit ? (
                        <span className="text-xs text-negotiate">Council split</span>
                      ) : (
                        <span className="text-xs text-ink-faint">Consolidated</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-ink-soft">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
