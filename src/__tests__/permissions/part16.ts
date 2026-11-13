import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  AntigravityInteractionPayload, BOOTSTRAP_LOOKML_PY, buildLookmlSystemGuide, BUNDLE_APP_PY,
  cleanLookmlProjectId, collectInteractionTextCandidates, computeLkrExtensionCacheKey, DEFAULT_MAX_TOOL_ROUNDS,
  extractBundleFromInteraction, extractNativeContentFromInteraction, hydrateInteractionActivitySteps, isNewProjectOnboardingIntakePrompt,
  LkrCodeMode, LOOKER_PROJECT_ONBOARDING_SKILL_MD, normalizeMaxToolRounds, parseTaggedJsonObjects,
  runAntigravityTurn, STUDIO_MAX_TOOL_ROUNDS_OPTIONS, wrapDashboardCodeMode,
} from '../../antigravity'
import { deriveConversationOverviewData } from '../../components/StudioWorkspace'
import {
  DEFAULT_MAX_TOOL_ROUNDS as LOOKER_API_DEFAULT_MAX_TOOL_ROUNDS, getConvTargetId, hydrateConversationContentItems, matchExplicitUseCaseRule,
  normalizeMaxToolRounds as lookerApiNormalizeMaxToolRounds, normalizeStudioContentItem, resolveConversationRelatedContent, STUDIO_MAX_TOOL_ROUNDS_OPTIONS as LOOKER_API_MAX_TOOL_ROUNDS_OPTIONS,
} from '../../lookerApi'
import { extractLookmlBundleFromInteraction, extractLookmlDashboardsFromBundle, resolveLookmlCanonicalProjectId } from '../../lookmlTool'

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

