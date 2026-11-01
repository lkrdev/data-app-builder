import React, { useState } from 'react'
import type { Looker40SDK } from '@looker/sdk'
import {
  getArtifactNamespace,
  listUserArtifacts,
  loadObjectArtifact,
  PersistedChatTurn,
  saveUserArtifact,
} from './lookerApi'
import { LKR_DEV_CLI_SPEC } from './lkrCliBridge'
export { getArtifactNamespace } from './lookerApi'
export * from './lkrCliBridge'

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

export function extractLookmlBundleFromInteraction(interaction: any): LookmlBundle | null {
  const texts = [
    interaction?.output_text,
    ...(interaction?.outputs || []).map((o: any) => o?.text),
    ...(interaction?.steps || []).flatMap((s: any) => [s?.output, s?.result, s?.text]),
  ].filter((x): x is string => typeof x === 'string')
  const matches = Array.from(texts.join('\n').matchAll(/<LOOKML_BUNDLE>([\s\S]*?)<\/LOOKML_BUNDLE>/g))
  return matches.length ? (JSON.parse(matches[matches.length - 1][1].trim()) as LookmlBundle) : null
}

export const LOOKML_TURN_SKILLS = [
  {
    id: 'lookml-field-curation',
    label: '📝 Descriptions & Curation',
    desc: 'Profile string fields, curate descriptions, group_label & hidden flags',
  },
  {
    id: 'lookml-tests',
    label: '🧪 Data Tests (.test.lkml)',
    desc: 'Author & run assert-based LookML data tests via run_lookml_test',
  },
  {
    id: 'lookml-snapshot',
    label: '📸 Snapshot & Parity',
    desc: 'Capture lkr parse lookml snapshot & verify SQL-to-Explore parity',
  },
  {
    id: 'generate-view-from-table',
    label: '🧱 Bronze View',
    desc: 'Scaffold or refresh Bronze base views from table metadata',
  },
  {
    id: 'agentic-lookml-workflow',
    label: '🔄 SQL Workflow',
    desc: 'Full SQL-to-LookML Bronze refinement + Silver/Gold layer workflow',
  },
] as const

