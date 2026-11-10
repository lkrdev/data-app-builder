import type { Looker40SDK } from '@looker/sdk'

import { CONVERSATION_LABEL_REQUEST_TAG, STARTER_PROMPTS_REQUEST_TAG } from './antigravityPrompts'
import { buildDynamicStarterPrompts, sanitizeConversationLabel, type StarterExploreFieldSummary } from './antigravityStarters'
import { resolveBuiltinWorkspaceFileContent } from './antigravitySteps'
import {
  ANTIGRAVITY_ALLOWED_MODELS,
  type AntigravityAuth,
  type AntigravityExtensionHostLike,
  type AntigravityInteractionOutput,
  type AntigravityInteractionPayload,
  type AntigravityInteractionStep,
  type AntigravityModelOption,
  type AntigravityUsageMetadata,
} from './antigravityTypes'
import { extractResolvedUseCase, type StudioUseCase } from './lookerApi'

export function getGeminiSecretKeyTag(extensionSDK: AntigravityExtensionHostLike): string {
  return typeof extensionSDK?.createSecretKeyTag === 'function'
    ? extensionSDK.createSecretKeyTag('gemini_api_key')
    : '{{data_app_builder_data_app_builder_gemini_api_key}}'
}

export function getGeminiUserAttributeName(extensionSDK: AntigravityExtensionHostLike): string {
  return getGeminiSecretKeyTag(extensionSDK).replace(/^\{\{|\}\}$/g, '')
}

export function ensureGeminiApiKeyUserAttribute(
  sdk: Looker40SDK,
  extensionSDK: AntigravityExtensionHostLike,
  apiKeyValue?: string
): Promise<string> {
  const attrName = getGeminiUserAttributeName(extensionSDK)
  const trimmedKey = apiKeyValue?.trim()
  return Promise.resolve()
    .then(() => sdk.ok(sdk.all_user_attributes({ fields: 'id,name' })))
    .then((attrs) => {
      const existing = (attrs || []).find((a) => a.name === attrName)
      if (!existing) {
        return sdk.ok(
          sdk.create_user_attribute({
            name: attrName,
            label: 'Looker Agent Gemini API Key',
            type: 'string',
            value_is_hidden: true,
            user_can_view: false,
            user_can_edit: false,
            hidden_value_domain_whitelist: 'https://generativelanguage.googleapis.com/*',
            default_value: trimmedKey || undefined,
          })
        )
      }
      if (trimmedKey && existing.id) {
        return sdk.ok(sdk.update_user_attribute(String(existing.id), { default_value: trimmedKey }))
      }
      return undefined
    })
    .then(
      () => attrName,
      (err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err || '')
        throw new Error(
          `Looker Admin required to create/update hidden user attribute "${attrName}" (value_is_hidden=true, user_can_view=false, whitelist="https://generativelanguage.googleapis.com/*"): ${errMsg}`
        )
      }
    )
}

export interface GoogleOAuthOptions {
  signal?: AbortSignal
  timeoutMs?: number
  focusReturnDelayMs?: number
}

export interface LookerOAuthRedirectUris {
  extensionUri: string
  spartanUri: string
  activeUri: string
}

export function resolveLookerOAuthRedirectUris(
  hostUrl?: string | null,
  fallbackOrigin?: string,
  hostTypeOrPathname?: string | null
): LookerOAuthRedirectUris {
  const base = (
    hostUrl?.trim() ||
    fallbackOrigin ||
    (typeof window !== 'undefined' && window.location?.origin) ||
    'https://looker.example.com'
  ).replace(/\/+$/, '')
  const extensionUri = `${base}/extensions/oauth2_redirect`
  const spartanUri = `${base}/spartan/oauth2_redirect`
  const pathOrHostType =
    hostTypeOrPathname?.trim() || (typeof window !== 'undefined' && window.location?.pathname) || ''
  const isSpartan = pathOrHostType === 'spartan' || /^\/spartan(\/|$)/.test(pathOrHostType)
  return { extensionUri, spartanUri, activeUri: isSpartan ? spartanUri : extensionUri }
}

export function resolveLookerOAuthRedirectUri(hostUrl?: string | null, fallbackOrigin?: string): string {
  return resolveLookerOAuthRedirectUris(hostUrl, fallbackOrigin).extensionUri
}

export function computeIsAuthenticated(authMode: 'oauth' | 'apikey', oauthToken: string, apiKey: string): boolean {
  return authMode === 'apikey' ? Boolean(apiKey.trim()) : Boolean(oauthToken.trim())
}

export const STUDIO_OAUTH_STORAGE_KEY = 'dab_oauth_session'
export const STUDIO_OAUTH_REFRESH_LOCK_KEY = 'dab_oauth_refresh_lock'
export const STUDIO_OAUTH_REFRESH_INTERVAL_MS = 59 * 60 * 1000
export const STUDIO_OAUTH_REFRESH_LOCK_TTL_MS = 20_000

export interface StoredOAuthSession {
  token: string
  expiresAt: number
  clientId?: string
}

export interface OAuthRefreshResult {
  token: string
  expiresAt: number
  refreshedByOtherTab: boolean
  deferredUntilVisible?: boolean
}

