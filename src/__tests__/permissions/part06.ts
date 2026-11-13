import { readFileSync } from 'node:fs'
import path from 'node:path'

import React from 'react'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  AGENTS_MD, buildDynamicStarterPrompts, classifyLookerOperation, clearStarterPromptsCache,
  DEFAULT_ANTIGRAVITY_MODEL, discoverStarterContentSummaries, discoverStarterExploreContext, executeLkrExtensionToolRequest,
  generateDynamicStarterPrompts, getCachedStarterPrompts, parseStarterPromptsResponse, STARTER_PROMPTS_REQUEST_TAG,
  STARTER_PROMPTS_RESPONSE_FORMAT, stripStarterPromptEmojis,
} from '../../antigravity'
import {
  StudioBadge, StudioButton, StudioCard, StudioDocPreview,
  StudioModal, StudioSelect, StudioSkeleton, StudioToolbar,
} from '../../components/StudioDesignSystem'
import { STARTER_PROMPTS_BY_USE_CASE, StarterPromptButtons } from '../../components/StudioWorkspace'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart06Tests(): void {
  test('27. provides StudioDesignSystem primitives (StudioButton, StudioBadge, StudioModal, StudioToolbar, StudioCard, StudioSkeleton, StudioDocPreview) and studio-design-system skill documentation', () => {
    expect(typeof StudioSelect).toBe('function')
    type Elem = React.ReactElement<Record<string, unknown>>

    const btn = StudioButton({ variant: 'primary', testId: 'ds-btn', children: 'Run' }) as Elem
    expect(btn.type).toBe('button')
    expect(btn.props['data-testid']).toBe('ds-btn')
    expect(btn.props.className).toContain('dab-btn-primary')

    const dangerBtn = StudioButton({ variant: 'danger', children: 'Delete' }) as Elem
    expect(dangerBtn.props.className).toContain('dab-badge-danger')

    const badge = StudioBadge({ tone: 'success', testId: 'ds-badge', children: 'OK' }) as Elem
    expect(badge.props['data-testid']).toBe('ds-badge')
    expect(badge.props.className).toContain('dab-badge')
    expect(badge.props.className).toContain('dab-badge-success')

    const pill = StudioBadge({ tone: 'warning', pill: true, children: '2 warnings' }) as Elem
    expect(pill.props.className).toContain('dab-msg-pill')
    expect(pill.props.className).toContain('dab-badge-warning')

    expect(typeof StudioModal).toBe('function')

    const toolbar = StudioToolbar({
      testId: 'ds-toolbar',
      titleBlockTestId: 'ds-title-block',
      title: 'Preview',
      badges: 'Badge',
      actions: 'Action',
    }) as Elem
    expect(toolbar.props['data-testid']).toBe('ds-toolbar')
    expect(toolbar.props.className).toContain('dab-preview-toolbar')

    const card = StudioCard({ testId: 'ds-card', children: 'Card body' }) as Elem
    expect(card.props['data-testid']).toBe('ds-card')
    expect(card.props.className).toContain('dab-ds-card')

    const skel = StudioSkeleton({ width: 120, height: 28, testId: 'ds-skel' }) as Elem
    expect(skel.props['data-testid']).toBe('ds-skel')
    expect(skel.props.className).toContain('dab-skeleton')
    expect(skel.props.style).toMatchObject({ width: 120, height: 28 })

    const docPrev = StudioDocPreview({ component: 'RunPythonButton', children: 'Preview' }) as Elem
    expect(docPrev.props['data-testid']).toBe('doc-ui-preview')
    expect(docPrev.props['data-component']).toBe('RunPythonButton')
    expect(docPrev.props.style).toEqual({ pointerEvents: 'none', userSelect: 'none' })

    const repoRoot = path.resolve(__dirname, '../../..')
    const skillMd = readFileSync(path.join(repoRoot, '.agents/skills/studio-design-system/SKILL.md'), 'utf8')
    expect(skillMd).toContain('name: studio-design-system')
    expect(skillMd).toContain('StudioModal')
    expect(skillMd).toContain('StudioToolbar')
    expect(skillMd).toContain('--dab-success-bg')
    expect(skillMd).toContain('lucide-react')

    const agentsMd = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('.agents/skills/studio-design-system/SKILL.md')
    expect(agentsMd).toContain('.agents/skills/issue-authoring/SKILL.md')

    // Issue #86: verify starter prompts, LookML turn skills, and DOC_UI_COMPONENTS contain zero decorative emojis
    for (const items of Object.values(STARTER_PROMPTS_BY_USE_CASE)) {
      for (const item of items) {
        expect(item.label).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
      }
    }
    const pkgJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    expect(pkgJson.dependencies?.['lucide-react']).toBeTruthy()
  })

  test('28. enforces requirePermission on mutating sdk_request calls while auto-executing read-only GET and query/validation POST calls, and documents /spartan/oauth2_redirect + Safe Mode matrix (Issue #83)', async () => {
    // 1. Verify classifyLookerOperation across read-only vs mutating endpoints
    expect(classifyLookerOperation('GET', '/user')).toEqual({
      operation: 'read_user',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/queries/run/json')).toEqual({
      operation: 'read_queries_run_json',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/sql_queries')).toEqual({
      operation: 'read_sql_queries',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/merge_queries')).toEqual({
      operation: 'read_merge_queries',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/content_validation')).toEqual({
      operation: 'read_content_validation',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/projects/thelook/validate')).toEqual({
      operation: 'read_projects_thelook_validate',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/projects/thelook/lookml_tests/run')).toEqual({
      operation: 'read_projects_thelook_lookml_tests_run',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/projects/thelook/git_connection_tests')).toEqual({
      operation: 'read_projects_thelook_git_connection_tests',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/dashboards')).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('PATCH', '/dashboards/42')).toEqual({
      operation: 'update_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('DELETE', '/dashboards/42')).toEqual({
      operation: 'delete_dashboard',
      requiresPermission: true,
    })

    // 2. Verify executeLkrExtensionToolRequest for sdk_request read-only bypass vs mutating permission gate
    const transportCalls: Array<{ method: string; path: string; body?: unknown }> = []
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      authSession: {
        transport: {
          rawRequest: async (method: string, reqPath: string, _qp?: unknown, body?: unknown) => {
            transportCalls.push({ method, path: reqPath, body })
            return {
              ok: true,
              statusCode: 200,
              body: JSON.stringify({ ok: true, method, path: reqPath }),
            }
          },
        },
      },
    })

    let permPromptCount = 0
    // Read-only GET and read-only POST (/queries/run/json, /projects/thelook/validate) auto-execute without prompting
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: { kind: 'sdk_request', method: 'GET', path: '/user' },
      requirePermission: true,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'deny'
      },
    })
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: {
        kind: 'sdk_request',
        method: 'POST',
        path: '/queries/run/json',
        body: { model: 'thelook', view: 'order_items', fields: ['order_items.count'] },
      },
      requirePermission: true,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'deny'
      },
    })
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: { kind: 'sdk_request', method: 'POST', path: '/projects/thelook/validate' },
      requirePermission: true,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'deny'
      },
    })
    expect(permPromptCount).toBe(0)
    expect(transportCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /user',
      'POST /queries/run/json',
      'POST /projects/thelook/validate',
    ])

    // Mutating sdk_request without onPermissionRequest or with 'deny' rejects before hitting transport
    transportCalls.length = 0
    await expect(
      executeLkrExtensionToolRequest({
        sdk: mockSdk,
        req: {
          kind: 'sdk_request',
          method: 'POST',
          path: '/dashboards',
          body: { title: 'Blocked Dashboard' },
          dev_mode: true,
        },
        requirePermission: true,
      })
    ).rejects.toThrow(/PermissionError: Operation 'create_dashboard' \(POST \/dashboards\)/)
    expect(transportCalls).toHaveLength(0)

    await expect(
      executeLkrExtensionToolRequest({
        sdk: mockSdk,
        req: {
          kind: 'sdk_request',
          method: 'DELETE',
          path: '/dashboards/42',
          thought: 'Deleting test dashboard 42',
        },
        requirePermission: true,
        onPermissionRequest: async (permReq) => {
          permPromptCount += 1
          expect(permReq).toMatchObject({
            operation: 'delete_dashboard',
            httpMethod: 'DELETE',
            path: '/dashboards/42',
            thought: 'Deleting test dashboard 42',
          })
          return 'deny'
        },
      })
    ).rejects.toThrow(/PermissionError: Operation 'delete_dashboard' \(DELETE \/dashboards\/42\)/)
    expect(permPromptCount).toBe(1)
    expect(transportCalls).toHaveLength(0)

    // 'allow_op' prompts only once across repeated mutating sdk_request calls of the same operation
    const approvedOps = new Set<string>()
    permPromptCount = 0
    for (let i = 0; i < 3; i++) {
      await executeLkrExtensionToolRequest({
        sdk: mockSdk,
        req: {
          kind: 'sdk_request',
          method: 'POST',
          path: '/dashboards',
          body: { title: `Dash ${i}` },
        },
        requirePermission: true,
        approvedOperations: approvedOps,
        onPermissionRequest: async (permReq) => {
          permPromptCount += 1
          expect(permReq.operation).toBe('create_dashboard')
          return 'allow_op'
        },
      })
    }
    expect(permPromptCount).toBe(1)
    expect(approvedOps.has('create_dashboard')).toBe(true)
    expect(transportCalls).toHaveLength(3)

    // 'allow_all' approves all subsequent mutating operations in the turn
    const allowAllSet = new Set<string>()
    permPromptCount = 0
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: { kind: 'sdk_request', method: 'PATCH', path: '/dashboards/42', body: { title: 'Updated' } },
      requirePermission: true,
      approvedOperations: allowAllSet,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'allow_all'
      },
    })
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: { kind: 'sdk_request', method: 'DELETE', path: '/dashboards/42' },
      requirePermission: true,
      approvedOperations: allowAllSet,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'deny'
      },
    })
    expect(permPromptCount).toBe(1)
    expect(allowAllSet.has('*')).toBe(true)

    // Auto-Approve (YOLO: requirePermission: false) executes without prompting
    permPromptCount = 0
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: { kind: 'sdk_request', method: 'POST', path: '/dashboards', body: { title: 'YOLO' } },
      requirePermission: false,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'deny'
      },
    })
    expect(permPromptCount).toBe(0)

    // 3. Verify README.md and .agents/skills/looker-permissions/SKILL.md documentation
    const repoRoot = path.resolve(__dirname, '../../..')
    const readmeMd = readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
    expect(readmeMd).toContain('/extensions/oauth2_redirect')
    expect(readmeMd).toContain('/spartan/oauth2_redirect')
    expect(readmeMd).toContain('Safe Mode (Ask)')
    expect(readmeMd).toContain('Auto-Approve (YOLO)')

    const permSkillMd = readFileSync(
      path.join(repoRoot, '.agents/skills/looker-permissions/SKILL.md'),
      'utf8'
    )
    expect(permSkillMd).toContain('name: looker-permissions')
    expect(permSkillMd).toContain('/spartan/oauth2_redirect')
    expect(permSkillMd).toContain('Safe Mode (Ask)')
    expect(permSkillMd).toContain('classifyLookerOperation')
  })

  test('29. Issue #84: removes hardcoded order_items starter prompts, strips emojis from starter labels, discovers explore fields via lookml_model_explore, and synthesizes dynamic starter prompts via [STARTER_PROMPTS_REQUEST] with skeleton loading state', async () => {
    clearStarterPromptsCache()
    const repoRoot = path.resolve(__dirname, '../../..')
    const workspaceTsx = readFileSync(
      path.join(repoRoot, 'src/components/StudioWorkspace.tsx'),
      'utf8'
    )
    expect(workspaceTsx).not.toMatch(/order_items/i)
    expect(JSON.stringify(STARTER_PROMPTS_BY_USE_CASE)).not.toMatch(/order_items/i)

    // 1. Emoji stripping on labels
    expect(stripStarterPromptEmojis('📊 Build an Executive Revenue Data App')).toBe(
      'Build an Executive Revenue Data App'
    )
    expect(stripStarterPromptEmojis('✨🐍 Explore & Filter Summary')).toBe(
      'Explore & Filter Summary'
    )
    for (const list of Object.values(STARTER_PROMPTS_BY_USE_CASE)) {
      for (const item of list) {
        expect(item.label).toBe(stripStarterPromptEmojis(item.label))
        expect(item.prompt).not.toMatch(/order_items/i)
      }
    }

    // 2. Discover explore context + recent user content via Looker 4.0 SDK lookml_model_explore + content_summary (cached)
    let exploreCalls = 0
    let contentSummaryCalls = 0
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      content_summary: async () => {
        contentSummaryCalls += 1
        return [
          {
            id: 42,
            content_type: 'dashboard',
            content_id: '101',
            content_slug: 'store-executive-pulse',
            title: 'Store Executive Pulse',
            description: 'Weekly store revenue and basket size',
            view_count: 85,
            favorite_count: 12,
            is_scheduled: true,
          },
          {
            id: 43,
            content_type: 'look',
            content_id: '204',
            title: 'Regional Basket Margin Look',
            view_count: 19,
            favorite_count: 3,
            is_scheduled: false,
          },
        ]
      },
      lookml_model_explore: async (modelName: string, exploreName: string) => {
        exploreCalls += 1
        return {
          id: `${modelName}::${exploreName}`,
          name: exploreName,
          label: 'Store Transactions',
          model_name: modelName,
          fields: {
            dimensions: [
              { name: 'store_transactions.store_region', label_short: 'Store Region', type: 'string' },
              { name: 'store_transactions.transaction_month', label_short: 'Transaction Month', type: 'date_month' },
            ],
            measures: [
              { name: 'store_transactions.net_sales', label_short: 'Net Sales', type: 'sum' },
              { name: 'store_transactions.basket_count', label_short: 'Basket Count', type: 'count' },
            ],
          },
        }
      },
    })

    const availableModels = [
      {
        name: 'retail_ops',
        label: 'Retail Operations',
        explores: [{ name: 'store_transactions', label: 'Store Transactions', hidden: false }],
      },
    ]

    const ctx1 = await discoverStarterExploreContext({
      sdk: mockSdk,
      selectedExplores: [],
      availableModels,
    })
    expect(exploreCalls).toBe(1)
    expect(contentSummaryCalls).toBe(1)
    expect(ctx1).toMatchObject({
      modelName: 'retail_ops',
      exploreName: 'store_transactions',
      exploreLabel: 'Store Transactions',
      exploreKey: 'retail_ops::store_transactions',
    })
    expect(ctx1?.measures.map((m) => m.label)).toEqual(['Net Sales', 'Basket Count'])
    expect(ctx1?.contentSummaries).toHaveLength(2)
    expect(ctx1?.contentSummaries?.[0]).toMatchObject({
      content_type: 'dashboard',
      content_id: '101',
      title: 'Store Executive Pulse',
    })
    expect(await discoverStarterContentSummaries(mockSdk)).toHaveLength(2)
    expect(contentSummaryCalls).toBe(1)

    // Second lookup for same explore hits in-memory cache
    const ctx2 = await discoverStarterExploreContext({
      sdk: mockSdk,
      selectedExplores: ['retail_ops::store_transactions'],
      availableModels,
    })
    expect(exploreCalls).toBe(1)
    expect(ctx2?.exploreKey).toBe('retail_ops::store_transactions')

    // 3. Deterministic dynamic prompts reflect discovered explore, content_summary, & permitted use cases
    const localPrompts = buildDynamicStarterPrompts({
      useCase: 'auto',
      selectedExplores: ['retail_ops::store_transactions'],
      permittedUseCases: ['app', 'dashboard', 'conversational-analytics'],
      availableModels,
      exploreContext: ctx1,
    })
    expect(localPrompts.length).toBe(3)
    expect(localPrompts[0].label).toContain('Store Transactions')
    expect(localPrompts[0].prompt).toContain('retail_ops::store_transactions')
    expect(localPrompts[0].prompt).toContain('Net Sales')
    expect(localPrompts.every((p) => ['app', 'dashboard', 'conversational-analytics'].includes(p.useCase || ''))).toBe(true)

    const appPrompts = buildDynamicStarterPrompts({
      useCase: 'app',
      selectedExplores: ['retail_ops::store_transactions'],
      availableModels,
      exploreContext: ctx1,
    })
    expect(appPrompts[2].label).toBe('Upgrade Store Executive Pulse to Data App')
    expect(appPrompts[2].prompt).toContain('"Store Executive Pulse" Looker dashboard (#101)')

    const dashPrompts = buildDynamicStarterPrompts({
      useCase: 'dashboard',
      selectedExplores: ['retail_ops::store_transactions'],
      availableModels,
      exploreContext: ctx1,
    })
    expect(dashPrompts[2].label).toBe('Pin Store Executive Pulse & Schedule')
    expect(dashPrompts[2].prompt).toContain('"Store Executive Pulse" (#101)')

    // 4. Stateless [STARTER_PROMPTS_REQUEST] side-request when authenticated
    const capturedBodies: Array<Record<string, unknown>> = []
    const mockExtensionSDK = {
      lookerHostData: { hostUrl: 'https://looker.example.com' },
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const parsed = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        capturedBodies.push(parsed)
        return {
          ok: true,
          status: 200,
          body: {
            id: 'int_starter_84',
            status: 'completed',
            output_text: `<STARTER_PROMPTS>${JSON.stringify([
              {
                id: 'custom-1',
                label: '📊 Net Sales Regional Scorecard',
                prompt: 'Build a Store Transactions Data App on retail_ops::store_transactions with Net Sales and Basket Count by Store Region.',
                useCase: 'app',
              },
              {
                id: 'custom-2',
                label: '📈 Store Transactions Executive UDD',
                prompt: 'Create a native Looker UDD on retail_ops::store_transactions tracking Net Sales across Transaction Month.',
                useCase: 'dashboard',
              },
              {
                id: 'custom-3',
                label: '💬 Top Store Regions by Net Sales',
                prompt: 'Which Store Region in retail_ops::store_transactions had the highest Net Sales last quarter?',
                useCase: 'conversational-analytics',
              },
            ])}</STARTER_PROMPTS>`,
          },
        }
      },
    }

    const agentPrompts = await generateDynamicStarterPrompts({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey', apiKey: 'test-key-84' },
      useCase: 'auto',
      selectedExplores: ['retail_ops::store_transactions'],
      permittedUseCases: ['app', 'dashboard', 'conversational-analytics'],
      availableModels,
      exploreContext: ctx1,
      pollScheduleMs: [0],
    })
    expect(capturedBodies).toHaveLength(1)
    expect(capturedBodies[0].model).toBe(DEFAULT_ANTIGRAVITY_MODEL)
    expect(capturedBodies[0].store).toBe(false)
    expect(capturedBodies[0].background).toBe(false)
    expect(capturedBodies[0].tools).toEqual([])
    expect(capturedBodies[0].previous_interaction_id).toBeUndefined()
    expect(capturedBodies[0].environment).toBeUndefined()
    expect(capturedBodies[0].agent_config).toBeUndefined()
    expect(capturedBodies[0].system_instruction).toContain('Synthesize 3-4 concise, tailored Looker Studio starter prompts')
    expect(capturedBodies[0].generation_config).toEqual({ thinking_level: 'low', max_output_tokens: 1024 })
    expect(capturedBodies[0].response_format).toEqual(STARTER_PROMPTS_RESPONSE_FORMAT)
    const sentInput = (capturedBodies[0].input as Array<{ text?: string }>)[0]?.text || ''
    expect(sentInput).toContain(STARTER_PROMPTS_REQUEST_TAG)
    expect(sentInput).toContain('retail_ops::store_transactions')
    expect(sentInput).toContain('Recent user content (content_summary):')
    expect(sentInput).toContain('Store Executive Pulse')
    expect(agentPrompts.map((p) => p.label)).toEqual([
      'Net Sales Regional Scorecard',
      'Store Transactions Executive UDD',
      'Top Store Regions by Net Sales',
    ])
    expect(
      getCachedStarterPrompts(
        'auto',
        'retail_ops::store_transactions',
        ['app', 'dashboard', 'conversational-analytics'],
        true
      )
    ).toEqual(agentPrompts)

    // Parse fallback safety when malformed output is returned
    expect(parseStarterPromptsResponse('invalid json', localPrompts)).toEqual(localPrompts)
    expect(AGENTS_MD).toContain(STARTER_PROMPTS_REQUEST_TAG)

    // 5. StarterPromptButtons skeleton & loaded states
    type Elem = React.ReactElement<Record<string, unknown>>
    const skelTree = StarterPromptButtons({
      useCase: 'auto',
      prompts: [],
      loading: true,
      onSelect: () => {},
    }) as Elem
    expect(skelTree.props['data-testid']).toBe('studio-starter-prompts-skeleton')

    const loadedTree = StarterPromptButtons({
      useCase: 'auto',
      prompts: agentPrompts,
      loading: false,
      onSelect: () => {},
    }) as Elem
    expect(loadedTree.props['data-testid']).toBe('studio-starter-prompts')
  })

}