export function buildLookmlSystemGuide(params: {
  selectedExplores: string[]
  primaryModel: string
  primaryExplore: string
  projectId?: string
  activatedSkills?: string[]
  developableProjects?: string[]
  canDeploy?: boolean
}): string {
  const {
    selectedExplores,
    primaryModel,
    primaryExplore,
    projectId,
    activatedSkills,
    developableProjects,
    canDeploy = true,
  } = params
  const activeSkillList =
    activatedSkills && activatedSkills.length > 0
      ? activatedSkills
      : ['lookml-field-curation', 'lookml-tests', 'lookml-snapshot']
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
    `Activated Turn Skills: ${activeSkillList.map((s) => `\`${s}\``).join(', ')}. Prioritize reading and executing the instructions for these activated skills on this turn.`,
    selectedExplores.length > 0
      ? `Selected Explore context: ${selectedExplores.join(', ')} (primary: ${primaryModel}::${primaryExplore}).`
      : `See /workspace/schema.md for available models and explores.`,
    `Follow these exact steps:`,
    `1. **Sandbox Bootstrap (\`/workspace\`)**:`,
    `   Run \`python3 /workspace/bootstrap_lookml.py setup\` in your Linux sandbox to install \`uv\` (\`pip install --break-system-packages --quiet uv\`), \`${LKR_DEV_CLI_SPEC}\` (\`UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "${LKR_DEV_CLI_SPEC}"\`), and unpack \`/workspace/.agents/skills/\` (\`agentic-lookml-workflow\`, \`agentic-lookml\`, \`generate-view-from-table\`, \`lookml-field-curation\`, \`lookml\`). Read the SKILL.md files for your Activated Turn Skills (${activeSkillList.join(', ')}).`,
    `2. **Host-Bridged LookML Sync via Browser WASM \`run_looker_codemode(code, thought, vars)\` (\`allowUpdateSession: true\`)**:`,
    `   - Zero sandbox Looker credentials are needed: \`run_looker_codemode\` runs in the browser extension with \`allowUpdateSession: true\`, requires a concise 1-sentence \`thought\` description, accepts \`vars: {...}\`, and has all \`ExtendedLooker40SDK\` methods pre-bound.`,
    `   - Switch to the user's dev workspace (\`update_session({"workspace_id": "dev"})\`) and use whatever branch/state is already in the user's dev mode (inspect via \`git_branch(project_id)\` — do NOT reset to production or create a new git branch unless explicitly asked). Pull LookML files via \`all_project_files\` + \`get_file_content\` into \`/workspace/lookml_baseline/\` and \`/workspace/data/$RUN_ID/lookml/\`.`,
    `3. **100% Offline \`lkr-dev-cli[parse]\` CLI Commands in \`/workspace\`**:`,
    `   - Run offline CLI commands against \`/workspace/data/$RUN_ID/lookml\`: \`lkr parse sql --dialect bigquery --summary\`, \`lkr parse sql-lookml-compare --offline\`, \`lkr parse lookml-to-api --validate\`, \`lkr schema validate --explore-file\`, and \`lkr parse lookml snapshot\` & \`lkr parse curation-meta\`.`,
    `   - Author Bronze refinements, Silver/Gold views & explores, opinionated \`.test.lkml\` tests, and \`/workspace/data/$RUN_ID/summary.md\` according to the Activated Turn Skills (${activeSkillList.join(', ')}).`,
    `4. **Push Modified \`.lkml\` Files, Pre-Gate Parity & Validate via \`run_looker_codemode\`**:`,
    `   - Push changed/deleted \`.lkml\` files back to the user's current dev workspace using \`create_project_directory\`, \`create_file\`, \`update_file\`, \`delete_file\`, then run \`validate_project\` and \`run_lookml_test\`.`,
    `5. **Emit \`<LOOKML_BUNDLE>\`**:`,
    `   Run \`python3 /workspace/bootstrap_lookml.py bundle /workspace/data/$RUN_ID\` (or \`/workspace/lookml_result.json\`) and include the printed \`<LOOKML_BUNDLE>...</LOOKML_BUNDLE>\` tag in your final response.`,
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
  extensionSDK?: any
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
      messages: (studio.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant').slice(-200),
    },
  }
  await saveUserArtifact({ ...index, sdk, userId, content: payload, namespace })
  return { id, userKey, objKey, index, payload }
}

export async function loadLookmlSessionArtifact(
  sdk: Looker40SDK,
  extensionSDK: any,
  rawId: string
): Promise<LookmlArtifactPayload> {
  const namespace = getArtifactNamespace(extensionSDK)
  const cleanId = rawId.trim().replace(/^obj_lookml_/, '')
  const found = await loadObjectArtifact<LookmlArtifactPayload>(sdk, 'lookml', cleanId, namespace)
  if (!found) throw new Error(`LookML session artifact "obj_lookml_${cleanId}" not found.`)
  return found
}

export async function listUserLookmlSessions(
  sdk: Looker40SDK,
  extensionSDK: any,
  userId: string
): Promise<LookmlSessionIndex[]> {
  return (await listUserArtifacts(
    sdk,
    String(userId || 'anon').trim(),
    'lookml',
    getArtifactNamespace(extensionSDK)
  )) as LookmlSessionIndex[]
}

