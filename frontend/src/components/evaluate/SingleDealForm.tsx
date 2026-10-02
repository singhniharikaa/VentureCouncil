/**
 * Single deal: one creator, one offer.
 *
 * Laid out as three short steps on the left (creator, deal, contract) with a
 * live summary on the right, instead of four long stacked cards. The summary
 * shows what is still missing and how the offer compares with the creator's
 * own rate, so the brand sees the problem before pressing Analyze rather than
 * after.
 */
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useStore } from '../../lib/store'
import { BRAND_CATEGORIES, DEAL_TYPES, DELIVERABLE_OPTIONS } from '../../lib/seed'
import { audienceWord, compact, inr, listedPrice, parseMoney } from '../../lib/format'
import { ArrowCircle, Card, Field, PillButton, SelectInput, TextInput, TogglePill } from '../ui'
import { CreatorPicker } from './CreatorPicker'
import type { Creator, DealInput } from '../../types'

type Errors = Partial<Record<'creatorId' | 'brandName' | 'brandCategory' | 'amountInr' | 'deliverables', string>>

/**
 * One-click contracts for demonstrating the policy rule. The first is ordinary;
 * the second contains clauses that are unacceptable on their own (perpetual
 * usage rights, unpaid exclusivity), which force a "high risk" rating and so
 * make Accept impossible - see app/contract.py.
 */
const SAMPLE_FAIR =
  "Creator will publish one integrated mention within 14 days of brief approval. Brand receives 90 days of usage rights on the brand's own channels. Payment is Net-30 on delivery. Either party may cancel with 7 days notice and a 50% kill fee."
const SAMPLE_RISKY =
  'The Brand receives perpetual, worldwide, unlimited usage rights to all content in any medium. Creator grants exclusivity across all beverage and food categories for 24 months with no additional compensation. Payment is Net-90 after all deliverables. Brand may cancel at any time with no kill fee and may withhold payment at its sole discretion.'

