import { useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { creatorSignals, creatorsToCsv, csvTemplate, normaliseNiche, parseCreatorCsv } from '../lib/csv'
import type { ParseReport } from '../lib/csv'
import { NICHES } from '../lib/seed'
import { Card, Field, PillButton, SelectInput, TextInput } from '../components/ui'
import type { Creator } from '../types'

const BLANK: Omit<Creator, 'id'> = {
  name: '',
  handle: '',
  platform: 'youtube',
  channelUrl: '',
  channelId: '',
  niche: '',
  subNiche: '',
  nicheRaw: '',
  subscriberCount: 0,
  totalViews: 0,
  videoCount: 0,
  integrationPriceInr: null,
  dedicatedPriceInr: null,
  notes: '',
}

const compact = (n: number) =>
  n >= 10_000_000 ? `${(n / 10_000_000).toFixed(1)}Cr` : n >= 100_000 ? `${(n / 100_000).toFixed(1)}L` : n.toLocaleString('en-IN')

export function Creators() {
  const { creators, loading, addCreator, updateCreator, deleteCreator, importCreators } = useStore()
  const [editing, setEditing] = useState<Creator | null>(null)
  const [creating, setCreating] = useState(false)
  const [report, setReport] = useState<ParseReport | null>(null)
  const [search, setSearch] = useState('')
  const [onlyGaps, setOnlyGaps] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const coverage = useMemo(() => {
    const withNiche = creators.filter((c) => c.niche).length
    // Instagram rows carry a single `priceInr` rather than the split
    // integration/dedicated columns, so counting only integrationPriceInr
    // reported 275/775 and made it look as though two-thirds of the roster
    // had no price at all. Every row with any usable price counts here.
    const withPrice = creators.filter(
      (c) => c.integrationPriceInr !== null || c.dedicatedPriceInr !== null || (c.priceInr ?? null) !== null,
    ).length
    const withEngagement = creators.filter(
      (c) => typeof c.engagementRate === 'number' && c.engagementRate > 0,
    ).length
    const quotedPrice = creators.filter((c) => (c.priceInr ?? null) !== null && !c.priceEstimated).length
    return { withNiche, withPrice, withEngagement, quotedPrice, total: creators.length }
  }, [creators])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return creators.filter((c) => {
      const matches =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.handle.toLowerCase().includes(q) ||
        c.niche.includes(q)
      const hasGap = !c.niche || c.integrationPriceInr === null
      return matches && (!onlyGaps || hasGap)
    })
  }, [creators, search, onlyGaps])

  async function onCsv(file: File | undefined) {
    if (!file) return
    const parsed = parseCreatorCsv(await file.text())
    setReport(parsed)
    if (parsed.rows.length) importCreators(parsed.rows)
    if (fileRef.current) fileRef.current.value = ''
  }

  function download(name: string, content: string) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="display text-5xl">Creator Roster</h1>
          <p className="mt-4 max-w-lg text-sm text-ink-soft">
            The data every agent reasons over. {loading ? 'Loading…' : `${creators.length} creators.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <PillButton variant="outline" onClick={() => download('creator-template.csv', csvTemplate())}>
            Template
          </PillButton>
          <PillButton variant="outline" onClick={() => download('creators.csv', creatorsToCsv(creators))}>
            Export
          </PillButton>
          <PillButton variant="outline" onClick={() => fileRef.current?.click()}>
            Import CSV
          </PillButton>
          <PillButton
            onClick={() => {
              setCreating(true)
              setEditing({ ...BLANK, id: '' })
            }}
          >
            Add creator
          </PillButton>
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => onCsv(e.target.files?.[0])} />

      {/* Coverage is shown up front because it decides which agents can speak. */}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CoverageCard label="With niche" have={coverage.withNiche} total={coverage.total} note="Audience Fit abstains without it" />
        <CoverageCard label="With engagement rate" have={coverage.withEngagement} total={coverage.total} note="Engagement abstains without it" />
        <CoverageCard label="With a price on file" have={coverage.withPrice} total={coverage.total} note="Pricing falls back to comps" />
        <CoverageCard label="Quoted, not estimated" have={coverage.quotedPrice} total={coverage.total} note="The rest are KNN-estimated" />
      </div>

      {report && (
        <Card className="mt-5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm">
              <strong>Imported {report.rows.length} row(s).</strong>
              {report.skipped > 0 && <span className="text-ink-soft"> {report.skipped} skipped.</span>}
              <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-ink-soft sm:grid-cols-2">
                <span>Niche present: {report.coverage.withNiche}/{report.coverage.total}</span>
                <span>Integration price: {report.coverage.withIntegrationPrice}/{report.coverage.total}</span>
                <span>Dedicated price: {report.coverage.withDedicatedPrice}/{report.coverage.total}</span>
                <span>Reach data: {report.coverage.withReachData}/{report.coverage.total}</span>
              </div>
              {report.droppedColumns.length > 0 && (
                <p className="mt-2 rounded-lg border border-line bg-paper px-3 py-2 text-xs">
                  Not imported: <strong>{report.droppedColumns.join(', ')}</strong> — personal contact
                  data plays no part in evaluating a deal.
                </p>
              )}
              {report.problems.length > 0 && (
                <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-ink-soft">
                  {report.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" onClick={() => setReport(null)} className="text-xs text-ink-soft hover:text-ink">
              Dismiss
            </button>
          </div>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="max-w-sm flex-1">
          <TextInput value={search} onChange={setSearch} placeholder="Search name, handle or niche…" />
        </div>
        <button
          type="button"
          onClick={() => setOnlyGaps((v) => !v)}
          className={`rounded-full border px-4 py-2 text-xs font-medium transition ${
            onlyGaps ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink'
          }`}
        >
          Only rows with gaps
        </button>
        <span className="text-xs text-ink-faint">{filtered.length} shown</span>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {['Creator', 'Platform', 'Niche', 'Audience', 'Engagement', 'Integration', 'Dedicated', ''].map((h) => (
                  <th key={h} className="eyebrow px-4 py-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((c) => {
                const s = creatorSignals(c)
                return (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-paper">
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-ink-faint">@{c.handle}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                          c.platform === 'instagram'
                            ? 'border-negotiate/30 bg-negotiate-bg text-negotiate'
                            : 'border-line bg-paper text-ink-soft'
                        }`}
                      >
                        {c.platform === 'instagram' ? 'Instagram' : 'YouTube'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {c.niche ? (
                        <span className="text-ink-soft">
                          {c.niche}
                          {c.subNiche && <span className="text-ink-faint"> / {c.subNiche}</span>}
                        </span>
                      ) : (
                        <span className="text-xs text-negotiate">missing</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{compact(c.subscriberCount)}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {typeof c.engagementRate === 'number' && c.engagementRate > 0
                        ? `${c.engagementRate.toFixed(2)}%`
                        : s.hasReachData
                          ? `${(s.viewThroughRate * 100).toFixed(1)}% vt`
                          : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {c.integrationPriceInr !== null ? (
                        `₹${c.integrationPriceInr.toLocaleString('en-IN')}`
                      ) : (
                        <span className="text-xs text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.dedicatedPriceInr !== null ? (
                        `₹${c.dedicatedPriceInr.toLocaleString('en-IN')}`
                      ) : (
                        <span className="text-xs text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setCreating(false)
                          setEditing(c)
                        }}
                        className="text-xs font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-ink-soft">
                    No creators match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 100 && (
          <div className="border-t border-line px-5 py-3 text-xs text-ink-faint">
            Showing first 100 of {filtered.length}. Narrow the search to see more.
          </div>
        )}
      </Card>

      {editing && (
        <CreatorDrawer
          creator={editing}
          isNew={creating}
          onClose={() => setEditing(null)}
          onSave={(data) => {
            if (creating) addCreator(data)
            else updateCreator(editing.id, data)
            setEditing(null)
          }}
          onDelete={
            creating
              ? undefined
              : () => {
                  deleteCreator(editing.id)
                  setEditing(null)
                }
          }
        />
      )}
    </div>
  )
}

function CoverageCard({ label, have, total, note }: { label: string; have: number; total: number; note: string }) {
  const pct = total ? Math.round((have / total) * 100) : 0
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-bold tracking-tight">{pct}%</span>
        <span className="text-xs text-ink-faint">
          {have}/{total}
        </span>
      </div>
      <div className="eyebrow mt-1">{label}</div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-ink-faint">{note}</p>
    </Card>
  )
}

