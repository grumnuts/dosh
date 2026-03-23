import { useState, useCallback } from 'react'

/**
 * Persists a boolean toggle in localStorage. API matches useState.
 */
export function useLocalStorageBool(
  key: string,
  defaultValue: boolean,
): [boolean, (val: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? stored === 'true' : defaultValue
    } catch {
      return defaultValue
    }
  })

  const set = useCallback(
    (val: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const next = typeof val === 'function' ? val(prev) : val
        try {
          localStorage.setItem(key, String(next))
        } catch {}
        return next
      })
    },
    [key],
  )

  return [value, set]
}
