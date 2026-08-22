import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Creator, Evaluation } from '../types'
import { loadSeedCreators } from './seed'

/**
 * App state with localStorage persistence.
 *
 * This is the seam where a Postgres/Supabase backend plugs in: every mutation
 * maps one-to-one onto a REST call, so swapping the storage layer does not
 * change any component.
 */

const KEY = 'venturecouncil.state.v2'

interface Persisted {
  creators: Creator[]
  evaluations: Evaluation[]
  /** Which roster is cached. Persisted so a stale CSV fallback can be spotted
   *  and upgraded once the engine comes back, instead of silently winning
   *  forever because a cached roster exists. */
  source?: 'engine' | 'csv'
}

interface StoreValue extends Omit<Persisted, 'source'> {
  loading: boolean
  /** Where the roster came from — 'engine' (Supabase) or 'csv' (fallback).
   *  null only while the first load is still in flight. */
  source: 'engine' | 'csv' | null
  addCreator: (c: Omit<Creator, 'id'>) => Creator
  updateCreator: (id: string, patch: Partial<Creator>) => void
  deleteCreator: (id: string) => void
  importCreators: (rows: Omit<Creator, 'id'>[]) => number
  saveEvaluation: (e: Evaluation) => void
  updateEvaluation: (id: string, patch: Partial<Evaluation>) => void
  reloadSeed: () => Promise<void>
}

const StoreContext = createContext<StoreValue | null>(null)

let idCounter = 0
function newId(prefix: string) {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Persisted
  } catch {
    // Corrupt storage falls through to a fresh seed rather than crashing.
  }
  return null
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>({ creators: [], evaluations: [] })
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<'engine' | 'csv' | null>(null)

  useEffect(() => {
    const saved = loadPersisted()
    const cachedIsEngine = saved?.source === 'engine'

    // A cached ENGINE roster is authoritative and may carry local edits, so it
    // is used as-is. A cached CSV roster is a stale 282-row YouTube-only
    // snapshot taken while the engine was unreachable; it must not outlive the
    // engine coming back, or the app sits in "live" mode showing fallback data.
    if (saved && saved.creators.length && cachedIsEngine) {
      setState(saved)
      setSource('engine')
      setLoading(false)
      return
    }

    // Show the stale roster immediately rather than blanking the screen, then
    // upgrade in place if the engine answers.
    if (saved && saved.creators.length) {
      setState(saved)
      setSource('csv')
    }

    loadSeedCreators()
      .then(({ creators, source: from }) => {
        // Engine ids are stable Supabase primary keys (cr_43) and must be kept
        // verbatim — /api/evaluate resolves the creator by that id.
        setState((prev) => ({
          creators,
          evaluations: saved?.evaluations ?? prev.evaluations,
          source: from,
        }))
        setSource(from)
      })
      .catch(() =>
        setState((prev) => (prev.creators.length ? prev : { creators: [], evaluations: [] })),
      )
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (loading) return
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // Quota exceeded — keep running from memory rather than breaking the UI.
    }
  }, [state, loading])

  const addCreator = useCallback((c: Omit<Creator, 'id'>) => {
    const created: Creator = { ...c, id: newId('cr') }
    setState((s) => ({ ...s, creators: [created, ...s.creators] }))
    return created
  }, [])

  const updateCreator = useCallback((id: string, patch: Partial<Creator>) => {
    setState((s) => ({
      ...s,
      creators: s.creators.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  }, [])

  const deleteCreator = useCallback((id: string) => {
    setState((s) => ({ ...s, creators: s.creators.filter((c) => c.id !== id) }))
  }, [])

  const importCreators = useCallback((rows: Omit<Creator, 'id'>[]) => {
    setState((s) => {
      // Matched on channel id where present, else handle — so re-importing the
      // same export updates rows instead of doubling the roster.
      const key = (c: { channelId: string; handle: string }) =>
        (c.channelId || c.handle).toLowerCase()
      const byKey = new Map(s.creators.map((c) => [key(c), c]))
      for (const r of rows) {
        const existing = byKey.get(key(r))
        byKey.set(key(r), existing ? { ...existing, ...r } : { ...r, id: newId('cr') })
      }
      return { ...s, creators: [...byKey.values()] }
    })
    return rows.length
  }, [])

  const saveEvaluation = useCallback((e: Evaluation) => {
    setState((s) => ({ ...s, evaluations: [e, ...s.evaluations.filter((x) => x.id !== e.id)] }))
  }, [])

  const updateEvaluation = useCallback((id: string, patch: Partial<Evaluation>) => {
    setState((s) => ({
      ...s,
      evaluations: s.evaluations.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }))
  }, [])

  const reloadSeed = useCallback(async () => {
    setLoading(true)
    try {
      const { creators, source: from } = await loadSeedCreators()
      setState((s) => ({ creators, evaluations: s.evaluations, source: from }))
      setSource(from)
    } finally {
      setLoading(false)
    }
  }, [])

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      loading,
      source,
      addCreator,
      updateCreator,
      deleteCreator,
      importCreators,
      saveEvaluation,
      updateEvaluation,
      reloadSeed,
    }),
    [state, loading, source, addCreator, updateCreator, deleteCreator, importCreators, saveEvaluation, updateEvaluation, reloadSeed],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
