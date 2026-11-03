import type { Looker40SDK } from '@looker/sdk'

import {
  CONVERSATION_LABEL_REQUEST_TAG,
  STARTER_PROMPTS_REQUEST_TAG,
} from './antigravityPrompts'
import {
  buildDynamicStarterPrompts,
  sanitizeConversationLabel,
  type StarterExploreFieldSummary,
} from './antigravityStarters'
import {
  ANTIGRAVITY_ALLOWED_MODELS,
  type AntigravityAuth,
  type AntigravityExtensionHostLike,
  type AntigravityInteractionPayload,
  type AntigravityModelOption,
} from './antigravityTypes'
import { extractResolvedUseCase, type StudioUseCase } from './lookerApi'

export function getGeminiSecretKeyTag(extensionSDK: AntigravityExtensionHostLike): string {
  if (extensionSDK && typeof extensionSDK.createSecretKeyTag === 'function') {
    return extensionSDK.createSecretKeyTag('gemini_api_key')
  }
  return '{{data_app_builder_data_app_builder_gemini_api_key}}'
}

export function getGeminiUserAttributeName(extensionSDK: AntigravityExtensionHostLike): string {
  return getGeminiSecretKeyTag(extensionSDK).replace(/^\{\{|\}\}$/g, '')
}

export async function ensureGeminiApiKeyUserAttribute(
  sdk: Looker40SDK,
  extensionSDK: AntigravityExtensionHostLike,
  apiKeyValue?: string
): Promise<string> {
  const attrName = getGeminiUserAttributeName(extensionSDK)
  const trimmedKey = apiKeyValue?.trim()
  try {
    const attrs = await sdk.ok(sdk.all_user_attributes({ fields: 'id,name' }))
    const existing = (attrs || []).find((a) => a.name === attrName)
    if (!existing) {
      await sdk.ok(
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
    } else if (trimmedKey && existing.id) {
      await sdk.ok(
        sdk.update_user_attribute(String(existing.id), {
          default_value: trimmedKey,
        })
      )
    }
    return attrName
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err || '')
    throw new Error(
      `Looker Admin required to create/update hidden user attribute "${attrName}" (value_is_hidden=true, user_can_view=false, whitelist="https://generativelanguage.googleapis.com/*"): ${errMsg}`
    )
  }
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
    (hostUrl && hostUrl.trim()) ||
    fallbackOrigin ||
    (typeof window !== 'undefined' && window.location?.origin) ||
    'https://looker.example.com'
  ).replace(/\/+$/, '')
  const extensionUri = `${base}/extensions/oauth2_redirect`
  const spartanUri = `${base}/spartan/oauth2_redirect`
  const pathOrHostType =
    (hostTypeOrPathname && hostTypeOrPathname.trim()) ||
    (typeof window !== 'undefined' && window.location?.pathname) ||
    ''
  const isSpartan =
    pathOrHostType === 'spartan' || /^\/spartan(\/|$)/.test(pathOrHostType)
  return {
    extensionUri,
    spartanUri,
    activeUri: isSpartan ? spartanUri : extensionUri,
  }
}

export function resolveLookerOAuthRedirectUri(
  hostUrl?: string | null,
  fallbackOrigin?: string
): string {
  return resolveLookerOAuthRedirectUris(hostUrl, fallbackOrigin).extensionUri
}

export function computeIsAuthenticated(
  authMode: 'oauth' | 'apikey',
  oauthToken: string,
  apiKey: string
): boolean {
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
    if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return { session: null, expired: true }
    }
    const storedClientId = typeof parsed?.clientId === 'string' ? parsed.clientId.trim() : ''
    const expectedClientId = clientId?.trim() || ''
    if (expectedClientId && storedClientId && storedClientId !== expectedClientId) {
      return { session: null, expired: false }
    }
    return {
      session: { token, expiresAt, ...(storedClientId ? { clientId: storedClientId } : {}) },
      expired: false,
    }
  } catch {
    return { session: null, expired: true }
  }
}

