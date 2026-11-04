import {
  AGENTS_MD, BUNDLE_APP_PY, DATA_APP_GUIDE_MD, DATA_INVESTIGATOR_GUIDE_MD,
  KDA_SKILL_MD, KDA_TOOLKIT_PY, LOOKER_PROJECT_ONBOARDING_SKILL_MD,
} from './antigravityPrompts'
export { APP_BUILDER_SYSTEM_PROMPT, LOOKER_PROJECT_ONBOARDING_SKILL_MD } from './antigravityPrompts'
import {
  type AntigravityActivityStep, type AntigravityInteractionOutput,
  type AntigravityInteractionPayload, type AntigravityInteractionStep, type AntigravityTurnTelemetry,
} from './antigravityTypes'
import { type DataAppBundle, type NativeContentBundle, resolveNativeEmbedPath } from './lookerApi'
import { BOOTSTRAP_LOOKML_PY, LKR_CLI_SITECUSTOMIZE_PY } from './lookmlTool'

export function collectInteractionTextCandidates(interaction: AntigravityInteractionPayload | null | undefined): string {
  const out: unknown[] = [interaction?.output_text]
  for (const o of interaction?.outputs || []) out.push(o?.text)
  for (const s of interaction?.steps || []) out.push(s?.output, s?.stdout, s?.result, s?.text, s?.code_execution_result?.output)
  return out.filter((x): x is string => typeof x === 'string').join('\n')
}

export function extractBundleFromInteraction(interaction: AntigravityInteractionPayload | null | undefined): DataAppBundle | null {
  const matches = Array.from(collectInteractionTextCandidates(interaction).matchAll(/<DATA_APP_BUNDLE>([\s\S]*?)<\/DATA_APP_BUNDLE>/g))
  return matches.length > 0 ? (JSON.parse(matches[matches.length - 1][1].trim()) as DataAppBundle) : null
}

export function extractTddFromInteraction(interaction: AntigravityInteractionPayload | null | undefined): string | null {
  const combined = collectInteractionTextCandidates(interaction)
  const matches = Array.from(combined.matchAll(/<HEALTH_CHECK_TDD>([\s\S]*?)<\/HEALTH_CHECK_TDD>/g))
  if (matches.length > 0) return matches[matches.length - 1][1].trim()
  return combined.includes('## 1. Executive Summary') && combined.includes('## 7.') ? combined.trim() : null
}

const VALID_NATIVE_CONTENT_TYPES = new Set(['dashboard', 'lookml_dashboard', 'look', 'board'])

function normalizeNativeBundleCandidate(raw: unknown, allowUnwrapped = false): NativeContentBundle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rawObj = raw as Record<string, unknown>
  const hasBundleEnvelope = Boolean(rawObj.NATIVE_CONTENT_BUNDLE && typeof rawObj.NATIVE_CONTENT_BUNDLE === 'object')
  const r = hasBundleEnvelope ? (rawObj.NATIVE_CONTENT_BUNDLE as Record<string, unknown>) : rawObj
  const explicitType = String(r.content_type || r.contentType || '').trim()
  const hasExplicitContentId = Boolean(
    r.dashboard_id || r.lookml_dashboard_id || r.look_id || r.board_id || (typeof r.embed_path === 'string' && r.embed_path.startsWith('/embed/'))
  )
  if (!allowUnwrapped && !hasBundleEnvelope && !(VALID_NATIVE_CONTENT_TYPES.has(explicitType) && hasExplicitContentId)) return null
  const id = r.id || r.lookml_dashboard_id || r.dashboard_id || r.look_id || r.board_id
  if (!id) return null
  const strId = String(id).trim()
  const cType = (r.content_type || r.contentType ||
    (r.board_id ? 'board' : r.look_id && !r.dashboard_id ? 'look' : strId.includes('::') ? 'lookml_dashboard' : 'dashboard')
  ) as NativeContentBundle['contentType'] & string
  const folderId = r.folder_id || r.folderId ? String(r.folder_id || r.folderId) : undefined
  const embedPath = resolveNativeEmbedPath(cType, strId, typeof (r.embed_path || r.url) === 'string' ? String(r.embed_path || r.url) : undefined)
  const asRecord = (v: unknown): Record<string, string> | undefined => (v && typeof v === 'object' ? (v as Record<string, string>) : undefined)
  return {
    id: strId, content_type: cType, contentType: cType, title: String(r.title || `Native ${cType} #${strId}`),
    folder_id: folderId, folderId, embed_path: embedPath, url: embedPath,
    tile_count: typeof r.tile_count === 'number' ? r.tile_count : Array.isArray(r.elements) ? r.elements.length : undefined,
    filter_count: typeof r.filter_count === 'number' ? r.filter_count : Array.isArray(r.filter_names) ? r.filter_names.length : undefined,
    schedule_id: r.schedule_id ? String(r.schedule_id) : undefined,
    look_id: r.look_id ? String(r.look_id) : undefined,
    board_id: r.board_id ? String(r.board_id) : undefined,
    lookml_dashboard_id: r.lookml_dashboard_id ? String(r.lookml_dashboard_id) : cType === 'lookml_dashboard' ? strId : undefined,
    project_id: r.project_id ? String(r.project_id) : undefined,
    model: r.model ? String(r.model) : undefined,
    file_path: r.file_path ? String(r.file_path) : undefined,
    layout_id: r.layout_id ? String(r.layout_id) : undefined,
    element_ids: Array.isArray(r.element_ids) ? r.element_ids.map(String) : undefined,
    filter_names: Array.isArray(r.filter_names) ? r.filter_names.map(String) : undefined,
    layout_component_ids: asRecord(r.layout_component_ids), query_cache: asRecord(r.query_cache), filter_cache: asRecord(r.filter_cache),
    summary: r.summary ? String(r.summary) : undefined,
    elements: Array.isArray(r.elements) ? (r.elements as NativeContentBundle['elements']) : undefined,
    explores: Array.isArray(r.explores) ? r.explores.map(String) : undefined,
  }
}

