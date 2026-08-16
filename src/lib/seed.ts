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
  'Betting',
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

/**
 * The roster ships as a CSV in /public and is parsed on first load with the same
 * parser used for user imports — so seeded rows and imported rows go through
 * identical normalisation, and there is no second copy of that logic to drift.
 */
export async function loadSeedCreators(): Promise<Omit<Creator, 'id'>[]> {
  const res = await fetch('/creators.csv')
  if (!res.ok) throw new Error(`Could not load seed roster: ${res.status}`)
  return parseCreatorCsv(await res.text()).rows
}