export function clearStoredOAuthSession(extensionSDK?: AntigravityExtensionHostLike): void {
  try {
    if (typeof window !== 'undefined') window.localStorage?.removeItem?.(STUDIO_OAUTH_STORAGE_KEY)
  } catch {
    // ignore browser storage removal failure
  }
  try {
    void extensionSDK?.localStorageRemoveItem?.(STUDIO_OAUTH_STORAGE_KEY)
    void extensionSDK?.localStorageSetItem?.(STUDIO_OAUTH_STORAGE_KEY, '')
  } catch {
    // ignore extensionSDK storage removal failure
  }
}

export function persistOAuthSession(
  extensionSDK: AntigravityExtensionHostLike | undefined,
  session: StoredOAuthSession
): void {
  const token = String(session?.token || '').trim()
  const expiresAt = Number(session?.expiresAt)
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return
  const cid = session.clientId?.trim()
  const serialized = JSON.stringify({ token, expiresAt, ...(cid ? { clientId: cid } : {}) })
  try {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem?.(STUDIO_OAUTH_STORAGE_KEY, serialized)
    }
  } catch {
    // ignore browser storage write failure
  }
  try {
    void extensionSDK?.localStorageSetItem?.(STUDIO_OAUTH_STORAGE_KEY, serialized)
  } catch {
    // ignore extensionSDK storage write failure
  }
}

export function getInitialStoredOAuthSession(clientId?: string): StoredOAuthSession | null {
  try {
    const w = typeof window !== 'undefined' ? window : undefined
    const mockExt = w?.__MOCK_LOOKER_EXTENSION__ as
      | { initialOauthToken?: string; initialOauthExpiresAt?: number }
      | undefined
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
    const { session, expired } = parseValidOAuthSession(
      w?.localStorage?.getItem?.(STUDIO_OAUTH_STORAGE_KEY),
      clientId
    )
    if (expired) clearStoredOAuthSession()
    return session
  } catch {
    return null
  }
}

export function getInitialStoredOAuthToken(clientId?: string): string {
  return getInitialStoredOAuthSession(clientId)?.token || ''
}

export async function loadStoredOAuthSession(
  extensionSDK?: AntigravityExtensionHostLike,
  clientId?: string
): Promise<StoredOAuthSession | null> {
  try {
    const extRaw = await extensionSDK?.localStorageGetItem?.(STUDIO_OAUTH_STORAGE_KEY)
    const raw =
      extRaw?.trim() ||
      (typeof window !== 'undefined'
        ? window.localStorage?.getItem?.(STUDIO_OAUTH_STORAGE_KEY)
        : null)
    const { session, expired } = parseValidOAuthSession(raw, clientId)
    if (expired) clearStoredOAuthSession(extensionSDK)
    return session
  } catch {
    return null
  }
}