// ponytail: capture NATIVE_CONTENT_BUNDLE directly from run_looker_codemode return value first
export function extractNativeContentFromInteraction(
  interaction: AntigravityInteractionPayload | null | undefined
): NativeContentBundle | null {
  for (const step of [...(interaction?.steps || [])].reverse()) {
    if (step?.type === 'function_result' && step?.name === 'run_looker_codemode') {
      const rawStr = typeof step.result === 'string' ? step.result : JSON.stringify(step.result || '')
      const tagMatches = Array.from(rawStr.matchAll(/<NATIVE_CONTENT_BUNDLE>([\s\S]*?)<\/NATIVE_CONTENT_BUNDLE>/g))
      if (tagMatches.length > 0) {
        try {
          const norm = normalizeNativeBundleCandidate(JSON.parse(tagMatches[tagMatches.length - 1][1].trim()), true)
          if (norm) return norm
        } catch { /* ignore */ }
      }
      try {
        const parsed = typeof step.result === 'string' ? JSON.parse(step.result) : step.result
        const parsedObj = parsed && typeof parsed === 'object' ? (parsed as { result?: unknown }) : undefined
        const norm = normalizeNativeBundleCandidate(parsedObj?.result ?? parsed)
        if (norm) return norm
      } catch { /* ignore */ }
    }
  }
  const matches = Array.from(
    collectInteractionTextCandidates(interaction).matchAll(/<NATIVE_CONTENT_BUNDLE>([\s\S]*?)<\/NATIVE_CONTENT_BUNDLE>/g)
  )
  if (matches.length > 0) {
    try {
      const parsed = JSON.parse(matches[matches.length - 1][1].trim())
      return normalizeNativeBundleCandidate(parsed, true) || (parsed as NativeContentBundle)
    } catch { /* ignore */ }
  }
  return null
}

const KNOWN_LOOKER_SDK_CALL_RE =
  /\b(?:sdk\.([a-z_][a-z0-9_]*)|(run_inline_query|run_key_driver_analysis|to_fixed_date_range|lookml_model_explore|lookml_model|all_lookml_models|search_content|search_dashboards|search_looks|create_dashboard|update_dashboard|dashboard_dashboard_layouts|update_dashboard_layout_component|create_dashboard_element|update_dashboard_element|create_dashboard_filter|update_dashboard_filter|create_query|create_look|create_board|update_board|create_board_section|create_board_item|create_scheduled_plan|upsert_udd|upsert_lookml_dashboard|reflow_24col|pin_to_board|schedule_dashboard|emit_native_bundle|validate_project|run_lookml_test|create_sql_query|run_sql_query|all_project_files|get_file_content|create_file|update_file|delete_file|create_project_directory|update_session|git_branch|import_lookml_dashboard|sync_lookml_dashboard|me|user_roles|all_folders))\s*\(/gi

const CODEMODE_MACROS = new Set([
  'upsert_udd', 'upsert_lookml_dashboard', 'reflow_24col', 'pin_to_board',
  'schedule_dashboard', 'emit_native_bundle', 'to_fixed_date_range',
])

function extractLookerSdkMethodPreview(code: string): string {
  const seen = new Set<string>()
  for (const m of String(code || '').matchAll(KNOWN_LOOKER_SDK_CALL_RE)) {
    const name = m[1] || m[2]
    if (name) seen.add(m[1] || !CODEMODE_MACROS.has(name) ? `sdk.${name}` : name)
  }
  return Array.from(seen).join(', ')
}

export function parseStepArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return {} }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

export function extractThoughtText(val: unknown): string {
  if (typeof val === 'string') return val.trim()
  if (Array.isArray(val)) return val.map(extractThoughtText).filter(Boolean).join('\n\n')
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>
    for (const key of ['text', 'summary', 'content', 'parts']) {
      const extracted = extractThoughtText(obj[key])
      if (extracted) return extracted
    }
  }
  return ''
}

const stripThoughtHeading = (line: string): string =>
  line.trim().replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*:?\s*$|^\*\*|\*\*$/g, '$1').trim()

export function extractSkillNameFromPath(rawPath?: string): string | null {
  const raw = String(rawPath || '').trim()
  if (!raw) return null
  if (/(?:^|\/)DATA_APP_GUIDE\.md$/i.test(raw)) return 'data-apps'
  if (/(?:^|\/)DATA_INVESTIGATOR_GUIDE\.md$/i.test(raw)) return 'data-investigator'
  const match = raw.match(/(?:^|\/)skills\/([^/\s]+)(?:\/SKILL\.md)?$/i)
  return match?.[1] ? match[1].toLowerCase() : null
}

