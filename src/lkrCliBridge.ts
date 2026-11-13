import type { ExtensionSDK } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import type { CodeModePermissionDecision, CodeModePermissionRequest } from './antigravityTypes'
import { fetchLookerCaAgentsCatalog, LookerCaAgentSummary, normalizeCaAgent } from './conversationalAnalytics'
import {
  invokeLookerExtensionSdk,
  isLookerExtensionSdk,
  normalizeLookerApiPath,
  rawLookerRequest,
  resolveLookerExtensionSdk,
  withCodeModeApiScope,
} from './lookerApi'

export const CODEMODE_CDN_URL = 'https://cdn.lkr.dev/cli/codemode/0.0.67/codemode.js'

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
        code: {
          type: 'string',
          description:
            'Python snippet to execute in Monty sandbox. Use `return ...` to return the result (dicts/lists/strings). All Looker 4.0 SDK methods are pre-bound as bare top-level functions (e.g. `all_connections()`, `connection_schemas(name)`, `run_inline_query(...)`) — do NOT use `sdk.<method>(...)`.',
        },
        vars: {
          type: 'object',
          description:
            'Optional dictionary of top-level variables to inject into the Monty Python sandbox (e.g. project_id, ts_utc, raw_sql, inline_queries_json, test_queries_json, file_ids, test_names, commit_message).',
        },
        thought: {
          type: 'string',
          description:
            'Required concise 1-sentence summary of what this Code Mode snippet is doing with the Looker API calls (e.g. "Querying monthly revenue and category share from the target explore" or "Creating executive KPI dashboard with 4 tiles").',
        },
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

  let code = rawCode
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
    vars: Object.assign(
      { INVESTIGATION_ANCHOR_DATE: new Date().toISOString().slice(0, 10) },
      usesSearchAgents ? { __ca_agents_catalog__: caAgentsCatalog } : null,
      baseOpts.vars || null
    ),
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

export const LKR_DEV_CLI_VERSION = '0.0.67'
export const LKR_DEV_CLI_SPEC = `lkr-dev-cli[tools,code-mode,parse]==${LKR_DEV_CLI_VERSION}`
export const BOOTSTRAP_SANDBOX_SH = `[ -x /workspace/.uv_tools/lkr-dev-cli/bin/lkr ] && [ ! -x /usr/local/bin/lkr ] && ln -sf /workspace/.uv_tools/lkr-dev-cli/bin/lkr /usr/local/bin/lkr; lkr --version 2>/dev/null | grep -q "${LKR_DEV_CLI_VERSION}" || { (command -v uv >/dev/null 2>&1 || pip install --break-system-packages --quiet uv || python3 -m pip install --break-system-packages --quiet uv); UV_PYTHON_INSTALL_DIR=/workspace/.uv_python UV_TOOL_DIR=/workspace/.uv_tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "${LKR_DEV_CLI_SPEC}"; }; for sp in /workspace/.uv_tools/lkr-dev-cli/lib/python3.*/site-packages ~/.local/share/uv/tools/lkr-dev-cli/lib/python3.*/site-packages /usr/local/lib/python3.*/dist-packages /usr/lib/python3/dist-packages; do [ -d "$sp" ] && [ -w "$sp" ] && [ -f /workspace/sitecustomize.py ] && cp -f /workspace/sitecustomize.py "$sp/sitecustomize.py"; done; true`

export interface LkrExtensionToolRequest {
  kind: 'codemode' | 'sdk_request' | 'file_ref'
  cache_key?: string
  req_path?: string
  code?: string
  vars?: Record<string, unknown>
  dev_mode?: boolean
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | string
  path?: string
  query_params?: Record<string, unknown> | null
  body?: unknown
  thought?: string
}

