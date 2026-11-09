import React, { useEffect, useRef, useState } from 'react'

import type { ExtensionSDK } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'
import { Lock, MoreVertical } from 'lucide-react'

import { LOOKER_PROJECT_ONBOARDING_SKILL_MD } from './antigravityPrompts'
import { StudioBadge, StudioButton, StudioCard } from './components/StudioDesignSystem'
import { LKR_DEV_CLI_SPEC } from './lkrCliBridge'
import {
  type AccessibleLookerConnection,
  copyTextWithExtensionSdk,
  formatAccessibleConnectionsMarkdown,
  getArtifactNamespace,
  loadObjectArtifact,
  PersistedChatTurn,
  saveUserArtifact,
} from './lookerApi'
import { extractSlashSkillIds } from './lookmlSkills'
export { getArtifactNamespace } from './lookerApi'
export * from './lkrCliBridge'
export * from './lookmlSkills'

export interface LookmlFileChange {
  path: string
  action?: 'created' | 'updated' | 'deleted'
  content?: string
  diff?: string
}

export interface LookmlTestResult {
  test_name: string
  model_name?: string
  file_id?: string
  success: boolean
  errors?: Array<{ message?: string }>
}

export interface LookmlParityQuery {
  query_index?: number
  label?: string
  sql_slug?: string
  sql_runner_url?: string
  explore_slug?: string
  explore_url?: string
  parity_status?: string
  mismatches?: string[]
}

export interface LookmlBundle {
  id: string
  title: string
  project_id: string
  model_name?: string
  branch_name?: string
  files: LookmlFileChange[]
  validation?: {
    passed: boolean
    error_count?: number
    errors?: Array<{ message: string; file_path?: string; line_number?: number; severity?: string }>
  }
  tests?: LookmlTestResult[]
  queries?: LookmlParityQuery[]
  summary_markdown?: string
}

export interface LookmlSessionIndex {
  id: string
  type: 'lookml'
  title: string
  updatedAt: string
  createdBy: string
  targetId: string
  branchName?: string
  explores?: string[]
  lastInteractionId?: string
  environmentId?: string
}

export interface LookmlArtifactPayload {
  id: string
  type: 'lookml'
  title: string
  updatedAt: string
  createdBy: string
  bundle: LookmlBundle
  studio?: {
    explores?: string[]
    lastInteractionId?: string
    environmentId?: string
    messages?: PersistedChatTurn[]
  }
}

export interface LookmlInteractionLike {
  output_text?: string
  outputs?: Array<{ text?: string }>
  steps?: Array<{
    output?: string
    stdout?: string
    result?: string
    text?: string
    content?: unknown
    code_execution_result?: { output?: string }
  }>
}

export function extractLookmlBundleFromInteraction(
  interaction?: LookmlInteractionLike | null
): LookmlBundle | null {
  const texts = [
    interaction?.output_text,
    ...(interaction?.outputs || []).map((o) => o?.text),
    ...(interaction?.steps || []).flatMap((s) => [
      s?.output,
      s?.stdout,
      s?.result,
      s?.text,
      s?.code_execution_result?.output,
      ...(Array.isArray(s?.content) ? s.content.map((c) => (c as { text?: string })?.text) : [s?.content]),
    ]),
  ].filter((x): x is string => typeof x === 'string')
  const matches = Array.from(texts.join('\n').matchAll(/<LOOKML_BUNDLE>([\s\S]*?)<\/LOOKML_BUNDLE>/g))
  if (!matches.length) return null
  const bundle = JSON.parse(matches[matches.length - 1][1].trim()) as LookmlBundle
  // ponytail: synthesize unified diff for newly created files on client so sandbox stdout omits duplicate content
  for (const f of bundle.files || []) {
    if (!f.diff && f.content) {
      const lines = f.content.replace(/\r?\n$/, '').split('\n')
      f.diff = `--- a/${f.path}\n+++ b/${f.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`
    }
  }
  return bundle
}

