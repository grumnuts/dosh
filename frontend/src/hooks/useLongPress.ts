import { useRef, useCallback } from 'react'

/**
 * Returns touch event handlers that distinguish a quick tap from a long press.
 * - Quick tap: does nothing (lets the existing onClick fire naturally via browser click synthesis)
 * - Long press (threshold ms): calls onLongPress and suppresses the synthesised click
 */
export function useLongPress(onLongPress: () => void, threshold = 600) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedRef = useRef(false)
  const startXRef = useRef(0)
  const startYRef = useRef(0)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    firedRef.current = false
    startXRef.current = e.touches[0].clientX
    startYRef.current = e.touches[0].clientY
    timerRef.current = setTimeout(() => {
      firedRef.current = true
      onLongPress()
    }, threshold)
  }, [onLongPress, threshold])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startXRef.current
    const dy = e.touches[0].clientY - startYRef.current
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (firedRef.current) {
      e.preventDefault() // suppress synthesised click so collapse doesn't toggle
    }
  }, [])

  return { onTouchStart, onTouchMove, onTouchEnd }
}
