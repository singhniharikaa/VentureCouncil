/**
 * Light / dark theme.
 *
 * The colours live in CSS variables (see index.css); this only flips the
 * `data-theme` attribute on <html> and remembers the choice. The initial value
 * is set by an inline script in index.html before first paint, so this hook
 * just reads whatever is already there.
 */
import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'vc-theme'

function current(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(current)

  // keep in sync if another tab changes it
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return
      const next: Theme = e.newValue === 'light' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      setTheme(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback(() => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Private mode / storage blocked: the theme still applies for this session.
    }
    setTheme(next)
  }, [])

  return { theme, toggle }
}