export const LKR_CLI_SITECUSTOMIZE_PY = `"""Antigravity Looker Extension Bridge for lkr-dev-cli (sitecustomize.py).

Intercepts online lkr-dev-cli calls (lkr.codemode.main.sandbox / run_python_code and
lkr.auth_service.init_sdk / get_auth / RequestsTransport.request) when no Looker
credentials exist in the container environment, checks /workspace/.lkr_extension_cache/<key>.json,
and emits <LKR_EXTENSION_TOOL_REQUEST>{...}</LKR_EXTENSION_TOOL_REQUEST> on cache misses.
"""
import builtins
import functools
import hashlib
import json
import os
import re
import sys
import types
from pathlib import Path

def _bridge_enabled() -> bool:
    if os.environ.get("LKR_DISABLE_EXTENSION_BRIDGE") in ("1", "true", "yes"):
        return False
    return not (
        os.environ.get("LOOKERSDK_BASE_URL")
        and os.environ.get("LOOKERSDK_CLIENT_ID")
        and os.environ.get("LOOKERSDK_CLIENT_SECRET")
        and os.environ.get("LKR_FORCE_EXTENSION_BRIDGE") not in ("1", "true", "yes")
    )

if _bridge_enabled():
    os.environ.setdefault("LOOKERSDK_BASE_URL", "https://extension.looker.local")

def _normalize_bridge_path(raw_path: str) -> str:
    p = re.sub(r"^https?://[^/]+", "", str(raw_path or "").strip())
    p = re.sub(r"^/api/4\\.0(?=/|$)", "", p)
    return p if p.startswith("/") else f"/{p}"

def _clean_query_params(qp):
    cleaned = {str(k): v for k, v in qp.items() if v is not None} if isinstance(qp, dict) else {}
    return cleaned or None

def _parse_body(body):
    if isinstance(body, (bytes, bytearray)):
        body = body.decode("utf-8", errors="replace")
    if isinstance(body, str):
        s = body.strip()
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            return s
    return body

def _compute_cache_key(payload: dict) -> str:
    if payload.get("kind") == "sdk_request":
        norm = {
            "kind": "sdk_request",
            "method": str(payload.get("method") or "GET").upper(),
            "path": _normalize_bridge_path(payload.get("path") or "/"),
            "query_params": _clean_query_params(payload.get("query_params")),
            "body": _parse_body(payload.get("body")),
            "dev_mode": bool(payload.get("dev_mode", False)),
        }
    else:
        raw_vars = payload.get("vars") or {}
        norm = {
            "kind": "codemode",
            "code": str(payload.get("code") or "").strip(),
            "vars": {str(k): v for k, v in sorted(raw_vars.items())} if isinstance(raw_vars, dict) else {},
            "dev_mode": bool(payload.get("dev_mode", False)),
        }
    canonical = json.dumps(norm, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

def _cache_dirs() -> list[Path]:
    cands = [
        os.environ.get("LKR_EXTENSION_CACHE_DIR"),
        str(Path(os.environ.get("WORKSPACE_DIR", "/workspace")) / ".lkr_extension_cache"),
        str(Path.cwd() / ".lkr_extension_cache"),
    ]
    return [Path(p) for p in dict.fromkeys(c for c in cands if c)]

def _read_cache(cache_key: str):
    for d in _cache_dirs():
        f = d / f"{cache_key}.json"
        if f.is_file():
            txt = f.read_text(encoding="utf-8")
            if "PermissionError:" in txt:
                continue
            raw = json.loads(txt)
            val = raw["result"] if isinstance(raw, dict) and "result" in raw and (raw.get("__lkr_bridge_envelope__") or set(raw.keys()) <= {"cacheKey", "cache_key", "result", "ok"}) else raw
            if isinstance(val, dict) and val.get("__lookml_pull__") and not (val.get("files") or {}):
                try: f.unlink()
                except Exception: pass
                return False, None
            return True, val
    return False, None

def _format_bridge_tag(req_dict: dict) -> str:
    raw_json = json.dumps(req_dict, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    if len(raw_json) > 8000 and os.environ.get("LKR_EXTENSION_CACHE_DIR") is None:
        cdir = Path(os.environ.get("WORKSPACE_DIR", "/workspace")) / ".lkr_extension_cache"
        cdir.mkdir(parents=True, exist_ok=True)
        rfile = cdir / f"_req_{req_dict.get('cache_key')}.json"
        rfile.write_text(raw_json, encoding="utf-8")
        ref_obj = {"kind": "file_ref", "cache_key": req_dict.get("cache_key"), "req_path": str(rfile), "dev_mode": bool(req_dict.get("dev_mode", False))}
        raw_json = json.dumps(ref_obj, sort_keys=True, separators=(",", ":"))
    return "<LKR_EXTENSION_TOOL_REQUEST>" + raw_json + "</LKR_EXTENSION_TOOL_REQUEST>"

def _emit_bridge_request(req_dict: dict):
    tag = _format_bridge_tag(req_dict)
    sys.stdout.write(tag + "\\n")
    sys.stdout.flush()
    sys.stderr.write(
        f"[lkr-extension-bridge] Online Looker call routed to host extension (cache_key={req_dict.get('cache_key')}). "
        f"Call tool lkr_cli_extension_bridge with the JSON inside <LKR_EXTENSION_TOOL_REQUEST> (never call run_looker_codemode with open()); if replay_needed is true, write result to /workspace/.lkr_extension_cache/{req_dict.get('cache_key')}.json and replay (skip cache write and CLI replay when replay_needed is false).\\n{tag}\\n"
    )
    sys.stderr.flush()
    raise SystemExit(2)

def _parse_var_list(var_list) -> dict:
    return {k.strip(): v for item in (var_list or []) if isinstance(item, str) and "=" in item for k, v in [item.split("=", 1)]}

def _handle_codemode(code_str: str, vars_dict: dict, is_dev_mode: bool) -> str:
    req = {
        "kind": "codemode",
        "code": str(code_str or "").strip(),
        "vars": dict(sorted((vars_dict or {}).items())),
        "dev_mode": bool(is_dev_mode),
    }
    req["cache_key"] = _compute_cache_key(req)
    hit, val = _read_cache(req["cache_key"])
    if hit:
        return val if isinstance(val, str) else json.dumps(val, indent=2, default=str)
    _emit_bridge_request(req)

class ExtensionBridgeTransport:
    def __init__(self, dev_mode: bool = False):
        self.dev_mode = bool(dev_mode)

    @classmethod
    def configure(cls, settings=None):
        return cls()

    def request(self, method, path: str, query_params=None, body=None, authenticator=None, transport_options=None):
        from looker_sdk.rtl import transport as rtl_transport
        method_str = getattr(method, "name", str(method)).upper().replace("HTTPMETHOD.", "")
        clean_path = _normalize_bridge_path(path)
        parsed_body = _parse_body(body)
        clean_qp = _clean_query_params(query_params)
        if clean_path == "/session" and method_str == "PATCH" and isinstance(parsed_body, dict):
            if parsed_body.get("workspace_id") in ("dev", "production"):
                self.dev_mode = parsed_body["workspace_id"] == "dev"
            ws = "dev" if self.dev_mode else "production"
            return rtl_transport.Response(True, json.dumps({"workspace_id": ws}).encode("utf-8"), rtl_transport.ResponseMode.STRING, "utf-8")
        req = {
            "kind": "sdk_request",
            "method": method_str,
            "path": clean_path,
            "query_params": clean_qp,
            "body": parsed_body,
            "dev_mode": bool(self.dev_mode),
        }
        req["cache_key"] = _compute_cache_key(req)
        hit, val = _read_cache(req["cache_key"])
        if hit:
            raw_bytes = (val if isinstance(val, str) else json.dumps(val, default=str)).encode("utf-8")
            return rtl_transport.Response(True, raw_bytes, rtl_transport.ResponseMode.STRING, "utf-8")
        _emit_bridge_request(req)

def _build_bridge_sdk(use_production: bool = True):
    from looker_sdk.rtl import serialize
    from lkr.extended_sdk_methods import ExtendedLooker40SDK
    bridge_transport = ExtensionBridgeTransport(dev_mode=not bool(use_production))
    settings = types.SimpleNamespace(
        base_url=os.environ.get("LOOKERSDK_BASE_URL") or "https://extension.looker.local",
        agent_tag="lkr-extension-bridge",
        read_config=lambda: {"base_url": "https://extension.looker.local"},
        is_configured=lambda: True,
    )
    auth = types.SimpleNamespace(
        settings=settings,
        transport=bridge_transport,
        authenticate=lambda *a, **kw: {"Authorization": "Bearer extension-bridge"},
    )
    return ExtendedLooker40SDK(auth, serialize.deserialize40, serialize.serialize40, bridge_transport, "4.0")

class ExtensionBridgeAuth:
    def __init__(self, use_production: bool = True):
        self.use_production = bool(use_production)
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc_val, exc_tb):
        pass
    def get_current_instance(self) -> str:
        return "extension-bridge"
    def get_current_sdk(self, **kwargs):
        return _build_bridge_sdk(use_production=self.use_production)
    def list_auth(self):
        return [("extension-bridge", "https://extension.looker.local", True, self.use_production)]

def _patch_auth_service(mod):
    if getattr(mod, "_lkr_extension_patched", False):
        return
    orig_get_auth, orig_init_sdk = getattr(mod, "get_auth", None), getattr(mod, "init_sdk", None)
    if not orig_get_auth or not orig_init_sdk:
        return

    def _patched_get_auth(ctx):
        if not _bridge_enabled():
            return orig_get_auth(ctx)
        lkr_ctx = ctx.obj.get("ctx_lkr") if hasattr(ctx, "obj") and isinstance(getattr(ctx, "obj", None), dict) else ctx
        return ExtensionBridgeAuth(use_production=bool(getattr(lkr_ctx, "use_production", True)))

    def _patched_init_sdk(*args, **kwargs):
        if not _bridge_enabled() or (kwargs.get("base_url") and kwargs.get("client_id") and kwargs.get("client_secret")):
            return orig_init_sdk(*args, **kwargs)
        use_prod = kwargs.get("use_production", args[4] if len(args) > 4 else True)
        return _build_bridge_sdk(use_production=use_prod)

    mod.get_auth, mod.init_sdk, mod._lkr_extension_patched = _patched_get_auth, _patched_init_sdk, True
    if "lkr" in sys.modules:
        setattr(sys.modules["lkr"], "init_sdk", _patched_init_sdk)
    req_transport = getattr(mod, "RequestsTransport", None)
    if req_transport and not getattr(req_transport, "_lkr_extension_patched", False):
        orig_req = req_transport.request
        req_transport.request = lambda self, method, path, query_params=None, body=None, authenticator=None, transport_options=None: (
            ExtensionBridgeTransport(dev_mode=False).request(method, path, query_params=query_params, body=body, authenticator=authenticator, transport_options=transport_options)
            if _bridge_enabled()
            else orig_req(self, method, path, query_params=query_params, body=body, authenticator=authenticator, transport_options=transport_options)
        )
        req_transport._lkr_extension_patched = True

def _patch_codemode(mod):
    if getattr(mod, "_lkr_extension_patched", False):
        return
    orig_sandbox, orig_run_python = getattr(mod, "sandbox", None), getattr(mod, "run_python_code", None)
    if not orig_sandbox or not orig_run_python:
        return

    @functools.wraps(orig_run_python)
    def _patched_run_python_code(code: str, dev_mode: bool = False, allow_update_session: bool = False, **kwargs) -> str:
        if not _bridge_enabled():
            return orig_run_python(code, dev_mode=dev_mode, allow_update_session=allow_update_session)
        ctx_lkr = kwargs.get("ctx_lkr") or getattr(mod, "ctx_lkr", None)
        is_dev = bool(dev_mode) or bool(ctx_lkr is not None and getattr(ctx_lkr, "use_production", True) is False)
        return _handle_codemode(code, {}, is_dev)

    @functools.wraps(orig_sandbox)
    def _patched_sandbox(ctx, code=None, file=None, dev_mode=False, allow_update_session=False, var=None):
        code = code if isinstance(code, str) else None
        file = file if isinstance(file, (str, Path)) else None
        dev_mode = dev_mode if isinstance(dev_mode, bool) else False
        var = var if isinstance(var, (list, tuple)) else None
        if not _bridge_enabled() or (not code and not file) or (code and file):
            return orig_sandbox(ctx=ctx, code=code, file=file, dev_mode=dev_mode, allow_update_session=allow_update_session, var=var)
        code_to_run = Path(file).read_text(encoding="utf-8") if file else str(code or "")
        ctx_lkr = ctx.obj.get("ctx_lkr") if (ctx and isinstance(getattr(ctx, "obj", None), dict)) else None
        is_dev = bool(dev_mode) or bool(ctx_lkr is not None and getattr(ctx_lkr, "use_production", True) is False)
        print(_handle_codemode(code_to_run, _parse_var_list(var), is_dev))

    mod.run_python_code, mod.sandbox, mod._lkr_extension_patched = _patched_run_python_code, _patched_sandbox, True
    for cmd in getattr(getattr(mod, "group", None), "registered_commands", []) or []:
        if getattr(cmd, "name", None) == "sandbox" or getattr(getattr(cmd, "callback", None), "__name__", "") == "sandbox":
            cmd.callback = _patched_sandbox

_PUSH_CODEMODE_PY = """
def _re_perm(e):
    if "PermissionError" in str(e): raise e
try: update_session({"workspace_id": "dev"})
except Exception: pass
try: _cp = bool(create_project)
except Exception: _cp = False
existing_remote = []
new_project = False
if not reset and not _cp:
    try:
        existing_remote = all_project_files(project_id) or []
    except Exception:
        new_project = True
if reset or _cp or new_project:
    existing_projects = {}
    try:
        existing_projects = {pr.get("id"): pr for pr in (all_projects(fields="id,uses_git,git_service_name") or []) if isinstance(pr, dict) and pr.get("id")}
    except Exception:
        existing_projects = {}
    new_project = project_id not in existing_projects
    p = create_project({"name": project_id}) if new_project else existing_projects[project_id]
    if not p.get("uses_git") and p.get("git_service_name") != "bare":
        try: update_project(project_id, {"git_service_name": "bare"})
        except Exception as _e: _re_perm(_e)
    if reset and not new_project:
        try: reset_project_to_production(project_id)
        except Exception as _e:
            _re_perm(_e)
            try: create_developer_copy(project_id)
            except Exception as _e2: _re_perm(_e2)
    if not new_project:
        try:
            existing_remote = all_project_files(project_id) or []
        except Exception:
            existing_remote = []
remote_paths = {(rf.get("path") or rf.get("id") or "") for rf in existing_remote if isinstance(rf, dict)}
created_dirs = set()
for rp in remote_paths:
    cur_rp = ""
    for part in [x for x in rp.split("/")[:-1] if x]:
        cur_rp = f"{cur_rp}/{part}" if cur_rp else part
        created_dirs.add(cur_rp)
pushed_paths = set()
for f in files_to_push:
    fpath = f["path"]
    content = f["content"]
    if fpath in remote_paths:
        if not reset and content.lstrip().startswith("# AUTOGENERATED"):
            pushed_paths.add(fpath)
            continue
        try:
            update_file(project_id, {"path": fpath, "content": content})
            pushed_paths.add(fpath)
            continue
        except Exception as _e: _re_perm(_e)
    dpath = "/".join(fpath.split("/")[:-1])
    if dpath and dpath not in created_dirs:
        cur = ""
        for part in [x for x in dpath.split("/") if x]:
            cur = f"{cur}/{part}" if cur else part
            if cur not in created_dirs:
                try: create_project_directory(project_id, cur)
                except Exception as _e: _re_perm(_e)
                created_dirs.add(cur)
    try: create_file(project_id, {"path": fpath, "content": content})
    except Exception as _e:
        _re_perm(_e)
        update_file(project_id, {"path": fpath, "content": content})
    pushed_paths.add(fpath)
if reset and not single_file:
    for rpath in remote_paths:
        if rpath and rpath not in pushed_paths and not rpath.endswith(".gitkeep") and rpath != "manifest.lkml":
            try: delete_file(project_id, rpath)
            except Exception as _e: _re_perm(_e)
model_files = [f for f in files_to_push if f["root_name"].endswith(".model.lkml") and (reset or f["path"] not in remote_paths)]
if model_files:
    existing_models = {m.get("name"): m for m in (all_lookml_models(fields="name,project_name,allowed_db_connection_names") or []) if isinstance(m, dict) and m.get("name")}
    for mf in model_files:
        mname = mf["root_name"][:-11]
        conn_name = mf.get("connection")
        allowed = [conn_name] if conn_name else []
        if mname not in existing_models:
            try: create_lookml_model({"name": mname, "project_name": project_id, "allowed_db_connection_names": allowed})
            except Exception as _e: _re_perm(_e)
        else:
            cur_allowed = list(existing_models[mname].get("allowed_db_connection_names") or [])
            if conn_name and conn_name not in cur_allowed:
                cur_allowed.append(conn_name)
            try: update_lookml_model(mname, {"name": mname, "project_name": project_id, "allowed_db_connection_names": cur_allowed})
            except Exception as _e: _re_perm(_e)
if deploy:
    try: commit(project_id, {"message": message})
    except Exception as _e: _re_perm(_e)
    try: deploy_to_production(project_id)
    except Exception as _e: _re_perm(_e)
return {"ok": True, "project_id": project_id, "pushed": sorted(pushed_paths)}
""".strip()

_PULL_CODEMODE_PY = """
files_out = {}
try:
    remote_list = all_project_files(project_id) or []
except Exception:
    remote_list = []
for rf in remote_list:
    if not isinstance(rf, dict):
        continue
    rpath = str(rf.get("path") or rf.get("id") or "").lstrip("/")
    if not rpath or rpath.endswith(".gitkeep"):
        continue
    if not sync_hidden and any(part.startswith(".") for part in rpath.split("/")):
        continue
    try:
        files_out[rpath] = get_file_content(project_id, rpath) or ""
    except Exception:
        pass
return {"__lookml_pull__": True, "project_id": project_id, "files": files_out}
""".strip()

def _patch_auth_cli(mod):
    if getattr(mod, "_lkr_extension_patched", False):
        return
    orig_add = getattr(mod, "add_access_token", None)
    if not orig_add:
        return
    @functools.wraps(orig_add)
    def _patched_add_access_token(ctx, *args, **kwargs):
        if not _bridge_enabled():
            return orig_add(ctx, *args, **kwargs)
        print("Authenticated via Looker Extension Bridge.")
    mod.add_access_token, mod._lkr_extension_patched = _patched_add_access_token, True
    for cmd in getattr(getattr(mod, "group", None), "registered_commands", []) or []:
        if getattr(cmd, "name", None) == "add-access-token" or getattr(getattr(cmd, "callback", None), "__name__", "") == "add_access_token":
            cmd.callback = _patched_add_access_token

def _patch_lookml(mod):
    if getattr(mod, "_lkr_extension_patched", False):
        return
    orig_push = getattr(mod, "push", None)
    orig_pull = getattr(mod, "pull", None)
    if not orig_push:
        return

    if orig_pull:
        @functools.wraps(orig_pull)
        def _patched_pull(ctx, folder_name, project_id_opt=None, file_opt=None, deploy=False, message="pull from lkr cli then commit and deploy", sync_hidden=False, **kwargs):
            if not _bridge_enabled():
                return orig_pull(ctx=ctx, folder_name=folder_name, project_id_opt=project_id_opt, file_opt=file_opt, deploy=deploy, message=message, sync_hidden=sync_hidden, **kwargs)
            project_id = mod._resolve_project_id(folder_name, project_id_opt)
            lookml_dir = Path(os.path.abspath(folder_name))
            lookml_dir.mkdir(parents=True, exist_ok=True)
            non_pull_keys = [
                cf.stem for d in _cache_dirs() if d.is_dir() for cf in d.glob("*.json")
                if "__lookml_pull__" not in cf.read_text(encoding="utf-8", errors="ignore")
            ]
            epoch = hashlib.sha256(",".join(sorted(set(non_pull_keys))).encode("utf-8")).hexdigest()[:12]
            req = {"kind": "codemode", "code": _PULL_CODEMODE_PY, "vars": {"epoch": epoch, "project_id": project_id, "sync_hidden": bool(sync_hidden)}, "dev_mode": True}
            req["cache_key"] = _compute_cache_key(req)
            hit, val = _read_cache(req["cache_key"])
            if not hit:
                _emit_bridge_request(req)
            parsed = json.loads(val) if isinstance(val, str) else (val or {})
            files_map = parsed.get("files") if isinstance(parsed, dict) else {}
            if isinstance(files_map, dict):
                target_rel = str(file_opt).lstrip("/") if file_opt else None
                for rpath, content in files_map.items():
                    if target_rel and rpath != target_rel:
                        continue
                    dst = lookml_dir / rpath
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    dst.write_text(str(content), encoding="utf-8")
            elif file_opt and str(file_opt).endswith(".gitkeep"):
                dst = lookml_dir / str(file_opt).lstrip("/")
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.touch()
            return

    @functools.wraps(orig_push)
    def _patched_push(ctx, folder_name, project_id_opt=None, file_opt=None, deploy=False, reset=True, message="push from lkr cli", sync_hidden=False, only_changed=False, create_project=False, **kwargs):
        if not _bridge_enabled():
            return orig_push(ctx=ctx, folder_name=folder_name, project_id_opt=project_id_opt, file_opt=file_opt, deploy=deploy, reset=reset, message=message, sync_hidden=sync_hidden, only_changed=only_changed, **({"create_project": create_project} if "create_project" in orig_push.__code__.co_varnames else {}), **kwargs)
        if file_opt is None and os.path.isfile(folder_name):
            file_opt = folder_name
            folder_name = os.path.dirname(os.path.abspath(folder_name))
        project_id = mod._resolve_project_id(folder_name, project_id_opt)
        lookml_dir = os.path.abspath(folder_name)
        valid_exts = getattr(mod, "VALID_EXTENSIONS", (".lkml", ".lookml", ".md", ".json", ".js", ".css"))
        ignored_files = getattr(mod, "IGNORED_FILES", set())
        files_to_push = []
        def _add_file(full_p, rel_p, fname):
            content = Path(full_p).read_text(encoding="utf-8")
            m = re.search(r'^\\s*connection:\\s*["\\']?([^"\\'\\s;#]+)["\\']?', content, re.MULTILINE) if fname.endswith(".model.lkml") else None
            files_to_push.append({"path": rel_p, "root_name": fname, "content": content, "connection": m.group(1).strip() if m else None})
        if file_opt:
            fp = file_opt if os.path.isabs(file_opt) else os.path.join(lookml_dir, file_opt)
            fp = os.path.abspath(fp)
            _add_file(fp, os.path.relpath(fp, lookml_dir).replace("\\\\", "/"), os.path.basename(fp))
        else:
            for root, dirs, files in os.walk(lookml_dir):
                dirs[:] = [d for d in dirs if (d != ".git" if sync_hidden else not d.startswith("."))]
                for fname in sorted(files):
                    if fname in ignored_files or not any(fname.endswith(ext) for ext in valid_exts):
                        continue
                    fp = os.path.join(root, fname)
                    rel_p = os.path.relpath(fp, lookml_dir).replace("\\\\", "/")
                    if not sync_hidden and any(part.startswith(".") for part in rel_p.split("/")):
                        continue
                    _add_file(fp, rel_p, fname)
        vars_dict = {"project_id": project_id, "files_to_push": files_to_push, "single_file": bool(file_opt), "deploy": bool(deploy), "reset": bool(reset), "message": str(message), **({"create_project": True} if create_project else {})}
        req = {"kind": "codemode", "code": _PUSH_CODEMODE_PY, "vars": dict(sorted(vars_dict.items())), "dev_mode": True}
        req["cache_key"] = _compute_cache_key(req)
        hit, val = _read_cache(req["cache_key"])
        if hit:
            print(val if isinstance(val, str) else json.dumps(val, indent=2, default=str))
            return
        tag = _format_bridge_tag(req)
        sys.stdout.write(tag + "\\n" + json.dumps({"ok": True, "project_id": project_id, "pushed": [f["path"] for f in files_to_push]}) + "\\n")
        sys.stdout.flush()

    mod.push, mod._lkr_extension_patched = _patched_push, True
    if orig_pull:
        mod.pull = _patched_pull
    for cmd in getattr(getattr(mod, "lookml_group", None), "registered_commands", []) or []:
        if getattr(cmd, "name", None) == "push" or getattr(getattr(cmd, "callback", None), "__name__", "") == "push":
            cmd.callback = _patched_push
        elif orig_pull and (getattr(cmd, "name", None) == "pull" or getattr(getattr(cmd, "callback", None), "__name__", "") == "pull"):
            cmd.callback = _patched_pull

def _apply_lkr_patches():
    if mod_auth := sys.modules.get("lkr.auth_service"):
        _patch_auth_service(mod_auth)
        for m in list(sys.modules.values()):
            if getattr(m, "__name__", "").startswith("lkr.") and hasattr(m, "get_auth"):
                setattr(m, "get_auth", mod_auth.get_auth)
    if mod_auth_cli := sys.modules.get("lkr.auth.main"):
        _patch_auth_cli(mod_auth_cli)
    if mod_cm := sys.modules.get("lkr.codemode.main"):
        _patch_codemode(mod_cm)
    if mod_lk := sys.modules.get("lkr.tools.lookml"):
        _patch_lookml(mod_lk)

_orig_import = builtins.__import__
def _bridged_import(name, globals=None, locals=None, fromlist=(), level=0):
    res = _orig_import(name, globals, locals, fromlist, level)
    if name == "lkr" or name.startswith("lkr."):
        _apply_lkr_patches()
    return res

builtins.__import__ = _bridged_import
try:
    import lkr.auth_service  # noqa: F401
    import lkr.auth.main  # noqa: F401
    import lkr.codemode.main  # noqa: F401
    import lkr.tools.lookml  # noqa: F401
    _apply_lkr_patches()
except Exception:
    pass
`

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
LKR_DEV_CLI_VERSION = os.environ.get(
    "LKR_DEV_CLI_VERSION",
    "0.0.67" if _PINNED_CLI_VERSION.startswith("$") else _PINNED_CLI_VERSION,
)
REQUIRED_SKILLS = (
    "agentic-lookml-workflow",
    "agentic-lookml",
    "generate-view-from-table",
    "lookml-field-curation",
    "lookml",
    "looker-filters",
    "looker-expressions",
)