export function buildLookmlSystemGuide(params: {
  selectedExplores: string[]
  primaryModel?: string
  primaryExplore?: string
  projectId?: string
  activatedSkills?: string[]
  userPrompt?: string
  developableProjects?: string[]
  canDeploy?: boolean
  availableConnections?: ReadonlyArray<AccessibleLookerConnection> | string
}): string {
  const {
    selectedExplores,
    primaryModel,
    primaryExplore,
    projectId,
    activatedSkills,
    userPrompt,
    developableProjects,
    canDeploy = true,
    availableConnections,
  } = params
  const activeSkillList = Array.from(
    new Set([...(activatedSkills || []), ...extractSlashSkillIds(userPrompt)])
  )
  const hasExplicitSkills = activeSkillList.length > 0
  const connectionsBlock =
    typeof availableConnections === 'string'
      ? availableConnections.trim()
      : Array.isArray(availableConnections) && availableConnections.length > 0
      ? formatAccessibleConnectionsMarkdown(availableConnections)
      : ''
  const devProjectsHint =
    developableProjects && developableProjects.length > 0
      ? `Developable LookML projects (via Model -> Project expansion): ${developableProjects.join(', ')}.`
      : ''
  const deployHint = canDeploy
    ? 'User holds `deploy` permission (`deploy_to_production` allowed only when explicitly requested).'
    : 'User does NOT hold `deploy` permission — do NOT call `deploy_to_production`.'
  const projHint = projectId?.trim()
    ? `Target LookML project_id: "${projectId.trim()}". ${devProjectsHint} ${deployHint}`.trim()
    : primaryModel
    ? `Resolve the LookML project_id from model "${primaryModel}" via \`lookml_model("${primaryModel}")["project_name"]\` or \`all_projects()\`. ${devProjectsHint} ${deployHint}`.trim()
    : `Discover the target LookML project_id via \`all_projects(fields="id,name,git_remote_url")\` or \`lookml_model(model_name)\`. ${devProjectsHint} ${deployHint}`.trim()

  return [
    `You are the **Agentic LookML** engineer powered by \`lkrdev/cli\` and the \`agentic-lookml\` skill suite.`,
    projHint,
    ...(connectionsBlock ? [connectionsBlock] : []),
    hasExplicitSkills
      ? `Activated Turn Skills: ${activeSkillList.map((s) => `\`${s}\``).join(', ')}. Prioritize reading and executing the instructions for these activated skills on this turn.`
      : `Automatically discover and load the matching skill(s) for this turn from \`/workspace/AGENTS.md\` and \`/workspace/skills/<skill-id>/SKILL.md\`.`,
    selectedExplores.length > 0
      ? `Selected Explore context: ${selectedExplores.join(', ')} (primary: ${primaryModel}::${primaryExplore}).`
      : `See /workspace/schema.md for available models and explores.`,
    `Follow these exact steps:`,
    `1. **Sandbox Bootstrap (\`/workspace\`)**:`,
    `   If the user asks to create/onboard a new project without specifying a connection name, project name, and target tables/schemas (e.g. "create a new project"), ${
      connectionsBlock
        ? 'use the pre-fetched `Available Looker Connections` listed above in ONE toolless pass (`0` tool calls — do NOT call `run_looker_codemode` or `code_execution`)'
        : 'run ONE `run_looker_codemode` call (`all_connections(fields="name,dialect_name,database,schema")` with fallback to `all_lookml_models(fields="name,project_name,allowed_db_connection_names")` — bare Monty globals, never `sdk.*`; do NOT call `code_execution`) to discover available connections'
    }, and immediately ask for: (1) Connection Name (listing the discovered connection names with dialect/database/schema alongside \`[Open Looker Connections](/admin/connections)\`), (2) Project Name (\`snake_case\`), and (3) Target Tables or Schemas (or SQL from \`[Open SQL Runner](/sql)\`). If the user is only asking what schemas a connection has access to (before selecting target schemas/tables), call ONLY ONE \`run_looker_codemode\` (\`connection_schemas(conn_name)\` — bare Monty global, never \`sdk.*\`) and do NOT call \`code_execution\` or \`view_file\`. Otherwise, when authoring or pushing LookML files in \`/workspace\`, run \`python3 /workspace/bootstrap_lookml.py setup\` in your Linux sandbox to install \`uv\` (\`pip install --break-system-packages --quiet uv\`), \`${LKR_DEV_CLI_SPEC}\` (\`UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "${LKR_DEV_CLI_SPEC}"\`), and link the pre-mounted \`/workspace/skills/\` into \`/workspace/.agents/skills/\` (zero outbound network calls). ${hasExplicitSkills ? `Read the SKILL.md files for your Activated Turn Skills (${activeSkillList.join(', ')})` : `Discover and read the matching \`/workspace/skills/<skill-id>/SKILL.md\` file(s) from \`/workspace/AGENTS.md\``}, or load \`/workspace/skills/looker-project-onboarding/SKILL.md\` when onboarding a brand-new LookML project from a database connection.`,
    ...(activeSkillList.includes('looker-project-onboarding') || !projectId?.trim() || selectedExplores.length === 0 ? [LOOKER_PROJECT_ONBOARDING_SKILL_MD] : []),
    `2. **Host-Bridged LookML Sync via Browser WASM \`run_looker_codemode(code, thought, vars)\`**:`,
    `   - Zero sandbox Looker credentials are needed: \`run_looker_codemode\` runs in the browser extension, requires a concise 1-sentence \`thought\` description, accepts \`vars: {...}\`, and has all \`ExtendedLooker40SDK\` methods pre-bound as bare globals (never prefix with \`sdk.\`). Do NOT call \`update_session\` inside \`run_looker_codemode\` — dev mode is controlled by the app session or the \`--dev\` CLI flag.`,
    `   - Use whatever branch/state is already in the user's dev mode (inspect via \`git_branch(project_id)\` — do NOT reset to production or create a new git branch unless explicitly asked). Pull LookML files via \`all_project_files\` + \`get_file_content\` into \`/workspace/lookml_baseline/\` and \`/workspace/data/$RUN_ID/lookml/\`.`,
    `3. **100% Offline \`lkr-dev-cli[parse]\` CLI Commands in \`/workspace\`**:`,
    `   - Run offline CLI commands against \`/workspace/data/$RUN_ID/lookml\`: \`lkr parse sql --dialect bigquery --summary\`, \`lkr parse sql-lookml-compare --offline\`, \`lkr parse lookml-to-api --validate\`, \`lkr schema validate --explore-file\`, and \`lkr parse lookml snapshot\` & \`lkr parse curation-meta\`.`,
    `   - Author Bronze refinements, Silver/Gold views & explores, opinionated \`.test.lkml\` tests, and \`/workspace/data/$RUN_ID/summary.md\` ${hasExplicitSkills ? `according to the Activated Turn Skills (${activeSkillList.join(', ')})` : `according to the matching \`/workspace/skills/<skill-id>/SKILL.md\` instructions`}.`,
    `4. **Push Modified \`.lkml\` Files via \`lkr --dev tools lookml push\`, Pre-Gate Parity & Validate**:`,
    `   - Push local \`.lkml\` files back to Looker dev mode using \`lkr --dev tools lookml push /workspace/lookml --project-id <project_id> --no-reset\` (which automatically creates directories and configures \`.model.lkml\`), then run \`validate_project\` and \`run_lookml_test\`.`,
    `5. **Emit \`<LOOKML_BUNDLE>\` & Clickable Links**:`,
    `   Run \`python3 /workspace/bootstrap_lookml.py bundle /workspace/data/$RUN_ID\` (or \`/workspace/lookml_result.json\`), include the printed \`<LOOKML_BUNDLE>...</LOOKML_BUNDLE>\` tag, and end every turn that creates or updates LookML project files with \`[Open <project_name> in Looker IDE](/projects/<project_name>/files)\` (and end every turn that creates or updates a Looker dashboard with \`[Open <Dashboard Title>](/dashboards/<id>)\`).`,
  ].join('\n')
}

