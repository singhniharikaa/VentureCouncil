import Papa from 'papaparse'
import type { AudienceTier, Creator, Platform } from '../types'

/**
 * CSV import/export for the creator roster.
 *
 * Header matching is case- and space-insensitive and accepts a few common
 * aliases, because real exports from spreadsheets rarely match a spec exactly.
 */

const ALIASES: Record<string, string> = {
  handle: 'handle',
  username: 'handle',
  creatorhandle: 'handle',
  name: 'name',
  creatorname: 'name',
  fullname: 'name',
  platform: 'platform',
  niche: 'niche',
  category: 'niche',
  followers: 'followers',
  followercount: 'followers',
  subscribers: 'followers',
  engagementrate: 'engagementRate',
  engagement: 'engagementRate',
  er: 'engagementRate',
  tier: 'tier',
  audiencetier: 'tier',
  verified: 'verified',
  age1824: 'audienceAge18to24',
  audienceage1824: 'audienceAge18to24',
  maleshare: 'audienceMaleShare',
  audiencemaleshare: 'audienceMaleShare',
  indiashare: 'countryInShare',
  countryinshare: 'countryInShare',
  notes: 'notes',
}

const PLATFORMS: Platform[] = ['YouTube', 'Instagram', 'Twitch', 'X']
const TIERS: AudienceTier[] = ['Nano', 'Micro', 'Mid', 'Macro', 'Mega']

function normaliseKey(k: string) {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function toNumber(v: unknown, fallback = 0) {
  const n = Number(String(v ?? '').replace(/[,\s%₹$]/g, ''))
  return Number.isFinite(n) ? n : fallback
}

/** Accepts 0-1 or 0-100 and always returns a 0-1 share. */
function toShare(v: unknown, fallback = 0.5) {
  const n = toNumber(v, NaN)
  if (!Number.isFinite(n)) return fallback
  return n > 1 ? Math.min(n / 100, 1) : Math.max(n, 0)
}

function tierFromFollowers(followers: number): AudienceTier {
  if (followers < 10_000) return 'Nano'
  if (followers < 100_000) return 'Micro'
  if (followers < 500_000) return 'Mid'
  if (followers < 1_000_000) return 'Macro'
  return 'Mega'
}

export interface ParseReport {
  rows: Omit<Creator, 'id'>[]
  skipped: number
  problems: string[]
}

export function parseCreatorCsv(text: string): ParseReport {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => ALIASES[normaliseKey(h)] ?? normaliseKey(h),
  })

  const problems: string[] = []
  if (parsed.errors.length) {
    problems.push(...parsed.errors.slice(0, 3).map((e) => `Row ${e.row ?? '?'}: ${e.message}`))
  }

  const rows: Omit<Creator, 'id'>[] = []
  let skipped = 0

  for (const [i, raw] of (parsed.data ?? []).entries()) {
    const handle = String(raw.handle ?? '').trim().replace(/^@/, '')
    const name = String(raw.name ?? '').trim() || handle

    if (!handle) {
      skipped += 1
      if (problems.length < 6) problems.push(`Row ${i + 2}: no handle, skipped.`)
      continue
    }

    const followers = toNumber(raw.followers)
    const platformRaw = String(raw.platform ?? '').trim()
    const platform =
      PLATFORMS.find((p) => p.toLowerCase() === platformRaw.toLowerCase()) ?? 'YouTube'
    const tierRaw = String(raw.tier ?? '').trim()
    const tier = TIERS.find((t) => t.toLowerCase() === tierRaw.toLowerCase()) ?? tierFromFollowers(followers)

    rows.push({
      handle,
      name,
      platform,
      niche: String(raw.niche ?? '').trim() || 'Gaming',
      followers,
      engagementRate: toNumber(raw.engagementRate, 0),
      tier,
      verified: /^(true|yes|y|1)$/i.test(String(raw.verified ?? '')),
      audienceAge18to24: toShare(raw.audienceAge18to24, 0.5),
      audienceMaleShare: toShare(raw.audienceMaleShare, 0.5),
      countryInShare: toShare(raw.countryInShare, 0.8),
      notes: String(raw.notes ?? '').trim() || undefined,
    })
  }

  return { rows, skipped, problems }
}

export const CSV_TEMPLATE_HEADERS = [
  'handle',
  'name',
  'platform',
  'niche',
  'followers',
  'engagement_rate',
  'tier',
  'verified',
  'audience_age_18_24',
  'audience_male_share',
  'country_in_share',
  'notes',
]

export function creatorsToCsv(creators: Creator[]): string {
  return Papa.unparse({
    fields: CSV_TEMPLATE_HEADERS,
    data: creators.map((c) => [
      c.handle,
      c.name,
      c.platform,
      c.niche,
      c.followers,
      c.engagementRate,
      c.tier,
      c.verified,
      c.audienceAge18to24,
      c.audienceMaleShare,
      c.countryInShare,
      c.notes ?? '',
    ]),
  })
}

export function csvTemplate(): string {
  return Papa.unparse({
    fields: CSV_TEMPLATE_HEADERS,
    data: [
      ['rohanplays', 'Rohan Plays', 'YouTube', 'Gaming', 420000, 5.8, 'Mid', 'true', 0.55, 0.78, 0.82, 'Hindi gaming commentary'],
    ],
  })
}
