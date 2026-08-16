import { useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { creatorsToCsv, csvTemplate, parseCreatorCsv } from '../lib/csv'
import type { ParseReport } from '../lib/csv'
import { NICHES } from '../lib/seed'
import { Card, Field, PillButton, SelectInput, TextInput } from '../components/ui'
import type { AudienceTier, Creator, Platform } from '../types'

const PLATFORMS: Platform[] = ['YouTube', 'Instagram', 'Twitch', 'X']
const TIERS: AudienceTier[] = ['Nano', 'Micro', 'Mid', 'Macro', 'Mega']

const BLANK: Omit<Creator, 'id'> = {
  handle: '',
  name: '',
  platform: 'YouTube',
  niche: 'Gaming',
  followers: 0,
  engagementRate: 0,
  tier: 'Micro',
  verified: false,
  audienceAge18to24: 0.5,
  audienceMaleShare: 0.5,
  countryInShare: 0.8,
  notes: '',
}

export function Creators() {
  const { creators, addCreator, updateCreator, deleteCreator, importCreators } = useStore()
  const [editing, setEditing] = useState<Creator | null>(null)
  const [creating, setCreating] = useState(false)
  const [report, setReport] = useState<ParseReport | null>(null)
  const [search, setSearch] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const filtered = creators.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.handle.toLowerCase().includes(search.toLowerCase()) ||
      c.niche.toLowerCase().includes(search.toLowerCase()),
  )

  async function onCsv(file: File | undefined) {
    if (!file) return
    const text = await file.text()
    const parsed = parseCreatorCsv(text)
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
            The data every agent reasons over. Import a CSV, or add and edit creators directly.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <PillButton variant="outline" onClick={() => download('creator-template.csv', csvTemplate())}>
            Template
          </PillButton>
          <PillButton
            variant="outline"
            onClick={() => download('creators.csv', creatorsToCsv(creators))}
          >
            Export CSV
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

      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => onCsv(e.target.files?.[0])}
      />

      {report && (
        <Card className="mt-6 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm">
              <strong>
                Imported {report.rows.length} creator{report.rows.length === 1 ? '' : 's'}.
              </strong>
              {report.skipped > 0 && (
                <span className="text-ink-soft"> {report.skipped} row(s) skipped.</span>
              )}
              {report.problems.length > 0 && (
                <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-ink-soft">
                  {report.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-faint">
                Rows are matched on handle — re-importing updates existing creators instead of
                duplicating them.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReport(null)}
              className="text-xs text-ink-soft hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </Card>
      )}

      <div className="mt-6 max-w-sm">
        <TextInput value={search} onChange={setSearch} placeholder="Search name, handle or niche…" />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {['Creator', 'Platform', 'Niche', 'Followers', 'ER', 'Tier', ''].map((h) => (
                  <th key={h} className="eyebrow px-5 py-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-paper">
                  <td className="px-5 py-4">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-ink-faint">@{c.handle}</div>
                  </td>
                  <td className="px-5 py-4 text-ink-soft">{c.platform}</td>
                  <td className="px-5 py-4 text-ink-soft">{c.niche}</td>
                  <td className="px-5 py-4 font-medium">{c.followers.toLocaleString('en-IN')}</td>
                  <td className="px-5 py-4">{c.engagementRate}%</td>
                  <td className="px-5 py-4">
                    <span className="rounded-full border border-line bg-paper px-2.5 py-1 text-[11px]">
                      {c.tier}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
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
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-ink-soft">
                    No creators match “{search}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/25" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-surface p-7 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">
            {isNew ? 'Add creator' : 'Edit creator'}
          </h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-soft hover:text-ink">
            Close
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <Field label="Handle">
            <TextInput value={form.handle} onChange={(v) => set('handle', v)} prefix="@" />
          </Field>
          <Field label="Display name">
            <TextInput value={form.name} onChange={(v) => set('name', v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Platform">
              <SelectInput
                value={form.platform}
                onChange={(v) => set('platform', v as Platform)}
                options={PLATFORMS}
              />
            </Field>
            <Field label="Niche">
              <SelectInput value={form.niche} onChange={(v) => set('niche', v)} options={NICHES} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Followers">
              <TextInput
                value={String(form.followers)}
                onChange={(v) => set('followers', Number(v.replace(/\D/g, '')) || 0)}
              />
            </Field>
            <Field label="Engagement rate (%)">
              <TextInput
                value={String(form.engagementRate)}
                onChange={(v) => set('engagementRate', Number(v) || 0)}
              />
            </Field>
          </div>
          <Field label="Audience tier">
            <SelectInput
              value={form.tier}
              onChange={(v) => set('tier', v as AudienceTier)}
              options={TIERS}
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="18-24 share" hint="0-1">
              <TextInput
                value={String(form.audienceAge18to24)}
                onChange={(v) => set('audienceAge18to24', Number(v) || 0)}
              />
            </Field>
            <Field label="Male share" hint="0-1">
              <TextInput
                value={String(form.audienceMaleShare)}
                onChange={(v) => set('audienceMaleShare', Number(v) || 0)}
              />
            </Field>
            <Field label="India share" hint="0-1">
              <TextInput
                value={String(form.countryInShare)}
                onChange={(v) => set('countryInShare', Number(v) || 0)}
              />
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={form.verified}
              onChange={(e) => set('verified', e.target.checked)}
              className="h-4 w-4 accent-black"
            />
            Verified account
          </label>

          <Field label="Notes">
            <textarea
              value={form.notes ?? ''}
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
                <button
                  type="button"
                  onClick={onDelete}
                  className="font-semibold text-reject hover:underline"
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-ink-soft hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-sm text-reject hover:underline"
              >
                Delete
              </button>
            )
          ) : (
            <span />
          )}
          <PillButton onClick={() => onSave(form)} disabled={!form.handle.trim()}>
            {isNew ? 'Add creator' : 'Save changes'}
          </PillButton>
        </div>
      </div>
    </div>
  )
}
