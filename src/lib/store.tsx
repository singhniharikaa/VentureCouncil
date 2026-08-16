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
}

interface StoreValue extends Persisted {
  loading: boolean
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

  useEffect(() => {
    const saved = loadPersisted()
    if (saved && saved.creators.length) {
      setState(saved)
      setLoading(false)
      return
    }
    loadSeedCreators()
      .then((rows) => {
        setState({ creators: rows.map((r) => ({ ...r, id: newId('cr') })), evaluations: [] })
      })
      .catch(() => setState({ creators: [], evaluations: [] }))
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
      const rows = await loadSeedCreators()
      setState({ creators: rows.map((r) => ({ ...r, id: newId('cr') })), evaluations: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      loading,
      addCreator,
      updateCreator,
      deleteCreator,
      importCreators,
      saveEvaluation,
      updateEvaluation,
      reloadSeed,
    }),
    [state, loading, addCreator, updateCreator, deleteCreator, importCreators, saveEvaluation, updateEvaluation, reloadSeed],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