export const BUILTIN_SKILLS_FILES: Record<string, string> = {
  '/workspace/skills/data-apps/SKILL.md': DATA_APP_GUIDE_MD, 'skills/data-apps/SKILL.md': DATA_APP_GUIDE_MD,
  '/workspace/skills/data-apps/skill.md': DATA_APP_GUIDE_MD, 'skills/data-apps/skill.md': DATA_APP_GUIDE_MD,
  'data-apps': DATA_APP_GUIDE_MD, 'data-app-creator': DATA_APP_GUIDE_MD,
  '/workspace/skills/data-investigator/SKILL.md': DATA_INVESTIGATOR_GUIDE_MD, 'skills/data-investigator/SKILL.md': DATA_INVESTIGATOR_GUIDE_MD,
  '/workspace/skills/data-investigator/skill.md': DATA_INVESTIGATOR_GUIDE_MD, 'skills/data-investigator/skill.md': DATA_INVESTIGATOR_GUIDE_MD,
  'data-investigator': DATA_INVESTIGATOR_GUIDE_MD,
  '/workspace/skills/key-driver-analysis/SKILL.md': KDA_SKILL_MD, 'skills/key-driver-analysis/SKILL.md': KDA_SKILL_MD,
  '/workspace/skills/key-driver-analysis/skill.md': KDA_SKILL_MD, 'skills/key-driver-analysis/skill.md': KDA_SKILL_MD,
  'key-driver-analysis': KDA_SKILL_MD,
  '/workspace/skills/key-driver-analysis/scripts/kda_toolkit.py': KDA_TOOLKIT_PY, 'skills/key-driver-analysis/scripts/kda_toolkit.py': KDA_TOOLKIT_PY, 'kda_toolkit.py': KDA_TOOLKIT_PY,
  '/workspace/skills/looker-project-onboarding/SKILL.md': LOOKER_PROJECT_ONBOARDING_SKILL_MD, 'skills/looker-project-onboarding/SKILL.md': LOOKER_PROJECT_ONBOARDING_SKILL_MD,
  '/workspace/skills/looker-project-onboarding/skill.md': LOOKER_PROJECT_ONBOARDING_SKILL_MD, 'skills/looker-project-onboarding/skill.md': LOOKER_PROJECT_ONBOARDING_SKILL_MD,
  'looker-project-onboarding': LOOKER_PROJECT_ONBOARDING_SKILL_MD,
  'lookml-field-curation': '# LookML Field Curation & Descriptions Skill\nCurate business-ready `label`, `description`, `group_label`, `value_format_name`, and `drill_fields` across LookML views and refinements.',
  'lookml-tests': '# LookML Data Tests (.test.lkml) Skill\nAuthor `test:` blocks with `explore_source` and `assert:` expressions and validate via `run_lookml_test`.',
  'lookml-snapshot': '# LookML SQL & Explore Parity Snapshot Skill\nVerify 100% row/value parity between raw SQL (`run_sql_query`) and LookML Explore (`run_inline_query`).',
  'lookml-bronze-view': '# LookML Bronze View & Refinement Skill\nGenerate base `.view.lkml` and layered `.refinement.lkml` files with `primary_key: yes` and symmetric aggregate safety.',
}

export const SANDBOX_WORKSPACE_SKILL_FILES = BUILTIN_SKILLS_FILES

export const BUILTIN_WORKSPACE_FILES: Record<string, string> = {
  '/workspace/AGENTS.md': AGENTS_MD, 'AGENTS.md': AGENTS_MD,
  '/workspace/DATA_APP_GUIDE.md': DATA_APP_GUIDE_MD, 'DATA_APP_GUIDE.md': DATA_APP_GUIDE_MD,
  '/workspace/DATA_INVESTIGATOR_GUIDE.md': DATA_INVESTIGATOR_GUIDE_MD, 'DATA_INVESTIGATOR_GUIDE.md': DATA_INVESTIGATOR_GUIDE_MD,
  '/workspace/bundle_app.py': BUNDLE_APP_PY, 'bundle_app.py': BUNDLE_APP_PY,
  '/workspace/bootstrap_lookml.py': BOOTSTRAP_LOOKML_PY, 'bootstrap_lookml.py': BOOTSTRAP_LOOKML_PY,
  '/workspace/sitecustomize.py': LKR_CLI_SITECUSTOMIZE_PY, 'sitecustomize.py': LKR_CLI_SITECUSTOMIZE_PY,
  ...BUILTIN_SKILLS_FILES,
}

export function resolveBuiltinWorkspaceFileContent(pathOrName?: string): string | undefined {
  const raw = String(pathOrName || '').trim()
  if (!raw) return undefined
  if (BUILTIN_WORKSPACE_FILES[raw]) return BUILTIN_WORKSPACE_FILES[raw]
  if (BUILTIN_WORKSPACE_FILES[raw.toLowerCase()]) return BUILTIN_WORKSPACE_FILES[raw.toLowerCase()]
  const skill = extractSkillNameFromPath(raw)
  return (skill && BUILTIN_SKILLS_FILES[skill]) || BUILTIN_WORKSPACE_FILES[raw.split('/').filter(Boolean).pop() || raw]
}

const IGNORED_TARGET_TOKENS = new Set([
  'json', 'csv', 'txt', 'md', 'html', 'sql', 'true', 'false', 'none', 'null', 'undefined',
  'dev', 'production', 'sdk', 'vars', 'args', 'params', 'body', 'result', 'res', 'data',
  'get', 'post', 'put', 'patch', 'delete', 'ok', 'id', '1', '0',
])

