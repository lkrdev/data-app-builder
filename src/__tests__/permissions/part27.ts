import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import React from 'react'

import type { Looker40SDK } from '@looker/sdk'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  type AntigravityExtensionHostLike,
  buildManagedWorkspaceSources,
  buildWorkspaceSources,
  CURRENT_MANAGED_SOURCES_HASH,
  encodeSyncPayloadChunks,
  extractInteractionOutputText,
  MANAGED_SOURCES_FILE_HASHES,
  MANAGED_SOURCES_MANIFEST_JSON,
  MANAGED_SOURCES_MANIFEST_PATH,
  MAX_SYNC_CHUNK_B64_CHARS,
  prewarmOrWakeAntigravityEnvironment,
  resolveBuiltinWorkspaceFileContent,
  runAntigravityTurn,
  sanitizeDataAppAssistantText,
  syncManagedSkillsIntoEnvironment,
} from '../../antigravity'
import { RipperLogo } from '../../components/StudioDesignSystem'
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
import type { StudioController } from '../../useStudioController'

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
      onEnvironmentUpdated: (envId, hash) => { updatedCalls.push({ envId, hash }) },
    })
    expect(provisionedId.session.environmentId).toBe('env_provisioned_229')
    expect(updatedCalls).toEqual([{ envId: 'env_provisioned_229', hash: CURRENT_MANAGED_SOURCES_HASH }])
    expect((await loadUserEnvironmentState(sdk, '1'))?.sourcesHash).toBe(CURRENT_MANAGED_SOURCES_HASH)

    // runAntigravityTurn 404 stale environment recovery stamps CURRENT_MANAGED_SOURCES_HASH on fresh replacement
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
              output_text: 'Fetched personal folder.',
            }),
          }
        },
      }),
      auth: { mode: 'apikey', apiKey: 'test_key' },
      session: { environmentId: 'env_stale_404' },
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

    const seedLegacy = (key: string, value: unknown) => {
      store.set(key, { key, version: 1, value: JSON.stringify(value) })
    }
    seedLegacy('user_1_app_42', { id: '42', type: 'app', title: 'Exec App', updatedAt: '2026-11-01T00:00:00Z', createdBy: '1' })
    seedLegacy('obj_app_42', { id: '42', dashboardId: '42' })
    seedLegacy('user_1_dashboard_7', { id: '7', type: 'dashboard', title: 'Exec UDD', updatedAt: '2026-11-01T00:00:00Z', createdBy: '1' })
    seedLegacy('obj_dashboard_7', { id: '7', dashboardId: '7' })
    await svc.saveUserConfig('1', { agentName: 'Maverick' })
    await saveUserConversation(sdk, '1', {
      id: 'conv_wipe_1',
      type: 'app',
      label: 'Exec App',
      content: { dashboardId: '42', appArtifactId: 'obj_app_42' },
      contentItems: [{ key: 'data_app:42', id: '42', contentType: 'data_app', title: 'Exec App', embedPath: '/embed/dashboards/42' }],
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

  test('99. sanitizes Data App .js/file:// references, injects code_execution on incomplete auto Data App turns, hydrates __bundle_ref__, and switches multi-modal auto workflows', async () => {
    const cleaned = sanitizeDataAppAssistantText(
      'Built **Sticker Center** ([app.js](file:///workspace/apps/conv_1/app.js)) with `/runtime/data-app.js`!\n\n**Looker Dashboard:** [Open Sticker Center](/dashboards/42)'
    )
    expect(cleaned).not.toMatch(/\.js\b|file:\/\/|\/workspace\b/i)
    expect(cleaned).toContain('**Looker Dashboard:** [Open Sticker Center](/dashboards/42)')

    const postedPayloads: Array<Record<string, unknown>> = []
    let postCount = 0
    const res = await runAntigravityTurn({
      sdk: asSdk({ ok: async <T>(p: T) => p }),
      extensionSDK: asHost({
        serverProxy: async (url: string, init?: { method?: string; body?: string }) => {
          if (url.includes(':stream') || url.includes('alt=sse') || url.includes('/files')) return { ok: false, status: 404, body: 'none' }
          if (init?.method === 'POST') { postCount += 1; postedPayloads.push(JSON.parse(String(init.body || '{}')) as Record<string, unknown>) }
          return {
            ok: true, status: 200,
            body: JSON.stringify({
              id: `int_rec_${postCount}`, environment_id: 'env_rec_auto', status: 'completed',
              steps: [{ name: 'write_to_file', arguments: JSON.stringify({ TargetFile: '/workspace/apps/conv_auto_1/app.js', CodeContent: "/** @title Sticker Command Center */\nimport { DataApp } from '/runtime/data-app.js';\ncustomElements.define('sticker-app', class extends DataApp {});" }) }],
              output_text: 'Built **Sticker Command Center** ([app.js](file:///workspace/apps/conv_auto_1/app.js)) with five interactive views.',
            }),
          }
        },
      }),
      conversationId: 'conv_auto_1', auth: { mode: 'apikey', apiKey: 'k_rec' }, session: { environmentId: 'env_rec_auto' },
      selectedExplores: ['thelook::order_items'], schemaMarkdown: '# Schema', userPrompt: 'Build Sticker Command Center', onStatus: () => {},
    })
    expect(postedPayloads).toHaveLength(3)
    expect(((postedPayloads[1]?.tools as Array<{ type?: string }>) || []).some((t) => t.type === 'code_execution')).toBe(true)
    expect(res.bundle?.title).toBe('Sticker Command Center')
    expect(res.bundle?.prod_code).toContain('https://www.gstatic.com/looker-data-apps/versions/1.3.0/data-app.js')
    expect(res.assistantText).not.toMatch(/\.js\b|file:\/\/|\/workspace\b/i)

    expect(extractInteractionOutputText({
      steps: [
        { type: 'model_output', text: 'Pre-tool narration.' },
        { type: 'code_execution_result', result: '<DATA_APP_BUNDLE>{"__bundle_ref__":"/workspace/apps/conv_ref/bundle.json"}</DATA_APP_BUNDLE>' },
        { type: 'model_output', text: 'Final clean summary of Sticker Command Center.' },
      ],
    })).toBe('Final clean summary of Sticker Command Center.')

    const refRes = await runAntigravityTurn({
      sdk: asSdk({ ok: async <T>(p: T) => p }),
      extensionSDK: asHost({
        serverProxy: async (url: string) => {
          if (url.includes(':stream') || url.includes('alt=sse')) return { ok: false, status: 404, body: 'no sse' }
          if (url.includes('/files')) {
            return {
              ok: true, status: 200,
              body: JSON.stringify({
                title: 'Sticker-Book E-Commerce Command Center', version: '1.3.0',
                raw_code: "import { DataApp } from '/runtime/data-app.js';\ncustomElements.define('sb-app', class extends DataApp {});",
                prod_code: "import { DataApp } from 'https://www.gstatic.com/looker-data-apps/versions/1.3.0/data-app.js';\ncustomElements.define('sb-app', class extends DataApp {});",
                widgets: [{ id: 'w1', tag: 'app-kpi', query: { model: 'thelook', view: 'order_items', fields: ['order_items.count'] } }],
              }),
            }
          }
          return {
            ok: true, status: 200,
            body: JSON.stringify({
              id: 'int_ref_1', environment_id: 'env_ref_1', status: 'completed',
              steps: [
                { type: 'code_execution_result', result: '<DATA_APP_BUNDLE>{"__bundle_ref__":"/workspace/apps/conv_ref/bundle.json","title":"Sticker-Book E-Commerce Command Center","version":"1.3.0","widgets":[{"id":"w1"}]}</DATA_APP_BUNDLE>' },
                { type: 'model_output', text: 'Built **Sticker-Book E-Commerce Command Center** with 5 views.' },
              ],
            }),
          }
        },
      }),
      conversationId: 'conv_ref', auth: { mode: 'apikey', apiKey: 'k_ref' }, session: { environmentId: 'env_ref_1' },
      selectedExplores: ['thelook::order_items'], schemaMarkdown: '# Schema', userPrompt: 'Build a playful sticker-book command center', onStatus: () => {},
    })
    expect(refRes.bundle?.title).toBe('Sticker-Book E-Commerce Command Center')
    expect(refRes.bundle?.widgets).toHaveLength(1)
    expect(refRes.assistantText).toBe('Built **Sticker-Book E-Commerce Command Center** with 5 views.')

    // Open-ended multi-modal conversation (KDA -> Data App -> LookML) retains full toolset without sticky mode lock-in
    const multiPosted: Array<{ tools?: Array<{ name?: string; type?: string }>; input?: Array<{ text?: string }> }> = []
    let seqIdx = 0
    const multiExt = asHost({
      serverProxy: async (url: string, init?: { method?: string; body?: string }) => {
        if (url.includes(':stream') || url.includes('alt=sse')) return { ok: false, status: 404, body: 'no sse' }
        if (init?.method === 'POST' && url.includes('/interactions')) {
          multiPosted.push(JSON.parse(String(init.body || '{}')))
          seqIdx += 1
        }
        const steps = seqIdx <= 2
          ? [
              { type: 'code_execution_result', result: '<DATA_APP_BUNDLE>{"title":"App","raw_code":"c","prod_code":"c","widgets":[]}</DATA_APP_BUNDLE>' },
              { type: 'model_output', text: seqIdx === 1 ? 'Investigated return rate drivers.' : 'Built Data App.' },
            ]
          : [{ type: 'model_output', text: 'Updated LookML view.' }]
        return { ok: true, status: 200, body: JSON.stringify({ id: `int_m_${seqIdx}`, environment_id: 'env_m', status: 'completed', steps }) }
      },
    })
    const baseMulti = {
      sdk: asSdk({ ok: async <T>(p: T) => p }), extensionSDK: multiExt, conversationId: 'conv_multi',
      auth: { mode: 'apikey' as const, apiKey: 'k_m' }, canDevelop: true,
      developableProjects: ['thelook'], canDeploy: true, selectedExplores: ['thelook::order_items'], schemaMarkdown: '# Schema', onStatus: () => {},
    }
    const m1 = await runAntigravityTurn({ ...baseMulti, session: {}, userPrompt: 'Investigate what drove return rate up last quarter' })
    const m2 = await runAntigravityTurn({ ...baseMulti, session: m1.session, environmentId: 'env_m', userPrompt: 'Now build an interactive Data App for those findings' })
    const m3 = await runAntigravityTurn({ ...baseMulti, session: m2.session, environmentId: 'env_m', existingAppCode: 'class X extends DataApp {}', userPrompt: 'Refactor that metric into a LookML view' })
    expect(m3.assistantText).toBe('Updated LookML view.')
    for (const p of multiPosted) {
      expect((p.tools || []).some((t) => t.type === 'code_execution')).toBe(true)
      expect((p.tools || []).some((t) => t.name === 'run_looker_codemode')).toBe(true)
      expect((p.tools || []).some((t) => t.name === 'lkr_cli_extension_bridge')).toBe(true)
    }
    expect(multiPosted[2]?.input?.[0]?.text || '').not.toContain('[WARM SANDBOX FAST PATH:')
    expect(multiPosted[2]?.input?.[0]?.text || '').toContain('[ACTIVE WORKSPACE STATE')
  })

  test('106. Issue #233: renders Option A RipperLogo with React 17-safe collision-free gradients, anchors StudioBrandAgentName home button without nested buttons, and enforces <= 800-line file cap', async () => {
    const html1 = renderToStaticMarkup(React.createElement(RipperLogo))
    const html2 = renderToStaticMarkup(React.createElement(RipperLogo))
    const grad1A = html1.match(/<linearGradient id="([^"]+)"/)?.[1]
    const grad2A = html2.match(/<linearGradient id="([^"]+)"/)?.[1]
    expect(grad1A).toMatch(/^ripperLogo_\d+_a$/)
    expect(grad2A).toMatch(/^ripperLogo_\d+_a$/)
    expect(grad1A).not.toBe(grad2A)
    expect(html1).toContain('data-testid="studio-brand-logo"')
    expect(html1).toContain('class="dab-brand-logo"')
    expect(html1).toContain('width="24"')
    expect(html1).toContain('height="24"')
    expect(html1).toContain('viewBox="6 8 84 80"')
    expect(html1).toContain('aria-hidden="true"')
    expect(html1).not.toMatch(/dab-ripper-(spin|ribbon|trough|board|spit)/)

    const detHtml = renderToStaticMarkup(
      React.createElement(RipperLogo, { size: 32, className: 'extra-mark', testId: 'det-logo', idPrefix: 'optA' })
    )
    const html3 = renderToStaticMarkup(React.createElement(RipperLogo))
    const grad2Num = Number(grad2A?.match(/^ripperLogo_(\d+)_a$/)?.[1] || 0)
    const grad3Num = Number(html3.match(/<linearGradient id="ripperLogo_(\d+)_a"/)?.[1] || 0)
    expect(grad3Num).toBe(grad2Num + 1) // explicit idPrefix="optA" does not increment ripperLogoSeq
    expect(detHtml).toContain('data-testid="det-logo"')
    expect(detHtml).toContain('class="dab-brand-logo extra-mark"')
    expect(detHtml).toContain('width="32" height="32"')
    expect(detHtml).toContain('style="width:32px;height:32px"')
    expect(detHtml).toContain('id="optA_a"')
    expect(detHtml).toContain('id="optA_b"')
    expect(detHtml).toContain('stroke="url(#optA_a)"')
    expect(detHtml).toContain('stroke="url(#optA_b)"')
    expect(detHtml).toContain('r="39" stroke="#0284c7" stroke-width="2.2" stroke-dasharray="90 150" opacity="0.38" transform="rotate(120 48 48)"')
    expect(detHtml).toContain('r="33" stroke="#22d3ee" stroke-width="1.8" stroke-dasharray="55 155" opacity="0.32" transform="rotate(-155 48 48)"')
    for (const d of [
      'M13 62C12 36 27 16 50 16C66 16 78 26 76 40',
      'M19 62C19 40 31 23 50 23C63 23 72 31 70 43C69 48 64 51 58 49',
      'M25 61C26 44 36 30 50 30C60 30 66 36 64 44',
      'M16 68C28 76 45 79 62 74C73 71 80 64 84 56',
      'M33 63C40 50 54 43 67 41C64.5 52.5 55 62.5 40.5 66.8C36.5 67.8 32 65.5 33 63Z',
    ]) {
      expect(detHtml).toContain(`d="${d}"`)
    }
    expect(detHtml).toContain('transform="translate(3 -3) rotate(-18 48 56)"')
    expect(detHtml).toContain('x1="37" y1="63" x2="64" y2="43"')
    expect(detHtml).toContain('cx="75" cy="32" r="2.4" fill="#22d3ee"')
    expect(detHtml).toContain('cx="80" cy="40" r="2" fill="#7dd3fc"')

    // Splash RipperSurfLoader & StudioBrandAgentName render cleanly with zero nested buttons
    const g = globalThis as Record<string, unknown>
    const hadWindow = 'window' in g
    const prevWindow = g.window
    try {
      if (!hadWindow) g.window = { addEventListener: () => {}, removeEventListener: () => {} }
      const { RipperSurfLoader, StudioBrandAgentName } = await import('../../components/StudioHeader')
      const loaderHtml = renderToStaticMarkup(React.createElement(RipperSurfLoader, { agentName: 'Ripper' }))
      expect(loaderHtml).toContain('data-testid="ripper-surf-loader"')
      expect(loaderHtml).toContain('data-testid="ripper-surf-loader-svg"')
      expect(loaderHtml).toContain('id="rcGrad2A"')
      expect(loaderHtml).toContain('id="rcGrad2B"')
      expect(loaderHtml).toContain('class="dab-ripper-ribbon-1"')
      expect(loaderHtml).toContain('class="dab-ripper-board-ride"')

      const makeCtl = (editingAgentName: boolean): StudioController =>
        ({
          agentName: 'Ripper',
          editingAgentName,
          setEditingAgentName: () => {},
          handleSaveAgentName: async () => {},
          handleNewConversation: () => {},
        }) as unknown as StudioController

      const idleBrandHtml = renderToStaticMarkup(React.createElement(StudioBrandAgentName, { ctl: makeCtl(false) }))
      expect(idleBrandHtml).toContain('data-testid="studio-brand-home-btn"')
      expect(idleBrandHtml).toContain('aria-label="Ripper — New conversation (Home)"')
      expect(idleBrandHtml).toContain('data-testid="studio-brand-logo"')
      expect(idleBrandHtml).toContain('<strong data-testid="studio-agent-name-label">Ripper</strong>')
      expect(idleBrandHtml).toContain('data-testid="studio-edit-agent-name-btn"')
      expect(idleBrandHtml.match(/<\/?button\b/g)).toEqual(['<button', '</button', '<button', '</button'])

      const editBrandHtml = renderToStaticMarkup(React.createElement(StudioBrandAgentName, { ctl: makeCtl(true) }))
      expect(editBrandHtml).not.toContain('data-testid="studio-brand-home-btn"')
      expect(editBrandHtml).toContain('data-testid="studio-brand-logo"')
      expect(editBrandHtml).toContain('data-testid="studio-agent-name-input"')
      expect(editBrandHtml).toContain('data-testid="studio-save-agent-name-btn"')
      expect(editBrandHtml.indexOf('studio-brand-logo')).toBeLessThan(editBrandHtml.indexOf('studio-agent-name-input'))
    } finally {
      if (hadWindow) g.window = prevWindow
      else delete g.window
    }

    // Verify zero React.useId() usage and <= 800-line cap across src/**
    const repoRoot = path.resolve(__dirname, '../../..')
    expect(readFileSync(path.join(repoRoot, 'src/components/StudioDesignSystem.tsx'), 'utf8')).not.toMatch(/\buseId\b/)
    const walkSrc = (dir: string, acc: string[] = []): string[] => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) walkSrc(full, acc)
        else if (/\.(ts|tsx|js|jsx|css)$/.test(ent.name)) acc.push(full)
      }
      return acc
    }
    const overCap = walkSrc(path.join(repoRoot, 'src'))
      .filter((f) => !f.endsWith('src/vendor/codemode.js') && !f.endsWith('src/sandboxSkillsBundle.ts'))
      .map((f) => ({ file: path.relative(repoRoot, f), lines: readFileSync(f, 'utf8').replace(/\n$/, '').split('\n').length }))
      .filter((x) => x.lines > 800)
    expect(overCap).toEqual([])
  })
}