export function getLookmlArtifactKeys(userId: string, id: string) {
  const cleanUser = String(userId || 'anon').trim()
  const cleanId = String(id || 'default').trim().replace(/[^a-zA-Z0-9_-]/g, '_')
  return {
    id: cleanId,
    userKey: `user_${cleanUser}_lookml_${cleanId}`,
    objKey: `obj_lookml_${cleanId}`,
  }
}

// ponytail: persist two-tier Looker Artifacts (`user_${userId}_lookml_${id}` compact index + `obj_lookml_${id}` full payload)
// via shared saveUserArtifact/loadObjectArtifact/listUserArtifacts in lookerArtifacts.ts.
export async function saveLookmlSessionArtifact(params: {
  sdk: Looker40SDK
  extensionSDK?: Partial<ExtensionSDK>
  userId: string
  bundle: LookmlBundle
  studio: {
    explores?: string[]
    lastInteractionId?: string
    environmentId?: string
    messages?: PersistedChatTurn[]
  }
}) {
  const { sdk, extensionSDK, userId, bundle, studio } = params
  const namespace = getArtifactNamespace(extensionSDK)
  const rawId = bundle.id || bundle.branch_name || `${bundle.project_id || 'lookml'}_${Date.now().toString(36)}`
  const { id, userKey, objKey } = getLookmlArtifactKeys(userId, rawId)
  const updatedAt = new Date().toISOString()
  const title = bundle.title || `LookML (${bundle.project_id || id})`
  const explores = studio.explores || []
  const index: LookmlSessionIndex = {
    id, type: 'lookml', title, updatedAt, createdBy: String(userId),
    targetId: bundle.project_id || '', branchName: bundle.branch_name,
    explores, lastInteractionId: studio.lastInteractionId, environmentId: studio.environmentId,
  }
  const payload: LookmlArtifactPayload = {
    id, type: 'lookml', title, updatedAt, createdBy: String(userId),
    bundle: { ...bundle, id },
    studio: {
      explores, lastInteractionId: studio.lastInteractionId, environmentId: studio.environmentId,
    },
  }
  await saveUserArtifact({ ...index, sdk, userId, content: payload, namespace })
  return { id, userKey, objKey, index, payload }
}

