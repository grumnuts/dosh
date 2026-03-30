import { useState, useRef, useEffect, CSSProperties } from 'react'
import { createPortal } from 'react-dom'

interface Item {
  id: string
  label: string
}

interface Props {
  items: Item[]
  value: string
  onChange: (v: string) => void
  label?: string
  allLabel?: string
  className?: string
}

export function SearchableSelect({ items, value, onChange, label, allLabel = 'All', className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = items.find((i) => i.id === value)

  useEffect(() => {
    if (!open) return
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const estimatedHeight = 260

      const style: CSSProperties = {
        position: 'fixed',
        left: rect.left,
        width: Math.max(rect.width, 200),
        zIndex: 9999,
      }

      if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
        style.bottom = window.innerHeight - rect.top + 4
      } else {
        style.top = rect.bottom + 4
      }

      setDropdownStyle(style)
    }
    setSearch('')
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        !containerRef.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = search.trim()
    ? items.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()))
    : items

  const select = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  const triggerClass = `input-base text-sm w-full text-left ${selected ? 'text-primary' : 'text-muted'}`

  const dropdown = (
    <div ref={dropdownRef} style={dropdownStyle} className="bg-surface-2 border border-border rounded-lg shadow-2xl overflow-hidden">
      <div className="p-2 border-b border-border/50">
        <input
          ref={searchRef}
          className="w-full bg-surface-3 text-sm text-primary rounded px-2 py-1.5 outline-none placeholder:text-muted"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        />
      </div>
      <div className="overflow-y-auto max-h-52">
        <button
          type="button"
          className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-3 transition-colors ${value === '' ? 'text-accent' : 'text-muted italic'}`}
          onMouseDown={(e) => { e.preventDefault(); select('') }}
        >
          {allLabel}
        </button>
        {filtered.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-3 transition-colors ${item.id === value ? 'text-accent' : 'text-primary'}`}
            onMouseDown={(e) => { e.preventDefault(); select(item.id) }}
          >
            {item.label}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-3 text-sm text-muted italic text-center">No matches</div>
        )}
      </div>
    </div>
  )

  return (
    <div ref={containerRef} className={`flex flex-col gap-1 ${className}`}>
      {label && <span className="text-xs text-muted uppercase tracking-wide">{label}</span>}
      <div className="relative">
        <button ref={triggerRef} type="button" className={triggerClass} onClick={() => setOpen((o) => !o)}>
          {selected?.label ?? allLabel}
        </button>
        {open && createPortal(dropdown, document.body)}
      </div>
    </div>
  )
}