export function SingleDealForm() {
  const { creators, loading } = useStore()
  const navigate = useNavigate()

  // Discover hands a creator over via router state.
  const handedOver = (useLocation().state as { creatorId?: string } | null)?.creatorId
  const [creatorId, setCreatorId] = useState(handedOver ?? '')
  const [brandName, setBrandName] = useState('')
  const [brandCategory, setBrandCategory] = useState('')
  const [dealType, setDealType] = useState<'integration' | 'dedicated'>('integration')
  const [amount, setAmount] = useState('')
  const [deliverables, setDeliverables] = useState<string[]>([])
  const [deadline, setDeadline] = useState('')
  const [exclusivity, setExclusivity] = useState('')
  const [contractText, setContractText] = useState('')
  const [registrationVerified, setRegistrationVerified] = useState(true)
  const [showContract, setShowContract] = useState(false)
  const [errors, setErrors] = useState<Errors>({})

  const creator = creators.find((c) => c.id === creatorId)
  const amountNum = parseMoney(amount)
  const rate = creator ? listedPrice(creator, dealType) : null
  const delta = rate && amountNum ? (amountNum / rate - 1) * 100 : null

  function validate(): Errors {
    const e: Errors = {}
    if (!creatorId) e.creatorId = 'Choose a creator.'
    if (!brandName.trim()) e.brandName = 'Brand name is required.'
    if (!brandCategory) e.brandCategory = 'Pick a category.'
    if (!amountNum) e.amountInr = 'Enter the offer amount.'
    if (deliverables.length === 0) e.deliverables = 'Pick at least one deliverable.'
    return e
  }

  function submit() {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    const input: DealInput = {
      creatorId,
      brandName: brandName.trim(),
      brandCategory,
      amountInr: amountNum,
      dealType,
      deliverables,
      deadline: deadline || null,
      exclusivityClause: exclusivity,
      contractText,
      brandRegistrationVerified: registrationVerified,
    }
    navigate('/deal-room', { state: { input } })
  }

  function reset() {
    setCreatorId('')
    setBrandName('')
    setBrandCategory('')
    setAmount('')
    setDeliverables([])
    setDeadline('')
    setExclusivity('')
    setContractText('')
    setShowContract(false)
    setErrors({})
  }

  const toggleDeliverable = (d: string) =>
    setDeliverables((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  const checklist = [
    { label: 'Creator chosen', done: !!creator },
    { label: 'Brand and category', done: !!brandName.trim() && !!brandCategory },
    { label: 'Offer amount', done: amountNum > 0 },
    { label: 'Deliverables', done: deliverables.length > 0 },
  ]
  const ready = checklist.every((c) => c.done)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        {/* ------------------------------------------------ 1. creator */}
        <Card className="p-6">
          <StepTitle n={1} title="Who is the deal with?" />
          {creator ? (
            <CreatorSnapshot creator={creator} dealType={dealType} onChange={() => setCreatorId('')} />
          ) : (
            <>
              <CreatorPicker
                creators={creators}
                loading={loading}
                invalid={!!errors.creatorId}
                onPick={(c) => {
                  setCreatorId(c.id)
                  setErrors((e) => ({ ...e, creatorId: undefined }))
                }}
              />
              {errors.creatorId && <p className="mt-2 text-xs text-reject">{errors.creatorId}</p>}
              <p className="mt-3 text-xs text-ink-faint">
                Not sure who? <button type="button" onClick={() => navigate('/discover')} className="font-semibold text-ink underline-offset-4 hover:underline">Find creators for a brief and budget</button>
              </p>
            </>
          )}
        </Card>

        {/* ------------------------------------------------ 2. the deal */}
        <Card className="p-6">
          <StepTitle n={2} title="What is being offered?" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand name" error={errors.brandName}>
              <TextInput
                value={brandName}
                onChange={setBrandName}
                placeholder="e.g. Volt Energy Drinks"
                invalid={!!errors.brandName}
              />
            </Field>
            <Field label="Industry category" error={errors.brandCategory}>
              <SelectInput
                value={brandCategory}
                onChange={setBrandCategory}
                options={BRAND_CATEGORIES}
                placeholder="Select category…"
                invalid={!!errors.brandCategory}
              />
            </Field>
          </div>

          <div className="mt-5">
            <div className="mb-1.5 text-xs font-medium text-ink-soft">Deal type</div>
            <div className="flex flex-wrap gap-2.5">
              {DEAL_TYPES.map((d) => (
                <TogglePill key={d.value} active={dealType === d.value} onClick={() => setDealType(d.value)}>
                  {d.label}
                </TogglePill>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <Field label="Offer amount" error={errors.amountInr}>
              <TextInput
                value={amount}
                onChange={setAmount}
                placeholder="35000"
                invalid={!!errors.amountInr}
                prefix="₹"
              />
            </Field>
            <OfferVsRate creator={creator} rate={rate} delta={delta} dealType={dealType} />
          </div>

          <div className="mt-5">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-medium text-ink-soft">Deliverables</span>
              {errors.deliverables && <span className="text-xs text-reject">{errors.deliverables}</span>}
            </div>
            <div className="flex flex-wrap gap-2.5">
              {DELIVERABLE_OPTIONS.map((d) => (
                <TogglePill key={d} active={deliverables.includes(d)} onClick={() => toggleDeliverable(d)}>
                  {d}
                </TogglePill>
              ))}
            </div>
          </div>

          <div className="mt-5 max-w-[220px]">
            <Field label="Target deadline" hint="Optional">
              <TextInput value={deadline} onChange={setDeadline} type="date" />
            </Field>
          </div>
        </Card>

        {/* ------------------------------------------------ 3. contract */}
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <StepTitle n={3} title="Contract terms" optional />
            <button
              type="button"
              onClick={() => setShowContract((v) => !v)}
              className="shrink-0 rounded-full border border-line-strong px-3.5 py-1.5 text-xs font-semibold transition hover:border-ink"
            >
              {showContract || contractText ? 'Hide' : 'Add contract'}
            </button>
          </div>

          {!(showContract || contractText) ? (
            <p className="text-sm text-ink-soft">
              Optional. Paste the contract and the Risk agent will read it. Clauses that are
              unacceptable on their own &mdash; perpetual usage rights, unpaid exclusivity, IP
              assignment &mdash; are caught by a fixed rule and block an Accept.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-faint">Try an example:</span>
                <button type="button" onClick={() => setContractText(SAMPLE_FAIR)} className="rounded-full border border-line bg-paper px-3 py-1 text-xs text-ink-soft transition hover:border-ink hover:text-ink">
                  Reasonable contract
                </button>
                <button type="button" onClick={() => setContractText(SAMPLE_RISKY)} className="rounded-full border border-reject/30 bg-reject-bg px-3 py-1 text-xs text-reject transition hover:border-reject">
                  Risky contract
                </button>
                {contractText && (
                  <button type="button" onClick={() => setContractText('')} className="text-xs text-ink-faint underline-offset-4 hover:underline">
                    Clear
                  </button>
                )}
              </div>
              <Field label="Contract text" hint="The Risk agent reads this, and fixed rules scan it for critical clauses.">
                <textarea
                  value={contractText}
                  onChange={(e) => setContractText(e.target.value)}
                  rows={5}
                  placeholder="Paste the relevant contract clauses here…"
                  className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none transition placeholder:text-ink-faint focus:border-ink"
                />
              </Field>
              <Field label="Exclusivity clause" hint="Optional. Paste it separately if the deal has one.">
                <TextInput
                  value={exclusivity}
                  onChange={setExclusivity}
                  placeholder="e.g. 12-month category exclusivity, no additional compensation"
                />
              </Field>
            </div>
          )}

          <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-paper px-4 py-3">
            <input
              type="checkbox"
              checked={registrationVerified}
              onChange={(e) => setRegistrationVerified(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-black"
            />
            <span className="text-xs leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">Brand business registration verified</span>
              <br />
              Untick this and the deal is rejected outright by a policy rule.
            </span>
          </label>
        </Card>
      </div>

      {/* ------------------------------------------------ live summary */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card className="p-6">
          <div className="eyebrow">Summary</div>

          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Creator" value={creator ? creator.name : '—'} />
            <Row label="Brand" value={brandName.trim() ? `${brandName.trim()}${brandCategory ? ` · ${brandCategory}` : ''}` : '—'} />
            <Row label="Offer" value={amountNum ? inr(amountNum) : '—'} strong />
            <Row label="Deliverables" value={deliverables.length ? `${deliverables.length} selected` : '—'} />
            <Row label="Contract" value={contractText ? 'provided' : 'none'} />
          </dl>

          <ul className="mt-5 space-y-2 border-t border-line pt-4">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2.5 text-xs">
                <span
                  className={`grid h-4 w-4 place-items-center rounded-full border ${
                    c.done ? 'border-accept bg-accept text-on-ink' : 'border-line-strong text-transparent'
                  }`}
                >
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="m2.5 6.2 2.4 2.4 4.6-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className={c.done ? 'text-ink' : 'text-ink-faint'}>{c.label}</span>
              </li>
            ))}
          </ul>

          <PillButton onClick={submit} className="mt-6 w-full justify-between px-6 py-3">
            Analyze deal
            <ArrowCircle />
          </PillButton>
          {!ready && (
            <p className="mt-2 text-center text-[11px] text-ink-faint">Finish the steps above to analyze.</p>
          )}
          <button
            type="button"
            onClick={reset}
            className="mt-3 w-full text-center text-xs text-ink-soft underline-offset-4 hover:text-ink hover:underline"
          >
            Clear form
          </button>
        </Card>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------ pieces */

function StepTitle({ n, title, optional }: { n: number; title: string; optional?: boolean }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-xs font-bold text-on-ink">{n}</span>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {optional && <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint">optional</span>}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className={`truncate text-right ${strong ? 'text-base font-bold tracking-tight' : 'font-medium'}`}>{value}</dd>
    </div>
  )
}

/** The chosen creator, with the facts that decide how the agents will judge them. */
function CreatorSnapshot({
  creator: c,
  dealType,
  onChange,
}: {
  creator: Creator
  dealType: 'integration' | 'dedicated'
  onChange: () => void
}) {
  const rate = listedPrice(c, dealType)
  const hasEngagement = typeof c.engagementRate === 'number' && c.engagementRate > 0
  const notes: string[] = []
  if (c.priceEstimated) notes.push('Price is estimated from similar creators, not quoted — Pricing will be less certain.')
  if (!c.niche) notes.push('No niche recorded — Audience Fit will abstain.')
  if (!hasEngagement) notes.push('No engagement rate recorded — the Engagement agent will abstain.')

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xl font-bold tracking-tight">{c.name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                c.platform === 'instagram' ? 'border-negotiate/30 bg-negotiate-bg text-negotiate' : 'border-line bg-paper'
              }`}
            >
              {c.platform}
            </span>
            <span>{c.niche || 'no niche recorded'}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 rounded-full border border-line-strong px-3.5 py-1.5 text-xs font-semibold transition hover:border-ink"
        >
          Change
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 2xl:grid-cols-4">
        <Tile label={audienceWord(c)} value={compact(c.subscriberCount)} />
        <Tile label="Engagement" value={hasEngagement ? `${(c.engagementRate as number).toFixed(2)}%` : '—'} />
        <Tile label="Listed rate" value={rate ? inr(rate) : '—'} note={c.priceEstimated ? 'estimated' : undefined} />
        <Tile label="Data confidence" value={c.dataConfidenceScore != null ? `${c.dataConfidenceScore}/100` : '—'} />
      </div>

      {notes.length > 0 && (
        <ul className="mt-4 space-y-1.5 rounded-xl border border-negotiate/25 bg-negotiate-bg px-4 py-3 text-xs text-negotiate">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className="text-base font-bold tracking-tight">
        {value}
        {note && <span className="ml-1 text-[10px] font-normal text-negotiate">{note}</span>}
      </div>
      <div className="eyebrow mt-0.5 text-[9px]">{label}</div>
    </div>
  )
}

/** How the offer compares with the creator's own rate - the single most useful number on this form. */
function OfferVsRate({
  creator,
  rate,
  delta,
  dealType,
}: {
  creator?: Creator
  rate: number | null
  delta: number | null
  dealType: 'integration' | 'dedicated'
}) {
  if (!creator) return null
  if (rate == null) {
    return (
      <p className="mt-2 text-xs text-negotiate">
        {creator.name} has no {dealType} rate on file — Pricing will rely on comparable deals and be less certain.
      </p>
    )
  }
  if (delta == null) {
    return (
      <p className="mt-2 text-xs text-ink-faint">
        {creator.name}&apos;s listed {dealType} rate is <strong className="text-ink">{inr(rate)}</strong>.
      </p>
    )
  }
  const abs = Math.abs(delta)
  const tone =
    delta > 60 ? 'text-reject' : delta > 15 ? 'text-negotiate' : delta < -15 ? 'text-ink-soft' : 'text-accept'
  const suffix =
    delta > 60
      ? ' - likely Reject, or heavy negotiation'
      : delta > 15
        ? ' - likely to need negotiation'
        : delta < -15
          ? ' - they may decline'
          : ' - a fair range'
  return (
    <p className="mt-2 text-xs text-ink-faint">
      Their listed {dealType} rate is <strong className="text-ink">{inr(rate)}</strong>.{' '}
      <span className={tone}>
        {abs < 1
          ? 'Your offer matches their rate.'
          : `Your offer is ${abs.toFixed(0)}% ${delta > 0 ? 'above' : 'below'} their rate${suffix}.`}
      </span>
    </p>
  )
}
