import type {
  AgentId,
  AgentResult,
  Comp,
  Creator,
  DealInput,
  Recommendation,
  Severity,
  TraceLine,
  Verdict,
} from '../types'
import { creatorSignals, tierFromSubscribers } from './csv'

/**
 * Local council engine.
 *
 * Every score is computed from columns the roster actually carries — subscriber
 * count, total views, video count, the creator's own rate card, and niche.
 * Where the source data has nothing to say, the agent returns
 * `insufficientData` and drops its confidence rather than inventing a number.
 *
 * Betting / non-betting classification was deliberately removed (2026-08-22):
 * coverage in the source roster is far too sparse to be reliable — 216 of 282
 * rows carry no notes value at all — so it was dropped here to match the same
 * decision already recorded for the Python engine. Do not reintroduce it
 * without new data.
 */

const RED_FLAG_PATTERNS: { pattern: RegExp; label: string; weight: number; critical?: boolean }[] = [
  { pattern: /perpetual|unlimited usage|in perpetuity/i, label: 'Perpetual / unlimited usage rights', weight: 30, critical: true },
  { pattern: /no kill fee|without kill fee|no cancellation fee/i, label: 'No kill fee on cancellation', weight: 18 },
  { pattern: /exclusiv/i, label: 'Exclusivity clause present', weight: 12 },
  { pattern: /net[-\s]?(60|90|120)/i, label: 'Net-60 or longer payment terms', weight: 16 },
  { pattern: /unlimited revisions|no revision (cap|limit)/i, label: 'No revision cap', weight: 12 },
  { pattern: /sole discretion|unilateral/i, label: 'Unilateral brand approval rights', weight: 14 },
  { pattern: /assign(ment)? of (the )?(account|ip|intellectual property)/i, label: 'Assignment of creator IP', weight: 26, critical: true },
]

/** Which creator niches a brand category naturally sits with. */
const CATEGORY_NICHE_FIT: Record<string, string[]> = {
  'Gaming Hardware': ['gaming', 'tech', 'livestream'],
  'Mobile Gaming': ['gaming', 'livestream', 'entertainment'],
  Beverages: ['gaming', 'vlog', 'comedy', 'entertainment', 'sports'],
  'Food & Beverage': ['food', 'vlog', 'comedy', 'entertainment'],
  Beauty: ['vlog', 'entertainment', 'comedy'],
  Fintech: ['finance', 'tech', 'education'],
  EdTech: ['education', 'tech', 'finance'],
  Apparel: ['vlog', 'entertainment', 'comedy', 'gaming'],
}