function CreatorDrawer({
  creator,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  creator: Creator
  isNew: boolean
  onClose: () => void
  onSave: (c: Omit<Creator, 'id'>) => void
  onDelete?: () => void
}) {
  const [form, setForm] = useState<Omit<Creator, 'id'>>({ ...creator })
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = <K extends keyof Omit<Creator, 'id'>>(k: K, v: Omit<Creator, 'id'>[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const priceField = (v: number | null) => (v === null ? '' : String(v))
  const parsePrice = (s: string) => {
    const t = s.trim()
    if (!t) return null
    const n = Number(t.replace(/[,\s₹]/g, ''))
    return Number.isFinite(n) && n > 0 ? n : null
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/25" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-surface p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">{isNew ? 'Add creator' : 'Edit creator'}</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-soft hover:text-ink">
            Close
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <Field label="Channel name">
            <TextInput value={form.name} onChange={(v) => set('name', v)} />
          </Field>
          <Field label="Handle">
            <TextInput value={form.handle} onChange={(v) => set('handle', v)} prefix="@" />
          </Field>
          <Field label="Channel URL">
            <TextInput value={form.channelUrl} onChange={(v) => set('channelUrl', v)} />
          </Field>

          <Field label="Niche" hint={form.nicheRaw ? `Source text: "${form.nicheRaw}"` : undefined}>
            <SelectInput
              value={form.niche}
              onChange={(v) => set('niche', v)}
              options={NICHES}
              placeholder="Not recorded"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Subscribers">
              <TextInput
                value={String(form.subscriberCount)}
                onChange={(v) => set('subscriberCount', Number(v.replace(/\D/g, '')) || 0)}
              />
            </Field>
            <Field label="Total views">
              <TextInput
                value={String(form.totalViews)}
                onChange={(v) => set('totalViews', Number(v.replace(/\D/g, '')) || 0)}
              />
            </Field>
            <Field label="Videos">
              <TextInput
                value={String(form.videoCount)}
                onChange={(v) => set('videoCount', Number(v.replace(/\D/g, '')) || 0)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Integration rate (₹)" hint="Blank = not quoted">
              <TextInput
                value={priceField(form.integrationPriceInr)}
                onChange={(v) => set('integrationPriceInr', parsePrice(v))}
              />
            </Field>
            <Field label="Dedicated rate (₹)" hint="Blank = not quoted">
              <TextInput
                value={priceField(form.dedicatedPriceInr)}
                onChange={(v) => set('dedicatedPriceInr', parsePrice(v))}
              />
            </Field>
          </div>

          <Field label="Notes" hint="Free-text context. Not used in scoring.">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-ink"
            />
          </Field>
        </div>

        <div className="mt-7 flex items-center justify-between gap-3">
          {onDelete ? (
            confirmDelete ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-ink-soft">Delete {form.name}?</span>
                <button type="button" onClick={onDelete} className="font-semibold text-reject hover:underline">
                  Yes, delete
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-ink-soft hover:text-ink">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm text-reject hover:underline">
                Delete
              </button>
            )
          ) : (
            <span />
          )}
          <PillButton
            onClick={() => {
              const { niche, subNiche } = form.niche
                ? { niche: form.niche, subNiche: form.subNiche }
                : normaliseNiche(form.nicheRaw)
              onSave({ ...form, niche, subNiche })
            }}
            disabled={!form.name.trim() && !form.handle.trim()}
          >
            {isNew ? 'Add creator' : 'Save changes'}
          </PillButton>
        </div>
      </div>
    </div>
  )
}
