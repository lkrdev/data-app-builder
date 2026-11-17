import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import { runAntigravityTurn } from '../../antigravity'
import {
  extractDeletedLookerResources,
  extractResolvedUseCase,
  hasMutatingCodeModeRequest,
  isLookerInstanceMetadataQuery,
  LOOKER_INSTANCE_ADMIN_OP_RE,
  matchExplicitUseCaseRule,
  reconcileDeletedLookerContent,
  shouldOfferReusableScriptPrompt,
  shouldRouteToIsolatedCaSubagent,
  StudioContentItem,
} from '../../lookerApi'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart23Tests(): void {
  test('87. Issue #215: routes home-folder/health-pulse/template/JSON/cleanup & read-only see_lookml prompts to tile, canonicalizes args.vars in executedCodeModeByCode, preserves multi-mutation bridgePermissionError, reconciles soft-trashed tabs, and suppresses reusable Script prompt on mutating tile turns', async () => {
    // 1. Routing: home folder, LOOKER_INSTANCE_ADMIN_OP_RE, read-only see_lookml -> 'tile', and non-regression for data-investigator & health-check
    expect(LOOKER_INSTANCE_ADMIN_OP_RE).toBeInstanceOf(RegExp)
    const tileMetadataPrompts = [
      'Find out how many dashboards are in my home folder',
      'What Looks are inside my home?',
      'List dashboards in my home space',
      'Run a health pulse on this Looker instance',
      'Run a health check pulse on this Looker instance',
      'Run health_analyze on slow queries',
      'Run health-vacuum to find unused explores',
      'Find unused LookML fields and joins in thelook',
      'Generate a request body template for create_connection',
      "Show api_template('create_dashboard')",
      'Use describe_body on WriteLookWithQuery',
      'Show writable body schema for scheduled_plan',
      'Export portable dashboard json for dashboard 42',
      'Call export_dashboard_json and import_dashboard_json',
      'Import look json from backup',
      'Clean up test dashboards in my personal folder',
      'Clean up all created test_eval_* dashboards and draft looks in my home folder',
      'Trash draft looks in my home folder',
    ]
    for (const p of tileMetadataPrompts) {
      expect(isLookerInstanceMetadataQuery(p)).toBe(true)
      expect(matchExplicitUseCaseRule(p)).toBe('tile')
      expect(extractResolvedUseCase('', p)).toBe('tile')
      expect(shouldRouteToIsolatedCaSubagent({ prompt: p, explicitUseCase: 'auto', isFirstTurn: true })).toBe(false)
    }

    // Non-regression: analytical root-cause stays data-investigator, 3-Pillar stays health-check
    expect(isLookerInstanceMetadataQuery('Find out what drove Q4 returns')).toBe(false)
    expect(extractResolvedUseCase('', 'Find out what drove Q4 returns')).toBe('data-investigator')
    expect(isLookerInstanceMetadataQuery('Run a 3-pillar health check on thelook')).toBe(false)
    expect(extractResolvedUseCase('', 'Run a 3-pillar health check on thelook')).toBe('health-check')
    expect(extractResolvedUseCase('', 'Run a health check and generate TECHNICAL_DESIGN_DOCUMENT.md')).toBe('health-check')

    // Read-only see_lookml user (allowedModes excludes 'lookml' while allowing 'tile') routes LookML inspection & slash skills to 'tile'
    const readOnlyLookmlAllowed = ['app', 'data-investigator', 'dashboard', 'tile', 'conversational-analytics']
    expect(matchExplicitUseCaseRule('Inspect the LookML dimensions in order_items.view.lkml', readOnlyLookmlAllowed)).toBe('tile')
    expect(extractResolvedUseCase('', 'Show sql_table_name in derived_table for users', readOnlyLookmlAllowed)).toBe('tile')
    expect(extractResolvedUseCase('', '/lookml-reviewer audit order_items.view.lkml', readOnlyLookmlAllowed)).toBe('tile')
    expect(extractResolvedUseCase('', '/snowflake-to-bigquery-converter check order_items.view.lkml', readOnlyLookmlAllowed)).toBe('tile')
    expect(extractResolvedUseCase('', '/looker-performance-optimizer audit explores', readOnlyLookmlAllowed)).toBe('tile')
    expect(extractResolvedUseCase('<USE_CASE>lookml</USE_CASE>\nInspected LookML.', 'Check model', readOnlyLookmlAllowed)).toBe('tile')
    expect(extractResolvedUseCase('', 'Create a LookML dashboard for revenue', readOnlyLookmlAllowed)).toBe('dashboard')

    // 2. executedCodeModeByCode canonicalizes args.vars: distinct vars execute both calls; reordered identical vars deduplicate
    let transportFolderCalls = 0
    const varsPostedBodies: Array<Record<string, unknown>> = []
    let varsStep = 0
    await runAntigravityTurn({
      sdk: asSdk({
        authSession: {
          transport: {
            rawRequest: async (_m: string, reqPath: string) => {
              transportFolderCalls += 1
              return { ok: true, statusCode: 200, body: JSON.stringify({ path: reqPath }) }
            },
          },
        },
      }),
      userId: '1',
      extensionSDK: {
        serverProxy: async (_url: string, init?: FetchCustomParameters) => {
          varsStep += 1
          const parsedBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
          varsPostedBodies.push(parsedBody)
          if (varsStep === 1) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_215_vars_1',
                environment_id: 'env_215',
                status: 'requires_action',
                steps: [
                  {
                    id: 'call_v1',
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: JSON.stringify({ code: 'return folder(fid)', vars: { fid: '10', extra: { b: 2, a: 1 } } }),
                  },
                  {
                    id: 'call_v2',
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: JSON.stringify({ code: 'return folder(fid)', vars: { fid: '20', extra: { a: 1, b: 2 } } }),
                  },
                  {
                    id: 'call_v3_dup',
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: JSON.stringify({ code: 'return folder(fid)', vars: { extra: { a: 1, b: 2 }, fid: '10' } }),
                  },
                ],
              }),
            }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({ id: 'int_215_vars_2', environment_id: 'env_215', status: 'completed', output_text: '<USE_CASE>tile</USE_CASE>Inspected folders.' }),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'k-215', oauthToken: '', clientId: '', projectId: '' },
      session: { environmentId: 'env_215', lastInteractionId: 'int_prev_215' },
      selectedExplores: [],
      schemaMarkdown: '',
      userPrompt: 'What dashboards are in my home folder?',
      requirePermission: false,
      onStatus: () => {},
    })
    expect(transportFolderCalls).toBe(2)
    const varsResults = (varsPostedBodies[1]?.input as Array<{ call_id?: string; result?: Record<string, unknown> }>) || []
    expect(varsResults[0]?.result).toMatchObject({ path: '/folders/10' })
    expect(varsResults[0]?.result?._duplicate_call_notice).toBeUndefined()
    expect(varsResults[1]?.result).toMatchObject({ path: '/folders/20' })
    expect(varsResults[1]?.result?._duplicate_call_notice).toBeUndefined()
    expect(varsResults[2]?.result).toMatchObject({ path: '/folders/10' })
    expect(String(varsResults[2]?.result?._duplicate_call_notice || '')).toContain('already executed')

    // 3. bridgePermissionError preservation across multi-mutation batches (denied+approved & approved+denied) and clear on subsequent clean mutation round
    const runBatchPermScenario = async (callsByRound: Array<Array<{ id: string; code: string }>>) => {
      let stepIdx = 0
      return runAntigravityTurn({
        sdk: asSdk({
          authSession: {
            transport: {
              rawRequest: async () => ({ ok: true, statusCode: 200, body: '{"id":"501"}' }),
            },
          },
        }),
        userId: '1',
        extensionSDK: {
          serverProxy: async () => {
            const roundCalls = callsByRound[stepIdx]
            stepIdx += 1
            if (roundCalls) {
              return {
                ok: true,
                status: 200,
                body: JSON.stringify({
                  id: `int_perm_${stepIdx}`,
                  environment_id: 'env_215',
                  status: 'requires_action',
                  steps: roundCalls.map((c) => ({
                    id: c.id,
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: JSON.stringify({ code: c.code }),
                  })),
                }),
              }
            }
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: `int_perm_${stepIdx}`,
                environment_id: 'env_215',
                status: 'completed',
                output_text: '<USE_CASE>dashboard</USE_CASE>\n<NATIVE_CONTENT_BUNDLE>{"id":"501","content_type":"dashboard","title":"Exec"}</NATIVE_CONTENT_BUNDLE>',
              }),
            }
          },
        },
        auth: { mode: 'apikey', apiKey: 'k-215', oauthToken: '', clientId: '', projectId: '' },
        session: { environmentId: 'env_215', lastInteractionId: 'int_prev_215' },
        selectedExplores: [],
        schemaMarkdown: '',
        userPrompt: 'Update dashboards',
        requirePermission: true,
        onPermissionRequest: async (req) => (req.operation === 'delete_dashboard' ? 'deny' : 'allow_once'),
        onStatus: () => {},
      })
    }

    // Case A: Call 1 approved (create_dashboard), Call 2 denied (delete_dashboard)
    const permResA = await runBatchPermScenario([
      [
        { id: 'c_ok_1', code: 'return create_dashboard({"title": "Allowed"})' },
        { id: 'c_deny_2', code: 'return delete_dashboard("99")' },
      ],
    ])
    expect(permResA.permissionError).toContain("PermissionError: Operation 'delete_dashboard'")

    // Case B: Call 1 denied (delete_dashboard), Call 2 approved (create_dashboard) in SAME batch -> denial NOT clobbered
    const permResB = await runBatchPermScenario([
      [
        { id: 'c_deny_1', code: 'return delete_dashboard("99")' },
        { id: 'c_ok_2', code: 'return create_dashboard({"title": "Allowed"})' },
      ],
    ])
    expect(permResB.permissionError).toContain("PermissionError: Operation 'delete_dashboard'")

    // Case C: Round 1 denied, Round 2 approved mutation succeeds cleanly -> bridgePermissionError cleared
    const permResC = await runBatchPermScenario([
      [{ id: 'r1_deny', code: 'return delete_dashboard("99")' }],
      [{ id: 'r2_ok', code: 'return create_dashboard({"title": "Approved Retry"})' }],
    ])
    expect(permResC.permissionError).toBeUndefined()

    // 4. Soft-trash tab reconciliation & mutating/admin tile turn suppression of reusable Script prompt
    const openTabs: StudioContentItem[] = [
      { key: 'dashboard:10', id: '10', contentType: 'dashboard', title: 'Kept Dashboard', embedPath: '/embed/dashboards/10', hidden: false },
      { key: 'dashboard:77', id: '77', contentType: 'dashboard', title: 'test_eval_draft', embedPath: '/embed/dashboards/77', hidden: false },
      { key: 'look:88', id: '88', contentType: 'look', title: 'test_eval_look', embedPath: '/embed/looks/88', hidden: false },
    ]
    const softTrashSteps = [
      {
        kind: 'codemode',
        content: [
          'update_dashboard("10", {"title": "Kept Dashboard v2"})',
          'for d_id in ["77"]: update_dashboard(d_id, {"deleted": True})',
          'update_look("88", body={"deleted": True})',
          '# Looker API Telemetry',
          '# PATCH /dashboards/10 (11ms)',
          '# PATCH /dashboards/77 (14ms)',
          '# PATCH /looks/88 (9ms)',
          '# PATCH /dashboards/99 (5ms)',
          '# PATCH /dashboards/99 [ERR] (6ms)',
          '# Output',
          '{"trashed_dashboards":["77"],"trashed_looks":["88"]}',
        ].join('\n'),
      },
    ]
    expect(extractDeletedLookerResources(softTrashSteps)).toEqual([
      { kind: 'dashboards', id: '77' },
      { kind: 'looks', id: '88' },
    ])
    const reconciled = reconcileDeletedLookerContent(openTabs, 'dashboard:77', softTrashSteps)
    expect(reconciled.nextItems.map((it) => it.key)).toEqual(['dashboard:10'])
    expect(reconciled.nextActiveTabKey).toBe('dashboard:10')
    expect(reconciled.crudItems).toEqual([
      expect.objectContaining({ key: 'dashboard:77', id: '77', contentType: 'dashboard', action: 'deleted' }),
      expect.objectContaining({ key: 'look:88', id: '88', contentType: 'look', action: 'deleted' }),
    ])

    // Non-trash rename with Looker response {"deleted": false}, variable-ID non-trash alongside soft-trash, and unexecuted/commented trash leave kept tabs untouched
    const renameOnlySteps = [
      {
        kind: 'codemode',
        content: 'update_dashboard("10", {"title": "Renamed"})\n# Looker API Telemetry\n# PATCH /dashboards/10 (10ms)\n# Output\n{"id":"10","deleted":false}',
      },
    ]
    expect(extractDeletedLookerResources(renameOnlySteps)).toEqual([])
    expect(hasMutatingCodeModeRequest(renameOnlySteps)).toBe(true)

    const mixedVarSteps = [
      {
        kind: 'codemode',
        content: [
          '# update_dashboard("10", {"deleted": True})',
          'keep_id = "10"',
          'update_dashboard(keep_id, {"title": "Kept v3"})',
          'for d in [{"id": "77"}]: update_dashboard(str(d.get("id")), {"deleted": True})',
          '# Looker API Telemetry',
          '# PATCH /dashboards/10 (8ms)',
          '# PATCH /dashboards/77 (12ms)',
          '# Output',
          '{"trashed_dashboards":["77"]}',
        ].join('\n'),
      },
      {
        kind: 'codemode',
        content: 'raise ValueError("abort before call")\nupdate_dashboard("10", {"deleted": True})',
      },
    ]
    expect(extractDeletedLookerResources(mixedVarSteps)).toEqual([{ kind: 'dashboards', id: '77' }])

    const readOnlyLookupSteps = [
      {
        kind: 'codemode',
        content: 'me()\nfolder("5")\nrun_inline_query("json", {})\n# Looker API Telemetry\n# GET /user (5ms)\n# GET /folders/5 (8ms)\n# POST /queries/run/json (42ms)\n# PATCH /session (6ms)\n# POST /dashboards [ERR] (11ms)',
      },
    ]
    expect(hasMutatingCodeModeRequest(readOnlyLookupSteps)).toBe(false)
    expect(
      shouldOfferReusableScriptPrompt({
        effectivePrompt: 'What dashboards are in my home folder?',
        baseReply: 'Found 2 dashboards in your home folder.',
        activitySteps: readOnlyLookupSteps,
        crudItemsCount: 0,
      })
    ).toBe(true)
    expect(
      shouldOfferReusableScriptPrompt({
        effectivePrompt: 'Clean up test dashboards in my personal folder',
        baseReply: 'Moved 2 test dashboards to trash.',
        activitySteps: softTrashSteps,
        crudItemsCount: reconciled.crudItems.length,
      })
    ).toBe(false)
    expect(
      shouldOfferReusableScriptPrompt({
        effectivePrompt: "Show api_template('create_dashboard')",
        baseReply: 'Here is the WriteDashboard template.',
        activitySteps: [],
        crudItemsCount: 0,
      })
    ).toBe(false)
    expect(
      shouldOfferReusableScriptPrompt({
        effectivePrompt: 'Delete dashboard 77',
        baseReply: 'Deleted dashboard 77.',
        activitySteps: [{ kind: 'codemode', content: '# DELETE /dashboards/77 (12ms)' }],
        crudItemsCount: 1,
      })
    ).toBe(false)

    const repoRoot = path.resolve(__dirname, '../../..')
    const turnSrc215 = readFileSync(path.join(repoRoot, 'src/studioControllerTurn.ts'), 'utf8')
    expect(turnSrc215).toContain('Would you like me to save this Looker API lookup as a reusable **Script**?')
    expect(turnSrc215).toContain('shouldOfferReusableScriptPrompt(')
    expect(turnSrc215).toContain('reconcileDeletedLookerContent(')
  })
}
