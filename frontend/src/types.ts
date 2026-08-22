export type AudienceTier = 'Nano' | 'Micro' | 'Mid' | 'Macro' | 'Mega'

/**
 * Mirrors the columns actually present in the agency's creator export.
 * Nothing here is invented — fields the source data does not carry (audience
 * demographics, engagement rate) are deliberately absent, and the agents that
 * would have used them take an "insufficient data" path instead of guessing.
 */
export type Platform = 'youtube' | 'instagram'

export interface Creator {
  id: string
  name: string
  handle: string
  /** Which platform the creator is on. Supabase carries both; the legacy CSV
   *  was YouTube-only, so rows parsed from CSV default to 'youtube'. */
  platform: Platform
  channelUrl: string
  channelId: string
  /** Normalised niche, e.g. "gaming". Empty string when the source row had none. */
  niche: string
  /** Sub-genre where the source specified one, e.g. "FF", "BGMI". */
  subNiche: string
  /** Original niche text, kept so an operator can see what was normalised. */
  nicheRaw: string
  subscriberCount: number
  totalViews: number
  videoCount: number
  /** Rate card, in INR. Null when the source row had no price. */
  integrationPriceInr: number | null
  dedicatedPriceInr: number | null
  /** Follower count under a platform-neutral name. Mirrors subscriberCount. */
  followersCount?: number
  /** Present for most Instagram rows and all YouTube rows in Supabase. */
  engagementRate?: number | null
  /** The engine's single working price, whichever deal type it came from. */
  priceInr?: number | null
  /** True when the price was KNN-estimated rather than quoted by the agency. */
  priceEstimated?: boolean
  /** 0-100. +25 each for niche, real price, engagement rate, contact on file. */
  dataConfidenceScore?: number | null
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
  /** Which engine produced this verdict.
   *  'live'  = the Python engine: five LLM agents over the Supabase roster.
   *  'local' = the in-browser rule-based fallback, no model involved.
   *  Undefined on records saved before this was tracked (2026-08-22).
   *  These are not comparable, so history must not present them alike. */
  engine?: 'live' | 'local'
  /** provider/model that ran it, e.g. "groq/openai/gpt-oss-120b". */
  model?: string
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
