import React from 'react'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  clearSessionConversationMessages, extractRawUserPromptFromInteraction, getSessionConversationMessages,
  hydrateRemoteConversationMessages, pruneDeadEnvironmentConversations, recoverInFlightInteraction,
  runAntigravityTurn, synthesizeCaConversationMessages,
} from '../../antigravity'
import {
  formatConversationContentTag,
  formatRelativeSidebarTime,
  StudioConversationsSidebar,
} from '../../components/StudioConversationsSidebar'
import { clearHealthCheckSessionCache, loadHealthCheckArtifact, saveHealthCheckArtifact } from '../../healthCheck'
import {
  ArtifactPayloadViolationError,
  assertPointerOnlyArtifactWrite,
  clearArtifactServiceCache,
  compactConversationEntryToBudget,
  FORBIDDEN_ARTIFACT_PROPERTY_NAMES,
  getArtifactService,
  isUserConversationDeleted,
  loadAlertArtifact,
  loadUserConversations,
  loadUserEnvironmentState,
  mergeStudioMetadata,
  saveAlertArtifact,
  saveUserConversation,
  saveUserEnvironmentId,
  saveUserStudioConfig,
  UserConversationEntry,
  utf8ByteLength,
} from '../../lookerApi'
import { clearLookmlSessionCache, loadLookmlSessionArtifact } from '../../lookmlTool'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

function makeArtifactStoreSdk() {
  const store = new Map<string, { key: string; version: number; value: string }>()
  let updateCalls = 0
  const sdk = asSdk({
    ok: async <T>(p: T) => p,
    artifact: async ({ key }: { key: string }) =>
      String(key || '')
        .split(',')
        .map((k) => store.get(k.trim()))
        .filter(Boolean),
    search_artifacts: async ({ key }: { key: string }) => {
      const prefix = String(key || '').replace(/%/g, '')
      return Array.from(store.values()).filter((r) => r.key.startsWith(prefix))
    },
    update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string; version?: number }>) => {
      updateCalls += 1
      return updates.map((u) => {
        const next = { key: u.key, version: (store.get(u.key)?.version ?? 0) + 1, value: u.value }
        store.set(u.key, next)
        return next
      })
    },
    delete_artifact: async (_ns: string, key: string) => {
      String(key || '')
        .split(',')
        .forEach((k) => store.delete(k.trim()))
      return ''
    },
  })
  return { sdk, store, getUpdateCalls: () => updateCalls }
}