export function parseValidOAuthSession(
  raw: string | null | undefined,
  clientId?: string
): { session: StoredOAuthSession | null; expired: boolean } {
  if (!raw?.trim()) return { session: null, expired: false }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredOAuthSession> | null
    const token = typeof parsed?.token === 'string' ? parsed.token.trim() : ''
    const expiresAt = Number(parsed?.expiresAt)
    if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { session: null, expired: true }
    const storedClientId = typeof parsed?.clientId === 'string' ? parsed.clientId.trim() : ''
    const expectedClientId = clientId?.trim() || ''
    if (expectedClientId && storedClientId && storedClientId !== expectedClientId) return { session: null, expired: false }
    return { session: { token, expiresAt, ...(storedClientId ? { clientId: storedClientId } : {}) }, expired: false }
  } catch {
    return { session: null, expired: true }
  }
}

export function clearStoredOAuthSession(extensionSDK?: AntigravityExtensionHostLike): void {
  try { if (typeof window !== 'undefined') window.localStorage?.removeItem?.(STUDIO_OAUTH_STORAGE_KEY) } catch { /* ignore */ }
  try {
    void extensionSDK?.localStorageRemoveItem?.(STUDIO_OAUTH_STORAGE_KEY)
    void extensionSDK?.localStorageSetItem?.(STUDIO_OAUTH_STORAGE_KEY, '')
  } catch { /* ignore */ }
}

export function persistOAuthSession(extensionSDK: AntigravityExtensionHostLike | undefined, session: StoredOAuthSession): void {
  const token = String(session?.token || '').trim()
  const expiresAt = Number(session?.expiresAt)
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return
  const cid = session.clientId?.trim()
  const serialized = JSON.stringify({ token, expiresAt, ...(cid ? { clientId: cid } : {}) })
  try { if (typeof window !== 'undefined') window.localStorage?.setItem?.(STUDIO_OAUTH_STORAGE_KEY, serialized) } catch { /* ignore */ }
  try { void extensionSDK?.localStorageSetItem?.(STUDIO_OAUTH_STORAGE_KEY, serialized) } catch { /* ignore */ }
}

export function getInitialStoredOAuthSession(clientId?: string): StoredOAuthSession | null {
  try {
    const w = typeof window !== 'undefined' ? window : undefined
    const mockExt = w?.__MOCK_LOOKER_EXTENSION__ as { initialOauthToken?: string; initialOauthExpiresAt?: number } | undefined
    if (mockExt && 'initialOauthToken' in mockExt) {
      const token = String(mockExt.initialOauthToken || '').trim()
      if (!token) return null
      const exp = Number(mockExt.initialOauthExpiresAt)
      return {
        token,
        expiresAt: Number.isFinite(exp) && exp > 0 ? exp : Date.now() + STUDIO_OAUTH_REFRESH_INTERVAL_MS,
        ...(clientId?.trim() ? { clientId: clientId.trim() } : {}),
      }
    }
    const { session, expired } = parseValidOAuthSession(w?.localStorage?.getItem?.(STUDIO_OAUTH_STORAGE_KEY), clientId)
    if (expired) clearStoredOAuthSession()
    return session
  } catch {
    return null
  }
}

export function getInitialStoredOAuthToken(clientId?: string): string {
  return getInitialStoredOAuthSession(clientId)?.token || ''
}

export function loadStoredOAuthSession(
  extensionSDK?: AntigravityExtensionHostLike,
  clientId?: string
): Promise<StoredOAuthSession | null> {
  return Promise.resolve()
    .then(() => extensionSDK?.localStorageGetItem?.(STUDIO_OAUTH_STORAGE_KEY))
    .then((extRaw) => {
      const raw = extRaw?.trim() || (typeof window !== 'undefined' ? window.localStorage?.getItem?.(STUDIO_OAUTH_STORAGE_KEY) : null)
      const { session, expired } = parseValidOAuthSession(raw, clientId)
      if (expired) clearStoredOAuthSession(extensionSDK)
      return session
    })
    .catch(() => null)
}

let hostOAuthWedged = false
export const isHostOAuthWedged = (): boolean => hostOAuthWedged
export const resetHostOAuthWedged = (): void => { hostOAuthWedged = false }

