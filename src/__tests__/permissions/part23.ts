import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import { BUNDLE_APP_PY, DATA_APP_GUIDE_MD, runAntigravityTurn } from '../../antigravity'
import { openContentLinkTargetInViewer, parseInViewerLookerLink } from '../../components/StudioMarkdown'
import {
  createDeduplicatedLookerSdkProxy,
  extractDeletedLookerResources,
  formatLookerErrorDetail,
  hasMutatingCodeModeRequest,
  isLooker404Error,
  isLookerInstanceMetadataQuery,
  LOOKER_INSTANCE_ADMIN_OP_RE,
  reconcileDeletedLookerContent,
  saveDashboardStudioMetadata,
  shouldOfferReusableScriptPrompt,
  StudioContentItem,
  unwrapLookerRawResponse,
  upsertPublishedDataApp,
  upsertStudioContentItem,
} from '../../lookerApi'
import { KDA_TOOLKIT_PY } from '../../lookmlSkills'
import type { StudioController } from '../../useStudioController'

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
    }

    // Non-regression: analytical root-cause & 3-Pillar health check are not instance metadata queries
    expect(isLookerInstanceMetadataQuery('Find out what drove Q4 returns')).toBe(false)
    expect(isLookerInstanceMetadataQuery('Run a 3-pillar health check on thelook')).toBe(false)

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
            body: JSON.stringify({ id: 'int_215_vars_2', environment_id: 'env_215', status: 'completed', output_text: 'Inspected folders.' }),
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
                output_text: '<NATIVE_CONTENT_BUNDLE>{"id":"501","content_type":"dashboard","title":"Exec"}</NATIVE_CONTENT_BUNDLE>',
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

  test('88. Issue #222: removes hallucinated data-app.js exports, auto-heals & validates runtime imports in BUNDLE_APP_PY, guards drill_top_driver list results, self-heals stale dashboard_elements 404s, formats Looker error bodies, and backfills bare-link titles', async () => {
    const repoRoot = path.resolve(__dirname, '../../..')

    // 1. Skill & retry prompt parity: no hallucinated LookerDataApp / createTextCol / badgeMap instructions
    const extSkillMd = readFileSync(path.join(repoRoot, 'skills/data-apps/SKILL.md'), 'utf8')
    const syncSkillMd = readFileSync(path.join(repoRoot, '.agents/skills/data-apps-sync/SKILL.md'), 'utf8')
    const loopSrc = readFileSync(path.join(repoRoot, 'src/antigravityLoop.ts'), 'utf8')
    const agSrc = readFileSync(path.join(repoRoot, 'src/antigravity.ts'), 'utf8')
    expect(DATA_APP_GUIDE_MD).toBe(extSkillMd)
    for (const txt of [extSkillMd, syncSkillMd, loopSrc]) {
      expect(txt).not.toContain('LookerDataApp')
      expect(txt).not.toContain('createTextCol')
      expect(txt).not.toContain('badgeMap')
      expect(txt).toContain('badgeClassMap')
    }
    const step3Line = agSrc.split('\n').find((l) => l.includes('const step3Directive =')) || ''
    expect(step3Line).toContain('badgeClassMap')
    expect(step3Line).not.toContain('createTextCol')
    expect(step3Line).not.toContain('LookerDataApp')

    // 2. BUNDLE_APP_PY auto-heals LookerDataApp, positional/object createTextCol, badgeMap, and enforces invalid-runtime-import
    const workDir = mkdtempSync(path.join(tmpdir(), 'dab-222-test-'))
    try {
      const bundlePyPath = path.join(workDir, 'bundle_app.py')
      writeFileSync(
        bundlePyPath,
        BUNDLE_APP_PY.replace('Path("/workspace/bundle.json")', `Path(${JSON.stringify(path.join(workDir, 'bundle.json'))})`),
        'utf8'
      )
      const healPath = path.join(workDir, 'heal_app.js')
      const healSrc = [
        "import './theme.css'",
        `import { ${Array.from({ length: 20 }, (_, i) => `a${i} as b${i}`).join(', ')} } from 'https://esm.sh/some-lib'`,
        'export function fmtHelper(v) { return v }',
        'import {',
        '  LookerDataApp, // inline comment inside specifier list',
        '  DataApp, html, createTextCol, createBadgeCol, createCurrencyCol,',
        "} from '/runtime/data-app.js'",
        'export class HealApp extends LookerDataApp {',
        "  constructor() { super(); this.lookerModel = 'thelook'; this.explore = 'order_items'; }",
        '  render() {',
        '    const cols = [',
        "      createTextCol(\n        'order_items.id', // col\n        'ID' // label\n      ),",
        "      createTextCol('order_items.city', 'City', 140),",
        "      createTextCol('order_items.state', 'State', { width: 100 }),",
        "      createTextCol({ field: 'order_items.country', headerName: 'Country', width: 120 } // trailing comment\n      ),",
        "      createBadgeCol({ field: 'order_items.status', headerName: 'Status', width: 130, badgeMap: {\n        Cancelled: { label: 'Cancelled', tone: 'danger' }, // voided\n        Pending: 'warning', Processing: 'info', Complete: 'success', Other: 'neutral' // fallback\n      } }),",
        "      createBadgeCol('order_items.tier', 'Tier', 110, { badgeMap: { Bad: 'badge-danger' } }),",
        "      createCurrencyCol({ field: 'order_items.total_sale_price', headerName: 'Revenue' }),",
        '    ];',
        "    return html`<app-grid .columnDefs=${cols} .query=${{ model: 'thelook', view: 'order_items', fields: ['order_items.id', 'order_items.total_sale_price'] }}></app-grid>`;",
        '  }',
        '}',
        "customElements.define('heal-app', HealApp);",
      ].join('\n')
      const bundleOut = execFileSync('python3', [bundlePyPath, '--stdin', 'Healed App', healPath], {
        input: healSrc,
        encoding: 'utf8',
        stdio: 'pipe',
      })
      expect(bundleOut).toContain('<DATA_APP_BUNDLE>')
      const healed = readFileSync(healPath, 'utf8')
      expect(healed).not.toContain('LookerDataApp')
      expect(healed).not.toContain('createTextCol')
      expect(healed).not.toContain('badgeMap')
      expect(healed).toContain('extends DataApp')
      expect(healed).toContain("{ field: 'order_items.id', headerName: 'ID' }")
      expect(healed).toContain("{ field: 'order_items.city', headerName: 'City', width: 140 }")
      expect(healed).toContain("{ field: 'order_items.state', headerName: 'State', width: 100 }")
      expect(healed).toContain("{ field: 'order_items.country', headerName: 'Country', width: 120 }")
      expect(healed).toContain("{ field: 'order_items.tier', headerName: 'Tier', width: 110, badgeClassMap: { Bad: 'badge-red' } }")
      expect(healed).toContain('badgeClassMap:')
      expect(healed).toContain("'badge-red'")
      expect(healed).toContain("'badge-amber'")
      expect(healed).toContain("'badge-blue'")
      expect(healed).toContain("'badge-green'")
      expect(healed).toContain("'badge-neutral'")

      // Preserves user-defined local subclass `class LookerDataApp extends DataApp`
      const localSubPath = path.join(workDir, 'local_sub.js')
      execFileSync('python3', [bundlePyPath, '--stdin', 'Local Sub App', localSubPath], {
        input: [
          "import { DataApp, html } from '/runtime/data-app.js';",
          'class LookerDataApp extends DataApp {}',
          "export class ChildApp extends LookerDataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; } render() { return html`<app-grid .query=${{ fields: ['orders.count'] }}></app-grid>`; } }",
          "customElements.define('child-app', ChildApp);",
        ].join('\n'),
        encoding: 'utf8',
        stdio: 'pipe',
      })
      expect(readFileSync(localSubPath, 'utf8')).toContain('class LookerDataApp extends DataApp')

      expect(() =>
        execFileSync('python3', [bundlePyPath, '--stdin', 'Bad Import App', path.join(workDir, 'bad_imp.js')], {
          input: [
            "import { DataApp, html, nonexistentHelper } from '/runtime/data-app.js';",
            "export class BadImp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; } render() { return html`<app-grid .query=${{ fields: ['orders.count'] }}></app-grid>`; } }",
            "customElements.define('bad-imp', BadImp);",
          ].join('\n'),
          encoding: 'utf8',
          stdio: 'pipe',
        })
      ).toThrow(/invalid-runtime-import[\s\S]*nonexistentHelper/)

      expect(() =>
        execFileSync('python3', [bundlePyPath, '--stdin', 'Default Import App', path.join(workDir, 'def_imp.js')], {
          input: [
            'export function helper() {}',
            "import DataApp, { html } from '/runtime/data-app.js';",
            "export class DefImp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; } render() { return html`<app-grid .query=${{ fields: ['orders.count'] }}></app-grid>`; } }",
            "customElements.define('def-imp', DefImp);",
          ].join('\n'),
          encoding: 'utf8',
          stdio: 'pipe',
        })
      ).toThrow(/invalid-runtime-import[\s\S]*Default import 'DataApp'/)

      expect(() =>
        execFileSync('python3', [bundlePyPath, '--stdin', 'Bad Reexport App', path.join(workDir, 'bad_reexp.js')], {
          input: [
            "import { DataApp, html } from '/runtime/data-app.js';",
            "export { nonexistent as default } from '/runtime/data-app.js';",
            "export class ReexpImp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; } render() { return html`<app-grid .query=${{ fields: ['orders.count'] }}></app-grid>`; } }",
            "customElements.define('reexp-imp', ReexpImp);",
          ].join('\n'),
          encoding: 'utf8',
          stdio: 'pipe',
        })
      ).toThrow(/invalid-runtime-import[\s\S]*'nonexistent'/)

      // 3. kda_toolkit.py drill_top_driver accepts pre-parsed list/rows results and guards empty/null/error/{} payloads
      const kdaDisk = readFileSync(path.join(repoRoot, 'skills/key-driver-analysis/scripts/kda_toolkit.py'), 'utf8')
      expect(KDA_TOOLKIT_PY).toBe(kdaDisk)
      const kdaTestPy = [
        'import json',
        'def run_inline_query(fmt, body):',
        '    flds = body.get("fields") or []',
        '    is_test = "2026-02" in str((body.get("filters") or {}).get("orders.created_date", ""))',
        '    if "orders.created_date" in flds:',
        '        return {"rows": [{"orders.created_date": "2026-02-01", "orders.rev": 300}]}',
        '    if "orders.count" in flds:',
        '        return [{"orders.rev": 300 if is_test else 100, "orders.count": 25 if is_test else 10}]',
        '    return [{"products.category": "Apparel", "orders.rev": 240 if is_test else 60}, {"products.category": "Outerwear", "orders.rev": 60 if is_test else 40}]',
        kdaDisk,
        'res = drill_top_driver("ecom", "orders", "orders.rev", {"drivers": [{"drivers": ["users.state=CA"], "archetype": "PRIMARY_ACCELERATOR", "unexpected_difference": 200}]}, ["users.state", "products.category"], {"orders.created_date": "2026-01-01 to 2026-01-31"}, {"orders.created_date": "2026-02-01 to 2026-02-28"}, sub_timeframe="orders.created_date", explore_info={"measure_map": {"orders.rev": {"type": "sum"}, "orders.count": {"type": "count"}}})',
        'print(json.dumps({"status": res["pass2_kda"]["status"], "trend_n": len(res["breach_sub_trend"]), "ue": res["unit_economics"], "guards": [_as_rows(""), _as_rows("null"), _as_rows({}), _as_rows({"message": "Not found"})]}))',
      ].join('\n')
      const kdaOut = JSON.parse(execFileSync('python3', ['-c', kdaTestPy], { encoding: 'utf8' }).trim())
      expect(kdaOut).toEqual({
        status: 'SUCCESS',
        trend_n: 1,
        ue: { control: { 'orders.rev': 100, 'orders.count': 10 }, test: { 'orders.rev': 300, 'orders.count': 25 } },
        guards: [[], [], [], []],
      })
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }

    // 4. upsertPublishedDataApp & saveDashboardStudioMetadata self-heal stale 404 dashboard_elements
    expect(isLooker404Error(new Error('Looker PATCH /api/4.0/dashboard_elements/99 failed (404): Not found'))).toBe(true)
    expect(isLooker404Error({ statusCode: 404 })).toBe(true)
    expect(isLooker404Error(new Error('Looker PATCH /dashboards/42 failed (500): Internal'))).toBe(false)

    const patchedElemIds: string[] = []
    const healedLiveElem = await upsertPublishedDataApp(
      asSdk({
        ok: async <T>(p: T) => p,
        dashboard: async (id: string) => ({
          id,
          dashboard_elements: [{ id: '202', type: 'extension', extension_id: 'db::ext-42' }],
        }),
        update_dashboard: async (id: string) => ({ id }),
        update_dashboard_element: async (id: string) => {
          patchedElemIds.push(id)
          if (id === '99') throw new Error('Looker PATCH /api/4.0/dashboard_elements/99 failed (404): Not found')
          return { id }
        },
        authSession: {
          transport: {
            rawRequest: async () => ({ ok: true, statusCode: 200, body: '{"id":"ext-42"}' }),
          },
        },
      }),
      { title: 'Healed Live', raw_code: 'export class A {}', prod_code: 'export class A {}', widgets: [] },
      '5',
      { dashboardId: '42', extensionId: 'ext-42', elementId: '99', title: 'Old', folderId: '5' }
    )
    expect(patchedElemIds).toEqual(['99', '202'])
    expect(healedLiveElem.elementId).toBe('202')

    const recreatedRawCalls: string[] = []
    const skippedNonDbIds: string[] = []
    const recreatedElem = await upsertPublishedDataApp(
      asSdk({
        ok: async <T>(p: T) => p,
        dashboard: async (id: string) => ({
          id,
          dashboard_elements: [
            { id: '500', type: 'vis' },
            { id: '777', type: 'extension', extension_id: 'data_app_builder::data_app_builder' },
          ],
          dashboard_layouts: [{ id: 'lay_42', active: true, type: 'newspaper', dashboard_layout_components: [{ id: 'lc_1', row: 0, height: 8 }] }],
        }),
        update_dashboard: async (id: string) => ({ id }),
        update_dashboard_element: async (id: string) => {
          skippedNonDbIds.push(id)
          throw new Error('Looker PATCH /api/4.0/dashboard_elements/99 failed (404): Not found')
        },
        authSession: {
          transport: {
            rawRequest: async (m: string, p: string) => {
              recreatedRawCalls.push(`${m} ${p}`)
              if (m === 'POST' && p === '/dashboard_elements') return { ok: true, statusCode: 200, body: '{"id":"303"}' }
              return { ok: true, statusCode: 200, body: '{"id":"ext-42"}' }
            },
          },
        },
      }),
      { title: 'Recreated Tile', raw_code: 'export class A {}', prod_code: 'export class A {}', widgets: [] },
      '5',
      { dashboardId: '42', extensionId: 'ext-42', elementId: '99', title: 'Old', folderId: '5' }
    )
    expect(skippedNonDbIds).toEqual(['99'])
    expect(recreatedElem.elementId).toBe('303')
    expect(recreatedRawCalls).toContain('POST /dashboard_elements')
    expect(recreatedRawCalls).toContain('POST /dashboard_layout_components')
    expect(recreatedRawCalls).not.toContain('PATCH /dashboard_layouts/lay_42')

    const metaRetried = await saveDashboardStudioMetadata(
      asSdk({
        ok: async <T>(p: T) => p,
        dashboard: async (id: string) => ({ id, dashboard_elements: [{ id: '205', type: 'extension', extension_id: 'db::ext-42' }] }),
        update_dashboard_element: async (id: string) => {
          if (id === '99') throw new Error('Looker PATCH /dashboard_elements/99 failed (404): Not found')
          return { id }
        },
      }),
      { dashboardId: '42', extensionId: 'ext-42', elementId: '99', title: 'App', folderId: '5' },
      { lastInteractionId: 'int_1' }
    )
    expect(metaRetried.elementId).toBe('205')
    expect(metaRetried.studio?.lastInteractionId).toBe('int_1')

    const metaCleared = await saveDashboardStudioMetadata(
      asSdk({
        ok: async <T>(p: T) => p,
        dashboard: async (id: string) => ({ id, dashboard_elements: [{ id: '500', type: 'vis' }] }),
        update_dashboard_element: async () => {
          throw new Error('Looker PATCH /dashboard_elements/99 failed (404): Not found')
        },
      }),
      { dashboardId: '42', extensionId: 'ext-42', elementId: '99', title: 'Converted UDD', folderId: '5' },
      { lastInteractionId: 'int_2' }
    )
    expect(metaCleared.elementId).toBeUndefined()
    expect(metaCleared.studio?.lastInteractionId).toBe('int_2')

    // 5. formatLookerErrorDetail & unwrapLookerRawResponse & deduplicated transport.request
    expect(
      formatLookerErrorDetail(
        '{"message":"Not found","documentation_url":"https://docs.cloud.google.com/looker/docs/r/err/4.0/404/patch/dashboard_elements/:id"}'
      )
    ).toBe('Not found ([Docs](https://docs.cloud.google.com/looker/docs/r/err/4.0/404/patch/dashboard_elements/:id))')
    expect(
      formatLookerErrorDetail({
        message: 'Validation Failed',
        errors: [{ field: 'title', message: "can't be blank" }],
        documentation_url: 'https://docs.cloud.google.com/looker/docs/r/err/4.0/422/post/dashboards(v2)',
      })
    ).toBe("Validation Failed: title: can't be blank ([Docs](https://docs.cloud.google.com/looker/docs/r/err/4.0/422/post/dashboards%28v2%29))")
    expect(() =>
      unwrapLookerRawResponse(
        {
          ok: false,
          statusCode: 404,
          body: '{"message":"Not found","documentation_url":"https://docs.cloud.google.com/looker/docs/r/err/4.0/404/patch/dashboard_elements/:id"}',
        },
        'PATCH',
        '/dashboard_elements/99'
      )
    ).toThrow(/Looker PATCH \/dashboard_elements\/99 failed \(404 role_denied\):[\s\S]*Not found \(\[Docs\]\(https:\/\/docs\.cloud\.google\.com\//)

    const proxiedSdk = createDeduplicatedLookerSdkProxy(
      asSdk({
        authSession: {
          transport: {
            rawRequest: async () => ({
              ok: false,
              statusCode: 404,
              body: '{"message":"Not found","documentation_url":"https://docs.cloud.google.com/looker/docs/r/err/4.0/404/patch/dashboard_elements/:id"}',
            }),
          },
        },
      })
    )
    const reqFn = (proxiedSdk.authSession.transport as unknown as { request: (m: string, p: string) => Promise<{ ok: boolean; error?: Error }> }).request
    const failResp = await reqFn('PATCH', '/api/4.0/dashboard_elements/99')
    expect(failResp.ok).toBe(false)
    expect(failResp.error?.message).toBe(
      'Looker PATCH /api/4.0/dashboard_elements/99 failed (404): Not found ([Docs](https://docs.cloud.google.com/looker/docs/r/err/4.0/404/patch/dashboard_elements/:id))'
    )

    // 6. openContentLinkTargetInViewer background bare-link title backfill + query preservation + conv-switch guard
    let items: StudioContentItem[] = [{ key: 'look:15', id: '15', title: 'Look #15', contentType: 'look', embedPath: '/embed/looks/15' }]
    let selectedKey = ''
    let persistedCount = 0
    let resolveDelayedDash: ((v: { id: string; title: string }) => void) | null = null
    const mockCtl = {
      activeConversationId: 'conv_a',
      contentItems: items,
      setActiveViewerDocument: () => {},
      setRightPaneCollapsed: () => {},
      persistTabStateToConversation: () => {
        persistedCount += 1
      },
      upsertContentItem: (raw: Partial<StudioContentItem> & { id: string; contentType: StudioContentItem['contentType'] }, activate = true) => {
        const res = upsertStudioContentItem(items, raw)
        items = res.items
        mockCtl.contentItems = items
        if (activate) selectedKey = res.activeKey
        return Object.assign({}, res.item, { existed: res.existed })
      },
      handleSelectContentTab: (k: string) => {
        selectedKey = k
      },
      core40SDK: asSdk({
        ok: async <T>(p: T) => p,
        dashboard: (id: string) =>
          id === '999'
            ? new Promise<{ id: string; title: string }>((r) => {
                resolveDelayedDash = r
              })
            : Promise.resolve({ id, title: 'Business Pulse' }),
        look: async (id: string) => ({ id, title: 'Monthly Cohort Retention' }),
        board: async (id: string) => ({ id, title: 'Executive KPI Board' }),
      }),
    } as unknown as StudioController

    const bareDash = parseInViewerLookerLink(
      '/dashboards/commerce::business_pulse?Region=US',
      '/dashboards/commerce::business_pulse?Region=US',
      'https://dev.looker.com'
    )!
    expect(bareDash.title).toBeUndefined()
    openContentLinkTargetInViewer(mockCtl, bareDash)
    expect(items.find((it) => it.key === 'lookml_dashboard:commerce::business_pulse')?.title).toBe('LookML Dashboard (commerce::business_pulse)')
    expect(selectedKey).toBe('lookml_dashboard:commerce::business_pulse')
    await new Promise((r) => setImmediate(r))
    const healedPulse = items.find((it) => it.key === 'lookml_dashboard:commerce::business_pulse')
    expect(healedPulse?.title).toBe('Business Pulse')
    expect(healedPulse?.embedPath).toBe('/embed/dashboards/commerce::business_pulse?Region=US')
    expect(persistedCount).toBeGreaterThanOrEqual(1)

    // Existing placeholder `Look #15` backfills on click; switching conversations aborts stale backfill
    openContentLinkTargetInViewer(mockCtl, parseInViewerLookerLink('/looks/15', '/looks/15', 'https://dev.looker.com')!)
    openContentLinkTargetInViewer(mockCtl, parseInViewerLookerLink('/boards/9', '/boards/9', 'https://dev.looker.com')!)
    openContentLinkTargetInViewer(mockCtl, parseInViewerLookerLink('/dashboards/999', '/dashboards/999', 'https://dev.looker.com')!)
    await new Promise((r) => setImmediate(r))
    ;(mockCtl as unknown as { activeConversationId: string }).activeConversationId = 'conv_b'
    resolveDelayedDash!({ id: '999', title: 'Should Not Cross-Contaminate' })
    await new Promise((r) => setImmediate(r))
    expect(items.find((it) => it.key === 'look:15')?.title).toBe('Monthly Cohort Retention')
    expect(items.find((it) => it.key === 'board:9')?.title).toBe('Executive KPI Board')
    expect(items.find((it) => it.key === 'dashboard:999')?.title).toBe('Dashboard #999')

    // Ref-backed controller: hiding tab / switching to Overview mid-fetch preserves hidden: true & '__overview__'
    const itemsRef = { current: items }
    const tabKeyRef = { current: '__overview__' }
    let nativeTitle = 'Dashboard #77'
    let resolveDash77: ((v: { id: string; title: string }) => void) | null = null
    const refCtl = Object.assign({}, mockCtl, {
      activeConversationId: 'conv_b',
      contentItemsRef: itemsRef,
      activeContentTabKeyRef: tabKeyRef,
      setContentItems: (next: StudioContentItem[]) => {
        itemsRef.current = next
      },
      setNativeContentState: (fn: (p: { id: string; contentType: string; title: string } | null) => { id: string; contentType: string; title: string } | null) => {
        const res = fn({ id: '77', contentType: 'dashboard', title: nativeTitle })
        if (res) nativeTitle = res.title
      },
      upsertContentItem: (raw: Partial<StudioContentItem> & { id: string; contentType: StudioContentItem['contentType'] }) => {
        const res = upsertStudioContentItem(itemsRef.current, raw)
        itemsRef.current = res.items
        return Object.assign({}, res.item, { existed: res.existed })
      },
      core40SDK: asSdk({
        ok: async <T>(p: T) => p,
        dashboard: () =>
          new Promise<{ id: string; title: string }>((r) => {
            resolveDash77 = r
          }),
      }),
    }) as unknown as StudioController
    openContentLinkTargetInViewer(refCtl, parseInViewerLookerLink('/dashboards/77', '/dashboards/77', 'https://dev.looker.com')!)
    itemsRef.current = itemsRef.current.map((it) => (it.key === 'dashboard:77' ? Object.assign({}, it, { hidden: true }) : it))
    tabKeyRef.current = '__overview__'
    resolveDash77!({ id: '77', title: 'Hidden Overview Safe' })
    await new Promise((r) => setImmediate(r))
    const d77 = itemsRef.current.find((it) => it.key === 'dashboard:77')
    expect(d77?.title).toBe('Hidden Overview Safe')
    expect(d77?.hidden).toBe(true)
    expect(tabKeyRef.current).toBe('__overview__')
    expect(nativeTitle).toBe('Hidden Overview Safe')

    const stageSrc = readFileSync(path.join(repoRoot, 'src/components/StudioStagePanels.tsx'), 'utf8')
    expect(stageSrc).not.toContain('activeContentItem.embedPath')
    expect(stageSrc).not.toContain('caConversation.caConversationId')
  })
}
