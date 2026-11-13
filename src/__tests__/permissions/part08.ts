import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  CODEMODE_CDN_URL, ensureCodeModeLoaded, LKR_DEV_CLI_VERSION, LkrCodeMode,
  prewarmOrWakeAntigravityEnvironment, runAntigravityTurn,
} from '../../antigravity'
import { createLookerEmbedPreloadController, resolveLookerEmbedTarget } from '../../components/StudioWorkspace'
import {
  clearArtifactServiceCache, deleteUserConversation, formatStudioContentItemTitle, hydrateConversationContentItems,
  loadUserEnvironmentId, normalizeStudioContentItem, resolveConversationRelatedContent, resolveStudioContentEmbedPath,
  saveUserConversation, saveUserEnvironmentId, StudioContentItem, upsertStudioContentItem,
} from '../../lookerApi'

interface MockInteractionPostBody {
  model?: string
  store?: boolean
  background?: boolean
  system_instruction?: string
  generation_config?: Record<string, unknown>
  response_format?: Record<string, unknown>
  environment?: string | { type?: string; sources?: Array<{ target: string; content: string }> }
  previous_interaction_id?: string
  tools?: unknown[]
  agent_config?: { type: string; model: string; max_total_tokens?: string }
  input?: Array<{ type?: string; text?: string; name?: string; call_id?: string; result?: unknown }>
}

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart08Tests(): void {
  test('31. Issue #99: supports an array of Looker content items per conversation with meaningful tabs, backwards-compatible hydration, multi-item deletion cleanup, and @looker/embed-sdk loadX() switching', async () => {
    // 1. Meaningful titles & embed paths (never bare numeric IDs)
    expect(formatStudioContentItemTitle('dashboard', '7', '7')).toBe('Dashboard #7')
    expect(formatStudioContentItemTitle('dashboard', '7', 'Executive Revenue Overview')).toBe(
      'Executive Revenue Overview'
    )
    expect(formatStudioContentItemTitle('look', '15', '')).toBe('Look #15')
    expect(formatStudioContentItemTitle('explore', 'thelook::order_items')).toBe(
      'Thelook: Order Items'
    )
    expect(formatStudioContentItemTitle('explore', 'thelook::order_items', 'eCommerce: Order Items')).toBe(
      'eCommerce: Order Items'
    )
    expect(resolveStudioContentEmbedPath('explore', 'thelook::order_items')).toBe(
      '/embed/explore/thelook/order_items'
    )
    expect(resolveStudioContentEmbedPath('look', '15')).toBe('/embed/looks/15')
    expect(resolveStudioContentEmbedPath('extension', 'my_proj::my_ext')).toBe(
      '/embed/extensions/my_proj::my_ext'
    )
    expect(resolveStudioContentEmbedPath('report', 'rep_101')).toBe('/embed/reporting/rep_101')

    // 2. Upsert deduplication by `${contentType}:${id}` and order preservation
    let items: StudioContentItem[] = []
    const step1 = upsertStudioContentItem(items, {
      id: 'thelook::order_items',
      contentType: 'explore',
      title: 'eCommerce: Order Items',
    })
    items = step1.items
    expect(step1.activeKey).toBe('explore:thelook::order_items')
    expect(items).toHaveLength(1)

    const step2 = upsertStudioContentItem(items, {
      id: '7',
      dashboardId: '7',
      contentType: 'dashboard',
      title: 'Quarterly Revenue UDD',
    })
    items = step2.items
    expect(step2.activeKey).toBe('dashboard:7')
    expect(items.map((i) => i.key)).toEqual(['explore:thelook::order_items', 'dashboard:7'])

    const step3 = upsertStudioContentItem(items, {
      id: '15',
      lookId: '15',
      contentType: 'look',
      title: 'Monthly Churn Look',
    })
    items = step3.items
    expect(step3.activeKey).toBe('look:15')
    expect(items.map((i) => i.key)).toEqual([
      'explore:thelook::order_items',
      'dashboard:7',
      'look:15',
    ])

    // Updating dashboard:7 in place preserves tab order and updates title
    const step4 = upsertStudioContentItem(items, {
      id: '7',
      dashboardId: '7',
      contentType: 'dashboard',
      title: 'Quarterly Revenue UDD (v2)',
    })
    expect(step4.activeKey).toBe('dashboard:7')
    expect(step4.items.map((i) => i.key)).toEqual([
      'explore:thelook::order_items',
      'dashboard:7',
      'look:15',
    ])
    expect(step4.items[1].title).toBe('Quarterly Revenue UDD (v2)')

    // 3. Backwards-compatible hydration from legacy single-item conv.content
    expect(
      hydrateConversationContentItems({
        id: 'conv_app_42',
        type: 'app',
        label: 'Executive Revenue App',
        content: { dashboardId: '42', appArtifactId: 'obj_app_42' },
      })
    ).toEqual([
      expect.objectContaining({
        key: 'data_app:42',
        id: '42',
        contentType: 'data_app',
        title: 'Executive Revenue App',
        embedPath: '/embed/dashboards/42',
      }),
    ])

    expect(
      hydrateConversationContentItems({
        id: 'conv_dashboard_7',
        type: 'dashboard',
        label: 'Quarterly UDD',
        content: { dashboardId: '7', lookId: '15' },
      }).map((i) => ({ key: i.key, title: i.title }))
    ).toEqual([
      { key: 'dashboard:7', title: 'Quarterly UDD' },
      { key: 'look:15', title: 'Look #15' },
    ])

    // 4. Multi-item resolveConversationRelatedContent & deleteUserConversation cleanup
    clearArtifactServiceCache()
    const deletedDashboards: string[] = []
    const deletedLooks: string[] = []
    const store = new Map<string, string>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ key }: { key: string }) =>
        key
          .split(',')
          .filter((k) => store.has(k))
          .map((k) => ({ key: k, value: store.get(k)!, version: 1 })),
      search_artifacts: async () => [],
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string }>) => {
        for (const u of updates) store.set(u.key, u.value)
        return updates.map((u) => ({ key: u.key, version: 1 }))
      },
      delete_artifact: async (_ns: string, key: string) => {
        for (const k of key.split(',')) store.delete(k.trim())
        return ''
      },
      delete_dashboard: async (id: string) => {
        deletedDashboards.push(String(id))
        return ''
      },
      delete_look: async (id: string) => {
        deletedLooks.push(String(id))
        return ''
      },
    })

    const multiConv = {
      id: 'conv_multi_99',
      type: 'dashboard',
      label: 'Multi-Item Executive Session',
      content: { dashboardId: '7' },
      contentItems: [
        normalizeStudioContentItem({
          id: 'thelook::order_items',
          contentType: 'explore',
          title: 'eCommerce: Order Items',
        }),
        normalizeStudioContentItem({
          id: '7',
          dashboardId: '7',
          contentType: 'dashboard',
          title: 'Executive UDD',
        }),
        normalizeStudioContentItem({
          id: '15',
          lookId: '15',
          contentType: 'look',
          title: 'Monthly Churn Look',
        }),
        normalizeStudioContentItem({
          id: '42',
          dashboardId: '42',
          contentType: 'data_app',
          title: 'Interactive Revenue App',
        }),
      ],
      activeContentTabKey: 'look:15',
      updatedAt: '2026-11-02T12:00:00Z',
    }

    const related = resolveConversationRelatedContent(multiConv, '1')
    expect(related.dashboardIds).toEqual(['7', '42'])
    expect(related.lookIds).toEqual(['15'])
    expect(related.sharedObjectKeys).toEqual(
      expect.arrayContaining(['obj_dashboard_7', 'obj_dashboard_15', 'obj_app_42'])
    )

    await saveUserConversation(mockSdk, '1', multiConv)
    await deleteUserConversation(mockSdk, '1', 'conv_multi_99', {
      deleteRelatedContent: true,
    })
    expect(deletedDashboards).toEqual(['7', '42'])
    expect(deletedLooks).toEqual(['15'])

    // 5. @looker/embed-sdk loadX() switching across activeContentItem tabs
    const attrs: Record<string, string> = {}
    const fakeIframe = {
      className: '',
      title: '',
      src: '',
      srcdoc: '',
      setAttribute: (k: string, v: string) => {
        attrs[`iframe:${k}`] = v
      },
      getAttribute: (k: string) => attrs[`iframe:${k}`] || '',
      removeAttribute: (k: string) => {
        delete attrs[`iframe:${k}`]
      },
    }
    const fakeContainer = {
      setAttribute: (k: string, v: string) => {
        attrs[k] = v
      },
      querySelector: (sel: string) => (sel === 'iframe' ? fakeIframe : null),
    } as unknown as HTMLElement

    const ctl = createLookerEmbedPreloadController({
      hostUrl: 'https://dev-argolis.looker.com',
      container: fakeContainer,
      mockPreviewHtml: (mode, objectId) => `<html><body>${mode}:${objectId}</body></html>`,
    })
    await ctl.connectionPromise

    // Tab A: Explore -> loadExplore({ id: 'thelook/order_items' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: 'thelook::order_items',
          contentType: 'explore',
          title: 'eCommerce: Order Items',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('explore')
    expect(attrs['data-embed-target']).toBe('thelook/order_items')

    // Tab B: Look -> loadLook({ id: '15' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: '15',
          lookId: '15',
          contentType: 'look',
          title: 'Monthly Churn Look',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('look')
    expect(attrs['data-embed-target']).toBe('15')

    // Tab C: Dashboard -> loadDashboard({ id: '7' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: '7',
          dashboardId: '7',
          contentType: 'dashboard',
          title: 'Executive UDD',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('dashboard')
    expect(attrs['data-embed-target']).toBe('7')

    // Tab D: Extension -> loadExtension({ id: 'my_proj::my_ext' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: 'my_proj::my_ext',
          contentType: 'extension',
          title: 'Custom Extension',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('extension')
    expect(attrs['data-embed-target']).toBe('my_proj::my_ext')

    // Tab E: Report -> loadReport({ id: 'rep_101' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: 'rep_101',
          contentType: 'report',
          title: 'Executive Report',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('report')
    expect(attrs['data-embed-target']).toBe('rep_101')

    // Tab F: Board -> loadUrl({ url: '/embed/boards/9' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: '9',
          contentType: 'board',
          title: 'Leadership Board',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('url')
    expect(attrs['data-embed-target']).toBe('/embed/boards/9')

    expect(ctl.getTelemetry().calls).toEqual([
      { method: 'init', arg: 'https://dev-argolis.looker.com' },
      { method: 'preload', arg: '/embed/preload' },
      { method: 'loadExplore', arg: 'thelook/order_items' },
      { method: 'loadLook', arg: '15' },
      { method: 'loadDashboard', arg: '7' },
      { method: 'loadExtension', arg: 'my_proj::my_ext' },
      { method: 'loadReport', arg: 'rep_101' },
      { method: 'loadUrl', arg: '/embed/boards/9' },
    ])
  })

  test('32. Issue #104: provides CODEMODE_CDN_URL, synchronous LkrCodeMode tool & operation classification, and ensureCodeModeLoaded() runtime loader', async () => {
    expect(CODEMODE_CDN_URL).toBe('https://cdn.lkr.dev/cli/codemode/0.0.69/codemode.js')
    expect(CODEMODE_CDN_URL).toContain(`/${LKR_DEV_CLI_VERSION}/codemode.js`)
    const preCommitHook = readFileSync(path.resolve(__dirname, '../../../.githooks/pre-commit'), 'utf8')
    expect(preCommitHook).toContain('lkr-dev-cli-version.txt')
    expect(preCommitHook).toContain('LKR_DEV_CLI_VERSION')
    expect(preCommitHook).toContain('CODEMODE_CDN_URL')
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.name).toBe('run_looker_codemode')
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.required).toEqual(['code', 'thought'])
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.code).toBeDefined()
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.vars).toBeDefined()
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.thought).toBeDefined()
    expect(LkrCodeMode.classifyOperation('GET', '/models')).toEqual({
      operation: 'read_models',
      requiresPermission: false,
    })
    expect(LkrCodeMode.classifyOperation('POST', '/dashboards')).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })
    expect(LkrCodeMode.classifyOperation('GET', '/alert_details')).toEqual({
      operation: 'read_alert_details',
      requiresPermission: false,
    })
    expect(LkrCodeMode.classifyOperation('POST', '/alerts/104/enqueue')).toEqual({
      operation: 'enqueue_alert',
      requiresPermission: true,
    })
    expect(LkrCodeMode.classifyOperation('POST', '/alerts/104/follow')).toEqual({
      operation: 'follow_alert',
      requiresPermission: true,
    })
    expect(LkrCodeMode.classifyOperation('DELETE', '/alerts/104/follow')).toEqual({
      operation: 'unfollow_alert',
      requiresPermission: true,
    })
    expect(LkrCodeMode.classifyOperation('PATCH', '/alerts/104')).toEqual({
      operation: 'update_alert_field',
      requiresPermission: true,
    })
    expect(LkrCodeMode.classifyOperation('POST', '/alert_notifications/55/read')).toEqual({
      operation: 'read_alert_notification',
      requiresPermission: true,
    })

    const runtime = await ensureCodeModeLoaded()
    expect(typeof runtime.runPythonCode).toBe('function')
    expect(runtime).not.toBe(LkrCodeMode)

    const out = await LkrCodeMode.runPythonCode('return {"sum": 2 + 3}')
    expect(JSON.parse(out)).toEqual({ sum: 5 })

    const manifestText = readFileSync(path.resolve(__dirname, '../../../manifest.lkml'), 'utf8')
    expect(manifestText).toContain('"https://cdn.lkr.dev"')
  })

  test('33. Issue #105: supports AbortSignal cancellation (:cancel) and onInteractionCreated in runAntigravityTurn, forceFresh environment reset in prewarmOrWakeAntigravityEnvironment, and clearing user_env artifact via saveUserEnvironmentId', async () => {
    clearArtifactServiceCache()
    const store = new Map<string, string>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ key }: { key: string }) =>
        key
          .split(',')
          .filter((k) => store.has(k))
          .map((k) => ({ key: k, value: store.get(k)!, version: 1 })),
      search_artifacts: async () => [],
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string }>) => {
        for (const u of updates) store.set(u.key, u.value)
        return updates.map((u) => ({ key: u.key, version: 1 }))
      },
      delete_artifact: async (_ns: string, key: string) => {
        for (const k of key.split(',')) store.delete(k.trim())
        return ''
      },
    })

    // 1. Verify saveUserEnvironmentId with empty string clears persisted user_env:1 artifact
    await saveUserEnvironmentId(mockSdk, '1', 'env_saved_before_reset')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_saved_before_reset')
    await saveUserEnvironmentId(mockSdk, '1', '')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBeNull()

    // 2. Verify runAntigravityTurn cancellation via AbortSignal throws AbortError and calls :cancel
    const proxyRequests: Array<{ url: string; method: string }> = []
    const createdIds: string[] = []
    const abortController = new AbortController()
    const mockCancelExt = {
      serverProxy: async (url: string, init?: FetchCustomParameters) => {
        const method = init?.method || 'GET'
        proxyRequests.push({ url, method })
        if (url.endsWith(':cancel')) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({ id: 'int_105_cancel_1', status: 'cancelled' }),
          }
        }
        if (method === 'POST') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_105_cancel_1',
              environment_id: 'env_105_active',
              status: 'in_progress',
              steps: [{ type: 'thought', thought: 'Planning query' }],
            }),
          }
        }
        abortController.abort()
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_105_cancel_1',
            environment_id: 'env_105_active',
            status: 'in_progress',
          }),
        }
      },
    }

    await expect(
      runAntigravityTurn({
        sdk: mockSdk,
        extensionSDK: mockCancelExt,
        userId: '1',
        auth: { mode: 'apikey', apiKey: 'key-105' },
        session: {},
        selectedExplores: ['thelook::order_items'],
        schemaMarkdown: '# Schema',
        userPrompt: 'Build revenue overview',
        pollScheduleMs: [5],
        signal: abortController.signal,
        onInteractionCreated: (id) => createdIds.push(id),
        onStatus: () => {},
      })
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Turn stopped by user',
    })
    expect(createdIds).toEqual(['int_105_cancel_1'])
    expect(
      proxyRequests.some(
        (r) => r.method === 'POST' && r.url.endsWith('/interactions/int_105_cancel_1:cancel')
      )
    ).toBe(true)

    // 3. Verify prewarmOrWakeAntigravityEnvironment with forceFresh: true provisions a fresh remote environment
    const prewarmBodies: MockInteractionPostBody[] = []
    const mockFreshExt = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(init.body) as MockInteractionPostBody) : undefined
        if (body) prewarmBodies.push(body)
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_105_fresh_prewarm',
            environment_id: 'env_105_fresh_99',
            status: 'completed',
            output_text: 'READY',
          }),
        }
      },
    }
    const freshRes = await prewarmOrWakeAntigravityEnvironment({
      sdk: mockSdk,
      userId: '1',
      extensionSDK: mockFreshExt,
      auth: { mode: 'apikey', apiKey: 'key-105' },
      toolType: 'app',
      environmentId: 'env_stale_old',
      existingSession: {
        toolType: 'app',
        environmentId: 'env_stale_old',
        lastInteractionId: 'int_stale_old',
      },
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      forceFresh: true,
    })
    expect(freshRes.status).toBe('prelaunched')
    expect(freshRes.session.environmentId).toBe('env_105_fresh_99')
    expect(freshRes.session.lastInteractionId).toBeUndefined()
    expect(prewarmBodies).toHaveLength(1)
    expect(prewarmBodies[0].environment).toMatchObject({ type: 'remote' })
  })

}
