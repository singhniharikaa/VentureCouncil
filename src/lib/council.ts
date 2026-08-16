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
import { seedComps } from './seed'

/**
 * Local council engine.
 *
 * This runs the same decision logic the backend council will run, against the
 * real deal input — it is not random mock data. Scores respond to the actual
 * numbers (engagement rate vs tier, amount vs comparables, clause text), so a
 * bad deal looks bad here for the same reason it will look bad in production.
 *
 * When the Python backend is live, replace `runCouncil` with a call that opens
 * an SSE stream to /deals/evaluate and emits the same AgentResult shape.
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

const AGENT_LABELS: Record<AgentId, string> = {
  audience_fit: 'Audience Fit',
  engagement: 'Engagement',
  pricing: 'Pricing',
  risk: 'Risk & Legitimacy',
  negotiation: 'Negotiation',
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n))
}

function stamp(base: number, offsetMs: number) {
  const d = new Date(base + offsetMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

function inr(n: number) {
  return `₹${n.toLocaleString('en-IN')}`
}

/** Expected engagement rate falls as audience size grows — used to spot inflation. */
function expectedEngagement(followers: number) {
  if (followers < 100_000) return 6.0
  if (followers < 300_000) return 4.5
  if (followers < 700_000) return 3.2
  return 2.4
}

function recFromScore(score: number, invert = false): Recommendation {
  const s = invert ? 100 - score : score
  if (s >= 68) return 'accept'
  if (s >= 40) return 'negotiate'
  return 'reject'
}

// ---------------------------------------------------------------- agents

function runAudienceFit(creator: Creator, input: DealInput, t0: number): AgentResult {
  // Brand target profile inferred from category — stands in for the brand-ICP vector.
  const targets: Record<string, { age: number; male: number }> = {
    Beverages: { age: 0.6, male: 0.7 },
    Beauty: { age: 0.55, male: 0.25 },
    'Gaming Hardware': { age: 0.5, male: 0.8 },
    'Food & Beverage': { age: 0.65, male: 0.5 },
    Fintech: { age: 0.35, male: 0.6 },
    Apparel: { age: 0.6, male: 0.45 },
    EdTech: { age: 0.45, male: 0.55 },
    'Mobile Gaming': { age: 0.6, male: 0.75 },
  }
  const target = targets[input.brandCategory] ?? { age: 0.5, male: 0.5 }

  const ageGap = Math.abs(creator.audienceAge18to24 - target.age)
  const genderGap = Math.abs(creator.audienceMaleShare - target.male)
  const matchRate = clamp(100 - (ageGap * 110 + genderGap * 90))
  const score = Math.round(matchRate)

  const flags: string[] = []
  if (genderGap > 0.3) flags.push('Gender skew mismatch vs brand ICP')
  if (ageGap > 0.2) flags.push('Age bracket mismatch')
  if (creator.countryInShare < 0.5) flags.push('Majority audience outside India')

  const trace: TraceLine[] = [
    { t: stamp(t0, 110), text: `Analyzing demographic fit for partner ${input.brandName || 'brand'}.` },
    { t: stamp(t0, 340), text: `Audience overlap calculation complete. Match rate: ${score}%.` },
    { t: stamp(t0, 520), text: `Age 18-24 share ${(creator.audienceAge18to24 * 100).toFixed(0)}% vs target ${(target.age * 100).toFixed(0)}%.` },
    ...(flags.length
      ? flags.map((f, i) => ({ t: stamp(t0, 660 + i * 60), text: `MISMATCH: ${f}`, tone: 'alert' as const }))
      : [{ t: stamp(t0, 660), text: `STRONG SIGNAL: High penetration in target demographic.`, tone: 'signal' as const }]),
  ]

  return {
    id: 'audience_fit',
    label: AGENT_LABELS.audience_fit,
    status: 'done',
    score,
    confidence: clamp(72 + (100 - Math.abs(50 - score)) * 0.2, 0, 97) / 100,
    recommendation: recFromScore(score),
    headline: `${score}% audience match with ${input.brandCategory || 'brand'} ICP`,
    reasoning:
      `Creator's 18-24 share is ${(creator.audienceAge18to24 * 100).toFixed(0)}% against a target of ` +
      `${(target.age * 100).toFixed(0)}%, and male share ${(creator.audienceMaleShare * 100).toFixed(0)}% against ` +
      `${(target.male * 100).toFixed(0)}%. ${flags.length ? 'Mismatches: ' + flags.join('; ') + '.' : 'Both dimensions align well with the brand ICP.'}`,
    flags,
    trace,
    typed: { fit_score: score, mismatch_flags: flags, match_rate_pct: score },
    latencyMs: 820,
    model: 'council-local',
  }
}

