import Papa from 'papaparse'
import type { AudienceTier, Creator, CreatorSignals } from '../types'

/**
 * CSV import for the agency's YouTube creator export.
 *
 * Built against the real column set:
 *   name, channel_url, channel_handle, integration_price_inr, integration_price_raw,
 *   dedicated_price_inr, dedicated_price_raw, whatsapp, niche, notes,
 *   subscriber_count, total_views, video_count, channel_id
 *
 * The `whatsapp` column is deliberately NOT imported. It holds personal phone
 * numbers that play no part in evaluating a deal, and importing them would put
 * contact details into browser storage and onto every roster screen for no gain.
 */

const SKIPPED_COLUMNS = ['whatsapp']

function num(v: unknown): number {
  const n = Number(String(v ?? '').replace(/[,\s₹$]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Prices are frequently blank in the source; blank must stay null, not become 0. */
function priceOrNull(v: unknown): number | null {
  const raw = String(v ?? '').trim()
  if (!raw) return null
  const n = Number(raw.replace(/[,\s₹$]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * The source niche column is free text with inconsistent spacing and casing —
 * "gaming, FF", "gaming , FF" and "gaming, ff" are all the same thing. This
 * folds them onto a canonical niche plus an optional sub-genre.
 */
const NICHE_RULES: { match: RegExp; niche: string }[] = [
  { match: /gaming|bgmi|\bff\b|free ?fire|minecraft|gta|roblox|\bcoc\b|clash/i, niche: 'gaming' },
  { match: /vlog/i, niche: 'vlog' },
  { match: /tech/i, niche: 'tech' },
  { match: /comedy|roast|prank/i, niche: 'comedy' },
  { match: /react/i, niche: 'reaction' },
  { match: /earning|finance|money/i, niche: 'finance' },
  { match: /cricket|sport/i, niche: 'sports' },
  { match: /story|storytell/i, niche: 'story' },
  { match: /science|educat/i, niche: 'education' },
  { match: /food/i, niche: 'food' },
  { match: /entertainment|telugu|bangla|bangali|nepali|regional/i, niche: 'entertainment' },
  { match: /live ?stream|omegle/i, niche: 'livestream' },
]

const SUB_NICHE = /\b(ff|free ?fire|bgmi|gta|roblox|minecraft|coc)\b/i

export function normaliseNiche(raw: string): { niche: string; subNiche: string } {
  const text = (raw ?? '').trim()
  if (!text) return { niche: '', subNiche: '' }

  const rule = NICHE_RULES.find((r) => r.match.test(text))
  const sub = text.match(SUB_NICHE)?.[1] ?? ''
  return {
    niche: rule?.niche ?? text.toLowerCase().replace(/\s+/g, ' ').trim(),
    subNiche: sub ? sub.toUpperCase().replace(/\s+/g, '') : '',
  }
}

export function tierFromSubscribers(subs: number): AudienceTier {
  if (subs < 10_000) return 'Nano'
  if (subs < 100_000) return 'Micro'
  if (subs < 500_000) return 'Mid'
  if (subs < 1_000_000) return 'Macro'
  return 'Mega'
}

/** Reach signals derived from the three count columns the export always carries. */
export function creatorSignals(c: Creator): CreatorSignals {
  const hasReachData = c.videoCount > 0 && c.subscriberCount > 0
  const avgViewsPerVideo = c.videoCount > 0 ? c.totalViews / c.videoCount : 0
  return {
    tier: tierFromSubscribers(c.subscriberCount),
    avgViewsPerVideo,
    viewThroughRate: hasReachData ? avgViewsPerVideo / c.subscriberCount : 0,
    hasReachData,
  }
}

const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  creatorname: 'name',
  channelurl: 'channelUrl',
  url: 'channelUrl',
  channelhandle: 'handle',
  handle: 'handle',
  username: 'handle',
  channelid: 'channelId',
  integrationpriceinr: 'integrationPriceInr',
  integrationprice: 'integrationPriceInr',
  dedicatedpriceinr: 'dedicatedPriceInr',
  dedicatedprice: 'dedicatedPriceInr',
  niche: 'niche',
  category: 'niche',
  notes: 'notes',
  subscribercount: 'subscriberCount',
  subscribers: 'subscriberCount',
  followers: 'subscriberCount',
  totalviews: 'totalViews',
  views: 'totalViews',
  videocount: 'videoCount',
  videos: 'videoCount',
}

function normaliseKey(k: string) {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface ParseReport {
  rows: Omit<Creator, 'id'>[]
  skipped: number
  problems: string[]
  /** Coverage counts, so the operator sees what the data cannot support. */
  coverage: {
    total: number
    withNiche: number
    withIntegrationPrice: number
    withDedicatedPrice: number
    withReachData: number
  }
  droppedColumns: string[]
}

export function parseCreatorCsv(text: string): ParseReport {
  const seenHeaders: string[] = []
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => {
      const key = normaliseKey(h)
      seenHeaders.push(key)
      return HEADER_ALIASES[key] ?? key
    },
  })

  const problems: string[] = []
  if (parsed.errors.length) {
    problems.push(...parsed.errors.slice(0, 3).map((e) => `Row ${e.row ?? '?'}: ${e.message}`))
  }

  const rows: Omit<Creator, 'id'>[] = []
  let skipped = 0

  for (const [i, raw] of (parsed.data ?? []).entries()) {
    const name = String(raw.name ?? '').trim()
    const handle = String(raw.handle ?? '').trim().replace(/^@/, '')

    if (!name && !handle) {
      skipped += 1
      if (problems.length < 6) problems.push(`Row ${i + 2}: no name or handle, skipped.`)
      continue
    }

    const nicheRaw = String(raw.niche ?? '').trim()
    const { niche, subNiche } = normaliseNiche(nicheRaw)
    const notes = String(raw.notes ?? '').trim()

    rows.push({
      name: name || handle,
      handle: handle || name,
      channelUrl: String(raw.channelUrl ?? '').trim(),
      channelId: String(raw.channelId ?? '').trim(),
      platform: 'youtube' as const, // the bundled CSV export is YouTube-only
      niche,
      subNiche,
      nicheRaw,
      subscriberCount: num(raw.subscriberCount),
      totalViews: num(raw.totalViews),
      videoCount: num(raw.videoCount),
      integrationPriceInr: priceOrNull(raw.integrationPriceInr),
      dedicatedPriceInr: priceOrNull(raw.dedicatedPriceInr),
      notes,
    })
  }

  const coverage = {
    total: rows.length,
    withNiche: rows.filter((r) => r.niche).length,
    withIntegrationPrice: rows.filter((r) => r.integrationPriceInr !== null).length,
    withDedicatedPrice: rows.filter((r) => r.dedicatedPriceInr !== null).length,
    withReachData: rows.filter((r) => r.videoCount > 0 && r.subscriberCount > 0).length,
  }

  const droppedColumns = SKIPPED_COLUMNS.filter((c) => seenHeaders.includes(c))

  return { rows, skipped, problems, coverage, droppedColumns }
}

const EXPORT_HEADERS = [
  'name',
  'channel_handle',
  'channel_url',
  'channel_id',
  'niche',
  'notes',
  'subscriber_count',
  'total_views',
  'video_count',
  'integration_price_inr',
  'dedicated_price_inr',
]

export function creatorsToCsv(creators: Creator[]): string {
  return Papa.unparse({
    fields: EXPORT_HEADERS,
    data: creators.map((c) => [
      c.name,
      c.handle,
      c.channelUrl,
      c.channelId,
      c.nicheRaw || c.niche,
      c.notes,
      c.subscriberCount,
      c.totalViews,
      c.videoCount,
      c.integrationPriceInr ?? '',
      c.dedicatedPriceInr ?? '',
    ]),
  })
}

export function csvTemplate(): string {
  return Papa.unparse({
    fields: EXPORT_HEADERS,
    data: [
      [
        'Tech Series',
        'techseries5392',
        'https://www.youtube.com/@techseries5392',
        'UCpzPENOZcyAsKD6aBK0FLAw',
        'tech',
        '',
        3910000,
        4836877,
        72,
        35000,
        50000,
      ],
    ],
  })
}
