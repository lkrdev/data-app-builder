import { ChattyClient } from '@looker/chatty/lib/client'
import type { ExtensionSDK } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'
import { mutate, SWRConfig, unstable_serialize } from 'swr'

import { classifyLooker404Error } from './lookerPermissions'

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
  codemode?: boolean
  conversation_id?: string
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
  codemode?: boolean
  conversationId?: string
}

let codeModeScopeDepth = 0
let activeCodeModeConversationId = ''

export const isInsideCodeModeApiScope = (): boolean => codeModeScopeDepth > 0
export const getActiveCodeModeConversationId = (): string => activeCodeModeConversationId

export function withCodeModeApiScope<T>(fn: () => Promise<T> | T, conversationId?: string): Promise<T> {
  codeModeScopeDepth += 1
  const prevConvId = activeCodeModeConversationId
  if (conversationId) activeCodeModeConversationId = conversationId
  const done = () => {
    codeModeScopeDepth = Math.max(0, codeModeScopeDepth - 1)
    activeCodeModeConversationId = prevConvId
  }
  return Promise.resolve().then(fn).then(
    (res) => (done(), res),
    (err: unknown) => { done(); throw err }
  )
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
  return Object.assign(
    {
      method: String(input.httpMethod || input.method || 'GET').toUpperCase(),
      route: qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath,
      query_params: queryParams,
      body: parseJsonIfPossible(input.body),
      response,
      timestamp: input.timestamp || new Date().toISOString(),
      duration_ms: Math.max(0, Math.round(Number(input.durationMs || 0))),
    },
    typeof input.codemode === 'boolean' ? { codemode: input.codemode } : null,
    input.conversationId ? { conversation_id: input.conversationId } : null
  )
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
  const codemode = isInsideCodeModeApiScope()
  const conversationId = getActiveCodeModeConversationId() || undefined
  const push = (extra: BuildCodeModeApiCallEntryInput) =>
    getCodeModeApiCallsStore().push(
      buildCodeModeApiCallEntry(
        Object.assign(
          {
            timestamp,
            durationMs: Date.now() - startedAt,
            codemode: codemode || isInsideCodeModeApiScope(),
            conversationId: conversationId || getActiveCodeModeConversationId() || undefined,
          },
          base,
          extra
        )
      )
    )
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
        if (isInsideCodeModeApiScope()) return Promise.resolve(origFn.apply(wrappedsdk, args))
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
        !isInsideCodeModeApiScope() &&
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