def ensure_skills() -> list[str]:
    SKILLS_ROOT.mkdir(parents=True, exist_ok=True)
    for src_root in (Path(os.environ.get("LKR_CLI_SKILLS_DIR") or "/nonexistent"), SKILLS_ALIAS):
        if src_root.is_dir() and not src_root.is_symlink():
            for s in src_root.iterdir():
                if s.is_dir():
                    shutil.copytree(s, SKILLS_ROOT / s.name, dirs_exist_ok=True)
    if not SKILLS_ALIAS.exists():
        try:
            SKILLS_ALIAS.symlink_to(SKILLS_ROOT)
        except Exception:
            pass
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
    return "".join(
        difflib.unified_diff(
            old_text.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile=f"a/{rel_path}",
            tofile=f"b/{rel_path}",
            n=3,
        )
    )

def collect_dir_diffs(lookml_dir: Path, baseline_dir: Path) -> list[dict]:
    cur = (
        {str(p.relative_to(lookml_dir)): p.read_text("utf-8") for p in lookml_dir.rglob("*.lkml") if p.is_file()}
        if lookml_dir.is_dir()
        else {}
    )
    base = (
        {str(p.relative_to(baseline_dir)): p.read_text("utf-8") for p in baseline_dir.rglob("*.lkml") if p.is_file()}
        if baseline_dir.is_dir()
        else {}
    )
    changes = []
    for rel in sorted(set(cur) | set(base)):
        old_t, new_t = base.get(rel, ""), cur.get(rel, "")
        if old_t == new_t and (rel in cur) == (rel in base):
            continue
        action = "created" if rel not in base else ("deleted" if rel not in cur else "updated")
        changes.append({"path": rel, "action": action, "content": new_t, **({"diff": compute_diff(old_t, new_t, rel)} if old_t else {})})
    return changes

