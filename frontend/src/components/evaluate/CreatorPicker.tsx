/**
 * Searchable creator picker.
 *
 * Replaces a native <select> holding every creator (649 of them), which cannot
 * be searched and shows one cramped line each. Type a name, niche or platform;
 * results show what actually matters when choosing - platform, audience, niche
 * and price - so the choice can be made without opening anything else.
 */
import { useMemo, useRef, useState } from 'react'
import type { Creator } from '../../types'
import { audienceWord, compact, inr } from '../../lib/format'

const MAX_RESULTS = 8

export function CreatorPicker({
  creators,
  loading,
  onPick,
  excludeIds = [],
  placeholder = 'Search creators by name, niche or platform…',
  invalid,
}: {
  creators: Creator[]
  loading?: boolean
  onPick: (c: Creator) => void
  excludeIds?: string[]
  placeholder?: string
  invalid?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = creators.filter((c) => !excludeIds.includes(c.id))
    const matched = q
      ? pool.filter((c) =>
          `${c.name} ${c.handle} ${c.niche} ${c.platform}`.toLowerCase().includes(q),
        )
      : pool
    // biggest audiences first: when nobody has typed anything, the roster's
    // headline creators are the most useful thing to show
    return [...matched]
      .sort((a, b) => (b.subscriberCount || 0) - (a.subscriberCount || 0))
      .slice(0, MAX_RESULTS)
  }, [creators, query, excludeIds])

  function pick(c: Creator) {
    onPick(c)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <div
        className={`flex items-center gap-2.5 rounded-xl border bg-surface px-3.5 py-3 transition focus-within:border-ink ${
          invalid ? 'border-reject' : 'border-line'
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-ink-faint" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          value={query}
          disabled={loading}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && results[0]) {
              e.preventDefault()
              pick(results[0])
            }
          }}
          placeholder={loading ? 'Loading roster…' : placeholder}
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
        />
        <span className="shrink-0 text-[11px] text-ink-faint">{creators.length} creators</span>
      </div>

      {open && !loading && (
        <div className="scroll-slim absolute left-0 right-0 z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 shadow-xl">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-sm text-ink-faint">No creator matches “{query}”.</div>
          ) : (
            results.map((c) => (
              // onMouseDown, not onClick: the input's blur would close the list
              // before a click registered.
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(c)
                }}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-paper"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{c.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-soft">
                    <span
                      className={`rounded-full border px-1.5 py-px text-[9px] uppercase tracking-wider ${
                        c.platform === 'instagram'
                          ? 'border-negotiate/30 bg-negotiate-bg text-negotiate'
                          : 'border-line bg-paper text-ink-soft'
                      }`}
                    >
                      {c.platform}
                    </span>
                    <span className="truncate">{c.niche || 'no niche'}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div className="font-medium">
                    {compact(c.subscriberCount)} <span className="text-ink-faint">{audienceWord(c)}</span>
                  </div>
                  <div className="text-ink-soft">{c.priceInr ? inr(c.priceInr) : 'no price'}</div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