const AGENT_LABELS: Record<AgentId, string> = {
  audience_fit: 'Audience Fit',
  engagement: 'Engagement',
  pricing: 'Pricing',
  risk: 'Risk & Legitimacy',
  negotiation: 'Negotiation',
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

function stamp(base: number, offsetMs: number) {
  const d = new Date(base + offsetMs)
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join(':') + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const compact = (n: number) =>
  n >= 10_000_000 ? `${(n / 10_000_000).toFixed(1)}Cr` : n >= 100_000 ? `${(n / 100_000).toFixed(1)}L` : n.toLocaleString('en-IN')

function recFromScore(score: number, invert = false): Recommendation {
  const s = invert ? 100 - score : score
  if (s >= 68) return 'accept'
  if (s >= 40) return 'negotiate'
  return 'reject'
}

const base = (id: AgentId): Omit<AgentResult, 'score' | 'confidence' | 'recommendation' | 'headline' | 'reasoning'> => ({
  id,
  label: AGENT_LABELS[id],
  status: 'done',
  flags: [],
  insufficientData: false,
  trace: [],
  typed: {},
  latencyMs: 0,
  model: 'council-local',
})

// ---------------------------------------------------------------- agents

function runAudienceFit(creator: Creator, input: DealInput, t0: number): AgentResult {
  const preferred = CATEGORY_NICHE_FIT[input.brandCategory] ?? []

  // The roster has no audience demographics, so niche alignment is the only
  // honest signal available — and half the rows have no niche at all.
  if (!creator.niche) {
    return {
      ...base('audience_fit'),
      score: 50,
      confidence: 0.15,
      recommendation: 'negotiate',
      insufficientData: true,
      headline: 'No niche recorded — cannot assess fit',
      reasoning:
        `The roster row for ${creator.name} has no niche recorded, and the export carries no ` +
        `audience demographics. There is nothing to compare against the ${input.brandCategory} ` +
        `ICP, so this agent abstains rather than guessing.`,
      flags: ['Niche missing from roster'],
      trace: [
        { t: stamp(t0, 110), text: `Looking up niche for ${creator.name}.` },
        { t: stamp(t0, 300), text: `ABSTAIN: niche column empty, no demographics in source.`, tone: 'alert' },
      ],
      typed: { fit_score: null, niche: null, insufficient_data: true },
      latencyMs: 340,
    }
  }

  const direct = preferred.includes(creator.niche)
  const score = direct ? 82 : preferred.length ? 38 : 55
  const flags = direct ? [] : preferred.length ? [`Niche "${creator.niche}" outside typical ${input.brandCategory} fit`] : []

  return {
    ...base('audience_fit'),
    score,
    confidence: preferred.length ? 0.7 : 0.45,
    recommendation: recFromScore(score),
    headline: direct
      ? `${creator.niche} aligns with ${input.brandCategory}`
      : `${creator.niche} sits outside ${input.brandCategory}`,
    reasoning:
      `${creator.name} is a ${creator.niche}${creator.subNiche ? ` (${creator.subNiche})` : ''} channel. ` +
      (preferred.length
        ? `Brands in ${input.brandCategory} typically pair with ${preferred.join(', ')}. ` +
          (direct ? 'This is a direct match.' : 'This is not a natural pairing.')
        : `No reference fit list exists for ${input.brandCategory}, so confidence is reduced.`) +
      ` Note: the roster carries no audience demographics, so this is a niche-level judgement only.`,
    flags,
    trace: [
      { t: stamp(t0, 110), text: `Niche: ${creator.niche}${creator.subNiche ? ` / ${creator.subNiche}` : ''}.` },
      { t: stamp(t0, 320), text: `Reference fit for ${input.brandCategory}: ${preferred.join(', ') || 'none defined'}.` },
      direct
        ? { t: stamp(t0, 520), text: `STRONG SIGNAL: direct niche match.`, tone: 'signal' as const }
        : { t: stamp(t0, 520), text: `MISMATCH: niche outside reference fit.`, tone: 'alert' as const },
    ],
    typed: { fit_score: score, niche: creator.niche, sub_niche: creator.subNiche || null, direct_match: direct },
    latencyMs: 640,
  }
}

/**
 * Below this, views-per-subscriber stops meaning anything — the roster has rows
 * with single-digit subscriber counts where the ratio computes to several hundred
 * percent purely because the denominator is tiny.
 */
const MIN_SUBS_FOR_VTR = 1000

function runEngagement(creator: Creator, t0: number): AgentResult {
  const s = creatorSignals(creator)

  if (s.hasReachData && creator.subscriberCount < MIN_SUBS_FOR_VTR) {
    return {
      ...base('engagement'),
      score: 50,
      confidence: 0.1,
      recommendation: 'negotiate',
      insufficientData: true,
      headline: `Only ${creator.subscriberCount.toLocaleString('en-IN')} subscribers`,
      reasoning:
        `${creator.name} has ${creator.subscriberCount.toLocaleString('en-IN')} subscribers. Below ` +
        `${MIN_SUBS_FOR_VTR.toLocaleString('en-IN')} the views-per-subscriber ratio stops being ` +
        `meaningful — a handful of views against a tiny subscriber base produces a percentage that ` +
        `looks impressive but says nothing. This agent abstains.`,
      flags: ['Subscriber base too small to assess'],
      trace: [
        { t: stamp(t0, 90), text: `Subscribers ${creator.subscriberCount}, videos ${creator.videoCount}.` },
        { t: stamp(t0, 260), text: `ABSTAIN: below the ${MIN_SUBS_FOR_VTR} subscriber floor for a meaningful ratio.`, tone: 'alert' },
      ],
      typed: {
        view_through_rate: null,
        subscriber_count: creator.subscriberCount,
        insufficient_data: true,
      },
      latencyMs: 300,
    }
  }

  if (!s.hasReachData) {
    return {
      ...base('engagement'),
      score: 50,
      confidence: 0.1,
      recommendation: 'negotiate',
      insufficientData: true,
      headline: 'No usable reach data',
      reasoning: `${creator.name} has ${creator.subscriberCount} subscribers and ${creator.videoCount} videos recorded — not enough to compute a view-through rate.`,
      flags: ['Reach data missing or zero'],
      trace: [
        { t: stamp(t0, 90), text: `Reading reach counts.` },
        { t: stamp(t0, 260), text: `ABSTAIN: subscriber or video count is zero.`, tone: 'alert' },
      ],
      typed: { view_through_rate: null, insufficient_data: true },
      latencyMs: 280,
    }
  }

  // Views per video against subscriber base. Around 0.10-0.30 is normal for an
  // active channel; far below suggests a subscriber base that no longer watches.
  const vtr = s.viewThroughRate

  // Saturating curve, not linear: reaching well beyond your subscriber base is
  // good, but 150% is not seven times better than 20% and a linear scale would
  // let one outlier channel dominate the council's weighting.
  const score = Math.round(
    vtr <= 0.2 ? clamp((vtr / 0.2) * 62) : clamp(62 + 38 * (1 - Math.exp(-(vtr - 0.2) / 0.3))),
  )

  const flags: string[] = []
  if (vtr < 0.05) flags.push('View-through rate under 5% of subscriber base')
  if (vtr < 0.02) flags.push('Subscriber base appears largely inactive')
  if (creator.videoCount < 20) flags.push(`Thin catalogue (${creator.videoCount} videos)`)

  const severe = vtr < 0.02

  return {
    ...base('engagement'),
    score,
    confidence: creator.videoCount >= 20 ? 0.82 : 0.5,
    recommendation: recFromScore(score),
    headline: `${(vtr * 100).toFixed(1)}% view-through · ${compact(Math.round(s.avgViewsPerVideo))} avg views`,
    reasoning:
      `${compact(creator.totalViews)} total views across ${creator.videoCount} videos gives ` +
      `${compact(Math.round(s.avgViewsPerVideo))} average views per video against ` +
      `${compact(creator.subscriberCount)} subscribers — a view-through rate of ${(vtr * 100).toFixed(1)}%. ` +
      (severe
        ? 'That is low enough to suggest the subscriber base is largely inactive.'
        : vtr > 0.25
          ? 'That is strong; videos reach well beyond the subscriber base.'
          : 'That sits in a normal band for an active channel.'),
    severity: severe ? 'high' : vtr < 0.05 ? 'medium' : 'low',
    flags,
    trace: [
      { t: stamp(t0, 90), text: `Subscribers ${compact(creator.subscriberCount)}, videos ${creator.videoCount}.` },
      { t: stamp(t0, 300), text: `Avg views/video ${compact(Math.round(s.avgViewsPerVideo))}.` },
      { t: stamp(t0, 470), text: `View-through rate ${(vtr * 100).toFixed(1)}%.` },
      severe
        ? { t: stamp(t0, 640), text: `ALERT: inactive subscriber base suspected.`, tone: 'alert' as const }
        : { t: stamp(t0, 640), text: `STRONG SIGNAL: reach consistent with an active channel.`, tone: 'signal' as const },
    ],
    typed: {
      view_through_rate: Number((vtr * 100).toFixed(2)),
      avg_views_per_video: Math.round(s.avgViewsPerVideo),
      subscriber_count: creator.subscriberCount,
      video_count: creator.videoCount,
    },
    latencyMs: 720,
  }
}

function runPricing(creator: Creator, input: DealInput, comps: Comp[], t0: number): AgentResult {
  // The creator's own rate card is the strongest ground truth available.
  const cardPrice =
    input.dealType === 'dedicated' ? creator.dedicatedPriceInr : creator.integrationPriceInr
  const trace: TraceLine[] = [
    { t: stamp(t0, 120), text: `Deal type: ${input.dealType}. Checking rate card.` },
  ]

  if (cardPrice !== null) {
    const deviation = ((input.amountInr - cardPrice) / cardPrice) * 100
    const score = Math.round(clamp(62 + deviation * 1.1))
    const flags: string[] = []
    if (deviation < -20) flags.push(`Offer ${Math.abs(deviation).toFixed(0)}% below the creator's own rate`)
    if (deviation > 40) flags.push('Offer well above rate card — check scope creep')

    trace.push(
      { t: stamp(t0, 340), text: `Rate card found: ${inr(cardPrice)} for ${input.dealType}.` },
      {
        t: stamp(t0, 540),
        text: `Offer ${inr(input.amountInr)} deviates ${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}%.`,
        tone: deviation < -20 ? ('alert' as const) : ('normal' as const),
      },
    )

    return {
      ...base('pricing'),
      score,
      confidence: 0.92,
      recommendation: recFromScore(score),
      headline: `Rate card ${inr(cardPrice)} · ${deviation >= 0 ? '+' : ''}${deviation.toFixed(0)}%`,
      reasoning:
        `${creator.name}'s listed ${input.dealType} rate is ${inr(cardPrice)}. The ${inr(input.amountInr)} ` +
        `offer is ${Math.abs(deviation).toFixed(1)}% ${deviation >= 0 ? 'above' : 'below'} that. ` +
        `This compares against the creator's own quoted price, not an inferred market rate.`,
      flags,
      trace,
      typed: {
        rate_card_inr: cardPrice,
        deal_type: input.dealType,
        deviation_pct: Number(deviation.toFixed(1)),
        basis: 'creator rate card',
      },
      latencyMs: 880,
    }
  }

  // No rate card for this deal type — fall back to comparable creators.
  const usable = comps.filter((c) => c.dealType === input.dealType)
  trace.push({
    t: stamp(t0, 340),
    text: `No ${input.dealType} rate on file. Falling back to comparables.`,
    tone: 'alert',
  })

  if (usable.length === 0) {
    return {
      ...base('pricing'),
      score: 50,
      confidence: 0.12,
      recommendation: 'negotiate',
      insufficientData: true,
      headline: 'No rate card and no comparables',
      reasoning:
        `${creator.name} has no ${input.dealType} price on file, and no comparable ${input.dealType} ` +
        `deals were retrieved for this tier. There is no basis to judge the offer — this needs a ` +
        `human to quote before the deal can be assessed.`,
      flags: ['No rate card', 'No comparables retrieved'],
      trace: [...trace, { t: stamp(t0, 520), text: `ABSTAIN: no pricing basis.`, tone: 'alert' }],
      typed: { rate_card_inr: null, comps_used: 0, insufficient_data: true },
      latencyMs: 520,
    }
  }

  const median = [...usable.map((c) => c.amountInr)].sort((a, b) => a - b)[Math.floor(usable.length / 2)]
  const deviation = ((input.amountInr - median) / median) * 100
  const score = Math.round(clamp(62 + deviation * 0.9))
  const flags = ['Priced from comparables — creator has no rate card']
  if (deviation < -25) flags.push('Offer well below comparable median')

  trace.push(
    { t: stamp(t0, 520), text: `${usable.length} comparable ${input.dealType} deals in this tier.` },
    { t: stamp(t0, 700), text: `Median ${inr(median)}; offer deviates ${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}%.` },
  )

  return {
    ...base('pricing'),
    score,
    confidence: usable.length >= 3 ? 0.6 : 0.4,
    recommendation: recFromScore(score),
    headline: `Comp median ${inr(median)} · ${deviation >= 0 ? '+' : ''}${deviation.toFixed(0)}%`,
    reasoning:
      `${creator.name} has no ${input.dealType} rate on file. Against ${usable.length} comparable ` +
      `${input.dealType} deals for ${tierFromSubscribers(creator.subscriberCount)}-tier creators the ` +
      `median is ${inr(median)}, putting this offer ${Math.abs(deviation).toFixed(1)}% ` +
      `${deviation >= 0 ? 'above' : 'below'} it. Confidence is reduced — this is inferred, not quoted.`,
    flags,
    trace,
    typed: {
      rate_card_inr: null,
      comp_median_inr: median,
      comps_used: usable.length,
      deviation_pct: Number(deviation.toFixed(1)),
      basis: 'comparables',
    },
    latencyMs: 1040,
  }
}

function runRisk(_creator: Creator, input: DealInput, t0: number): AgentResult {
  const haystack = `${input.contractText} ${input.exclusivityClause}`
  const hits = RED_FLAG_PATTERNS.filter((p) => p.pattern.test(haystack))

  const uncompensatedExclusivity =
    /exclusiv/i.test(haystack) && !/compensat|additional fee|paid separately/i.test(haystack)

  let risk = hits.reduce((acc, h) => acc + h.weight, 0)
  if (uncompensatedExclusivity) risk += 22
  if (!input.brandRegistrationVerified) risk += 25

  const flags = hits.map((h) => h.label)
  if (uncompensatedExclusivity) flags.push('Exclusivity with no stated compensation')
  if (!input.brandRegistrationVerified) flags.push('Brand business registration unverified')

  risk = clamp(risk)
  const hasCritical = hits.some((h) => h.critical) || uncompensatedExclusivity
  const severity: Severity =
    risk >= 70 && hasCritical ? 'critical' : risk >= 55 ? 'high' : risk >= 30 ? 'medium' : 'low'

  return {
    ...base('risk'),
    score: risk,
    confidence: 0.9,
    recommendation: recFromScore(risk, true),
    headline: `Risk ${risk}/100 · ${severity}`,
    reasoning: flags.length
      ? `Found ${flags.length} issue(s): ${flags.join('; ')}. Composite risk ${risk} (${severity}).`
      : `No red-flag clause patterns matched and the brand's registration is verified. ` +
        `Composite risk ${risk} (${severity}).`,
    severity,
    flags,
    trace: [
      { t: stamp(t0, 140), text: `Matching clauses against red-flag reference library.` },
      { t: stamp(t0, 400), text: `${hits.length} pattern match(es).` },
      ...flags.slice(0, 3).map((f, i) => ({
        t: stamp(t0, 680 + i * 70),
        text: `FLAG: ${f}`,
        tone: 'alert' as const,
      })),
      {
        t: stamp(t0, 940),
        text: `Composite risk ${risk}. Severity ${severity.toUpperCase()}.`,
        tone: severity === 'critical' ? ('alert' as const) : ('normal' as const),
      },
    ],
    typed: {
      risk_score: risk,
      clause_flags: flags,
      brand_legitimacy_flag: input.brandRegistrationVerified,
      severity,
    },
    latencyMs: 1180,
  }
}

function runNegotiation(pricing: AgentResult, risk: AgentResult, input: DealInput, t0: number): AgentResult {
  const rateCard = pricing.typed.rate_card_inr
  const compMedian = pricing.typed.comp_median_inr
  const reference = typeof rateCard === 'number' ? rateCard : typeof compMedian === 'number' ? compMedian : null
  const deviation = Number(pricing.typed.deviation_pct ?? 0)

  const asks: string[] = []
  if (reference !== null && input.amountInr < reference * 0.9) {
    asks.push(`raise fee toward ${inr(reference)}`)
  }
  if (risk.flags.some((f) => /perpetual|unlimited usage/i.test(f))) asks.push('cap usage rights at 90 days')
  if (risk.flags.some((f) => /Exclusivity with no stated compensation/i.test(f))) asks.push('add explicit exclusivity compensation')
  if (risk.flags.some((f) => /Net-60/i.test(f))) asks.push('shorten payment terms to Net-30')
  if (risk.flags.some((f) => /kill fee/i.test(f))) asks.push('add a 50% kill fee')

  const pushback = clamp((reference !== null && deviation < -10 ? 45 : 12) + risk.score * 0.5)
  const walkAway = reference !== null ? Math.round(reference * 0.85) : null

  return {
    ...base('negotiation'),
    score: Math.round(pushback),
    confidence: pricing.insufficientData ? 0.4 : 0.76,
    recommendation: pushback > 55 ? 'negotiate' : 'accept',
    headline: asks.length ? `${asks.length} counter-ask(s)` : 'Accept as-is',
    reasoning: asks.length
      ? `Recommend countering on: ${asks.join('; ')}.` +
        (walkAway !== null ? ` Walk-away floor ${inr(walkAway)}.` : ' No walk-away floor — pricing has no basis.')
      : `Pricing sits close to the reference and no material clause risk was flagged. No counter needed.`,
    flags: asks,
    trace: [
      { t: stamp(t0, 100), text: `Reading Pricing and Risk outputs (gated start).` },
      { t: stamp(t0, 300), text: `Deviation ${deviation >= 0 ? '+' : ''}${deviation}% · risk ${risk.score}.` },
      ...asks.map((a, i) => ({ t: stamp(t0, 460 + i * 70), text: `COUNTER-ASK: ${a}.` })),
      {
        t: stamp(t0, 820),
        text: asks.length
          ? `Counter-position drafted.${walkAway !== null ? ` Walk-away ${inr(walkAway)}.` : ''}`
          : `Terms acceptable as-is.`,
        tone: asks.length ? ('normal' as const) : ('signal' as const),
      },
    ],
    typed: {
      counter_position: asks.join('; ') || 'accept as-is',
      walk_away_threshold: walkAway,
      pushback_score: Math.round(pushback),
    },
    latencyMs: 760,
  }
}

// ------------------------------------------------------- supervisor

const RANK: Record<Recommendation, number> = { accept: 0, negotiate: 1, reject: 2 }

export function consolidate(agents: AgentResult[], _creator: Creator, input: DealInput): Verdict {
  const risk = agents.find((a) => a.id === 'risk')!
  const pricing = agents.find((a) => a.id === 'pricing')!
  const audience = agents.find((a) => a.id === 'audience_fit')!
  const engagement = agents.find((a) => a.id === 'engagement')!

  // Abstaining agents are dropped from the weighting rather than counted as a
  // neutral 50 — a missing signal should widen uncertainty, not pull the score
  // toward the middle.
  const contributions: { score: number; weight: number }[] = []
  if (!audience.insufficientData) contributions.push({ score: audience.score, weight: 0.2 })
  if (!engagement.insufficientData) contributions.push({ score: engagement.score, weight: 0.15 })
  if (!pricing.insufficientData) contributions.push({ score: pricing.score, weight: 0.3 })
  contributions.push({ score: 100 - risk.score, weight: 0.35 })

  const totalWeight = contributions.reduce((a, c) => a + c.weight, 0)
  const weighted = contributions.reduce((a, c) => a + c.score * c.weight, 0) / totalWeight

  const abstained = agents.filter((a) => a.insufficientData)

  let decision: Recommendation = weighted >= 66 ? 'accept' : weighted >= 42 ? 'negotiate' : 'reject'

  let override: Verdict['override'] = {
    fired: false,
    changedOutcome: false,
    rule: '',
    reason: '',
    floor: decision,
  }

  if (!input.brandRegistrationVerified) {
    override = {
      fired: true,
      changedOutcome: false,
      rule: 'BRAND_LEGITIMACY_UNVERIFIED',
      reason: 'Brand business registration could not be verified. This forces a hard Reject with no model discretion.',
      floor: 'reject',
    }
  } else if (risk.severity === 'critical') {
    override = {
      fired: true,
      changedOutcome: false,
      rule: 'RISK_SEVERITY_CRITICAL',
      reason: `Risk & Legitimacy returned severity "critical" (score ${risk.score}), which sets a verdict floor of Negotiate regardless of the other agents.`,
      floor: 'negotiate',
    }
  } else if (pricing.insufficientData) {
    override = {
      fired: true,
      changedOutcome: false,
      rule: 'NO_PRICING_BASIS',
      reason: 'The creator has no rate card for this deal type and no comparables were retrieved. Without a pricing basis the deal cannot be accepted outright.',
      floor: 'negotiate',
    }
  } else if (engagement.insufficientData) {
    // Reach is what is actually being bought. If it could not be measured at all,
    // an outright Accept would be asserting something the data never supported.
    override = {
      fired: true,
      changedOutcome: false,
      rule: 'NO_REACH_BASIS',
      reason: `Engagement could not assess this channel (${engagement.headline.toLowerCase()}). Reach is the thing being purchased, so without it the deal cannot be accepted outright.`,
      floor: 'negotiate',
    }
  }

  if (override.fired) {
    override.changedOutcome = RANK[override.floor] > RANK[decision]
    if (override.changedOutcome) decision = override.floor
  }

  const confident = agents.filter((a) => a.confidence >= 0.6 && !a.insufficientData)
  const accepts = confident.filter((a) => a.recommendation === 'accept')
  const rejects = confident.filter((a) => a.recommendation === 'reject')
  const councilSplit = accepts.length > 0 && rejects.length > 0

  const splitReason = councilSplit
    ? `${accepts.map((a) => a.label).join(', ')} favour proceeding while ${rejects
        .map((a) => a.label)
        .join(', ')} oppose. The disagreement is shown rather than averaged away.`
    : ''

  const outcomeCopy: Record<Recommendation, string> = {
    accept: 'The rate and the channel data both hold up.',
    negotiate: 'Workable, but specific terms need to move before signing.',
    reject: 'The economics and risk profile do not justify proceeding.',
  }

  const abstainNote = abstained.length
    ? ` ${abstained.map((a) => a.label).join(' and ')} abstained — the roster row is missing the data ${
        abstained.length > 1 ? 'they' : 'it'
      } would need.`
    : ''

  const summary =
    (override.fired
      ? `${override.reason} ${
          override.changedOutcome
            ? `The council's own lean was ${weighted.toFixed(0)}/100; the rule raised the verdict to ${decision}.`
            : `The council had independently landed on ${decision} (lean ${weighted.toFixed(0)}/100), so the rule confirmed rather than changed it.`
        }`
      : councilSplit
        ? `The council is split. ${splitReason} Weighted lean ${weighted.toFixed(0)}/100 — ${outcomeCopy[decision]}`
        : `Council aligned at ${weighted.toFixed(0)}/100. ${outcomeCopy[decision]}`) + abstainNote

  return { decision, summary, override, councilSplit, splitReason }
}

// ------------------------------------------------------- runner

export interface CouncilProgress {
  agents: AgentResult[]
  verdict: Verdict | null
  comps: Comp[]
  done: boolean
}

/** Comparable deals drawn from other creators' rate cards in the same tier. */
export function buildComps(creator: Creator, roster: Creator[], dealType: 'integration' | 'dedicated'): Comp[] {
  const tier = tierFromSubscribers(creator.subscriberCount)
  return roster
    .filter((c) => c.id !== creator.id)
    .map((c) => {
      const price = dealType === 'dedicated' ? c.dedicatedPriceInr : c.integrationPriceInr
      if (price === null) return null
      const sameTier = tierFromSubscribers(c.subscriberCount) === tier
      const sameNiche = !!creator.niche && c.niche === creator.niche
      // Cheap stand-in for embedding distance until the pgvector backend is wired.
      const distance = (sameTier ? 0 : 0.12) + (sameNiche ? 0 : 0.08) + Math.random() * 0.02
      return {
        id: c.id,
        creatorName: c.name,
        niche: c.niche || '—',
        tier: tierFromSubscribers(c.subscriberCount),
        subscriberCount: c.subscriberCount,
        amountInr: price,
        dealType,
        distance,
      } as Comp
    })
    .filter((c): c is Comp => c !== null)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
}

export function runCouncil(
  input: DealInput,
  creator: Creator,
  roster: Creator[],
  onProgress: (p: CouncilProgress) => void,
): () => void {
  const t0 = Date.now()
  const timers: number[] = []
  const comps = buildComps(creator, roster, input.dealType)

  const pending = (id: AgentId): AgentResult => ({
    ...base(id),
    status: id === 'negotiation' ? 'pending' : 'running',
    score: 0,
    confidence: 0,
    recommendation: 'negotiate',
    headline: '',
    reasoning: '',
  })

  const state: CouncilProgress = {
    agents: (['audience_fit', 'engagement', 'pricing', 'risk', 'negotiation'] as AgentId[]).map(pending),
    verdict: null,
    comps,
    done: false,
  }
  onProgress({ ...state, agents: [...state.agents] })

  const land = (result: AgentResult, delay: number) => {
    timers.push(
      window.setTimeout(() => {
        state.agents = state.agents.map((a) => (a.id === result.id ? result : a))
        onProgress({ ...state, agents: [...state.agents] })
      }, delay),
    )
  }

  const audience = runAudienceFit(creator, input, t0)
  const engagement = runEngagement(creator, t0)
  const pricing = runPricing(creator, input, comps, t0)
  const risk = runRisk(creator, input, t0)

  land(audience, 900)
  land(engagement, 1150)
  land(pricing, 1500)
  land(risk, 1850)

  timers.push(
    window.setTimeout(() => {
      state.agents = state.agents.map((a) =>
        a.id === 'negotiation' ? { ...a, status: 'running' as const } : a,
      )
      onProgress({ ...state, agents: [...state.agents] })
    }, 1900),
  )

  const negotiation = runNegotiation(pricing, risk, input, t0 + 1900)
  land(negotiation, 2700)

  timers.push(
    window.setTimeout(() => {
      const finished = [audience, engagement, pricing, risk, negotiation]
      state.agents = finished
      state.verdict = consolidate(finished, creator, input)
      state.done = true
      onProgress({ ...state, agents: [...state.agents] })
    }, 3100),
  )

  return () => timers.forEach((t) => window.clearTimeout(t))
}