def normalize_queries(raw_queries: list[dict]) -> list[dict]:
    out = []
    for i, q in enumerate(raw_queries or []):
        if not isinstance(q, dict):
            continue
        sql_slug = str(q.get("sql_slug") or q.get("sql_query_id") or "")
        exp_slug = str(q.get("explore_slug") or q.get("query_slug") or q.get("query_id") or "")
        out.append(
            {
                "query_index": q.get("query_index", i),
                "label": q.get("label") or f"Query #{q.get('query_index', i) + 1}",
                "sql_slug": sql_slug,
                "sql_runner_url": q.get("sql_runner_url") or (f"/sql/{sql_slug}" if sql_slug else ""),
                "explore_slug": exp_slug,
                "explore_url": q.get("explore_url") or (f"/x/{exp_slug}" if exp_slug else ""),
                "parity_status": q.get("parity_status") or ("matched" if q.get("passed") else "checked"),
                "mismatches": q.get("mismatches") or [],
            }
        )
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

export const LKR_CLI_BRIDGE_TOOL = {
  type: 'function',
  name: 'lkr_cli_extension_bridge',
  description:
    'Execute a bridged online lkr-dev-cli request (<LKR_EXTENSION_TOOL_REQUEST>, either kind="codemode", kind="sdk_request", or kind="file_ref") against the host Looker Extension SDK and return { ok, cache_key, cache_path, replay_needed, result }. When replay_needed is true, write JSON.stringify(result) to cache_path (/workspace/.lkr_extension_cache/<cache_key>.json) and replay; when replay_needed is false, skip cache_path write and CLI replay.',
  parameters: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['codemode', 'sdk_request', 'file_ref'],
        description: 'Bridge request kind emitted by /workspace/sitecustomize.py.',
      },
      req_path: {
        type: 'string',
        description: 'Sandbox file path (/workspace/.lkr_extension_cache/_req_<key>.json) when kind="file_ref".',
      },
      cache_key: {
        type: 'string',
        description: 'Deterministic SHA-256 cache key for /workspace/.lkr_extension_cache/<cache_key>.json.',
      },
      code: {
        type: 'string',
        description: 'Python code to execute in LkrCodeMode when kind="codemode".',
      },
      vars: {
        type: 'object',
        description: 'Injected top-level variables (-v key=value) when kind="codemode".',
      },
      dev_mode: {
        type: 'boolean',
        description: 'Whether to run in Looker development workspace ("dev").',
      },
      method: {
        type: 'string',
        description: 'HTTP method (GET, POST, PATCH, PUT, DELETE) when kind="sdk_request".',
      },
      path: {
        type: 'string',
        description: 'Looker API 4.0 endpoint path (e.g. "/user", "/projects") when kind="sdk_request".',
      },
      query_params: {
        type: 'object',
        description: 'Optional query parameters when kind="sdk_request".',
      },
      body: {
        type: 'object',
        description: 'Optional request body when kind="sdk_request".',
      },
      thought: {
        type: 'string',
        description:
          'Concise 1-sentence summary of what this bridged lkr-dev-cli call is doing with the Looker API (falls back to "<method> <path>" when omitted).',
      },
    },
    required: ['kind'],
  },
}

