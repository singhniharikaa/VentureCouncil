/**
 * Path A — discovery.
 *
 * A brand describes what it wants in free text, narrows with hard constraints,
 * and gets ranked candidates. Picking one hands its `cr_<id>` straight to the
 * existing intake form, where it becomes a Path B evaluation.
 *
 * Discovery itself spends no LLM quota, so searching is free and repeatable;
 * agent calls are only spent on the creator the brand actually shortlists.
 * That asymmetry is why the two steps are separate screens.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { discoverCreators, useEngine } from '../lib/api'
import type { Candidate } from '../lib/api'
import { BRAND_CATEGORIES, NICHES } from '../lib/seed'
import {
  Card,
  EmptyState,
  Eyebrow,
  Field,
  PillButton,
  SelectInput,
  TextInput,
  TogglePill,
} from '../components/ui'

const PLATFORMS = ['youtube', 'instagram']

// Groq's free tier allows about two evaluations a minute, and each creator is
// five LLM calls, so more than five makes a campaign painfully slow.
const MAX_CAMPAIGN = 5

const EXAMPLES = [
  'energy drink launch aimed at mobile gaming audiences in India',
  'skincare brand wanting authentic everyday reviews',
  'creators who explain personal finance simply to young people',
]

function compact(n: number) {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`
  if (n >= 100_000) return `${(n / 100_000).toFixed(1)}L`
  return n.toLocaleString('en-IN')
}

function toInt(v: string): number | undefined {
  const n = Number(v.replace(/[^0-9]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function Discover() {
  const navigate = useNavigate()
  const engine = useEngine()

  const [brief, setBrief] = useState('')
  const [platform, setPlatform] = useState('')
  const [niche, setNiche] = useState('')
  const [budgetMin, setBudgetMin] = useState('')
  const [budgetMax, setBudgetMax] = useState('')
  const [minFollowers, setMinFollowers] = useState('10000')
  const [realPriceOnly, setRealPriceOnly] = useState(false)

  const [results, setResults] = useState<{
    candidates: Candidate[]
    filters: string[]
  } | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Campaign selection: up to five creators, in the order they were ticked.
  const [selected, setSelected] = useState<{ id: string; name: string }[]>([])
  const [brandName, setBrandName] = useState('')
  const [brandCategory, setBrandCategory] = useState('')
  const [totalBudget, setTotalBudget] = useState('')
  const [campaignError, setCampaignError] = useState<string | null>(null)

  function toggle(c: Candidate) {
    setCampaignError(null)
    setSelected((cur) =>
      cur.some((s) => s.id === c.id)
        ? cur.filter((s) => s.id !== c.id)
        : cur.length >= MAX_CAMPAIGN
          ? cur
          : [...cur, { id: c.id, name: c.name }],
    )
  }

  function startCampaign() {
    if (!brandName.trim()) {
      setCampaignError('Enter the brand name first.')
      return
    }
    navigate('/campaign', {
      state: {
        creators: selected.map((s) => ({ creatorId: s.id, name: s.name })),
        brandName: brandName.trim(),
        brandCategory,
        totalBudget: toInt(totalBudget),
        brief,
      },
    })
  }

  async function search() {
    if (brief.trim().length < 3) {
      setError('Describe what you are looking for first.')
      return
    }
    setSearching(true)
    setError(null)
    try {
      const res = await discoverCreators(brief, {
        platform: platform || undefined,
        niche: niche || undefined,
        budgetMin: toInt(budgetMin),
        budgetMax: toInt(budgetMax),
        minFollowers: toInt(minFollowers),
        realPriceOnly,
        limit: 20,
      })
      setResults({ candidates: res.candidates, filters: res.filters })
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      setResults(null)
    } finally {
      setSearching(false)
    }
  }

  // Discovery needs the Python engine: the vector search and the embedding
  // model both live there. The offline fallback cannot do this at all, so say
  // so rather than showing an empty screen.
  if (engine.status === 'offline') {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="display text-4xl">Discover</h1>
        <Card className="mt-6 border-negotiate/30 bg-negotiate-bg p-5 text-sm">
          <strong>Discovery needs the engine running.</strong> It searches the Supabase
          roster by vector similarity, which the offline fallback cannot do. Start it with:
          <div className="mono mt-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs">
            python -m uvicorn api.server:app --reload --port 8000
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <Eyebrow>Path A &middot; discovery</Eyebrow>
      <h1 className="display mt-3 text-5xl lg:text-6xl">
        Find
        <br />
        Creators
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-soft">
        Describe the campaign. Budget, platform and reach filter the roster in the
        database; semantic similarity ranks whatever survives. No agents run here &mdash;
        searching is free, and a full evaluation is only spent on who you pick.
      </p>

      <Card className="mt-8 p-6">
        <Field label="What are you looking for?">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder="e.g. energy drink launch aimed at mobile gaming audiences in India"
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-ink"
          />
        </Field>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-faint">Try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setBrief(ex)}
              className="rounded-full border border-line bg-paper px-3 py-1 text-xs text-ink-soft transition hover:border-ink hover:text-ink"
            >
              {ex.length > 44 ? `${ex.slice(0, 44)}…` : ex}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Platform" hint="Blank = both">
            <SelectInput
              value={platform}
              onChange={setPlatform}
              options={PLATFORMS}
              placeholder="Any platform"
            />
          </Field>
          <Field label="Niche" hint="Matches sub-niches too">
            <SelectInput
              value={niche}
              onChange={setNiche}
              options={NICHES}
              placeholder="Any niche"
            />
          </Field>
          <Field label="Budget per creator" hint="Excludes anyone priced above">
            <div className="flex items-center gap-2">
              <TextInput value={budgetMin} onChange={setBudgetMin} placeholder="min" prefix="₹" />
              <TextInput value={budgetMax} onChange={setBudgetMax} placeholder="max" prefix="₹" />
            </div>
          </Field>
          <Field
            label="Minimum audience"
            hint="Guards against tiny or dormant channels"
          >
            <TextInput value={minFollowers} onChange={setMinFollowers} placeholder="10000" />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <TogglePill active={realPriceOnly} onClick={() => setRealPriceOnly((v) => !v)}>
            Quoted prices only
          </TogglePill>
          <PillButton onClick={search} disabled={searching}>
            {searching ? 'Searching…' : 'Find creators'}
          </PillButton>
        </div>
        {realPriceOnly && (
          <p className="mt-2 text-xs text-ink-faint">
            Excludes creators whose price was KNN-estimated rather than quoted by the
            agency, so a budget filter means something.
          </p>
        )}
      </Card>

      {error && (
        <Card className="mt-5 border-reject/30 bg-reject-bg p-4 text-sm">{error}</Card>
      )}

      {results && (
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="eyebrow">
              {results.candidates.length} candidate{results.candidates.length === 1 ? '' : 's'}
            </h2>
            {results.filters.length > 0 && (
              <span className="text-xs text-ink-faint">
                Excluded anyone failing: {results.filters.join(' · ')}
              </span>
            )}
          </div>

          {results.candidates.length === 0 ? (
            <EmptyState
              title="Nothing matched"
              body="Every creator was excluded by the hard filters. Widen the budget, drop the niche, or lower the minimum audience."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {results.candidates.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  checked={selected.some((s) => s.id === c.id)}
                  canCheck={selected.length < MAX_CAMPAIGN}
                  onToggle={() => toggle(c)}
                  onEvaluate={() =>
                    navigate('/evaluate', { state: { creatorId: c.id, brief } })
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {selected.length > 0 && (
        <div className="sticky bottom-4 z-20 mt-8">
          <Card className="border-ink/20 p-5 shadow-lg">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[180px] flex-1">
                <div className="eyebrow">
                  Campaign &middot; {selected.length} of {MAX_CAMPAIGN} creators
                </div>
                <div className="mt-1 truncate text-sm text-ink-soft">
                  {selected.map((s) => s.name).join(', ')}
                </div>
              </div>
              <div className="w-44">
                <Field label="Brand name">
                  <TextInput value={brandName} onChange={setBrandName} placeholder="GameFuel Energy" />
                </Field>
              </div>
              <div className="w-44">
                <Field label="Category">
                  <SelectInput
                    value={brandCategory}
                    onChange={setBrandCategory}
                    options={BRAND_CATEGORIES}
                    placeholder="Select…"
                  />
                </Field>
              </div>
              <div className="w-40">
                <Field label="Total budget">
                  <TextInput value={totalBudget} onChange={setTotalBudget} placeholder="50000" prefix="₹" />
                </Field>
              </div>
              <PillButton onClick={startCampaign}>
                Evaluate {selected.length} creator{selected.length === 1 ? '' : 's'}
              </PillButton>
            </div>
            {campaignError && <p className="mt-2 text-xs text-reject">{campaignError}</p>}
            <p className="mt-2 text-xs text-ink-faint">
              Each creator is judged by five AI agents at their own listed price, then added up
              against your total budget. About one to two minutes.
            </p>
          </Card>
        </div>
      )}
    </div>
  )
}

function CandidateCard({
  candidate: c,
  checked,
  canCheck,
  onToggle,
  onEvaluate,
}: {
  candidate: Candidate
  checked: boolean
  canCheck: boolean
  onToggle: () => void
  onEvaluate: () => void
}) {
  const match = c.similarity ?? 0
  return (
    <Card className={`flex flex-col p-5 ${checked ? 'border-ink ring-1 ring-ink' : ''}`}>
      <label
        className={`mb-3 flex w-fit items-center gap-2 text-xs font-medium ${
          checked || canCheck ? 'cursor-pointer text-ink-soft' : 'cursor-not-allowed text-ink-faint'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={!checked && !canCheck}
          onChange={onToggle}
          className="h-4 w-4 accent-black"
        />
        {checked ? 'Added to campaign' : canCheck ? 'Add to campaign' : 'Campaign full (5)'}
      </label>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-bold tracking-tight">{c.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                c.platform === 'instagram'
                  ? 'border-negotiate/30 bg-negotiate-bg text-negotiate'
                  : 'border-line bg-paper text-ink-soft'
              }`}
            >
              {c.platform}
            </span>
            {c.niche ? (
              <span className="text-xs text-ink-soft">{c.niche}</span>
            ) : (
              <span className="text-xs text-negotiate">no niche recorded</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-bold leading-none tracking-tight">
            {(match * 100).toFixed(0)}%
          </div>
          <div className="eyebrow mt-1 text-[9px] text-ink-faint">match</div>
        </div>
      </div>

      {/* Match strength, shown as a bar so near-ties are visibly near-ties:
          the embedding is coarse, so 68% and 67% mean practically the same. */}
      <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-[#f0f0ed]">
        <div
          className="h-full rounded-full bg-ink"
          style={{ width: `${Math.max(0, Math.min(100, match * 100))}%` }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="eyebrow text-[9px] text-ink-faint">Audience</dt>
          <dd className="font-medium">{compact(c.subscriberCount)}</dd>
        </div>
        <div>
          <dt className="eyebrow text-[9px] text-ink-faint">Engagement</dt>
          <dd className="font-medium">
            {typeof c.engagementRate === 'number' && c.engagementRate > 0
              ? `${c.engagementRate.toFixed(2)}%`
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="eyebrow text-[9px] text-ink-faint">Price</dt>
          <dd className="font-medium">
            {c.priceInr ? `₹${c.priceInr.toLocaleString('en-IN')}` : '—'}
            {c.priceEstimated && (
              <span className="ml-1 text-[10px] font-normal text-negotiate">est.</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="eyebrow text-[9px] text-ink-faint">Data confidence</dt>
          <dd className="font-medium">
            {c.dataConfidenceScore ?? '—'}
            <span className="text-xs font-normal text-ink-faint">/100</span>
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex-1" />
      <PillButton variant="outline" onClick={onEvaluate}>
        Evaluate this deal
      </PillButton>
    </Card>
  )
}