export async function loginWithGoogleOAuth(
  extensionSDK: AntigravityExtensionHostLike,
  clientId: string,
  options?: GoogleOAuthOptions
): Promise<string> {
  const focusReturnDelayMs = options?.focusReturnDelayMs ?? 1500
  const timeoutMs = options?.timeoutMs ?? 120000
  let cleanup = () => {}
  try {
    if (!extensionSDK?.oauth2Authenticate) {
      throw new Error('Looker Extension SDK oauth2Authenticate is not available.')
    }
    const authPromise = Promise.resolve(
      extensionSDK.oauth2Authenticate(
        'https://accounts.google.com/o/oauth2/v2/auth',
        {
          client_id: clientId.trim(),
          scope:
            'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever',
          response_type: 'token',
        },
        'GET'
      )
    )
    const guardPromise = new Promise<never>((_resolve, reject) => {
      let focusTimer: ReturnType<typeof setTimeout> | null = null
      const timeoutTimer = setTimeout(() => reject(new Error('Google OAuth sign-in timed out.')), timeoutMs)
      const onFocus = () => {
        if (focusTimer) clearTimeout(focusTimer)
        focusTimer = setTimeout(
          () => reject(new Error('Google OAuth popup closed or failed before completing (check Authorized redirect URIs in /config if you saw Error 400: redirect_uri_mismatch).')),
          focusReturnDelayMs
        )
      }
      const onAbort = () => reject(new Error('Google OAuth sign-in cancelled.'))
      if (options?.signal?.aborted) return onAbort()
      options?.signal?.addEventListener('abort', onAbort, { once: true })
      if (typeof window !== 'undefined') window.addEventListener?.('focus', onFocus)
      cleanup = () => {
        clearTimeout(timeoutTimer)
        if (focusTimer) clearTimeout(focusTimer)
        options?.signal?.removeEventListener('abort', onAbort)
        if (typeof window !== 'undefined') window.removeEventListener?.('focus', onFocus)
      }
    })
    const res = (await Promise.race([authPromise, guardPromise])) as
      | { access_token?: string; id_token?: string; expires_in?: number | string }
      | undefined
    const rawToken = res?.access_token
    if (!rawToken) {
      throw new Error(`Google OAuth response did not include an access_token: ${JSON.stringify(res)}`)
    }
    const token = String(rawToken).trim()
    const expiresAt =
      Date.now() + Math.max(60, (Number(res?.expires_in) || 3600) - 60) * 1000
    persistOAuthSession(extensionSDK, {
      token,
      expiresAt,
      clientId: clientId.trim(),
    })
    return token
  } finally {
    cleanup()
  }
}

export const authenticateGoogleOAuth = loginWithGoogleOAuth

let inFlightOAuthRefreshPromise: Promise<string> | null = null

export async function refreshOAuthSessionIfNeeded(opts: {
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
    return { token: '', expiresAt: 0, refreshedByOtherTab: false, deferredUntilVisible: true }
  }
  const stored = await loadStoredOAuthSession(extensionSDK, clientId)
  if (
    stored &&
    stored.expiresAt > Date.now() &&
    (!force || (Boolean(currentToken?.trim()) && stored.token !== currentToken?.trim()))
  ) {
    return { token: stored.token, expiresAt: stored.expiresAt, refreshedByOtherTab: true, deferredUntilVisible: false }
  }
  const ls = typeof window !== 'undefined' ? window.localStorage : undefined
  const readLock = (): { tabId?: string; expiresAt?: number } | null => {
    try {
      const raw = ls?.getItem?.(STUDIO_OAUTH_REFRESH_LOCK_KEY)
      return raw ? (JSON.parse(raw) as { tabId?: string; expiresAt?: number }) : null
    } catch {
      return null
    }
  }
  const existingLock = readLock()
  if (existingLock && Number(existingLock.expiresAt) > Date.now() && existingLock.tabId && existingLock.tabId !== effectiveTabId) {
    if (inFlightOAuthRefreshPromise) await inFlightOAuthRefreshPromise.catch(() => '')
    else if (lockWaitMs > 0) await new Promise((r) => setTimeout(r, lockWaitMs))
    const afterLock = await loadStoredOAuthSession(extensionSDK, clientId)
    return { token: afterLock?.token || '', expiresAt: afterLock?.expiresAt || 0, refreshedByOtherTab: true, deferredUntilVisible: false }
  }
  try {
    ls?.setItem?.(STUDIO_OAUTH_REFRESH_LOCK_KEY, JSON.stringify({ tabId: effectiveTabId, expiresAt: Date.now() + STUDIO_OAUTH_REFRESH_LOCK_TTL_MS }))
  } catch { /* ignore lock write failure */ }

  const loginPromise = loginWithGoogleOAuth(extensionSDK, clientId, oauthOptions)
  inFlightOAuthRefreshPromise = loginPromise
  try {
    const token = await loginPromise
    const refreshed = await loadStoredOAuthSession(extensionSDK, clientId)
    return { token, expiresAt: refreshed?.expiresAt || Date.now() + STUDIO_OAUTH_REFRESH_INTERVAL_MS, refreshedByOtherTab: false, deferredUntilVisible: false }
  } finally {
    if (inFlightOAuthRefreshPromise === loginPromise) inFlightOAuthRefreshPromise = null
    try {
      const curLock = readLock()
      if (!curLock || curLock.tabId === effectiveTabId) ls?.removeItem?.(STUDIO_OAUTH_REFRESH_LOCK_KEY)
    } catch { /* ignore lock cleanup failure */ }
  }
}