export function loginWithGoogleOAuth(
  extensionSDK: AntigravityExtensionHostLike,
  clientId: string,
  options?: GoogleOAuthOptions
): Promise<string> {
  if (!extensionSDK?.oauth2Authenticate) return Promise.reject(new Error('Looker Extension SDK oauth2Authenticate is not available.'))
  const focusReturnDelayMs = options?.focusReturnDelayMs ?? 1500
  const timeoutMs = options?.timeoutMs ?? 120000
  let cleanup = () => {}
  let authSettled = false
  return new Promise<{ access_token?: string; id_token?: string; expires_in?: number | string }>((resolveRace, rejectRace) => {
    Promise.resolve(
      extensionSDK.oauth2Authenticate(
        'https://accounts.google.com/o/oauth2/v2/auth',
        {
          client_id: clientId.trim(),
          scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever',
          response_type: 'token',
        },
        'GET'
      )
    ).then(
      (r) => { authSettled = true; hostOAuthWedged = false; resolveRace(r) },
      (e) => { authSettled = true; hostOAuthWedged = false; rejectRace(e) }
    )
    let focusTimer: ReturnType<typeof setTimeout> | null = null
    const settleOrReject = (err: Error) => void loadStoredOAuthSession(extensionSDK, clientId).then((s) =>
      s?.token ? (authSettled = true, hostOAuthWedged = false, resolveRace({ access_token: s.token, expires_in: Math.max(60, Math.round((s.expiresAt - Date.now()) / 1000) + 60) })) : rejectRace(err)
    )
    const timeoutTimer = setTimeout(() => settleOrReject(new Error('Google OAuth sign-in timed out.')), timeoutMs)
    const onFocus = () => {
      if (focusTimer) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => settleOrReject(new Error('Google OAuth popup closed or failed before completing (check Authorized redirect URIs in /config if you saw Error 400: redirect_uri_mismatch).')), focusReturnDelayMs)
    }
    const onVis = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') onFocus() }
    const onAbort = () => rejectRace(new Error('Google OAuth sign-in cancelled.'))
    if (options?.signal?.aborted) return onAbort()
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    if (typeof window !== 'undefined') window.addEventListener?.('focus', onFocus)
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', onVis)
    cleanup = () => {
      clearTimeout(timeoutTimer); if (focusTimer) clearTimeout(focusTimer)
      options?.signal?.removeEventListener('abort', onAbort)
      if (typeof window !== 'undefined') window.removeEventListener?.('focus', onFocus)
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', onVis)
    }
  }).then(
    (res) => {
      cleanup()
      const rawToken = res?.access_token
      if (!rawToken) {
        if (!authSettled) hostOAuthWedged = true
        throw new Error(`Google OAuth response did not include an access_token: ${JSON.stringify(res)}`)
      }
      const token = String(rawToken).trim()
      const expiresAt = Date.now() + Math.max(60, (Number(res?.expires_in) || 3600) - 60) * 1000
      persistOAuthSession(extensionSDK, { token, expiresAt, clientId: clientId.trim() })
      return token
    },
    (err) => {
      cleanup()
      if (!authSettled) hostOAuthWedged = true
      throw err
    }
  )
}

export const authenticateGoogleOAuth = loginWithGoogleOAuth

let inFlightOAuthRefreshPromise: Promise<string> | null = null

export function refreshOAuthSessionIfNeeded(opts: {
  extensionSDK: AntigravityExtensionHostLike
  clientId: string
  tabId?: string
  force?: boolean
  currentToken?: string
  lockWaitMs?: number
  oauthOptions?: GoogleOAuthOptions
}): Promise<OAuthRefreshResult> {
  const { extensionSDK, clientId, force = false, currentToken, lockWaitMs = 25, oauthOptions } = opts
  const effectiveTabId = (opts.tabId || 'default_tab').trim()
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return Promise.resolve({ token: '', expiresAt: 0, refreshedByOtherTab: false, deferredUntilVisible: true })
  }
  return loadStoredOAuthSession(extensionSDK, clientId).then((stored) => {
    if (stored && stored.expiresAt > Date.now() && (!force || (Boolean(currentToken?.trim()) && stored.token !== currentToken?.trim()))) {
      return { token: stored.token, expiresAt: stored.expiresAt, refreshedByOtherTab: true, deferredUntilVisible: false }
    }
    const ls = typeof window !== 'undefined' ? window.localStorage : undefined
    const readLock = (): { tabId?: string; expiresAt?: number } | null => {
      try { const raw = ls?.getItem?.(STUDIO_OAUTH_REFRESH_LOCK_KEY); return raw ? (JSON.parse(raw) as { tabId?: string; expiresAt?: number }) : null } catch { return null }
    }
    const existingLock = readLock()
    if (existingLock && Number(existingLock.expiresAt) > Date.now() && existingLock.tabId && existingLock.tabId !== effectiveTabId) {
      const waitP: Promise<unknown> = inFlightOAuthRefreshPromise
        ? inFlightOAuthRefreshPromise.catch(() => '')
        : lockWaitMs > 0 ? new Promise((r) => setTimeout(r, lockWaitMs)) : Promise.resolve()
      return waitP.then(() => loadStoredOAuthSession(extensionSDK, clientId)).then((afterLock) => ({
        token: afterLock?.token || '', expiresAt: afterLock?.expiresAt || 0, refreshedByOtherTab: true, deferredUntilVisible: false,
      }))
    }
    try { ls?.setItem?.(STUDIO_OAUTH_REFRESH_LOCK_KEY, JSON.stringify({ tabId: effectiveTabId, expiresAt: Date.now() + STUDIO_OAUTH_REFRESH_LOCK_TTL_MS })) } catch { /* ignore */ }
    const loginPromise = loginWithGoogleOAuth(extensionSDK, clientId, oauthOptions)
    inFlightOAuthRefreshPromise = loginPromise
    const releaseLock = () => {
      if (inFlightOAuthRefreshPromise === loginPromise) inFlightOAuthRefreshPromise = null
      try { const curLock = readLock(); if (!curLock || curLock.tabId === effectiveTabId) ls?.removeItem?.(STUDIO_OAUTH_REFRESH_LOCK_KEY) } catch { /* ignore */ }
    }
    return loginPromise.then(
      (token) => loadStoredOAuthSession(extensionSDK, clientId).then((refreshed) => {
        releaseLock()
        return { token, expiresAt: refreshed?.expiresAt || Date.now() + STUDIO_OAUTH_REFRESH_INTERVAL_MS, refreshedByOtherTab: false, deferredUntilVisible: false }
      }, (e) => { releaseLock(); throw e }),
      (e) => { releaseLock(); throw e }
    )
  })
}