function humanizeLookerTargetLabel(raw: unknown): string | undefined {
  let str = String(raw ?? '').trim().replace(/^['"`]+|['"`]+$/g, '').trim()
  if (!str) return undefined
  if (str.startsWith('/') || str.includes('/api/')) {
    const exp = str.match(/\/lookml_models\/[^/]+\/explores\/([^/?#]+)/i)?.[1]
    const dash = str.match(/\/dashboards\/([^/?#]+)/i)?.[1]
    const fold = str.match(/\/folders\/([^/?#]+)/i)?.[1]
    const mod = str.match(/\/(?:lookml_models|projects)\/([^/?#]+)/i)?.[1]
    if (exp) str = exp
    else if (dash) return /^\d+$/.test(dash) ? `Dashboard #${dash}` : humanizeLookerTargetLabel(dash)
    else if (fold) return /^\d+$/.test(fold) ? `Folder #${fold}` : humanizeLookerTargetLabel(fold)
    else if (mod) str = mod
    else return undefined
  }
  if (str.includes('::')) str = str.split('::').map((p) => p.trim()).filter(Boolean).pop() || str
  str = str.replace(/\.(?:dashboard\.lookml|view\.lkml|model\.lkml|explore\.lkml|lkml|lookml)$/i, '').trim()
  if (!str || /^\d+$/.test(str) || IGNORED_TARGET_TOKENS.has(str.toLowerCase())) return undefined
  if (/\s/.test(str) && /[A-Z]/.test(str)) return str
  return str.split(/[_-\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

const LOOKER_QUERY_EXEC_RE = /\b(?:run_inline_query|run_query|run_sql_query|create_query|create_sql_query|query_for_slug|run_key_driver_analysis)\b/i

export function formatFriendlyLookerActivityLabel(
  code: string, args?: Record<string, unknown>
): { statusText: string; stepTitle: string; targetLabel?: string; isQuery: boolean } {
  const codeStr = String(code || '')
  const vars = args?.vars && typeof args.vars === 'object' && !Array.isArray(args.vars) ? (args.vars as Record<string, unknown>) : undefined
  const activeContent = vars?.active_content && typeof vars.active_content === 'object' && !Array.isArray(vars.active_content) ? (vars.active_content as Record<string, unknown>) : undefined
  const rawCandidates: unknown[] = [
    codeStr.match(/lookml_model_explore\s*\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]/i)?.[1],
    codeStr.match(/['"](?:view|explore|explore_name)['"]\s*:\s*['"]([^'"]+)['"]/i)?.[1],
    codeStr.match(/\b(?:view|explore|explore_name)\s*=\s*['"]([^'"]+)['"]/i)?.[1],
    codeStr.match(/\b[a-z][a-z0-9_]*::([a-z][a-z0-9_]*)\b/i)?.[1],
    codeStr.match(/(?:upsert_udd|create_dashboard|update_dashboard|upsert_lookml_dashboard)\s*\(\s*['"]([^'"]+)['"]/i)?.[1],
    codeStr.match(/['"](?:title|dashboard_title|folder_name|name)['"]\s*:\s*['"]([^'"]+)['"]/i)?.[1],
    codeStr.match(/['"]([a-z][a-z0-9_]*)\.[a-z][a-z0-9_]*['"]/i)?.[1],
    codeStr.match(/lookml_model\s*\(\s*['"]([^'"]+)['"]/i)?.[1],
    codeStr.match(/['"]model['"]\s*:\s*['"]([^'"]+)['"]/i)?.[1],
    codeStr.match(/\bmodel\s*=\s*['"]([^'"]+)['"]/i)?.[1],
    args?.explore, args?.view, args?.target_explore, vars?.target_explore, vars?.explore, vars?.view,
    Array.isArray(args?.target_explores) ? args?.target_explores[0] : undefined,
    Array.isArray(vars?.target_explores) ? vars?.target_explores[0] : undefined,
    Array.isArray(args?.explores) ? args?.explores[0] : undefined,
    Array.isArray(vars?.explores) ? vars?.explores[0] : undefined,
    args?.title, args?.dashboard_title, args?.folder_name, activeContent?.title,
    args?.path, args?.model, args?.target_model, vars?.target_model, vars?.model,
  ]
  let targetLabel: string | undefined
  for (const cand of rawCandidates) {
    targetLabel = humanizeLookerTargetLabel(cand)
    if (targetLabel) break
  }
  const isQuery = LOOKER_QUERY_EXEC_RE.test(codeStr) || /\/(?:queries|sql_queries)\b|run_inline_query|run_query|run_sql_query/i.test(String(args?.path || ''))
  const statusText = isQuery
    ? (targetLabel ? `Executing Looker queries for ${targetLabel}...` : 'Executing Looker queries...')
    : (targetLabel ? `Executing Looker API calls for ${targetLabel}...` : 'Executing Looker API calls...')
  return { statusText, stepTitle: statusText, ...(targetLabel ? { targetLabel } : {}), isQuery }
}

const RESULT_STEP_TYPE_RE = /^(?:function_result|tool_result|view_file_result|edit_file_result|read_file_result|write_file_result|skill_lookup_result|lookup_skill_result|code_execution_result)$/
const FILE_TOOL_FN_RE = /^(?:view_file|edit_file|read_file|write_file|open_file|cat_file)(?:_call)?$/i
const SKILL_TOOL_FN_RE = /^(?:skill_lookup|lookup_skill)(?:_call)?$/i
export const INTERNAL_JARGON_THOUGHT_RE = /\b(?:LkrCodeMode|Monty|WASM|lkr-dev-cli|Looker Code Mode|Looker CLI Bridge)\b/i
const FILE_PATH_KEYS = ['path', 'file_path', 'filename', 'file', 'filepath', 'uri', 'target', 'Path', 'FilePath', 'TargetFile', 'AbsolutePath', 'name', 'query', 'input'] as const
const SKILL_NAME_KEYS = ['skill', 'skill_name', 'name', 'target', 'path', 'file_path', 'filename', 'file', 'filepath', 'uri', 'Path', 'FilePath', 'TargetFile', 'query', 'input'] as const

function pickFirstStringField(sources: Array<Record<string, unknown> | undefined>, keys: readonly string[], ignoreRe?: RegExp): string {
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue
    for (const k of keys) {
      const trimmed = typeof src[k] === 'string' ? String(src[k]).trim() : ''
      if (trimmed && !trimmed.startsWith('{') && (!ignoreRe || !ignoreRe.test(trimmed))) return trimmed
    }
  }
  return ''
}

function extractStepContentFromSources(sources: Array<Record<string, unknown> | undefined>, fallbackPathOrSkill?: string): string | undefined {
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue
    for (const key of ['content', 'new_content', 'file_content', 'markdown', 'output', 'result', 'text', 'stdout']) {
      const trimmed = typeof src[key] === 'string' ? String(src[key]).trim() : ''
      if (!trimmed) continue
      if (trimmed.startsWith('{')) {
        const parsed = parseStepArguments(trimmed)
        for (const ik of ['content', 'text', 'output', 'result', 'markdown', 'file_content']) {
          if (typeof parsed[ik] === 'string' && String(parsed[ik]).trim()) return String(parsed[ik]).trim()
        }
      }
      return trimmed
    }
  }
  return resolveBuiltinWorkspaceFileContent(fallbackPathOrSkill)
}

const WRITTEN_MD_RES = [
  /(?:^|[^0-9&])>>?\s*['"]?([^\s;|&'"<>]+\.md)['"]?/i,
  /\btee\s+(?:-[a-zA-Z]+\s+)*['"]?([^\s;|&'"<>]+\.md)['"]?/i,
  /\bopen\(\s*['"]([^'"]+\.md)['"]\s*,\s*['"][wa][+bt]*['"]/i,
  /\bPath\(\s*['"]([^'"]+\.md)['"]\s*\)\.write_text\b/i,
]

export function extractWrittenMarkdownPathFromCode(rawCode: string): string | undefined {
  const code = String(rawCode || '').trim()
  for (const re of WRITTEN_MD_RES) {
    const matched = code.match(re)?.[1]?.trim()
    if (matched) return matched
  }
  return undefined
}

export function extractInteractionActivitySteps(interaction: AntigravityInteractionPayload | null | undefined): AntigravityActivityStep[] {
  const rawSteps: AntigravityInteractionStep[] = Array.isArray(interaction?.steps) ? interaction.steps : []
  const rawOutputs: AntigravityInteractionOutput[] = Array.isArray(interaction?.outputs) ? interaction.outputs : []
  const completedCallIds = new Set<string>()
  const resultStepByCallId = new Map<string, AntigravityInteractionStep>()
  for (const s of rawSteps) {
    if (RESULT_STEP_TYPE_RE.test(String(s?.type || '').trim())) {
      const cid = String(s?.call_id || s?.id || '').trim()
      if (cid) { completedCallIds.add(cid); resultStepByCallId.set(cid, s) }
    }
  }
  const interactionDone = /^(?:completed|failed|cancelled)$/.test(String(interaction?.status || ''))
  const byKey = new Map<string, AntigravityActivityStep>()
  const seenContent = new Set<string>()
  const seenKindTitle = new Set<string>()
  let autoIdx = 0

  const upsertStep = (step: AntigravityActivityStep, explicitId?: string) => {
    const contentKey = `${step.kind}:${step.title}:${step.detail || ''}`
    const kindTitleKey = `${step.kind}:${step.title}`
    const mapKey = explicitId || contentKey
    const existing = byKey.get(mapKey)
    if (existing) {
      if (step.status === 'done') existing.status = 'done'
      if (step.detail && !existing.detail) existing.detail = step.detail
      if (step.path && !existing.path) existing.path = step.path
      if (step.content && !existing.content) existing.content = step.content
      return
    }
    if (seenContent.has(contentKey) || (!step.detail && seenKindTitle.has(kindTitleKey))) return
    seenContent.add(contentKey); seenKindTitle.add(kindTitleKey); byKey.set(mapKey, step)
  }

  const addThought = (item: AntigravityInteractionStep | AntigravityInteractionOutput, stepId: string, explicitId: string | undefined, status: 'running' | 'done') => {
    const tObj = item.thought && typeof item.thought === 'object' && !Array.isArray(item.thought) ? (item.thought as Record<string, unknown>) : null
    const summary = extractThoughtText(tObj?.summary ?? item.summary)
    const text = extractThoughtText(tObj?.text ?? (typeof item.thought === 'string' || Array.isArray(item.thought) ? item.thought : undefined) ?? item.text ?? tObj?.content ?? item.content ?? tObj?.parts ?? item.parts)
    const raw = summary && text && summary !== text ? `${summary}\n${text}` : summary || text
    const [firstLine = '', ...restLines] = raw.split(/\r?\n/)
    const title = stripThoughtHeading(firstLine)
    if (!title) return
    const rest = restLines.join('\n').trim()
    upsertStep({ id: stepId, kind: 'thought', title, ...(rest && rest !== title ? { detail: rest } : {}), status }, explicitId)
  }

  for (let i = 0; i < rawSteps.length; i++) {
    const step = rawSteps[i]
    if (!step || typeof step !== 'object') continue
    const sType = String(step.type || '').trim()
    if (RESULT_STEP_TYPE_RE.test(sType)) continue

    const explicitId = step.id ? String(step.id).trim() : undefined
    const stepId = explicitId || `step_${++autoIdx}`
    const isLastStep = i === rawSteps.length - 1
    const fnName = String(step.name || step.function_call?.name || '').trim()
    const nextStep = rawSteps[i + 1]
    const pairedResult = (explicitId ? resultStepByCallId.get(explicitId) : undefined) ||
      (nextStep && RESULT_STEP_TYPE_RE.test(String(nextStep.type || '').trim()) && (!nextStep.call_id || !explicitId || String(nextStep.call_id).trim() === explicitId) ? nextStep : undefined)
    const pairedResultObj = pairedResult as unknown as Record<string, unknown> | undefined
    const pairedResultParsed = parseStepArguments(pairedResultObj?.result ?? pairedResultObj?.output ?? pairedResultObj?.content)

    const resolveStatus = (isFunctionCall = false): 'running' | 'done' => {
      if (step.status === 'running' || step.status === 'in_progress') return 'running'
      if (step.status === 'done' || step.status === 'completed' || interactionDone || pairedResult) return 'done'
      if (isFunctionCall && explicitId) {
        if (completedCallIds.has(explicitId)) return 'done'
        if (interaction?.status === 'requires_action' || isLastStep) return 'running'
      }
      return interaction?.status === 'in_progress' && isLastStep ? 'running' : 'done'
    }

    if (sType === 'thought' || sType === 'thinking' || (step.thought && !/^(?:function_call|run_looker_codemode|lkr_cli_extension_bridge)$/.test(sType))) {
      addThought(step, stepId, explicitId, resolveStatus(false)); continue
    }

    if (FILE_TOOL_FN_RE.test(sType) || step.view_file_call || step.edit_file_call || (sType === 'function_call' && FILE_TOOL_FN_RE.test(fnName))) {
      const nested = (step.view_file_call || step.edit_file_call || step.function_call || {}) as Record<string, unknown>
      const stepObj = step as unknown as Record<string, unknown>
      const args = { ...parseStepArguments(step.input ?? nested.input), ...parseStepArguments(step.arguments ?? step.args ?? nested.arguments ?? nested.args) }
      const targetPath = pickFirstStringField([stepObj, nested, args, pairedResultParsed, pairedResultObj], FILE_PATH_KEYS, FILE_TOOL_FN_RE)
      const desc = String(step.description || nested.description || args.description || '').trim()
      const isEdit = /edit|write/.test(`${sType}:${fnName}`)
      const skillName = !isEdit ? extractSkillNameFromPath(targetPath) : null
      const content = extractStepContentFromSources([args, pairedResultParsed, pairedResultObj, stepObj], targetPath)
      if (skillName) {
        const skillPath = targetPath || `/workspace/skills/${skillName}/SKILL.md`
        const title = desc ? `Reading skill ${skillName} — ${desc}` : `Reading skill ${skillName}`
        const detail = desc || skillPath || undefined
        upsertStep({ id: stepId, kind: 'skill', title, ...(detail ? { detail } : {}), path: skillPath, ...(content ? { content } : {}), status: resolveStatus(true) }, explicitId)
        continue
      }
      const shortName = targetPath ? targetPath.split('/').filter(Boolean).pop() || targetPath : ''
      const title = targetPath && desc ? `${targetPath} — ${desc}` : shortName ? `${isEdit ? 'Editing' : 'Viewing'} ${shortName}` : desc || (isEdit ? 'Editing file' : 'Viewing file')
      const detail = desc || targetPath || undefined
      upsertStep({ id: stepId, kind: 'file', title, ...(detail ? { detail } : {}), ...(targetPath ? { path: targetPath } : {}), ...(content ? { content } : {}), status: resolveStatus(true) }, explicitId)
      continue
    }

    if (SKILL_TOOL_FN_RE.test(sType) || step.skill_lookup_call || (sType === 'function_call' && SKILL_TOOL_FN_RE.test(fnName))) {
      const nested = (step.skill_lookup_call || step.function_call || {}) as Record<string, unknown>
      const stepObj = step as unknown as Record<string, unknown>
      const args = { ...parseStepArguments(step.input ?? nested.input), ...parseStepArguments(step.arguments ?? step.args ?? nested.arguments ?? nested.args) }
      const rawSkill = pickFirstStringField([stepObj, nested, args, pairedResultParsed, pairedResultObj], SKILL_NAME_KEYS, SKILL_TOOL_FN_RE)
      const skillName = (extractSkillNameFromPath(rawSkill) || rawSkill).toLowerCase()
      const skillPath = rawSkill.includes('/') ? rawSkill : skillName ? `/workspace/skills/${skillName}/SKILL.md` : ''
      const desc = String(step.description || nested.description || args.description || '').trim()
      const title = skillName && desc ? `Reading skill ${skillName} — ${desc}` : skillName ? `Reading skill ${skillName}` : desc || 'Skill lookup'
      const detail = desc || skillPath || skillName || undefined
      const content = extractStepContentFromSources([pairedResultParsed, pairedResultObj, args, stepObj], skillPath || rawSkill || skillName)
      upsertStep({ id: stepId, kind: 'skill', title, ...(detail ? { detail } : {}), ...(skillPath || skillName ? { path: skillPath || skillName } : {}), ...(content ? { content } : {}), status: resolveStatus(true) }, explicitId)
      continue
    }

    if (/^(?:run_looker_codemode|lkr_cli_extension_bridge)$/.test(fnName) || /^(?:run_looker_codemode|lkr_cli_extension_bridge)$/.test(sType)) {
      const isBridge = fnName === 'lkr_cli_extension_bridge' || sType === 'lkr_cli_extension_bridge'
      const args = parseStepArguments(step.arguments ?? step.args ?? step.function_call?.arguments ?? step.function_call?.args ?? step)
      const rawThought = extractThoughtText(args.thought ?? step.thought)
      const thought = INTERNAL_JARGON_THOUGHT_RE.test(rawThought) ? '' : rawThought
      const codeStr = String(args.code || step.code || '').trim()
      const sdkPreview = extractLookerSdkMethodPreview(codeStr)
      const firstCodeLine = codeStr.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || ''
      const friendly = formatFriendlyLookerActivityLabel(codeStr, args)
      if (isBridge) {
        const method = String(args.method || step.method || '').trim().toUpperCase()
        const pathStr = String(args.path || step.path || '').trim()
        const methodPath = method || pathStr ? `${method || 'GET'} ${pathStr || '/'}` : ''
        const title = thought || methodPath || friendly.stepTitle
        const detail = methodPath || sdkPreview || (codeStr ? codeStr.split('\n')[0].trim().slice(0, 140) : undefined)
        upsertStep({ id: stepId, kind: 'cli_bridge', title, ...(detail ? { detail } : {}), ...(codeStr ? { language: 'PYTHON' } : {}), status: resolveStatus(true) }, explicitId)
      } else {
        const title = thought || friendly.stepTitle
        const detail = sdkPreview || (firstCodeLine ? firstCodeLine.slice(0, 140) : undefined)
        upsertStep({ id: stepId, kind: 'codemode', title, ...(detail ? { detail } : {}), language: 'PYTHON', status: resolveStatus(true) }, explicitId)
      }
      continue
    }

    if (/^(?:code_execution|code_execution_call|executable_code)$/.test(sType) || step.code_execution || step.code_execution_call || step.executable_code || (sType === 'function_call' && /^(?:code_execution|bash|sh|python)(?:_call)?$/.test(fnName))) {
      const nested = (step.code_execution || step.code_execution_call || step.executable_code || step.function_call || {}) as Record<string, unknown>
      const stepObj = step as unknown as Record<string, unknown>
      const args = { ...parseStepArguments(step.input ?? nested.input), ...parseStepArguments(step.arguments ?? step.args ?? nested.arguments ?? nested.args) }
      const rawCode = String(step.code ?? step.command ?? nested.code ?? nested.command ?? args.code ?? args.command ?? step.input ?? '').trim()
      const rawLang = String(step.language ?? nested.language ?? args.language ?? '').trim().toUpperCase()
      const language = rawLang.includes('PYTHON') || rawLang === 'PY' || fnName === 'python' ? 'PYTHON'
        : rawLang.includes('BASH') || rawLang.includes('SH') || fnName === 'bash' ? 'BASH'
        : /^(?:import\s+\w|from\s+\w+\s+import\s+|def\s+\w)/m.test(rawCode) && !/^(?:python3?|uv|lkr|bash|sh)\b/.test(rawCode) ? 'PYTHON' : 'BASH'
      const firstLine = rawCode.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || rawCode

      if (language === 'BASH' && /^\s*(?:cat|head|tail|sed)\b/.test(firstLine) && !/[>|]|\btee\b|<<\s*['"]?\w+/.test(firstLine)) {
        const matchedPath = firstLine.match(/((?:\/workspace\/[^\s'"|;&><]+)|(?:[a-zA-Z0-9_./-]*skills\/[a-zA-Z0-9_.-]+\/SKILL\.md)|(?:[a-zA-Z0-9_./-]+\.(?:lkml|lookml|md|py|js)))\b/)?.[1]?.trim()
        if (matchedPath) {
          const skillName = extractSkillNameFromPath(matchedPath)
          const content = extractStepContentFromSources([pairedResultParsed, pairedResultObj, (step.code_execution_result || {}) as Record<string, unknown>, stepObj], matchedPath)
          const shortName = matchedPath.split('/').filter(Boolean).pop() || matchedPath
          upsertStep(
            skillName
              ? { id: stepId, kind: 'skill', title: `Reading skill ${skillName}`, detail: matchedPath, path: matchedPath, ...(content ? { content } : {}), status: resolveStatus(false) }
              : { id: stepId, kind: 'file', title: `Viewing ${shortName}`, detail: matchedPath, path: matchedPath, ...(content ? { content } : {}), status: resolveStatus(false) },
            explicitId
          )
          continue
        }
      }

      const writtenMdPath = extractWrittenMarkdownPathFromCode(rawCode)
      if (writtenMdPath) {
        const shortName = writtenMdPath.split('/').filter(Boolean).pop() || writtenMdPath
        const builtin = resolveBuiltinWorkspaceFileContent(writtenMdPath)
        upsertStep({ id: stepId, kind: 'file', title: `Editing ${shortName}`, detail: writtenMdPath, path: writtenMdPath, ...(builtin ? { content: builtin } : {}), status: resolveStatus(false) }, explicitId)
        continue
      }

      const conciseCmd = firstLine.replace(/\s*<<\s*['"]?\w+['"]?.*$/, '').trim().slice(0, 140) || (language === 'PYTHON' ? 'Running Python script' : 'Running sandbox command')
      const detail = rawCode ? rawCode.split('\n').slice(0, 3).join('\n').slice(0, 200) : undefined
      upsertStep({ id: stepId, kind: 'code_execution', title: conciseCmd, ...(detail ? { detail } : {}), language, status: resolveStatus(false) }, explicitId)
    }
  }

  for (const out of rawOutputs) {
    if (out && typeof out === 'object' && (out.type === 'thought' || out.type === 'thinking' || out.thought)) {
      const outId = out.id ? String(out.id) : undefined
      addThought(out, outId || `step_${++autoIdx}`, outId, interactionDone ? 'done' : 'running')
    }
  }
  return Array.from(byKey.values())
}

export function formatThinkingTraceMarkdown(
  steps: AntigravityActivityStep[],
  meta?: { thinkingDurationSec?: number; userPrompt?: string; assistantText?: string }
): string {
  const safeSteps = Array.isArray(steps) ? steps : []
  const stepWord = safeSteps.length === 1 ? 'step' : 'steps'
  const headerSuffix = typeof meta?.thinkingDurationSec === 'number' ? ` (${meta.thinkingDurationSec}s · ${safeSteps.length} ${stepWord})` : ` (${safeSteps.length} ${stepWord})`
  const lines: string[] = [`## Thinking & Activity Trace${headerSuffix}`]
  if (meta?.userPrompt?.trim()) lines.push('', `**User Prompt:** ${meta.userPrompt.trim()}`)
  lines.push('')
  safeSteps.forEach((step, idx) => {
    const badge = step.kind === 'thought' ? '[Thought]' : step.kind === 'file' ? '[File]' : step.kind === 'skill' ? '[Skill]' : step.kind === 'codemode' ? '[Code Mode]' : step.kind === 'cli_bridge' ? '[CLI Bridge]' : step.kind === 'code_execution' ? (step.language === 'PYTHON' ? '[Sandbox Python]' : '[Sandbox Bash]') : '[Activity]'
    lines.push(`${idx + 1}. **${badge} ${step.title}**`)
    if (step.path && step.path !== step.title && step.path !== step.detail) lines.push(`   - Path: \`${step.path}\``)
    if (step.detail && step.detail !== step.title) {
      lines.push(step.kind === 'thought' ? `   ${step.detail.replace(/\r?\n/g, '\n   ')}` : `   \`${step.detail.replace(/\r?\n/g, ' ')}\``)
    }
    if (step.content?.trim()) lines.push('   ```', `   ${step.content.trim().slice(0, 600).replace(/\r?\n/g, '\n   ')}`, '   ```')
  })
  if (meta?.assistantText?.trim()) lines.push('', '### Assistant Response', '', meta.assistantText.trim())
  return lines.join('\n').trim()
}

export function summarizeProgress(interaction: AntigravityInteractionPayload | null | undefined): string {
  const lastTitle = extractInteractionActivitySteps(interaction).pop()?.title
  if (lastTitle) return lastTitle
  const last = (interaction?.steps || []).slice(-1)[0]
  if (last?.type === 'function_call') {
    return extractThoughtText(parseStepArguments(last.arguments ?? last.args).thought) || `Running tool: ${last.name || 'sandbox command'}...`
  }
  return 'Thinking...'
}

export function extractInteractionTelemetry(
  interaction: AntigravityInteractionPayload | null | undefined,
  stats: { agentWallMs: number; pollWaitMs: number; pollCount: number; codemodeExecMs: number; lookerHttpMs: number; codemodeCalls: number; lookerHttpCalls: number; apiRetries: number }
): AntigravityTurnTelemetry {
  const steps: AntigravityInteractionStep[] = interaction?.steps || []
  const bashCalls = steps.filter((s) => s?.type === 'code_execution' || s?.type === 'executable_code' || (s?.type === 'function_call' && s?.name !== 'run_looker_codemode')).length
  const verifyRetries = steps.filter((s) => /"stage":\s*"(?:syntax|safety|widget_extraction)"/.test(String(s?.output || s?.stderr || s?.result || ''))).length
  const usage = interaction?.usage || interaction?.usage_metadata || {}
  return {
    agent_wall_ms: stats.agentWallMs,
    poll_wait_ms: stats.pollWaitMs,
    poll_count: stats.pollCount,
    codemode_exec_ms: stats.codemodeExecMs,
    looker_http_ms: stats.lookerHttpMs,
    tool_calls: { bash: bashCalls || Number(interaction?.bash_calls || 0), codemode: stats.codemodeCalls, looker_http: stats.lookerHttpCalls },
    tokens: {
      input: Number(usage.input_tokens ?? usage.prompt_token_count ?? 0),
      output: Number(usage.output_tokens ?? usage.candidates_token_count ?? 0),
      thought: Number(usage.thought_tokens ?? usage.thoughts_token_count ?? 0),
    },
    verify_retries: verifyRetries,
    api_retries: stats.apiRetries + verifyRetries,
  }
}
