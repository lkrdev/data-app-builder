import type { ExtensionSDK } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import type { CodeModePermissionDecision, CodeModePermissionRequest } from './antigravityTypes'
import { fetchLookerCaAgentsCatalog, LookerCaAgentSummary, normalizeCaAgent } from './conversationalAnalytics'
import {
  canonicalizeLookerRoute,
  classifyLookerOperation,
  cleanQueryParams,
  computeLkrExtensionCacheKey,
  type LkrExtensionToolRequest,
} from './lkrCliSitecustomize'
import {
  invokeLookerExtensionSdk,
  isLookerExtensionSdk,
  normalizeLookerApiPath,
  rawLookerRequest,
  resolveLookerExtensionSdk,
  withCodeModeApiScope,
} from './lookerTransport'
export * from './lkrCliSitecustomize'

export const CODEMODE_CDN_URL = 'https://cdn.lkr.dev/cli/codemode/0.0.69/codemode.js'

export interface LkrCodeModeToolDefinition {
  type: string
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, { type: string; description: string }>
    required: string[]
  }
}

export interface LkrCodeModeRunOptions {
  code?: string
  sdk?: unknown
  core40SDK?: unknown
  extensionSDK?: unknown
  vars?: Record<string, unknown>
  thought?: string
  conversationId?: string
  allowUpdateSession?: boolean
  allow_update_session?: boolean
  requirePermission?: boolean
  approvedOperations?: Set<string>
  onPermissionRequest?: (
    req: CodeModePermissionRequest & Record<string, unknown>
  ) => Promise<CodeModePermissionDecision | string> | CodeModePermissionDecision | string
  requestHandler?: (
    method: string,
    path: string,
    queryParams?: unknown,
    body?: unknown,
    options?: unknown
  ) => Promise<unknown> | unknown
  [key: string]: unknown
}

export interface LkrCodeModeRunFn {
  (code: string, options?: LkrCodeModeRunOptions): Promise<string>
  (params: LkrCodeModeRunOptions, options?: LkrCodeModeRunOptions): Promise<string>
}

export interface LkrCodeModeRuntime {
  RUN_LOOKER_CODEMODE_TOOL: LkrCodeModeToolDefinition
  getToolDefinition: (name?: string) => LkrCodeModeToolDefinition
  getCodeModeRuntime: () => LkrCodeModeRuntime
  classifyOperation: typeof classifyLookerOperation
  init: () => Promise<LkrCodeModeRuntime>
  connect: (options?: Record<string, unknown>) => Promise<unknown>
  setExtensionSDK: (sdk: unknown) => Promise<unknown>
  getHostData: () => Promise<unknown>
  runPythonCode: LkrCodeModeRunFn
  run_python_code: LkrCodeModeRunFn
  executeLookerCodeMode: LkrCodeModeRunFn
}

const DATE_HELPER_PREAMBLE_PY = [
  'def _dim(y, m): return 31 if m in (1,3,5,7,8,10,12) else (30 if m in (4,6,9,11) else (29 if (y%4==0 and y%100!=0) or y%400==0 else 28))',
  "def _fymd(y, m, d): return str(y) + '-' + (('0'+str(m)) if m<10 else str(m)) + '-' + (('0'+str(d)) if d<10 else str(d))",
  'def _add_d(y, m, d, n):',
  '    d += n',
  '    while d < 1: m, y = (12, y-1) if m == 1 else (m-1, y); d += _dim(y, m)',
  '    while d > _dim(y, m): d -= _dim(y, m); m, y = (1, y+1) if m == 12 else (m+1, y)',
  '    return (y, m, d)',
  'def _add_m(y, m, d, n): t = y * 12 + (m - 1) + n; ny, nm = t // 12, (t % 12) + 1; mx = _dim(ny, nm); return (ny, nm, d if d <= mx else mx)',
  'def to_fixed_date_range(expr, anchor_date=None):',
  "    raw = str(expr or '').strip()",
  "    if not raw or (' to ' in raw.lower() and len(raw) >= 20 and raw[4:5] in ('-', '/')): return ' to '.join(raw.replace('/', '-').split()[::2]) if raw else raw",
  "    ap = str(anchor_date or INVESTIGATION_ANCHOR_DATE or '2026-03-30').strip()[:10].replace('/', '-').split('-')",
  "    ay, am, ad = int(ap[0]), int(ap[1]), int(ap[2]); end_s = _fymd(ay, am, ad); low = ' '.join(raw.lower().split())",
  "    if low == 'today': return end_s + ' to ' + end_s",
  "    if low == 'yesterday': s = _fymd(*_add_d(ay, am, ad, -1)); return s + ' to ' + s",
  "    if low in ('this month', 'mtd'): return _fymd(ay, am, 1) + ' to ' + end_s",
  "    if low == 'last month': y1, m1, _ = _add_m(ay, am, 1, -1); return _fymd(y1, m1, 1) + ' to ' + _fymd(y1, m1, _dim(y1, m1))",
  "    if low in ('this quarter', 'qtd'): return _fymd(ay, ((am-1)//3)*3+1, 1) + ' to ' + end_s",
  "    if low == 'last quarter': y1, m1, _ = _add_m(ay, ((am-1)//3)*3+1, 1, -3); y2, m2, _ = _add_m(y1, m1, 1, 2); return _fymd(y1, m1, 1) + ' to ' + _fymd(y2, m2, _dim(y2, m2))",
  "    if low in ('this year', 'ytd'): return str(ay) + '-01-01 to ' + end_s",
  "    if low == 'last year': ly = str(ay - 1); return ly + '-01-01 to ' + ly + '-12-31'",
  "    if low == 'last week': return _fymd(*_add_d(ay, am, ad, -7)) + ' to ' + end_s",
  "    t = [x for x in low.split() if x not in ('last', 'past', 'previous', 'trailing')]; ago = len(t) >= 2 and t[-1] == 'ago'; t = t[:-1] if ago else t",
  '    if len(t) == 2 and t[0].isdigit():',
  "        n, u = int(t[0]), t[1]; ymd = _add_d(ay,am,ad,-n) if u.startswith('day') else (_add_d(ay,am,ad,-n*7) if u.startswith('week') else (_add_m(ay,am,ad,-n) if u.startswith('month') else (_add_m(ay,am,ad,-n*3) if u.startswith('quarter') else (_add_m(ay,am,ad,-n*12) if u.startswith('year') else None))))",
  "        if ymd: s = _fymd(*ymd); return s + ' to ' + (s if ago else end_s)",
  '    return raw',
  '',
].join('\n')

