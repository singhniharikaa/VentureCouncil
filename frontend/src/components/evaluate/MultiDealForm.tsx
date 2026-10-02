/**
 * Multiple deals: a campaign of up to five creators against one total budget.
 *
 * Each creator is judged separately by the five agents at their own listed
 * price, then the verdicts are added up against the budget (see /campaign).
 * This form only collects who, for which brand, and with how much money.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useStore } from '../../lib/store'
import { BRAND_CATEGORIES } from '../../lib/seed'
import { audienceWord, compact, inr, listedPrice, parseMoney } from '../../lib/format'
import { ArrowCircle, Card, Field, PillButton, SelectInput, TextInput } from '../ui'
import { CreatorPicker } from './CreatorPicker'
import type { Creator } from '../../types'

const MAX_CREATORS = 5

export function MultiDealForm() {
  const { creators, loading } = useStore()
  const navigate = useNavigate()

  const [brandName, setBrandName] = useState('')
  const [brandCategory, setBrandCategory] = useState('')
  const [totalBudget, setTotalBudget] = useState('')
  const [picked, setPicked] = useState<Creator[]>([])
  const [error, setError] = useState<string | null>(null)

  const budget = parseMoney(totalBudget)
  const listedTotal = picked.reduce((sum, c) => sum + (listedPrice(c, 'integration') ?? 0), 0)
  const overBudget = budget > 0 && listedTotal > budget
  const full = picked.length >= MAX_CREATORS

  function submit() {
    if (picked.length === 0) return setError('Add at least one creator.')
    if (!brandName.trim()) return setError('Enter the brand name.')
    setError(null)
    navigate('/campaign', {
      state: {
        creators: picked.map((c) => ({ creatorId: c.id, name: c.name })),
        brandName: brandName.trim(),
        brandCategory,
        totalBudget: budget || undefined,
      },
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card className="p-6">
          <Step n={1} title="Which brand is this campaign for?" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand name">
              <TextInput value={brandName} onChange={setBrandName} placeholder="e.g. Volt Energy Drinks" />
            </Field>
            <Field label="Industry category">
              <SelectInput
                value={brandCategory}
                onChange={setBrandCategory}
                options={BRAND_CATEGORIES}
                placeholder="Select category…"
              />
            </Field>
          </div>
          <div className="mt-4 max-w-xs">
            <Field
              label="Total campaign budget"
              hint="Optional. The verdicts are added up against this, and you are told if they go over."
            >
              <TextInput value={totalBudget} onChange={setTotalBudget} placeholder="100000" prefix="₹" />
            </Field>
          </div>
        </Card>

        <Card className="p-6">
          <Step n={2} title={`Who is in it? (up to ${MAX_CREATORS})`} />

          {!full && (
            <CreatorPicker
              creators={creators}
              loading={loading}
              excludeIds={picked.map((c) => c.id)}
              placeholder="Search and add a creator…"
              onPick={(c) => {
                setError(null)
                setPicked((p) => [...p, c])
              }}
            />
          )}
          {full && (
            <p className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink-soft">
              That is the maximum of {MAX_CREATORS}. Each creator is five AI calls, and the free tier
              allows about two evaluations a minute, so more would be painfully slow.
            </p>
          )}

          {picked.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
              <p className="text-sm text-ink-soft">No creators added yet.</p>
              <button
                type="button"
                onClick={() => navigate('/discover')}
                className="mt-2 text-sm font-semibold text-ink underline-offset-4 hover:underline"
              >
                Find the best creators for my budget &rarr;
              </button>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
              {picked.map((c) => {
                const price = listedPrice(c, 'integration')
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{c.name}</div>
                      <div className="mt-0.5 text-xs text-ink-soft">
                        {c.platform} · {c.niche || 'no niche'} · {compact(c.subscriberCount)} {audienceWord(c)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <span className="text-sm font-medium">
                        {price ? inr(price) : <span className="text-negotiate">no price</span>}
                        {c.priceEstimated && <span className="ml-1 text-[10px] font-normal text-negotiate">est.</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPicked((p) => p.filter((x) => x.id !== c.id))}
                        aria-label={`Remove ${c.name}`}
                        className="grid h-7 w-7 place-items-center rounded-full border border-line-strong text-ink-soft transition hover:border-reject hover:text-reject"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path d="m2 2 8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card className="p-6">
          <div className="eyebrow">Campaign summary</div>
          <dl className="mt-4 space-y-3 text-sm">
            <Line label="Brand" value={brandName.trim() || '—'} />
            <Line label="Creators" value={`${picked.length} of ${MAX_CREATORS}`} />
            <Line label="Their listed prices" value={picked.length ? inr(listedTotal) : '—'} strong />
            <Line label="Total budget" value={budget ? inr(budget) : 'not set'} />
          </dl>

          {budget > 0 && picked.length > 0 && (
            <p
              className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
                overBudget
                  ? 'border-reject/30 bg-reject-bg text-reject'
                  : 'border-accept/30 bg-accept-bg text-accept'
              }`}
            >
              {overBudget
                ? `Their listed prices add up to ${inr(listedTotal - budget)} more than the budget.`
                : `${inr(budget - listedTotal)} of the budget is left at their listed prices.`}
            </p>
          )}

          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            Each creator is judged at their own listed price by five AI agents, then added up
            against the budget. Takes one to two minutes.
          </p>

          {error && <p className="mt-3 text-xs text-reject">{error}</p>}

          <PillButton onClick={submit} className="mt-5 w-full justify-between px-6 py-3">
            Evaluate {picked.length || ''} creator{picked.length === 1 ? '' : 's'}
            <ArrowCircle />
          </PillButton>
          <button
            type="button"
            onClick={() => navigate('/discover')}
            className="mt-3 w-full text-center text-xs text-ink-soft underline-offset-4 hover:text-ink hover:underline"
          >
            Rather have us suggest creators for the budget?
          </button>
        </Card>
      </aside>
    </div>
  )
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-xs font-bold text-on-ink">{n}</span>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className={`truncate text-right ${strong ? 'text-base font-bold tracking-tight' : 'font-medium'}`}>{value}</dd>
    </div>
  )
}