export function registerPermissionsPart28Tests(): void {
  test('99. Issue #230: assertPointerOnlyArtifactWrite & ArtifactService.put enforce closed 3-key schema, byte budgets, and all forbidden payload keys recursively', async () => {
    clearArtifactServiceCache()
    const { sdk, getUpdateCalls } = makeArtifactStoreSdk()
    const svc = getArtifactService(sdk)

    // Allowed keys within budget succeed
    expect(() =>
      assertPointerOnlyArtifactWrite('user_env:42', {
        environmentId: 'env_42',
        sourcesHash: 'abc123',
        updatedAt: '2026-11-18T12:00:00Z',
      })
    ).not.toThrow()
    expect(() =>
      assertPointerOnlyArtifactWrite('user_config:42', {
        userId: '42',
        agentName: 'Maverick',
        themeMode: 'dark',
        requirePermission: true,
        busySendAction: 'queue',
        maxToolRounds: 12,
        selectedFolderId: '5',
        updatedAt: '2026-11-18T12:00:00Z',
      })
    ).not.toThrow()
    expect(() =>
      assertPointerOnlyArtifactWrite('user_conversations:42', [
        {
          id: 'conv_ok',
          type: 'app',
          label: 'Revenue Pulse',
          tags: ['orders', 'data_app'],
          inFlight: false,
          interactionId: 'int_final',
          turnInteractionIds: [['int_root', 'int_final']],
          environmentId: 'env_42',
          explores: ['ecom::orders'],
          content: { dashboardId: '42', appArtifactId: 'obj_app_42' },
          contentItems: [{ key: 'data_app:42', id: '42', contentType: 'data_app', title: 'Revenue Pulse', embedPath: '/embed/dashboards/42' }],
          activeContentTabKey: 'data_app:42',
          updatedAt: '2026-11-18T12:00:00Z',
        },
      ])
    ).not.toThrow()
    expect(() =>
      assertPointerOnlyArtifactWrite('user_conversations:42', [
        { id: 'conv_bad_uc', type: 'app', use_case: 'app', updatedAt: '2026-11-18T12:00:00Z' },
      ])
    ).toThrow(ArtifactPayloadViolationError)

    // Disallowed keys throw before any network call
    for (const badKey of ['obj_app_42', 'obj_lookml_ecom', 'obj_alert_9', 'user_42_app_1', 'tile_element_55', 'user_env:']) {
      await expect(svc.put([{ key: badKey, value: { id: '1' } }])).rejects.toThrow(ArtifactPayloadViolationError)
    }
    expect(getUpdateCalls()).toBe(0)

    // Unknown top-level fields on user_env / user_config / user_conversations entry throw
    expect(() => assertPointerOnlyArtifactWrite('user_env:42', { environmentId: 'env_1', extraBlob: 'nope' })).toThrow(ArtifactPayloadViolationError)
    expect(() => assertPointerOnlyArtifactWrite('user_config:42', { agentName: 'A', unexpectedSetting: true })).toThrow(ArtifactPayloadViolationError)
    expect(() =>
      assertPointerOnlyArtifactWrite('user_conversations:42', [
        { id: 'conv_1', type: 'app', label: 'A', updatedAt: '2026-11-18T12:00:00Z', extraSecret: 'nope' },
      ])
    ).toThrow(ArtifactPayloadViolationError)

    // Byte budgets enforced (512 B user_env, 1024 B user_config, 4096 B per entry, 65536 B total)
    expect(() => assertPointerOnlyArtifactWrite('user_env:42', { environmentId: 'e'.repeat(600) })).toThrow(ArtifactPayloadViolationError)
    expect(() => assertPointerOnlyArtifactWrite('user_config:42', { agentName: 'a'.repeat(1100) })).toThrow(ArtifactPayloadViolationError)
    expect(() =>
      assertPointerOnlyArtifactWrite('user_conversations:42', [
        {
          id: 'conv_big_entry',
          type: 'app',
          label: 'Big',
          updatedAt: '2026-11-18T12:00:00Z',
          explores: Array.from({ length: 160 }, (_, i) => `enterprise_model_${i}::very_long_explore_identifier_${i}`),
        },
      ])
    ).toThrow(ArtifactPayloadViolationError)
    const manyEntries = Array.from({ length: 30 }, (_, idx) => ({
      id: `conv_bulk_${idx}`,
      type: 'dashboard',
      label: `Conversation ${idx} ${'x'.repeat(80)}`,
      updatedAt: '2026-11-18T12:00:00Z',
      explores: Array.from({ length: 45 }, (__, j) => `m_${idx}::explore_long_name_${j}_${'z'.repeat(20)}`),
    }))
    expect(() => assertPointerOnlyArtifactWrite('user_conversations:42', manyEntries)).toThrow(ArtifactPayloadViolationError)

    // Every forbidden property name is rejected at any nesting depth
    const expectedForbidden = [
      'messages', 'text', 'activitySteps', 'images', 'rawCode', 'prod_code', 'raw_code', 'code',
      'files', 'tddMarkdown', 'telemetry', 'elements', 'alert_history_items', 'queryCache', 'filterCache',
    ]
    for (const prop of expectedForbidden) {
      expect(FORBIDDEN_ARTIFACT_PROPERTY_NAMES.has(prop)).toBe(true)
      await expect(
        svc.put([
          {
            key: 'user_conversations:42',
            value: [
              {
                id: 'conv_nested_bad',
                type: 'app',
                label: 'Nested Bad',
                updatedAt: '2026-11-18T12:00:00Z',
                content: { nested: { [prop]: 'forbidden_payload' } },
              },
            ],
          },
        ])
      ).rejects.toThrow(ArtifactPayloadViolationError)
    }
    expect(getUpdateCalls()).toBe(0)
  })

  test('100. Issue #230: saveConversation caps label <= 120, tags <= 4, turnInteractionIds <= 20, and auto-evicts archived then oldest tail entries above 60,000 B', async () => {
    clearArtifactServiceCache()
    const { sdk } = makeArtifactStoreSdk()

    const twentyFivePairs: Array<[string, string]> = Array.from({ length: 25 }, (_, i) => [`int_r_${i}`, `int_f_${i}`])
    const saved = await saveUserConversation(sdk, '9', {
      id: 'conv_caps',
      type: 'app',
      label: 'L'.repeat(180),
      tags: ['orders', 'revenue_explore_with_a_super_long_tag_name_exceeding_32_chars', 'data_app', 'kda', 'overflow_tag_5'],
      turnInteractionIds: twentyFivePairs,
      updatedAt: '2026-11-18T15:00:00.000Z',
    })
    expect(saved[0].label?.length).toBeLessThanOrEqual(120)
    expect(saved[0].tags).toHaveLength(4)
    expect(saved[0].tags?.every((t) => t.length <= 32)).toBe(true)
    expect(saved[0].turnInteractionIds).toHaveLength(20)
    expect(saved[0].turnInteractionIds?.[0]).toEqual(['int_r_5', 'int_f_5'])
    expect(saved[0].turnInteractionIds?.[19]).toEqual(['int_r_24', 'int_f_24'])

    // Populate ~28 conversations (~2.3 KB each) with archived entries so total crosses 60,000 B
    clearArtifactServiceCache()
    const { sdk: evictSdk, store: evictStore } = makeArtifactStoreSdk()
    for (let i = 0; i < 28; i += 1) {
      const paddedItems = Array.from({ length: 14 }, (__, j) => ({
        key: `dashboard:${i}_${j}`,
        id: `${i}_${j}`,
        contentType: 'dashboard' as const,
        title: `Executive Dashboard Tile Group ${i}_${j} Padding Title`,
        embedPath: `/embed/dashboards/${i}_${j}`,
      }))
      await saveUserConversation(evictSdk, '9', {
        id: `conv_ev_${String(i).padStart(2, '0')}`,
        type: 'dashboard',
        label: `Conversation Entry #${i} With Descriptive Title`,
        archived: i >= 10 && i <= 14,
        tags: ['orders', 'dashboard', 'finance', 'q4'],
        turnInteractionIds: Array.from({ length: 12 }, (__, t) => [`int_root_${i}_${t}`, `int_final_${i}_${t}`]),
        contentItems: paddedItems,
        updatedAt: new Date(Date.UTC(2026, 10, 1, 0, i, 0)).toISOString(),
      })
    }
    const rawJson = evictStore.get('user_conversations:9')?.value || '[]'
    const rawBytes = new TextEncoder().encode(rawJson).length
    expect(rawBytes).toBeLessThanOrEqual(60_000)
    const persisted = await loadUserConversations(evictSdk, '9')
    // Newest entry conv_ev_27 stays; archived entries (10..14) are evicted before newer non-archived entries
    expect(persisted.some((c) => c.id === 'conv_ev_27')).toBe(true)
    expect(persisted.some((c) => c.id === 'conv_ev_10')).toBe(false)
  })

  test('101. Issue #230: routes toolless Turn-1 chat through stored antigravity agent, unwraps <USER_MESSAGE>, and walks multi-hop recoverInFlightInteraction back to turn root', async () => {
    const postedBodies: Array<Record<string, unknown>> = []
    const ext = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const b = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        postedBodies.push(b)
        const n = postedBodies.length
        return {
          ok: true,
          status: 200,
          headers: {},
          body: JSON.stringify({
            id: `int_hello_${n}`,
            environment_id: n === 2 ? 'env_hello_warm' : undefined,
            status: 'completed',
            output_text: n === 1 ? 'Hi! How can I help with your Looker data today?' : 'Found 3 dashboards.',
          }),
        }
      },
    }

    const t1 = await runAntigravityTurn({
      sdk: asSdk({ ok: async <T>(p: T) => p }),
      extensionSDK: ext,
      userId: '1',
      auth: { mode: 'apikey', apiKey: 'k-230' },
      session: {},
      selectedExplores: [],
      schemaMarkdown: '',
      userPrompt: 'hello\n\n[Referenced Looker Dashboard #42 context wrapper]',
      rawUserPrompt: 'hello',
      onStatus: () => {},
    })
    expect(postedBodies[0].agent).toBe('antigravity-preview-09-2026')
    expect(postedBodies[0].store).toBe(true)
    expect(postedBodies[0].tools).toEqual([])
    expect(t1.rootInteractionId).toBe('int_hello_1')
    expect(t1.session.lastInteractionId).toBe('int_hello_1')
    const firstInputText = ((postedBodies[0].input as Array<{ text?: string }>)[0] || {}).text || ''
    expect(firstInputText).toContain('<USER_MESSAGE>hello</USER_MESSAGE>')
    expect(
      extractRawUserPromptFromInteraction({
        input: postedBodies[0].input as Array<{ type?: string; text?: string }>,
      })
    ).toBe('hello')

    // Turn 2 chains directly onto int_hello_1 via previous_interaction_id
    const t2 = await runAntigravityTurn({
      sdk: asSdk({ ok: async <T>(p: T) => p }),
      extensionSDK: ext,
      userId: '1',
      auth: { mode: 'apikey', apiKey: 'k-230' },
      session: t1.session,
      selectedExplores: [],
      schemaMarkdown: '',
      userPrompt: 'What dashboards are in my personal space?',
      rawUserPrompt: 'What dashboards are in my personal space?',
      onStatus: () => {},
    })
    expect(postedBodies[1].previous_interaction_id).toBe('int_hello_1')
    expect(t2.rootInteractionId).toBe('int_hello_2')
    expect(t2.session.lastInteractionId).toBe('int_hello_2')

    // Multi-hop recoverInFlightInteraction walks int_hop_final -> int_hop_mid -> int_hop_root to extract userPrompt & rootInteractionId
    const hopMap: Record<string, Record<string, unknown>> = {
      int_hop_root: {
        id: 'int_hop_root',
        previous_interaction_id: 'int_prev_turn_final',
        status: 'completed',
        input: [{ type: 'text', text: '[THINKING LEVEL: MEDIUM]\n\nUser request:\n<USER_MESSAGE>Build margin waterfall</USER_MESSAGE>\n\nAttached context' }],
        steps: [{ id: 's_r', type: 'thought', thought: 'Planning margin query' }],
      },
      int_hop_mid: {
        id: 'int_hop_mid',
        previous_interaction_id: 'int_hop_root',
        status: 'completed',
        input: [{ type: 'function_response', name: 'run_looker_codemode', call_id: 'c1', result: { rows: 12 } }],
        steps: [{ id: 's_m', type: 'code_execution', code: 'python3 /workspace/bundle_app.py' }],
      },
      int_hop_final: {
        id: 'int_hop_final',
        previous_interaction_id: 'int_hop_mid',
        status: 'completed',
        input: [{ type: 'function_response', name: 'run_looker_codemode', call_id: 'c2', result: { ok: true } }],
        steps: [{ id: 's_f', type: 'thought', thought: 'Finalizing bundle' }],
        output_text: 'Published Margin Waterfall.',
      },
    }
    const rec = await recoverInFlightInteraction({
      extensionSDK: {
        serverProxy: async (url: string) => {
          const id = decodeURIComponent(url.split('/interactions/')[1]?.split('?')[0] || '')
          return { ok: true, status: 200, headers: {}, body: JSON.stringify(hopMap[id] || { id, status: 'failed' }) }
        },
      },
      auth: { mode: 'apikey', apiKey: 'k-230' },
      interactionId: 'int_hop_final',
      maxPollAttempts: 1,
      pollIntervalMs: 1,
    })
    expect(rec?.rootInteractionId).toBe('int_hop_root')
    expect(rec?.userPrompt).toBe('Build margin waterfall')
    expect(rec?.text).toBe('Published Margin Waterfall.')
    expect(rec?.activitySteps.length).toBeGreaterThanOrEqual(2)
  })

  test('102. Issue #230: hydrateRemoteConversationMessages hydrates turnInteractionIds in 1 parallel batch, caches in memory, backtracks legacy single interactionId, and prunes expired environments while preserving Looker CA pointers', async () => {
    clearArtifactServiceCache()
    clearSessionConversationMessages()
    const { sdk } = makeArtifactStoreSdk()
    await saveUserEnvironmentId(sdk, '1', 'env_live', 'hash_live')

    const remoteInteractions: Record<string, Record<string, unknown>> = {
      int_t1_r: {
        id: 'int_t1_r',
        environment_id: 'env_live',
        status: 'completed',
        input: [{ type: 'text', text: 'System guide\n\nUser request:\n<USER_MESSAGE>Create executive revenue app</USER_MESSAGE>\n\n[Context]' }],
        steps: [{ id: 'st1', type: 'thought', thought: 'Inspecting ecom::orders' }],
      },
      int_t1_f: {
        id: 'int_t1_f',
        previous_interaction_id: 'int_t1_r',
        environment_id: 'env_live',
        status: 'completed',
        steps: [{ id: 'st2', type: 'code_execution', code: 'python3 /workspace/bundle_app.py' }],
        output_text: 'Built Executive Revenue App.\n<DATA_APP_BUNDLE>{"title":"Exec App"}</DATA_APP_BUNDLE>',
      },
      int_t2_r: {
        id: 'int_t2_r',
        previous_interaction_id: 'int_t1_f',
        environment_id: 'env_live',
        status: 'completed',
        input: [{ type: 'text', text: 'Warm fast path\n\nUser request:\n<USER_MESSAGE>Add region filter</USER_MESSAGE>' }],
        output_text: 'Added region filter.',
      },
    }

    let getCalls = 0
    const extLive = {
      serverProxy: async (url: string) => {
        getCalls += 1
        const id = decodeURIComponent(url.split('/interactions/')[1]?.split('?')[0] || '')
        const hit = remoteInteractions[id]
        if (!hit) return { ok: false, status: 404, headers: {}, body: JSON.stringify({ error: { message: 'Environment not found' } }) }
        return { ok: true, status: 200, headers: {}, body: JSON.stringify(hit) }
      },
    }

    const convLive: UserConversationEntry = {
      id: 'conv_live_1',
      type: 'app',
      label: 'Executive Revenue App',
      environmentId: 'env_live',
      interactionId: 'int_t2_r',
      turnInteractionIds: [
        ['int_t1_r', 'int_t1_f'],
        ['int_t2_r', 'int_t2_r'],
      ],
      updatedAt: '2026-11-18T16:00:00Z',
    }
    const hyd1 = await hydrateRemoteConversationMessages({
      extensionSDK: extLive,
      auth: { mode: 'apikey', apiKey: 'k-230' },
      sdk,
      userId: '1',
      conv: convLive,
      activeEnvironmentId: 'env_live',
    })
    expect(hyd1.expired).toBe(false)
    expect(getCalls).toBe(3) // Unique IDs int_t1_r, int_t1_f, int_t2_r fetched in 1 parallel batch
    expect(hyd1.messages.map((m) => ({ role: m.role, text: m.text }))).toEqual([
      { role: 'user', text: 'Create executive revenue app' },
      { role: 'assistant', text: 'Built Executive Revenue App.' },
      { role: 'user', text: 'Add region filter' },
      { role: 'assistant', text: 'Added region filter.' },
    ])
    expect(hyd1.messages[1]?.activitySteps?.length).toBeGreaterThan(0)

    // Repeat selection reads session cache with 0 network calls
    const hydCached = await hydrateRemoteConversationMessages({
      extensionSDK: extLive,
      auth: { mode: 'apikey', apiKey: 'k-230' },
      sdk,
      userId: '1',
      conv: convLive,
      activeEnvironmentId: 'env_live',
    })
    expect(getCalls).toBe(3)
    expect(hydCached.messages).toHaveLength(4)

    // Legacy single-interactionId backtrack fallback (no turnInteractionIds)
    clearSessionConversationMessages()
    const hydLegacy = await hydrateRemoteConversationMessages({
      extensionSDK: extLive,
      auth: { mode: 'apikey', apiKey: 'k-230' },
      sdk,
      userId: '1',
      conv: {
        id: 'conv_legacy_walk',
        type: 'app',
        label: 'Walkback',
        environmentId: 'env_live',
        interactionId: 'int_t2_r',
        updatedAt: '2026-11-18T16:05:00Z',
      },
      activeEnvironmentId: 'env_live',
    })
    expect(hydLegacy.expired).toBe(false)
    expect(hydLegacy.messages.map((m) => m.text)).toEqual([
      'Create executive revenue app',
      'Built Executive Revenue App.',
      'Add region filter',
      'Added region filter.',
    ])
    expect(getSessionConversationMessages('conv_legacy_walk')).toHaveLength(4)

    // Mismatched environmentId & remote 404 Environment not found prune sandbox threads, clear user_env:1, and preserve CA pointer
    await saveUserConversation(sdk, '1', {
      id: 'conv_dead_1',
      type: 'app',
      label: 'Old Sandbox App',
      environmentId: 'env_old_dead',
      interactionId: 'int_missing',
      updatedAt: '2026-11-17T10:00:00Z',
    })
    await saveUserConversation(sdk, '1', {
      id: 'conv_ca_keep',
      type: 'conversational-analytics',
      label: 'Q3 Margin CA',
      caConversationId: 'ca_conv_99',
      environmentId: 'env_old_dead',
      content: { caConversationId: 'ca_conv_99', agentId: 'ag_1', agentName: 'Margin Agent', initialQuestion: 'Why did margin dip?' },
      updatedAt: '2026-11-17T11:00:00Z',
    })
    const mismatchRes = await hydrateRemoteConversationMessages({
      extensionSDK: extLive,
      auth: { mode: 'apikey', apiKey: 'k-230' },
      sdk,
      userId: '1',
      conv: {
        id: 'conv_dead_1',
        type: 'app',
        label: 'Old Sandbox App',
        environmentId: 'env_old_dead',
        interactionId: 'int_missing',
        updatedAt: '2026-11-17T10:00:00Z',
      },
      activeEnvironmentId: 'env_live',
    })
    expect(mismatchRes.expired).toBe(true)
    expect(mismatchRes.prunedIds).toContain('conv_dead_1')
    expect((await loadUserConversations(sdk, '1')).map((c) => c.id)).toEqual(['conv_ca_keep'])

    // Remote 404 Environment not found on active env clears user_env:1 and prunes matching env conversation
    await saveUserConversation(sdk, '1', {
      id: 'conv_404_env',
      type: 'dashboard',
      label: 'Expired Remote Env Thread',
      environmentId: 'env_live',
      interactionId: 'int_404_missing',
      turnInteractionIds: [['int_404_missing', 'int_404_missing']],
      updatedAt: '2026-11-18T17:00:00Z',
    })
    const remote404Res = await hydrateRemoteConversationMessages({
      extensionSDK: extLive,
      auth: { mode: 'apikey', apiKey: 'k-230' },
      sdk,
      userId: '1',
      conv: {
        id: 'conv_404_env',
        type: 'dashboard',
        label: 'Expired Remote Env Thread',
        environmentId: 'env_live',
        interactionId: 'int_404_missing',
        turnInteractionIds: [['int_404_missing', 'int_404_missing']],
        updatedAt: '2026-11-18T17:00:00Z',
      },
      activeEnvironmentId: 'env_live',
    })
    expect(remote404Res.expired).toBe(true)
    expect(await loadUserEnvironmentState(sdk, '1')).toBeNull()
    expect((await loadUserConversations(sdk, '1')).map((c) => c.id)).toEqual(['conv_ca_keep'])
  })

  test('103. Issue #230: hydrates LookML, HealthCheck, Alert, CA, and DataApp studio metadata with zero obj_* Looker Artifact writes', async () => {
    clearArtifactServiceCache()
    clearLookmlSessionCache()
    clearHealthCheckSessionCache()
    const { store } = makeArtifactStoreSdk()

    const liveSdk = asSdk({
      ok: async <T>(p: T) => p,
      get_alert: async (id: string) => ({
        id,
        custom_title: 'Orders Spike Alert',
        description: 'Fires when daily orders > 500',
        dashboard_element_id: '88',
        cron: '0 8 * * *',
        comparison_type: 'GREATER_THAN',
        threshold: 500,
        field: { title: 'Orders Count', name: 'orders.count', filter: [] },
        destinations: [{ destination_type: 'EMAIL', email_address: 'ops@example.com' }],
        owner_id: '1',
        owner_display_name: 'Ada Lovelace',
        is_disabled: false,
        is_public: true,
        applied_dashboard_filters: [{ filter_title: 'Region', field_name: 'users.region', filter_value: 'US' }],
      }),
      dashboard_element: async () => ({ id: '88', dashboard_id: '42', title: 'Daily Orders Tile' }),
      all_lookml_models: async () => [{ name: 'ecom', project_name: 'ecom_proj', explores: [{ name: 'orders' }] }],
      lookml_model_explore: async () => ({
        name: 'orders',
        fields: { dimensions: [{ name: 'orders.id', primary_key: true, description: 'Order PK' }], measures: [{ name: 'orders.count', description: 'Total orders' }] },
      }),
      authSession: {
        transport: {
          rawRequest: async (method: string, reqPath: string, qp?: Record<string, unknown>) => {
            if (method.toUpperCase() === 'POST' && reqPath.includes('/alert_details')) {
              return { statusCode: 200, ok: true, body: [{ alert_sync_id: 'sync_1', triggered_at: '2026-11-18T08:00:00Z', alert_value: 612 }] }
            }
            if (reqPath.includes('/projects/ecom_proj/files')) {
              if (reqPath.endsWith('/file/content')) {
                return { statusCode: 200, ok: true, body: `view: ${String(qp?.file_id || 'orders')} { dimension: id { primary_key: yes } }\n` }
              }
              return { statusCode: 200, ok: true, body: [{ path: 'ecom.model.lkml', type: 'model' }, { path: 'views/orders.view.lkml', type: 'view' }] }
            }
            if (reqPath.endsWith('/user')) {
              return { statusCode: 200, ok: true, body: { id: '1', display_name: 'Ada Lovelace', email: 'ada@example.com' } }
            }
            if (reqPath.includes('/lookml_models/')) {
              return {
                statusCode: 200,
                ok: true,
                body: {
                  name: 'ecom',
                  fields: { dimensions: [{ name: 'orders.id', primary_key: true, description: 'Order PK' }], measures: [{ name: 'orders.count', description: 'Total orders' }] },
                },
              }
            }
            if (reqPath.includes('/lookml_models')) {
              return { statusCode: 200, ok: true, body: [{ name: 'ecom', project_name: 'ecom_proj', allowed_db_connection_names: ['default_bigquery_connection'], explores: [{ name: 'orders' }] }] }
            }
            if (reqPath.includes('/queries/run/')) {
              return { statusCode: 200, ok: true, body: [] }
            }
            return { statusCode: 404, ok: false, body: {} }
          },
        },
      },
      artifact: async () => [],
      search_artifacts: async () => [],
      update_artifacts: async () => {
        throw new Error('Unexpected Looker Artifact write')
      },
    })

    // 1. Alert save + live load (get_alert + POST /alert_details) with 0 Artifact writes
    const savedAlert = await saveAlertArtifact(liveSdk, '1', { id: 'alert_99', alert_id: 'alert_99', custom_title: 'Orders Spike Alert' })
    expect(savedAlert.alert_id).toBe('alert_99')
    const hydratedAlert = await loadAlertArtifact(liveSdk, 'alert_99')
    expect(hydratedAlert).toMatchObject({
      alert_id: 'alert_99',
      custom_title: 'Orders Spike Alert',
      dashboard_id: '42',
      dashboard_element_id: '88',
      comparison_type: 'GREATER_THAN',
      threshold: 500,
      cron: '0 8 * * *',
      owner_id: '1',
      owner_display_name: 'Ada Lovelace',
      is_disabled: false,
      is_public: true,
    })
    expect(hydratedAlert?.alert_history_items).toHaveLength(1)

    // 2. LookML hydration from Looker IDE /projects/ecom_proj/files + /file/content when sandbox env is absent
    const hydratedLookml = await loadLookmlSessionArtifact(liveSdk, undefined, 'ecom_proj', undefined, { projectId: 'ecom_proj' })
    expect(hydratedLookml.bundle.project_id).toBe('ecom_proj')
    expect(hydratedLookml.bundle.files.map((f) => f.path)).toEqual(['ecom.model.lkml', 'views/orders.view.lkml'])
    expect(hydratedLookml.bundle.files[0]?.content).toContain('primary_key: yes')

    // 3. HealthCheck save (session cache, 0 Artifact writes) + deterministic re-run when session cache & interaction are absent
    const sampleReport = {
      id: 'hc_ecom_1',
      type: 'health_check' as const,
      title: 'Health Check: ecom_proj',
      projectId: 'ecom_proj',
      connectionName: 'default_bigquery_connection',
      updatedAt: '2026-11-18T12:00:00Z',
      createdBy: '1',
      tddMarkdown: '# Cached TDD',
      scores: { pillar1Score: 88, pillar2Score: 92, pillar3Score: 85, overallScore: 88, grade: 'B', transcriberScore: 3.68, transcriberClass: 'Class A' },
      telemetry: {},
    }
    await saveHealthCheckArtifact(liveSdk, undefined, '1', sampleReport)
    const cachedHc = await loadHealthCheckArtifact(liveSdk, undefined, 'hc_ecom_1')
    expect(cachedHc.tddMarkdown).toBe('# Cached TDD')
    clearHealthCheckSessionCache()
    const rerunHc = await loadHealthCheckArtifact(liveSdk, undefined, 'hc_ecom_rerun', { projectId: 'ecom_proj' })
    expect(rerunHc.tddMarkdown).toContain('# Technical Design Document')

    // 4. CA synthesis from pointer-only conv.content (no forbidden `text` property) + mergeStudioMetadata omits `messages`
    const caConv: UserConversationEntry = {
      id: 'conv_ca_1',
      type: 'conversational-analytics',
      label: 'Margin Q3',
      caConversationId: 'ca_77',
      content: {
        caConversationId: 'ca_77',
        agentId: 'agent_finance',
        agentName: 'Finance Agent',
        routingRationale: 'Matched finance explore.',
        initialQuestion: 'Why did gross margin drop in Q3?',
      },
      updatedAt: '2026-11-18T12:00:00Z',
    }
    expect(() => assertPointerOnlyArtifactWrite('user_conversations:1', [caConv])).not.toThrow()
    const caMsgs = synthesizeCaConversationMessages(caConv)
    expect(caMsgs).toHaveLength(2)
    expect(caMsgs[0]).toEqual({ role: 'user', text: 'Why did gross margin drop in Q3?' })
    expect(caMsgs[1]?.text).toContain('Finance Agent')

    const mergedStudio = mergeStudioMetadata(
      { explores: ['ecom::legacy'], messages: [{ role: 'user', text: 'legacy' }] } as unknown as Parameters<typeof mergeStudioMetadata>[0],
      { explores: ['ecom::orders'], lastInteractionId: 'int_99', environmentId: 'env_42' }
    ) as Record<string, unknown> | undefined
    expect(mergedStudio?.messages).toBeUndefined()
    expect(mergedStudio?.lastInteractionId).toBe('int_99')
    expect(store.size).toBe(0)
    await saveUserStudioConfig(makeArtifactStoreSdk().sdk, '1', { requirePermission: false, busySendAction: 'interrupt' })
  })

  test('104. Issue #230: formatRelativeSidebarTime & StudioConversationsSidebar render deterministic relative timestamps and <= 4 tag pills', () => {
    const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0) // Nov 18, 2026 12:00:00 UTC
    expect(formatRelativeSidebarTime(new Date(nowMs - 15_000).toISOString(), nowMs)).toBe('just now')
    expect(formatRelativeSidebarTime(new Date(nowMs - 5 * 60_000).toISOString(), nowMs)).toBe('5m ago')
    expect(formatRelativeSidebarTime(new Date(nowMs - 2 * 3_600_000).toISOString(), nowMs)).toBe('2h ago')
    expect(formatRelativeSidebarTime(new Date(nowMs - 3 * 86_400_000).toISOString(), nowMs)).toBe('3d ago')
    expect(formatRelativeSidebarTime('2026-10-30T14:20:00.000Z', nowMs)).toBe('Oct 30')
    expect(formatRelativeSidebarTime('2024-10-30T14:20:00.000Z', nowMs)).toBe('Oct 30, 2024')
    expect(formatConversationContentTag({ id: 'c1', type: 'app', label: 'App', content: { dashboardId: '42' }, updatedAt: '' })).toBe('Dash #42')
    expect(formatConversationContentTag({ id: 'c2', type: 'dashboard', label: 'LookML', content: { lookmlDashboardId: 'ecom::pulse' }, updatedAt: '' })).toBe('LookML #ecom::pulse')

    const convs: UserConversationEntry[] = [
      {
        id: 'conv_sidebar_1',
        type: 'app',
        label: 'Executive Revenue App',
        tags: ['orders', 'users', 'data_app', 'kda', 'extra_5'],
        updatedAt: '2026-10-30T14:20:00.000Z',
      },
    ]
    const html = renderToStaticMarkup(
      React.createElement(StudioConversationsSidebar, {
        ctl: {
          conversations: convs,
          archivedConversations: [],
          showArchivedConversations: false,
          setShowArchivedConversations: () => {},
          pendingDeleteConv: null,
          deleteRelatedContent: true,
          setDeleteRelatedContent: () => {},
          activeConversationId: 'conv_sidebar_1',
          sidebarCollapsed: false,
          setSidebarCollapsed: () => {},
          handleSelectConversation: () => {},
          handleToggleArchiveConversation: () => {},
          handleRequestDeleteConversation: () => {},
          handleCancelDeleteConversation: () => {},
          handleConfirmDeleteConversation: async () => {},
          handleNewConversation: () => {},
          runningConvIds: [],
          pendingPermConvIds: [],
          userId: '1',
        } as unknown as React.ComponentProps<typeof StudioConversationsSidebar>['ctl'],
      })
    )
    expect(html).toContain('data-testid="conv-item-updated-conv_sidebar_1"')
    expect(html).toContain('>Oct 30<')
    expect(html).toContain('data-testid="conv-item-tags-conv_sidebar_1"')
    expect((html.match(/dab-conv-tag-pill/g) || []).length).toBe(4)
    expect(html).not.toContain('extra_5')
  })

  test('105. Issue #230: entry byte compaction, requires_action in-flight guard, __bundle_ref__ LookML & empirical TDD score parsing', async () => {
    clearArtifactServiceCache()
    clearSessionConversationMessages()
    clearLookmlSessionCache()
    clearHealthCheckSessionCache()
    if (typeof window !== 'undefined') window.sessionStorage?.clear?.()
    const { sdk } = makeArtifactStoreSdk()

    const oversized: UserConversationEntry = {
      id: 'conv_big_entry',
      type: 'conversational-analytics',
      label: 'Oversized Pointer Entry',
      explores: Array.from({ length: 20 }, (_, i) => `ecommerce_enterprise::explore_segment_${i}`),
      turnInteractionIds: Array.from({ length: 20 }, (_, i): [string, string] => [`int_root_very_long_identifier_${i}`, `int_final_very_long_identifier_${i}`]),
      content: { routingRationale: 'R'.repeat(2400), initialQuestion: 'Q'.repeat(2400), caAgentId: 'ca_1' },
      contentItems: Array.from({ length: 12 }, (_, i) => ({
        key: `dashboard:${i}`, id: `${i}`, contentType: 'dashboard' as const, title: `Dashboard Tile Overview ${i}`,
        embedPath: `/embed/dashboards/${i}`, source: (i < 6 ? 'mention' : 'created') as 'mention' | 'created',
      })),
      activeContentTabKey: '',
      updatedAt: '2026-11-18T12:00:00Z',
    }
    expect(utf8ByteLength(JSON.stringify(compactConversationEntryToBudget(oversized)))).toBeLessThanOrEqual(4096)
    const savedList = await saveUserConversation(sdk, '1', oversized)
    expect(savedList[0]?.activeContentTabKey).toBe('')
    await saveUserConversation(sdk, '1', { id: 'conv_big_entry', type: 'conversational-analytics', label: 'Older Stale Write', activeContentTabKey: 'dashboard:9', updatedAt: '2026-11-18T11:00:00Z' })
    const afterStale = await loadUserConversations(sdk, '1')
    expect(afterStale[0]?.label).toBe('Oversized Pointer Entry')
    expect(afterStale[0]?.activeContentTabKey).toBe('')

    const extMock = {
      serverProxy: async (url: string) => {
        if (url.includes('/interactions/int_req_act')) {
          return { ok: true, status: 200, headers: {}, body: JSON.stringify({ id: 'int_req_act', status: 'requires_action', environment_id: 'env_42', input: '<USER_MESSAGE>\nRun query\n</USER_MESSAGE>' }) }
        }
        if (url.includes('/interactions/int_lml_ref')) {
          return { ok: true, status: 200, headers: {}, body: JSON.stringify({ id: 'int_lml_ref', status: 'completed', output_text: '<LOOKML_BUNDLE>{"__bundle_ref__":"/workspace/lookml_bundle_ref1.json","project_id":"ref_proj"}</LOOKML_BUNDLE>' }) }
        }
        if (url.includes('/environments/env_42') && url.includes('lookml_bundle_ref1.json')) {
          return { ok: true, status: 200, headers: {}, body: JSON.stringify({ id: 'ref_proj', project_id: 'ref_proj', title: 'Ref Proj', summary: 'Hydrated ref', files: [{ path: 'models/ref.model.lkml', action: 'created', content: 'connection: "bq"' }] }) }
        }
        if (url.includes('/interactions/int_hc_emp')) {
          const tdd = '# Looker & BigQuery 3-Pillar Health Check\n**Project:** `emp_proj` | **BigQuery Connection:** `bq_prod` | **Overall Health Score:** **88% (Grade A)** | **Transcriber Maturity:** **3.65 / 4.00 (Production Ready)**\n| **Pillar 1: Looker Operational** | **91%** |\n| **Pillar 2: LookML Quality** | **86%** |\n| **Pillar 3: BigQuery Efficiency** | **87%** |'
          return { ok: true, status: 200, headers: {}, body: JSON.stringify({ id: 'int_hc_emp', status: 'completed', output_text: `<HEALTH_CHECK_TDD>\n${tdd}\n</HEALTH_CHECK_TDD>` }) }
        }
        return { ok: false, status: 404, headers: {}, body: 'not found' }
      },
    }
    const reqActRes = await hydrateRemoteConversationMessages({
      extensionSDK: extMock as never, auth: { mode: 'apikey' }, activeEnvironmentId: 'env_42',
      conv: { id: 'conv_ra', type: 'app', label: 'In Flight', inFlight: true, environmentId: 'env_42', turnInteractionIds: [['int_req_act', 'int_req_act']], updatedAt: '2026-11-18T12:00:00Z' },
    })
    expect(reqActRes.messages).toEqual([{ role: 'user', text: 'Run query' }])

    await saveUserConversation(sdk, '1', { id: 'conv_recover_active', type: 'app', label: 'Active Recover', environmentId: 'env_dead_rec', updatedAt: '2026-11-18T12:01:00Z' })
    await saveUserConversation(sdk, '1', { id: 'conv_dead_sib', type: 'app', label: 'Dead Sibling', environmentId: 'env_dead_rec', updatedAt: '2026-11-18T12:00:30Z' })
    const prunedIds = await pruneDeadEnvironmentConversations({ sdk, userId: '1', deadEnvironmentId: 'env_dead_rec', excludeConversationId: 'conv_recover_active' })
    expect(prunedIds).toEqual(['conv_dead_sib'])
    expect([isUserConversationDeleted(sdk, '1', 'conv_recover_active'), isUserConversationDeleted(sdk, '1', 'conv_dead_sib')]).toEqual([false, true])
    const postRecoverList = await saveUserConversation(sdk, '1', { id: 'conv_recover_active', type: 'app', label: 'Active Recover', environmentId: 'env_fresh_99', updatedAt: '2026-11-18T12:02:00Z' })
    expect(postRecoverList.find((c) => c.id === 'conv_recover_active')?.environmentId).toBe('env_fresh_99')

    const refLookml = await loadLookmlSessionArtifact(sdk, extMock as never, 'ref_proj', undefined, {
      auth: { mode: 'apikey' }, environmentId: 'env_42', lastInteractionId: 'int_lml_ref',
    })
    expect(refLookml.bundle.files[0]?.content).toContain('connection: "bq"')

    const empHc = await loadHealthCheckArtifact(sdk, extMock as never, 'hc_emp_1', {
      auth: { mode: 'apikey' }, lastInteractionId: 'int_hc_emp',
    })
    expect([empHc.projectId, empHc.connectionName, empHc.scores.overallScore, empHc.scores.grade, empHc.scores.transcriberScore, empHc.scores.pillar1Score, empHc.scores.pillar2Score, empHc.scores.pillar3Score]).toEqual([
      'emp_proj', 'bq_prod', 88, 'A', 3.65, 91, 86, 87,
    ])
  })
}
