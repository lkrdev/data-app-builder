import React, { useEffect } from 'react'
export { StudioSelect, ThemeModeIcon } from './StudioSelect'
export type { StudioSelectOption, StudioSelectProps } from './StudioSelect'

export type StudioButtonVariant = 'primary' | 'secondary' | 'gemini' | 'danger'
export type StudioBadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const BTN_CLASSES: Record<StudioButtonVariant, string> = {
  primary: 'dab-btn dab-btn-primary',
  secondary: 'dab-btn dab-btn-secondary',
  gemini: 'dab-btn dab-btn-gemini',
  danger: 'dab-btn dab-btn-secondary dab-badge-danger',
}

export function StudioButton({
  variant = 'secondary',
  testId,
  className,
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: StudioButtonVariant; testId?: string }) {
  return <button type={type} data-testid={testId} className={`${BTN_CLASSES[variant]} ${className || ''}`.trim()} {...rest} />
}

export function StudioBadge({
  tone,
  pill = false,
  testId,
  className,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: StudioBadgeTone; pill?: boolean; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={`${pill ? 'dab-msg-pill' : 'dab-badge'} ${tone ? `dab-badge-${tone}` : ''} ${className || ''}`.trim()}
      {...rest}
    />
  )
}

export function StudioModal({
  open,
  onClose,
  title,
  subtitle,
  headerRight,
  testId,
  backdropTestId,
  backdropClassName,
  closeTestId,
  closeLabel = '✕',
  className,
  maxWidth,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  headerRight?: React.ReactNode
  testId?: string
  backdropTestId?: string
  backdropClassName?: string
  closeTestId?: string
  closeLabel?: string
  className?: string
  maxWidth?: number | string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className={`dab-modal-backdrop ${backdropClassName || ''}`.trim()} data-testid={backdropTestId} onClick={onClose}>
      <div
        className={`dab-modal ${className || ''}`.trim()}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dab-ds-modal-header">
          <div className="dab-ds-modal-title-group">
            <strong style={{ fontSize: 15 }}>{title}</strong>
            {subtitle && <div className="dab-muted" style={{ fontSize: 11.5 }}>{subtitle}</div>}
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {headerRight}
            <button type="button" data-testid={closeTestId} className="dab-btn dab-btn-secondary" onClick={onClose} aria-label="Close modal">
              {closeLabel}
            </button>
          </div>
        </div>
        {children}
        {footer ? <div className="dab-ds-modal-footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export function StudioToolbar({
  title,
  badges,
  actions,
  testId,
  titleBlockTestId,
  className,
  children,
}: {
  title?: React.ReactNode
  badges?: React.ReactNode
  actions?: React.ReactNode
  testId?: string
  titleBlockTestId?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={`dab-preview-toolbar ${className || ''}`.trim()} data-testid={testId}>
      <div
        className="dab-ds-toolbar-title-block"
        data-testid={titleBlockTestId}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}
      >
        {title}
        {badges}
        {children}
      </div>
      {actions ? <div className="dab-preview-actions">{actions}</div> : null}
    </div>
  )
}

export function StudioCard({
  testId,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { testId?: string }) {
  return <div data-testid={testId} className={`dab-ds-card ${className || ''}`.trim()} {...rest} />
}

export function StudioSkeleton({
  width,
  height,
  testId,
  className,
  style,
  ariaLabel,
}: {
  width?: number | string
  height?: number | string
  testId?: string
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
}) {
  return (
    <span
      data-testid={testId}
      className={`dab-skeleton ${className || ''}`.trim()}
      style={{ width, height, ...style }}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : 'true'}
    />
  )
}

export function StudioDocPreview({
  component,
  key,
  className,
  children,
}: {
  component?: string
  key?: React.Key
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div
      key={key}
      data-testid="doc-ui-preview"
      data-component={component}
      className={className ? `dab-doc-ui-preview ${className}` : 'dab-doc-ui-preview'}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      aria-hidden="true"
      tabIndex={-1}
    >
      {children}
    </div>
  )
}
