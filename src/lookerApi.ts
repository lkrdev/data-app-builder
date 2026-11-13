import { ChattyClient } from '@looker/chatty/lib/client'
import type { ExtensionSDK } from '@looker/extension-sdk'
import type {
  IFolder,
  ILookmlModelNavExplore,
  IRole,
  IUser,
  Looker40SDK,
} from '@looker/sdk'
import useSWR, { mutate, SWRConfig, unstable_serialize } from 'swr'

import { fetchLookerCaAgentsCatalog } from './conversationalAnalytics'
import { loadSingleConversationArtifact, type UserConversationEntry } from './lookerArtifacts'
import { classifyLooker404Error, resolveUserCapabilities } from './lookerPermissions'

export * from './lookerPermissions'
export * from './dataAppPublisher'
export * from './lookerArtifacts'
export * from './conversationalAnalytics'
export { LOOKER_ALERTS_SKILL_MD, LOOKER_DASHBOARD_SKILL_MD, LOOKER_FIELD_PROFILER_SKILL_MD } from './antigravityPrompts'
export { DEFAULT_MAX_TOOL_ROUNDS, normalizeMaxToolRounds, STUDIO_MAX_TOOL_ROUNDS_OPTIONS } from './antigravityTypes'

export const STUDIO_OVERVIEW_TAB_KEY = '__overview__'

export function formatExploreId(modelName: string, exploreName: string): string {
  return `${modelName.trim()}::${exploreName.trim()}`
}

export function copyTextWithExtensionSdk(
  text: string,
  extensionSDK?: Partial<Pick<ExtensionSDK, 'clipboardWrite'>> | null
): Promise<boolean> {
  const raw = String(text ?? '')
  if (!raw) return Promise.resolve(false)
  const fallback = () =>
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
      ? navigator.clipboard.writeText(raw).then(() => true, () => false)
      : Promise.resolve(false)
  return typeof extensionSDK?.clipboardWrite === 'function'
    ? Promise.resolve(extensionSDK.clipboardWrite(raw)).then(() => true, fallback)
    : fallback()
}

export function parseExploreId(
  exploreId: string
): { modelName: string; exploreName: string } | null {
  const idx = exploreId.indexOf('::')
  if (idx <= 0 || idx >= exploreId.length - 2) return null
  return {
    modelName: exploreId.slice(0, idx).trim(),
    exploreName: exploreId.slice(idx + 2).trim(),
  }
}

export function extractExploreIdsFromCode(code: string): string[] {
  const found = new Set<string>()
  const classModel = code.match(/this\.lookerModel\s*=\s*['"]([^'"]+)['"]/)?.[1]
  const classExplore = code.match(/this\.explore\s*=\s*['"]([^'"]+)['"]/)?.[1]
  if (classModel && classExplore) {
    found.add(formatExploreId(classModel, classExplore))
  }
  const widgetRegex = /looker-model=['"]([^'"]+)['"][^>]*?\bexplore=['"]([^'"]+)['"]/g
  for (const m of code.matchAll(widgetRegex)) {
    if (m[1] && m[2]) found.add(formatExploreId(m[1], m[2]))
  }
  return Array.from(found)
}

const inFlightMetadataRequests = new Map<string, Promise<unknown>>()
const recentMetadataCache = new Map<string, { expiresAt: number; value: unknown }>()
export const LOOKER_METADATA_CACHE_TTL_MS = 15_000
export const LOOKER_SWR_CONFIG = {
  revalidateOnFocus: false,
  dedupingInterval: LOOKER_METADATA_CACHE_TTL_MS,
}

interface SwrConfigDefaultWithCache {
  default?: {
    cache?: {
      set?: (key: string, value: unknown) => void
      clear?: () => void
    }
  }
}

function syncSwrKey(swrKey: unknown, val: unknown): void {
  if (!swrKey) return
  try {
    ;(SWRConfig as unknown as SwrConfigDefaultWithCache).default?.cache?.set?.(
      unstable_serialize(swrKey as never),
      val
    )
  } catch {
    // ignore SWR cache sync error
  }
  void mutate(swrKey as never, val, false).catch(() => {})
}

export function clearLookerMetadataCache(): void {
  inFlightMetadataRequests.clear()
  recentMetadataCache.clear()
  try {
    const cache = (SWRConfig as unknown as SwrConfigDefaultWithCache).default?.cache
    if (cache && typeof cache.clear === 'function') cache.clear()
  } catch {
    // ignore SWR cache clear error
  }
}

export const clearLookerMetadataRequestCache = clearLookerMetadataCache

// ponytail: coalesce concurrent in-flight + short-TTL Looker metadata/explore GET requests across
// simultaneous conversations so concurrent turns never fire duplicate HTTP calls for the same schema.
export async function coalesceLookerMetadataRequest<T>(
  cacheKey: string,
  fn: () => Promise<T>,
  ttlMs = LOOKER_METADATA_CACHE_TTL_MS,
  swrKey?: unknown
): Promise<T> {
  const now = Date.now()
  const hit = recentMetadataCache.get(cacheKey)
  if (hit && now < hit.expiresAt) return hit.value as T
  const inFlight = inFlightMetadataRequests.get(cacheKey)
  if (inFlight) return inFlight as Promise<T>
  const p = (async () => {
    try {
      const val = await fn()
      if (ttlMs > 0) recentMetadataCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value: val })
      syncSwrKey(swrKey || cacheKey, val)
      return val
    } finally {
      inFlightMetadataRequests.delete(cacheKey)
    }
  })()
  inFlightMetadataRequests.set(cacheKey, p)
  return p
}

export interface RawLookerTransportResponse {
  ok?: boolean
  statusCode?: number
  status?: number
  body?: unknown
}

export type LookerRawRequestFn = (
  method: string,
  path: string,
  queryParams?: Record<string, unknown>,
  body?: unknown,
  ...rest: unknown[]
) => Promise<RawLookerTransportResponse>

export const SWR_DEDUPED_METHODS = [
  'lookml_model_explore',
  'all_lookml_models',
  'content_summary',
  'search_content',
  'me',
  'session',
  'all_folders',
  'folder',
  'folder_children',
  'folder_ancestors',
  'search_folders',
] as const

const serializeLookerBody = (body: unknown): unknown =>
  body !== undefined && body !== null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined

function parseJsonString(val: unknown, allowNumbers: boolean): unknown {
  if (typeof val !== 'string') return val
  const t = val.trim()
  const c = t[0]
  if (
    c === '{' ||
    c === '[' ||
    (c === '"' && t[t.length - 1] === '"') ||
    t === 'true' ||
    t === 'false' ||
    t === 'null' ||
    (allowNumbers && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(t))
  ) {
    try { return JSON.parse(t) } catch { return val }
  }
  return val
}

function parseLookerRawBody<T = unknown>(rawResp: RawLookerTransportResponse): T {
  const val = rawResp && rawResp.body !== undefined ? rawResp.body : rawResp
  const c = typeof val === 'string' ? val.trim()[0] : ''
  return (c === '{' || c === '[' ? parseJsonString(val, false) : val) as T
}

export interface LkrCodeModeApiCallEntry {
  method: string
  route: string
  query_params: Record<string, unknown>
  body: unknown
  response: {
    ok: boolean
    status: number | null
    body: unknown
  }
  timestamp: string
  duration_ms: number
}

export interface BuildCodeModeApiCallEntryInput {
  requestType?: 'RAW_INVOKE_CORE_SDK' | 'INVOKE_CORE_SDK'
  httpMethod?: unknown
  method?: unknown
  path?: unknown
  params?: unknown
  body?: unknown
  rawResp?: unknown
  error?: unknown
  timestamp?: string
  durationMs?: number
}

function parseJsonIfPossible(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return null
  if (val instanceof Error) return val.message ? parseJsonString(val.message, false) : null
  return parseJsonString(val, true)
}

export function buildCodeModeApiCallEntry(input: BuildCodeModeApiCallEntryInput): LkrCodeModeApiCallEntry {
  const rawPath = String(input.path || '')
  const qIdx = rawPath.indexOf('?')
  const queryParams: Record<string, unknown> = {}
  const addQs = (qs: string) => {
    if (qs && typeof URLSearchParams !== 'undefined') {
      new URLSearchParams(qs).forEach((v, k) => { queryParams[k] = parseJsonString(v, false) })
    }
  }
  if (qIdx >= 0) addQs(rawPath.slice(qIdx + 1))
  let extra: unknown = input.params
  if (typeof extra === 'string') {
    const pt = extra.trim()
    if (pt[0] === '{') {
      try { extra = JSON.parse(pt) } catch { extra = null }
    } else {
      addQs(pt)
      extra = null
    }
  }
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    const rec = extra as Record<string, unknown>
    Object.keys(rec).forEach((k) => { if (rec[k] !== undefined) queryParams[k] = parseJsonString(rec[k], false) })
  }
  const r = input.rawResp && typeof input.rawResp === 'object' ? (input.rawResp as Record<string, unknown>) : null
  let response: LkrCodeModeApiCallEntry['response']
  if ('error' in input && input.error !== undefined) {
    response = { ok: false, status: null, body: parseJsonIfPossible(input.error) }
  } else if (input.requestType === 'INVOKE_CORE_SDK') {
    const ok = Boolean(r && r.ok)
    const e = r && r.error && typeof r.error === 'object' ? (r.error as Record<string, unknown>) : null
    const s = Number(e ? (e.statusCode != null ? e.statusCode : e.status) : NaN)
    response = { ok, status: ok ? 200 : Number.isFinite(s) && s > 0 ? s : 500, body: parseJsonIfPossible(r ? (ok ? r.value : r.error) : null) }
  } else {
    const rc = r ? (r.statusCode != null ? r.statusCode : r.status) : undefined
    const rs = Number(rc != null ? rc : 200)
    const status = Number.isFinite(rs) ? rs : 200
    response = { ok: (!r || r.ok !== false) && status >= 200 && status < 400, status, body: parseJsonIfPossible(r && r.body !== undefined ? r.body : input.rawResp) }
  }
  return {
    method: String(input.httpMethod || input.method || 'GET').toUpperCase(),
    route: qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath,
    query_params: queryParams,
    body: parseJsonIfPossible(input.body),
    response,
    timestamp: input.timestamp || new Date().toISOString(),
    duration_ms: Math.max(0, Math.round(Number(input.durationMs || 0))),
  }
}

