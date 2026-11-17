import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { Looker40SDK } from '@looker/sdk'

import { buildWorkspaceSources, recoverInFlightInteraction, runAntigravityTurn } from '../../antigravity'
import { BUILTIN_SKILLS_FILES, resolveBuiltinWorkspaceFileContent } from '../../antigravitySteps'
import {
  clearArtifactServiceCache,
  extractResolvedUseCase,
  getArtifactService,
  LOOKER_DASHBOARD_SKILL_MD,
  matchExplicitUseCaseRule,
  STUDIO_INFLIGHT_CONV_SESSION_KEY,
} from '../../lookerApi'
import { extractSlashSkillIds, LOOKML_TURN_SKILLS } from '../../lookmlSkills'
import { SANDBOX_AGENT_SKILL_FILES } from '../../sandboxSkillsBundle'

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

  test('83. Issue #213: aliases consolidated upstream skills, validates bundled relative reference links, and wires Code-Mode review/audit/optimizer/Snowflake-to-BigQuery slash skills', async () => {
    const repoRoot = path.resolve(__dirname, '../../..')
    const agenticLookmlMd = SANDBOX_AGENT_SKILL_FILES['agentic-lookml/SKILL.md']
    const sfToBqMd = SANDBOX_AGENT_SKILL_FILES['snowflake-to-bigquery-converter/SKILL.md']
    expect(agenticLookmlMd).toContain('Greenfield projects use Medallion')
    expect(sfToBqMd).toContain('name: snowflake-to-bigquery-converter')
    expect(SANDBOX_AGENT_SKILL_FILES['looker-audit/SKILL.md']).toContain('<USE_CASE>tile</USE_CASE>')

    const wsSources = buildWorkspaceSources({ schemaMarkdown: '# Schema' })
    const aliasPairs: Array<[string, string]> = [
      ['creating-looker-dashboard', LOOKER_DASHBOARD_SKILL_MD],
      ['lookml-modeling-guidelines', agenticLookmlMd],
      ['looker-architect', agenticLookmlMd],
    ]
    for (const [id, expectedDoc] of aliasPairs) {
      for (const k of [
        id,
        `skills/${id}/SKILL.md`,
        `/workspace/skills/${id}/SKILL.md`,
        `.agents/skills/${id}/SKILL.md`,
        `/workspace/.agents/skills/${id}/SKILL.md`,
      ]) {
        expect(BUILTIN_SKILLS_FILES[k]).toBe(expectedDoc)
        expect(resolveBuiltinWorkspaceFileContent(k)).toBe(expectedDoc)
      }
      expect(wsSources.find((s) => s.target === `/workspace/skills/${id}/SKILL.md`)?.content).toBe(expectedDoc)
    }

    for (const k of [
      'snowflake-to-bigquery-converter',
      'skills/snowflake-to-bigquery-converter/SKILL.md',
      '/workspace/skills/snowflake-to-bigquery-converter/SKILL.md',
    ]) {
      expect(BUILTIN_SKILLS_FILES[k]).toBe(sfToBqMd)
      expect(resolveBuiltinWorkspaceFileContent(k)).toBe(sfToBqMd)
    }

    for (const [relPath, md] of Object.entries(SANDBOX_AGENT_SKILL_FILES)) {
      if (!relPath.endsWith('/SKILL.md')) continue
      const skillDir = path.posix.dirname(relPath)
      for (const m of md.matchAll(/\]\(((?:\.\.?\/|references\/|sub-skills\/|scripts\/)[^)#\s]+\.(?:md|py))\)/g)) {
        const resolvedRel = path.posix.normalize(path.posix.join(skillDir, m[1]))
        expect(SANDBOX_AGENT_SKILL_FILES[resolvedRel]).toBeDefined()
      }
    }

    expect(LOOKML_TURN_SKILLS.map((s) => s.id)).toEqual([
      'lookml-field-curation',
      'lookml-tests',
      'lookml-snapshot',
      'generate-view-from-table',
      'agentic-lookml-workflow',
    ])

    expect(
      extractSlashSkillIds(
        'Run /lookml-reviewer, /looker-performance-optimizer, /snowflake-to-bigquery-converter, and /looker-audit'
      )
    ).toEqual(['lookml-reviewer', 'looker-performance-optimizer', 'snowflake-to-bigquery-converter', 'looker-audit'])

    expect(matchExplicitUseCaseRule('/looker-audit check slow dashboards')).toBe('tile')
    expect(extractResolvedUseCase('Audit complete.', '/looker-audit check slow dashboards')).toBe('tile')
    for (const slash of ['/lookml-reviewer', '/looker-performance-optimizer', '/snowflake-to-bigquery-converter']) {
      expect(matchExplicitUseCaseRule(`${slash} on orders`)).toBe('lookml')
      expect(extractResolvedUseCase('Reviewed.', `${slash} on orders`)).toBe('lookml')
    }

    const postedBodies: Array<Record<string, unknown>> = []
    let seq = 0
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init?: { method?: string; body?: string }) => {
      if ((init?.method || 'GET').toUpperCase() === 'POST' && init?.body) {
        postedBodies.push(JSON.parse(init.body) as Record<string, unknown>)
      }
      seq += 1
      const payload = JSON.stringify({
        id: `int_213_${seq}`,
        environment_id: 'env_213',
        status: 'completed',
        steps: [],
        output_text: seq === 2 ? 'Built Data App.' : '<USE_CASE>tile</USE_CASE>Audit complete.',
      })
      return { ok: true, status: 200, text: async () => payload } as unknown as Response
    }) as typeof fetch
    try {
      const baseTurnOpts = {
        extensionSDK: {},
        auth: { mode: 'apikey' as const, apiKey: 'key-213', oauthToken: '', clientId: '', projectId: '' },
        selectedExplores: ['ecom::orders'],
        schemaMarkdown: '## Model: ecom',
        warmEnvironmentInBackground: false,
        pollScheduleMs: [1],
        onStatus: () => {},
      }

      const t1 = await runAntigravityTurn({
        ...baseTurnOpts,
        session: {},
        useCase: 'auto',
        mode: 'data_app',
        activatedLookmlSkills: ['looker-audit'],
        userPrompt: '/looker-audit, check slow dashboards',
      })
      expect(t1.session.toolType).toBe('tile')
      expect(t1.resolvedUseCase).toBe('tile')
      expect((postedBodies[0].tools as Array<{ type?: string }>).some((t) => t.type === 'code_execution')).toBe(false)
      expect(((postedBodies[0].input as Array<{ text: string }>)[0] || {}).text).toContain('name: looker-audit')

      const t2 = await runAntigravityTurn({
        ...baseTurnOpts,
        environmentId: 'env_213',
        session: t1.session,
        useCase: 'auto',
        mode: 'data_app',
        activatedLookmlSkills: ['looker-audit'],
        userPrompt: 'Build me an executive sales Data App',
      })
      expect(t2.session.toolType).toBe('app')
      expect((postedBodies[1].tools as Array<{ type?: string }>).some((t) => t.type === 'code_execution')).toBe(true)
      const t2Text = ((postedBodies[1].input as Array<{ text: string }>)[0] || {}).text
      expect(t2Text).toContain('You are building a Looker Data App')
      expect(t2Text).not.toContain('name: looker-audit')

      const t3 = await runAntigravityTurn({
        ...baseTurnOpts,
        environmentId: 'env_213',
        session: t2.session,
        useCase: 'auto',
        mode: 'data_app',
        existingAppCode: 'export class SalesApp {}',
        userPrompt: '/looker-audit.',
      })
      expect(t3.session.toolType).toBe('tile')
      expect((postedBodies[2].tools as Array<{ type?: string }>).some((t) => t.type === 'code_execution')).toBe(false)
      const t3Text = ((postedBodies[2].input as Array<{ text: string }>)[0] || {}).text
      expect(t3Text).toContain('name: looker-audit')
      expect(t3Text).not.toContain('[WARM SANDBOX FAST PATH:')

      const t4 = await runAntigravityTurn({
        ...baseTurnOpts,
        session: {},
        useCase: 'auto',
        allowedModes: ['app'],
        mode: 'data_app',
        userPrompt: '/looker-audit check slow dashboards',
      })
      expect(t4.session.toolType).toBe('app')
      expect(((postedBodies[3].input as Array<{ text: string }>)[0] || {}).text).not.toContain('name: looker-audit')
    } finally {
      globalThis.fetch = origFetch
    }

    const skillsLock = JSON.parse(readFileSync(path.join(repoRoot, 'skills-lock.json'), 'utf8')) as {
      skills: Record<string, unknown>
    }
    for (const excluded of [
      'creating-looker-dashboard',
      'lookml-modeling-guidelines',
      'looker-architect',
      'lookml-reviewer',
      'looker-audit',
      'looker-performance-optimizer',
      'agentic-lookml',
      'generate-view-from-table',
      'lookml',
      'lookml-view',
    ]) {
      expect(skillsLock.skills[excluded]).toBeUndefined()
    }
  })
}
