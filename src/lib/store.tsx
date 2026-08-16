import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Brand, Creator, Evaluation } from '../types'
import { seedBrands, seedCreators } from './seed'

/**
 * App state with localStorage persistence.
 *
 * This is the seam where the Supabase/Postgres backend will plug in: every
 * mutation below maps one-to-one onto a REST call, so swapping the storage
 * layer does not change any component.
 */

const KEY = 'venturecouncil.state.v1'

interface Persisted {
  creators: Creator[]
  brands: Brand[]
  evaluations: Evaluation[]
}

interface StoreValue extends Persisted {
  addCreator: (c: Omit<Creator, 'id'>) => Creator
  updateCreator: (id: string, patch: Partial<Creator>) => void
  deleteCreator: (id: string) => void
  importCreators: (rows: Omit<Creator, 'id'>[]) => number
  addBrand: (b: Omit<Brand, 'id'>) => Brand
  saveEvaluation: (e: Evaluation) => void
  updateEvaluation: (id: string, patch: Partial<Evaluation>) => void
  resetToSeed: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Persisted
  } catch {
    // Corrupt or unavailable storage falls back to seed data rather than crashing.
  }
  return { creators: seedCreators, brands: seedBrands, evaluations: [] }
}

let idCounter = 0
function newId(prefix: string) {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // Quota exceeded — keep running from memory rather than breaking the UI.
    }
  }, [state])

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
    const created = rows.map((r) => ({ ...r, id: newId('cr') }))
    setState((s) => {
      // De-duplicate on handle so re-importing the same CSV updates rather than doubles.
      const byHandle = new Map(s.creators.map((c) => [c.handle.toLowerCase(), c]))
      for (const c of created) byHandle.set(c.handle.toLowerCase(), c)
      return { ...s, creators: [...byHandle.values()] }
    })
    return created.length
  }, [])

  const addBrand = useCallback((b: Omit<Brand, 'id'>) => {
    const created: Brand = { ...b, id: newId('br') }
    setState((s) => ({ ...s, brands: [created, ...s.brands] }))
    return created
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

  const resetToSeed = useCallback(() => {
    setState({ creators: seedCreators, brands: seedBrands, evaluations: [] })
  }, [])

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      addCreator,
      updateCreator,
      deleteCreator,
      importCreators,
      addBrand,
      saveEvaluation,
      updateEvaluation,
      resetToSeed,
    }),
    [state, addCreator, updateCreator, deleteCreator, importCreators, addBrand, saveEvaluation, updateEvaluation, resetToSeed],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
