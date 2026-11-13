import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { Looker40SDK } from '@looker/sdk'

import { recoverInFlightInteraction } from '../../antigravity'
import { clearArtifactServiceCache, getArtifactService, STUDIO_INFLIGHT_CONV_SESSION_KEY } from '../../lookerApi'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart21Tests(): void {
  test('59. Issue #207: persists in-flight conversation and interactionId immediately on turn start, preserves monotonic messages in ArtifactService.saveConversation, and recovers interrupted interactions on reload via recoverInFlightInteraction', async () => {
    expect(STUDIO_INFLIGHT_CONV_SESSION_KEY).toBe('dab_inflight_conv_id')

    // 1. ArtifactService.saveConversation updates conversationsCache synchronously before put and preserves longer prev.messages on out-of-order saves
    clearArtifactServiceCache()
    let resolveFirstPut: (() => void) | null = null
    let putCallCount = 0
    const mockSdk207 = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async () => [],
      search_artifacts: async () => [],
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string }>) => {
        putCallCount += 1
        if (putCallCount === 1) {
          await new Promise<void>((resolve) => {
            resolveFirstPut = resolve
          })
        }
        return updates.map((u, idx) => ({ key: u.key, version: idx + 1 }))
      },
    })
    const svc = getArtifactService(mockSdk207)
    await svc.listConversations('1')

    const p1 = svc.saveConversation('1', {
      id: 'conv_207',
      type: 'app',
      label: 'Mid-turn Refresh Test',
      messages: [{ role: 'user', text: 'Build me an order overview' }],
      updatedAt: '2026-11-13T05:00:00.000Z',
    })
    // Synchronous cache update before first put resolves
    const cachedImmediately = await svc.listConversations('1')
    expect(cachedImmediately).toHaveLength(1)
    expect(cachedImmediately[0].id).toBe('conv_207')
    expect(cachedImmediately[0].messages).toHaveLength(1)

    // Second save with 2 messages + interactionId while first put is still in-flight
    const p2 = svc.saveConversation('1', {
      id: 'conv_207',
      type: 'app',
      interactionId: 'int_207_live',
      messages: [
        { role: 'user', text: 'Build me an order overview' },
        { role: 'assistant', text: 'Completed order overview.', interactionId: 'int_207_live' },
      ],
      updatedAt: '2026-11-13T05:00:05.000Z',
    })
    resolveFirstPut?.()
    await Promise.all([p1, p2])

    // Even if a stale 1-message save runs after the 2-message save, prev.messages (length 2) is preserved
    const afterStaleSave = await svc.saveConversation('1', {
      id: 'conv_207',
      type: 'app',
      interactionId: 'int_207_live',
      messages: [{ role: 'user', text: 'Build me an order overview' }],
      updatedAt: '2026-11-13T05:00:06.000Z',
    })
    expect(afterStaleSave[0].messages).toHaveLength(2)
    expect(afterStaleSave[0].messages?.[1]).toMatchObject({
      role: 'assistant',
      text: 'Completed order overview.',
      interactionId: 'int_207_live',
    })

    // 2. recoverInFlightInteraction polls across in_progress -> completed and extracts text, activitySteps, and bundles
    expect(
      await recoverInFlightInteraction({
        auth: { mode: 'apikey', apiKey: '', oauthToken: '', clientId: '', projectId: '' },
        interactionId: '',
      })
    ).toBeNull()

    let pollCount = 0
    const recovered = await recoverInFlightInteraction({
      extensionSDK: {
        serverProxy: async () => {
          pollCount += 1
          if (pollCount === 1) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_207_recover',
                status: 'in_progress',
                steps: [{ id: 's1', type: 'thought', thought: 'Querying Looker explore...' }],
              }),
            }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_207_recover',
              status: 'completed',
              steps: [
                { id: 's1', type: 'thought', thought: 'Querying Looker explore...' },
                {
                  id: 's2',
                  type: 'code_execution',
                  code: 'python3 /workspace/bundle_app.py',
                  stdout:
                    '<NATIVE_CONTENT_BUNDLE>{"id":"777","content_type":"dashboard","title":"Recovered Revenue Dashboard","embed_path":"/embed/dashboards/777"}</NATIVE_CONTENT_BUNDLE>',
                },
              ],
              output_text: '<USE_CASE>dashboard</USE_CASE>Recovered your dashboard after page refresh.',
            }),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'key-207', oauthToken: '', clientId: '', projectId: '' },
      interactionId: 'int_207_recover',
      maxPollAttempts: 3,
      pollIntervalMs: 1,
    })

    expect(pollCount).toBe(2)
    expect(recovered).not.toBeNull()
    expect(recovered?.text).toBe('Recovered your dashboard after page refresh.')
    expect(recovered?.interactionId).toBe('int_207_recover')
    expect(recovered?.status).toBe('completed')
    expect(recovered?.activitySteps.length).toBeGreaterThan(0)
    expect(recovered?.activitySteps.every((s) => s.status === 'done')).toBe(true)
    expect(recovered?.nativeContent).toMatchObject({
      id: '777',
      contentType: 'dashboard',
      title: 'Recovered Revenue Dashboard',
    })

    // 3. Verify studioControllerTurn.ts and studioControllerLoaders.ts wiring for in-flight persistence & recovery
    const repoRoot = path.resolve(__dirname, '../../..')
    const turnSrc = readFileSync(path.join(repoRoot, 'src/studioControllerTurn.ts'), 'utf8')
    expect(turnSrc).toContain('export { STUDIO_INFLIGHT_CONV_SESSION_KEY }')
    expect(turnSrc).toContain('saveInFlightConvId(convId)')
    expect(turnSrc).toContain('void saveUserConversation(core40SDK, userId, inFlightEntry, getArtifactNamespace(extensionSDK)).catch(() => {})')
    expect(turnSrc).toContain('void saveUserConversation(core40SDK, userId, updatedInFlightEntry, getArtifactNamespace(extensionSDK)).catch(() => {})')

    const loadersSrc = readFileSync(path.join(repoRoot, 'src/studioControllerLoaders.ts'), 'utf8')
    expect(loadersSrc).toContain('const interruptedConvId = readInFlightConvId()')
    expect(loadersSrc).toContain('const isTurnInFlightInTab =')
    expect(loadersSrc).toContain("setBusyStatus('Resuming in-flight turn...')")
    expect(loadersSrc).toContain('void recoverInFlightInteraction({')
  })
}
