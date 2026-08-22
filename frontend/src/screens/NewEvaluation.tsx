import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { BRAND_CATEGORIES, DEAL_TYPES, DELIVERABLE_OPTIONS } from '../lib/seed'
import { creatorSignals } from '../lib/csv'
import { ArrowCircle, Card, Field, PillButton, SelectInput, SelectKV, TextInput, TogglePill } from '../components/ui'
import type { DealInput } from '../types'

type Errors = Partial<Record<'creatorId' | 'brandName' | 'brandCategory' | 'amountInr' | 'deliverables', string>>

const compact = (n: number) =>
  n >= 10_000_000 ? `${(n / 10_000_000).toFixed(1)}Cr` : n >= 100_000 ? `${(n / 100_000).toFixed(1)}L` : n.toLocaleString('en-IN')

export function NewEvaluation() {
  const { creators, loading } = useStore()
  const navigate = useNavigate()

  const [creatorId, setCreatorId] = useState('')
  const [brandName, setBrandName] = useState('')
  const [brandCategory, setBrandCategory] = useState('')
  const [dealType, setDealType] = useState<'integration' | 'dedicated'>('integration')
  const [amount, setAmount] = useState('')
  const [deliverables, setDeliverables] = useState<string[]>([])
  const [deadline, setDeadline] = useState('')
  const [exclusivity, setExclusivity] = useState('')
  const [contractText, setContractText] = useState('')
  const [registrationVerified, setRegistrationVerified] = useState(true)
  const [errors, setErrors] = useState<Errors>({})
  const [fileName, setFileName] = useState('')

  const creator = creators.find((c) => c.id === creatorId)
  const signals = creator ? creatorSignals(creator) : null
  const rateCard = creator
    ? dealType === 'dedicated'
      ? creator.dedicatedPriceInr
      : creator.integrationPriceInr
    : null

  function validate(): Errors {
    const e: Errors = {}
    if (!creatorId) e.creatorId = 'Select a creator from the roster.'
    if (!brandName.trim()) e.brandName = 'Brand name is required.'
    if (!brandCategory) e.brandCategory = 'Category is required for risk routing.'
    const amt = Number(amount)
    if (!amount || !Number.isFinite(amt) || amt <= 0) e.amountInr = 'Enter a deal amount above zero.'
    if (deliverables.length === 0) e.deliverables = 'Select at least one deliverable.'
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
      amountInr: Number(amount),
      dealType,
      deliverables,
      deadline: deadline || null,
      exclusivityClause: exclusivity,
      contractText,
      brandRegistrationVerified: registrationVerified,
    }
    navigate('/deal-room', { state: { input } })
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setFileName(file.name)
    if (/\.(txt|md)$/i.test(file.name)) setContractText(await file.text())
  }

  const toggleDeliverable = (d: string) =>
    setDeliverables((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight lg:text-5xl">Evaluate New Deal</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          Structured fields only — free-text intake is what makes agents guess.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-5 text-lg font-semibold">Creator</h2>
          <div className="space-y-4">
            <Field label="From roster" error={errors.creatorId}>
              <SelectKV
                value={creatorId}
                onChange={setCreatorId}
                invalid={!!errors.creatorId}
                placeholder={loading ? 'Loading roster…' : `Select from ${creators.length} creators…`}
                options={creators.map((c) => ({
                  value: c.id,
                  label: `${c.name} — ${compact(c.subscriberCount)} ${c.platform === 'instagram' ? 'followers' : 'subs'}${c.niche ? ` · ${c.niche}` : ''}`,
                }))}
              />
            </Field>

            {creator && signals && (
              <div className="space-y-2 rounded-xl border border-line bg-paper px-4 py-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">@{creator.handle}</span>
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5">
                    {signals.tier} tier
                  </span>
                </div>
                <div className="text-ink-soft">
                  {compact(creator.subscriberCount)}{' '}
                  {creator.platform === 'instagram' ? 'followers' : 'subs'}
                  {creator.platform === 'youtube' && creator.videoCount > 0
                    ? ` · ${compact(creator.totalViews)} views · ${creator.videoCount} videos`
                    : ''}
                </div>
                <div className="text-ink-soft">
                  {typeof creator.engagementRate === 'number' && creator.engagementRate > 0
                    ? `${creator.engagementRate.toFixed(2)}% engagement rate`
                    : signals.hasReachData
                      ? `${(signals.viewThroughRate * 100).toFixed(1)}% view-through`
                      : 'No engagement data — the Engagement agent will abstain'}
                </div>
                {creator.priceEstimated && (
                  <div className="text-negotiate">
                    Price is KNN-estimated, not a quoted rate.
                  </div>
                )}
                {!creator.niche && (
                  <div className="text-negotiate">
                    No niche recorded — Audience Fit will abstain.
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-5 text-lg font-semibold">Brand &amp; Scope</h2>
          <div className="space-y-4">
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
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-paper px-4 py-3">
              <input
                type="checkbox"
                checked={registrationVerified}
                onChange={(e) => setRegistrationVerified(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-black"
              />
              <span className="text-xs leading-relaxed text-ink-soft">
                <span className="font-medium text-ink">Business registration verified</span>
                <br />
                Unchecking this triggers a hard Reject policy rule.
              </span>
            </label>
          </div>
        </Card>
      </div>

      <Card className="mt-5 p-6">
        <h2 className="mb-5 text-lg font-semibold">Deal Type &amp; Fee</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Deal type" hint="Determines which rate card the Pricing agent reads.">
            <div className="flex gap-2.5">
              {DEAL_TYPES.map((d) => (
                <TogglePill
                  key={d.value}
                  active={dealType === d.value}
                  onClick={() => setDealType(d.value)}
                >
                  {d.label}
                </TogglePill>
              ))}
            </div>
          </Field>

          <Field label="Deal amount (₹)" error={errors.amountInr}>
            <TextInput
              value={amount}
              onChange={setAmount}
              placeholder="35000"
              invalid={!!errors.amountInr}
              prefix="₹"
            />
          </Field>
        </div>

        {creator && (
          <div className="mt-4 rounded-xl border border-line bg-paper px-4 py-3 text-xs">
            {rateCard !== null ? (
              <>
                Listed {dealType} rate for {creator.name}:{' '}
                <strong className="text-ink">₹{rateCard.toLocaleString('en-IN')}</strong>
              </>
            ) : (
              <span className="text-negotiate">
                No {dealType} rate on file for {creator.name} — Pricing will fall back to
                comparables and lower its confidence.
              </span>
            )}
          </div>
        )}
      </Card>

      <Card className="mt-5 p-6">
        <h2 className="mb-1 text-lg font-semibold">Required Deliverables</h2>
        {errors.deliverables && <p className="mb-3 text-xs text-reject">{errors.deliverables}</p>}
        <div className="mt-4 flex flex-wrap gap-2.5">
          {DELIVERABLE_OPTIONS.map((d) => (
            <TogglePill key={d} active={deliverables.includes(d)} onClick={() => toggleDeliverable(d)}>
              {d}
            </TogglePill>
          ))}
        </div>
        <div className="mt-5 max-w-xs">
          <Field label="Target deadline" hint="Optional">
            <TextInput value={deadline} onChange={setDeadline} type="date" />
          </Field>
        </div>
      </Card>

      <Card className="mt-5 p-6">
        <h2 className="mb-4 text-lg font-semibold">Contract Terms</h2>
        <div className="space-y-4">
          <Field label="Exclusivity clause" hint="Paste the clause text if the deal has one.">
            <TextInput
              value={exclusivity}
              onChange={setExclusivity}
              placeholder="e.g. 12-month category exclusivity, no additional compensation"
            />
          </Field>
          <Field label="Contract text" hint="Pasted clauses the Risk agent will scan.">
            <textarea
              value={contractText}
              onChange={(e) => setContractText(e.target.value)}
              rows={4}
              placeholder="Paste the relevant contract clauses here…"
              className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none transition placeholder:text-ink-faint focus:border-ink"
            />
          </Field>
        </div>

        <label className="mt-5 grid cursor-pointer place-items-center rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center transition hover:border-ink">
          <input type="file" accept=".txt,.md,.pdf,.docx" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <UploadIcon />
          <span className="mt-3 text-sm font-medium">{fileName || 'Upload draft contract'}</span>
          <span className="mt-1 text-xs text-ink-soft">
            {fileName && !/\.(txt|md)$/i.test(fileName)
              ? 'Stored for the record — text extraction runs server-side.'
              : 'Drop a .txt or .md file, or click to browse.'}
          </span>
        </label>
      </Card>

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setCreatorId('')
            setBrandName('')
            setBrandCategory('')
            setAmount('')
            setDeliverables([])
            setDeadline('')
            setExclusivity('')
            setContractText('')
            setFileName('')
            setErrors({})
          }}
          className="text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline"
        >
          Clear form
        </button>
        <PillButton onClick={submit} className="px-6 py-3">
          Analyze Deal
          <ArrowCircle />
        </PillButton>
      </div>
    </div>
  )
}

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-ink">
      <path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 16v-5m0 0-2 2m2-2 2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