export function registerPermissionsPart16Tests(): void {
  test('75. Issue #186: rejects view_file/inspection false-positive bundles, suppresses & heals lookml:default / /projects/default, runs >8 tool rounds under default 50, and wraps up gracefully with tools: [] when maxToolRounds is reached', async () => {
    // 1. Constants, Looker API re-export parity & normalizeMaxToolRounds edge-case matrix
    expect(DEFAULT_MAX_TOOL_ROUNDS).toBe(50)
    expect(LOOKER_API_DEFAULT_MAX_TOOL_ROUNDS).toBe(50)
    expect(LOOKER_API_MAX_TOOL_ROUNDS_OPTIONS).toEqual(STUDIO_MAX_TOOL_ROUNDS_OPTIONS)
    expect(STUDIO_MAX_TOOL_ROUNDS_OPTIONS).toEqual([
      { value: 15, label: '15 rounds' },
      { value: 25, label: '25 rounds' },
      { value: 50, label: '50 rounds (Default — High)' },
      { value: 100, label: '100 rounds (Max)' },
    ])
    expect(lookerApiNormalizeMaxToolRounds).toBe(normalizeMaxToolRounds)
    expect([
      normalizeMaxToolRounds(undefined),
      normalizeMaxToolRounds(null),
      normalizeMaxToolRounds(true),
      normalizeMaxToolRounds(false),
      normalizeMaxToolRounds(''),
      normalizeMaxToolRounds('   '),
      normalizeMaxToolRounds(0),
      normalizeMaxToolRounds(-10),
      normalizeMaxToolRounds(Number.NaN),
      normalizeMaxToolRounds('25'),
      normalizeMaxToolRounds(1),
      normalizeMaxToolRounds(15.9),
      normalizeMaxToolRounds(150),
    ]).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 50, 25, 1, 15, 100])

    // 2. view_file / read_file / skill_lookup / code_execution inputs / nameless call_id results returning bootstrap_lookml.py & bundle_app.py return null
    const falsePositiveInteraction: AntigravityInteractionPayload = {
      id: 'int_186_fp',
      status: 'completed',
      outputs: [{ type: 'thought', text: '<LOOKML_BUNDLE>{"project_id":"thought_leak","files":[{"path":"a.view.lkml"}]}</LOOKML_BUNDLE>' }],
      steps: [
        { type: 'view_file', id: 'vf_1', path: '/workspace/bootstrap_lookml.py', content: BOOTSTRAP_LOOKML_PY },
        { type: 'read_file_result', call_id: 'rf_1', output: BUNDLE_APP_PY },
        { type: 'function_call', id: 'fc_vf', name: 'view_file', arguments: { path: '/workspace/bootstrap_lookml.py' } },
        { type: 'function_result', call_id: 'fc_vf', result: { content: BOOTSTRAP_LOOKML_PY } },
        { type: 'function_call', id: 'fc_grep', name: 'grep_search', arguments: { query: 'LOOKML_BUNDLE' } },
        { type: 'function_result', call_id: 'fc_grep', result: { output: '<LOOKML_BUNDLE>{"project_id":"grep_leak","files":[{"path":"x.lkml"}]}</LOOKML_BUNDLE>' } },
        { type: 'function_result', call_id: 'fc_unpaired_prev_hop', result: { output: '<LOOKML_BUNDLE>{"project_id":"unpaired_leak","files":[{"path":"y.lkml"}]}</LOOKML_BUNDLE>' } },
        { type: 'skill_lookup', content: '<DATA_APP_BUNDLE>{"raw_code":"leak","prod_code":"leak"}</DATA_APP_BUNDLE>' },
        {
          type: 'code_execution',
          code: 'python3 -c \'print("<LOOKML_BUNDLE>{\\"project_id\\":\\"input_leak\\",\\"files\\":[{\\"path\\":\\"x.lkml\\"}]}</LOOKML_BUNDLE>")\'',
          stdout: 'print("<LOOKML_BUNDLE>" + json.dumps(bundle) + "</LOOKML_BUNDLE>")\nprint("<NATIVE_CONTENT_BUNDLE>" + json.dumps(b) + "</NATIVE_CONTENT_BUNDLE>")',
        },
        { type: 'code_execution', stdout: '<LOOKML_BUNDLE>{"id":"default","project_id":"default"}</LOOKML_BUNDLE>' },
        { type: 'code_execution', stdout: '<DATA_APP_BUNDLE>{"title":"Missing Code"}</DATA_APP_BUNDLE>' },
      ],
      output_text: 'Inspected workspace helpers.',
    }
    expect(extractLookmlBundleFromInteraction(falsePositiveInteraction)).toBeNull()
    expect(extractBundleFromInteraction(falsePositiveInteraction)).toBeNull()
    expect(extractNativeContentFromInteraction(falsePositiveInteraction)).toBeNull()

    // Valid bundle in code_execution (with attached thought metadata / code_execution_result.stdout) still extracts cleanly even when followed by prose placeholder
    const mixedValidInteraction: AntigravityInteractionPayload = {
      id: 'int_186_mixed',
      status: 'completed',
      steps: [
        {
          type: 'code_execution',
          thought: {},
          code_execution_result: {
            stdout:
              '<LOOKML_BUNDLE>{"id":"ecom_1","title":"LookML: ecom","project_id":"ecom","model_name":"ecom","files":[{"path":"views/orders.view.lkml","action":"created","content":"view: orders {}"}]}</LOOKML_BUNDLE>\n' +
              '<DATA_APP_BUNDLE>{"title":"Sales App","raw_code":"export default class {}","prod_code":"export default class {}","widgets":[]}</DATA_APP_BUNDLE>\n' +
              '<NATIVE_CONTENT_BUNDLE>{"id":"77","content_type":"dashboard","title":"Sales UDD"}</NATIVE_CONTENT_BUNDLE>',
          },
        },
      ],
      output_text: 'Emitted <LOOKML_BUNDLE>{...}</LOOKML_BUNDLE>, <DATA_APP_BUNDLE>{...}</DATA_APP_BUNDLE>, and <NATIVE_CONTENT_BUNDLE>{...}</NATIVE_CONTENT_BUNDLE>.',
    }
    expect(extractLookmlBundleFromInteraction(mixedValidInteraction)?.project_id).toBe('ecom')
    expect(extractLookmlBundleFromInteraction(mixedValidInteraction)?.files[0]?.diff).toContain('+view: orders {}')
    expect(extractBundleFromInteraction(mixedValidInteraction)?.title).toBe('Sales App')
    expect(extractNativeContentFromInteraction(mixedValidInteraction)?.id).toBe('77')
    expect(
      extractNativeContentFromInteraction({
        id: 'int_186_struct_native',
        status: 'completed',
        steps: [
          {
            type: 'function_result',
            name: 'run_looker_codemode',
            result: { result: 'Done\n<NATIVE_CONTENT_BUNDLE>{"id":"88","content_type":"dashboard","title":"Struct Wrapped UDD"}</NATIVE_CONTENT_BUNDLE>\n<NATIVE_CONTENT_BUNDLE>{...}</NATIVE_CONTENT_BUNDLE>' },
          },
        ],
      })?.id
    ).toBe('88')
    expect(parseTaggedJsonObjects(collectInteractionTextCandidates(mixedValidInteraction), /<LOOKML_BUNDLE>([\s\S]*?)<\/LOOKML_BUNDLE>/g)).toHaveLength(1)

    // 3. Suppress lookml:default & /projects/default and heal poisoned saved conversations on load
    expect(cleanLookmlProjectId('default')).toBe('')
    expect(cleanLookmlProjectId('  sales_core  ')).toBe('sales_core')
    expect(resolveLookmlCanonicalProjectId({ id: 'default', project_id: 'default' })).toBe('')
    expect(resolveLookmlCanonicalProjectId({ id: 'default', project_id: 'default', model_name: 'ecom' })).toBe('ecom')
    expect(extractLookmlDashboardsFromBundle({ id: 'default', title: 't', project_id: 'default', files: [{ path: 'dash.dashboard.lookml', content: '- dashboard: pulse\n  title: Pulse\n' }] })).toEqual([])
    expect(getConvTargetId({ projectId: 'default', sessionId: 'default', id: 'default' }, 'lookml')).toBe('')
    expect(getConvTargetId({ projectId: 'default', sessionId: 'default', id: 'default' }, 'auto')).toBe('')
    expect(getConvTargetId({ id: 'default' }, 'auto')).toBe('default')
    const relatedPoisoned = resolveConversationRelatedContent(
      {
        id: 'default',
        type: 'lookml',
        objectId: 'default',
        content: { projectId: 'default', sessionId: 'default', id: 'default' },
        contentItems: [{ key: 'lookml:default', id: 'default', projectId: 'default', contentType: 'lookml', title: 'LookML: default', createdInConversation: true }],
      },
      '1'
    )
    expect(relatedPoisoned.sharedObjectKeys).toEqual([])
    expect(relatedPoisoned.userIndexKeys).toEqual([])
    const healedLookmlItem = normalizeStudioContentItem({ id: 'real_proj', projectId: 'default', contentType: 'lookml' })
    expect(healedLookmlItem.key).toBe('lookml:real_proj')
    expect(healedLookmlItem.projectId).toBeUndefined()
    expect(
      hydrateConversationContentItems({
        id: 'conv_poisoned_only',
        type: 'lookml',
        content: { projectId: 'default', sessionId: 'default' },
        contentItems: [{ key: 'lookml:default', id: 'default', projectId: 'default', contentType: 'lookml', title: 'LookML: default' }],
      })
    ).toEqual([])
    expect(
      hydrateConversationContentItems({
        id: 'conv_poisoned_legacy',
        type: 'lookml',
        content: { projectId: 'default', sessionId: 'default' },
      })
    ).toEqual([])
    const overviewHealed = deriveConversationOverviewData({
      messages: [{ role: 'assistant', text: 'Ignore [Bad](/projects/default) and keep [Good](/projects/ecom).' }],
      contentItems: [
        { key: 'lookml:default', id: 'default', projectId: 'default', contentType: 'lookml', title: 'LookML: default' },
        { key: 'lookml:ecom', id: 'ecom', projectId: 'ecom', contentType: 'lookml', title: 'LookML: ecom' },
      ],
      lookmlBundle: { id: 'default', title: 'Orders Model', project_id: 'default', files: [{ path: 'orders.view.lkml', content: 'view: orders {}' }] },
    })
    expect(overviewHealed.contentRows.map((r) => r.key)).toEqual(['lookml:ecom'])
    expect(overviewHealed.contentRows[0]?.openInLookerPath).toBe('/projects/ecom')
    expect(overviewHealed.reviewItems[0]?.title).toBe('LookML: Orders Model')
    expect(overviewHealed.links.map((l) => l.href)).toEqual(['/projects/ecom'])

    // 4. buildLookmlSystemGuide includes the 2 Issue #186 rules
    const lookmlGuide186 = buildLookmlSystemGuide({ selectedExplores: ['thelook::order_items'], primaryModel: 'thelook', primaryExplore: 'order_items', projectId: 'thelook' })
    expect(lookmlGuide186).toContain('/workspace/bootstrap_lookml.py')
    expect(lookmlGuide186).toContain('/workspace/sitecustomize.py')
    expect(lookmlGuide186).toContain('INFORMATION_SCHEMA.COLUMNS')
    expect(lookmlGuide186).toContain('create_github_pr.sh')

    // 5. >8 (10) run_looker_codemode rounds succeed under DEFAULT_MAX_TOOL_ROUNDS = 50
    const mockTransportSdk = {
      ok: async <T>(p: T) => p,
      authSession: { transport: { rawRequest: async () => ({ ok: true, statusCode: 200, body: '{}' }) } },
    } as unknown as Parameters<typeof runAntigravityTurn>[0]['sdk']
    const spyCodeMode = jest.spyOn(LkrCodeMode, 'runPythonCode').mockImplementation(async (opts) => JSON.stringify({ step_code: opts.code }))
    let tenRoundCalls = 0
    const tenRoundTurn = await runAntigravityTurn({
      sdk: mockTransportSdk,
      extensionSDK: {
        serverProxy: async (_url: string, init?: { method?: string }) => {
          if (init?.method !== 'POST') return { ok: true, status: 200, body: '{}' }
          tenRoundCalls += 1
          if (tenRoundCalls <= 10) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: `int_10r_${tenRoundCalls}`,
                environment_id: 'env_186',
                status: 'requires_action',
                steps: [{ type: 'function_call', id: `fc_10r_${tenRoundCalls}`, name: 'run_looker_codemode', arguments: { code: `return ${tenRoundCalls}`, thought: `Step ${tenRoundCalls}` } }],
              }),
            }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_10r_done',
              environment_id: 'env_186',
              status: 'completed',
              output_text: 'Completed all 10 Looker CodeMode rounds.',
            }),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key' },
      session: { environmentId: 'env_186', lastInteractionId: 'int_prev_186' },
      mode: 'dashboard',
      useCase: 'dashboard',
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Build 10-step executive dashboard',
      onStatus: () => {},
    })
    expect(tenRoundCalls).toBe(11)
    expect(tenRoundTurn.telemetry.tool_calls.codemode).toBe(10)
    expect(tenRoundTurn.assistantText).toBe('Completed all 10 Looker CodeMode rounds.')
    expect(tenRoundTurn.session.lastInteractionId).toBe('int_10r_done')

    // 6. Hitting maxToolRounds: 2 on pendingLookerCalls sends tools: [] wrap-up continuation and returns Markdown summary
    spyCodeMode.mockClear()
    const wrapPostBodies: MockInteractionPostBody[] = []
    const wrapTurn = await runAntigravityTurn({
      sdk: mockTransportSdk,
      extensionSDK: {
        serverProxy: async (_url: string, init?: { method?: string; body?: string }) => {
          if (init?.method !== 'POST') return { ok: true, status: 200, body: '{}' }
          const parsedBody = JSON.parse(String(init.body || '{}')) as MockInteractionPostBody
          wrapPostBodies.push(parsedBody)
          const hop = wrapPostBodies.length
          if (hop <= 3) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: `int_wrap_${hop}`,
                environment_id: 'env_186',
                status: 'requires_action',
                steps: [{ type: 'function_call', id: `fc_wrap_${hop}`, name: 'run_looker_codemode', arguments: { code: `return ${hop}`, thought: `Round ${hop}` } }],
              }),
            }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_wrap_summary',
              environment_id: 'env_186',
              status: 'completed',
              output_text: "## Progress Completed\n- Created Bronze views\n\nReply `continue` to finish Silver explores.",
            }),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key' },
      session: { environmentId: 'env_186', lastInteractionId: 'int_prev_wrap' },
      maxToolRounds: 2,
      toolMode: 'lookml',
      useCase: 'lookml',
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Refactor 5 SQL queries into LookML',
      onStatus: () => {},
    })
    expect(spyCodeMode).toHaveBeenCalledTimes(2)
    expect(wrapPostBodies).toHaveLength(4)
    expect(wrapPostBodies[3].tools).toEqual([])
    expect(wrapPostBodies[3].input).toEqual([
      {
        type: 'function_result',
        name: 'run_looker_codemode',
        call_id: 'fc_wrap_3',
        result: {
          ok: false,
          error: "Max Tool Rounds (2) reached for this turn — summarize all progress completed so far and ask the user to reply 'continue' for remaining steps.",
        },
      },
    ])
    expect(wrapTurn.session.lastInteractionId).toBe('int_wrap_summary')
    expect(wrapTurn.assistantText).toContain("Reply `continue` to finish Silver explores.")

    // 7. Unified actionRound + bridgeRound cap (1 codemode + 1 bridge = 2) wraps up pendingBridgeReqs with tools: [] and hydrates full chain
    const bridgeWrapBodies: MockInteractionPostBody[] = []
    const bridgeInteractionsById: Record<string, Record<string, unknown>> = {}
    const bridgeWrapTurn = await runAntigravityTurn({
      sdk: mockTransportSdk,
      extensionSDK: {
        serverProxy: async (url: string, init?: { method?: string; body?: string }) => {
          if (init?.method !== 'POST') {
            const getId = decodeURIComponent(url.split('/interactions/')[1]?.split('?')[0] || '')
            return { ok: true, status: 200, body: JSON.stringify(bridgeInteractionsById[getId] || {}) }
          }
          const parsedBody = JSON.parse(String(init.body || '{}')) as MockInteractionPostBody
          bridgeWrapBodies.push(parsedBody)
          const hop = bridgeWrapBodies.length
          const resp =
            hop === 1
              ? {
                  id: 'int_bw_1',
                  environment_id: 'env_186',
                  status: 'requires_action',
                  input: parsedBody.input,
                  steps: [{ type: 'function_call', id: 'fc_bw_1', name: 'run_looker_codemode', arguments: { code: 'return 1', thought: 'Inspect connection' } }],
                }
              : hop === 2
              ? {
                  id: 'int_bw_2',
                  previous_interaction_id: 'int_bw_1',
                  environment_id: 'env_186',
                  status: 'completed',
                  input: parsedBody.input,
                  steps: [{ type: 'code_execution', code: 'lkr --dev tools lookml push', stdout: `<LKR_EXTENSION_TOOL_REQUEST>${JSON.stringify({ kind: 'sdk_request', method: 'GET', path: '/api/4.0/projects', thought: 'List projects' })}</LKR_EXTENSION_TOOL_REQUEST>` }],
                }
              : hop === 3
              ? {
                  id: 'int_bw_3',
                  previous_interaction_id: 'int_bw_2',
                  environment_id: 'env_186',
                  status: 'completed',
                  input: parsedBody.input,
                  steps: [{ type: 'code_execution', code: 'lkr --dev tools lookml validate', stdout: `<LKR_EXTENSION_TOOL_REQUEST>${JSON.stringify({ kind: 'sdk_request', method: 'POST', path: '/api/4.0/projects/ecom/validate', thought: 'Validate project' })}</LKR_EXTENSION_TOOL_REQUEST>` }],
                }
              : {
                  id: 'int_bw_4',
                  previous_interaction_id: 'int_bw_3',
                  environment_id: 'env_186',
                  status: 'completed',
                  input: parsedBody.input,
                  output_text: "Summarized 2 rounds of progress; reply 'continue' to validate.",
                }
          bridgeInteractionsById[String(resp.id)] = resp
          return { ok: true, status: 200, body: JSON.stringify(resp) }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key' },
      session: { environmentId: 'env_186' },
      maxToolRounds: 2,
      toolMode: 'lookml',
      useCase: 'lookml',
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Push and validate LookML',
      onStatus: () => {},
    })
    expect(bridgeWrapBodies).toHaveLength(4)
    expect(bridgeWrapBodies[3].tools).toEqual([])
    expect(String((bridgeWrapBodies[3].input as Array<{ text?: string }>)?.[0]?.text || '')).toContain('Max Tool Rounds (2) reached')
    expect(bridgeWrapTurn.assistantText).toBe("Summarized 2 rounds of progress; reply 'continue' to validate.")

    const hydratedChain = await hydrateInteractionActivitySteps({
      extensionSDK: {
        serverProxy: async (url: string) => {
          const getId = decodeURIComponent(url.split('/interactions/')[1]?.split('?')[0] || '')
          return { ok: true, status: 200, body: JSON.stringify(bridgeInteractionsById[getId] || {}) }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key' },
      interactionId: 'int_bw_4',
    })
    expect(hydratedChain.some((s) => s.kind === 'codemode')).toBe(true)

    // Verify default maxHops (>= 105) hydrates 15+ chained tool-round hops back to root without truncating at 12
    const deepChainById: Record<string, Record<string, unknown>> = {
      int_deep_0: {
        id: 'int_deep_0',
        input: [{ type: 'text', text: 'Run 15-step workflow' }],
        steps: [{ type: 'function_call', id: 'fc_deep_0', name: 'run_looker_codemode', arguments: { code: 'all_projects()', thought: 'Root step 0' } }],
      },
    }
    for (let h = 1; h <= 15; h += 1) {
      deepChainById[`int_deep_${h}`] = {
        id: `int_deep_${h}`,
        previous_interaction_id: `int_deep_${h - 1}`,
        input: [{ type: 'function_result', call_id: `fc_deep_${h - 1}`, result: { ok: true } }],
        steps: h < 15 ? [{ type: 'function_call', id: `fc_deep_${h}`, name: 'run_looker_codemode', arguments: { code: `return ${h}`, thought: `Hop ${h}` } }] : [],
      }
    }
    const deepHydrated = await hydrateInteractionActivitySteps({
      extensionSDK: {
        serverProxy: async (url: string) => {
          const getId = decodeURIComponent(url.split('/interactions/')[1]?.split('?')[0] || '')
          return { ok: true, status: 200, body: JSON.stringify(deepChainById[getId] || {}) }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key' },
      interactionId: 'int_deep_15',
    })
    expect(deepHydrated.some((s) => s.title === 'Root step 0')).toBe(true)

    spyCodeMode.mockRestore()
  })

  test('76. routes /agentic-lookml-workflow slash skill, omits onboarding guide when explicit skill is active, and hydrates file_ref bridge requests + __bundle_ref__ LookML bundles via fetchEnvironmentFile', async () => {
    expect(
      matchExplicitUseCaseRule(
        '/agentic-lookml-workflow Here are SQL queries: -- how many questions sit unanswered?\nSELECT COUNT(*) FROM posts_questions;'
      )
    ).toBe('lookml')
    expect(
      isNewProjectOnboardingIntakePrompt(
        '/agentic-lookml-workflow get to work on a new project called stackoverflow and use bigquery default connection'
      )
    ).toBe(false)

    const workflowGuide = buildLookmlSystemGuide({
      selectedExplores: [],
      userPrompt: '/agentic-lookml-workflow build stackoverflow',
    })
    expect(workflowGuide).toContain('Activated Turn Skills: `agentic-lookml-workflow`.')
    expect(workflowGuide).not.toContain(LOOKER_PROJECT_ONBOARDING_SKILL_MD)

    const envId = 'env_fileref_65'
    const innerReq = {
      kind: 'sdk_request' as const,
      method: 'GET',
      path: '/projects/so_65',
      dev_mode: true,
    }
    const cacheKey = computeLkrExtensionCacheKey(innerReq)
    const reqPath = `/workspace/.lkr_extension_cache/_req_${cacheKey}.json`
    const fullBundle = {
      id: 'run_65',
      title: 'LookML: stackoverflow',
      project_id: 'stackoverflow',
      model_name: 'stackoverflow',
      branch_name: 'main',
      files: [{ path: 'stackoverflow.model.lkml', action: 'created', content: 'connection: "default"\n' }],
      validation: { passed: true, error_count: 0, errors: [] },
      tests: [],
      queries: [],
      summary_markdown: '# Summary',
    }

    let postCount = 0
    const fetchedUrls: string[] = []
    const mockSdk = {
      ok: async <T>(p: Promise<T>) => p,
      authSession: {
        transport: {
          rawRequest: async () => ({
            ok: true,
            statusCode: 200,
            body: JSON.stringify({
              passed: true,
              queries: [{ query_index: 0, parity_status: 'matched', sql: 'S'.repeat(7000), inline_query: { fields: ['a.b'] } }],
            }),
          }),
        },
      },
      search_artifacts: async () => [],
      update_artifacts: async () => [],
    } as unknown as Looker40SDK

    const mockExtSDK = {
      serverProxy: async (url: string, init?: FetchCustomParameters) => {
        if (init?.method === 'GET' && url.includes('/files/')) {
          fetchedUrls.push(url)
          if (url.includes('_req_')) {
            return { ok: true, status: 200, headers: {}, body: JSON.stringify({ ...innerReq, cache_key: cacheKey }) }
          }
          if (url.includes('lookml_bundle_run_65.json')) {
            return { ok: true, status: 200, headers: {}, body: JSON.stringify(fullBundle) }
          }
        }
        if (init?.method === 'POST') {
          postCount += 1
          if (postCount === 1) {
            const firstPost = JSON.parse(String(init?.body || '{}')) as { tools?: Array<{ name?: string }> }
            expect((firstPost.tools || []).some((t) => t.name === 'lkr_cli_extension_bridge')).toBe(true)
            return {
              ok: true,
              status: 200,
              headers: {},
              body: JSON.stringify({
                id: 'int_ref_1',
                environment_id: envId,
                status: 'requires_action',
                steps: [
                  {
                    type: 'function_call',
                    id: 'call_bridge_65',
                    name: 'lkr_cli_extension_bridge',
                    arguments: JSON.stringify({
                      kind: 'file_ref',
                      cache_key: cacheKey,
                      req_path: reqPath,
                      dev_mode: true,
                    }),
                  },
                ],
              }),
            }
          }
          const contBody = JSON.parse(String(init?.body || '{}')) as {
            input?: Array<{ type?: string; result?: { replay_needed?: boolean; result?: unknown } }>
          }
          expect(contBody.input?.[0]?.type).toBe('function_result')
          expect(contBody.input?.[0]?.result?.replay_needed).toBe(false)
          const resStr = JSON.stringify(contBody.input?.[0]?.result?.result || {})
          expect(resStr).toContain('"parity_status":"matched"')
          expect(resStr).not.toContain('SSSSSS')
          return {
            ok: true,
            status: 200,
            headers: {},
            body: JSON.stringify({
              id: 'int_ref_2',
              environment_id: envId,
              status: 'completed',
              steps: [
                {
                  type: 'code_execution',
                  output: `<LOOKML_BUNDLE>${JSON.stringify({
                    id: 'old_run',
                    title: 'Old',
                    project_id: 'old_proj',
                    files: [{ path: 'old.view.lkml', content: 'view: old {}' }],
                  })}</LOOKML_BUNDLE>`,
                },
                {
                  type: 'code_execution',
                  output: `<LOOKML_BUNDLE>${JSON.stringify({
                    id: 'run_65',
                    project_id: 'stackoverflow',
                    __bundle_ref__: '/workspace/lookml_bundle_run_65.json',
                  })}</LOOKML_BUNDLE>`,
                },
              ],
              output_text: 'Done [Open stackoverflow in Looker IDE](/projects/stackoverflow)',
            }),
          }
        }
        return { ok: true, status: 200, headers: {}, body: '{}' }
      },
    }

    const turnRes = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtSDK,
      auth: { mode: 'apikey', apiKey: 'test-key' },
      userId: 'user_65',
      conversationId: 'conv_65',
      session: { toolType: 'lookml', environmentId: envId, conversationId: 'conv_65' },
      mode: 'data_app',
      toolMode: 'lookml',
      useCase: 'auto',
      selectedExplores: [],
      schemaMarkdown: '# Empty',
      userPrompt: '/agentic-lookml-workflow Here are sql queries for stackoverflow',
      onStatus: () => {},
    })

    expect(fetchedUrls.some((u) => u.includes(`_req_${cacheKey}.json`))).toBe(true)
    expect(fetchedUrls.some((u) => u.includes('lookml_bundle_run_65.json'))).toBe(true)
    expect(turnRes.lookmlBundle?.files).toHaveLength(1)
    expect(turnRes.lookmlBundle?.files[0]?.path).toBe('stackoverflow.model.lkml')
    expect(turnRes.lookmlBundle?.files[0]?.diff).toContain('+connection: "default"')
    expect(turnRes.session.usedBridgeTool).toBe(true)

    // Latest __bundle_ref__ wins over earlier inline <LOOKML_BUNDLE>
    const latestBundle = extractLookmlBundleFromInteraction({
      steps: [
        { output: '<LOOKML_BUNDLE>{"id":"old","title":"Old","project_id":"old","files":[{"path":"a.lkml","content":"view: a {}"}]}</LOOKML_BUNDLE>' },
        { output: '<LOOKML_BUNDLE>{"id":"new","title":"New","project_id":"new","__bundle_ref__":"/workspace/lookml_bundle_new.json"}</LOOKML_BUNDLE>' },
      ],
    })
    expect(latestBundle?.id).toBe('new')

    // "Create a LookML dashboard" routes to 'dashboard', not 'lookml'
    expect(matchExplicitUseCaseRule('Create a LookML dashboard for sales')).toBe('dashboard')
    expect(matchExplicitUseCaseRule('Build a quick Stack Overflow dashboard')).toBe('dashboard')

    // _check_dashboard_fields propagates filter default_value across listen: to secondary explores
    const probeFiltersSeen: Array<Record<string, unknown>> = []
    await LkrCodeMode.runPythonCode({
      code: wrapDashboardCodeMode(
        '_check_dashboard_fields("so_m", "posts", filters=[{"name": "date_range", "type": "date_filter", "default_value": "2022/01/01 to 2022/12/31"}], tiles=[{"title": "Votes", "explore": "votes", "fields": ["votes.count"], "listen": {"date_range": "votes.created_date"}}])\nreturn "ok"'
      ),
      requestHandler: async (method: string, urlPath: string, _qp?: unknown, body?: unknown) => {
        if (method === 'GET' && urlPath.includes('/explores/')) {
          return { fields: { dimensions: [{ name: 'votes.created_date' }], measures: [{ name: 'votes.count' }] } }
        }
        if (method === 'POST' && urlPath.includes('/queries/run/json_detail')) {
          probeFiltersSeen.push(((body as { filters?: Record<string, unknown> })?.filters) || {})
          return { data: [{ 'votes.count': { value: 1 } }] }
        }
        return {}
      },
      vars: { target_model: 'so_m', target_explore: 'posts' },
    })
    expect(probeFiltersSeen).toEqual([{ 'votes.created_date': '2022/01/01 to 2022/12/31' }])

    // Warm Turn 2 dashboard mode retains lkr_cli_extension_bridge so previous_interaction_id history stays valid
    let turn2Tools: Array<{ name?: string; type?: string }> = []
    const mockDashExt = {
      serverProxy: async (_url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === 'POST') {
          const parsed = JSON.parse(String(init.body || '{}')) as { tools?: Array<{ name?: string; type?: string }> }
          turn2Tools = parsed.tools || []
        }
        return {
          ok: true,
          status: 200,
          headers: {},
          body: JSON.stringify({
            id: 'int_dash_2',
            environment_id: envId,
            status: 'completed',
            output_text: '<USE_CASE>dashboard</USE_CASE>\nBuilt [Dashboard](/dashboards/42)',
          }),
        }
      },
    }
    await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockDashExt,
      auth: { mode: 'apikey', apiKey: 'test-key' },
      userId: 'user_65',
      conversationId: 'conv_65',
      session: turnRes.session,
      mode: 'dashboard',
      useCase: 'auto',
      lookmlProjectId: 'stackoverflow',
      selectedExplores: [],
      schemaMarkdown: '',
      userPrompt: 'Generate a quick dashboard with some of the metrics!',
      onStatus: () => {},
    })
    expect(turn2Tools.some((t) => t.name === 'run_looker_codemode')).toBe(true)
    expect(turn2Tools.some((t) => t.name === 'lkr_cli_extension_bridge')).toBe(true)
    expect(turn2Tools.some((t) => t.type === 'code_execution')).toBe(false)
  })

}