export async function loadLookmlSessionArtifact(
  sdk: Looker40SDK,
  extensionSDK: Partial<ExtensionSDK> | undefined,
  rawId: string
): Promise<LookmlArtifactPayload> {
  const namespace = getArtifactNamespace(extensionSDK)
  const cleanId = rawId.trim().replace(/^obj_lookml_/, '')
  const found = await loadObjectArtifact<LookmlArtifactPayload>(sdk, 'lookml', cleanId, namespace)
  if (!found) throw new Error(`LookML session artifact "obj_lookml_${cleanId}" not found.`)
  return found
}

export const LookmlPreviewPane: React.FC<{
  bundle: LookmlBundle | null
  hostUrl: string
  extensionSDK?: Partial<ExtensionSDK>
  canDeploy?: boolean
}> = ({ bundle, hostUrl, extensionSDK, canDeploy = true }) => {
  const [selectedFileIdx, setSelectedFileIdx] = useState(0)
  const [viewMode, setViewMode] = useState<'diff' | 'content'>('diff')
  const [codeMenuOpen, setCodeMenuOpen] = useState(false)
  const [copiedFile, setCopiedFile] = useState(false)
  const codeMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!codeMenuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (codeMenuRef.current && !codeMenuRef.current.contains(e.target as Node)) setCodeMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setCodeMenuOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [codeMenuOpen])

  if (!bundle) {
    return (
      <div className="dab-placeholder">
        <p>
          <strong>Agentic LookML Workspace</strong>
        </p>
        <p className="dab-muted" style={{ maxWidth: 480, textAlign: 'center' }}>
          Enter a SQL query, metric definition, or LookML task on the left. Antigravity will
          switch to your Looker <code>dev</code> workspace via <code>LkrCodeMode</code>,
          run offline <code>lkr parse</code> &amp; <code>lkr schema validate</code>, push
          modified <code>.lkml</code> files, and render diffs, LookML Validator /{' '}
          <code>run_lookml_test</code> status, and clickable <code>/sql/:slug</code> +{' '}
          <code>/x/:slug</code> parity links here.
        </p>
      </div>
    )
  }

  const files = bundle.files || []
  const activeFile = files[selectedFileIdx] || files[0] || null
  const valPassed = bundle.validation ? bundle.validation.passed : true
  const valErrors = bundle.validation?.errors || []
  const tests = bundle.tests || []
  const passedTests = tests.filter((t) => t.success).length
  const queries = bundle.queries || []
  const cleanHost = hostUrl.replace(/\/$/, '')

  const projectIdePath = bundle.project_id?.trim() ? `/projects/${encodeURIComponent(bundle.project_id.trim())}/files` : ''
  const openLink = (pathOrUrl: string) => {
    const p = String(pathOrUrl || '').trim()
    if (!p) return
    const rel = p.startsWith('http') || p.startsWith('/') ? p : `/${p}`
    if (extensionSDK?.openBrowserWindow) extensionSDK.openBrowserWindow(rel, '_blank')
    else if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(p.startsWith('http') ? p : `${cleanHost}${rel}`, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', padding: 16, gap: 12 }}>
      <StudioCard className="dab-controls">
        <div>
          <strong>Project:</strong> <code>{bundle.project_id || 'default'}</code>
        </div>
        {projectIdePath && (
          <StudioButton variant="secondary" testId="lookml-open-ide-btn" onClick={() => openLink(projectIdePath)}>
            Open Project in IDE
          </StudioButton>
        )}
        {bundle.model_name && (
          <div>
            <strong>Model:</strong> <code>{bundle.model_name}</code>
          </div>
        )}
        <StudioBadge title="Uses whatever branch is active in the user's Looker Dev Mode">
          ⎇ {bundle.branch_name || 'user dev mode'}
        </StudioBadge>
        <StudioBadge pill tone={valPassed ? undefined : 'danger'}>
          {valPassed
            ? '✓ LookML Validator Passed'
            : `✗ LookML Validator (${valErrors.length} error${valErrors.length === 1 ? '' : 's'})`}
        </StudioBadge>
        {tests.length > 0 && (
          <StudioBadge pill tone={passedTests === tests.length ? undefined : 'danger'}>
            {passedTests === tests.length ? '✓' : '✗'} run_lookml_test ({passedTests}/{tests.length} passed)
          </StudioBadge>
        )}
        {!canDeploy && (
          <StudioBadge
            tone="warning"
            title="Requires Looker 'deploy' or 'admin' permission to run deploy_to_production"
          >
            <Lock size={13} strokeWidth={1.75} aria-hidden="true" /> deploy_to_production disabled (missing deploy)
          </StudioBadge>
        )}
      </StudioCard>

      {queries.length > 0 && (
        <StudioCard>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            SQL-to-LookML Parity Queries (<code>/sql/:slug</code> &amp; <code>/x/:slug</code>)
          </div>
          {queries.map((q, i) => {
            const sqlPath = q.sql_runner_url || (q.sql_slug ? `/sql/${q.sql_slug}` : '')
            const explorePath = q.explore_url || (q.explore_slug ? `/x/${q.explore_slug}` : '')
            return (
              <div key={i} className="dab-inspector-bar" style={{ padding: '4px 0' }}>
                <div className="dab-controls">
                  <strong>{q.label || `Query #${(q.query_index ?? i) + 1}`}</strong>
                  {q.parity_status && <StudioBadge pill>{q.parity_status}</StudioBadge>}
                </div>
                <div className="dab-controls">
                  {sqlPath && (
                    <button type="button" className="dab-btn-secondary" onClick={() => openLink(sqlPath)}>
                      <code>{q.sql_slug ? `/sql/${q.sql_slug}` : 'SQL Runner'}</code> ↗
                    </button>
                  )}
                  {explorePath && (
                    <button type="button" className="dab-btn-secondary" onClick={() => openLink(explorePath)}>
                      <code>{q.explore_slug ? `/x/${q.explore_slug}` : 'Explore'}</code> ↗
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </StudioCard>
      )}

      {(valErrors.length > 0 || tests.length > 0) && (
        <StudioCard>
          {valErrors.map((e, i) => (
            <div key={i} style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--dab-danger-text)' }}>
              {e.file_path ? `${e.file_path}${e.line_number ? `:${e.line_number}` : ''} — ` : ''}
              {e.message}
            </div>
          ))}
          {tests.length > 0 && (
            <div className="dab-controls" style={{ marginTop: valErrors.length ? 6 : 0 }}>
              {tests.map((t, i) => (
                <StudioBadge key={i} pill tone={t.success ? undefined : 'danger'}>
                  {t.success ? '✓' : '✗'} {t.test_name}
                  {t.file_id ? ` (${t.file_id})` : ''}
                </StudioBadge>
              ))}
            </div>
          )}
        </StudioCard>
      )}

      <StudioCard style={{ padding: 0, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 240 }}>
        <div
          className="dab-inspector-bar"
          style={{
            padding: '8px 12px',
            gap: 8,
            borderBottom: '1px solid var(--dab-border, #e2e8f0)',
            background: 'var(--dab-surface-muted, #f8fafc)',
            borderRadius: '7px 7px 0 0',
          }}
        >
          <div
            className="dab-controls"
            data-testid="lookml-file-tabs"
            style={{ flexWrap: 'nowrap', overflowX: 'auto', flex: 1, minWidth: 0 }}
          >
            {files.length === 0 ? (
              <span className="dab-muted">No modified .lkml files recorded</span>
            ) : (
              files.map((f, idx) => (
                <button
                  key={f.path}
                  type="button"
                  data-testid={`lookml-file-tab-${idx}`}
                  onClick={() => setSelectedFileIdx(idx)}
                  className={idx === selectedFileIdx ? 'dab-btn-primary' : 'dab-btn-secondary'}
                  style={{ fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}
                >
                  {f.action === 'created' ? '+ ' : f.action === 'deleted' ? '- ' : 'Δ '}
                  {f.path}
                </button>
              ))
            )}
          </div>
          {activeFile && (
            <div ref={codeMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                data-testid="lookml-code-actions-btn"
                className="dab-btn dab-btn-secondary dab-btn-icon"
                title="LookML file actions"
                aria-label="LookML file actions"
                aria-haspopup="menu"
                aria-expanded={codeMenuOpen}
                onClick={() => setCodeMenuOpen((prev) => !prev)}
              >
                <MoreVertical size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
              {codeMenuOpen && (
                <div
                  data-testid="lookml-code-actions-menu"
                  role="menu"
                  aria-label="LookML file actions"
                  className="dab-studio-menu align-right"
                  style={{ minWidth: 168 }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="lookml-toggle-view-mode-btn"
                    className="dab-studio-menu-item"
                    onClick={() => {
                      setViewMode((m) => (m === 'diff' ? 'content' : 'diff'))
                      setCodeMenuOpen(false)
                    }}
                  >
                    <span>{viewMode === 'diff' ? 'Show Full .lkml' : 'Show Unified Diff'}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="lookml-copy-file-btn"
                    className="dab-studio-menu-item"
                    onClick={() => {
                      void copyTextWithExtensionSdk(activeFile.content || activeFile.diff || '', extensionSDK)
                      setCopiedFile(true)
                      setTimeout(() => setCopiedFile(false), 1800)
                      setCodeMenuOpen(false)
                    }}
                  >
                    <span>{copiedFile ? 'Copied .lkml' : 'Copy .lkml'}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <pre style={{ margin: 0, padding: 12, flex: 1, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', fontSize: 12, borderRadius: '0 0 7px 7px' }}>
          {activeFile
            ? (viewMode === 'diff' && activeFile.diff ? activeFile.diff : activeFile.content || activeFile.diff || '')
                .split('\n')
                .map((line, i) => {
                  const isAdd = viewMode === 'diff' && line.startsWith('+') && !line.startsWith('+++')
                  const isDel = viewMode === 'diff' && line.startsWith('-') && !line.startsWith('---')
                  return (
                    <div
                      key={i}
                      style={{
                        color: isAdd ? '#4ade80' : isDel ? '#f87171' : line.startsWith('@@') ? '#38bdf8' : '#e2e8f0',
                      }}
                    >
                      {line}
                    </div>
                  )
                })
            : 'No .lkml file selected.'}
        </pre>
      </StudioCard>

      {bundle.summary_markdown && (
        <details open className="dab-ds-card">
          <summary style={{ fontWeight: 700, cursor: 'pointer' }}>
            Agentic LookML Diagnostic Summary (<code>summary.md</code>)
          </summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '8px 0 0' }}>
            {bundle.summary_markdown}
          </pre>
        </details>
      )}
    </div>
  )
}