export function callInteractionsApi(
  extensionSDK: AntigravityExtensionHostLike,
  auth: AntigravityAuth,
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
): Promise<AntigravityInteractionPayload> {
  const url = `https://generativelanguage.googleapis.com/v1beta/${path.replace(/^\//, '')}`
  const serializedBody = body ? JSON.stringify(body) : undefined

  if (auth.mode === 'apikey' && extensionSDK?.serverProxy) {
    return Promise.resolve(
      extensionSDK.serverProxy(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': auth.apiKey?.trim() || getGeminiSecretKeyTag(extensionSDK),
        },
        body: serializedBody,
      })
    ).then((proxyResp) => {
      const parsed: AntigravityInteractionPayload =
        typeof proxyResp?.body === 'string'
          ? (() => { try { return JSON.parse(proxyResp.body) as AntigravityInteractionPayload } catch { return { raw: proxyResp.body } } })()
          : ((proxyResp?.body || {}) as AntigravityInteractionPayload)
      if (!proxyResp?.ok || (proxyResp?.status && proxyResp.status >= 400)) {
        const msg = parsed?.error?.message || JSON.stringify(parsed) || `HTTP ${proxyResp?.status}`
        throw new Error(`Antigravity API error (${proxyResp?.status}): ${msg}`)
      }
      return parsed
    })
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth.mode === 'oauth') {
    if (!auth.oauthToken?.trim()) return Promise.reject(new Error('Please sign in with Google OAuth first.'))
    if (typeof window !== 'undefined' && window.__MOCK_LOOKER_EXTENSION__) {
      const mockInteractions = (window.__MOCK_LOOKER_EXTENSION__ as { mockInteractions?: Record<string, AntigravityInteractionPayload> }).mockInteractions
      if (method === 'GET' && /^interactions\//i.test(path)) {
        const reqId = decodeURIComponent(path.replace(/^interactions\//i, '').split('?')[0] || '').trim()
        if (mockInteractions && mockInteractions[reqId]) return Promise.resolve(mockInteractions[reqId])
        return Promise.resolve({ id: reqId || 'int_mock_get', status: 'completed', output_text: 'Mock sandbox interaction trace.' })
      }
      if (/:cancel$/i.test(path)) return Promise.resolve({ id: path.replace(/^interactions\//i, '').replace(/:cancel$/i, ''), status: 'cancelled' })
      const inputArr = Array.isArray(body?.input) ? (body?.input as Array<{ text?: string }>) : []
      const promptText = String(inputArr[0]?.text || '')
      if (promptText.includes(CONVERSATION_LABEL_REQUEST_TAG)) {
        return Promise.resolve({ id: 'int_mock_label', status: 'completed', output_text: sanitizeConversationLabel('', promptText) })
      }
      if (promptText.includes(STARTER_PROMPTS_REQUEST_TAG)) {
        const ucMatch = promptText.match(/Active useCase:\s*([^\r\n]+)/i)?.[1]?.trim() || 'auto'
        const permittedMatch = promptText.match(/Permitted use cases:\s*([^\r\n]+)/i)?.[1]?.split(',').map((s) => s.trim() as StudioUseCase).filter(Boolean)
        const targetMatch = promptText.match(/Target explore:\s*([^\s(\r\n]+)(?:\s*\(([^)\r\n]+)\))?/i)
        const expKey = targetMatch?.[1]?.trim()
        const expLabel = targetMatch?.[2]?.trim()
        const parseFieldLine = (prefix: string): StarterExploreFieldSummary[] => {
          const line = promptText.match(new RegExp(`${prefix}:\\s*([^\\r\\n]+)`, 'i'))?.[1]?.trim()
          if (!line) return []
          return line
            .split(',')
            .map((part) => {
              const m = part.trim().match(/^([^\s(]+)(?:\s*\(([^)]+)\))?$/)
              return m ? { name: m[1].trim(), label: (m[2] || m[1]).trim() } : null
            })
            .filter((x): x is StarterExploreFieldSummary => Boolean(x))
        }
        const [mName = '', eName = ''] = expKey && expKey !== 'none' ? (expKey.includes('::') ? expKey.split('::') : expKey.split('/')) : ['', '']
        const mockPrompts = buildDynamicStarterPrompts({
          useCase: ucMatch,
          selectedExplores: expKey && expKey !== 'none' ? [expKey] : [],
          permittedUseCases: permittedMatch,
          exploreContext:
            expKey && expKey !== 'none'
              ? {
                  modelName: mName,
                  modelLabel: mName,
                  exploreName: eName || expKey,
                  exploreLabel: expLabel || eName || expKey,
                  exploreKey: expKey,
                  measures: parseFieldLine('Top measures'),
                  dimensions: parseFieldLine('Top dimensions'),
                }
              : null,
        })
        return Promise.resolve({ id: 'int_mock_starter_prompts', status: 'completed', output_text: `<STARTER_PROMPTS>${JSON.stringify(mockPrompts)}</STARTER_PROMPTS>` })
      }
      if (promptText.includes('[CA_AGENT_SELECTION_REQUEST]')) {
        const idMatch = promptText.match(/"agent_id"\s*:\s*"([^"]+)"/)
        const selectedId = idMatch?.[1] || 'ad69f74cd9e2494090e9e9e9c50190c8'
        return Promise.resolve({
          id: 'int_mock_ca_selection',
          status: 'completed',
          output_text: JSON.stringify({
            agent_id: selectedId,
            rationale: 'Selected Looker CA agent via direct model stateless routing.',
          }),
        })
      }
      const isDirectStatelessModel =
        body?.store === false || (Boolean(body?.model) && !body?.agent)
      const userReqMatch = promptText.match(/User request:\s*([\s\S]*)$/i)
      const inferred = extractResolvedUseCase(undefined, userReqMatch ? userReqMatch[1].trim() : promptText)
      return Promise.resolve({
        id: `int_mock_${Date.now().toString(36).slice(-5)}`,
        ...(isDirectStatelessModel ? {} : { environment_id: `env_${inferred}_mock` }),
        status: 'completed',
        output_text: `<USE_CASE>${inferred}</USE_CASE>\nRouted turn via AGENTS.md to ${inferred}.`,
      })
    }
    headers['Authorization'] = `Bearer ${auth.oauthToken.trim()}`
    if (auth.projectId?.trim()) headers['x-goog-user-project'] = auth.projectId.trim()
  } else {
    if (!auth.apiKey?.trim()) return Promise.reject(new Error('Gemini API Key is not configured.'))
    headers['x-goog-api-key'] = auth.apiKey.trim()
  }

  return fetch(url, { method, headers, body: serializedBody }).then((resp) =>
    resp.text().then((text) => {
      let parsed: AntigravityInteractionPayload
      try { parsed = text ? (JSON.parse(text) as AntigravityInteractionPayload) : {} } catch { parsed = { raw: text } }
      if (!resp.ok) {
        const fail = (): never => {
          throw new Error(`Antigravity API error (${resp.status}): ${parsed?.error?.message || text || `HTTP ${resp.status}`}`)
        }
        if (resp.status === 401) {
          clearStoredOAuthSession(extensionSDK)
          if (auth.mode === 'oauth' && typeof auth.onUnauthorizedRefresh === 'function') {
            return auth.onUnauthorizedRefresh().catch(() => null).then((rt) => {
              const refreshedToken = rt?.trim()
              if (refreshedToken) {
                return callInteractionsApi(extensionSDK, { ...auth, oauthToken: refreshedToken, onUnauthorizedRefresh: undefined }, path, method, body)
              }
              clearStoredOAuthSession(extensionSDK)
              return fail()
            })
          }
        }
        return fail()
      }
      return parsed
    })
  )
}

export function listAvailableAntigravityModels(
  extensionSDK: AntigravityExtensionHostLike,
  auth: AntigravityAuth
): Promise<AntigravityModelOption[]> {
  const canQuery = auth.mode === 'oauth' ? Boolean(auth.oauthToken?.trim()) : Boolean(auth.apiKey?.trim() || extensionSDK?.serverProxy)
  if (!canQuery) return Promise.resolve(ANTIGRAVITY_ALLOWED_MODELS)
  return callInteractionsApi(extensionSDK, auth, 'models', 'GET')
    .then((res) => {
      const byId = new Map<string, { name?: string; displayName?: string; description?: string }>(
        (Array.isArray(res?.models) ? res.models : []).map((m) => [String(m?.name || '').replace(/^models\//, '').trim(), m])
      )
      const matched = ANTIGRAVITY_ALLOWED_MODELS.filter((a) => byId.has(a.id)).map((a) => {
        const m = byId.get(a.id)
        return { id: a.id, label: String(m?.displayName || a.label), description: String(m?.description || a.description) }
      })
      return matched.length > 0 ? matched : ANTIGRAVITY_ALLOWED_MODELS
    })
    .catch(() => ANTIGRAVITY_ALLOWED_MODELS)
}

export function normalizeSandboxFilePath(rawPath: string): string {
  return String(rawPath || '').trim().replace(/^file:\/\//i, '').replace(/^\/+/, '')
}

export function fetchEnvironmentFile(params: {
  extensionSDK: AntigravityExtensionHostLike
  auth: AntigravityAuth
  environmentId: string
  path: string
}): Promise<string> {
  const { extensionSDK, auth } = params
  const rawKey = String(params.path || '').trim()
  const normalizedPath = normalizeSandboxFilePath(rawKey)
  if (!normalizedPath) return Promise.reject(new Error('Sandbox file path is required.'))
  const slashKey = `/${normalizedPath}`
  const builtin = resolveBuiltinWorkspaceFileContent(rawKey)
  const envId = String(params.environmentId || '').trim()

  const mockWin = typeof window !== 'undefined'
    ? (window as unknown as {
        __MOCK_LOOKER_EXTENSION__?: { environmentFiles?: Record<string, string> }
        __ENVIRONMENT_FILE_CALLS__?: Array<{ environmentId: string; path: string; normalizedPath: string; url: string }>
      })
    : undefined
  if (mockWin?.__MOCK_LOOKER_EXTENSION__) {
    const filesMap = mockWin.__MOCK_LOOKER_EXTENSION__.environmentFiles || {}
    const baseName = normalizedPath.split('/').pop() || normalizedPath
    const mockOverride =
      filesMap[`${envId}:${rawKey}`] ?? filesMap[`${envId}:${normalizedPath}`] ?? filesMap[`${envId}:${slashKey}`] ??
      filesMap[rawKey] ?? filesMap[normalizedPath] ?? filesMap[slashKey] ?? filesMap[baseName]
    if (typeof mockOverride !== 'string' && typeof builtin === 'string') return Promise.resolve(builtin)
    const encodedMock = normalizedPath.split('/').filter(Boolean).map((seg) => encodeURIComponent(seg)).join('/')
    const mockUrl = `https://generativelanguage.googleapis.com/v1beta/environments/${encodeURIComponent(envId)}/files/${encodedMock}?alt=media`
    ;(mockWin.__ENVIRONMENT_FILE_CALLS__ ||= []).push({ environmentId: envId, path: rawKey, normalizedPath, url: mockUrl })
    if (typeof mockOverride === 'string') return Promise.resolve(mockOverride)
    return Promise.resolve(`# ${baseName}\n\nFetched on-demand from remote sandbox \`/${normalizedPath}\` in environment \`${envId}\`.\n\n- **Environment:** \`${envId}\`\n- **Path:** \`/${normalizedPath}\`\n- **Persistence:** Ephemeral in-memory session state (never stored on Looker instance)`)
  }
  if (typeof builtin === 'string') return Promise.resolve(builtin)
  if (!envId) return Promise.reject(new Error('Sandbox environmentId is required.'))
  const encodedPath = normalizedPath.split('/').filter(Boolean).map((seg) => encodeURIComponent(seg)).join('/')
  const url = `https://generativelanguage.googleapis.com/v1beta/environments/${encodeURIComponent(envId)}/files/${encodedPath}?alt=media`

  if (auth.mode === 'apikey' && extensionSDK?.serverProxy) {
    return Promise.resolve(
      extensionSDK.serverProxy(url, {
        method: 'GET',
        headers: { 'x-goog-api-key': auth.apiKey?.trim() || getGeminiSecretKeyTag(extensionSDK) },
      })
    ).then((proxyResp) => {
      if (!proxyResp?.ok || (proxyResp?.status && proxyResp.status >= 400)) {
        const errBody = typeof proxyResp?.body === 'string' ? proxyResp.body : JSON.stringify(proxyResp?.body || {})
        throw new Error(`Antigravity file fetch error (${proxyResp?.status}): ${errBody || `HTTP ${proxyResp?.status}`}`)
      }
      if (typeof proxyResp?.body === 'string') return proxyResp.body
      if (proxyResp?.body && typeof proxyResp.body === 'object') {
        const obj = proxyResp.body as Record<string, unknown>
        const k = ['content', 'data', 'raw'].find((x) => typeof obj[x] === 'string')
        if (k) return obj[k] as string
        return JSON.stringify(proxyResp.body, null, 2)
      }
      return ''
    })
  }

  const headers: Record<string, string> = {}
  if (auth.mode === 'oauth') {
    if (!auth.oauthToken?.trim()) return Promise.reject(new Error('Please sign in with Google OAuth first.'))
    headers['Authorization'] = `Bearer ${auth.oauthToken.trim()}`
    if (auth.projectId?.trim()) headers['x-goog-user-project'] = auth.projectId.trim()
  } else {
    if (!auth.apiKey?.trim()) return Promise.reject(new Error('Gemini API Key is not configured.'))
    headers['x-goog-api-key'] = auth.apiKey.trim()
  }

  return fetch(url, { method: 'GET', headers }).then((resp) =>
    resp.text().then((text) => {
      if (!resp.ok) {
        const fail = (): never => {
          let errMsg = text || `HTTP ${resp.status}`
          try {
            const parsed = text ? (JSON.parse(text) as { error?: { message?: string } }) : undefined
            if (parsed?.error?.message) errMsg = parsed.error.message
          } catch { /* ignore */ }
          throw new Error(`Antigravity file fetch error (${resp.status}): ${errMsg}`)
        }
        if (resp.status === 401) {
          clearStoredOAuthSession(extensionSDK)
          if (auth.mode === 'oauth' && typeof auth.onUnauthorizedRefresh === 'function') {
            return auth.onUnauthorizedRefresh().catch(() => null).then((rt) => {
              const refreshedToken = rt?.trim()
              if (refreshedToken) {
                return fetchEnvironmentFile({
                  extensionSDK,
                  auth: { ...auth, oauthToken: refreshedToken, onUnauthorizedRefresh: undefined },
                  environmentId: envId,
                  path: normalizedPath,
                })
              }
              clearStoredOAuthSession(extensionSDK)
              return fail()
            })
          }
        }
        return fail()
      }
      return text
    })
  )
}

export interface StreamInteractionOptions {
  extensionSDK?: AntigravityExtensionHostLike; auth: AntigravityAuth; interactionId: string
  initialInteraction?: AntigravityInteractionPayload; lastEventId?: string; maxReconnects?: number
  signal?: AbortSignal; fetchImpl?: typeof fetch; allowMockWindow?: boolean
  onUpdate?: (interaction: AntigravityInteractionPayload, eventId?: string) => void
}
export interface StreamInteractionResult {
  interaction: AntigravityInteractionPayload | null; streamed: boolean; eventCount: number; lastEventId?: string
}

export function mergeInteractionSseEvent(
  current: AntigravityInteractionPayload,
  eventType: string,
  rawData: Record<string, unknown>
): AntigravityInteractionPayload {
  const data = rawData.interaction && typeof rawData.interaction === 'object'
    ? { ...rawData, ...(rawData.interaction as Record<string, unknown>) }
    : rawData
  const evt = String(eventType || data.type || '').trim()
  let nextStatus = typeof data.status === 'string' ? data.status : current.status
  if (!data.status) {
    if (evt === 'interaction.complete' || evt === 'completed' || evt === 'done') nextStatus = 'completed'
    else if (evt === 'interaction.requires_action' || evt === 'requires_action') nextStatus = 'requires_action'
    else if (evt === 'interaction.incomplete' || evt === 'incomplete') nextStatus = 'incomplete'
    else if (evt === 'interaction.failed' || evt === 'failed') nextStatus = 'failed'
  }
  let nextSteps = Array.isArray(data.steps) ? [...(data.steps as AntigravityInteractionStep[])] : [...(current.steps || [])]
  if (evt === 'step.delta' || evt === 'step' || Boolean(data.step_delta || data.step)) {
    const stepObj = (data.step_delta || data.step || data.delta || data) as AntigravityInteractionStep
    if (stepObj && typeof stepObj === 'object') {
      const stepId = stepObj.id || stepObj.call_id
      const append = evt === 'step.delta' || Boolean(data.step_delta || data.delta)
      const stepIdx = (stepObj as { index?: unknown }).index
      const last = nextSteps[nextSteps.length - 1]
      const idx = stepId
        ? nextSteps.findIndex((s) => (s.id || s.call_id) === stepId)
        : append && typeof stepIdx === 'number'
        ? nextSteps.findIndex((s, i) => ((s as { index?: unknown }).index ?? i) === stepIdx)
        : append && last && (last.type === stepObj.type || !stepObj.type || !last.type)
        ? nextSteps.length - 1
        : -1
      if (idx >= 0) {
        const prev = nextSteps[idx]
        const mergeArgs = (a: unknown, b: unknown): unknown => {
          if (b === undefined) return a
          if (typeof a === 'string' && typeof b === 'string') {
            return append || !b.trimStart().startsWith('{') ? `${a}${b}` : b
          }
          if (a && typeof a === 'object' && !Array.isArray(a) && b && typeof b === 'object' && !Array.isArray(b)) {
            return { ...(a as Record<string, unknown>), ...(b as Record<string, unknown>) }
          }
          return b
        }
        const mergedArgs = mergeArgs(prev.arguments, stepObj.arguments)
        const mergedAltArgs = mergeArgs(prev.args, stepObj.args)
        const mergedFc = prev.function_call || stepObj.function_call
          ? {
              ...prev.function_call,
              ...stepObj.function_call,
              ...(mergeArgs(prev.function_call?.arguments, stepObj.function_call?.arguments) !== undefined
                ? { arguments: mergeArgs(prev.function_call?.arguments, stepObj.function_call?.arguments) }
                : {}),
              ...(mergeArgs(prev.function_call?.args, stepObj.function_call?.args) !== undefined
                ? { args: mergeArgs(prev.function_call?.args, stepObj.function_call?.args) }
                : {}),
            }
          : undefined
        nextSteps[idx] = {
          ...prev, ...stepObj,
          ...(prev.type && !stepObj.type ? { type: prev.type } : {}),
          ...(prev.id && !stepObj.id ? { id: prev.id } : {}),
          ...(prev.name && !stepObj.name ? { name: prev.name } : {}),
          ...(mergedArgs !== undefined ? { arguments: mergedArgs } : {}),
          ...(mergedAltArgs !== undefined ? { args: mergedAltArgs } : {}),
          ...(mergedFc ? { function_call: mergedFc } : {}),
          ...(append && typeof prev.code === 'string' && typeof stepObj.code === 'string' ? { code: `${prev.code}${stepObj.code}` } : {}),
          ...(append && typeof prev.command === 'string' && typeof stepObj.command === 'string' ? { command: `${prev.command}${stepObj.command}` } : {}),
          ...(append && typeof prev.text === 'string' && typeof stepObj.text === 'string' ? { text: `${prev.text}${stepObj.text}` } : {}),
          ...(append && typeof prev.thought === 'string' && typeof stepObj.thought === 'string' ? { thought: `${prev.thought}${stepObj.thought}` } : {}),
        }
      } else {
        nextSteps = [...nextSteps, stepObj]
      }
    }
  }
  let nextOutputText = current.output_text
  if (evt === 'content.delta' || Boolean(data.content_delta) || typeof data.text_delta === 'string') {
    const d = (data.content_delta || data.delta || data) as { text?: string; text_delta?: string }
    nextOutputText = `${current.output_text || ''}${String(d.text_delta ?? d.text ?? data.text_delta ?? '')}`
  } else if (typeof data.output_text === 'string') {
    nextOutputText = data.output_text
  }
  return {
    ...current,
    ...(typeof data.id === 'string' && data.id ? { id: data.id } : {}),
    ...(nextStatus ? { status: nextStatus } : {}),
    ...(typeof data.environment_id === 'string' && data.environment_id ? { environment_id: data.environment_id } : {}),
    ...(nextOutputText !== undefined ? { output_text: nextOutputText } : {}),
    ...(Array.isArray(data.outputs) ? { outputs: data.outputs as AntigravityInteractionOutput[] } : {}),
    ...(nextSteps.length > 0 ? { steps: nextSteps } : {}),
    ...(data.error && typeof data.error === 'object' ? { error: data.error as { message?: string } } : {}),
    ...(data.usage && typeof data.usage === 'object' ? { usage: data.usage as AntigravityUsageMetadata } : {}),
    ...(data.usage_metadata && typeof data.usage_metadata === 'object' ? { usage_metadata: data.usage_metadata as AntigravityUsageMetadata } : {}),
  }
}

export function streamInteractionUntilActionOrDone(options: StreamInteractionOptions): Promise<StreamInteractionResult> {
  const { auth, interactionId, initialInteraction, lastEventId: initialLastEventId, maxReconnects = 1, signal, fetchImpl, allowMockWindow = false, onUpdate } = options
  const cleanId = String(interactionId || '').trim()
  const effectiveFetch = fetchImpl || (typeof fetch === 'function' ? fetch : undefined)
  if (
    auth.mode !== 'oauth' || !auth.oauthToken?.trim() || !cleanId || !effectiveFetch ||
    (typeof window !== 'undefined' && window.__MOCK_LOOKER_EXTENSION__ && !allowMockWindow && !fetchImpl)
  ) {
    return Promise.resolve({ interaction: initialInteraction || null, streamed: false, eventCount: 0, lastEventId: initialLastEventId })
  }
  let currentInteraction: AntigravityInteractionPayload = initialInteraction ? { ...initialInteraction, id: initialInteraction.id || cleanId } : { id: cleanId, status: 'in_progress' }
  let currentLastEventId: string | undefined = initialLastEventId
  let eventCount = 0
  const isTerminal = (s?: string) =>
    s === 'completed' || s === 'requires_action' || s === 'incomplete' || s === 'failed' || s === 'cancelled'
  const buildResult = (): StreamInteractionResult => ({
    interaction: eventCount > 0 ? currentInteraction : initialInteraction || null,
    streamed: eventCount > 0,
    eventCount,
    lastEventId: currentLastEventId,
  })

  const runAttempt = (attempt: number): Promise<StreamInteractionResult> => {
    if (attempt > maxReconnects || signal?.aborted) return Promise.resolve(buildResult())
    const sseUrl = `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(cleanId)}?stream=true&alt=sse${currentLastEventId ? `&last_event_id=${encodeURIComponent(currentLastEventId)}` : ''}`
    return Promise.resolve()
      .then(() =>
        effectiveFetch(sseUrl, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${auth.oauthToken!.trim()}`,
            ...(auth.projectId?.trim() ? { 'x-goog-user-project': auth.projectId.trim() } : {}),
            ...(currentLastEventId ? { 'Last-Event-ID': currentLastEventId } : {}),
          },
          signal,
        })
      )
      .then(
        (resp) => {
          if (!resp?.ok) return buildResult()
          const contentType = String(resp.headers?.get?.('content-type') || '').toLowerCase()
          const hasReader = typeof resp.body?.getReader === 'function'
          if ((contentType || !hasReader) && !contentType.includes('text/event-stream')) return buildResult()

          let buffer = ''
          let frameId: string | undefined
          let frameEvent = ''
          let dataLines: string[] = []
          let sawDone = false
          const beforeCount = eventCount

          const flushFrame = (): boolean => {
            if (dataLines.length === 0 && !frameEvent && !frameId) return false
            if (frameId) currentLastEventId = frameId
            const rawPayload = dataLines.join('\n').trim()
            const evt = frameEvent
            frameId = undefined; frameEvent = ''; dataLines = []
            if (!rawPayload) return false
            if (rawPayload === '[DONE]') { sawDone = true; return true }
            try {
              const parsed = JSON.parse(rawPayload) as Record<string, unknown>
              if (parsed && typeof parsed === 'object') {
                currentInteraction = mergeInteractionSseEvent(currentInteraction, evt, parsed)
                eventCount += 1
                onUpdate?.(currentInteraction, currentLastEventId)
              }
            } catch { /* ignore non-JSON SSE commentary */ }
            return isTerminal(currentInteraction.status)
          }

          const processChunkText = (chunkText: string): boolean => {
            buffer += chunkText
            for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
              const line = buffer.slice(0, nl).replace(/\r$/, '')
              buffer = buffer.slice(nl + 1)
              if (line === '') {
                if (flushFrame()) return true
              } else if (!line.startsWith(':')) {
                const cIdx = line.indexOf(':')
                const field = cIdx >= 0 ? line.slice(0, cIdx).trim() : line.trim()
                const val = cIdx >= 0 ? line.slice(cIdx + 1).replace(/^ /, '') : ''
                if (field === 'id') frameId = val
                else if (field === 'event') frameEvent = val
                else if (field === 'data') dataLines.push(val)
              }
            }
            return false
          }

          const consumePromise: Promise<void> =
            hasReader && resp.body
              ? (() => {
                  const reader = resp.body.getReader()
                  const decoder = new TextDecoder()
                  const pump = (): Promise<void> =>
                    reader.read().then(({ done, value }) => {
                      if (done) {
                        const tail = decoder.decode()
                        if (tail) processChunkText(tail)
                        if (buffer.trim()) processChunkText('\n\n')
                        else flushFrame()
                        return
                      }
                      if (processChunkText(typeof value === 'string' ? value : decoder.decode(value, { stream: true }))) {
                        return reader.cancel().catch(() => {})
                      }
                      return pump()
                    })
                  return pump().finally(() => {
                    try { reader.releaseLock() } catch { /* ignore */ }
                  })
                })()
              : typeof resp.text === 'function'
              ? resp.text().then((txt) => { processChunkText(`${txt}\n\n`) })
              : Promise.resolve()

          return consumePromise
            .catch(() => { /* stream dropped mid-flight; reconnect with last_event_id if available */ })
            .then(() =>
              isTerminal(currentInteraction.status) || sawDone || !currentLastEventId || eventCount === beforeCount
                ? buildResult()
                : runAttempt(attempt + 1)
            )
        },
        () => buildResult()
      )
  }

  return runAttempt(0)
}
