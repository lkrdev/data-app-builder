import { gunzipSync } from 'node:zlib'

import type { Looker40SDK } from '@looker/sdk'

import {
  type AntigravityExtensionHostLike,
  buildManagedWorkspaceSources,
  buildWorkspaceSources,
  CURRENT_MANAGED_SOURCES_HASH,
  encodeSyncPayloadChunks,
  MANAGED_SOURCES_FILE_HASHES,
  MANAGED_SOURCES_MANIFEST_JSON,
  MANAGED_SOURCES_MANIFEST_PATH,
  MAX_SYNC_CHUNK_B64_CHARS,
  prewarmOrWakeAntigravityEnvironment,
  resolveBuiltinWorkspaceFileContent,
  runAntigravityTurn,
  syncManagedSkillsIntoEnvironment,
} from '../../antigravity'
import { canonicalJson, sha256Hex } from '../../lkrCliSitecustomize'
import {
  clearAllUserConversations,
  clearArtifactServiceCache,
  getArtifactService,
  isUserConversationDeleted,
  loadUserConversations,
  loadUserEnvironmentId,
  loadUserEnvironmentState,
  saveUserConversation,
  saveUserEnvironmentId,
} from '../../lookerApi'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK
const asHost = (mock: Record<string, unknown>): AntigravityExtensionHostLike => mock as unknown as AntigravityExtensionHostLike

function createInMemoryArtifactSdk() {
  const store = new Map<string, { version: number; value: string }>()
  const deletedDashboards: string[] = []
  const deletedLooks: string[] = []
  const deletedBoards: string[] = []
  const sdk = asSdk({
    ok: async <T>(p: Promise<T> | T) => p,
    me: async () => ({ id: '1' }),
    artifact: async ({ key }: { namespace: string; key: string }) => {
      const keys = String(key || '').split(',').map((k) => k.trim()).filter(Boolean)
      return keys
        .filter((k) => store.has(k))
        .map((k) => ({ key: k, version: store.get(k)!.version, value: store.get(k)!.value }))
    },
    search_artifacts: async ({ key }: { namespace: string; key: string }) => {
      const prefix = String(key || '').replace(/%+$/, '')
      return Array.from(store.entries())
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({ key: k, version: v.version, value: v.value }))
    },
    update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string; version?: number }>) => {
      return updates.map((u) => {
        const nextVer = (store.get(u.key)?.version || 0) + 1
        const val = typeof u.value === 'string' ? u.value : JSON.stringify(u.value)
        store.set(u.key, { version: nextVer, value: val })
        return { key: u.key, version: nextVer, value: val }
      })
    },
    delete_artifact: async (_ns: string, keys: string) => {
      for (const k of String(keys || '').split(',').map((s) => s.trim()).filter(Boolean)) {
        store.delete(k)
      }
      return {}
    },
    delete_dashboard: async (id: string) => {
      deletedDashboards.push(String(id))
      return {}
    },
    delete_look: async (id: string) => {
      deletedLooks.push(String(id))
      return {}
    },
    delete_board: async (id: string) => {
      deletedBoards.push(String(id))
      return {}
    },
  })
  return { sdk, store, deletedDashboards, deletedLooks, deletedBoards }
}

