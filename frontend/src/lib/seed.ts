import { fetchCreators } from './api'
import { parseCreatorCsv } from './csv'
import type { Creator } from '../types'

/** Deal types the rate card distinguishes. */
export const DEAL_TYPES = [
  { value: 'integration', label: 'Integrated Mention' },
  { value: 'dedicated', label: 'Dedicated Video' },
] as const

export const DELIVERABLE_OPTIONS = [
  'Dedicated Video',
  'Integrated Mention',
  'Shorts (x2)',
  'Community Post',
  'Live Stream Segment',
  'Usage Rights (30d)',
]

export const BRAND_CATEGORIES = [
  'Gaming Hardware',
  'Mobile Gaming',
  'Beverages',
  'Food & Beverage',
  'Beauty',
  'Fintech',
  'EdTech',
  'Apparel',
]

/** Canonical niches the roster normalises onto. */
export const NICHES = [
  'gaming',
  'vlog',
  'tech',
  'comedy',
  'reaction',
  'finance',
  'sports',
  'story',
  'education',
  'food',
  'entertainment',
  'livestream',
]

export interface SeedResult {
  creators: Creator[]
  /** 'engine' = live Supabase roster (775, both platforms).
   *  'csv'    = bundled fallback (282, YouTube only, and stale). */
  source: 'engine' | 'csv'
}

/**
 * Roster loading, in preference order.
 *
 * 1. The Python engine, which serves the real Supabase roster — 775 creators
 *    across YouTube AND Instagram, with engagement rates, price-estimated
 *    flags and data-confidence scores.
 * 2. The bundled `/public/creators.csv` — 282 YouTube-only rows, kept purely
 *    so the UI still runs with the backend down. It is a snapshot, not a
 *    source of truth, and it is missing every Instagram creator.
 *
 * Rows from the CSV go through the same parser used for user imports, so
 * seeded and imported rows normalise identically.
 */
export async function loadSeedCreators(): Promise<SeedResult> {
  try {
    const creators = await fetchCreators()
    if (creators.length) return { creators, source: 'engine' }
  } catch {
    // Engine down — fall through to the bundled snapshot.
  }
  const res = await fetch('/creators.csv')
  if (!res.ok) throw new Error(`Could not load seed roster: ${res.status}`)
  const rows = parseCreatorCsv(await res.text()).rows
  return {
    creators: rows.map((r, i) => ({ ...r, id: `cr_csv_${i}` })),
    source: 'csv',
  }
}
