/** Small display helpers shared by the evaluation screens. */
import type { Creator } from '../types'

/** 1,23,456 -> "1.2L", 1,23,45,678 -> "1.2Cr" (Indian number words). */
export const compact = (n: number): string =>
  n >= 10_000_000
    ? `${(n / 10_000_000).toFixed(1)}Cr`
    : n >= 100_000
      ? `${(n / 100_000).toFixed(1)}L`
      : n.toLocaleString('en-IN')

export const inr = (n: number): string => `₹${n.toLocaleString('en-IN')}`

/** Parse what a person typed into a money box ("₹ 35,000" -> 35000). */
export const parseMoney = (v: string): number => Number(v.replace(/[^0-9]/g, '')) || 0

/**
 * The price the engine will actually judge an offer against.
 *
 * YouTube creators carry separate integration and dedicated rates. Instagram
 * creators carry a single `priceInr` and no split. The form used to read only
 * the split columns, so for all 375 Instagram creators it claimed "no rate on
 * file" when the engine was in fact using their price.
 */
export function listedPrice(c: Creator, dealType: 'integration' | 'dedicated'): number | null {
  const specific = dealType === 'dedicated' ? c.dedicatedPriceInr : c.integrationPriceInr
  return specific ?? c.priceInr ?? null
}

export const audienceWord = (c: Creator): string => (c.platform === 'instagram' ? 'followers' : 'subscribers')