const SEARCH_AGENTS_PREAMBLE_PY = [
  'def search_agents(**kw):',
  '    cat = list(__ca_agents_catalog__ or [])',
  "    q = str(kw.get('name') or kw.get('query') or kw.get('term') or '').strip().lower()",
  "    return [a for a in cat if q in str(a.get('name', '')).lower() or q in str(a.get('description', '')).lower()] if q else cat",
  'agents_search = search_agents',
  '',
].join('\n')

const FORMAT_CONTENT_INVENTORY_PREAMBLE_PY = [
  "def format_content_inventory(entries, max_short=5, max_per_folder=2, overflow_path='/workspace/content_inventory.md'):",
  '    groups = []',
  '    by_id = {}',
  '    for raw in (entries or []):',
  '        if not isinstance(raw, dict): continue',
  "        fid = str(raw.get('id') or raw.get('folder_id') or '1').strip()",
  "        fname = str(raw.get('name') or raw.get('folder_name') or raw.get('title') or ('Folder ' + fid)).strip()",
  "        if isinstance(raw.get('dashboards'), list) or isinstance(raw.get('looks'), list) or isinstance(raw.get('items'), list):",
  '            g = by_id.get(fid)',
  '            if not g:',
  "                g = {'id': fid, 'name': fname, 'items': []}; by_id[fid] = g; groups.append(g)",
  "            for d in (raw.get('dashboards') or []):",
  "                if isinstance(d, dict) and d.get('id') is not None: g['items'].append({'id': str(d.get('id')), 'title': str(d.get('title') or d.get('name') or d.get('id')), 'type': 'dashboard'})",
  "            for l in (raw.get('looks') or []):",
  "                if isinstance(l, dict) and l.get('id') is not None: g['items'].append({'id': str(l.get('id')), 'title': str(l.get('title') or l.get('name') or l.get('id')), 'type': 'look'})",
  "            for it in (raw.get('items') or []):",
  "                if isinstance(it, dict) and it.get('id') is not None:",
  "                    tp = 'look' if 'look' in str(it.get('type') or it.get('content_type') or '').lower() else 'dashboard'",
  "                    g['items'].append({'id': str(it.get('id')), 'title': str(it.get('title') or it.get('name') or it.get('id')), 'type': tp})",
  '        else:',
  "            fobj = raw.get('folder') if isinstance(raw.get('folder'), dict) else {}",
  "            fid2 = str(raw.get('folder_id') or fobj.get('id') or '1').strip()",
  "            fname2 = str(raw.get('folder_name') or fobj.get('name') or ('Folder ' + fid2)).strip()",
  '            g = by_id.get(fid2)',
  '            if not g:',
  "                g = {'id': fid2, 'name': fname2, 'items': []}; by_id[fid2] = g; groups.append(g)",
  "            tp = 'look' if 'look' in str(raw.get('type') or raw.get('content_type') or '').lower() else 'dashboard'",
  "            iid = str(raw.get('content_id') or raw.get('id') or '').strip()",
  "            if iid: g['items'].append({'id': iid, 'title': str(raw.get('title') or raw.get('name') or iid), 'type': tp})",
  "    active = [g for g in groups if len(g['items']) > 0]",
  "    total = sum(len(g['items']) for g in active)",
  '    def _lnk(it): return "- [" + it["title"] + "](/" + ("looks" if it["type"] == "look" else "dashboards") + "/" + it["id"] + ")"',
  '    def _cnt(items):',
  '        dc = len([x for x in items if x["type"] == "dashboard"]); lc = len([x for x in items if x["type"] == "look"])',
  '        p = ([str(dc) + " dashboard" + ("" if dc == 1 else "s")] if dc else []) + ([str(lc) + " Look" + ("" if lc == 1 else "s")] if lc else [])',
  '        return ", ".join(p) if p else "0 items"',
  '    if total == 0: return {"summary_markdown": "No dashboards or Looks found.", "full_markdown": "No dashboards or Looks found.", "truncated": False, "total_items": 0, "folder_count": 0}',
  '    full_blocks = ["**[" + g["name"] + "](/folders/" + g["id"] + ")** (" + _cnt(g["items"]) + ")\\n" + "\\n".join([_lnk(x) for x in g["items"]]) for g in active]',
  '    full_md = "\\n\\n".join(full_blocks)',
  '    if total <= max_short and len(active) <= 1:',
  '        return {"summary_markdown": full_md, "full_markdown": full_md, "truncated": False, "total_items": total, "folder_count": len(active)}',
  '    sum_blocks = []',
  '    for g in active:',
  '        lines = ["**[" + g["name"] + "](/folders/" + g["id"] + ")** (" + _cnt(g["items"]) + ")"] + [_lnk(x) for x in g["items"][:max_per_folder]]',
  '        if len(g["items"]) > max_per_folder: lines.append("- See all " + str(len(g["items"])) + " items in [" + g["name"] + "](/folders/" + g["id"] + ")")',
  '        sum_blocks.append("\\n".join(lines))',
  '    sum_blocks.append("Full unfiltered inventory (" + str(total) + " items across " + str(len(active)) + " folder" + ("" if len(active) == 1 else "s") + ") saved to `" + overflow_path + "`.")',
  '    return {"summary_markdown": "\\n\\n".join(sum_blocks), "full_markdown": full_md, "overflow_file_path": overflow_path, "truncated": True, "total_items": total, "folder_count": len(active)}',
  '',
].join('\n')

