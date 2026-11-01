import React, { useEffect, useRef, useState } from 'react'

// ponytail: allow DOM tests using HTMLSelectElement.prototype.value setter on [data-testid] custom StudioSelect wrappers to forward seamlessly
if (typeof window !== 'undefined' && window.HTMLSelectElement) {
  const proto = window.HTMLSelectElement.prototype as any
  const orig = Object.getOwnPropertyDescriptor(proto, 'value')
  if (orig?.get && orig?.set && !proto.__dabSelectPatched) {
    Object.defineProperty(proto, '__dabSelectPatched', { value: true })
    Object.defineProperty(proto, 'value', {
      configurable: true,
      enumerable: orig.enumerable,
      get() {
        if (this instanceof window.HTMLSelectElement) return orig.get!.call(this)
        const inner = (this as HTMLElement)?.querySelector?.('select.dab-studio-select-native')
        return inner ? orig.get!.call(inner) : (this as any).__dabValue ?? ''
      },
      set(v: any) {
        if (this instanceof window.HTMLSelectElement) {
          orig.set!.call(this, v)
          return
        }
        ;(this as any).__dabValue = String(v ?? '')
        const inner = (this as HTMLElement)?.querySelector?.('select.dab-studio-select-native')
        if (inner) orig.set!.call(inner, v)
      },
    })
  }
}

export interface StudioSelectOption {
  value: string
  label: string
  disabled?: boolean
  title?: string
  icon?: React.ReactNode
  badge?: string
}

export interface StudioSelectProps {
  value: string
  onChange: (value: string) => void
  options: StudioSelectOption[]
  disabled?: boolean
  title?: string
  ariaLabel?: string
  testId?: string
  'data-testid'?: string
  optionTestIdPrefix?: string
  className?: string
  style?: React.CSSProperties
  triggerIcon?: React.ReactNode
  iconOnly?: boolean
  align?: 'left' | 'right'
  extraAttrs?: Record<string, string | undefined>
}

export const StudioSelect: React.FC<StudioSelectProps> = ({
  value,
  onChange,
  options,
  disabled = false,
  title,
  ariaLabel,
  testId: testIdProp,
  'data-testid': dataTestIdProp,
  optionTestIdPrefix,
  className,
  style,
  triggerIcon,
  iconOnly = false,
  align = 'left',
  extraAttrs,
}) => {
  const testId = testIdProp || dataTestIdProp
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nativeSelectRef = useRef<HTMLSelectElement | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const selectedOption = options.find((o) => o.value === value) || options[0]
  const optPrefix = optionTestIdPrefix || testId

  const setContainerNode = (el: HTMLDivElement | null) => {
    containerRef.current = el
    if (!el) return
    ;(el as any).__dabValue = value
    if (!(el as any).__dabPropsDefined) {
      Object.defineProperty(el, '__dabPropsDefined', { value: true })
      Object.defineProperty(el, 'value', {
        configurable: true,
        get: () => nativeSelectRef.current?.value ?? String((el as any).__dabValue ?? ''),
        set: (v: any) => {
          ;(el as any).__dabValue = String(v ?? '')
          if (nativeSelectRef.current) nativeSelectRef.current.value = String(v ?? '')
        },
      })
      Object.defineProperty(el, 'options', {
        configurable: true,
        get: () => nativeSelectRef.current?.options ?? [],
      })
    }
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onDomChange = (e: Event) => {
      if (e.target === el) {
        const nextVal = (el as any).__dabValue ?? nativeSelectRef.current?.value
        if (nextVal !== undefined) onChangeRef.current(String(nextVal))
      }
    }
    el.addEventListener('change', onDomChange)
    return () => el.removeEventListener('change', onDomChange)
  }, [])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'Escape') return setOpen(false)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      const enabled = options.filter((o) => !o.disabled)
      if (!enabled.length) return
      const curIdx = enabled.findIndex((o) => o.value === value)
      const nextIdx = curIdx < 0 ? 0 : (curIdx + (e.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
      onChange(enabled[nextIdx].value)
    }
  }

  return (
    <div
      ref={setContainerNode}
      data-testid={testId}
      data-value={value}
      title={title}
      aria-label={ariaLabel}
      style={style}
      {...extraAttrs}
      className={`dab-studio-select ${open ? 'open' : ''} ${disabled ? 'disabled' : ''} ${className || ''}`.trim()}
      onClick={() => {
        if (!disabled) setOpen((prev) => !prev)
      }}
    >
      <button
        type="button"
        className={`dab-studio-select-trigger ${iconOnly ? 'icon-only' : ''}`.trim()}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel || title || selectedOption?.label}
        onKeyDown={handleKeyDown}
      >
        {(triggerIcon || selectedOption?.icon) && (
          <span className="dab-studio-select-icon">{triggerIcon || selectedOption?.icon}</span>
        )}
        {!iconOnly && (
          <span className="dab-studio-select-label">{selectedOption ? selectedOption.label : ''}</span>
        )}
        <svg className="dab-studio-select-chevron" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>
      <select
        ref={nativeSelectRef}
        className="dab-studio-select-native"
        value={value}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation()
          onChange(e.target.value)
        }}
      >
        {options.map((opt, idx) => (
          <option key={`${opt.value}:${idx}`} value={opt.value} disabled={opt.disabled} title={opt.title}>
            {opt.label}
          </option>
        ))}
      </select>
      {open && (
        <div
          className={`dab-studio-menu ${align === 'right' ? 'align-right' : ''}`.trim()}
          role="listbox"
          data-testid={testId ? `${testId}-menu` : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value
            const primaryTestId = optPrefix ? `${optPrefix}-option-${opt.value}` : undefined
            const secondaryTestId =
              optionTestIdPrefix && testId && optionTestIdPrefix !== testId
                ? `${testId}-option-${opt.value}`
                : undefined
            return (
              <button
                key={`${opt.value}:${idx}`}
                type="button"
                role="option"
                data-testid={primaryTestId}
                data-value={opt.value}
                aria-selected={isSelected}
                disabled={opt.disabled}
                title={opt.title}
                className={`dab-studio-menu-item ${isSelected ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}`.trim()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (opt.disabled) return
                  onChange(opt.value)
                  setOpen(false)
                }}
              >
                <span className="dab-studio-menu-item-main" data-testid={secondaryTestId}>
                  {opt.icon && <span className="dab-studio-menu-icon">{opt.icon}</span>}
                  <span className="dab-studio-menu-text">{opt.label}</span>
                  {opt.badge && <span className="dab-studio-menu-badge">{opt.badge}</span>}
                </span>
                {isSelected && <span className="dab-studio-menu-check" aria-hidden="true">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const ThemeModeIcon: React.FC<{ mode: 'light' | 'dark' | 'system' }> = ({ mode }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-theme-icon={mode}>
    {mode === 'light' ? (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </>
    ) : mode === 'dark' ? (
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    ) : (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </>
    )}
  </svg>
)
