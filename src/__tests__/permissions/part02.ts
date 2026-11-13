import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  AGENTS_MD, BOOTSTRAP_LOOKML_PY, BOOTSTRAP_SANDBOX_SH, DEFAULT_ANTIGRAVITY_MODEL,
  isEnvironmentNotFoundError, LKR_DEV_CLI_SPEC, LKR_DEV_CLI_VERSION, prewarmOrWakeAntigravityEnvironment,
  runAntigravityTurn,
} from '../../antigravity'
import {
  CA_AGENT_SELECTION_REQUEST_TAG, CA_AGENT_SELECTION_RESPONSE_FORMAT, classifyStudioUseCase, createLookerCaConversation,
  fetchLookerCaAgentsCatalog, formatUserEnvArtifactKey, loadUserEnvironmentId, parseCaAgentSelectionResponse,
  saveUserConversation, saveUserEnvironmentId, selectCaAgentViaIsolatedSubagent,
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

export function registerPermissionsPart02Tests(): void {
  test('10. persists single per-user environment_id in Looker Artifacts (user_env:${me.id}), shares it across 2 concurrent conversations with isolated /workspace/apps/${conversationId}/app.js paths, and sends sources only once on creation', async () => {
    expect(formatUserEnvArtifactKey('1')).toBe('user_env:1')
    expect(formatUserEnvArtifactKey('42')).toBe('user_env:42')

    const artifactStore = new Map<string, { key: string; version: number; value: string }>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      me: async () => ({ id: '1' }),
      artifact: async ({ key }: { namespace: string; key: string }) => {
        const hit = artifactStore.get(key)
        return hit ? [hit] : []
      },
      update_artifacts: async (_ns: string, items: Array<{ key: string; value: string; version?: number }>) => {
        for (const item of items) {
          const prev = artifactStore.get(item.key)
          artifactStore.set(item.key, {
            key: item.key,
            version: (prev?.version || 0) + 1,
            value: item.value,
          })
        }
        return items
      },
    })

    expect(await loadUserEnvironmentId(mockSdk, '1')).toBeNull()

    const apiCalls: Array<{ url: string; method?: string; body?: MockInteractionPostBody }> = []
    let turnCounter = 0
    const mockExtensionSDK = {
      serverProxy: async (url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        apiCalls.push({ url, method: init?.method, body })
        turnCounter += 1
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: `int_turn_${turnCounter}`,
            environment_id: 'env_user_1_shared',
            status: 'completed',
            output_text: `Completed turn ${turnCounter}.`,
          }),
        }
      },
    }

    // Conversation A — Turn 1: no existing environmentId -> seeds environment: { type: 'remote', sources }
    const turnA1 = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      conversationId: 'conv_alpha',
      auth: { mode: 'apikey' },
      session: { toolType: 'app', conversationId: 'conv_alpha' },
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Build Alpha revenue app',
      onStatus: () => {},
    })

    expect(turnA1.session.environmentId).toBe('env_user_1_shared')
    expect(turnA1.session.lastInteractionId).toBe('int_turn_1')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_user_1_shared')
    expect(apiCalls[0].body?.environment).toEqual(
      expect.objectContaining({
        type: 'remote',
        sources: expect.arrayContaining([
          expect.objectContaining({ target: '/workspace/schema.md' }),
          expect.objectContaining({ target: '/workspace/bundle_app.py' }),
        ]),
      })
    )
    expect(apiCalls[0].body?.previous_interaction_id).toBeUndefined()
    expect(apiCalls[0].body?.input?.[0]?.text).toContain('/workspace/apps/conv_alpha/app.js')
    expect(apiCalls[0].body?.input?.[0]?.text).toContain('--app-dir /workspace/apps/conv_alpha')

    // Conversation B — Turn 1: reuses shared environment_id string WITHOUT sources and WITHOUT Conversation A's previous_interaction_id
    const sharedEnvFromLooker = (await loadUserEnvironmentId(mockSdk, '1')) || undefined
    const turnB1 = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      environmentId: sharedEnvFromLooker,
      conversationId: 'conv_beta',
      auth: { mode: 'apikey' },
      session: { toolType: 'app', environmentId: sharedEnvFromLooker, conversationId: 'conv_beta' },
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Build Beta inventory app',
      onStatus: () => {},
    })

    expect(turnB1.session.environmentId).toBe('env_user_1_shared')
    expect(turnB1.session.lastInteractionId).toBe('int_turn_2')
    expect(apiCalls[1].body?.environment).toBe('env_user_1_shared')
    expect(apiCalls[1].body?.previous_interaction_id).toBeUndefined()
    expect(apiCalls[1].body?.input?.[0]?.text).toContain('/workspace/apps/conv_beta/app.js')
    expect(apiCalls[1].body?.input?.[0]?.text).toContain('--app-dir /workspace/apps/conv_beta')
    expect(apiCalls[1].body?.input?.[0]?.text).not.toContain('conv_alpha')

    // Conversation A — Turn 2: continues Conversation A's previous_interaction_id on the shared environment
    const turnA2 = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      environmentId: sharedEnvFromLooker,
      conversationId: 'conv_alpha',
      auth: { mode: 'apikey' },
      session: turnA1.session,
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      existingAppCode: 'export class AlphaApp {}',
      userPrompt: 'Add YoY KPI to Alpha',
      onStatus: () => {},
    })

    expect(turnA2.session.lastInteractionId).toBe('int_turn_3')
    expect(apiCalls[2].body?.environment).toBe('env_user_1_shared')
    expect(apiCalls[2].body?.previous_interaction_id).toBe('int_turn_1')
    expect(apiCalls[2].body?.input?.[0]?.text).toContain('/workspace/apps/conv_alpha/app.js')

    // Conversation B — Turn 2: continues Conversation B's previous_interaction_id on the shared environment
    const turnB2 = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      environmentId: sharedEnvFromLooker,
      conversationId: 'conv_beta',
      auth: { mode: 'apikey' },
      session: turnB1.session,
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      existingAppCode: 'export class BetaApp {}',
      userPrompt: 'Add stockout chart to Beta',
      onStatus: () => {},
    })

    expect(turnB2.session.lastInteractionId).toBe('int_turn_4')
    expect(apiCalls[3].body?.environment).toBe('env_user_1_shared')
    expect(apiCalls[3].body?.previous_interaction_id).toBe('int_turn_2')
    expect(apiCalls[3].body?.input?.[0]?.text).toContain('/workspace/apps/conv_beta/app.js')
  })

  test('11. auto-recovers on 404 (Environment not found) in runAntigravityTurn and prewarmOrWakeAntigravityEnvironment by creating { type: "remote", sources } and updating user_env:${me.id}', async () => {
    expect(isEnvironmentNotFoundError(new Error("Antigravity API error (404): Environment 'env_stale' not found"))).toBe(true)
    expect(isEnvironmentNotFoundError({ status: 404, message: 'Not Found' })).toBe(true)
    expect(isEnvironmentNotFoundError(new Error('Antigravity API error (500): Internal error'))).toBe(false)

    const artifactStore = new Map<string, { key: string; version: number; value: string }>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      me: async () => ({ id: '1' }),
      artifact: async ({ key }: { namespace: string; key: string }) => {
        const hit = artifactStore.get(key)
        return hit ? [hit] : []
      },
      update_artifacts: async (_ns: string, items: Array<{ key: string; value: string; version?: number }>) => {
        for (const item of items) {
          const prev = artifactStore.get(item.key)
          artifactStore.set(item.key, {
            key: item.key,
            version: (prev?.version || 0) + 1,
            value: item.value,
          })
        }
        return items
      },
    })

    await saveUserEnvironmentId(mockSdk, '1', 'env_stale_404')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_stale_404')

    const postedPayloads: MockInteractionPostBody[] = []
    const mockExtensionSDK = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
        postedPayloads.push(body)
        if (typeof body?.environment === 'string' && body.environment.includes('stale')) {
          return {
            ok: false,
            status: 404,
            body: JSON.stringify({
              error: { message: `Environment '${body.environment}' not found` },
            }),
          }
        }
        const nextEnv =
          postedPayloads.length <= 2 ? 'env_recovered_999' : 'env_prewarm_recovered_777'
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: `int_recovered_${postedPayloads.length}`,
            environment_id: nextEnv,
            status: 'completed',
            output_text: 'Recovered on fresh environment.',
          }),
        }
      },
    }

    let callbackEnvId = ''
    const recoveredTurn = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      environmentId: 'env_stale_404',
      conversationId: 'conv_alpha',
      onEnvironmentUpdated: (id) => {
        callbackEnvId = id
      },
      auth: { mode: 'apikey' },
      session: { toolType: 'app', environmentId: 'env_stale_404', conversationId: 'conv_alpha' },
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      existingAppCode: 'export class AlphaApp {}',
      userPrompt: 'Update Alpha after 404 expiry',
      onStatus: () => {},
    })

    expect(postedPayloads).toHaveLength(2)
    expect(postedPayloads[0].environment).toBe('env_stale_404')
    expect(postedPayloads[1].environment).toEqual(
      expect.objectContaining({
        type: 'remote',
        sources: expect.arrayContaining([
          expect.objectContaining({
            target: '/workspace/apps/conv_alpha/app.js',
            content: 'export class AlphaApp {}',
          }),
        ]),
      })
    )
    expect(recoveredTurn.session.environmentId).toBe('env_recovered_999')
    expect(callbackEnvId).toBe('env_recovered_999')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_recovered_999')

    const prewarmRecovered = await prewarmOrWakeAntigravityEnvironment({
      sdk: mockSdk,
      userId: '1',
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey' },
      toolType: 'lookml',
      environmentId: 'env_stale_prewarm_404',
      existingSession: { toolType: 'lookml', environmentId: 'env_stale_prewarm_404' },
      schemaMarkdown: '# Schema',
    })

    expect(prewarmRecovered.status).toBe('prelaunched')
    expect(prewarmRecovered.session.environmentId).toBe('env_prewarm_recovered_777')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_prewarm_recovered_777')
  })

  test('12. routes Conversational Analytics via stateless isolated sub-agent (no previous_interaction_id, tools=[]), creates Looker CA conversation, and persists to user_conversations:${me.id}', async () => {
    expect(
      classifyStudioUseCase('Why did gross margin drop in Q3 compared to Q2?', 'auto', [
        'app',
        'dashboard',
        'lookml',
        'health-check',
        'tile',
        'conversational-analytics',
      ])
    ).toBe('conversational-analytics')
    expect(
      classifyStudioUseCase('Build an Executive Revenue Data App on order_items', 'auto', [
        'app',
        'dashboard',
        'lookml',
        'health-check',
        'tile',
        'conversational-analytics',
      ])
    ).toBe('app')

    const artifactStore = new Map<string, { key: string; version: number; value: string }>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      me: async () => ({ id: '1' }),
      search_agents: async () => [
        {
          id: 'ca_agent_ecommerce',
          name: 'eCommerce Analytics Agent',
          description: 'Answers order revenue, gross margin, and retention questions.',
          explores: ['thelook::order_items', 'thelook::users'],
        },
        {
          id: 'ca_agent_bq_ops',
          name: 'BigQuery Cost & Jobs Agent',
          description: 'Answers BigQuery slot usage, bytes billed, and streaming buffer questions.',
          explores: ['bigquery_information_schema::jobs_timeline'],
        },
      ],
      create_conversation: async (body: { agent_id?: string; title?: string }) => ({
        id: 'ca_conv_9001',
        agent_id: body.agent_id,
        title: body.title,
      }),
      conversational_analytics_chat: async () => ({
        reply:
          'Streaming buffer usage peaked on looker-private-demo.thelook.events at 507.5 MB across 2.89M rows.',
      }),
      artifact: async ({ key }: { namespace: string; key: string }) => {
        const hit = artifactStore.get(key)
        return hit ? [hit] : []
      },
      update_artifacts: async (_ns: string, items: Array<{ key: string; value: string; version?: number }>) => {
        for (const item of items) {
          const prev = artifactStore.get(item.key)
          artifactStore.set(item.key, {
            key: item.key,
            version: (prev?.version || 0) + 1,
            value: item.value,
          })
        }
        return items
      },
    })

    const catalog = await fetchLookerCaAgentsCatalog(mockSdk, [])
    expect(catalog).toHaveLength(2)
    expect(catalog[0].id).toBe('ca_agent_ecommerce')
    expect(catalog[1].id).toBe('ca_agent_bq_ops')

    const capturedPayloads: MockInteractionPostBody[] = []
    const mockExtensionSDK = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
        capturedPayloads.push(body)
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_subagent_ca_1',
            status: 'completed',
            output_text:
              '<CA_AGENT_SELECTION>{"agent_id":"ca_agent_bq_ops","agent_name":"BigQuery Cost & Jobs Agent","rationale":"Question asks about BigQuery streaming buffer usage on jobs_timeline/streaming_timeline.","initial_question":"Which BigQuery tables have the highest streaming buffer usage?"}</CA_AGENT_SELECTION>',
          }),
        }
      },
    }

    const selection = await selectCaAgentViaIsolatedSubagent({
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey' },
      environmentId: 'env_shared_1',
      userPrompt: 'Which BigQuery tables have the highest streaming buffer usage?',
      agents: catalog,
      selectedExplores: [],
    })

    // Stateless isolated sub-agent call must use direct model inference (store: false, background: false, tools: [], response_format)
    expect(capturedPayloads).toHaveLength(1)
    expect(capturedPayloads[0].model).toBe(DEFAULT_ANTIGRAVITY_MODEL)
    expect(capturedPayloads[0].store).toBe(false)
    expect(capturedPayloads[0].background).toBe(false)
    expect(capturedPayloads[0].previous_interaction_id).toBeUndefined()
    expect(capturedPayloads[0].tools).toEqual([])
    expect(capturedPayloads[0].environment).toBeUndefined()
    expect(capturedPayloads[0].agent_config).toBeUndefined()
    expect(capturedPayloads[0].system_instruction).toContain('Select the single best Looker CA agent_id')
    expect(capturedPayloads[0].generation_config).toEqual({ thinking_level: 'low', max_output_tokens: 1024 })
    expect(capturedPayloads[0].response_format).toEqual(CA_AGENT_SELECTION_RESPONSE_FORMAT)
    expect(capturedPayloads[0].input?.[0]?.text).toContain(CA_AGENT_SELECTION_REQUEST_TAG)

    expect(selection.agentId).toBe('ca_agent_bq_ops')
    expect(selection.agentName).toBe('BigQuery Cost & Jobs Agent')
    expect(selection.rationale).toContain('BigQuery streaming buffer usage')

    const parsedFallback = parseCaAgentSelectionResponse(
      'Unstructured output mentioning ca_agent_ecommerce',
      catalog,
      'What was Q4 revenue?'
    )
    expect(parsedFallback.agentId).toBe('ca_agent_ecommerce')

    const created = await createLookerCaConversation({
      sdk: mockSdk,
      agent: catalog[1],
      selection,
      userPrompt: 'Which BigQuery tables have the highest streaming buffer usage?',
    })
    expect(created.caConversationId).toBe('ca_conv_9001')
    expect(created.embedPath).toContain('/embed/conversations/ca_conv_9001')
    expect(created.assistantReply).toContain('507.5 MB')

    const savedList = await saveUserConversation(mockSdk, '1', {
      id: created.caConversationId,
      type: 'conversational-analytics',
      environmentId: 'env_shared_1',
      label: created.title,
      explores: catalog[1].explores,
      content: {
        caConversationId: created.caConversationId,
        agentId: catalog[1].id,
        agentName: catalog[1].name,
        embedPath: created.embedPath,
        selectionRationale: selection.rationale,
      },
    })
    expect(savedList).toHaveLength(1)
    expect(savedList[0].type).toBe('conversational-analytics')
    expect(savedList[0].content?.caConversationId).toBe('ca_conv_9001')
    expect(savedList[0].content?.agentId).toBe('ca_agent_bq_ops')
  })

  test('13. pins LKR_DEV_CLI_VERSION=0.0.69, bootstraps uv via pip --break-system-packages + uv tool install in new environments, and configures Monday/Thursday PyPI auto-PR workflow', async () => {
    const repoRoot = path.resolve(__dirname, '../../..')
    const versionTxt = readFileSync(path.join(repoRoot, 'lkr-dev-cli-version.txt'), 'utf8').trim()
    expect(LKR_DEV_CLI_VERSION).toBe('0.0.69')
    expect(versionTxt).toBe(LKR_DEV_CLI_VERSION)
    expect(LKR_DEV_CLI_SPEC).toBe('lkr-dev-cli[tools,code-mode,parse]==0.0.69')

    expect(BOOTSTRAP_SANDBOX_SH).toContain('pip install --break-system-packages --quiet uv')
    expect(BOOTSTRAP_SANDBOX_SH).toContain(
      'UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.69"'
    )
    expect(BOOTSTRAP_LOOKML_PY).toContain('"install", "--break-system-packages", "--quiet", "uv"')
    expect(BOOTSTRAP_LOOKML_PY).toContain('"UV_TOOL_BIN_DIR": "/usr/local/bin"')
    expect(BOOTSTRAP_LOOKML_PY).toContain('["uv", "tool", "install", "--force", "--quiet", pkg_spec]')
    expect(AGENTS_MD).toContain('pip install --break-system-packages --quiet uv')
    expect(AGENTS_MD).toContain(
      'UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.69"'
    )

    const workflowYml = readFileSync(
      path.join(repoRoot, '.github/workflows/update-skills.yml'),
      'utf8'
    )
    expect(workflowYml).toContain('cron: "0 9 * * 1,4"')
    expect(workflowYml).toContain('https://pypi.org/pypi/lkr-dev-cli/json')
    expect(workflowYml).toContain('lkr-dev-cli-version.txt')
    expect(workflowYml).toContain('src/lookmlTool.tsx')
    expect(workflowYml).toContain('chore/update-skills')

    const postedBodies: MockInteractionPostBody[] = []
    const mockExtensionSDK = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
        postedBodies.push(body)
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_prewarm_bootstrap_1',
            environment_id: 'env_fresh_bootstrap_1',
            status: 'completed',
            output_text: 'READY',
          }),
        }
      },
    }

    const res = await prewarmOrWakeAntigravityEnvironment({
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey' },
      toolType: 'app',
      schemaMarkdown: '# Schema',
    })
    expect(res.status).toBe('prelaunched')
    expect(res.session.environmentId).toBe('env_fresh_bootstrap_1')
    expect(postedBodies).toHaveLength(1)
    expect(postedBodies[0].input?.[0]?.text).toContain('python3 /workspace/bootstrap_lookml.py cli')
    expect(postedBodies[0].input?.[0]?.text).toContain('pip install --break-system-packages --quiet uv')
    expect(postedBodies[0].input?.[0]?.text).toContain(
      'UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.69"'
    )
    expect(
      typeof postedBodies[0].environment === 'object' ? postedBodies[0].environment.sources : []
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: '/workspace/bootstrap_lookml.py',
          content: BOOTSTRAP_LOOKML_PY,
        }),
      ])
    )
  })

}
