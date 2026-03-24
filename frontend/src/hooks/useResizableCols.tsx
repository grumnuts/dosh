import { useState, useRef, useCallback } from 'react'

export function useResizableCols(defaults: Record<string, number>, storageKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults
    } catch { return defaults }
  })
  const widthsRef = useRef(widths)
  widthsRef.current = widths

  const onResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = widthsRef.current[col]
    const onMove = (ev: MouseEvent) => {
      setWidths((prev) => {
        const next = { ...prev, [col]: Math.max(60, startWidth + ev.clientX - startX) }
        try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
    }
    const onUp = () => {
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [storageKey])

  return { widths, onResizeStart }
}

export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-3 cursor-col-resize hidden md:flex items-center justify-center select-none group/rh z-10"
      onMouseDown={onMouseDown}
    >
      <div className="w-px h-3.5 bg-border/60 group-hover/rh:bg-accent/60 transition-colors" />
    </div>
  )
}
