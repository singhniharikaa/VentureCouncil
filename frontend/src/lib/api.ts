/**
 * Client for the Python engine (FastAPI, see `api/server.py`).
 *
 * This is the seam that makes the app real. Without the engine running, the
 * frontend falls back to `lib/council.ts` — deterministic TypeScript scoring
 * over a stale 282-row YouTube CSV, with no model involved. With the engine
 * running, evaluations are performed by the five Groq-backed agents over the
 * full 775-creator Supabase roster (275 YouTube + 500 Instagram), with
 * comparables retrieved by pgvector similarity search.
 *
 * The distinction matters enough that the UI states which mode it is in
 * rather than quietly degrading.
 */
import { useEffect, useRef, useState } from 'react'
import type { AgentResult, Comp, Creator, DealInput, Verdict } from '../types'

export interface EngineHealth {
  ok: true
  creators: number
  provider: string
  model: string
}

/** Path A: a creator returned by discovery, with how well it matched. */
export interface Candidate extends Creator {
  /** 0-1 cosine similarity to the brief. */
  similarity: number | null
  /** 1 - similarity, for display. */
  distance: number | null
}

export interface DiscoverFilters {
  platform?: string
  niche?: string
  budgetMin?: number
  budgetMax?: number
  minFollowers?: number
  maxFollowers?: number
  realPriceOnly?: boolean
  minConfidence?: number
  limit?: number
}

export interface DiscoverResponse {
  candidates: Candidate[]
  /** Plain-English list of the hard constraints applied, for the UI to show
   *  WHY the pool is what it is rather than presenting a ranked list with no
   *  explanation of what was excluded. */
  filters: string[]
  meta: { brief: string; returned: number; limit: number }
}

export interface EvaluateResponse {
  agents: AgentResult[]
  verdict: Verdict
  comps: Comp[]
  creator: Creator
  meta: {
    provider: string
    model: string
    totalMs: number
    percentile: number | null
  }
}

const TIMEOUT_MS = 120_000 // a real council run is 5 sequential-ish LLM calls

async function req<T>(path: string, init?: RequestInit, timeout = 8000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal })
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`
      try {
        const body = await res.json()
        if (body?.detail) detail = String(body.detail)
      } catch {
        // non-JSON error body — the status line is enough
      }
      throw new Error(detail)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export function checkEngine(): Promise<EngineHealth> {
  return req<EngineHealth>('/api/health', undefined, 5000)
}

export async function fetchCreators(): Promise<Creator[]> {
  const data = await req<{ creators: Creator[] }>('/api/creators', undefined, 30_000)
  return data.creators
}

/**
 * Path A — rank creators against a free-text brief.
 *
 * No LLM is involved, so this is cheap to call repeatedly: a brand can explore
 * the roster freely and only spend agent calls on the shortlist it picks.
 * Embedding the brief server-side takes a moment, hence the longer timeout.
 */
export function discoverCreators(brief: string, filters: DiscoverFilters = {}) {
  return req<DiscoverResponse>(
    '/api/discover',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief, ...filters }),
    },
    60_000,
  )
}

/** One creator's outcome inside a campaign. A failure here never sinks the rest. */
export interface CampaignResult {
  creatorId: string
  name: string
  offerInr: number
  status: 'ok' | 'error'
  error: string | null
  evaluation: EvaluateResponse | null
}

export interface BudgetRow {
  creator_id: string
  name: string
  offer: number
  decision: 'accept' | 'negotiate' | 'reject' | 'error'
  /** Running total of Accept + Negotiate deals so far ("if all of these close"). */
  running_total: number | null
  fits_budget: boolean | null
}

export interface CampaignBudget {
  total_budget: number | null
  /** Sum of Accept offers - the brand would sign these. */
  committed: number
  /** Sum of Negotiate offers - likely to close, but the price may move. */
  tentative: number
  if_all_close: number
  remaining: number | null
  remaining_if_all_close: number | null
  over_budget: boolean
  tentative_over_budget: boolean
  counts: Record<string, number>
  rows: BudgetRow[]
}

export interface CampaignResponse {
  results: CampaignResult[]
  budget: CampaignBudget
  meta: { provider: string; model: string; creators: number; totalMs: number }
}

export interface CampaignInput {
  creators: { creatorId: string; amountInr?: number }[]
  brandName: string
  brandCategory?: string
  totalBudget?: number
  dealType?: string
  deliverables?: string[]
}

/**
 * Several creators, one total budget. Each creator gets the same five-agent
 * evaluation as a single deal, then the verdicts are added up against the
 * budget. Slow on purpose: five creators is ~25 LLM calls and Groq's free tier
 * allows about two evaluations a minute, so expect one to two minutes.
 */
export function runCampaign(input: CampaignInput) {
  return req<CampaignResponse>(
    '/api/campaign',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    420_000,
  )
}

export function evaluateDeal(input: DealInput, budget?: { min: number; max: number }) {
  return req<EvaluateResponse>(
    '/api/evaluate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creatorId: input.creatorId,
        brandName: input.brandName,
        brandCategory: input.brandCategory,
        amountInr: input.amountInr,
        dealType: input.dealType,
        deliverables: input.deliverables,
        brandBudgetMin: budget?.min,
        brandBudgetMax: budget?.max,
        brandTargetNiche: input.brandCategory,
        contractText: input.contractText || null,
      }),
    },
    TIMEOUT_MS,
  )
}

export type EngineState =
  | { status: 'checking' }
  | { status: 'live'; health: EngineHealth }
  | { status: 'offline'; error: string }

/** Single probe of the engine, so the UI can say which mode it is running in. */
export function useEngine(): EngineState {
  const [state, setState] = useState<EngineState>({ status: 'checking' })
  useEffect(() => {
    let alive = true
    checkEngine()
      .then((health) => alive && setState({ status: 'live', health }))
      .catch((e) => alive && setState({ status: 'offline', error: String(e?.message ?? e) }))
    return () => {
      alive = false
    }
  }, [])
  return state
}

/**
 * Keeps checking the engine, for the always-visible mode badge ONLY.
 *
 * Deliberately separate from `useEngine`, which probes once and drives the
 * evaluation logic. If this watcher fed DealRoom, a single slow health reply
 * mid-run could flip the app to the fake council and restart the evaluation.
 *
 * It re-checks every few seconds so the badge flips if the API is stopped
 * after the page loaded. Going from live to offline needs TWO failed checks in
 * a row, so one slow reply does not raise a false alarm in the middle of a demo.
 */
export function useEngineWatch(intervalMs = 5000): EngineState {
  const [state, setState] = useState<EngineState>({ status: 'checking' })
  const failures = useRef(0)
  const live = useRef(false)

  useEffect(() => {
    let alive = true
    const probe = () =>
      checkEngine()
        .then((health) => {
          if (!alive) return
          failures.current = 0
          live.current = true
          setState({ status: 'live', health })
        })
        .catch((e) => {
          if (!alive) return
          failures.current += 1
          // Already live: tolerate a single blip. Otherwise report at once.
          if (live.current && failures.current < 2) return
          live.current = false
          setState({ status: 'offline', error: String(e?.message ?? e) })
        })
    probe()
    const id = window.setInterval(probe, intervalMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [intervalMs])

  return state
}