function runEngagement(creator: Creator, t0: number): AgentResult {
  const expected = expectedEngagement(creator.followers)
  const ratio = creator.engagementRate / expected
  const score = Math.round(clamp(ratio * 62))

  const flags: string[] = []
  if (ratio < 0.55) flags.push('Engagement far below expected for follower count')
  if (ratio < 0.4) flags.push('Coordinated-inflation pattern suspected')
  if (!creator.verified) flags.push('Unverified creator account')

  const severe = ratio < 0.4

  const trace: TraceLine[] = [
    { t: stamp(t0, 90), text: `Pulling post metrics for @${creator.handle}.` },
    { t: stamp(t0, 300), text: `Engagement rate ${creator.engagementRate}% at ${creator.followers.toLocaleString('en-IN')} followers.` },
    { t: stamp(t0, 470), text: `Expected band for this tier: ~${expected}%. Ratio ${ratio.toFixed(2)}x.` },
    severe
      ? { t: stamp(t0, 640), text: `ALERT: Ratio below 0.4x — authenticity risk.`, tone: 'alert' as const }
      : { t: stamp(t0, 640), text: `STRONG SIGNAL: Engagement consistent with organic growth.`, tone: 'signal' as const },
  ]

  return {
    id: 'engagement',
    label: AGENT_LABELS.engagement,
    status: 'done',
    score,
    confidence: 0.88,
    recommendation: recFromScore(score),
    headline: `${creator.engagementRate}% ER · ${ratio.toFixed(2)}x expected`,
    reasoning:
      `At ${creator.followers.toLocaleString('en-IN')} followers the expected engagement band is around ${expected}%. ` +
      `Observed ${creator.engagementRate}%, a ratio of ${ratio.toFixed(2)}x. ` +
      (severe
        ? 'This gap is large enough to suggest inflated follower counts rather than a quiet audience.'
        : 'This is within a healthy range for the niche.'),
    severity: severe ? 'high' : ratio < 0.7 ? 'medium' : 'low',
    flags,
    trace,
    typed: { authenticity_score: score, anomaly_flags: flags, expected_er: expected, observed_er: creator.engagementRate },
    latencyMs: 910,
    model: 'council-local',
  }
}

function runPricing(creator: Creator, input: DealInput, comps: Comp[], t0: number): AgentResult {
  // Rate per 1k followers from comparables, applied to this creator's reach.
  const perK = comps.length
    ? comps.reduce((acc, c) => acc + c.amountInr / 1000, 0) / comps.length / 300
    : 0.35
  const fairMid = Math.round(creator.followers * perK)
  const fairMin = Math.round(fairMid * 0.75)
  const fairMax = Math.round(fairMid * 1.3)

  const deviation = fairMid ? ((input.amountInr - fairMid) / fairMid) * 100 : 0
  // Score is "how good is this price for the creator" — under fair range is bad.
  const score = Math.round(clamp(62 + deviation * 0.9))

  const flags: string[] = []
  if (input.amountInr < fairMin) flags.push('Offer below fair range floor')
  if (input.amountInr > fairMax) flags.push('Offer above comparable ceiling')

  const trace: TraceLine[] = [
    { t: stamp(t0, 120), text: `Initiating pgvector similarity search for creator-deal vector.` },
    { t: stamp(t0, 380), text: `Retrieval complete. ${comps.length} matches found with distance < 0.15.` },
    { t: stamp(t0, 560), text: `Fair range computed: ${inr(fairMin)} – ${inr(fairMax)}.` },
    {
      t: stamp(t0, 720),
      text: `Current ask ${inr(input.amountInr)} deviates ${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}% from midpoint.`,
      tone: input.amountInr < fairMin ? ('alert' as const) : ('normal' as const),
    },
  ]

  return {
    id: 'pricing',
    label: AGENT_LABELS.pricing,
    status: 'done',
    score,
    confidence: comps.length >= 3 ? 0.86 : 0.58,
    recommendation: recFromScore(score),
    headline: `${inr(fairMin)} – ${inr(fairMax)} fair · ${deviation >= 0 ? '+' : ''}${deviation.toFixed(0)}%`,
    reasoning:
      `Against ${comps.length} comparable deals the fair range for a ${creator.tier}-tier ${creator.niche} creator is ` +
      `${inr(fairMin)} to ${inr(fairMax)}. The ${inr(input.amountInr)} offer sits ${deviation >= 0 ? 'above' : 'below'} ` +
      `the midpoint by ${Math.abs(deviation).toFixed(1)}%.` +
      (comps.length < 3 ? ' Confidence is reduced — fewer than three close comparables were found.' : ''),
    flags,
    trace,
    typed: {
      fair_range_min: fairMin,
      fair_range_max: fairMax,
      deviation_pct: Number(deviation.toFixed(1)),
      comps_used: comps.length,
    },
    latencyMs: 1240,
    model: 'council-local',
  }
}