function getCodeModeToolDefinition(name = 'run_looker_codemode'): LkrCodeModeToolDefinition {
  return {
    type: 'function',
    name,
    description:
      'Execute Python code in the browser Looker Code Mode WASM (Monty) sandbox with direct access to all Looker 4.0 SDK methods (e.g. `search_agents()`, `lookml_model_explore(target_model, target_explore)`, `run_inline_query("json", {...})`, `run_key_driver_analysis({...})`, `format_content_inventory(folders)`, `to_fixed_date_range("last 30 days")`, `INVESTIGATION_ANCHOR_DATE`, `me()`, `search_folders()`, `folder_children()`, `search_dashboards()`, `search_looks()`, `help("*query*")`, `lookup("run_inline_query")`, `lookup_type("WriteQuery")`). Variables passed in `vars` (such as `target_model`, `target_explore`, `target_folder_id`, and `INVESTIGATION_ANCHOR_DATE`) are pre-injected. Return a compact dict/list instead of raw multi-MB responses.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python snippet to execute in Monty sandbox. Use `return ...` to return the result (dicts/lists/strings). All Looker 4.0 SDK methods are pre-bound as bare top-level functions (e.g. `all_connections()`, `connection_schemas(name)`, `run_inline_query(...)`) — do NOT use `sdk.<method>(...)`.' },
        vars: { type: 'object', description: 'Optional dictionary of top-level variables to inject into the Monty Python sandbox (e.g. project_id, ts_utc, raw_sql, inline_queries_json, test_queries_json, file_ids, test_names, commit_message).' },
        thought: { type: 'string', description: 'Required concise 1-sentence summary of what this Code Mode snippet is doing with the Looker API calls (e.g. "Querying monthly revenue and category share from the target explore" or "Creating executive KPI dashboard with 4 tiles").' },
      },
      required: ['code', 'thought'],
    },
  }
}

let codeModeLoadPromise: Promise<LkrCodeModeRuntime> | null = null

export async function ensureCodeModeLoaded(): Promise<LkrCodeModeRuntime> {
  const g = globalThis as unknown as { LkrCodeMode?: LkrCodeModeRuntime; window?: Record<string, unknown> }
  if (g.window && typeof performance !== 'undefined' && !g.window.performance) g.window.performance = performance
  if (g.window && typeof queueMicrotask === 'function' && !g.window.queueMicrotask) g.window.queueMicrotask = queueMicrotask
  const attach = (rt: LkrCodeModeRuntime) => ((rt.classifyOperation = classifyLookerOperation), (g.LkrCodeMode = rt))
  if (g.LkrCodeMode && g.LkrCodeMode !== LkrCodeMode) return attach(g.LkrCodeMode)
  if (
    typeof document === 'undefined' &&
    (typeof window === 'undefined' || (typeof process !== 'undefined' && Boolean(process.versions?.node)))
  ) {
    return attach((eval('require') as (id: string) => LkrCodeModeRuntime)('./vendor/codemode.js'))
  }
  if (!codeModeLoadPromise) {
    codeModeLoadPromise = new Promise<LkrCodeModeRuntime>((resolve, reject) => {
      if (typeof document === 'undefined' || !document.head) {
        codeModeLoadPromise = null
        return reject(new Error('LkrCodeMode cannot be loaded: document.head is unavailable'))
      }
      const script = document.createElement('script')
      script.src = CODEMODE_CDN_URL
      script.async = true
      script.onload = () =>
        g.LkrCodeMode && g.LkrCodeMode !== LkrCodeMode
          ? resolve(attach(g.LkrCodeMode))
          : ((codeModeLoadPromise = null), reject(new Error('codemode.js loaded from CDN without globalThis.LkrCodeMode')))
      script.onerror = () => ((codeModeLoadPromise = null), reject(new Error(`Failed to load ${CODEMODE_CDN_URL}`)))
      document.head.appendChild(script)
    })
  }
  return codeModeLoadPromise
}

// ponytail: Monty WASM serializes rejected JS Promises via JSON.stringify, which turns bare Error instances into "{}";
// attaching toJSON preserves exact error text in both Monty WASM tracebacks and JS/Jest Error assertions.
const toHandlerError = (err: unknown): Error => {
  const m = err instanceof Error ? err.message : String(err)
  return Object.assign(new Error(m), { toJSON: () => m })
}

function resolveLookerBaseHandler(opts: LkrCodeModeRunOptions, rawArg?: unknown): LkrCodeModeRunOptions['requestHandler'] {
  if (typeof opts.requestHandler === 'function') return opts.requestHandler
  const rawSdk = (opts.sdk || opts.core40SDK) as Looker40SDK | undefined
  const rawReq = (rawSdk as { authSession?: { transport?: { rawRequest?: unknown } } } | undefined)?.authSession?.transport?.rawRequest
  if (typeof rawReq === 'function' && rawSdk) {
    return (m: string, p: string, q?: unknown, b?: unknown) =>
      rawLookerRequest(
        rawSdk,
        String(m || 'GET').toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
        p,
        (q as Record<string, unknown> | undefined) || undefined,
        b
      )
  }
  const extSdk = resolveLookerExtensionSdk(rawSdk, opts.extensionSDK, (opts as { extensionSdk?: unknown }).extensionSdk, rawArg)
  return extSdk ? (m, p, q, b, o) => invokeLookerExtensionSdk(extSdk, m, p, q, b, o) : undefined
}

function createGatedLookerHandler(
  baseHandler: LkrCodeModeRunOptions['requestHandler'],
  opts: Pick<LkrCodeModeRunOptions, 'requirePermission' | 'approvedOperations' | 'onPermissionRequest' | 'thought'>,
  codeFallback?: string
): LkrCodeModeRunOptions['requestHandler'] {
  const shouldRequirePermission =
    opts.requirePermission !== undefined ? Boolean(opts.requirePermission) : typeof opts.onPermissionRequest === 'function'
  if (!baseHandler && !shouldRequirePermission) return undefined
  const approvedOps = opts.approvedOperations instanceof Set ? opts.approvedOperations : new Set<string>(opts.approvedOperations || [])
  let permChain: Promise<void> = Promise.resolve()
  const execBase = (m: string, p: string, q?: unknown, b?: unknown, o?: unknown) =>
    baseHandler
      ? Promise.resolve().then(() => baseHandler(m, p, q, b, o)).then(undefined, (err: unknown) => Promise.reject(toHandlerError(err)))
      : Promise.reject(toHandlerError(`Looker SDK transport is not configured for ${m} ${p}`))
  return (m: string, p: string, q?: unknown, b?: unknown, o?: unknown) => {
    const verb = String(m || 'GET').toUpperCase()
    const rawTrim = String(p || '').trim()
    const canon = canonicalizeLookerRoute(rawTrim)
    const noHash = rawTrim.split('#')[0]
    const qIdx = noHash.indexOf('?')
    const forwardPath =
      canon.hasTraversal || /^(?:https?:)?\/\//i.test(rawTrim) || rawTrim.includes('#')
        ? canon.path + (qIdx >= 0 ? noHash.slice(qIdx) : '')
        : p
    const info = classifyLookerOperation(verb, p, codeFallback)
    const isApproved = () => approvedOps.has('*') || approvedOps.has(info.operation)
    if (!shouldRequirePermission || !info.requiresPermission || isApproved()) return execBase(m, forwardPath, q, b, o)
    const denyMsg = `PermissionError: Operation '${info.operation}' (${verb} ${p}) mutates Looker state and was not approved.`
    const gated = permChain.then(() => {
      if (isApproved()) return
      if (typeof opts.onPermissionRequest !== 'function') return Promise.reject(toHandlerError(denyMsg))
      const thought = typeof opts.thought === 'string' && opts.thought.trim() ? opts.thought.trim() : undefined
      return Promise.resolve(
        opts.onPermissionRequest(
          Object.assign({ operation: info.operation, httpMethod: verb, path: p, args: { params: q, body: b } }, thought ? { thought } : null)
        )
      ).then((decision) => {
        if (decision === 'allow_op') approvedOps.add(info.operation)
        else if (decision === 'allow_all') approvedOps.add('*')
        else if (decision !== 'allow_once' && (decision as unknown) !== true) return Promise.reject(toHandlerError(denyMsg))
      })
    })
    permChain = gated.then(() => {}, () => {})
    return gated.then(() => execBase(m, forwardPath, q, b, o))
  }
}