// ponytail: 25-line dependency-free SHA-256 so Browser/Webpack and Node/Jest compute identical
// cache_key digests to Python's hashlib.sha256 without Node 'crypto' polyfills.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function sha256Hex(input: string): string {
  const bytes = Array.from(new TextEncoder().encode(input))
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while ((bytes.length % 64) !== 56) bytes.push(0)
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255)
  bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255)
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Int32Array(64)
  const rotr = (n: number, b: number) => (n >>> b) | (n << (32 - b))
  for (let i = 0; i < bytes.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      const k = i + j * 4
      w[j] = (bytes[k] << 24) | (bytes[k + 1] << 16) | (bytes[k + 2] << 8) | bytes[k + 3]
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3)
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10)
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + SHA256_K[j] + w[j]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('')
}

function canonicalJson(val: unknown): string {
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return JSON.stringify(val)
  if (Array.isArray(val)) return `[${val.map(canonicalJson).join(',')}]`
  if (typeof val === 'object') {
    const rec = val as Record<string, unknown>
    const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(',')}}`
  }
  return JSON.stringify(String(val))
}

const normalizeLookerBridgePath = normalizeLookerApiPath

function cleanQueryParams(qp?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!qp || typeof qp !== 'object') return null
  const entries = Object.entries(qp).filter(([, v]) => v !== undefined && v !== null)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export function computeLkrExtensionCacheKey(req: LkrExtensionToolRequest): string {
  if (req.kind === 'sdk_request') {
    return sha256Hex(
      canonicalJson({
        kind: 'sdk_request',
        method: String(req.method || 'GET').toUpperCase(),
        path: normalizeLookerBridgePath(req.path),
        query_params: cleanQueryParams(req.query_params),
        body: req.body !== undefined ? req.body : null,
        dev_mode: Boolean(req.dev_mode),
      })
    )
  }
  const rawVars = req.vars && typeof req.vars === 'object' ? req.vars : {}
  const sortedVars = Object.fromEntries(Object.keys(rawVars).sort().map((k) => [k, rawVars[k]]))
  return sha256Hex(
    canonicalJson({
      kind: 'codemode',
      code: String(req.code || '').trim(),
      vars: sortedVars,
      dev_mode: Boolean(req.dev_mode),
    })
  )
}

export interface LkrCliBridgeInteractionLike {
  output_text?: string
  outputs?: Array<{ text?: string; result?: string; output?: string; content?: unknown }>
  steps?: Array<{
    output?: string
    stdout?: string
    stderr?: string
    result?: string
    text?: string
    content?: unknown
    code_execution_result?: { output?: string; stderr?: string; result?: string; content?: unknown }
  }>
}

export function extractLkrExtensionToolRequests(
  interactionOrText: string | LkrCliBridgeInteractionLike | null | undefined
): LkrExtensionToolRequest[] {
  const flattenContent = (val: unknown): Array<string | undefined> =>
    typeof val === 'string'
      ? [val]
      : Array.isArray(val)
      ? val.flatMap((c) => (typeof c === 'string' ? [c] : [(c as { text?: string })?.text]))
      : []
  const texts: string[] =
    typeof interactionOrText === 'string'
      ? [interactionOrText]
      : [
          interactionOrText?.output_text,
          ...(interactionOrText?.outputs || []).flatMap((o) => [
            o?.text,
            o?.result,
            o?.output,
            ...flattenContent(o?.content),
          ]),
          ...(interactionOrText?.steps || []).flatMap((s) => [
            s?.output,
            s?.stdout,
            s?.stderr,
            s?.result,
            s?.text,
            ...flattenContent(s?.content),
            s?.code_execution_result?.output,
            s?.code_execution_result?.stderr,
            s?.code_execution_result?.result,
            ...flattenContent(s?.code_execution_result?.content),
          ]),
        ].filter((x): x is string => typeof x === 'string')

  const combined = texts.join('\n')
  const matches = Array.from(
    combined.matchAll(/<LKR_EXTENSION_TOOL_REQUEST>([\s\S]*?)<\/LKR_EXTENSION_TOOL_REQUEST>/g)
  )
  const seen = new Set<string>()
  const out: LkrExtensionToolRequest[] = []
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (!parsed || (parsed.kind !== 'codemode' && parsed.kind !== 'sdk_request' && parsed.kind !== 'file_ref')) continue
      const thoughtProp =
        typeof parsed.thought === 'string' && parsed.thought.trim() ? { thought: parsed.thought.trim() } : {}
      const normalized: LkrExtensionToolRequest =
        parsed.kind === 'file_ref'
          ? {
              kind: 'file_ref',
              req_path: String(parsed.req_path || '').trim(),
              dev_mode: Boolean(parsed.dev_mode),
              cache_key: String(parsed.cache_key || '').trim() || computeLkrExtensionCacheKey(parsed),
              ...thoughtProp,
            }
          : parsed.kind === 'sdk_request'
          ? {
              kind: 'sdk_request',
              method: String(parsed.method || 'GET').toUpperCase(),
              path: normalizeLookerBridgePath(parsed.path),
              query_params: cleanQueryParams(parsed.query_params),
              body: parsed.body ?? null,
              dev_mode: Boolean(parsed.dev_mode),
              cache_key: parsed.cache_key || computeLkrExtensionCacheKey(parsed),
              ...thoughtProp,
            }
          : {
              kind: 'codemode',
              code: String(parsed.code || '').trim(),
              vars: parsed.vars && typeof parsed.vars === 'object' ? parsed.vars : {},
              dev_mode: Boolean(parsed.dev_mode),
              cache_key: parsed.cache_key || computeLkrExtensionCacheKey(parsed),
              ...thoughtProp,
            }
      const key = normalized.cache_key!
      if (!seen.has(key)) {
        seen.add(key)
        out.push(normalized)
      }
    } catch {
      // Ignore malformed tag JSON
    }
  }
  return out
}

const ROUTE_TRAVERSAL_RE = /(?:^|[\\/]|%(?:25)*(?:2f|5c))(?:\.|%(?:25)*2e){1,2}(?:$|[\\/]|%(?:25)*(?:2f|5c))|\\|%(?:25)*5c|%25(?:25)*(?:2e|2f|5c)/i

function canonicalizeLookerRoute(rawPath?: string): { path: string; hasTraversal: boolean } {
  const stripped = String(rawPath || '')
    .trim()
    .replace(/^https?:\/\/[^/?#]+/i, '')
    .split(/[?#]/)[0]
  if (!stripped) return { path: '/', hasTraversal: false }
  const hasTraversal = ROUTE_TRAVERSAL_RE.test(stripped)
  if (!hasTraversal) {
    const clean = `/${stripped.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/').replace(/^\/api\/[0-9.]+(?=\/|$)/i, '')
    return { path: clean.startsWith('/') ? clean : clean ? `/${clean}` : '/', hasTraversal: false }
  }
  const resolveUrlPath = (s: string): string => {
    const withLead = `/${s.replace(/^\/+/, '')}`
    try {
      return new URL(withLead, 'https://looker.local').pathname
    } catch {
      return withLead
    }
  }
  let unescaped = stripped.replace(/\\/g, '/')
  while (/%25(2e|2f|5c|25)/i.test(unescaped)) {
    unescaped = unescaped.replace(/%25(2e|2f|5c|25)/gi, '%$1')
  }
  // Pass 1 matches WHATWG fetch() (keeping %2f inside segments so /deploy_to_production/a%2f..%2ffiles/.. pops to /deploy_to_production);
  // Pass 2 decodes any remaining %2f so /dashboards%2f..%2fqueries resolves to /queries (still marked hasTraversal: true).
  const pass1 = resolveUrlPath(unescaped.replace(/%(?:2e|5c)/gi, (m) => (m.toLowerCase() === '%2e' ? '.' : '/')))
  const pass2 = resolveUrlPath(pass1.replace(/%2f/gi, '/'))
  const collapsed = pass2.replace(/\/+/g, '/').replace(/^\/api\/[0-9.]+(?=\/|$)/i, '').replace(/\/+$/, '')
  return { path: collapsed ? (collapsed.startsWith('/') ? collapsed : `/${collapsed}`) : '/', hasTraversal: true }
}