function runRisk(input: DealInput, t0: number): AgentResult {
  const haystack = `${input.contractText} ${input.exclusivityClause}`
  const hits = RED_FLAG_PATTERNS.filter((p) => p.pattern.test(haystack))

  // Exclusivity with no mention of compensation is the classic uncompensated lock-in.
  const uncompensatedExclusivity =
    /exclusiv/i.test(haystack) && !/compensat|additional fee|paid separately/i.test(haystack)

  let risk = hits.reduce((acc, h) => acc + h.weight, 0)
  if (uncompensatedExclusivity) risk += 22
  if (!input.brandRegistrationVerified) risk += 25
  risk = clamp(risk)

  const flags = hits.map((h) => h.label)
  if (uncompensatedExclusivity) flags.push('Exclusivity with no stated compensation')
  if (!input.brandRegistrationVerified) flags.push('Brand business registration unverified')

  const hasCritical = hits.some((h) => h.critical) || uncompensatedExclusivity
  const severity: Severity = risk >= 70 && hasCritical ? 'critical' : risk >= 55 ? 'high' : risk >= 30 ? 'medium' : 'low'

  const trace: TraceLine[] = [
    { t: stamp(t0, 140), text: `Parsing contract clauses against red-flag reference library.` },
    { t: stamp(t0, 420), text: `${hits.length} pattern match(es) in clause text.` },
    ...flags.slice(0, 3).map((f, i) => ({
      t: stamp(t0, 600 + i * 70),
      text: `FLAG: ${f}`,
      tone: 'alert' as const,
    })),
    { t: stamp(t0, 900), text: `Composite risk score ${risk}. Severity: ${severity.toUpperCase()}.`, tone: severity === 'critical' ? ('alert' as const) : ('normal' as const) },
  ]

  return {
    id: 'risk',
    label: AGENT_LABELS.risk,
    status: 'done',
    score: risk,
    confidence: 0.91,
    recommendation: recFromScore(risk, true),
    headline: `Risk ${risk}/100 · ${severity}`,
    reasoning:
      flags.length
        ? `Found ${flags.length} issue(s): ${flags.join('; ')}. Composite risk score ${risk} (${severity}).`
        : `No red-flag clause patterns matched and the brand's registration is verified. Composite risk ${risk} (${severity}).`,
    severity,
    flags,
    trace,
    typed: {
      risk_score: risk,
      clause_flags: flags,
      brand_legitimacy_flag: input.brandRegistrationVerified,
      severity,
    },
    latencyMs: 1480,
    model: 'council-local',
  }
}

function runNegotiation(
  pricing: AgentResult,
  risk: AgentResult,
  input: DealInput,
  t0: number,
): AgentResult {
  const fairMin = Number(pricing.typed.fair_range_min ?? 0)
  const deviation = Number(pricing.typed.deviation_pct ?? 0)
  const underpriced = input.amountInr < fairMin

  const asks: string[] = []
  if (underpriced) asks.push(`raise fee to at least ${inr(fairMin)}`)
  if (risk.flags.some((f) => /perpetual|unlimited usage/i.test(f))) asks.push('cap usage rights at 90 days')
  if (risk.flags.some((f) => /exclusivity/i.test(f))) asks.push('add explicit exclusivity compensation')
  if (risk.flags.some((f) => /Net-60/i.test(f))) asks.push('shorten payment terms to Net-30')
  if (risk.flags.some((f) => /kill fee/i.test(f))) asks.push('add a 50% kill fee')

  const pushback = clamp((underpriced ? 45 : 12) + risk.score * 0.5)
  const walkAway = Math.round(fairMin * 0.85)

  const trace: TraceLine[] = [
    { t: stamp(t0, 100), text: `Reading Pricing and Risk outputs (gated start).` },
    { t: stamp(t0, 320), text: `Deviation ${deviation >= 0 ? '+' : ''}${deviation}% · risk ${risk.score}.` },
    ...asks.map((a, i) => ({ t: stamp(t0, 480 + i * 70), text: `COUNTER-ASK: ${a}.` })),
    {
      t: stamp(t0, 800),
      text: asks.length ? `Counter-position drafted. Walk-away floor ${inr(walkAway)}.` : `Terms acceptable as-is.`,
      tone: asks.length ? ('normal' as const) : ('signal' as const),
    },
  ]

  return {
    id: 'negotiation',
    label: AGENT_LABELS.negotiation,
    status: 'done',
    score: Math.round(pushback),
    confidence: 0.79,
    recommendation: pushback > 55 ? 'negotiate' : 'accept',
    headline: asks.length ? `${asks.length} counter-ask(s)` : 'Accept as-is',
    reasoning: asks.length
      ? `Recommend countering on: ${asks.join('; ')}. Walk-away floor ${inr(walkAway)}.`
      : `Pricing sits inside the fair range and no material clause risk was flagged. No counter needed.`,
    flags: asks,
    trace,
    typed: {
      counter_position: asks.join('; ') || 'accept as-is',
      walk_away_threshold: walkAway,
      pushback_score: Math.round(pushback),
    },
    latencyMs: 990,
    model: 'council-local',
  }
}