function getCodeModeApiCallsStore(): LkrCodeModeApiCallEntry[] {
  const g = globalThis as { lkr_codemode_api_calls?: LkrCodeModeApiCallEntry[] }
  if (!Array.isArray(g.lkr_codemode_api_calls)) g.lkr_codemode_api_calls = []
  return g.lkr_codemode_api_calls
}

function traceCodeModeCall<T>(
  base: BuildCodeModeApiCallEntryInput,
  exec: () => Promise<T>,
  unwrap?: (val: T) => unknown
): Promise<T> {
  const startedAt = Date.now()
  const timestamp = new Date(startedAt).toISOString()
  const push = (extra: BuildCodeModeApiCallEntryInput) =>
    getCodeModeApiCallsStore().push(buildCodeModeApiCallEntry(Object.assign({ timestamp, durationMs: Date.now() - startedAt }, base, extra)))
  return Promise.resolve().then(exec).then(
    (res) => (push({ rawResp: unwrap ? unwrap(res) : res }), res),
    (err: unknown) => { push({ error: err }); throw err }
  )
}

const hookedChattyHosts = new WeakSet<object>()
const loggedRawRequestFns = new WeakSet<LookerRawRequestFn>()
let chattyConnectPatched = false

export function isTransportChattyHooked(transport: unknown): boolean {
  let cur = transport as Record<string, unknown> | null | undefined
  for (let i = 0; cur && typeof cur === 'object' && i < 4; i += 1) {
    if (cur.chattyHost && typeof cur.chattyHost === 'object' && hookedChattyHosts.has(cur.chattyHost as object)) return true
    cur = (cur.hostConnection || cur.extensionHost) as Record<string, unknown> | undefined
  }
  return false
}

export function hookChattyHostApiLogger(hostOrExtensionSdk: unknown): void {
  if (!hostOrExtensionSdk || typeof hostOrExtensionSdk !== 'object') return
  const hostObj = (hostOrExtensionSdk as { chattyHost?: unknown }).chattyHost
  const candidate = hostObj !== undefined ? hostObj : hostOrExtensionSdk
  if (!candidate || typeof candidate !== 'object') return
  const host = candidate as { sendAndReceive?: (...args: unknown[]) => Promise<unknown> }
  if (typeof host.sendAndReceive !== 'function' || hookedChattyHosts.has(host)) return
  hookedChattyHosts.add(host)
  const orig = host.sendAndReceive
  host.sendAndReceive = function (this: unknown, eventName: unknown, rawMsg?: unknown): Promise<unknown> {
    // eslint-disable-next-line prefer-rest-params
    const callArgs = arguments as unknown as unknown[]
    const reqMsg = rawMsg && typeof rawMsg === 'object' ? (rawMsg as { type?: unknown; payload?: Record<string, unknown> }) : null
    const reqType = reqMsg ? reqMsg.type : undefined
    if (eventName !== 'EXTENSION_API_REQUEST' || (reqType !== 'RAW_INVOKE_CORE_SDK' && reqType !== 'INVOKE_CORE_SDK')) {
      return orig.apply(this, callArgs)
    }
    const p = (reqMsg && reqMsg.payload) || {}
    return traceCodeModeCall(
      { requestType: reqType, httpMethod: p.httpMethod, path: p.path, params: p.params, body: p.body },
      () => orig.apply(this, callArgs),
      (values) => {
        const v0 = Array.isArray(values) && values.length === 1 ? values[0] : null
        return v0 && typeof v0 === 'object' && ['ok', 'statusCode', 'status', 'body', 'value', 'error'].some((k) => k in v0) ? v0 : values
      }
    )
  }
}

export function installChattyApiLogger(): void {
  if (typeof window === 'undefined') return
  getCodeModeApiCallsStore()
  if (chattyConnectPatched) return
  const proto = ChattyClient && (ChattyClient.prototype as { connect?: (...args: unknown[]) => Promise<unknown> } | undefined)
  if (!proto || typeof proto.connect !== 'function') return
  chattyConnectPatched = true
  const origConnect = proto.connect
  proto.connect = function (this: unknown): Promise<unknown> {
    // eslint-disable-next-line prefer-rest-params
    return origConnect.apply(this, arguments as unknown as unknown[]).then((conn) => (hookChattyHostApiLogger(conn), conn))
  }
}

function invokeAndLogRawTransport(
  rawTransport: unknown,
  origRawReq: LookerRawRequestFn,
  callArgs: ArrayLike<unknown>
): Promise<RawLookerTransportResponse> {
  const run = () => origRawReq.apply(rawTransport, callArgs as unknown as Parameters<LookerRawRequestFn>)
  return loggedRawRequestFns.has(origRawReq) || isTransportChattyHooked(rawTransport)
    ? Promise.resolve(run())
    : traceCodeModeCall({ httpMethod: callArgs[0], path: callArgs[1], params: callArgs[2], body: callArgs[3] }, run)
}

export function createDeduplicatedLookerSdkProxy(
  sdk: Looker40SDK,
  onRawRequest?: (
    res: RawLookerTransportResponse | undefined,
    elapsedMs: number,
    err?: unknown,
    reqMeta?: { method: string; path: string }
  ) => void
): Looker40SDK {
  if (!sdk || typeof sdk !== 'object') return sdk
  const sdkRec = sdk as unknown as Record<string, unknown> & {
    __rawSdk?: Looker40SDK
    authSession?: { transport?: { rawRequest?: LookerRawRequestFn; [key: string]: unknown }; [key: string]: unknown }
  }
  const rawTransport = sdkRec.authSession && sdkRec.authSession.transport
  const origRawReq = rawTransport && rawTransport.rawRequest
  const wrappedsdk: Record<string, unknown> = Object.create(sdk)
  wrappedsdk.__rawSdk = sdkRec.__rawSdk || sdk
  for (const method of SWR_DEDUPED_METHODS) {
    const fn = sdkRec[method]
    if (typeof fn === 'function') {
      const origFn = (fn as (...args: unknown[]) => unknown).bind(wrappedsdk)
      wrappedsdk[method] = function () {
        // eslint-disable-next-line prefer-rest-params
        const args = Array.from(arguments)
        return coalesceLookerMetadataRequest(`sdk:${method}:${JSON.stringify(args)}`, () => Promise.resolve(origFn.apply(wrappedsdk, args)))
      }
    }
  }
  if (typeof origRawReq === 'function') {
    const wrappedRawRequest: LookerRawRequestFn = function (method, path, queryParams) {
      // eslint-disable-next-line prefer-rest-params
      const callArgs = arguments
      const reqStart = Date.now()
      const meta = { method: String(method || 'GET').toUpperCase(), path: String(path || '') }
      const isMetaGet =
        !loggedRawRequestFns.has(origRawReq) &&
        meta.method === 'GET' &&
        /\/(?:lookml_models|connections|content_search|content_summary|global_search_v2|user|folders|session)(?:\/|$|\?)/i.test(meta.path)
      const execRaw = () => invokeAndLogRawTransport(rawTransport, origRawReq, callArgs)
      const p = isMetaGet
        ? coalesceLookerMetadataRequest(`raw:GET:${path}:${JSON.stringify(queryParams || {})}`, execRaw)
        : execRaw()
      return p.then(
        (res) => (onRawRequest && onRawRequest(res, Date.now() - reqStart, undefined, meta), res),
        (err: unknown) => { if (onRawRequest) onRawRequest(undefined, Date.now() - reqStart, err, meta); throw err }
      )
    }
    loggedRawRequestFns.add(wrappedRawRequest)
    wrappedsdk.authSession = Object.assign({}, sdkRec.authSession, {
      transport: Object.assign({}, rawTransport, {
        rawRequest: wrappedRawRequest,
        request: function (method: string, path: string, queryParams?: Record<string, unknown>, body?: unknown, extraA?: unknown, extraB?: unknown) {
          return wrappedRawRequest(method, path, queryParams, serializeLookerBody(body), extraA, extraB).then((rawResp) => {
            const code = rawResp && (rawResp.statusCode !== undefined ? rawResp.statusCode : rawResp.status)
            const status = Number(code !== undefined ? code : 200)
            if ((rawResp && rawResp.ok === false) || status >= 400) {
              const b = rawResp ? rawResp.body : undefined
              const errText = typeof b === 'string' ? b : JSON.stringify(b !== undefined ? b : rawResp)
              return { ok: false, error: new Error(`Looker ${method} ${path} failed (${status}): ${errText}`) }
            }
            return { ok: true, value: parseLookerRawBody(rawResp) }
          })
        },
      }),
    })
  }
  return wrappedsdk as unknown as Looker40SDK
}

export interface LookerExtensionSdkLike {
  invokeCoreSdkRaw?: (m: string, p: string, q?: unknown, b?: unknown, apiVersion?: string) => Promise<unknown>
  invokeCoreSdk?: (m: string, p: string, q?: unknown, b?: unknown, authenticator?: unknown, o?: unknown, apiVersion?: string) => Promise<unknown>
}

export const isLookerExtensionSdk = (v: unknown): v is LookerExtensionSdkLike =>
  Boolean(
    v &&
      typeof v === 'object' &&
      (typeof (v as LookerExtensionSdkLike).invokeCoreSdkRaw === 'function' || typeof (v as LookerExtensionSdkLike).invokeCoreSdk === 'function')
  )

