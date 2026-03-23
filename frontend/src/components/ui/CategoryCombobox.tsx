import { useState, useRef, useEffect, CSSProperties } from 'react'
import { createPortal } from 'react-dom'

interface Category {
  id: number
  group_id: number
  name: string
}

interface Group {
  id: number
  name: string
}

interface Props {
  value: string
  onChange: (v: string) => void
  categories: Category[]
  groups: Group[]
  placeholder?: string
  /** Applied to the outer container div */
  className?: string
  /** Overrides the default input-base trigger button styling */
  buttonClassName?: string
  disabled?: boolean
  showSplit?: boolean
  onSplitClick?: () => void
}

export function CategoryCombobox({
  value,
  onChange,
  categories,
  groups,
  placeholder = 'Uncategorised',
  className = '',
  buttonClassName,
  disabled,
  showSplit,
  onSplitClick,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selectedCategory = categories.find((c) => String(c.id) === value)

  useEffect(() => {
    if (!open) return
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const estimatedHeight = 260

      const style: CSSProperties = {
        position: 'fixed',
        left: rect.left,
        width: Math.max(rect.width, 208),
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
    ? categories.filter((c) => {
        const groupName = groups.find((g) => g.id === c.group_id)?.name ?? ''
        return (
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          groupName.toLowerCase().includes(search.toLowerCase())
        )
      })
    : categories

  const groupedFiltered = groups
    .map((g) => ({ group: g, cats: filtered.filter((c) => c.group_id === g.id) }))
    .filter((g) => g.cats.length > 0)

  const select = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  const triggerClass = buttonClassName ?? `input-base text-sm w-full text-left ${selectedCategory ? 'text-primary' : 'text-muted'}`

  if (disabled) {
    return (
      <div className={`input-base text-sm text-muted cursor-not-allowed ${className}`}>
        {selectedCategory?.name ?? placeholder}
      </div>
    )
  }

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
        {showSplit && (
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-surface-3 transition-colors border-b border-border/30"
            onMouseDown={(e) => { e.preventDefault(); setOpen(false); onSplitClick?.() }}
          >
            Split…
          </button>
        )}
        <button
          type="button"
          className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-3 transition-colors ${value === '' ? 'text-accent' : 'text-muted italic'}`}
          onMouseDown={(e) => { e.preventDefault(); select('') }}
        >
          Uncategorised
        </button>
        {groupedFiltered.map(({ group, cats }) => (
          <div key={group.id}>
            <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">
              {group.name}
            </div>
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-3 transition-colors ${String(c.id) === value ? 'text-accent' : 'text-primary'}`}
                onMouseDown={(e) => { e.preventDefault(); select(String(c.id)) }}
              >
                {c.name}
              </button>
            ))}
          </div>
        ))}
        {groupedFiltered.length === 0 && search && (
          <div className="px-3 py-3 text-sm text-muted italic text-center">No matches</div>
        )}
        {groupedFiltered.length === 0 && !search && (
          <div className="px-3 py-3 text-sm text-muted italic text-center">No categories</div>
        )}
      </div>
    </div>
  )

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button ref={triggerRef} type="button" className={triggerClass} onClick={() => setOpen((o) => !o)}>
        {selectedCategory?.name ?? placeholder}
      </button>
      {open && createPortal(dropdown, document.body)}
    </div>
  )
}
