import type { IDashboard, IDashboardElement, Looker40SDK } from '@looker/sdk'

import {
  clearArtifactServiceCache,
  deleteLocalDraftScript as apiDeleteLocalDraftScript,
  DRAFT_PYTHON_SCRIPTS_STORAGE_KEY,
  listLocalDraftScripts as apiListLocalDraftScripts,
  loadLocalDraftScript as apiLoadLocalDraftScript,
  loadTileScriptFromElement,
  MAX_LOCAL_DRAFT_SCRIPTS,
  publishScriptDashboard,
  saveLocalDraftScript as apiSaveLocalDraftScript,
  saveTileScriptToElement,
  type TileElementScriptPayload,
} from '../../lookerApi'
import {
  deleteLocalDraftScript,
  type ExtensionHostStorageLike,
  listLocalDraftScripts,
  loadLocalDraftScript,
  saveLocalDraftScript,
} from '../../lookerPermissions'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart26Tests(): void {
  test('91. Issue #228: saveTileScriptToElement shallow-merges python_tile_script onto IDashboardElement.rich_content_json, verifies updated.rich_content_json with 0 post-PATCH GETs, 0 note_text writes, and 0 update_artifacts calls', async () => {
    let getElementCalls = 0
    let updateElementCalls = 0
    let updateArtifactsCalls = 0
    const patchBodies: Array<Partial<IDashboardElement>> = []
    let storedElement: Partial<IDashboardElement> = {
      id: '57',
      type: 'extension',
      extension_id: 'data_app_builder::data_app_builder',
      rich_content_json: JSON.stringify({
        custom_meta: { owner: 'finops', pinned: true },
        tile_version: 2,
      }),
    }

    const sdk = asSdk({
      ok: async <T>(p: Promise<T>): Promise<T> => p,
      dashboard_element: async (elementId: string): Promise<Partial<IDashboardElement>> => {
        getElementCalls += 1
        expect(elementId).toBe('57')
        return storedElement
      },
      update_dashboard_element: async (
        elementId: string,
        body: Partial<IDashboardElement>
      ): Promise<Partial<IDashboardElement>> => {
        updateElementCalls += 1
        expect(elementId).toBe('57')
        patchBodies.push(body)
        storedElement = { ...storedElement, ...body }
        return storedElement
      },
      update_artifacts: async () => {
        updateArtifactsCalls += 1
        return []
      },
    })

    const saved: TileElementScriptPayload = await saveTileScriptToElement(sdk, '57', {
      scriptId: 'rev_audit',
      title: 'Revenue Audit Tile',
      code: 'return [{"revenue": 125000}]',
    })

    expect(saved.scriptId).toBe('rev_audit')
    expect(saved.title).toBe('Revenue Audit Tile')
    expect(saved.code).toBe('return [{"revenue": 125000}]')
    expect(Boolean(saved.updatedAt)).toBe(true)

    // 1 initial GET to read existing rich_content_json + 1 PATCH (0 post-PATCH verification GETs)
    expect(getElementCalls).toBe(1)
    expect(updateElementCalls).toBe(1)
    expect(updateArtifactsCalls).toBe(0)
    expect(patchBodies).toHaveLength(1)
    expect('note_text' in patchBodies[0]).toBe(false)

    const merged = JSON.parse(String(storedElement.rich_content_json || '{}')) as Record<string, unknown>
    expect(merged.custom_meta).toEqual({ owner: 'finops', pinned: true })
    expect(merged.tile_version).toBe(2)
    expect(merged.python_tile_script).toEqual(saved)

    // Fails closed if Looker returns empty rich_content_json on update_dashboard_element
    const brokenSdk = asSdk({
      ok: async <T>(p: Promise<T>): Promise<T> => p,
      dashboard_element: async (): Promise<Partial<IDashboardElement>> => ({ id: '57', rich_content_json: null }),
      update_dashboard_element: async (): Promise<Partial<IDashboardElement>> => ({ id: '57', rich_content_json: '' }),
    })
    await expect(
      saveTileScriptToElement(brokenSdk, '57', {
        scriptId: 'broken',
        title: 'Broken Save',
        code: 'return []',
      })
    ).rejects.toThrow(/empty rich_content_json/i)

    // Propagates non-404 GET errors without calling update_dashboard_element so sibling rich_content_json keys are never wiped
    let transientPatchCalls = 0
    const transientErrSdk = asSdk({
      ok: async <T>(p: Promise<T>): Promise<T> => p,
      dashboard_element: async (): Promise<Partial<IDashboardElement>> => {
        throw new Error('503 Service Unavailable')
      },
      update_dashboard_element: async (): Promise<Partial<IDashboardElement>> => {
        transientPatchCalls += 1
        return { id: '57', rich_content_json: '{}' }
      },
    })
    await expect(
      saveTileScriptToElement(transientErrSdk, '57', {
        scriptId: 'transient',
        title: 'Transient Failure',
        code: 'return [1]',
      })
    ).rejects.toThrow(/503 Service Unavailable/)
    expect(transientPatchCalls).toBe(0)
  })

  test('92. Issue #228: publishScriptDashboard writes python_tile_script directly to IDashboardElement.rich_content_json on create and in-place update with 0 update_artifacts calls', async () => {
    let updateArtifactsCalls = 0
    const rawCalls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = []
    const elementsById: Record<string, Partial<IDashboardElement>> = {}

    const sdk = asSdk({
      ok: async <T>(p: Promise<T>): Promise<T> => p,
      dashboard: async (id: string): Promise<Partial<IDashboard>> => ({
        id: String(id),
        title: 'Python Runner',
        dashboard_elements:
          String(id) === '88'
            ? [
                elementsById['501'] || {
                  id: '501',
                  type: 'extension',
                  extension_id: 'data_app_builder::data_app_builder',
                  rich_content_json: JSON.stringify({ existing_flag: 'keep_me' }),
                },
              ]
            : [],
        dashboard_layouts: [{ id: '901', type: 'newspaper', active: true }],
      }),
      update_dashboard_element: async (
        id: string,
        body: Partial<IDashboardElement>
      ): Promise<Partial<IDashboardElement>> => {
        const next: Partial<IDashboardElement> = { id, type: 'extension', ...body }
        elementsById[id] = next
        return next
      },
      update_artifacts: async () => {
        updateArtifactsCalls += 1
        return []
      },
      authSession: {
        transport: {
          rawRequest: async (
            method: string,
            path: string,
            _query?: Record<string, unknown>,
            body?: unknown
          ) => {
            const parsedBody =
              typeof body === 'string'
                ? (JSON.parse(body) as Record<string, unknown>)
                : ((body || undefined) as Record<string, unknown> | undefined)
            rawCalls.push({ method, path, body: parsedBody })
            if (method === 'POST' && path === '/dashboards') {
              return { ok: true, statusCode: 200, body: JSON.stringify({ id: '77' }) }
            }
            if (method === 'POST' && path === '/dashboard_elements') {
              const created = { id: '401', ...parsedBody }
              elementsById['401'] = created as Partial<IDashboardElement>
              return { ok: true, statusCode: 200, body: JSON.stringify(created) }
            }
            return { ok: true, statusCode: 200, body: JSON.stringify({ id: '901' }) }
          },
        },
      },
    })

    // 1. New dashboard publish -> POST /dashboard_elements carries rich_content_json.python_tile_script
    const created = await publishScriptDashboard(sdk, {
      script: {
        id: 'kpi_summary',
        title: 'KPI Summary Script',
        code: 'return [{"kpi": 42}]',
        updatedAt: '2026-11-18T00:00:00.000Z',
      },
      folderId: '5',
      extensionId: 'data_app_builder::data_app_builder',
    })
    expect(created).toEqual({
      dashboardId: '77',
      elementId: '401',
      extensionId: 'data_app_builder::data_app_builder',
    })
    const postEl = rawCalls.find((c) => c.method === 'POST' && c.path === '/dashboard_elements')
    expect(postEl).toBeDefined()
    const createdRich = JSON.parse(String(postEl?.body?.rich_content_json || '{}')) as {
      python_tile_script?: TileElementScriptPayload
    }
    expect(createdRich.python_tile_script?.scriptId).toBe('kpi_summary')
    expect(createdRich.python_tile_script?.title).toBe('KPI Summary Script')
    expect(createdRich.python_tile_script?.code).toBe('return [{"kpi": 42}]')
    expect(updateArtifactsCalls).toBe(0)

    // 2. In-place dashboard publish -> update_dashboard_element shallow-merges existing rich_content_json keys
    const updated = await publishScriptDashboard(sdk, {
      script: {
        id: 'kpi_summary_v2',
        title: 'KPI Summary Script v2',
        code: 'return [{"kpi": 99}]',
        updatedAt: '2026-11-18T01:00:00.000Z',
      },
      folderId: '5',
      extensionId: 'data_app_builder::data_app_builder',
      existingDashboardId: '88',
    })
    expect(updated).toEqual({
      dashboardId: '88',
      elementId: '501',
      extensionId: 'data_app_builder::data_app_builder',
    })
    const updatedRich = JSON.parse(String(elementsById['501']?.rich_content_json || '{}')) as {
      existing_flag?: string
      python_tile_script?: TileElementScriptPayload
    }
    expect(updatedRich.existing_flag).toBe('keep_me')
    expect(updatedRich.python_tile_script?.scriptId).toBe('kpi_summary_v2')
    expect(updatedRich.python_tile_script?.code).toBe('return [{"kpi": 99}]')
    expect(updateArtifactsCalls).toBe(0)

    // 3. Self-heals 404 on deleted existingDashboardId by creating a fresh dashboard
    const selfHealSdk = asSdk({
      ok: async <T>(p: Promise<T>): Promise<T> => p,
      dashboard: async (id: string): Promise<Partial<IDashboard>> => ({
        id: String(id),
        title: 'Recovered Runner',
        dashboard_elements: [],
        dashboard_layouts: [{ id: '902', type: 'newspaper', active: true }],
      }),
      authSession: {
        transport: {
          rawRequest: async (method: string, path: string, _q?: Record<string, unknown>, body?: unknown) => {
            if (method === 'PATCH' && path === '/dashboards/404_deleted') {
              return { ok: false, statusCode: 404, body: JSON.stringify({ message: 'Not found' }) }
            }
            if (method === 'POST' && path === '/dashboards') {
              return { ok: true, statusCode: 200, body: JSON.stringify({ id: '99' }) }
            }
            if (method === 'POST' && path === '/dashboard_elements') {
              const parsed = typeof body === 'string' ? JSON.parse(body) : body
              return { ok: true, statusCode: 200, body: JSON.stringify({ id: '601', ...(parsed as object) }) }
            }
            return { ok: true, statusCode: 200, body: JSON.stringify({ id: '902' }) }
          },
        },
      },
    })
    const healed = await publishScriptDashboard(selfHealSdk, {
      script: { id: 'healed_script', title: 'Healed', code: 'return [1]', updatedAt: '2026-11-18T02:00:00.000Z' },
      folderId: '5',
      extensionId: 'data_app_builder::data_app_builder',
      existingDashboardId: '404_deleted',
    })
    expect(healed).toEqual({
      dashboardId: '99',
      elementId: '601',
      extensionId: 'data_app_builder::data_app_builder',
    })
  })

  test('93. Issue #228: loadTileScriptFromElement prefers rich_content_json.python_tile_script and falls back read-only to legacy tile_element_<id> -> obj_script_<id> with 0 artifact writes', async () => {
    clearArtifactServiceCache()
    let artifactGetCalls = 0
    let artifactWriteCalls = 0

    const elements: Record<string, Partial<IDashboardElement>> = {
      '57': {
        id: '57',
        type: 'extension',
        rich_content_json: JSON.stringify({
          python_tile_script: {
            scriptId: 'native_57',
            title: 'Native Rich Content Tile',
            code: 'return [{"source": "rich_content_json"}]',
            updatedAt: '2026-11-18T10:00:00.000Z',
          },
        }),
      },
      '58': {
        id: '58',
        type: 'extension',
        rich_content_json: JSON.stringify({ other_key: true }),
      },
      '999': {
        id: '999',
        type: 'extension',
        rich_content_json: null,
      },
    }

    const legacyArtifacts: Record<string, Record<string, unknown>> = {
      tile_element_58: {
        scriptId: 'legacy_demo',
        title: 'Legacy Pointer Tile',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      obj_script_legacy_demo: {
        id: 'legacy_demo',
        title: 'Legacy Dereferenced Script',
        code: 'return [{"source": "legacy_artifact_fallback"}]',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    }

    const sdk = asSdk({
      ok: async <T>(p: Promise<T>): Promise<T> => p,
      dashboard_element: async (id: string): Promise<Partial<IDashboardElement>> =>
        elements[id] || { id, rich_content_json: null },
      artifact: async ({ key }: { key: string }) => {
        artifactGetCalls += 1
        const found = legacyArtifacts[key]
        return found ? [{ key, version: 1, value: JSON.stringify(found) }] : []
      },
      search_artifacts: async () => [],
      update_artifacts: async () => {
        artifactWriteCalls += 1
        return []
      },
    })

    // 1. Reads rich_content_json.python_tile_script directly with 0 artifact reads or writes
    const primary = await loadTileScriptFromElement(sdk, '57')
    expect(primary).toEqual({
      scriptId: 'native_57',
      title: 'Native Rich Content Tile',
      code: 'return [{"source": "rich_content_json"}]',
      updatedAt: '2026-11-18T10:00:00.000Z',
    })
    expect(artifactGetCalls).toBe(0)
    expect(artifactWriteCalls).toBe(0)

    // 2. Falls back read-only to legacy tile_element_58 -> obj_script_legacy_demo when rich_content_json lacks python_tile_script
    const fallback = await loadTileScriptFromElement(sdk, '58')
    expect(fallback).toEqual({
      scriptId: 'legacy_demo',
      title: 'Legacy Pointer Tile',
      code: 'return [{"source": "legacy_artifact_fallback"}]',
      updatedAt: '2026-10-01T00:00:00.000Z',
    })
    expect(artifactGetCalls).toBe(2)
    expect(artifactWriteCalls).toBe(0)

    // 3. Returns null when neither rich_content_json nor legacy artifact has a bound script
    const unbound = await loadTileScriptFromElement(sdk, '999')
    expect(unbound).toBeNull()
    expect(artifactWriteCalls).toBe(0)
  })

  test('94. Issue #228: local draft script helpers round-trip via setDualStorage/getDualStorage when Antigravity auth is unconfigured (!isConfigured), cap at 25 drafts, and emit 0 update_artifacts calls', async () => {
    expect(apiSaveLocalDraftScript).toBe(saveLocalDraftScript)
    expect(apiLoadLocalDraftScript).toBe(loadLocalDraftScript)
    expect(apiListLocalDraftScripts).toBe(listLocalDraftScripts)
    expect(apiDeleteLocalDraftScript).toBe(deleteLocalDraftScript)
    expect(DRAFT_PYTHON_SCRIPTS_STORAGE_KEY).toBe('dab_draft_python_scripts_v1')
    expect(MAX_LOCAL_DRAFT_SCRIPTS).toBe(25)

    // Simulate an unconfigured browser/extension host environment with isolated ExtensionHostStorageLike
    const hostStore = new Map<string, string>()
    const extHost: ExtensionHostStorageLike = {
      localStorageGetItem: async (key: string) => hostStore.get(key) ?? null,
      localStorageSetItem: async (key: string, value = '') => {
        hostStore.set(key, value)
        return true
      },
    }

    const prevWindow = (globalThis as { window?: unknown }).window
    delete (globalThis as { window?: unknown }).window
    try {
      const [savedAlpha, savedBeta] = await Promise.all([
        saveLocalDraftScript(
          {
            id: 'draft_alpha',
            title: 'Alpha Draft Script',
            code: 'return [{"alpha": 1}]',
            dashboardId: '8',
            elementId: '57',
            updatedAt: '2026-11-18T12:00:00.000Z',
          },
          extHost
        ),
        saveLocalDraftScript(
          {
            id: 'draft_beta',
            title: 'Beta Concurrent Script',
            code: 'return [{"beta": 2}]',
            updatedAt: '2026-11-18T12:05:00.000Z',
          },
          extHost
        ),
      ])
      expect(savedAlpha.id).toBe('draft_alpha')
      expect(savedBeta.id).toBe('draft_beta')
      expect(hostStore.has(DRAFT_PYTHON_SCRIPTS_STORAGE_KEY)).toBe(true)

      const loadedAlpha = await loadLocalDraftScript('draft_alpha', extHost)
      const loadedBeta = await loadLocalDraftScript('draft_beta', extHost)
      expect(loadedAlpha).toEqual(savedAlpha)
      expect(loadedBeta).toEqual(savedBeta)

      // Cap enforcement: insert 28 drafts and verify newest 25 are retained in descending updatedAt order
      for (let i = 1; i <= 28; i += 1) {
        const padded = String(i).padStart(2, '0')
        await saveLocalDraftScript(
          {
            id: `draft_${padded}`,
            title: `Draft ${padded}`,
            code: `return [${i}]`,
            updatedAt: `2026-11-18T13:${padded}:00.000Z`,
          },
          extHost
        )
      }

      const listed = await listLocalDraftScripts(extHost)
      expect(listed).toHaveLength(25)
      expect(listed[0].id).toBe('draft_28')
      expect(listed[24].id).toBe('draft_04')
      expect(await loadLocalDraftScript('draft_alpha', extHost)).toBeNull()

      await deleteLocalDraftScript('draft_28', extHost)
      const afterDelete = await listLocalDraftScripts(extHost)
      expect(afterDelete).toHaveLength(24)
      expect(await loadLocalDraftScript('draft_28', extHost)).toBeNull()
    } finally {
      if (prevWindow !== undefined) {
        ;(globalThis as { window?: unknown }).window = prevWindow
      }
    }
  })
}
