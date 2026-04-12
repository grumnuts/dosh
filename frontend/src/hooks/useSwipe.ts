import { useRef, useCallback } from 'react'

/**
 * Returns touch handlers that detect horizontal swipes without blocking vertical scroll.
 * - Swipe left  → onSwipeLeft()
 * - Swipe right → onSwipeRight()
 * The gesture is only recognised when horizontal distance exceeds `threshold`
 * AND is greater than the vertical distance (so normal scrolling is unaffected).
 */
export function useSwipe(
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
  threshold = 50,
) {
  const startX = useRef(0)
  const startY = useRef(0)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - startX.current
    const dy = e.changedTouches[0].clientY - startY.current
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy)) return
    if (dx < 0) onSwipeLeft()
    else onSwipeRight()
  }, [onSwipeLeft, onSwipeRight, threshold])

  return { onTouchStart, onTouchEnd }
}
