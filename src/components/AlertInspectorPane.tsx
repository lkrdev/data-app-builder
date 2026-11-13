import React from 'react'

import type { AlertInspectorBundle } from '../antigravityTypes'
import { StudioBadge, StudioButton, StudioCard, StudioToolbar } from './StudioDesignSystem'

export function buildAlertDashboardFilterUrl(bundle?: AlertInspectorBundle | null): string {
  if (!bundle) return ''
  const dashId = String(bundle.dashboard_id || bundle.lookml_dashboard_id || '').trim()
  if (!dashId) return ''
  const params = new URLSearchParams()
  for (const f of bundle.applied_dashboard_filters || []) {
    const key = String(f.filter_title || f.field_name || '').trim()
    const val = String(f.filter_value ?? '').trim()
    if (key && val) params.set(key, val)
  }
  const qs = params.toString()
  return `/embed/dashboards/${encodeURIComponent(dashId)}${qs ? `?${qs}` : ''}`
}

export interface AlertInspectorPaneProps {
  bundle: AlertInspectorBundle | null
  previewingDashboard: boolean
  onTogglePreviewDashboard: () => void
  onOpenInLooker?: (path: string) => void
}

export function AlertInspectorPane({
  bundle,
  previewingDashboard,
  onTogglePreviewDashboard,
  onOpenInLooker,
}: AlertInspectorPaneProps) {
  if (!bundle) {
    return (
      <div className="dab-alert-inspector-pane" data-testid="alert-inspector-empty">
        <StudioCard>
          <div className="dab-muted">Select or inspect a Looker alert to view its condition, filters, destinations, and run history.</div>
        </StudioCard>
      </div>
    )
  }

  const alertTitle = String(bundle.custom_title || bundle.title || `Alert #${bundle.alert_id || bundle.id}`)
  const dashId = String(bundle.dashboard_id || bundle.lookml_dashboard_id || '').trim()
  const dashboardFilterUrl = buildAlertDashboardFilterUrl(bundle)
  const statusTone = bundle.error ? 'danger' : bundle.is_disabled ? 'warning' : 'success'
  const statusLabel = bundle.error ? 'Failing' : bundle.is_disabled ? 'Disabled' : 'Active'
  const appliedFilters = bundle.applied_dashboard_filters || []
  const fieldFilters = bundle.field?.filter || []
  const destinations = bundle.destinations || []
  const historyItems = (bundle.alert_history_items || []).slice(0, 10)

  return (
    <div className="dab-alert-inspector-wrap" data-testid="alert-inspector-pane">
      <StudioToolbar
        testId="alert-inspector-toolbar"
        title={<strong data-testid="alert-inspector-title">{alertTitle}</strong>}
        badges={
          <>
            <StudioBadge tone={statusTone} pill testId="alert-inspector-status-badge">{statusLabel}</StudioBadge>
            {bundle.cron ? <StudioBadge tone="neutral" pill testId="alert-inspector-cron-badge">Cron: {bundle.cron}</StudioBadge> : null}
            {dashId ? (
              <StudioBadge tone="accent" pill testId="alert-inspector-dashboard-badge">
                {bundle.dashboard_name ? `${bundle.dashboard_name} (#${dashId})` : `Dashboard #${dashId}`}
              </StudioBadge>
            ) : null}
          </>
        }
        actions={
          <>
            {dashboardFilterUrl ? (
              <StudioButton variant={previewingDashboard ? 'primary' : 'secondary'} testId="alert-preview-dashboard-btn" onClick={onTogglePreviewDashboard}>
                {previewingDashboard ? 'Back to Alert Inspector' : 'Preview Dashboard with Filters'}
              </StudioButton>
            ) : null}
            {dashId && onOpenInLooker ? (
              <StudioButton variant="secondary" testId="alert-open-dashboard-btn" onClick={() => onOpenInLooker(dashboardFilterUrl.replace(/^\/embed/, '') || `/dashboards/${encodeURIComponent(dashId)}`)}>
                Open Dashboard ↗
              </StudioButton>
            ) : null}
          </>
        }
      />

      {!previewingDashboard ? (
        <div className="dab-alert-inspector-body" data-testid="alert-inspector-details">
          {(bundle.error || bundle.disabled_reason) ? (
            <StudioCard className="dab-alert-banner-card" testId="alert-inspector-diagnostic-banner">
              {bundle.error ? <div data-testid="alert-inspector-error"><strong>Error:</strong> {bundle.error}</div> : null}
              {bundle.disabled_reason ? <div data-testid="alert-inspector-disabled-reason"><strong>Disabled Reason:</strong> {bundle.disabled_reason}</div> : null}
            </StudioCard>
          ) : null}

          <div className="dab-alert-inspector-grid">
            <StudioCard testId="alert-condition-card">
              <div className="dab-alert-card-title">Condition & Target</div>
              <div className="dab-alert-kv-list">
                <div>
                  <span className="dab-muted">Field:</span> <strong data-testid="alert-field-name">{bundle.field?.title || bundle.field?.name || '—'}</strong>
                  {bundle.field?.name && bundle.field?.title && bundle.field.name !== bundle.field.title ? <span className="dab-muted"> ({bundle.field.name})</span> : null}
                </div>
                <div>
                  <span className="dab-muted">Rule:</span> <strong data-testid="alert-rule-summary">{bundle.comparison_type || 'GREATER_THAN'} {bundle.threshold !== undefined ? String(bundle.threshold) : ''}</strong>
                </div>
                <div><span className="dab-muted">Schedule (Cron):</span> <code>{bundle.cron || '—'}</code></div>
                <div><span className="dab-muted">Owner:</span> <span>{bundle.owner_display_name || (bundle.owner_id ? `User #${bundle.owner_id}` : '—')}</span></div>
                {bundle.description ? <div><span className="dab-muted">Description:</span> <span>{bundle.description}</span></div> : null}
              </div>
            </StudioCard>

            <StudioCard testId="alert-applied-filters-card">
              <div className="dab-alert-card-title">Applied Dashboard & Tile Filters</div>
              {appliedFilters.length === 0 && fieldFilters.length === 0 ? (
                <div className="dab-muted">No custom dashboard or tile filter overrides applied.</div>
              ) : (
                <ul className="dab-alert-list" data-testid="alert-applied-filters-list">
                  {appliedFilters.map((f, idx) => (
                    <li key={`${f.field_name || f.filter_title}-${idx}`}>
                      <strong>{f.filter_title || f.field_name}</strong>
                      {f.field_name && f.filter_title && f.field_name !== f.filter_title ? <span className="dab-muted"> ({f.field_name})</span> : null}
                      {': '}<code>{f.filter_value}</code>
                      {f.filter_description ? <span className="dab-muted"> ({f.filter_description})</span> : null}
                    </li>
                  ))}
                  {fieldFilters.map((ff, idx) => (
                    <li key={`field-filter-${idx}`}>
                      <strong>{ff.field_name || 'Tile Filter'}</strong>{': '}<code>{String(ff.field_value ?? ff.filter_value ?? '')}</code>
                    </li>
                  ))}
                </ul>
              )}
              {dashboardFilterUrl ? (
                <div className="dab-muted" style={{ marginTop: 8, fontSize: 11.5 }} data-testid="alert-filter-embed-url">
                  Target URL: <code>{dashboardFilterUrl}</code>
                </div>
              ) : null}
            </StudioCard>

            <StudioCard testId="alert-destinations-card">
              <div className="dab-alert-card-title">Delivery Destinations</div>
              {destinations.length === 0 ? (
                <div className="dab-muted">No delivery destinations configured.</div>
              ) : (
                <ul className="dab-alert-list" data-testid="alert-destinations-list">
                  {destinations.map((d, idx) => (
                    <li key={`${d.destination_type}-${idx}`}>
                      <StudioBadge tone="neutral" pill>{d.destination_type}</StudioBadge> <span>{d.email_address || d.action_hub_integration_id || 'Configured integration'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </StudioCard>

            <StudioCard testId="alert-history-card">
              <div className="dab-alert-card-title">Recent Evaluation History</div>
              {historyItems.length === 0 ? (
                <div className="dab-muted">No recent execution history recorded in alert_details.</div>
              ) : (
                <ul className="dab-alert-list" data-testid="alert-history-list">
                  {historyItems.map((h, idx) => {
                    const outcome = String(h.outcome || (h.message ? 'failed' : 'succeeded'))
                    const tone = /fail|error/i.test(outcome) ? 'danger' : h.alert_condition_met ? 'warning' : 'success'
                    return (
                      <li key={`${h.Check_start_time || idx}-${idx}`}>
                        <StudioBadge tone={tone} pill>{outcome}</StudioBadge> <span>{h.Check_start_time || 'Recent check'}</span>
                        {h.alert_condition_met !== undefined && h.alert_condition_met !== null ? <span className="dab-muted"> · Condition met: {h.alert_condition_met ? 'Yes' : 'No'}</span> : null}
                        {h.message ? <div className="dab-muted">{h.message}</div> : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </StudioCard>
          </div>
        </div>
      ) : null}
    </div>
  )
}