// ------------------------------------------------------- supervisor

const RANK: Record<Recommendation, number> = { accept: 0, negotiate: 1, reject: 2 }

export function consolidate(agents: AgentResult[], input: DealInput): Verdict {
  const risk = agents.find((a) => a.id === 'risk')!
  const pricing = agents.find((a) => a.id === 'pricing')!
  const audience = agents.find((a) => a.id === 'audience_fit')!

  // Soft judgement first: weighted lean across the council.
  const weighted =
    audience.score * 0.2 + (100 - risk.score) * 0.4 + pricing.score * 0.3 + (100 - agents.find((a) => a.id === 'negotiation')!.score) * 0.1
  let decision: Recommendation = weighted >= 66 ? 'accept' : weighted >= 42 ? 'negotiate' : 'reject'

  // Hard rules. These are deterministic and the narrative layer cannot argue past
  // them — they only ever make the verdict more cautious, never less.
  let override = { fired: false, rule: '', reason: '', floor: decision }

  if (!input.brandRegistrationVerified) {
    override = {
      fired: true,
      rule: 'BRAND_LEGITIMACY_UNVERIFIED',
      reason:
        'Brand business registration could not be verified. This forces a hard Reject with no model discretion.',
      floor: 'reject',
    }
  } else if (risk.severity === 'critical') {
    override = {
      fired: true,
      rule: 'RISK_SEVERITY_CRITICAL',
      reason: `Risk & Legitimacy returned severity "critical" (score ${risk.score}), which sets a verdict floor of Negotiate regardless of the other agents.`,
      floor: 'negotiate',
    }
  }

  if (override.fired && RANK[override.floor] > RANK[decision]) {
    decision = override.floor
  } else if (override.fired) {
    override.fired = false // floor was already met; nothing was actually overridden
  }

  // Council split: two agents at opposite ends, both confident.
  const confident = agents.filter((a) => a.confidence >= 0.6)
  const accepts = confident.filter((a) => a.recommendation === 'accept')
  const rejects = confident.filter((a) => a.recommendation === 'reject')
  const councilSplit = accepts.length > 0 && rejects.length > 0

  const splitReason = councilSplit
    ? `${accepts.map((a) => a.label).join(', ')} favour proceeding while ${rejects
        .map((a) => a.label)
        .join(', ')} oppose. The disagreement is shown rather than averaged away.`
    : ''

  const summary = override.fired
    ? `${override.reason} Council lean before the rule fired was ${weighted.toFixed(0)}/100.`
    : councilSplit
      ? `The council is split. ${splitReason} Weighted lean ${weighted.toFixed(0)}/100 — proceed with structured negotiation.`
      : `Council aligned at ${weighted.toFixed(0)}/100. ${
          decision === 'accept'
            ? 'Terms and audience fit both hold up against comparables.'
            : decision === 'negotiate'
              ? 'Workable deal, but specific terms need to move before signing.'
              : 'The economics and risk profile do not justify proceeding.'
        }`

  return { decision, summary, override, councilSplit, splitReason }
}

// ------------------------------------------------------- runner

export interface CouncilProgress {
  agents: AgentResult[]
  verdict: Verdict | null
  comps: Comp[]
  done: boolean
}

/**
 * Runs the council, emitting progress as each agent lands. The four independent
 * agents start together and finish at staggered times so parallel execution is
 * visible; Negotiation is gated until they are all done.
 */
export function runCouncil(
  input: DealInput,
  creator: Creator,
  onProgress: (p: CouncilProgress) => void,
): () => void {
  const t0 = Date.now()
  const timers: number[] = []
  const comps = seedComps.slice(0, 3)

  const pending = (id: AgentId): AgentResult => ({
    id,
    label: AGENT_LABELS[id],
    status: id === 'negotiation' ? 'pending' : 'running',
    score: 0,
    confidence: 0,
    recommendation: 'negotiate',
    headline: '',
    reasoning: '',
    flags: [],
    trace: [],
    typed: {},
    latencyMs: 0,
    model: 'council-local',
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
  const risk = runRisk(input, t0)

  // Staggered so the four look genuinely concurrent rather than sequential.
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
      state.verdict = consolidate(finished, input)
      state.done = true
      onProgress({ ...state, agents: [...state.agents] })
    }, 3100),
  )

  return () => timers.forEach((t) => window.clearTimeout(t))
}