export async function callInteractionsApi(
  extensionSDK: AntigravityExtensionHostLike,
  auth: AntigravityAuth,
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
): Promise<AntigravityInteractionPayload> {
  const url = `https://generativelanguage.googleapis.com/v1beta/${path.replace(/^\//, '')}`
  const serializedBody = body ? JSON.stringify(body) : undefined

  if (auth.mode === 'apikey' && extensionSDK?.serverProxy) {
    const proxyResp = await extensionSDK.serverProxy(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': auth.apiKey?.trim() || getGeminiSecretKeyTag(extensionSDK),
      },
      body: serializedBody,
    })
    const parsed: AntigravityInteractionPayload =
      typeof proxyResp?.body === 'string'
        ? (() => {
            try {
              return JSON.parse(proxyResp.body) as AntigravityInteractionPayload
            } catch {
              return { raw: proxyResp.body }
            }
          })()
        : ((proxyResp?.body || {}) as AntigravityInteractionPayload)
    if (!proxyResp?.ok || (proxyResp?.status && proxyResp.status >= 400)) {
      const msg = parsed?.error?.message || JSON.stringify(parsed) || `HTTP ${proxyResp?.status}`
      throw new Error(`Antigravity API error (${proxyResp?.status}): ${msg}`)
    }
    return parsed
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (auth.mode === 'oauth') {
    if (!auth.oauthToken?.trim()) {
      throw new Error('Please sign in with Google OAuth first.')
    }
    if (typeof window !== 'undefined' && window.__MOCK_LOOKER_EXTENSION__) {
      if (/:cancel$/i.test(path)) {
        return {
          id: path.replace(/^interactions\//i, '').replace(/:cancel$/i, ''),
          status: 'cancelled',
        }
      }
      const inputArr = Array.isArray(body?.input)
        ? (body?.input as Array<{ text?: string }>)
        : []
      const promptText = String(inputArr[0]?.text || '')
      if (promptText.includes(CONVERSATION_LABEL_REQUEST_TAG)) {
        return {
          id: 'int_mock_label',
          status: 'completed',
          output_text: sanitizeConversationLabel('', promptText),
        }
      }
      if (promptText.includes(STARTER_PROMPTS_REQUEST_TAG)) {
        const ucMatch = promptText.match(/Active useCase:\s*([^\r\n]+)/i)?.[1]?.trim() || 'auto'
        const permittedMatch = promptText
          .match(/Permitted use cases:\s*([^\r\n]+)/i)?.[1]
          ?.split(',')
          .map((s) => s.trim() as StudioUseCase)
          .filter(Boolean)
        const targetMatch = promptText.match(
          /Target explore:\s*([^\s(\r\n]+)(?:\s*\(([^)\r\n]+)\))?/i
        )
        const expKey = targetMatch?.[1]?.trim()
        const expLabel = targetMatch?.[2]?.trim()
        const parseFieldLine = (prefix: string): StarterExploreFieldSummary[] => {
          const line = promptText
            .match(new RegExp(`${prefix}:\\s*([^\\r\\n]+)`, 'i'))?.[1]
            ?.trim()
          if (!line) return []
          return line
            .split(',')
            .map((part) => {
              const m = part.trim().match(/^([^\s(]+)(?:\s*\(([^)]+)\))?$/)
              return m ? { name: m[1].trim(), label: (m[2] || m[1]).trim() } : null
            })
            .filter((x): x is StarterExploreFieldSummary => Boolean(x))
        }
        const [mName = '', eName = ''] =
          expKey && expKey !== 'none'
            ? expKey.includes('::')
              ? expKey.split('::')
              : expKey.split('/')
            : ['', '']
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
        return {
          id: 'int_mock_starter_prompts',
          status: 'completed',
          output_text: `<STARTER_PROMPTS>${JSON.stringify(mockPrompts)}</STARTER_PROMPTS>`,
        }
      }
      const userReqMatch = promptText.match(/User request:\s*([\s\S]*)$/i)
      const effectiveUserText = userReqMatch ? userReqMatch[1].trim() : promptText
      const inferred = extractResolvedUseCase(undefined, effectiveUserText)
      return {
        id: `int_mock_${Date.now().toString(36).slice(-5)}`,
        environment_id: `env_${inferred}_mock`,
        status: 'completed',
        output_text: `<USE_CASE>${inferred}</USE_CASE>\nRouted turn via AGENTS.md to ${inferred}.`,
      }
    }
    headers['Authorization'] = `Bearer ${auth.oauthToken.trim()}`
    if (auth.projectId?.trim()) {
      headers['x-goog-user-project'] = auth.projectId.trim()
    }
  } else {
    if (!auth.apiKey?.trim()) {
      throw new Error('Gemini API Key is not configured.')
    }
    headers['x-goog-api-key'] = auth.apiKey.trim()
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: serializedBody,
  })
  const text = await resp.text()
  let parsed: AntigravityInteractionPayload
  try {
    parsed = text ? (JSON.parse(text) as AntigravityInteractionPayload) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!resp.ok) {
    if (resp.status === 401) {
      clearStoredOAuthSession(extensionSDK)
      if (auth.mode === 'oauth' && typeof auth.onUnauthorizedRefresh === 'function') {
        const refreshedToken = (await auth.onUnauthorizedRefresh().catch(() => null))?.trim()
        if (refreshedToken) {
          return await callInteractionsApi(
            extensionSDK,
            { ...auth, oauthToken: refreshedToken, onUnauthorizedRefresh: undefined },
            path,
            method,
            body
          )
        }
        clearStoredOAuthSession(extensionSDK)
      }
    }
    const msg = parsed?.error?.message || text || `HTTP ${resp.status}`
    throw new Error(`Antigravity API error (${resp.status}): ${msg}`)
  }
  return parsed
}

export async function listAvailableAntigravityModels(
  extensionSDK: AntigravityExtensionHostLike,
  auth: AntigravityAuth
): Promise<AntigravityModelOption[]> {
  const canQuery =
    auth.mode === 'oauth'
      ? Boolean(auth.oauthToken?.trim())
      : Boolean(auth.apiKey?.trim() || extensionSDK?.serverProxy)
  if (!canQuery) return ANTIGRAVITY_ALLOWED_MODELS
  try {
    const res = await callInteractionsApi(extensionSDK, auth, 'models', 'GET')
    const byId = new Map<string, { name?: string; displayName?: string; description?: string }>(
      (Array.isArray(res?.models) ? res.models : []).map((m) => [
        String(m?.name || '').replace(/^models\//, '').trim(),
        m,
      ])
    )
    const matched = ANTIGRAVITY_ALLOWED_MODELS.filter((a) => byId.has(a.id)).map((a) => {
      const m = byId.get(a.id)
      return {
        id: a.id,
        label: String(m?.displayName || a.label),
        description: String(m?.description || a.description),
      }
    })
    return matched.length > 0 ? matched : ANTIGRAVITY_ALLOWED_MODELS
  } catch {
    return ANTIGRAVITY_ALLOWED_MODELS
  }
}