export function registerPermissionsPart27Tests(): void {
  test('95. Issue #229: computes deterministic CURRENT_MANAGED_SOURCES_HASH, seeds .managed_sources_manifest.json in buildWorkspaceSources, and excludes manifest from resolveBuiltinWorkspaceFileContent', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }))
    expect(sha256Hex(canonicalJson({ b: 2, a: 1 }))).toBe(sha256Hex(canonicalJson({ a: 1, b: 2 })))
    expect(CURRENT_MANAGED_SOURCES_HASH).toMatch(/^[0-9a-f]{16}$/)
    expect(CURRENT_MANAGED_SOURCES_HASH).toBe(sha256Hex(canonicalJson(MANAGED_SOURCES_FILE_HASHES)).slice(0, 16))

    const managed = buildManagedWorkspaceSources()
    const uniqueTargets = new Set(managed.map((m) => m.target))
    expect(uniqueTargets.size).toBe(managed.length)
    expect(uniqueTargets.has('/workspace/AGENTS.md')).toBe(true)
    expect(uniqueTargets.has('/workspace/bundle_app.py')).toBe(true)
    expect(uniqueTargets.has('/workspace/bootstrap_lookml.py')).toBe(true)
    expect(uniqueTargets.has('/workspace/sitecustomize.py')).toBe(true)
    expect(uniqueTargets.has('/workspace/skills/data-apps/SKILL.md')).toBe(true)
    expect(uniqueTargets.has('/workspace/skills/looker-dashboard/SKILL.md')).toBe(true)
    expect(uniqueTargets.has('/workspace/skills/agentic-lookml/SKILL.md')).toBe(true)

    const wsSources = buildWorkspaceSources({
      schemaMarkdown: '# Schema',
    })
    const manifestEntry = wsSources.find((s) => s.target === MANAGED_SOURCES_MANIFEST_PATH)
    expect(manifestEntry).toBeDefined()
    expect(manifestEntry?.content).toBe(MANAGED_SOURCES_MANIFEST_JSON)
    expect(JSON.parse(MANAGED_SOURCES_MANIFEST_JSON)).toEqual({
      sourcesHash: CURRENT_MANAGED_SOURCES_HASH,
      files: MANAGED_SOURCES_FILE_HASHES,
    })

    // Must return undefined so fetchEnvironmentFile fetches the live container manifest over HTTP
    expect(resolveBuiltinWorkspaceFileContent(MANAGED_SOURCES_MANIFEST_PATH)).toBeUndefined()
    expect(resolveBuiltinWorkspaceFileContent('.managed_sources_manifest.json')).toBeUndefined()
  })

  test('96. Issue #229: round-trips UserEnvironmentState with closed 3-key <=512B payload, preserves sourcesHash on wake, and stamps CURRENT_MANAGED_SOURCES_HASH on fresh provisioning', async () => {
    clearArtifactServiceCache()
    const { sdk, store } = createInMemoryArtifactSdk()

    // Legacy string & object without sourcesHash
    store.set('user_env:1', { version: 1, value: JSON.stringify('env_legacy_str') })
    expect(await loadUserEnvironmentState(sdk, '1')).toEqual({ environmentId: 'env_legacy_str' })
    clearArtifactServiceCache()
    store.set('user_env:1', { version: 2, value: JSON.stringify({ environmentId: 'env_legacy_obj', updatedAt: '2026-11-01T00:00:00Z' }) })
    expect(await loadUserEnvironmentState(sdk, '1')).toEqual({ environmentId: 'env_legacy_obj', updatedAt: '2026-11-01T00:00:00Z' })

    // Explicit sourcesHash writes closed 3-key payload <= 512B
    await saveUserEnvironmentId(sdk, '1', 'env_fresh_229', undefined, CURRENT_MANAGED_SOURCES_HASH)
    const rawSaved = store.get('user_env:1')!.value
    expect(Buffer.byteLength(rawSaved, 'utf8')).toBeLessThanOrEqual(512)
    const parsedSaved = JSON.parse(rawSaved) as Record<string, unknown>
    expect(Object.keys(parsedSaved).sort()).toEqual(['environmentId', 'sourcesHash', 'updatedAt'])
    expect(parsedSaved.environmentId).toBe('env_fresh_229')
    expect(parsedSaved.sourcesHash).toBe(CURRENT_MANAGED_SOURCES_HASH)

    // Cold-cache wake call without sourcesHash preserves existing sourcesHash on same environmentId
    clearArtifactServiceCache()
    await saveUserEnvironmentId(sdk, '1', 'env_fresh_229')
    const afterColdWake = await loadUserEnvironmentState(sdk, '1')
    expect(afterColdWake?.environmentId).toBe('env_fresh_229')
    expect(afterColdWake?.sourcesHash).toBe(CURRENT_MANAGED_SOURCES_HASH)
    expect(await loadUserEnvironmentId(sdk, '1')).toBe('env_fresh_229')

    // Concurrent saveUserEnvironmentId race (hash-stamping + hashless wake) serializes via envPutByUser and preserves sourcesHash
    await Promise.all([
      saveUserEnvironmentId(sdk, '1', 'env_race_229', undefined, CURRENT_MANAGED_SOURCES_HASH),
      saveUserEnvironmentId(sdk, '1', 'env_race_229'),
    ])
    expect((await loadUserEnvironmentState(sdk, '1'))?.sourcesHash).toBe(CURRENT_MANAGED_SOURCES_HASH)

    // Oversized hash/id input stays clamped to <= 512 UTF-8 bytes with closed 3-key schema
    await saveUserEnvironmentId(sdk, '1', `env_big_${'x'.repeat(600)}`, undefined, 'f'.repeat(200))
    const clampedRaw = store.get('user_env:1')!.value
    expect(Buffer.byteLength(clampedRaw, 'utf8')).toBeLessThanOrEqual(512)
    expect(Object.keys(JSON.parse(clampedRaw) as Record<string, unknown>).every((k) => ['environmentId', 'sourcesHash', 'updatedAt'].includes(k))).toBe(true)

    // Switching to a different environmentId without sourcesHash does not carry stale hash
    await saveUserEnvironmentId(sdk, '1', 'env_other_229')
    const switchedRaw = JSON.parse(store.get('user_env:1')!.value) as Record<string, unknown>
    expect(Object.keys(switchedRaw).sort()).toEqual(['environmentId', 'updatedAt'])

    // prewarmOrWakeAntigravityEnvironment fresh provision stamps CURRENT_MANAGED_SOURCES_HASH
    const updatedCalls: Array<{ envId: string; hash?: string | null }> = []
    const prewarmHost = asHost({
      serverProxy: async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 'int_prewarm_229', environment_id: 'env_provisioned_229', status: 'completed', output_text: 'READY' }),
      }),
    })
    const provisionedId = await prewarmOrWakeAntigravityEnvironment({
      sdk,
      userId: '1',
      extensionSDK: prewarmHost,
      auth: { mode: 'apikey', apiKey: 'test_key' },
      toolType: 'app',
      onEnvironmentUpdated: (envId, hash) => { updatedCalls.push({ envId, hash }) },
    })
    expect(provisionedId.session.environmentId).toBe('env_provisioned_229')
    expect(updatedCalls).toEqual([{ envId: 'env_provisioned_229', hash: CURRENT_MANAGED_SOURCES_HASH }])
    expect((await loadUserEnvironmentState(sdk, '1'))?.sourcesHash).toBe(CURRENT_MANAGED_SOURCES_HASH)

    // runAntigravityTurn 404 stale environment recovery (both bash and non-bash modes) stamps CURRENT_MANAGED_SOURCES_HASH on fresh replacement
    await saveUserEnvironmentId(sdk, '1', 'env_stale_404')
    let turnAttempt = 0
    const turnUpdatedCalls: Array<{ envId: string; hash?: string | null }> = []
    const turnRes = await runAntigravityTurn({
      sdk,
      userId: '1',
      environmentId: 'env_stale_404',
      onEnvironmentUpdated: (envId, hash) => { turnUpdatedCalls.push({ envId, hash }) },
      extensionSDK: asHost({
        serverProxy: async () => {
          turnAttempt += 1
          if (turnAttempt === 1) {
            return { ok: false, status: 404, body: JSON.stringify({ error: { message: 'Environment env_stale_404 was not found' } }) }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_turn_recovered_229',
              environment_id: 'env_recovered_229',
              status: 'completed',
              output_text: '<USE_CASE>dashboard</USE_CASE>\nFetched personal folder.',
            }),
          }
        },
      }),
      auth: { mode: 'apikey', apiKey: 'test_key' },
      session: { environmentId: 'env_stale_404' },
      mode: 'dashboard',
      selectedExplores: [],
      folderId: '5',
      schemaMarkdown: '',
      userPrompt: 'What is my personal folder?',
      onStatus: () => {},
    })
    expect(turnRes.session.environmentId).toBe('env_recovered_229')
    expect(turnUpdatedCalls).toContainEqual({ envId: 'env_recovered_229', hash: CURRENT_MANAGED_SOURCES_HASH })
    expect((await loadUserEnvironmentState(sdk, '1'))?.sourcesHash).toBe(CURRENT_MANAGED_SOURCES_HASH)
  })

  test('97. Issue #229: encodes <=12KiB gzip/utf8 chunks and syncs delta skill changes, missing manifests, missing SYNC_OK errors, aborts, and expired environments', async () => {
    clearArtifactServiceCache()
    const { sdk } = createInMemoryArtifactSdk()
    await saveUserEnvironmentId(sdk, '1', 'env_sync_229', undefined, '000000000000dead')

    // Verify both gzip and plain UTF-8 base64 fallback chunking stay <= MAX_SYNC_CHUNK_B64_CHARS
    const bigSample = JSON.stringify({ text: 'Looker skill content '.repeat(4000) })
    const gzipEncoded = await encodeSyncPayloadChunks(bigSample)
    expect(gzipEncoded.chunks.every((c) => c.length <= MAX_SYNC_CHUNK_B64_CHARS)).toBe(true)
    const decodedGzipBytes = Buffer.from(gzipEncoded.chunks.join(''), 'base64')
    const gunzipped = gzipEncoded.encoding === 'gzip' ? gunzipSync(decodedGzipBytes).toString('utf8') : decodedGzipBytes.toString('utf8')
    expect(gunzipped).toBe(bigSample)

    const gObj = globalThis as Record<string, unknown>
    const origCompressionStream = gObj.CompressionStream
    let plainEncoded: Awaited<ReturnType<typeof encodeSyncPayloadChunks>>
    try {
      gObj.CompressionStream = undefined
      plainEncoded = await encodeSyncPayloadChunks(bigSample, { maxChunkChars: 2048 })
    } finally {
      gObj.CompressionStream = origCompressionStream
    }
    expect(plainEncoded.encoding).toBe('utf8')
    expect(plainEncoded.chunks.length).toBeGreaterThan(1)
    expect(plainEncoded.chunks.every((c) => c.length <= 2048)).toBe(true)
    expect(Buffer.from(plainEncoded.chunks.join(''), 'base64').toString('utf8')).toBe(bigSample)

    // Case A: Up-to-date manifest -> 0 POST /interactions calls, backfills sourcesHash
    let postCalls = 0
    const upToDateRes = await syncManagedSkillsIntoEnvironment({
      sdk,
      userId: '1',
      environmentId: 'env_sync_229',
      auth: { mode: 'apikey', apiKey: 'test_key' },
      extensionSDK: asHost({
        serverProxy: async (url: string) => {
          if (url.includes('/files/')) return { ok: true, status: 200, body: MANAGED_SOURCES_MANIFEST_JSON }
          postCalls += 1
          return { ok: true, status: 200, body: '{}' }
        },
      }),
    })
    expect(postCalls).toBe(0)
    expect(upToDateRes).toEqual({
      status: 'up_to_date',
      updatedCount: 0,
      deletedCount: 0,
      sourcesHash: CURRENT_MANAGED_SOURCES_HASH,
    })
    expect((await loadUserEnvironmentState(sdk, '1'))?.sourcesHash).toBe(CURRENT_MANAGED_SOURCES_HASH)

    // Case B: Delta diff (1 modified file + 1 removed skill; ignores /workspace/apps/* & /workspace/data/*; omits max_total_tokens)
    await saveUserEnvironmentId(sdk, '1', 'env_sync_229', undefined, '111111111111dead')
    const capturedBodies: Array<Record<string, unknown>> = []
    const driftedManifest = JSON.stringify({
      sourcesHash: '111111111111dead',
      files: {
        ...MANAGED_SOURCES_FILE_HASHES,
        '/workspace/AGENTS.md': '111111111111dead',
        '/workspace/skills/obsolete-skill/SKILL.md': '222222222222beef',
        '/workspace/apps/my-app/app.js': '333333333333cafe',
        '/workspace/data/run1/input.sql': '444444444444babe',
      },
    })
    const deltaRes = await syncManagedSkillsIntoEnvironment({
      sdk,
      userId: '1',
      environmentId: 'env_sync_229',
      auth: { mode: 'apikey', apiKey: 'test_key' },
      extensionSDK: asHost({
        serverProxy: async (url: string, init?: { body?: string }) => {
          if (url.includes('/files/')) return { ok: true, status: 200, body: driftedManifest }
          const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
          capturedBodies.push(body)
          const prompt = String((body.input as Array<{ text?: string }>)[0]?.text || '')
          const marker = prompt.match(/reply with ((?:CHUNK_OK:\d+|SYNC_OK:[0-9a-f]+))/)?.[1] || ''
          return { ok: true, status: 200, body: JSON.stringify({ id: 'int_delta_1', status: 'completed', output_text: marker }) }
        },
      }),
    })
    expect(deltaRes).toEqual({
      status: 'synced',
      updatedCount: 1,
      deletedCount: 1,
      sourcesHash: CURRENT_MANAGED_SOURCES_HASH,
    })
    expect(capturedBodies.length).toBeGreaterThanOrEqual(1)
    for (const b of capturedBodies) {
      expect(b.store).toBe(false)
      expect(b.environment).toBe('env_sync_229')
      expect(b.tools).toEqual([{ type: 'code_execution' }])
      expect(b.generation_config).toEqual({ thinking_level: 'low' })
      expect((b.generation_config as Record<string, unknown>).max_total_tokens).toBeUndefined()
    }
    const b64Joined = capturedBodies
      .map((b) => {
        const prompt = String((b.input as Array<{ text?: string }>)[0]?.text || '')
        const m = prompt.match(/(?:write_text|_f\.write)\(("[^"]*"),\s*encoding="ascii"\)|_f\.write\(("[^"]*")\)/)
        return JSON.parse(m?.[1] || m?.[2] || '""') as string
      })
      .join('')
    const rawDeltaBytes = Buffer.from(b64Joined, 'base64')
    const deltaJsonText =
      rawDeltaBytes[0] === 0x1f && rawDeltaBytes[1] === 0x8b ? gunzipSync(rawDeltaBytes).toString('utf8') : rawDeltaBytes.toString('utf8')
    const decodedDelta = JSON.parse(deltaJsonText) as {
      files: Array<{ target: string }>
      deletedPaths: string[]
      pruneUnlistedSkills: boolean
    }
    expect(decodedDelta.files.map((f) => f.target)).toEqual(['/workspace/AGENTS.md'])
    expect(decodedDelta.deletedPaths).toEqual(['/workspace/skills/obsolete-skill/SKILL.md'])
    expect(decodedDelta.pruneUnlistedSkills).toBe(false)

    // Case B2: AbortSignal aborts in-flight skill sync without advancing stored sourcesHash
    await saveUserEnvironmentId(sdk, '1', 'env_sync_229', undefined, '222222222222dead')
    const abortCtl = new AbortController()
    await expect(
      syncManagedSkillsIntoEnvironment({
        sdk,
        userId: '1',
        environmentId: 'env_sync_229',
        signal: abortCtl.signal,
        auth: { mode: 'apikey', apiKey: 'test_key' },
        extensionSDK: asHost({
          serverProxy: async (url: string) => {
            if (url.includes('/files/')) {
              abortCtl.abort()
              return { ok: true, status: 200, body: driftedManifest }
            }
            return { ok: true, status: 200, body: '{}' }
          },
        }),
      })
    ).rejects.toThrow(/aborted/i)
    expect((await loadUserEnvironmentState(sdk, '1'))?.sourcesHash).toBe('222222222222dead')

    // Case C: Missing SYNC_OK marker rejects and does NOT advance stored sourcesHash
    await saveUserEnvironmentId(sdk, '1', 'env_sync_229', undefined, '555555555555dead')
    await expect(
      syncManagedSkillsIntoEnvironment({
        sdk,
        userId: '1',
        environmentId: 'env_sync_229',
        auth: { mode: 'apikey', apiKey: 'test_key' },
        extensionSDK: asHost({
          serverProxy: async (url: string) => {
            if (url.includes('/files/')) return { ok: true, status: 200, body: driftedManifest }
            return { ok: true, status: 200, body: JSON.stringify({ id: 'int_bad', status: 'completed', output_text: 'Forgot marker' }) }
          },
        }),
      })
    ).rejects.toThrow(`SYNC_OK:${CURRENT_MANAGED_SOURCES_HASH}`)
    expect((await loadUserEnvironmentState(sdk, '1'))?.sourcesHash).toBe('555555555555dead')

    // Case D: Legacy container missing manifest (file 404) -> pruneUnlistedSkills = true & multi-chunk full sync
    let legacyChunks = 0
    const legacyRes = await syncManagedSkillsIntoEnvironment({
      sdk,
      userId: '1',
      environmentId: 'env_sync_229',
      auth: { mode: 'apikey', apiKey: 'test_key' },
      extensionSDK: asHost({
        serverProxy: async (url: string, init?: { body?: string }) => {
          if (url.includes('/files/')) return { ok: false, status: 404, body: JSON.stringify({ error: { message: 'File not found in remote sandbox' } }) }
          legacyChunks += 1
          const body = JSON.parse(String(init?.body || '{}')) as { input?: Array<{ text?: string }> }
          const prompt = String(body.input?.[0]?.text || '')
          const marker = prompt.match(/reply with ((?:CHUNK_OK:\d+|SYNC_OK:[0-9a-f]+))/)?.[1] || ''
          return { ok: true, status: 200, body: JSON.stringify({ id: `int_leg_${legacyChunks}`, status: 'completed', output_text: marker }) }
        },
      }),
    })
    expect(legacyChunks).toBeGreaterThan(1)
    expect(legacyRes.status).toBe('synced')
    expect(legacyRes.updatedCount).toBe(buildManagedWorkspaceSources().length)

    // Case E: Expired environment 404 -> returns status: 'environment_expired' cleanly
    const expiredRes = await syncManagedSkillsIntoEnvironment({
      sdk,
      userId: '1',
      environmentId: 'env_expired_404',
      auth: { mode: 'apikey', apiKey: 'test_key' },
      extensionSDK: asHost({
        serverProxy: async () => ({
          ok: false,
          status: 404,
          body: JSON.stringify({ error: { message: 'Environment env_expired_404 was not found' } }),
        }),
      }),
    })
    expect(expiredRes).toEqual({
      status: 'environment_expired',
      updatedCount: 0,
      deletedCount: 0,
      sourcesHash: CURRENT_MANAGED_SOURCES_HASH,
    })
  })

  test('98. Issue #229: clearAllUserConversations wipes user_conversations and user_<uid>_* index keys, tombstones in-flight turns against resurrection, and preserves all Looker content & obj_* artifacts', async () => {
    clearArtifactServiceCache()
    const { sdk, store, deletedDashboards, deletedLooks, deletedBoards } = createInMemoryArtifactSdk()
    const svc = getArtifactService(sdk)

    await svc.saveUserArtifact('1', { id: '42', type: 'app', title: 'Exec App', updatedAt: '2026-11-01T00:00:00Z', createdBy: '1' }, { id: '42', dashboardId: '42' })
    await svc.saveUserArtifact('1', { id: '7', type: 'dashboard', title: 'Exec UDD', updatedAt: '2026-11-01T00:00:00Z', createdBy: '1' }, { id: '7', dashboardId: '7' })
    await svc.saveUserConfig('1', { agentName: 'Maverick' })
    await saveUserConversation(sdk, '1', {
      id: 'conv_wipe_1',
      type: 'app',
      label: 'Exec App',
      content: { dashboardId: '42', appArtifactId: 'obj_app_42' },
      contentItems: [{ key: 'data_app:42', id: '42', contentType: 'data_app', title: 'Exec App', embedPath: '/embed/dashboards/42' }],
      messages: [{ role: 'user', text: 'Build app' }],
    })
    await saveUserConversation(sdk, '1', {
      id: 'conv_wipe_2',
      type: 'dashboard',
      label: 'Exec UDD',
      content: { dashboardId: '7', lookId: '301' },
      contentItems: [
        { key: 'dashboard:7', id: '7', contentType: 'dashboard', title: 'Exec UDD', embedPath: '/embed/dashboards/7' },
        { key: 'look:301', id: '301', contentType: 'look', title: 'Margin Look', embedPath: '/embed/looks/301' },
      ],
      messages: [{ role: 'user', text: 'Build dashboard' }],
    })

    expect((await loadUserConversations(sdk, '1')).length).toBe(2)
    expect(store.has('user_1_app_42')).toBe(true)
    expect(store.has('user_1_dashboard_7')).toBe(true)

    await clearAllUserConversations(sdk, '1', undefined, ['conv_optimistic_inflight'])

    expect(await loadUserConversations(sdk, '1')).toEqual([])
    expect(JSON.parse(store.get('user_conversations:1')!.value)).toEqual([])
    expect(store.has('user_1_app_42')).toBe(false)
    expect(store.has('user_1_dashboard_7')).toBe(false)
    // Shared obj_* artifacts, user_config:1, and Looker Dashboards/Looks/Boards must stay untouched
    expect(store.has('obj_app_42')).toBe(true)
    expect(store.has('obj_dashboard_7')).toBe(true)
    expect(store.has('user_config:1')).toBe(true)
    expect(deletedDashboards).toEqual([])
    expect(deletedLooks).toEqual([])
    expect(deletedBoards).toEqual([])

    // Tombstone check prevents stale background turn saves from resurrecting wiped or optimistic threads
    expect(isUserConversationDeleted(sdk, '1', 'conv_wipe_1')).toBe(true)
    expect(isUserConversationDeleted(sdk, '1', 'conv_optimistic_inflight')).toBe(true)
    await saveUserConversation(sdk, '1', { id: 'conv_wipe_1', type: 'app', label: 'Stale resurrection attempt' })
    await saveUserConversation(sdk, '1', { id: 'conv_optimistic_inflight', type: 'app', label: 'Stale optimistic attempt' })
    expect(await loadUserConversations(sdk, '1')).toEqual([])
  })
}
