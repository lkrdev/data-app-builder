import React, { useEffect, useState } from 'react'
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
            <button
              type="button"
              data-testid={closeTestId}
              className="dab-btn dab-btn-secondary"
              onClick={onClose}
              title="Close"
              aria-label="Close"
            >
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

export interface RipperLogoProps {
  size?: number
  className?: string
  testId?: string
  idPrefix?: string
}

// ponytail: module-scoped counter for React 17 gradient IDs; swap to native ID hook if React upgrades
let ripperLogoSeq = 0

export const RipperLogo: React.FC<RipperLogoProps> = ({
  size = 24,
  className,
  testId = 'studio-brand-logo',
  idPrefix,
}) => {
  const [fallbackPrefix] = useState(() => idPrefix || `ripperLogo_${++ripperLogoSeq}`)
  const gradPrefix = idPrefix || fallbackPrefix
  return (
    <svg
      data-testid={testId || undefined}
      className={`dab-brand-logo ${className || ''}`.trim()}
      width={size}
      height={size}
      style={size !== 24 ? { width: size, height: size } : undefined}
      viewBox="6 8 84 80"
      fill="none"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${gradPrefix}_a`} x1="12" y1="64" x2="76" y2="18" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#1e3a8a" /><stop offset="100%" stopColor="#0284c7" /></linearGradient>
        <linearGradient id={`${gradPrefix}_b`} x1="16" y1="60" x2="74" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#0284c7" /><stop offset="100%" stopColor="#22d3ee" /></linearGradient>
      </defs>
      <circle cx="48" cy="48" r="39" stroke="#0284c7" strokeWidth="2.2" strokeDasharray="90 150" opacity="0.38" transform="rotate(120 48 48)" />
      <circle cx="48" cy="48" r="33" stroke="#22d3ee" strokeWidth="1.8" strokeDasharray="55 155" opacity="0.32" transform="rotate(-155 48 48)" />
      <path d="M13 62C12 36 27 16 50 16C66 16 78 26 76 40" stroke={`url(#${gradPrefix}_a)`} strokeWidth="5.5" />
      <path d="M19 62C19 40 31 23 50 23C63 23 72 31 70 43C69 48 64 51 58 49" stroke={`url(#${gradPrefix}_b)`} strokeWidth="4.8" />
      <path d="M25 61C26 44 36 30 50 30C60 30 66 36 64 44" stroke="#7dd3fc" strokeWidth="3.2" />
      <path d="M16 68C28 76 45 79 62 74C73 71 80 64 84 56" stroke="#38bdf8" strokeWidth="3" opacity="0.85" />
      <g transform="translate(3 -3) rotate(-18 48 56)">
        <path d="M33 63C40 50 54 43 67 41C64.5 52.5 55 62.5 40.5 66.8C36.5 67.8 32 65.5 33 63Z" fill="#f8fafc" stroke="#0284c7" strokeWidth="2" />
        <line x1="37" y1="63" x2="64" y2="43" stroke="#06b6d4" strokeWidth="1.5" />
      </g>
      <circle cx="75" cy="32" r="2.4" fill="#22d3ee" />
      <circle cx="80" cy="40" r="2" fill="#7dd3fc" />
    </svg>
  )
}