export const LookmlPreviewPane: React.FC<{
  bundle: LookmlBundle | null
  hostUrl: string
  extensionSDK?: any
  canDeploy?: boolean
}> = ({ bundle, hostUrl, extensionSDK, canDeploy = true }) => {
  const [selectedFileIdx, setSelectedFileIdx] = useState(0)
  const [viewMode, setViewMode] = useState<'diff' | 'content'>('diff')

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
  const cardStyle: React.CSSProperties = {
    background: 'var(--dab-surface, #fff)',
    color: 'var(--dab-text, #1f2937)',
    padding: 12,
    borderRadius: 8,
    border: '1px solid var(--dab-border, #e2e8f0)',
  }

  const openLink = (pathOrUrl: string) => {
    const target = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${cleanHost}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
    if (extensionSDK?.openBrowserWindow) extensionSDK.openBrowserWindow(target, '_blank')
    else window.open(target, '_blank', 'noopener,noreferrer')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', padding: 16, gap: 12 }}>
      <div className="dab-controls" style={cardStyle}>
        <div>
          <strong>Project:</strong> <code>{bundle.project_id || 'default'}</code>
        </div>
        {bundle.model_name && (
          <div>
            <strong>Model:</strong> <code>{bundle.model_name}</code>
          </div>
        )}
        <span className="dab-badge" title="Uses whatever branch is active in the user's Looker Dev Mode">
          ⎇ {bundle.branch_name || 'user dev mode'}
        </span>
        <span className="dab-msg-pill" style={valPassed ? undefined : { background: '#fee2e2', color: '#991b1b' }}>
          {valPassed
            ? '✓ LookML Validator Passed'
            : `✗ LookML Validator (${valErrors.length} error${valErrors.length === 1 ? '' : 's'})`}
        </span>
        {tests.length > 0 && (
          <span
            className="dab-msg-pill"
            style={passedTests === tests.length ? undefined : { background: '#fee2e2', color: '#991b1b' }}
          >
            {passedTests === tests.length ? '✓' : '✗'} run_lookml_test ({passedTests}/{tests.length} passed)
          </span>
        )}
        {!canDeploy && (
          <span
            className="dab-badge"
            style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}
            title="Requires Looker 'deploy' or 'admin' permission to run deploy_to_production"
          >
            🔒 deploy_to_production disabled (missing deploy)
          </span>
        )}
      </div>

      {queries.length > 0 && (
        <div style={cardStyle}>
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
                  {q.parity_status && <span className="dab-msg-pill">{q.parity_status}</span>}
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
        </div>
      )}

      {(valErrors.length > 0 || tests.length > 0) && (
        <div style={cardStyle}>
          {valErrors.map((e, i) => (
            <div key={i} style={{ fontFamily: 'monospace', fontSize: 11, color: '#991b1b' }}>
              {e.file_path ? `${e.file_path}${e.line_number ? `:${e.line_number}` : ''} — ` : ''}
              {e.message}
            </div>
          ))}
          {tests.length > 0 && (
            <div className="dab-controls" style={{ marginTop: valErrors.length ? 6 : 0 }}>
              {tests.map((t, i) => (
                <span
                  key={i}
                  className="dab-msg-pill"
                  style={t.success ? undefined : { background: '#fee2e2', color: '#991b1b' }}
                >
                  {t.success ? '✓' : '✗'} {t.test_name}
                  {t.file_id ? ` (${t.file_id})` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ ...cardStyle, padding: 0, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 240, overflow: 'hidden' }}>
        <div className="dab-inspector-bar" style={{ padding: '8px 12px', borderBottom: '1px solid var(--dab-border, #e2e8f0)', background: 'var(--dab-surface-muted, #f8fafc)' }}>
          <div className="dab-controls">
            {files.length === 0 ? (
              <span className="dab-muted">No modified .lkml files recorded</span>
            ) : (
              files.map((f, idx) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setSelectedFileIdx(idx)}
                  className={idx === selectedFileIdx ? 'dab-btn-primary' : 'dab-btn-secondary'}
                  style={{ fontFamily: 'monospace', fontSize: 11 }}
                >
                  {f.action === 'created' ? '+ ' : f.action === 'deleted' ? '- ' : 'Δ '}
                  {f.path}
                </button>
              ))
            )}
          </div>
          {activeFile && (
            <div className="dab-controls">
              <button
                type="button"
                className="dab-btn-secondary"
                onClick={() => setViewMode((m) => (m === 'diff' ? 'content' : 'diff'))}
              >
                {viewMode === 'diff' ? 'Show Full .lkml' : 'Show Unified Diff'}
              </button>
              <button
                type="button"
                className="dab-btn-secondary"
                onClick={() => navigator.clipboard?.writeText(activeFile.content || activeFile.diff || '')}
              >
                Copy .lkml
              </button>
            </div>
          )}
        </div>
        <pre style={{ margin: 0, padding: 12, flex: 1, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', fontSize: 12 }}>
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
      </div>

      {bundle.summary_markdown && (
        <details open style={cardStyle}>
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