export function classifyLookerOperation(
  httpMethod?: string,
  rawPath?: string,
  code?: string
): { operation: string; requiresPermission: boolean } {
  const verb = String(httpMethod || 'GET').toUpperCase()
  const { path: p, hasTraversal } = canonicalizeLookerRoute(rawPath)
  const readOnlyPost =
    verb === 'POST' &&
    !hasTraversal &&
    (/^\/(queries|sql_queries|merge_queries)(\/|$)/.test(p) ||
      /^\/content_validation\/?$/.test(p) ||
      /^\/projects\/[^/]+\/(validate|lookml_tests\/run|git_connection_tests)\/?$/.test(p) ||
      /^\/(?:internal\/)?kda\/analyze\/?$/.test(p))
  if (
    verb === 'GET' ||
    verb === 'HEAD' ||
    verb === 'OPTIONS' ||
    readOnlyPost ||
    (verb === 'PATCH' && !hasTraversal && /^\/session\/?$/.test(p))
  ) {
    return { operation: `read_${p.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '_')}`, requiresPermission: false }
  }
  const prefix = verb === 'POST' ? 'create' : verb === 'DELETE' ? 'delete' : 'update'
  if (rawPath && p !== '/') {
    const pm = p.match(
      /^\/projects\/[^/]+\/(deploy_ref_to_production|deploy_to_production|reset_to_production|reset_to_remote|developer_copy|git\/deploy_key|(?:git\/)?commit|generate_lookml[^/]*|git_branch|files|directories)(\/|$)/
    )
    if (pm) {
      const projOpMap: Record<string, string> = {
        deploy_ref_to_production: 'deploy_ref_to_production',
        deploy_to_production: 'deploy_to_production',
        reset_to_production: 'reset_project_to_production',
        reset_to_remote: 'reset_project_to_remote',
        developer_copy: 'create_developer_copy',
        'git/deploy_key': 'create_git_deploy_key',
        commit: 'commit',
        'git/commit': 'commit',
        git_branch: `${prefix}_git_branch`,
        files: `${prefix}_file`,
        directories: `${prefix}_project_directory`,
      }
      return { operation: projOpMap[pm[1]] || 'generate_lookml_with_new_files', requiresPermission: true }
    }
    const dm = p.match(/^\/dashboards\/[^/]+\/(import|sync)(\/|$)/)
    if (dm) return { operation: `${dm[1]}_lookml_dashboard`, requiresPermission: true }
    if (/^\/data_app_extension(\/|$)/.test(p)) return { operation: 'publish_data_app_extension', requiresPermission: true }
    const seg = p.split('/').filter(Boolean)[0] || 'resource'
    return { operation: `${prefix}_${seg.replace(/ies$/, 'y').replace(/([^s])s$/, '$1')}`, requiresPermission: true }
  }
  const callMatches = String(code || '').match(/\b([a-z_][a-z0-9_]*)\s*\(/g) || []
  for (const match of callMatches) {
    const fn = match.replace(/\s*\($/, '')
    if (/^(create|update|delete|deploy|commit|publish|unpublish|repair)_/.test(fn) || fn === 'commit') {
      return { operation: fn, requiresPermission: true }
    }
  }
  return { operation: `${prefix}_resource`, requiresPermission: true }
}

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
