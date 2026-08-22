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
import { useEffect, useState } from 'react'
import type { AgentResult, Comp, Creator, DealInput, Verdict } from '../types'

export interface EngineHealth {
  ok: true
  creators: number
  provider: string
  model: string
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