const runCodeModeInner: LkrCodeModeRunFn = async (
  codeOrParams: LkrCodeModeRunOptions | string,
  options?: LkrCodeModeRunOptions
): Promise<string> => {
  const runtime = await ensureCodeModeLoaded()
  const isObj = Boolean(codeOrParams && typeof codeOrParams === 'object')
  const baseOpts: LkrCodeModeRunOptions = isObj
    ? Object.assign({}, codeOrParams as LkrCodeModeRunOptions)
    : isLookerExtensionSdk(options) && !('code' in (options as object)) && !('requirePermission' in (options as object))
    ? { extensionSDK: options }
    : Object.assign({}, options || null, isLookerExtensionSdk(options) && !(options as LkrCodeModeRunOptions)?.extensionSDK ? { extensionSDK: options } : null)
  const rawInputCode = String(isObj ? baseOpts.code || '' : codeOrParams || '')
  const rawCode = /\bsdk\s*=/.test(rawInputCode)
    ? rawInputCode
    : rawInputCode.replace(/\bsdk\.([a-z_][a-z0-9_]*)\s*\(/g, '$1(')
  const rawSdk = (baseOpts.sdk || baseOpts.core40SDK) as Looker40SDK | undefined
  const baseHandler = resolveLookerBaseHandler(baseOpts, isObj ? codeOrParams : options)
  const gatedRequestHandler = createGatedLookerHandler(baseHandler, baseOpts, rawCode)

  let caAgentsCatalog: LookerCaAgentSummary[] | undefined
  const usesSearchAgents = /\b(search_agents|agents_search)\b/.test(rawCode) && !/\bdef\s+search_agents\b/.test(rawCode)
  if (usesSearchAgents) {
    if (Array.isArray(baseOpts.vars?.__ca_agents_catalog__)) {
      caAgentsCatalog = baseOpts.vars.__ca_agents_catalog__ as LookerCaAgentSummary[]
    } else if (rawSdk) {
      caAgentsCatalog = await fetchLookerCaAgentsCatalog(rawSdk, [], { allowEmpty: true })
    } else if (typeof gatedRequestHandler === 'function') {
      try {
        const res = await gatedRequestHandler('GET', '/agents/search', undefined, undefined, undefined)
        caAgentsCatalog = Array.isArray(res) ? res.map(normalizeCaAgent).filter((a): a is LookerCaAgentSummary => Boolean(a)) : []
      } catch {
        caAgentsCatalog = []
      }
    } else {
      caAgentsCatalog = []
    }
  }

  const pyKeywords = new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
    'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
    'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  ])
  const safeBaseVars = baseOpts.vars
    ? Object.fromEntries(Object.entries(baseOpts.vars).filter(([k]) => !pyKeywords.has(k)))
    : null
  const mergedVars: Record<string, unknown> = Object.assign(
    { INVESTIGATION_ANCHOR_DATE: new Date().toISOString().slice(0, 10) },
    usesSearchAgents ? { __ca_agents_catalog__: caAgentsCatalog } : null,
    safeBaseVars
  )

  let code = rawCode
  if (/\b(?:globals|locals)\s*\(/.test(rawCode) && !/\bdef\s+(?:globals|locals)\b/.test(rawCode)) {
    const pairs = Object.keys(mergedVars)
      .filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !pyKeywords.has(k))
      .map((k) => `${JSON.stringify(k)}: ${k}`)
      .join(', ')
    code = `def globals(): return {${pairs}}\nlocals = globals\n` + code
  }
  if (/\bto_fixed_date_range\b/.test(rawCode) && !/\bdef\s+to_fixed_date_range\b/.test(rawCode)) {
    code = DATE_HELPER_PREAMBLE_PY + code
  }
  if (/\bformat_content_inventory\b/.test(rawCode) && !/\bdef\s+format_content_inventory\b/.test(rawCode)) {
    code = FORMAT_CONTENT_INVENTORY_PREAMBLE_PY + code
  }
  if (usesSearchAgents) {
    code = SEARCH_AGENTS_PREAMBLE_PY + code
  }
  if (
    Boolean(baseOpts.allowUpdateSession || baseOpts.allow_update_session) &&
    /\b(?:create_project|reset_project_to_production|create_git_branch)\b/.test(rawCode) &&
    !/\b_orig_create_project_fn\b/.test(rawCode)
  ) {
    code = [
      'try: update_session({"workspace_id": "dev"})',
      'except Exception: pass',
      '_orig_create_project_fn = create_project',
      'def create_project(body=None, *a, **kw):',
      '    p = _orig_create_project_fn(body, *a, **kw) if body is not None else _orig_create_project_fn(*a, **kw)',
      '    pid = str((p or {}).get("id") or (body or {}).get("name") or "").strip() if isinstance(p, dict) or isinstance(body, dict) else ""',
      '    if pid and isinstance(p, dict) and not p.get("uses_git") and p.get("git_service_name") != "bare":',
      '        try: p = update_project(pid, {"git_service_name": "bare"})',
      '        except Exception: pass',
      '        try: create_developer_copy(pid)',
      '        except Exception: pass',
      '    return p',
      ...( /\bgenerate_lookml_with_new_files\b/.test(rawCode)
        ? [
            '_orig_gen_lookml_fn = generate_lookml_with_new_files',
            'def generate_lookml_with_new_files(*a, **kw):',
            '    try: return _orig_gen_lookml_fn(*a, **kw)',
            '    except Exception:',
            '        pid = str(kw.get("project_id") or (a[0] if a else "")).strip()',
            '        try: return {"new_files": all_project_files(pid)} if pid else {"new_files": []}',
            '        except Exception: return {"new_files": []}',
          ]
        : []),
      ...( /\breset_project_to_production\b/.test(rawCode) && /\bcreate_git_branch\b/.test(rawCode)
        ? [
            '_orig_project_fn = project',
            'def project(project_id="", *a, **kw):',
            '    pid = str(project_id or (a[0] if a else "")).strip()',
            '    try:',
            '        p = _orig_project_fn(pid, *a[1:], **kw) if a else _orig_project_fn(project_id=pid, **kw)',
            '    except Exception:',
            '        p = create_project({"name": pid})',
            '    if isinstance(p, dict) and not p.get("uses_git") and p.get("git_service_name") != "bare":',
            '        try: p = update_project(pid, {"git_service_name": "bare"})',
            '        except Exception: pass',
            '    return p',
            '_orig_reset_prod_fn = reset_project_to_production',
            'def reset_project_to_production(*a, **kw):',
            '    try: return _orig_reset_prod_fn(*a, **kw)',
            '    except Exception: return ""',
            '_orig_create_dev_fn = create_developer_copy',
            'def create_developer_copy(*a, **kw):',
            '    try: return _orig_create_dev_fn(*a, **kw)',
            '    except Exception: return ""',
          ]
        : []),
      code,
    ].join('\n')
  }

  const nextOpts: LkrCodeModeRunOptions = Object.assign({}, baseOpts, gatedRequestHandler ? { requestHandler: gatedRequestHandler } : null, {
    requirePermission: false,
    code,
    vars: mergedVars,
  })
  return isObj ? runtime.runPythonCode(nextOpts) : runtime.runPythonCode(code, nextOpts)
}

const runCodeMode: LkrCodeModeRunFn = (c, o) =>
  withCodeModeApiScope(() => runCodeModeInner(c, o), String((typeof c === 'object' ? c?.conversationId : o?.conversationId) || '').trim() || undefined)

export const LkrCodeMode: LkrCodeModeRuntime = {
  RUN_LOOKER_CODEMODE_TOOL: getCodeModeToolDefinition('run_looker_codemode'),
  getToolDefinition: getCodeModeToolDefinition,
  getCodeModeRuntime: () => LkrCodeMode,
  classifyOperation: classifyLookerOperation,
  init: async () => ensureCodeModeLoaded(),
  connect: async (options?: Record<string, unknown>) => (await ensureCodeModeLoaded()).connect(options),
  setExtensionSDK: async (sdk: unknown) => {
    ;(globalThis as Record<string, unknown>).__LKR_EXTENSION_SDK__ = sdk
    return (await ensureCodeModeLoaded()).setExtensionSDK(sdk)
  },
  getHostData: async () => (await ensureCodeModeLoaded()).getHostData(),
  runPythonCode: runCodeMode,
  run_python_code: ((a: LkrCodeModeRunOptions | string, b?: LkrCodeModeRunOptions) =>
    LkrCodeMode.runPythonCode(a as string, b)) as LkrCodeModeRunFn,
  executeLookerCodeMode: ((a: LkrCodeModeRunOptions | string, b?: LkrCodeModeRunOptions) =>
    LkrCodeMode.runPythonCode(a as string, b)) as LkrCodeModeRunFn,
}

export const LKR_DEV_CLI_VERSION = '0.0.69'
export const LKR_DEV_CLI_SPEC = `lkr-dev-cli[tools,code-mode,parse]==${LKR_DEV_CLI_VERSION}`
export const BOOTSTRAP_SANDBOX_SH = `[ -x /workspace/.uv_tools/lkr-dev-cli/bin/lkr ] && [ ! -x /usr/local/bin/lkr ] && ln -sf /workspace/.uv_tools/lkr-dev-cli/bin/lkr /usr/local/bin/lkr; lkr --version 2>/dev/null | grep -q "${LKR_DEV_CLI_VERSION}" || { (command -v uv >/dev/null 2>&1 || pip install --break-system-packages --quiet uv || python3 -m pip install --break-system-packages --quiet uv); UV_PYTHON_INSTALL_DIR=/workspace/.uv_python UV_TOOL_DIR=/workspace/.uv_tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "${LKR_DEV_CLI_SPEC}"; }; for sp in /workspace/.uv_tools/lkr-dev-cli/lib/python3.*/site-packages ~/.local/share/uv/tools/lkr-dev-cli/lib/python3.*/site-packages /usr/local/lib/python3.*/dist-packages /usr/lib/python3/dist-packages; do [ -d "$sp" ] && [ -w "$sp" ] && [ -f /workspace/sitecustomize.py ] && cp -f /workspace/sitecustomize.py "$sp/sitecustomize.py"; done; true`

export const BOOTSTRAP_LOOKML_PY = `#!/usr/bin/env python3
"""Sandbox helper for Agentic LookML:
1. Bootstraps uv (via pip install --break-system-packages --quiet uv) + lkr-dev-cli[tools,code-mode,parse]==${LKR_DEV_CLI_VERSION} (via UV_TOOL_DIR=/workspace/.uv_tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install), re-symlinks /workspace/.uv_tools/lkr-dev-cli/bin/lkr -> /usr/local/bin/lkr after hibernation, installs sitecustomize.py into /workspace/.uv_tools/lkr-dev-cli/lib/python3.*/site-packages/, and unpacks lkrdev/cli/skills/ into /workspace.
2. Computes unified diffs between /workspace/lookml_baseline and /workspace/data/$RUN_ID/lookml (or /workspace/lookml).
3. Emits <LOOKML_BUNDLE>{...}</LOOKML_BUNDLE> for the host Looker extension.
"""
import difflib
import json
import os
import shutil
import site
import subprocess
import sys
import sysconfig
import time
from pathlib import Path

WORKSPACE_DIR = Path(os.environ.get("WORKSPACE_DIR", "/workspace"))
SKILLS_ROOT = WORKSPACE_DIR / ".agents/skills"
SKILLS_ALIAS = WORKSPACE_DIR / "skills"
LOOKML_DIR = Path(os.environ.get("LOOKML_DIR", str(WORKSPACE_DIR / "lookml")))
BASELINE_DIR = Path(os.environ.get("LOOKML_BASELINE_DIR", str(WORKSPACE_DIR / "lookml_baseline")))
CACHE_DIR = WORKSPACE_DIR / ".lkr_extension_cache"
_PINNED_CLI_VERSION = "${LKR_DEV_CLI_VERSION}"
LKR_DEV_CLI_VERSION = os.environ.get("LKR_DEV_CLI_VERSION", "0.0.69" if _PINNED_CLI_VERSION.startswith("$") else _PINNED_CLI_VERSION)
REQUIRED_SKILLS = ("agentic-lookml-workflow", "agentic-lookml", "generate-view-from-table", "lookml-field-curation", "lookml", "looker-filters", "looker-expressions")

def ensure_skills() -> list[str]:
    SKILLS_ROOT.mkdir(parents=True, exist_ok=True)
    for src_root in (Path(os.environ.get("LKR_CLI_SKILLS_DIR") or "/nonexistent"), SKILLS_ALIAS):
        if src_root.is_dir() and not src_root.is_symlink():
            for s in src_root.iterdir():
                if s.is_dir(): shutil.copytree(s, SKILLS_ROOT / s.name, dirs_exist_ok=True)
    if not SKILLS_ALIAS.exists():
        try: SKILLS_ALIAS.symlink_to(SKILLS_ROOT)
        except Exception: pass
    return sorted(d.name for d in SKILLS_ROOT.iterdir() if d.is_dir())

def ensure_sitecustomize() -> list[str]:
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ws_site = WORKSPACE_DIR / "sitecustomize.py"
    sibling_site = Path(__file__).resolve().parent / "sitecustomize.py"
    if not ws_site.is_file() and sibling_site.is_file() and sibling_site != ws_site:
        shutil.copyfile(sibling_site, ws_site)
    os.environ["PYTHONPATH"] = f"{WORKSPACE_DIR}:{os.environ['PYTHONPATH']}" if os.environ.get("PYTHONPATH") else str(WORKSPACE_DIR)
    installed = [str(ws_site)] if ws_site.is_file() else []
    uv_tool_lib = Path(os.environ.get("UV_TOOL_DIR", str(WORKSPACE_DIR / ".uv_tools"))) / "lkr-dev-cli/lib"
    site_targets = list(uv_tool_lib.glob("python3.*/site-packages"))
    if not site_targets:
        fallback_sp = uv_tool_lib / f"python{sys.version_info.major}.{sys.version_info.minor}/site-packages"
        fallback_sp.mkdir(parents=True, exist_ok=True)
        site_targets = [fallback_sp]
    for p in (*site.getsitepackages(), sysconfig.get_path("purelib"), sysconfig.get_path("platlib"), site.getusersitepackages()):
        if p and Path(p).is_dir() and Path(p) not in site_targets:
            site_targets.append(Path(p))
    lkr_bin = shutil.which("lkr") or shutil.which("lkr-dev-cli")
    if lkr_bin and Path(lkr_bin).is_file():
        try:
            first_line = Path(lkr_bin).read_text(encoding="utf-8", errors="ignore").splitlines()[0]
            if first_line.startswith("#!"):
                shebang_py = first_line[2:].strip().split()[-1]
                lib_dir = Path(shebang_py).resolve().parent.parent / "lib"
                for sp in (*lib_dir.glob("python3.*/site-packages"), *lib_dir.glob("python3.*/dist-packages")):
                    if sp.is_dir() and sp not in site_targets:
                        site_targets.append(sp)
        except Exception:
            pass
    if ws_site.is_file():
        for sp in site_targets:
            dst = sp / "sitecustomize.py"
            try:
                if dst.resolve() != ws_site.resolve():
                    shutil.copyfile(ws_site, dst)
                installed.append(str(dst))
            except Exception:
                pass
    return installed

def ensure_lkr_cli() -> str:
    uv_tool_dir = Path(os.environ.get("UV_TOOL_DIR", str(WORKSPACE_DIR / ".uv_tools")))
    bin_dir = Path(os.environ.get("UV_TOOL_BIN_DIR", "/usr/local/bin"))
    persisted_lkr = uv_tool_dir / "lkr-dev-cli/bin/lkr"
    target_lkr = bin_dir / "lkr"
    if persisted_lkr.is_file() and os.access(persisted_lkr, os.X_OK) and not target_lkr.exists():
        try:
            bin_dir.mkdir(parents=True, exist_ok=True)
            if target_lkr.is_symlink():
                target_lkr.unlink()
            target_lkr.symlink_to(persisted_lkr)
        except Exception:
            pass
    pkg_spec = f"lkr-dev-cli[tools,code-mode,parse]=={LKR_DEV_CLI_VERSION}"
    lkr_bin = shutil.which("lkr") or shutil.which("lkr-dev-cli") or (str(persisted_lkr) if persisted_lkr.is_file() else None)
    try:
        ver_out = subprocess.run([lkr_bin, "--version"], capture_output=True, text=True, check=False).stdout if lkr_bin else ""
    except OSError:
        ver_out = ""
    if LKR_DEV_CLI_VERSION not in ver_out:
        if not shutil.which("uv"):
            for pip_cmd in (["pip"], [sys.executable, "-m", "pip"]):
                try:
                    subprocess.run([*pip_cmd, "install", "--break-system-packages", "--quiet", "uv"], check=False)
                except OSError:
                    pass
                if shutil.which("uv"):
                    break
        cmd = ["uv", "tool", "install", "--force", "--quiet", pkg_spec] if shutil.which("uv") else [sys.executable, "-m", "pip", "install", "--break-system-packages", "--quiet", pkg_spec]
        subprocess.run(cmd, env={"UV_PYTHON_INSTALL_DIR": str(WORKSPACE_DIR / ".uv_python"), "UV_TOOL_DIR": str(WORKSPACE_DIR / ".uv_tools"), "UV_TOOL_BIN_DIR": "/usr/local/bin", **os.environ}, check=False)
    ensure_sitecustomize()
    if str(WORKSPACE_DIR) == "/workspace" and not os.environ.get("GH_TOKEN", os.environ.get("GITHUB_TOKEN", "")):
        try:
            bin_dir.mkdir(parents=True, exist_ok=True)
            gh_shim = bin_dir / "gh"
            gh_shim.write_text(
                chr(10).join([
                    "#!/usr/bin/env python3",
                    "import os, sys",
                    "if (os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')) and os.path.isfile('/usr/bin/gh'):",
                    "    os.execv('/usr/bin/gh', ['/usr/bin/gh', *sys.argv[1:]])",
                    "if sys.argv[1:2] == ['auth']: print('sandbox-bare-git')",
                    "elif sys.argv[1:3] == ['pr', 'create']: print('looker://bare-git-branch')",
                    "",
                ]),
                encoding="utf-8",
            )
            gh_shim.chmod(0o755)
        except Exception:
            pass
    return shutil.which("lkr") or shutil.which("lkr-dev-cli") or (str(persisted_lkr) if persisted_lkr.is_file() else "lkr")

def compute_diff(old_text: str, new_text: str, rel_path: str) -> str:
    return "".join(difflib.unified_diff(old_text.splitlines(keepends=True), new_text.splitlines(keepends=True), fromfile=f"a/{rel_path}", tofile=f"b/{rel_path}", n=3))

def collect_dir_diffs(lookml_dir: Path, baseline_dir: Path) -> list[dict]:
    cur = {str(p.relative_to(lookml_dir)): p.read_text("utf-8") for p in lookml_dir.rglob("*.lkml") if p.is_file()} if lookml_dir.is_dir() else {}
    base = {str(p.relative_to(baseline_dir)): p.read_text("utf-8") for p in baseline_dir.rglob("*.lkml") if p.is_file()} if baseline_dir.is_dir() else {}
    changes = []
    for rel in sorted(set(cur) | set(base)):
        old_t, new_t = base.get(rel, ""), cur.get(rel, "")
        if old_t == new_t and (rel in cur) == (rel in base): continue
        action = "created" if rel not in base else ("deleted" if rel not in cur else "updated")
        changes.append({"path": rel, "action": action, "content": new_t, **({"diff": compute_diff(old_t, new_t, rel)} if old_t else {})})
    return changes

def normalize_queries(raw_queries: list[dict]) -> list[dict]:
    out = []
    for i, q in enumerate(raw_queries or []):
        if not isinstance(q, dict): continue
        sql_slug = str(q.get("sql_slug") or q.get("sql_query_id") or "")
        exp_slug = str(q.get("explore_slug") or q.get("query_slug") or q.get("query_id") or "")
        out.append({"query_index": q.get("query_index", i), "label": q.get("label") or f"Query #{q.get('query_index', i) + 1}", "sql_slug": sql_slug, "sql_runner_url": q.get("sql_runner_url") or (f"/sql/{sql_slug}" if sql_slug else ""), "explore_slug": exp_slug, "explore_url": q.get("explore_url") or (f"/x/{exp_slug}" if exp_slug else ""), "parity_status": q.get("parity_status") or ("matched" if q.get("passed") else "checked"), "mismatches": q.get("mismatches") or []})
    return out

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "setup"
    if cmd in ("cli", "bootstrap"):
        lkr_bin = ensure_lkr_cli()
        print(json.dumps({"ok": True, "uv": shutil.which("uv") or "uv", "lkr": lkr_bin, "version": LKR_DEV_CLI_VERSION}))
        return

    if cmd == "setup":
        skills = ensure_skills()
        lkr_bin = ensure_lkr_cli()
        site_paths = ensure_sitecustomize()
        LOOKML_DIR.mkdir(parents=True, exist_ok=True)
        BASELINE_DIR.mkdir(parents=True, exist_ok=True)
        print(json.dumps({"ok": True, "uv": shutil.which("uv") or "uv", "lkr": lkr_bin, "version": LKR_DEV_CLI_VERSION, "skills": sorted(skills), "sitecustomize": site_paths}))
        return

    if cmd == "bundle":
        spec_path = Path(sys.argv[2] if len(sys.argv) > 2 else str(WORKSPACE_DIR / "lookml_result.json"))
        run_dir = spec_path if spec_path.is_dir() else None
        raw = (
            json.loads((run_dir / "data.json").read_text("utf-8"))
            if run_dir and (run_dir / "data.json").is_file()
            else json.loads(spec_path.read_text("utf-8"))
            if spec_path.is_file()
            else {}
        )
        if not run_dir and (raw.get("run_id") or raw.get("id")):
            cand = WORKSPACE_DIR / "data" / str(raw.get("run_id") or raw.get("id"))
            if cand.is_dir():
                run_dir = cand
        active_lookml_dir = (run_dir / "lookml") if run_dir and (run_dir / "lookml").is_dir() else LOOKML_DIR
        lkr_bin = shutil.which("lkr")
        if lkr_bin and active_lookml_dir.is_dir() and any(active_lookml_dir.glob("*.model.lkml")):
            base_args = ["--base-path", str(BASELINE_DIR)] if BASELINE_DIR.is_dir() and any(BASELINE_DIR.glob("*.model.lkml")) else []
            chk = subprocess.run(
                [lkr_bin, "parse", "lookml-to-api", "--path", str(active_lookml_dir), *base_args, "-o", "/tmp/_bundle_api_check.json", "--validate"],
                capture_output=True,
                text=True,
            )
            if chk.returncode != 0:
                sys.stderr.write((chk.stderr or chk.stdout or "lkr parse lookml-to-api --validate failed").strip() + "\\n")
                sys.exit(chk.returncode)
        summary_md = (
            (run_dir / "summary.md").read_text("utf-8")
            if run_dir and (run_dir / "summary.md").is_file()
            else ""
        )
        files = raw.get("files") or collect_dir_diffs(active_lookml_dir, BASELINE_DIR)
        for f in files:
            if not f.get("diff") and f.get("content"):
                old_file = BASELINE_DIR / f["path"]
                if old_file.is_file():
                    f["diff"] = compute_diff(old_file.read_text("utf-8"), f["content"], f["path"])

        val_errors = raw.get("validation_errors") or (raw.get("validation") or {}).get("errors") or []
        inferred_model = next((p.name[:-11] for p in sorted(active_lookml_dir.glob("*.model.lkml"))), "") if active_lookml_dir.is_dir() else ""
        bundle = {
            "id": str(raw.get("id") or raw.get("run_id") or raw.get("branch_name") or f"{raw.get('project_id') or 'lookml'}_{int(time.time())}"),
            "title": str(raw.get("title") or f"LookML: {raw.get('project_id', 'Project')}"),
            "project_id": str(raw.get("project_id") or ""),
            "model_name": raw.get("model_name") or inferred_model or str(raw.get("project_id") or "").replace("-", "_"),
            "branch_name": raw.get("branch_name") or "",
            "files": files,
            "validation": raw.get("validation")
            or {
                "passed": len(val_errors) == 0 and raw.get("passed", True) is not False,
                "error_count": len(val_errors),
                "errors": val_errors,
            },
            "tests": raw.get("tests") or [],
            "queries": normalize_queries(raw.get("queries") or []),
            "summary_markdown": raw.get("summary_markdown") or summary_md,
        }
        bundle_json = json.dumps(bundle)
        safe_bid = "".join(c if c.isalnum() or c in "._-" else "_" for c in bundle["id"])[:80] or "latest"
        bundle_fname = f"lookml_bundle_{safe_bid}.json"
        (WORKSPACE_DIR / bundle_fname).write_text(bundle_json, encoding="utf-8")
        if len(bundle_json) > 12000 and str(WORKSPACE_DIR) == "/workspace":
            compact = {k: v for k, v in bundle.items() if k != "files"}
            compact["__bundle_ref__"] = f"/workspace/{bundle_fname}"
            print("<LOOKML_BUNDLE>" + json.dumps(compact) + "</LOOKML_BUNDLE>")
        else:
            print("<LOOKML_BUNDLE>" + bundle_json + "</LOOKML_BUNDLE>")
        return

    sys.exit(f"Unknown command: {cmd}. Usage: bootstrap_lookml.py [cli|bootstrap|setup|bundle]")

if __name__ == "__main__":
    main()
`

const normalizeLookerBridgePath = normalizeLookerApiPath

async function executeLkrExtensionToolRequestInner(params: {
  sdk: Looker40SDK
  req: LkrExtensionToolRequest
  defaultVars?: Record<string, unknown>
  extensionSDK?: Partial<ExtensionSDK>
  requirePermission?: boolean
  approvedOperations?: Set<string>
  onPermissionRequest?: LkrCodeModeRunOptions['onPermissionRequest']
  conversationId?: string
}): Promise<{ cacheKey: string; result: unknown }> {
  const { sdk, req, defaultVars, extensionSDK, requirePermission, approvedOperations, onPermissionRequest, conversationId } = params
  if (req.kind === 'file_ref') {
    throw new Error(`Unhydrated file_ref bridge request (${req.req_path || req.cache_key || 'unknown'})`)
  }
  const cacheKey = req.cache_key || computeLkrExtensionCacheKey(req)
  const cleanPath = req.kind === 'sdk_request' ? normalizeLookerBridgePath(req.path) : ''
  const effectiveThought = typeof req.thought === 'string' && req.thought.trim() ? req.thought.trim() : undefined
  const baseHandler = resolveLookerBaseHandler({ sdk, extensionSDK })
  // ponytail: wasm.runPythonCodeRaw already issues PATCH /session via requestHandler when allowUpdateSession is true,
  // so useHandlerFallback is true only for sdk_request to avoid sending PATCH /session twice on codemode calls.
  const ensureDevSession = async (useHandlerFallback: boolean) => {
    if (!req.dev_mode || cleanPath === '/session') return
    try {
      const sdkExt = sdk as unknown as {
        update_session?: (b: { workspace_id: string }) => Promise<unknown>
        ok?: (p: Promise<unknown>) => Promise<unknown>
      }
      if (typeof sdkExt?.update_session === 'function') {
        const p = sdkExt.update_session({ workspace_id: 'dev' })
        await (typeof sdkExt.ok === 'function' ? sdkExt.ok(p) : p)
      } else if (useHandlerFallback && baseHandler) {
        await baseHandler('PATCH', '/session', undefined, { workspace_id: 'dev' })
      }
    } catch {
      /* ignore dev session switch failure */
    }
  }

  if (req.kind === 'sdk_request') {
    const method = String(req.method || 'GET').toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
    const queryParams = cleanQueryParams(req.query_params) || undefined
    const body = req.body !== null && req.body !== undefined ? req.body : undefined
    const sdkHandler = baseHandler
      ? async (m: string, p: string, q?: unknown, b?: unknown) => {
          await ensureDevSession(true)
          return baseHandler(m, p, q, b)
        }
      : undefined
    const gated = createGatedLookerHandler(sdkHandler, {
      requirePermission,
      approvedOperations,
      onPermissionRequest,
      thought: effectiveThought || `${method} ${cleanPath}`,
    })
    if (!gated) throw new Error(`Looker SDK transport is not configured for ${method} ${cleanPath}`)
    const result = await gated(method, cleanPath, queryParams, body)
    return { cacheKey, result }
  }

  await ensureDevSession(false)
  const rawOut = await LkrCodeMode.runPythonCode(
    Object.assign(
      { code: String(req.code || ''), sdk, vars: Object.assign({}, defaultVars || null, req.vars || null), allowUpdateSession: Boolean(req.dev_mode), extensionSDK, requirePermission, approvedOperations, onPermissionRequest, conversationId },
      effectiveThought ? { thought: effectiveThought } : null
    )
  )
  let result: unknown = rawOut
  if (typeof rawOut === 'string') {
    const trimmed = rawOut.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        result = JSON.parse(trimmed)
      } catch {
        result = rawOut
      }
    }
  }
  return { cacheKey, result }
}

export const executeLkrExtensionToolRequest: typeof executeLkrExtensionToolRequestInner = (params) =>
  withCodeModeApiScope(() => executeLkrExtensionToolRequestInner(params), params.conversationId)
