export type Platform = 'YouTube' | 'Instagram' | 'Twitch' | 'X'

export type AudienceTier = 'Nano' | 'Micro' | 'Mid' | 'Macro' | 'Mega'

export interface Creator {
  id: string
  handle: string
  name: string
  platform: Platform
  niche: string
  followers: number
  engagementRate: number // percent
  tier: AudienceTier
  verified: boolean
  audienceAge18to24: number // 0-1
  audienceMaleShare: number // 0-1
  countryInShare: number // 0-1
  notes?: string
}

export interface Brand {
  id: string
  name: string
  category: string
  registrationVerified: boolean
  targetAge18to24: number
  targetMaleShare: number
}

export interface Deliverable {
  id: string
  label: string
}

export interface DealInput {
  creatorId: string
  brandName: string
  brandCategory: string
  amountInr: number
  deliverables: string[]
  deadline: string | null
  exclusivityClause: string
  contractText: string
  brandRegistrationVerified: boolean
}

export type AgentId =
  | 'audience_fit'
  | 'engagement'
  | 'pricing'
  | 'risk'
  | 'negotiation'

export type AgentStatus = 'pending' | 'running' | 'done' | 'skipped'

export type Severity = 'low' | 'medium' | 'high' | 'critical'

export type Recommendation = 'accept' | 'negotiate' | 'reject'

export interface TraceLine {
  t: string // HH:MM:SS.mmm
  text: string
  tone?: 'normal' | 'alert' | 'signal'
}

export interface AgentResult {
  id: AgentId
  label: string
  status: AgentStatus
  score: number // 0-100
  confidence: number // 0-1
  recommendation: Recommendation
  headline: string
  reasoning: string
  severity?: Severity
  flags: string[]
  trace: TraceLine[]
  /** Agent-specific typed output, per the architecture spec's typed contracts. */
  typed: Record<string, string | number | boolean | string[]>
  latencyMs: number
  model: string
}

export interface PolicyOverride {
  fired: boolean
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
  brandName: string
  tier: AudienceTier
  category: string
  amountInr: number
  outcome: Recommendation
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
  deliverables: string[]
  agents: AgentResult[]
  verdict: Verdict | null
  comps: Comp[]
  humanReviewed: boolean
  humanOverride: Recommendation | null
  humanNote: string
}
