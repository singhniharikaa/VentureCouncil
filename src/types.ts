export type AudienceTier = 'Nano' | 'Micro' | 'Mid' | 'Macro' | 'Mega'

/** Brand-safety classification, read from the roster's notes column. */
export type ContentFlag = 'betting' | 'non-betting' | 'both' | 'unknown'

/**
 * Mirrors the columns actually present in the agency's creator export.
 * Nothing here is invented — fields the source data does not carry (audience
 * demographics, engagement rate) are deliberately absent, and the agents that
 * would have used them take an "insufficient data" path instead of guessing.
 */
export interface Creator {
  id: string
  name: string
  handle: string
  channelUrl: string
  channelId: string
  /** Normalised niche, e.g. "gaming". Empty string when the source row had none. */
  niche: string
  /** Sub-genre where the source specified one, e.g. "FF", "BGMI". */
  subNiche: string
  /** Original niche text, kept so an operator can see what was normalised. */
  nicheRaw: string
  contentFlag: ContentFlag
  subscriberCount: number
  totalViews: number
  videoCount: number
  /** Rate card, in INR. Null when the source row had no price. */
  integrationPriceInr: number | null
  dedicatedPriceInr: number | null
  notes: string
}

/** Derived reach signals — computed, never stored, so they cannot drift from source. */
export interface CreatorSignals {
  tier: AudienceTier
  avgViewsPerVideo: number
  /** Avg views per video ÷ subscribers. The closest thing to engagement this data supports. */
  viewThroughRate: number
  hasReachData: boolean
}

export interface DealInput {
  creatorId: string
  brandName: string
  brandCategory: string
  amountInr: number
  dealType: 'integration' | 'dedicated'
  deliverables: string[]
  deadline: string | null
  exclusivityClause: string
  contractText: string
  brandRegistrationVerified: boolean
  /** Whether the brand operates in a betting/gambling category. */
  brandIsBetting: boolean
}

export type AgentId = 'audience_fit' | 'engagement' | 'pricing' | 'risk' | 'negotiation'

export type AgentStatus = 'pending' | 'running' | 'done' | 'skipped'

export type Severity = 'low' | 'medium' | 'high' | 'critical'

export type Recommendation = 'accept' | 'negotiate' | 'reject'

export interface TraceLine {
  t: string
  text: string
  tone?: 'normal' | 'alert' | 'signal'
}

export interface AgentResult {
  id: AgentId
  label: string
  status: AgentStatus
  score: number
  confidence: number
  recommendation: Recommendation
  headline: string
  reasoning: string
  severity?: Severity
  flags: string[]
  /** Set when the source data lacked what this agent needed to reach a view. */
  insufficientData: boolean
  trace: TraceLine[]
  typed: Record<string, string | number | boolean | string[] | null>
  latencyMs: number
  model: string
}

export interface PolicyOverride {
  fired: boolean
  changedOutcome: boolean
  rule: string
  reason: string
  floor: Recommendation
}

export interface Verdict {
  decision: Recommendation
  summary: string
  override: PolicyOverride
  councilSplit: boolean
  splitReason: string
}

export interface Comp {
  id: string
  creatorName: string
  niche: string
  tier: AudienceTier
  subscriberCount: number
  amountInr: number
  dealType: 'integration' | 'dedicated'
  distance: number
}

export interface Evaluation {
  id: string
  dealRef: string
  createdAt: string
  creatorId: string
  creatorName: string
  brandName: string
  brandCategory: string
  amountInr: number
  dealType: 'integration' | 'dedicated'
  deliverables: string[]
  agents: AgentResult[]
  verdict: Verdict | null
  comps: Comp[]
  humanReviewed: boolean
  humanOverride: Recommendation | null
  humanNote: string
}