export function normalizeLookerApiPath(rawPath?: string): string {
  const raw = String(rawPath || '/').trim().split('#')[0].replace(/^https?:\/\/[^/?#]+/i, '')
  const qIdx = raw.indexOf('?')
  const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw
  const queryPart = qIdx >= 0 ? raw.slice(qIdx) : ''
  const withSlash = (pathPart.startsWith('/') ? pathPart : `/${pathPart}`).replace(/\/{2,}/g, '/')
  return (withSlash.replace(/^\/api\/[0-9.]+(?=\/|$)/i, '') || '/') + queryPart
}

export function resolveLookerExtensionSdk(sdk?: unknown, ...candidates: unknown[]): LookerExtensionSdkLike | undefined {
  const transportRec = (sdk as { authSession?: { transport?: Record<string, unknown> } } | undefined)?.authSession?.transport
  const gRec = globalThis as Record<string, unknown>
  return [
    ...candidates,
    transportRec?.extensionHost,
    (transportRec?.hostConnection as Record<string, unknown> | undefined)?.hostConnection,
    transportRec?.hostConnection,
    gRec.__LKR_EXTENSION_SDK__,
    gRec.extensionSDK,
    gRec.lookerExtensionSDK,
  ].find(isLookerExtensionSdk)
}

export function unwrapLookerRawResponse<T = unknown>(raw: unknown, method: string, path: string): T {
  if (!raw || typeof raw !== 'object') return (raw ?? null) as T
  const r = raw as RawLookerTransportResponse
  const status = Number(r.statusCode ?? r.status ?? 200)
  if (r.ok === false || (Number.isFinite(status) && status >= 400)) {
    const errBody = typeof r.body === 'string' ? r.body : JSON.stringify(r.body !== undefined ? r.body : raw)
    if (status === 404) {
      const diag = classifyLooker404Error(404, path, errBody)
      throw new Error(`Looker ${method} ${path} failed (404 ${diag.kind}): ${diag.remediation} — ${errBody}`)
    }
    throw new Error(`Looker ${method} ${path} failed (${status}): ${errBody}`)
  }
  return parseLookerRawBody<T>(r)
}

export function invokeLookerExtensionSdk<T = unknown>(
  extSdk: LookerExtensionSdkLike,
  method: string,
  path: string,
  queryParams?: unknown,
  body?: unknown,
  options?: unknown
): Promise<T> {
  hookChattyHostApiLogger(extSdk)
  const verb = String(method || 'GET').toUpperCase()
  const cleanP = normalizeLookerApiPath(path)
  if (typeof extSdk.invokeCoreSdkRaw === 'function') {
    return Promise.resolve(extSdk.invokeCoreSdkRaw(verb, cleanP, queryParams || undefined, body, '4.0')).then((raw) =>
      unwrapLookerRawResponse<T>(raw, verb, path)
    )
  }
  return Promise.resolve(extSdk.invokeCoreSdk!(verb, cleanP, queryParams || undefined, body, undefined, options, '4.0')).then((res) => {
    if (res && typeof res === 'object' && 'ok' in res && ('value' in res || 'error' in res)) {
      const env = res as { ok?: boolean; value?: unknown; error?: unknown }
      if (env.ok === false) {
        const e = env.error as { message?: unknown } | undefined
        throw new Error(typeof e?.message === 'string' ? e.message : JSON.stringify(env.error))
      }
      return env.value as T
    }
    return res as T
  })
}

// ponytail: use SDK's underlying transport.rawRequest (requires raw_api_request: yes in manifest.lkml)
// or fall back to ExtensionSDK.invokeCoreSdkRaw / invokeCoreSdk instead of custom SDK bindings.
export function rawLookerRequest<T = unknown>(
  sdk: Looker40SDK,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  queryParams?: Record<string, unknown>,
  body?: unknown
): Promise<T> {
  return Promise.resolve().then(() => {
    const transport = (sdk?.authSession as unknown as { transport?: { rawRequest?: LookerRawRequestFn } } | undefined)?.transport
    const safePath =
      /^(?:https?:)?\/\//i.test(path) || path.includes('#')
        ? path.trim().split('#')[0].replace(/^https?:\/\/[^/?#]+/i, '').replace(/^\/{2,}/, '/') || '/'
        : path
    if (typeof transport?.rawRequest === 'function') {
      return invokeAndLogRawTransport(transport, transport.rawRequest, [method, safePath, queryParams, serializeLookerBody(body)]).then((rawResp) =>
        unwrapLookerRawResponse<T>(rawResp, method, safePath)
      )
    }
    const extSdk = resolveLookerExtensionSdk(sdk)
    if (extSdk) return invokeLookerExtensionSdk<T>(extSdk, method, path, queryParams, body)
    throw new Error(`Looker SDK transport is not configured for ${method} ${path}`)
  })
}

export const rawCoreSdkRequest = rawLookerRequest

export interface AccessibleLookerConnection {
  name: string
  dialect_name?: string
  database?: string
  schema?: string
  models?: string[]
  source: 'connections' | 'lookml_models'
}

let nextConnectionSdkCacheId = 1
const connectionSdkCacheIds = new WeakMap<object, number>()
const getConnectionSdkCacheId = (sdk: object): number => {
  const raw = ((sdk as { __rawSdk?: object }).__rawSdk || sdk) as object
  let id = connectionSdkCacheIds.get(raw)
  if (!id) connectionSdkCacheIds.set(raw, (id = nextConnectionSdkCacheId++))
  return id
}

// ponytail: pre-fetch accessible Looker DB connections client-side (<100ms, cached in memory/SWR)
// with non-admin fallback to /lookml_models so Turn-1 project intake needs 0 tool calls.
export async function discoverAccessibleConnections(
  sdk?: Partial<Looker40SDK> | null
): Promise<AccessibleLookerConnection[]> {
  if (!sdk || typeof sdk !== 'object') return []
  const sdkId = getConnectionSdkCacheId(sdk)
  return coalesceLookerMetadataRequest(
    `accessible_connections:${sdkId}`,
    async () => {
      const hasRaw = typeof (sdk as { authSession?: { transport?: { rawRequest?: unknown } } })?.authSession?.transport?.rawRequest === 'function'
      const sdkRec = sdk as unknown as {
        ok?: <T>(p: Promise<T> | T) => Promise<T>
        all_connections?: (params?: Record<string, unknown>) => Promise<unknown>
        all_lookml_models?: (params?: Record<string, unknown>) => Promise<unknown>
      }
      const fetchList = async (path: string, fn: ((p: Record<string, unknown>) => Promise<unknown>) | undefined, fields: string) => {
        const res = hasRaw
          ? await rawCoreSdkRequest<Array<Record<string, unknown>>>(sdk as Looker40SDK, 'GET', path, { fields })
          : typeof fn === 'function'
          ? await (typeof sdkRec.ok === 'function' ? sdkRec.ok(Promise.resolve(fn({ fields }))) : fn({ fields }))
          : []
        return Array.isArray(res) ? (res as Array<Record<string, unknown>>) : []
      }
      try {
        const items: AccessibleLookerConnection[] = (await fetchList('/connections', sdkRec.all_connections, 'name,dialect_name,database,schema'))
          .filter((c) => typeof c?.name === 'string' && c.name.trim())
          .map((c) => {
            const d = String(c.dialect_name || '').trim(), db = String(c.database || '').trim(), s = String(c.schema || '').trim()
            return Object.assign({ name: String(c.name).trim(), source: 'connections' as const }, d ? { dialect_name: d } : null, db ? { database: db } : null, s ? { schema: s } : null)
          })
        if (items.length > 0) return items
      } catch { /* non-admin 403/404 -> fallback to /lookml_models */ }
      try {
        const byConn = new Map<string, Set<string>>()
        for (const m of await fetchList('/lookml_models', sdkRec.all_lookml_models, 'name,project_name,allowed_db_connection_names')) {
          const label = String(m?.project_name || m?.name || '').trim()
          for (const c of Array.isArray(m?.allowed_db_connection_names) ? m.allowed_db_connection_names : []) {
            const cname = String(c || '').trim()
            if (cname) { if (!byConn.has(cname)) byConn.set(cname, new Set()); if (label) byConn.get(cname)!.add(label) }
          }
        }
        return Array.from(byConn.entries()).map(([name, p]) => Object.assign({ name, source: 'lookml_models' as const }, p.size ? { models: Array.from(p) } : null))
      } catch { return [] }
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:accessible_connections', sdkId]
  )
}

export function formatAccessibleConnectionsMarkdown(connections: ReadonlyArray<AccessibleLookerConnection>): string {
  if (!Array.isArray(connections) || connections.length === 0) {
    return '### Available Looker Connections\n- No database connections found for your Looker role.'
  }
  const lines = connections.map((c) => {
    const detail = c.source === 'lookml_models' ? (c.models?.length ? `models/projects: ${c.models.join(', ')}` : '') : [c.dialect_name, c.database, c.schema].filter(Boolean).join(' · ')
    return `- \`${c.name}\`${detail ? ` (${detail})` : ''}`
  })
  return `### Available Looker Connections\n${lines.join('\n')}`
}

export interface LookerFolderNode {
  id: string
  name: string
  parent_id?: string | null
  child_count?: number
  is_personal?: boolean
  is_personal_descendant?: boolean
  creator_id?: string | null
  has_children?: boolean
  can?: Record<string, boolean>
}

export interface SearchLookerFoldersParams {
  name?: string
  parent_id?: string
  is_personal?: boolean | string
  is_personal_descendant?: boolean | string
  creator_id?: string
  id?: string
  fields?: string
  knownFolders?: LookerFolderNode[] | Record<string, LookerFolderNode>
  knownUsers?: Array<{ id: string; display_name?: string | null; email?: string | null }>
}

export const LOOKER_FOLDER_FIELDS =
  'id,name,parent_id,child_count,is_personal,is_personal_descendant,creator_id,can'

export type RawLookerFolderLike = Partial<IFolder> & {
  has_children?: boolean
}

export function normalizeLookerFolderNode(
  raw: RawLookerFolderLike | null | undefined,
  fallbackParentId?: string | null,
  allFoldersList?: RawLookerFolderLike[]
): LookerFolderNode {
  const fid = String(raw?.id ?? '')
  const countedChildren = Array.isArray(allFoldersList)
    ? allFoldersList.filter((c) => String(c?.parent_id ?? '') === fid).length
    : undefined
  const childCount =
    typeof raw?.child_count === 'number'
      ? Math.max(raw.child_count, countedChildren ?? 0)
      : countedChildren
  const parentId =
    raw?.parent_id !== undefined && raw?.parent_id !== null && raw?.parent_id !== ''
      ? String(raw.parent_id)
      : fallbackParentId ?? null
  return Object.assign(
    {
      id: fid,
      name: String(raw?.name || `Folder #${fid}`),
      parent_id: parentId,
      is_personal: Boolean(raw?.is_personal),
      is_personal_descendant: Boolean(raw?.is_personal_descendant),
      has_children:
        typeof raw?.has_children === 'boolean'
          ? raw.has_children
          : childCount === undefined
          ? true
          : childCount > 0,
    },
    childCount !== undefined ? { child_count: childCount } : null,
    raw?.creator_id != null ? { creator_id: String(raw.creator_id) } : null,
    raw?.can ? { can: raw.can } : null
  )
}

export function buildRootLookerFolders(user?: Partial<IUser> | null): LookerFolderNode[] {
  const canEdit = { show: true, edit_content: true, save_content: true }
  const candidates: LookerFolderNode[] = [
    { id: String(user?.personal_folder_id || '5'), name: 'My folder', parent_id: null, is_personal: true, has_children: true, can: canEdit },
    { id: String(user?.home_folder_id || '1'), name: 'Shared folders', parent_id: null, is_personal: false, has_children: true, can: canEdit },
    { id: '2', name: 'People', parent_id: null, is_personal: false, has_children: true },
    { id: '3', name: 'Embed Users', parent_id: null, is_personal: false, has_children: true },
    { id: '4', name: 'Embed Groups', parent_id: null, is_personal: false, has_children: true },
  ]
  return Array.from(new Map(candidates.filter((n) => n.id).map((n) => [n.id, n])).values())
}

interface LookerFolderSdkLike {
  ok?: <T>(p: Promise<T>) => Promise<T>
  get?: unknown
  me?: (fields?: string) => Promise<Partial<IUser>>
  search_users?: (params: Record<string, unknown>) => Promise<Array<Partial<IUser>>>
  folder?: (...args: unknown[]) => Promise<RawLookerFolderLike>
  folder_ancestors?: (...args: unknown[]) => Promise<RawLookerFolderLike[]>
  folder_children?: (params: { folder_id: string; fields: string }) => Promise<RawLookerFolderLike[]>
  all_folders?: (fields: string) => Promise<RawLookerFolderLike[]>
  search_folders?: (req: Record<string, unknown>) => Promise<RawLookerFolderLike[]>
}

async function unwrapSdkCall<T>(sdk: LookerFolderSdkLike, p: Promise<T> | T): Promise<T> {
  const resolved = await p
  if (typeof sdk?.ok === 'function') return sdk.ok(Promise.resolve(resolved))
  return resolved
}

export async function fetchFolderChildren(
  sdk: Looker40SDK,
  folderId: string
): Promise<LookerFolderNode[]> {
  const fid = String(folderId || '').trim()
  if (!fid) return []
  return coalesceLookerMetadataRequest(
    `folder_children:${fid}`,
    async () => {
      const s = sdk as unknown as LookerFolderSdkLike
      if (typeof s?.folder_children === 'function') {
        try {
          const rows = await unwrapSdkCall(
            s,
            s.folder_children({
              folder_id: fid,
              fields: 'id,name,parent_id,child_count,is_personal,can',
            })
          )
          if (Array.isArray(rows)) {
            return rows.map((r) => normalizeLookerFolderNode(r, fid))
          }
        } catch {
          // Fall back to all_folders when folder_children is not entitled or fails
        }
      }
      if (typeof s?.all_folders === 'function') {
        try {
          const all = await unwrapSdkCall(
            s,
            s.all_folders('id,name,parent_id,child_count,is_personal,can')
          )
          const list = Array.isArray(all) ? all : []
          return list
            .filter((r) => String(r?.parent_id ?? '') === fid)
            .map((r) => normalizeLookerFolderNode(r, fid, list))
        } catch {
          // ignore all_folders fallback error
        }
      }
      return []
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:folder_children', fid]
  )
}

async function callFolderIdEndpoint(
  sdk: LookerFolderSdkLike,
  method: 'folder' | 'folder_ancestors',
  folderId: string,
  fields: string
): Promise<unknown> {
  const fn = sdk?.[method]
  if (typeof fn !== 'function') return null
  if (typeof sdk?.get === 'function') {
    return unwrapSdkCall(sdk, fn.call(sdk, folderId, fields))
  }
  try {
    const res = await unwrapSdkCall(sdk, fn.call(sdk, { folder_id: folderId, fields }))
    if (res !== undefined) return res
  } catch {
    // fall back to positional call
  }
  return unwrapSdkCall(sdk, fn.call(sdk, folderId, fields))
}

export async function fetchFolderWithAncestors(
  sdk: Looker40SDK,
  folderId: string
): Promise<{
  folder: LookerFolderNode | null
  ancestors: LookerFolderNode[]
  chain: LookerFolderNode[]
  expandedIds: string[]
}> {
  const fid = String(folderId || '').trim()
  if (!fid) return { folder: null, ancestors: [], chain: [], expandedIds: [] }
  return coalesceLookerMetadataRequest(
    `folder_ancestors:${fid}`,
    async () => {
      const s = sdk as unknown as LookerFolderSdkLike
      let rawFolder: RawLookerFolderLike | null = null
      let rawAncestors: RawLookerFolderLike[] | null = null
      try {
        if (typeof s?.folder === 'function') {
          rawFolder = (await callFolderIdEndpoint(s, 'folder', fid, LOOKER_FOLDER_FIELDS)) as RawLookerFolderLike | null
        }
      } catch {
        // ignore folder lookup error
      }
      try {
        if (typeof s?.folder_ancestors === 'function') {
          const anc = await callFolderIdEndpoint(s, 'folder_ancestors', fid, LOOKER_FOLDER_FIELDS)
          if (Array.isArray(anc)) rawAncestors = anc as RawLookerFolderLike[]
        }
      } catch {
        // ignore folder_ancestors lookup error
      }

      let allFoldersFallbackList: RawLookerFolderLike[] | undefined
      if ((!rawFolder || !rawAncestors) && typeof s?.all_folders === 'function') {
        try {
          const all = await unwrapSdkCall(s, s.all_folders(LOOKER_FOLDER_FIELDS))
          const list = Array.isArray(all) ? all : []
          allFoldersFallbackList = list
          const byId = new Map<string, RawLookerFolderLike>(
            list.map((f) => [String(f.id), f])
          )
          if (!rawFolder) rawFolder = byId.get(fid) || null
          if (!rawAncestors && rawFolder) {
            const chainUp: RawLookerFolderLike[] = []
            let cur = rawFolder.parent_id ? byId.get(String(rawFolder.parent_id)) : null
            const visited = new Set<string>([fid])
            while (cur && !visited.has(String(cur.id))) {
              visited.add(String(cur.id))
              chainUp.unshift(cur)
              cur = cur.parent_id ? byId.get(String(cur.parent_id)) : null
            }
            rawAncestors = chainUp
          }
        } catch {
          // ignore all_folders fallback error
        }
      }

      const folder = rawFolder
        ? normalizeLookerFolderNode(rawFolder, undefined, allFoldersFallbackList)
        : null
      const normAnc = (rawAncestors || []).map((a) =>
        normalizeLookerFolderNode(a, undefined, allFoldersFallbackList)
      )
      const orderedAncestors =
        normAnc.length > 1 && normAnc[0].parent_id ? [...normAnc].reverse() : normAnc
      const chain = [...orderedAncestors, ...(folder ? [folder] : [])]
      return {
        folder,
        ancestors: orderedAncestors,
        chain,
        expandedIds: orderedAncestors.map((a) => a.id),
      }
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:folder_ancestors', fid]
  )
}

export async function searchLookerFolders(
  sdk: Looker40SDK,
  params: SearchLookerFoldersParams = {}
): Promise<LookerFolderNode[]> {
  const req: Record<string, unknown> = { fields: params.fields || LOOKER_FOLDER_FIELDS }
  const rawName = params.name?.trim() || ''
  const rawParent = params.parent_id?.trim() || ''
  const rawCreator = params.creator_id?.trim() || ''
  if (rawName) req.name = rawName
  if (rawParent) req.parent_id = rawParent
  if (params.id?.trim()) req.id = params.id.trim()
  if (rawCreator) req.creator_id = rawCreator
  if (params.is_personal !== undefined && params.is_personal !== '' && params.is_personal !== 'any') {
    req.is_personal = params.is_personal === true || params.is_personal === 'true'
  }
  if (params.is_personal_descendant !== undefined && params.is_personal_descendant !== '' && params.is_personal_descendant !== 'any') {
    req.is_personal_descendant = params.is_personal_descendant === true || params.is_personal_descendant === 'true'
  }
  const knownFoldersList: LookerFolderNode[] = Array.isArray(params.knownFolders)
    ? params.knownFolders
    : params.knownFolders && typeof params.knownFolders === 'object'
    ? Object.values(params.knownFolders)
    : []

  return coalesceLookerMetadataRequest(
    `search_folders:${JSON.stringify(req)}`,
    async () => {
      const s = sdk as unknown as LookerFolderSdkLike
      const execReq: Record<string, unknown> = Object.assign({}, req)
      const safeCall = async <T>(fn: () => Promise<T>): Promise<T | null> => {
        try { return await fn() } catch { return null }
      }

      if (rawParent && !/^\d+$/.test(rawParent)) {
        const parenId = rawParent.match(/\((\d+)\)\s*$/)?.[1]
        if (parenId) {
          execReq.parent_id = parenId
        } else {
          const parentQ = rawParent.toLowerCase()
          const matchByName = (list: LookerFolderNode[]) => list.filter((f) => f.name.toLowerCase().includes(parentQ))
          let candidates = matchByName(knownFoldersList)
          if (!candidates.length && typeof s?.all_folders === 'function') {
            const all = await safeCall(() => unwrapSdkCall(s, s.all_folders!(LOOKER_FOLDER_FIELDS)))
            if (Array.isArray(all)) candidates = matchByName(all.map((r) => normalizeLookerFolderNode(r, undefined, all)))
          }
          if (!candidates.length && typeof s?.folder_children === 'function') {
            const ch = await safeCall(() => unwrapSdkCall(s, s.folder_children!({ folder_id: '1', fields: 'id,name,parent_id,child_count,is_personal,can' })))
            if (Array.isArray(ch)) candidates = matchByName(ch.map((r) => normalizeLookerFolderNode(r, '1')))
          }
          if (!candidates.length && typeof s?.search_folders === 'function') {
            const found = await safeCall(() => unwrapSdkCall(s, s.search_folders!({ name: rawParent, fields: LOOKER_FOLDER_FIELDS })))
            if (Array.isArray(found)) candidates = matchByName(found.map((r) => normalizeLookerFolderNode(r)))
          }
          if (candidates.length > 0) {
            execReq.parent_id = String((candidates.find((f) => f.name.toLowerCase() === parentQ) || candidates[0]).id)
          }
        }
      }

      if (rawCreator && !/^\d+$/.test(rawCreator)) {
        const parenUid = rawCreator.match(/\((\d+)\)\s*$/)?.[1]
        if (parenUid) {
          execReq.creator_id = parenUid
        } else {
          const creatorQ = rawCreator.toLowerCase()
          const matchesUser = (u?: { id?: string | number | null; display_name?: string | null; email?: string | null } | null) =>
            Boolean(u?.display_name?.toLowerCase().includes(creatorQ) || u?.email?.toLowerCase().includes(creatorQ) || String(u?.id ?? '').toLowerCase() === creatorQ)
          const matchedUser = (params.knownUsers || []).find(matchesUser)
          if (matchedUser?.id) {
            execReq.creator_id = String(matchedUser.id)
          } else if (typeof s?.search_users === 'function') {
            const users = await safeCall(() => unwrapSdkCall(s, s.search_users!({ display_name: rawCreator })))
            const u = Array.isArray(users) ? users.find(matchesUser) || users[0] : null
            if (u?.id != null) execReq.creator_id = String(u.id)
          } else if (typeof s?.me === 'function') {
            const meUser = await safeCall(() => unwrapSdkCall(s, s.me!('id,display_name,email')))
            if (meUser?.id != null && matchesUser(meUser)) execReq.creator_id = String(meUser.id)
          }
        }
      }

      if (typeof s?.search_folders === 'function') {
        const rows = await safeCall(async () => {
          let r = await unwrapSdkCall(s, s.search_folders!(execReq))
          if ((!Array.isArray(r) || r.length === 0) && rawName && /^\d+$/.test(rawName) && !execReq.id) {
            const byIdReq = Object.assign({}, execReq, { id: rawName })
            delete byIdReq.name
            r = await unwrapSdkCall(s, s.search_folders!(byIdReq))
          }
          return r
        })
        if (Array.isArray(rows)) return rows.map((r) => normalizeLookerFolderNode(r))
      }
      if (typeof s?.all_folders === 'function') {
        const rows = await safeCall(() => unwrapSdkCall(s, s.all_folders!(LOOKER_FOLDER_FIELDS)))
        if (Array.isArray(rows)) {
          const all = rows.map((r) => normalizeLookerFolderNode(r, undefined, rows))
          const nameQ = String(execReq.name || '').replace(/%/g, '').trim().toLowerCase()
          const parentFilter = String(execReq.parent_id || '').trim()
          const creatorFilter = String(execReq.creator_id || '').trim()
          return all.filter((f) => {
            if (nameQ && !f.name.toLowerCase().includes(nameQ) && String(f.id).toLowerCase() !== nameQ) return false
            if (parentFilter) {
              const pNode = all.find((p) => String(p.id) === String(f.parent_id || ''))
              if (String(f.parent_id || '') !== parentFilter && !pNode?.name.toLowerCase().includes(parentFilter.toLowerCase())) return false
            }
            if (execReq.id && String(f.id) !== String(execReq.id)) return false
            if (creatorFilter && String(f.creator_id || '') !== creatorFilter) return false
            if (typeof execReq.is_personal === 'boolean' && Boolean(f.is_personal) !== execReq.is_personal) return false
            if (typeof execReq.is_personal_descendant === 'boolean' && Boolean(f.is_personal_descendant) !== execReq.is_personal_descendant) return false
            return true
          })
        }
      }
      return []
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:search_folders', req]
  )
}

// ponytail: seed Looker root folder nodes from me (personal_folder_id + home_folder_id + standard roots)
// instead of calling slow sdk.all_folders() upfront on startup; child folders and ancestors hydrate lazily.
export async function fetchInitialLookerMetadata(sdk: Looker40SDK) {
  let workspaceId: 'dev' | 'production' =
    typeof window !== 'undefined' &&
    window.__MOCK_LOOKER_EXTENSION__?.initialLookerWorkspaceId === 'dev'
      ? 'dev'
      : 'production'
  const sdkWithSession = sdk as unknown as {
    session?: () => Promise<{ workspace_id?: string | null }>
  }
  const [me, models] = await Promise.all([
    coalesceLookerMetadataRequest(
      'meta:me',
      () =>
        sdk.ok(sdk.me('id,display_name,email,personal_folder_id,home_folder_id,is_iam_admin,can')),
      LOOKER_METADATA_CACHE_TTL_MS,
      ['looker:me']
    ),
    coalesceLookerMetadataRequest(
      'meta:all_lookml_models',
      () =>
        sdk.ok(
          sdk.all_lookml_models({
            fields:
              'name,label,project_name,allowed_db_connection_names,can,explores(name,label,description,group_label,hidden)',
          })
        ),
      LOOKER_METADATA_CACHE_TTL_MS,
      ['looker:models']
    ),
    typeof sdkWithSession.session === 'function'
      ? coalesceLookerMetadataRequest(
          'meta:session',
          () => sdk.ok(sdkWithSession.session!() as never),
          LOOKER_METADATA_CACHE_TTL_MS,
          ['looker:session']
        )
          .then((sess: { workspace_id?: string | null } | undefined) => {
            if (sess?.workspace_id === 'dev') workspaceId = 'dev'
            else if (sess?.workspace_id === 'production') workspaceId = 'production'
          })
          .catch(() => {})
      : Promise.resolve(),
  ])
  let roles: IRole[] | null = null
  const sdkWithRoles = sdk as unknown as {
    user_roles?: (params: { user_id: string }) => Promise<IRole[]>
  }
  if (me?.id && typeof sdkWithRoles.user_roles === 'function') {
    try {
      const uid = String(me.id)
      const fetchedRoles = await coalesceLookerMetadataRequest(
        `meta:user_roles:${uid}`,
        () => sdk.ok(sdkWithRoles.user_roles!({ user_id: uid }) as never),
        LOOKER_METADATA_CACHE_TTL_MS,
        ['looker:user_roles', uid]
      )
      if (Array.isArray(fetchedRoles)) roles = fetchedRoles
    } catch {
      roles = null
    }
  }
  const allModels = models || []
  const validModels = allModels.filter((m) => m.name && m.explores && m.explores.length > 0)
  const rootFolders = buildRootLookerFolders(me)
  const capFolders = me?.personal_folder_id
    ? [
        {
          id: String(me.personal_folder_id),
          name: 'My folder',
          is_personal: true,
          can: { show: true, edit_content: true },
        },
      ]
    : []
  const capabilities = resolveUserCapabilities({
    user: me,
    roles,
    models: allModels,
    folders: capFolders,
  })
  const defaultFolderId = String(me.personal_folder_id || me.home_folder_id || '1')
  return {
    user: me,
    roles,
    models: validModels,
    allModels,
    folders: rootFolders,
    defaultFolderId,
    capabilities,
    workspaceId,
  }
}

export function buildAvailableExploresCatalog(
  models: Array<{
    name?: string | null
    label?: string | null
    explores?: Array<Partial<ILookmlModelNavExplore>> | null
  }>
): string {
  const lines: string[] = [
    '# Available Looker Explores Catalog (Let the Agent Decide)',
    'No specific explore was pre-selected. Pick the best `model_id::explore_id` explore below and run ONE `run_looker_codemode` call (`lookml_model_explore(m, e, fields="name,label,description,fields(dimensions(name,label,description,type),measures(name,label,description,type))")` + 5-row `run_inline_query("json", {"model": m, "view": e, "fields": [...], "limit": "5"})`) to inspect fields and sample rows.',
    '',
  ]
  const sortedModels = [...models].sort((a, b) =>
    String(a.label || a.name).localeCompare(String(b.label || b.name))
  )
  for (const m of sortedModels) {
    const modelName = String(m.name || '')
    if (!modelName) continue
    const visible = (m.explores || [])
      .filter((e) => !e.hidden && e.name)
      .sort((a, b) =>
        String(a.label || a.name).localeCompare(String(b.label || b.name))
      )
    if (visible.length === 0) continue
    lines.push(`## Model: ${m.label || modelName} (\`${modelName}\`)`)
    for (const e of visible) {
      const id = formatExploreId(modelName, String(e.name))
      const desc = e.description ? ` — ${String(e.description).trim()}` : ''
      lines.push(`- \`${id}\` (${e.label || e.name})${desc}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function cleanSql(sql?: string | null): string {
  if (!sql) return ''
  const s = sql.trim()
  if (/^\$\{TABLE\}\.[a-zA-Z0-9_]+$/i.test(s)) return ''
  return s.length > 100 ? s.slice(0, 97) + '...' : s
}

export async function buildDenseExploreSchema(
  sdk: Looker40SDK,
  modelName: string,
  exploreName: string
): Promise<string> {
  return coalesceLookerMetadataRequest(
    `dense_explore_schema:${formatExploreId(modelName, exploreName)}`,
    async () => {
      const exp = await sdk.ok(
        sdk.lookml_model_explore({
          lookml_model_name: modelName,
          explore_name: exploreName,
        })
      )
      const lines: string[] = [
        `# Explore: \`${modelName}::${exploreName}\``,
        exp.label ? `**Label:** ${exp.label}` : '',
        exp.description ? `**Description:** ${exp.description}` : '',
        '',
      ].filter(Boolean)

      if (exp.joins && exp.joins.length > 0) {
        lines.push('## Joins')
        for (const j of exp.joins) {
          lines.push(`- \`${j.name}\` (${j.relationship || 'many_to_one'}, ${j.type || 'left_outer'})`)
        }
        lines.push('')
      }

      const fields = exp.fields || {}
      const measures = (fields.measures || []).filter((f) => !f.hidden)
      const dimensions = (fields.dimensions || []).filter((f) => !f.hidden)

      const formatFieldLine = (f: {
        name?: string | null
        type?: string | null
        label?: string | null
        description?: string | null
        sql?: string | null
        drill_fields?: string[] | null
      }) => {
        const meta = [f.type, f.label ? `"${f.label}"` : ''].filter(Boolean).join(', ')
        const sql = cleanSql(f.sql)
        const drills = Array.isArray(f.drill_fields) && f.drill_fields.length > 0 ? f.drill_fields.join(', ') : ''
        return `- \`${f.name}\` (${meta})${f.description ? ` — ${f.description}` : ''}${sql ? ` [SQL: \`${sql}\`]` : ''}${drills ? ` [Drills: \`${drills}\`]` : ''}`
      }

      lines.push(`## Measures (${measures.length})`, ...measures.map(formatFieldLine), '')
      lines.push(`## Dimensions (${dimensions.length})`, ...dimensions.map(formatFieldLine), '')

      const baseView = exp.view_name || exploreName
      const sampleDims = dimensions
        .filter((d) => d.name?.startsWith(`${baseView}.`))
        .slice(0, 2)
        .map((d) => d.name!)
      const sampleMeas = measures
        .filter((m) => m.name?.startsWith(`${baseView}.`))
        .slice(0, 2)
        .map((m) => m.name!)
      const sampleFields = [...sampleDims, ...sampleMeas]

      if (sampleFields.length > 0) {
        try {
          const rows = (await sdk.ok(
            sdk.run_inline_query({
              result_format: 'json',
              body: {
                model: modelName,
                view: exploreName,
                fields: sampleFields,
                limit: '5',
              },
            })
          )) as unknown as Record<string, unknown>[]
          if (Array.isArray(rows) && rows.length > 0) {
            lines.push(`## Sample Rows (${sampleFields.join(', ')})`)
            lines.push('```json')
            lines.push(JSON.stringify(rows, null, 2))
            lines.push('```')
          }
        } catch {
          // Non-fatal if sample query fails
        }
      }

      return lines.join('\n')
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:explore_schema', modelName, exploreName]
  )
}

export const fetchExploreSchemaAndSample = buildDenseExploreSchema

export function useLookerMetadata(sdk?: Looker40SDK | null, enabled = true) {
  return useSWR(sdk && enabled ? ['looker:me'] : null, () => fetchInitialLookerMetadata(sdk!), LOOKER_SWR_CONFIG)
}

export function useExploreSchema(sdk: Looker40SDK | null | undefined, modelName?: string, exploreName?: string) {
  return useSWR<string>(
    sdk && modelName && exploreName ? ['looker:explore_schema', modelName, exploreName] : null,
    () => buildDenseExploreSchema(sdk!, modelName!, exploreName!),
    LOOKER_SWR_CONFIG
  )
}

export function useLookerDashboard(sdk: Looker40SDK | null | undefined, dashboardId?: string) {
  return useSWR(
    sdk && dashboardId ? ['looker:dashboard', dashboardId] : null,
    () => coalesceLookerMetadataRequest(`dashboard:${dashboardId}`, () => sdk!.ok(sdk!.dashboard(dashboardId!)), LOOKER_METADATA_CACHE_TTL_MS, ['looker:dashboard', dashboardId]),
    LOOKER_SWR_CONFIG
  )
}

export function useLookerCaAgents(sdk: Looker40SDK | null | undefined) {
  return useSWR(sdk ? ['looker:ca_agents'] : null, () => fetchLookerCaAgentsCatalog(sdk!), LOOKER_SWR_CONFIG)
}

export type StudioThemeMode = 'light' | 'dark' | 'system'
export type ResolvedStudioTheme = 'light' | 'dark'
export const STUDIO_THEME_STORAGE_KEY = 'dab_theme_mode'

export function normalizeStudioThemeMode(raw: unknown): StudioThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

export function resolveSystemTheme(mediaQueryList?: { matches?: boolean } | null): ResolvedStudioTheme {
  try {
    const mql = mediaQueryList !== undefined ? mediaQueryList : typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null
    return mql?.matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function resolveStudioTheme(mode: StudioThemeMode, systemTheme: ResolvedStudioTheme = resolveSystemTheme()): ResolvedStudioTheme {
  return mode === 'system' ? systemTheme : mode
}

export function applyStudioDocumentTheme(resolved: ResolvedStudioTheme, mode?: StudioThemeMode): void {
  if (typeof document === 'undefined' || !document.documentElement) return
  document.documentElement.setAttribute('data-theme', resolved)
  if (mode) document.documentElement.setAttribute('data-theme-mode', mode)
  document.documentElement.style.colorScheme = resolved
}

export function readInitialStudioThemeMode(): StudioThemeMode {
  try {
    const w = typeof window !== 'undefined' ? window : undefined
    return normalizeStudioThemeMode(w?.__MOCK_LOOKER_EXTENSION__?.initialThemeMode ?? w?.localStorage?.getItem?.(STUDIO_THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export async function loadStoredStudioThemeMode(extensionSDK?: Partial<ExtensionSDK>): Promise<StudioThemeMode | null> {
  try {
    const w = typeof window !== 'undefined' ? window : undefined
    const raw = (await extensionSDK?.localStorageGetItem?.(STUDIO_THEME_STORAGE_KEY)) ?? w?.localStorage?.getItem?.(STUDIO_THEME_STORAGE_KEY)
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : null
  } catch {
    return null
  }
}

export function persistStudioThemeMode(extensionSDK: Partial<ExtensionSDK> | undefined, mode: StudioThemeMode): void {
  try { if (typeof window !== 'undefined') window.localStorage?.setItem?.(STUDIO_THEME_STORAGE_KEY, mode) } catch { /* ignore */ }
  try { void extensionSDK?.localStorageSetItem?.(STUDIO_THEME_STORAGE_KEY, mode) } catch { /* ignore */ }
}

function parseAnchorUtcDate(anchorDate?: string): Date {
  const m = String(anchorDate || '')
    .trim()
    .match(/^(\d{4})[-/](\d{2})[-/](\d{2})/)
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

const formatUtcDate = (d: Date): string => d.toISOString().slice(0, 10)
const addUtcDays = (d: Date, delta: number): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta))
const addUtcMonths = (d: Date, delta: number): Date => {
  const targetMonth = d.getUTCMonth() + delta
  const maxDay = new Date(Date.UTC(d.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate()
  return new Date(Date.UTC(d.getUTCFullYear(), targetMonth, Math.min(d.getUTCDate(), maxDay)))
}
const shiftUtcByUnit = (base: Date, n: number, unit: string): Date =>
  unit.startsWith('day')
    ? addUtcDays(base, n)
    : unit.startsWith('week')
    ? addUtcDays(base, n * 7)
    : unit.startsWith('month')
    ? addUtcMonths(base, n)
    : unit.startsWith('quarter')
    ? addUtcMonths(base, n * 3)
    : addUtcMonths(base, n * 12)

// ponytail: deterministic UTC relative-to-fixed Looker date converter so point-in-time Data Investigator
// narratives never drift as calendar days advance.
export function convertRelativeDateFilterToFixed(filterExpr: string, anchorDate?: string): string {
  const raw = String(filterExpr || '').trim()
  if (!raw) return raw

  const fixedRangeMatch = raw.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})\s+(?:to|until|-)\s+(\d{4})[-/](\d{2})[-/](\d{2})$/i
  )
  if (fixedRangeMatch) {
    return `${fixedRangeMatch[1]}-${fixedRangeMatch[2]}-${fixedRangeMatch[3]} to ${fixedRangeMatch[4]}-${fixedRangeMatch[5]}-${fixedRangeMatch[6]}`
  }
  const singleDateMatch = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/)
  if (singleDateMatch) return `${singleDateMatch[1]}-${singleDateMatch[2]}-${singleDateMatch[3]}`

  const anchor = parseAnchorUtcDate(anchorDate)
  const endStr = formatUtcDate(anchor)
  const lower = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  const y = anchor.getUTCFullYear()
  const m = anchor.getUTCMonth()
  const qStart = Math.floor(m / 3) * 3

  if (lower === 'today') return `${endStr} to ${endStr}`
  if (lower === 'yesterday') {
    const yd = formatUtcDate(addUtcDays(anchor, -1))
    return `${yd} to ${yd}`
  }
  if (lower === 'this week') {
    const dow = anchor.getUTCDay()
    return `${formatUtcDate(addUtcDays(anchor, -(dow === 0 ? 6 : dow - 1)))} to ${endStr}`
  }
  if (lower === 'last week') return `${formatUtcDate(addUtcDays(anchor, -7))} to ${endStr}`
  if (lower === 'this month' || lower === 'mtd') {
    return `${formatUtcDate(new Date(Date.UTC(y, m, 1)))} to ${endStr}`
  }
  if (lower === 'last month') {
    return `${formatUtcDate(new Date(Date.UTC(y, m - 1, 1)))} to ${formatUtcDate(new Date(Date.UTC(y, m, 0)))}`
  }
  if (lower === 'this quarter' || lower === 'qtd') {
    return `${formatUtcDate(new Date(Date.UTC(y, qStart, 1)))} to ${endStr}`
  }
  if (lower === 'last quarter') {
    return `${formatUtcDate(new Date(Date.UTC(y, qStart - 3, 1)))} to ${formatUtcDate(new Date(Date.UTC(y, qStart, 0)))}`
  }
  if (lower === 'this year' || lower === 'ytd') return `${y}-01-01 to ${endStr}`
  if (lower === 'last year') return `${y - 1}-01-01 to ${y - 1}-12-31`

  const agoForMatch = lower.match(
    /^(\d+)\s+(day|days|week|weeks|month|months|quarter|quarters|year|years)\s+ago\s+for\s+(\d+)\s+(day|days|week|weeks|month|months|quarter|quarters|year|years)$/
  )
  if (agoForMatch) {
    const start = shiftUtcByUnit(anchor, -Number(agoForMatch[1]), agoForMatch[2])
    const end = shiftUtcByUnit(start, Number(agoForMatch[3]), agoForMatch[4])
    return `${formatUtcDate(start)} to ${formatUtcDate(end)}`
  }

  const relMatch = lower.match(
    /^(?:(?:last|past|previous|trailing)\s+)?(\d+)\s+(day|days|week|weeks|month|months|quarter|quarters|year|years)(?:\s+ago)?$/
  )
  if (relMatch) {
    const start = shiftUtcByUnit(anchor, -Number(relMatch[1]), relMatch[2])
    return `${formatUtcDate(start)} to ${lower.endsWith(' ago') ? formatUtcDate(start) : endStr}`
  }

  return raw
}

export function normalizeQueryFiltersToFixedDates(
  filters: Record<string, string>,
  anchorDate?: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters || {}).map(([k, v]) => [k, convertRelativeDateFilterToFixed(v, anchorDate)])
  )
}

export type StudioContextCategory = 'explore' | 'dashboard' | 'look' | 'conversation'

export interface StudioContextMention {
  type: StudioContextCategory
  id: string
  title: string
  subtitle?: string
  model?: string
  explore?: string
  folderId?: string
  description?: string
  url?: string
}

export interface HydratedMentionedContext {
  explores: string[]
  extraSources: Array<{ type: 'inline'; content: string; target: string }>
  promptSummary: string
}

function normalizeRawContentMention(raw: Record<string, unknown>, fallbackCategory?: StudioContextCategory): StudioContextMention | null {
  const rawType = String(raw.content_type || raw.type || raw.section || fallbackCategory || '').toLowerCase().trim()

  if (
    rawType.includes('explore') ||
    (typeof raw.model_name === 'string' && typeof raw.explore_name === 'string') ||
    (typeof raw.model === 'string' && typeof raw.explore === 'string')
  ) {
    const model = String(raw.model_name || raw.model || '').trim()
    const explore = String(raw.explore_name || raw.explore || raw.name || '').trim()
    const id = model && explore ? formatExploreId(model, explore) : String(raw.content_id || raw.id || '').trim()
    const parsed = parseExploreId(id)
    if (!parsed) return null
    return {
      type: 'explore', id, model: parsed.modelName, explore: parsed.exploreName,
      title: String(raw.title || raw.label || parsed.exploreName).trim(), subtitle: parsed.modelName,
      description: raw.description ? String(raw.description) : undefined,
      url: raw.content_url || raw.url ? String(raw.content_url || raw.url) : undefined,
    }
  }

  if (rawType.includes('conversation')) {
    const id = String(raw.content_id || raw.id || '').trim()
    if (!id) return null
    return {
      type: 'conversation', id, title: String(raw.title || raw.label || raw.name || id).trim(),
      subtitle: raw.use_case ? String(raw.use_case) : undefined,
      description: raw.description ? String(raw.description) : undefined,
    }
  }

  const isLook = rawType === 'look' || rawType === 'looks'
  const isDash = rawType.includes('dashboard') || (!isLook && fallbackCategory === 'dashboard')
  if (!isLook && !isDash && fallbackCategory !== 'look') return null

  const type: StudioContextCategory = isLook || fallbackCategory === 'look' ? 'look' : 'dashboard'
  const id = String(raw.content_id || raw.content_slug || raw.id || '').trim()
  if (!id) return null
  const title = String(raw.title || raw.name || raw.label || id).trim()
  const folderObj = raw.folder as Record<string, unknown> | undefined
  const folderId = raw.folder_id ? String(raw.folder_id) : folderObj?.id ? String(folderObj.id) : undefined
  const subtitle = folderObj?.name ? String(folderObj.name) : `${type === 'dashboard' ? 'Dashboard' : 'Look'} #${id}`
  return {
    type, id, title, subtitle, folderId,
    description: raw.description ? String(raw.description) : undefined,
    url: raw.content_url || raw.url ? String(raw.content_url || raw.url) : undefined,
  }
}

function dedupeContextMentions(items: StudioContextMention[]): StudioContextMention[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = `${item.type}:${item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function fetchPreloadedContentSummary(sdk: Looker40SDK): Promise<StudioContextMention[]> {
  return coalesceLookerMetadataRequest(
    'meta:content_summary',
    async () => {
      const sdkRec = sdk as unknown as { content_summary?: (params: Record<string, unknown>) => Promise<unknown>; ok?: <T>(p: Promise<T> | T) => Promise<T> }
      const summaryFields = 'id,content_type,content_id,content_slug,content_url,title,description,view_count,favorite_count,last_viewed_at'
      let rawRows: unknown = null
      if (typeof sdkRec.content_summary === 'function') {
        try {
          const callRes = sdkRec.content_summary({ limit: 30, fields: summaryFields })
          rawRows = typeof sdkRec.ok === 'function' ? await sdkRec.ok(callRes) : await callRes
        } catch {
          rawRows = null
        }
      }
      if (!Array.isArray(rawRows) || rawRows.length === 0) {
        try {
          rawRows = await rawLookerRequest<unknown>(sdk, 'GET', '/api/4.0/content_summary', { limit: 30, fields: summaryFields })
        } catch {
          rawRows = null
        }
      }
      if (!Array.isArray(rawRows) || rawRows.length === 0) {
        try {
          rawRows = await sdk.ok(sdk.search_content({ terms: '', types: 'dashboard,look', limit: 30 } as Parameters<Looker40SDK['search_content']>[0]))
        } catch {
          rawRows = []
        }
      }
      const rows = Array.isArray(rawRows) ? rawRows : []
      const mentions: StudioContextMention[] = []
      for (const row of rows) {
        if (row && typeof row === 'object') {
          const normalized = normalizeRawContentMention(row as Record<string, unknown>)
          if (normalized) mentions.push(normalized)
        }
      }
      return dedupeContextMentions(mentions)
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:content_summary']
  )
}

export async function searchGlobalContentV2(
  sdk: Looker40SDK,
  params: { term: string; category?: StudioContextCategory | 'all'; limit?: number }
): Promise<StudioContextMention[]> {
  const cleanTerm = String(params.term || '').trim()
  const limit = params.limit ?? 15
  const category = params.category && params.category !== 'all' ? params.category : undefined
  const sections =
    category === 'look' ? ['Looks']
    : category === 'dashboard' ? ['Dashboards', 'LookML Dashboards']
    : category === 'explore' ? ['Explore', 'Self-Service Explore']
    : category === 'conversation' ? ['Conversations']
    : undefined

  let payload: unknown = null
  try {
    payload = await rawLookerRequest<unknown>(
      sdk,
      'GET',
      '/api/4.0/global_search_v2',
      Object.assign({ term: cleanTerm, curate: true, limit }, sections ? { sections } : null)
    )
  } catch {
    try {
      payload = await sdk.ok(
        sdk.search_content(
          Object.assign(
            { terms: cleanTerm, limit },
            category === 'look' ? { types: 'look' } : category === 'dashboard' ? { types: 'dashboard' } : null
          ) as Parameters<Looker40SDK['search_content']>[0]
        )
      )
    } catch {
      payload = []
    }
  }

  const mentions: StudioContextMention[] = []
  const collectFromList = (list: unknown[], sectionHint?: StudioContextCategory) => {
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue
      const rec = entry as Record<string, unknown>
      if (Array.isArray(rec.items) || Array.isArray(rec.results)) {
        const secName = String(rec.name || rec.title || rec.section || rec.type || '').toLowerCase()
        const hint: StudioContextCategory | undefined =
          secName.includes('look') && !secName.includes('lookml') ? 'look'
          : secName.includes('dashboard') ? 'dashboard'
          : secName.includes('explore') ? 'explore'
          : secName.includes('conversation') ? 'conversation'
          : sectionHint
        collectFromList((rec.items || rec.results) as unknown[], hint)
        continue
      }
      const item = normalizeRawContentMention(rec, sectionHint || category)
      if (item && (!category || item.type === category)) mentions.push(item)
    }
  }

  if (Array.isArray(payload)) {
    collectFromList(payload, category)
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    if (Array.isArray(obj.sections)) collectFromList(obj.sections, category)
    if (Array.isArray(obj.results)) collectFromList(obj.results, category)
    if (Array.isArray(obj.items)) collectFromList(obj.items, category)
  }

  return dedupeContextMentions(mentions).slice(0, limit)
}

function sanitizeContextFilename(rawId: string): string {
  return String(rawId || 'item').trim().replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function summarizeQuerySpec(q: Record<string, unknown> | null | undefined, fixedDates = false, anchorDate?: string) {
  if (!q || typeof q !== 'object') return null
  const model = String(q.model || '').trim()
  const view = String(q.view || q.explore || '').trim()
  const rawFilters = q.filters && typeof q.filters === 'object' ? (q.filters as Record<string, string>) : undefined
  const filters = rawFilters && fixedDates ? normalizeQueryFiltersToFixedDates(rawFilters, anchorDate) : rawFilters
  return {
    model: model || undefined,
    view: view || undefined,
    fields: Array.isArray(q.fields) ? q.fields : undefined,
    pivots: Array.isArray(q.pivots) ? q.pivots : undefined,
    fill_fields: Array.isArray(q.fill_fields) ? q.fill_fields : undefined,
    filters,
    sorts: Array.isArray(q.sorts) ? q.sorts : undefined,
    limit: q.limit !== undefined && q.limit !== null ? String(q.limit) : undefined,
    dynamic_fields: q.dynamic_fields,
    vis_config: q.vis_config && typeof q.vis_config === 'object' ? q.vis_config : undefined,
  }
}

async function fetchLookerEntityRecord(
  sdk: Looker40SDK,
  method: 'dashboard' | 'look',
  paramKey: 'dashboard_id' | 'look_id',
  pathPrefix: '/dashboards' | '/looks',
  id: string
): Promise<Record<string, unknown> | null> {
  try {
    const fn = sdk[method] as unknown as (arg: unknown) => Promise<unknown>
    let raw: unknown
    try {
      raw = await sdk.ok(fn.call(sdk, id))
    } catch {
      raw = await sdk.ok(fn.call(sdk, { [paramKey]: id }))
    }
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  } catch {
    try {
      return await rawLookerRequest<Record<string, unknown>>(sdk, 'GET', `${pathPrefix}/${encodeURIComponent(id)}`)
    } catch {
      return null
    }
  }
  return null
}

export async function hydrateMentionedContext(params: {
  sdk: Looker40SDK
  mentions: StudioContextMention[]
  conversations?: UserConversationEntry[]
  selectedExplores?: string[]
  useCase?: string
  anchorDate?: string
}): Promise<HydratedMentionedContext> {
  const { sdk, mentions, conversations = [], selectedExplores = [], useCase, anchorDate } = params
  const fixedDates = useCase === 'data-investigator' || useCase === 'data_investigator'
  const exploresSet = new Set<string>(selectedExplores.filter(Boolean))
  const extraSources: Array<{ type: 'inline'; content: string; target: string }> = []
  const summaryLines: string[] = []

  for (const mention of dedupeContextMentions(mentions)) {
    if (mention.type === 'explore') {
      const expId =
        mention.model && mention.explore
          ? formatExploreId(mention.model, mention.explore)
          : mention.id
      if (parseExploreId(expId)) {
        exploresSet.add(expId)
        summaryLines.push(`- **@explore:${mention.title}** (\`${expId}\`)`)
      }
      continue
    }

    if (mention.type === 'dashboard') {
      const dashId = String(mention.id).trim()
      if (!dashId) continue
      const dashObj = await fetchLookerEntityRecord(sdk, 'dashboard', 'dashboard_id', '/dashboards', dashId)

      if (dashObj) {
        const elements = Array.isArray(dashObj.dashboard_elements)
          ? (dashObj.dashboard_elements as Array<Record<string, unknown>>)
          : []
        const dashExplores = new Set<string>()
        const tiles = elements.map((el) => {
          const resultMaker = el.result_maker as Record<string, unknown> | undefined
          const rawQ = (el.query || resultMaker?.query) as Record<string, unknown> | undefined
          const qSpec = summarizeQuerySpec(rawQ, fixedDates, anchorDate)
          if (qSpec?.model && qSpec?.view) {
            const expId = formatExploreId(qSpec.model, qSpec.view)
            exploresSet.add(expId)
            dashExplores.add(expId)
          }
          return {
            id: el.id ? String(el.id) : undefined,
            title: el.title || el.title_text || undefined,
            type: el.type || undefined,
            subtitle_text: el.subtitle_text || undefined,
            body_text: el.body_text || undefined,
            query: qSpec,
          }
        })
        const safeId = sanitizeContextFilename(dashId)
        const targetPath = `/workspace/context/dashboard_${safeId}.json`
        const payload = {
          id: String(dashObj.id || dashId),
          title: String(dashObj.title || mention.title || dashId),
          description: dashObj.description || undefined,
          folder_id: dashObj.folder_id || (dashObj.folder as Record<string, unknown> | undefined)?.id,
          explores: Array.from(dashExplores),
          dashboard_filters: Array.isArray(dashObj.dashboard_filters) ? dashObj.dashboard_filters : [],
          dashboard_layouts: Array.isArray(dashObj.dashboard_layouts) ? dashObj.dashboard_layouts : [],
          tiles,
        }
        extraSources.push({ type: 'inline', target: targetPath, content: JSON.stringify(payload, null, 2) })
        summaryLines.push(
          `- **@dashboard:${payload.title}** (ID \`${payload.id}\`, saved to \`${targetPath}\`, ${tiles.length} tile(s), explores: ${
            payload.explores.length > 0 ? payload.explores.map((e) => `\`${e}\``).join(', ') : 'none'
          })`
        )
      }
      continue
    }

    if (mention.type === 'look') {
      const lookId = String(mention.id).trim()
      if (!lookId) continue
      const lookObj = await fetchLookerEntityRecord(sdk, 'look', 'look_id', '/looks', lookId)

      if (lookObj) {
        const qSpec = summarizeQuerySpec(
          lookObj.query as Record<string, unknown> | undefined,
          fixedDates,
          anchorDate
        )
        const expId = qSpec?.model && qSpec?.view ? formatExploreId(qSpec.model, qSpec.view) : ''
        if (expId) exploresSet.add(expId)
        const safeId = sanitizeContextFilename(lookId)
        const targetPath = `/workspace/context/look_${safeId}.json`
        const payload = {
          id: String(lookObj.id || lookId),
          title: String(lookObj.title || mention.title || lookId),
          description: lookObj.description || undefined,
          folder_id: lookObj.folder_id || (lookObj.folder as Record<string, unknown> | undefined)?.id,
          explore: expId || undefined,
          query: qSpec,
        }
        extraSources.push({ type: 'inline', target: targetPath, content: JSON.stringify(payload, null, 2) })
        summaryLines.push(
          `- **@look:${payload.title}** (ID \`${payload.id}\`, saved to \`${targetPath}\`${
            expId ? `, explore: \`${expId}\`` : ''
          })`
        )
      }
      continue
    }

    if (mention.type === 'conversation') {
      const convId = String(mention.id).trim()
      if (!convId) continue
      let conv: UserConversationEntry | null =
        conversations.find((c) => c.id === convId || c.label === mention.title) || null
      if (!conv) {
        try {
          conv = await loadSingleConversationArtifact(sdk, convId)
        } catch {
          conv = null
        }
      }
      if (conv) {
        for (const exp of conv.explores || []) {
          if (parseExploreId(exp)) exploresSet.add(exp)
        }
        const safeId = sanitizeContextFilename(conv.id || convId)
        const targetPath = `/workspace/context/conversation_${safeId}.md`
        const turnLines = (conv.messages || []).map(
          (m) => `### ${String(m.role || 'user').toUpperCase()}\n${String(m.text || '')}`
        )
        const mdContent = [
          `# Conversation: ${conv.label || mention.title} (${conv.id})`,
          `- Use Case: ${conv.use_case || conv.type || 'app'}`,
          `- Explores: ${(conv.explores || []).join(', ') || 'none'}`,
          conv.content ? `- Content Metadata: \`${JSON.stringify(conv.content)}\`` : '',
          '',
          '## Transcript',
          ...(turnLines.length > 0 ? turnLines : ['_No messages recorded._']),
        ]
          .filter(Boolean)
          .join('\n\n')
        extraSources.push({
          type: 'inline',
          target: targetPath,
          content: mdContent,
        })
        summaryLines.push(
          `- **@conversation:${conv.label || mention.title}** (ID \`${conv.id}\`, saved to \`${targetPath}\`)`
        )
      }
    }
  }

  return {
    explores: Array.from(exploresSet),
    extraSources,
    promptSummary:
      summaryLines.length > 0
        ? ['### Referenced Looker Context (@-mentions)', ...summaryLines].join('\n')
        : '',
  }
}

export interface ContentInventoryItem {
  id: string
  title: string
  type: 'dashboard' | 'look'
  folderId?: string
  folderName?: string
}

export interface ContentInventoryFolder {
  id: string
  name: string
  dashboards?: Array<{ id?: string | number | null; title?: string | null; name?: string | null }>
  looks?: Array<{ id?: string | number | null; title?: string | null; name?: string | null }>
  items?: Array<{ id?: string | number | null; title?: string | null; name?: string | null; type?: string | null; content_type?: string | null }>
}

export interface FormattedContentInventory {
  summaryMarkdown: string
  fullMarkdown: string
  overflowFilePath?: string
  truncated: boolean
  totalItems: number
  folderCount: number
}

// ponytail: deterministic Markdown formatter for Looker folder & content inventory queries
// (<= 5 items in 1 folder -> full links; > 5 items or > 1 folder -> max 2 links per folder + /workspace/content_inventory.md).
export function formatContentInventoryMarkdown(
  foldersOrItems: ReadonlyArray<Record<string, unknown> | ContentInventoryFolder | ContentInventoryItem>,
  options: { maxShortItems?: number; maxPerFolder?: number; overflowFilePath?: string } = {}
): FormattedContentInventory {
  const maxShort = options.maxShortItems ?? 5
  const maxPerFolder = options.maxPerFolder ?? 2
  const overflowFilePath = options.overflowFilePath ?? '/workspace/content_inventory.md'
  const groups = new Map<string, { id: string; name: string; items: ContentInventoryItem[] }>()

  const addItem = (fId: string, fName: string, raw: Record<string, unknown>, defaultType: 'dashboard' | 'look') => {
    const id = String(raw.content_id ?? raw.content_slug ?? raw.id ?? '').trim()
    if (!id) return
    const rawType = String(raw.type ?? raw.content_type ?? defaultType).toLowerCase()
    const type: 'dashboard' | 'look' = rawType.includes('look') && !rawType.includes('lookml') ? 'look' : 'dashboard'
    const title = String(raw.title ?? raw.name ?? raw.label ?? `${type === 'look' ? 'Look' : 'Dashboard'} ${id}`).trim()
    const key = fId || fName || '1'
    const group = groups.get(key) || { id: fId || '1', name: fName || `Folder ${fId || '1'}`, items: [] }
    if (!group.items.some((x) => x.type === type && x.id === id)) {
      group.items.push({ id, title, type, folderId: group.id, folderName: group.name })
    }
    groups.set(key, group)
  }

  for (const rawEntry of foldersOrItems || []) {
    if (!rawEntry || typeof rawEntry !== 'object') continue
    const rec = rawEntry as Record<string, unknown>
    if (Array.isArray(rec.dashboards) || Array.isArray(rec.looks) || Array.isArray(rec.items)) {
      const fId = String(rec.id ?? rec.folder_id ?? rec.folderId ?? '1').trim()
      const fName = String(rec.name ?? rec.folder_name ?? rec.folderName ?? rec.title ?? `Folder ${fId}`).trim()
      if (!groups.has(fId)) groups.set(fId, { id: fId, name: fName, items: [] })
      for (const d of (rec.dashboards as Record<string, unknown>[]) || []) if (d && typeof d === 'object') addItem(fId, fName, d, 'dashboard')
      for (const l of (rec.looks as Record<string, unknown>[]) || []) if (l && typeof l === 'object') addItem(fId, fName, l, 'look')
      for (const it of (rec.items as Record<string, unknown>[]) || []) if (it && typeof it === 'object') addItem(fId, fName, it, 'dashboard')
    } else {
      const folderObj = (rec.folder && typeof rec.folder === 'object' ? rec.folder : undefined) as Record<string, unknown> | undefined
      const fId = String(rec.folder_id ?? rec.folderId ?? folderObj?.id ?? '1').trim()
      const fName = String(rec.folder_name ?? rec.folderName ?? folderObj?.name ?? `Folder ${fId}`).trim()
      addItem(fId, fName, rec, 'dashboard')
    }
  }

  const folderList = Array.from(groups.values()).filter((g) => g.items.length > 0)
  const totalItems = folderList.reduce((sum, g) => sum + g.items.length, 0)
  const formatLink = (it: ContentInventoryItem) => `- [${it.title}](/${it.type === 'look' ? 'looks' : 'dashboards'}/${it.id})`
  const formatCounts = (items: ContentInventoryItem[]) => {
    const dCount = items.filter((i) => i.type === 'dashboard').length, lCount = items.length - dCount
    return [dCount && `${dCount} dashboard${dCount === 1 ? '' : 's'}`, lCount && `${lCount} Look${lCount === 1 ? '' : 's'}`].filter(Boolean).join(', ') || '0 items'
  }

  if (totalItems === 0) {
    return { summaryMarkdown: 'No dashboards or Looks found.', fullMarkdown: 'No dashboards or Looks found.', truncated: false, totalItems: 0, folderCount: 0 }
  }

  const fullMarkdown = folderList.map((g) => [`**[${g.name}](/folders/${g.id})** (${formatCounts(g.items)})`, ...g.items.map(formatLink)].join('\n')).join('\n\n')
  if (totalItems <= maxShort && folderList.length <= 1) {
    return { summaryMarkdown: fullMarkdown, fullMarkdown, truncated: false, totalItems, folderCount: folderList.length }
  }

  const summaryBlocks = folderList.map((g) => {
    const shown = g.items.slice(0, maxPerFolder).map(formatLink)
    if (g.items.length > maxPerFolder) {
      shown.push(`- See all ${g.items.length} items in [${g.name}](/folders/${g.id})`)
    }
    return [`**[${g.name}](/folders/${g.id})** (${formatCounts(g.items)})`, ...shown].join('\n')
  })
  summaryBlocks.push(`\nFull unfiltered inventory (${totalItems} items across ${folderList.length} folder${folderList.length === 1 ? '' : 's'}) saved to \`${overflowFilePath}\`.`)

  return {
    summaryMarkdown: summaryBlocks.join('\n\n'),
    fullMarkdown,
    overflowFilePath,
    truncated: true,
    totalItems,
    folderCount: folderList.length,
  }
}
