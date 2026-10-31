// Jest visual & DOM snapshot suite for all 5 Studio mini-apps, Config page,
// Explore combobox scroll states, Chat Bar states, and Custom Script Scheduler modal
// using MockLookerExtensionProvider (window.__MOCK_LOOKER_EXTENSION__).
const { execFileSync, spawn } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '../..')
const bundlePath = path.join(repoRoot, 'dist/bundle.js')
const imageSnapshotsDir = path.join(__dirname, '__image_snapshots__')
mkdirSync(imageSnapshotsDir, { recursive: true })

// Tiny 1x1 blue PNG data URL for testing pasted screenshot attachments in the chat bar
const SAMPLE_PASTED_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function buildHtmlPage(scenario) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Agent — Visual Test (${scenario})</title>
  <style>html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }</style>
  <script>
    (function() {
      const scenario = ${JSON.stringify(scenario)};
      const catalogEntries = [
        {
          key: 'user_1_app_42',
          version: 1,
          value: JSON.stringify({
            id: '42',
            type: 'app',
            title: 'Executive Revenue App',
            explores: ['thelook::order_items'],
            updatedAt: '2026-10-30T23:40:00Z',
            createdBy: '1'
          })
        },
        {
          key: 'user_1_dashboard_7',
          version: 1,
          value: JSON.stringify({
            id: '7',
            type: 'dashboard',
            contentType: 'dashboard',
            title: 'Executive Order Performance (Native UDD)',
            embedPath: '/embed/dashboards/7',
            explores: ['thelook::order_items'],
            updatedAt: '2026-10-30T23:39:00Z',
            createdBy: '1'
          })
        },
        {
          key: 'user_1_lookml_20261030_dev_branch',
          version: 1,
          value: JSON.stringify({
            id: '20261030_dev_branch',
            type: 'lookml',
            title: 'Add total_revenue & gross_margin to order_items',
            project_id: 'deploytobarerepo_temp',
            model_name: 'thelook',
            branch_name: 'user dev mode',
            file_count: 2,
            validation_passed: true,
            tests_passed: true,
            updatedAt: '2026-10-30T23:38:00Z',
            createdBy: '1'
          })
        },
        {
          key: 'user_1_health_check_demo',
          version: 1,
          value: JSON.stringify({
            id: 'demo',
            type: 'health',
            title: '3-Pillar Health Check — thelook_event (70%)',
            projectId: 'thelook_event',
            connectionName: 'default_bigquery_connection',
            overallScore: 70,
            grade: 'B- (Optimization Recommended)',
            transcriberScore: 2.86,
            updatedAt: '2026-10-30T23:37:00Z',
            createdBy: '1'
          })
        },
        {
          key: 'user_1_script_demo1',
          version: 1,
          value: JSON.stringify({
            id: 'demo1',
            type: 'tile',
            title: 'Looker Explore & Filter Summary',
            dashboardId: '8',
            elementId: '57',
            updatedAt: '2026-10-30T23:36:00Z',
            createdBy: '1'
          })
        }
      ];

      const artifactObjects = {
        obj_app_42: {
          id: '42',
          type: 'app',
          title: 'Executive Revenue App',
          dashboardId: '42',
          extensionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          explores: ['thelook::order_items'],
          messages: [
            { role: 'user', text: 'Build an Executive Revenue Data App on order_items with Total Revenue, Total Orders, Avg Order Value KPIs and a Monthly Revenue trend chart.' },
            { role: 'assistant', text: 'Built and published Executive Revenue App (Dashboard #42) with 3 KPI cards and a Highcharts monthly trend chart.', dashboardId: '42', widgetCount: 4 }
          ]
        },
        obj_dashboard_7: {
          id: '7',
          type: 'dashboard',
          contentType: 'dashboard',
          title: 'Executive Order Performance (Native UDD)',
          embedPath: '/embed/dashboards/7',
          folderId: '5',
          explores: ['thelook::order_items'],
          studio: {
            explores: ['thelook::order_items'],
            lastInteractionId: 'v1_native_7',
            messages: [
              { role: 'user', text: 'Create a native Looker UDD on order_items with a Total Revenue & Orders KPI, a Revenue by Status column chart, and an Order Status filter.' },
              { role: 'assistant', text: 'Created native Looker Dashboard #7 ("Executive Order Performance") with KPI tile #55 ($14,011,848.92 across 303,454 orders), column chart #56, and Order Status filter #22.', dashboardId: '7', widgetCount: 2 }
            ]
          }
        },
        obj_lookml_20261030_dev_branch: {
          id: '20261030_dev_branch',
          type: 'lookml',
          title: 'Add total_revenue & gross_margin to order_items',
          bundle: {
            id: '20261030_dev_branch',
            title: 'Add total_revenue & gross_margin to order_items',
            project_id: 'deploytobarerepo_temp',
            model_name: 'thelook',
            branch_name: 'user dev mode',
            summary_markdown: '### Agentic LookML Summary\\n- **Target View**: \`bronze/orders.refinement.lkml\`\\n- **Activated Turn Skills**: \`lookml-field-curation\`, \`lookml-tests\`, \`lookml-snapshot\`\\n- **Added Measures**: \`total_revenue\` (\`sum\` of \`\${sale_price}\`), \`gross_margin\` (\`sum\` of \`\${sale_price} - \${cost}\`)\\n- **Validation**: \`validate_project("deploytobarerepo_temp")\` passed with **0 errors** in active user dev mode\\n- **Parity Check**: SQL Runner vs Explore inline query matched 100% across 12 monthly rows.',
            validation: { passed: true, error_count: 0, errors: [] },
            tests: [
              { test_name: 'orders_revenue_non_negative', model_name: 'thelook', file_id: 'tests/bronze/orders.test.lkml', assertions_count: 2, assertions_failed: 0, success: true }
            ],
            queries: [
              { query_index: 0, label: 'Monthly Revenue & Margin Parity', sql_slug: 'sql_9f8e7d6c', explore_slug: 'exp_1a2b3c4d', explore_url: '/x/exp_1a2b3c4d', parity_status: 'matched', row_count_sql: 12, row_count_explore: 12 }
            ],
            files: [
              {
                path: 'bronze/orders.refinement.lkml',
                status: 'modified',
                content: 'include: "orders.view.lkml"\\nview: +orders {\\n  dimension: id { primary_key: yes }\\n  measure: total_revenue { type: sum sql: \${sale_price} ;; value_format_name: usd }\\n  measure: gross_margin { type: sum sql: \${sale_price} - \${cost} ;; value_format_name: usd }\\n}',
                diff: '--- baseline/bronze/orders.refinement.lkml\\n+++ modified/bronze/orders.refinement.lkml\\n@@ -1,3 +1,5 @@\\n include: "orders.view.lkml"\\n view: +orders {\\n   dimension: id { primary_key: yes }\\n+  measure: total_revenue { type: sum sql: \${sale_price} ;; value_format_name: usd }\\n+  measure: gross_margin { type: sum sql: \${sale_price} - \${cost} ;; value_format_name: usd }\\n }'
              },
              {
                path: 'tests/bronze/orders.test.lkml',
                status: 'added',
                content: 'test: orders_revenue_non_negative {\\n  explore_source: order_items { column: total_revenue { field: orders.total_revenue } }\\n  assert: positive_rev { expression: \${orders.total_revenue} > 0 ;; }\\n}',
                diff: '--- /dev/null\\n+++ modified/tests/bronze/orders.test.lkml\\n@@ -0,0 +1,4 @@\\n+test: orders_revenue_non_negative {\\n+  explore_source: order_items { column: total_revenue { field: orders.total_revenue } }\\n+  assert: positive_rev { expression: \${orders.total_revenue} > 0 ;; }\\n+}'
              }
            ]
          },
          studio: {
            explores: ['thelook::order_items'],
            lastInteractionId: 'v1_lookml_1',
            messages: [
              { role: 'user', text: 'Add total_revenue and gross_margin measures to orders refinement, curate field descriptions, add a LookML data test, and verify SQL vs Explore parity.' },
              { role: 'assistant', text: 'Used active user dev mode workspace, updated bronze/orders.refinement.lkml, added tests/bronze/orders.test.lkml, verified 0 LookML validation errors, and confirmed 12/12 row parity.' }
            ]
          }
        },
        obj_health_check_demo: {
          id: 'demo',
          type: 'health_check',
          title: '3-Pillar Health Check TDD — thelook_event (70%)',
          projectId: 'thelook_event',
          connectionName: 'default_bigquery_connection',
          scores: {
            overallScore: 70,
            grade: 'B- (Optimization Recommended)',
            pillar1Score: 80,
            pillar2Score: 72,
            pillar3Score: 58,
            transcriberScore: 2.86,
            transcriberClassification: 'Class B — Production Stable (Targeted Refactoring)'
          },
          tddMarkdown: [
            '# Technical Design Document (TDD): Looker & BigQuery 3-Pillar Health Check',
            '> **Target LookML Project:** \`thelook_event\` | **BigQuery Connection:** \`default_bigquery_connection\` (\`looker-private-demo.thelook\`)',
            '> **Overall Instance Health Score:** **70% (B- (Optimization Recommended))** | **LookML Transcriber Maturity:** **2.86 / 4.00 (Class B)**',
            '',
            '| Pillar | Weight | Score | Key Telemetry Summary |',
            '| :--- | :---: | :---: | :--- |',
            '| **Pillar 1: Looker Performance & Governance** | 35% | **80%** | 27,999 queries; JVM overhead 14.67%; DB avg 0.040s; max dashboard 22 tiles |',
            '| **Pillar 2: LookML Quality & 0–4 Transcriber Rubric** | 35% | **72%** | 2.86/4.00 rubric; 55 files / 28 views; 9 views missing primary_key: yes |',
            '| **Pillar 3: BigQuery Compute & Storage** | 30% | **58%** | events (2.89M rows / 507.5 MB) and order_items (303K rows / 21.3 MB) unpartitioned |',
            '',
            '## 1. Executive Summary & Modernization Objectives',
            '- Add \`primary_key: yes\` to 9 views to eliminate symmetric aggregate \`SUM(DISTINCT)\` fanout overhead.',
            '- Partition \`looker-private-demo.thelook.events\` and \`order_items\` by \`DATE(created_at)\` and cluster by \`status, user_id\`.'
          ].join('\\n'),
          telemetry: {},
          messages: [
            { role: 'user', text: 'Run a full 3-pillar Looker & BigQuery health check on thelook_event.' },
            { role: 'assistant', text: 'Completed 3-Pillar Health Check for thelook_event (Overall Score: 70% B-, Transcriber: 2.86/4.00). Synthesized 7-section TECHNICAL_DESIGN_DOCUMENT.md.' }
          ],
          updatedAt: '2026-10-30T23:37:00Z',
          createdBy: '1'
        },
        obj_script_demo1: {
          id: 'demo1',
          title: 'Looker Explore & Filter Summary',
          code: 'return [\\n  {"model": "thelook", "label": "eCommerce", "mode": mode, "visible_explores": 11, "first_explore": "order_items", "filter_status": dashboard_filters.get("status", "Complete")},\\n  {"model": "agentic_thelook", "label": "Agentic Thelook", "mode": mode, "visible_explores": 24, "first_explore": "order_shards", "filter_status": dashboard_filters.get("status", "Complete")}\\n]',
          dashboardId: '8',
          elementId: '57',
          updatedAt: '2026-10-30T23:36:00Z',
          messages: [
            { role: 'user', text: 'Write a CodeMode script summarizing LookML models and active dashboard filters.' },
            { role: 'assistant', text: 'Published Dashboard #8 (load_configuration="wait", layout="extension") and bound tile_element_57 -> demo1.' }
          ]
        },
        tile_element_57: {
          scriptId: 'demo1',
          title: 'Looker Explore & Filter Summary',
          code: 'return [\\n  {"model": "thelook", "label": "eCommerce", "visible_explores": 11, "first_explore": "order_items", "filter_status": dashboard_filters.get("status", "Complete")},\\n  {"model": "agentic_thelook", "label": "Agentic Thelook", "visible_explores": 24, "first_explore": "order_shards", "filter_status": dashboard_filters.get("status", "Complete")}\\n]',
          updatedAt: '2026-10-30T23:36:00Z'
        },
        'user_conversations:1': [
          {
            id: 'conv_app_42',
            type: 'app',
            interactionId: 'v1_app_42',
            environmentId: 'env_42',
            content: { dashboardId: '42', appArtifactId: 'obj_app_42' },
            label: 'Executive Revenue App',
            createdAt: '2026-10-30T23:00:00Z',
            updatedAt: '2026-10-30T23:40:00Z',
            explores: ['thelook::order_items'],
            messages: [
              { role: 'user', text: 'Build an Executive Revenue Data App on order_items with Total Revenue, Total Orders, Avg Order Value KPIs and a Monthly Revenue trend chart.' },
              { role: 'assistant', text: 'Built and published Executive Revenue App (Dashboard #42) with 3 KPI cards and a Highcharts monthly trend chart.', dashboardId: '42', widgetCount: 4 }
            ]
          },
          {
            id: 'conv_dashboard_7',
            type: 'dashboard',
            interactionId: 'v1_native_7',
            environmentId: 'env_dashboard_7',
            content: { dashboardId: '7', contentType: 'dashboard', embedPath: '/embed/dashboards/7' },
            label: 'Executive Order Performance (Native UDD)',
            createdAt: '2026-10-30T22:50:00Z',
            updatedAt: '2026-10-30T23:39:00Z',
            explores: ['thelook::order_items'],
            messages: [
              { role: 'user', text: 'Create a native Looker UDD on order_items with a Total Revenue & Orders KPI, a Revenue by Status column chart, and an Order Status filter.' },
              { role: 'assistant', text: 'Created native Looker Dashboard #7 ("Executive Order Performance") with KPI tile #55 ($14,011,848.92 across 303,454 orders), column chart #56, and Order Status filter #22.', dashboardId: '7', widgetCount: 2 }
            ]
          },
          {
            id: 'conv_lookml_20261030_dev_branch',
            type: 'lookml',
            interactionId: 'v1_lookml_1',
            environmentId: 'env_lookml_20261030_dev_branch',
            content: { sessionId: '20261030_dev_branch', projectId: 'deploytobarerepo_temp', branch: 'user dev mode' },
            label: 'Add total_revenue & gross_margin to order_items',
            createdAt: '2026-10-30T22:40:00Z',
            updatedAt: '2026-10-30T23:38:00Z',
            explores: ['thelook::order_items']
          },
          {
            id: 'conv_health_demo',
            type: 'health-check',
            interactionId: 'v1_health_demo',
            environmentId: 'env_health_demo',
            content: { reportId: 'demo', projectId: 'thelook_event', overallScore: 70 },
            label: '3-Pillar Health Check — thelook_event (70%)',
            createdAt: '2026-10-30T22:30:00Z',
            updatedAt: '2026-10-30T23:37:00Z'
          },
          {
            id: 'conv_tile_demo1',
            type: 'tile',
            interactionId: 'v1_tile_demo1',
            environmentId: 'env_tile_isolated',
            content: { scriptId: 'demo1', dashboardId: '8', elementId: '57' },
            label: 'Looker Explore & Filter Summary',
            createdAt: '2026-10-30T22:20:00Z',
            updatedAt: '2026-10-30T23:36:00Z'
          }
        ]
      };

      const routeMap = {
        data_app: '/app/42',
        dashboard: '/dashboard/7',
        lookml: '/lookml/20261030_dev_branch',
        health_check: '/health-check/demo',
        python_tile_studio: '/tile/demo1',
        tile_mount_view: '/app',
        tile_mount_edit: '/app',
        config_page: '/config',
        explore_dropdown_open_top: '/app/42',
        explore_dropdown_scrolled: '/app/42',
        chatbar_lookml_skills: '/lookml',
        chatbar_pasted_image_inspector: '/app/42',
        chatbar_busy_running: '/app/42',
        chatbar_error_banner: '/app',
        python_tile_scheduler_modal: '/tile/demo1'
      };

      const isTile = scenario === 'tile_mount_view' || scenario === 'tile_mount_edit';

      const mockCore40SDK = {
        ok: async (p) => p,
        me: async () => ({ id: '1', display_name: 'Bryan Weber', personal_folder_id: '5' }),
        all_lookml_models: async () => [
          {
            name: 'bigquery_information_schema',
            label: 'BigQuery Information Schema (Block)',
            explores: [
              { name: 'jobs_timeline', label: 'Jobs Timeline by Project', hidden: false },
              { name: 'table_storage', label: 'Table Storage & Partitions', hidden: false },
              { name: 'streaming_timeline', label: 'Streaming Buffer Usage', hidden: false }
            ]
          },
          {
            name: 'thelook',
            label: 'eCommerce',
            explores: [
              { name: 'order_items', label: 'Order Items', hidden: false },
              { name: 'users', label: 'Users', hidden: false },
              { name: 'inventory_items', label: 'Inventory Items', hidden: false },
              { name: 'events', label: 'Web Events & Funnel', hidden: false }
            ]
          },
          {
            name: 'retail_ops',
            label: 'Retail Operations',
            explores: [
              { name: 'store_transactions', label: 'Store Transactions', hidden: false },
              { name: 'supply_chain_shipments', label: 'Supply Chain Shipments', hidden: false },
              { name: 'warehouse_stock', label: 'Warehouse Stock Levels', hidden: false }
            ]
          },
          {
            name: 'system__activity',
            label: 'System Activity',
            explores: [
              { name: 'history', label: 'History', hidden: false },
              { name: 'query_metrics', label: 'Query Metrics', hidden: false },
              { name: 'scheduled_plan', label: 'Scheduled Plans', hidden: false },
              { name: 'dashboard', label: 'Dashboards & Elements', hidden: false }
            ]
          }
        ],
        lookml_model_explore: async (modelName, exploreName) => ({
          id: modelName + '::' + exploreName,
          name: exploreName,
          label: 'Order Items',
          model_name: modelName,
          fields: {
            dimensions: [
              { name: 'order_items.id', label_short: 'ID', type: 'number' },
              { name: 'order_items.status', label_short: 'Status', type: 'string' },
              { name: 'order_items.created_month', label_short: 'Created Month', type: 'date_month' }
            ],
            measures: [
              { name: 'order_items.total_sale_price', label_short: 'Total Sale Price', type: 'sum' },
              { name: 'order_items.count', label_short: 'Order Count', type: 'count' }
            ]
          }
        }),
        all_folders: async () => [
          { id: '5', name: 'Bryan Weber (Personal)' },
          { id: '1', name: 'Shared' }
        ],
        search_artifacts: async (params) => {
          const pattern = String((params && params.key) || '');
          if (pattern.startsWith('user_1_dashboard_')) {
            return catalogEntries.filter((e) => e.key.startsWith('user_1_dashboard_'));
          }
          if (pattern.startsWith('user_1_lookml_')) {
            return catalogEntries.filter((e) => e.key.startsWith('user_1_lookml_'));
          }
          if (pattern.startsWith('user_1_script_') || pattern.startsWith('obj_script_')) {
            return [
              {
                key: 'obj_script_demo1',
                version: 1,
                value: JSON.stringify(artifactObjects.obj_script_demo1)
              }
            ];
          }
          return catalogEntries;
        },
        artifact: async (params) => {
          const keys = String((params && params.key) || '').split(',').map((s) => s.trim()).filter(Boolean);
          const out = [];
          for (const k of keys) {
            if (artifactObjects[k]) {
              out.push({ key: k, version: 1, value: JSON.stringify(artifactObjects[k]) });
            } else {
              const found = catalogEntries.find((e) => e.key === k);
              if (found) out.push(found);
            }
          }
          return out;
        },
        update_artifacts: async (_ns, updates) => {
          window.__ARTIFACT_UPDATES__ = window.__ARTIFACT_UPDATES__ || [];
          for (const u of updates || []) {
            window.__ARTIFACT_UPDATES__.push(u);
            try {
              const parsed = typeof u.value === 'string' ? JSON.parse(u.value) : u.value;
              artifactObjects[u.key] = parsed;
              if (u.key.startsWith('user_1_') && !u.key.startsWith('user_conversations:')) {
                const idx = catalogEntries.findIndex((e) => e.key === u.key);
                const entry = { key: u.key, version: 1, value: typeof u.value === 'string' ? u.value : JSON.stringify(u.value) };
                if (idx >= 0) catalogEntries[idx] = entry;
                else catalogEntries.unshift(entry);
              }
            } catch {}
          }
          return [];
        },
        delete_artifact: async () => ({}),
        dashboard: async (id) => {
          if (String(id) === '7') {
            return {
              id: '7',
              title: 'Executive Order Performance (Native UDD)',
              folder: { id: '5' },
              dashboard_elements: [{ id: '55' }, { id: '56' }]
            };
          }
          return {
            id: '42',
            title: 'Executive Revenue App',
            folder: { id: '5' },
            dashboard_elements: [
              {
                id: '101',
                type: 'extension',
                extension_id: 'db::a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                rich_content_json: JSON.stringify({
                  queries: { 'da-kpi-rev': 'q1', 'da-kpi-orders': 'q2', 'da-chart-trend': 'q3' },
                  data_app_studio: {
                    explores: ['thelook::order_items'],
                    lastInteractionId: 'v1_app_42',
                    environmentId: 'env_42',
                    messages: artifactObjects.obj_app_42.messages
                  }
                })
              }
            ],
            dashboard_layouts: [{ id: '201', type: 'extension', active: true }]
          };
        },
        authSession: {
          transport: {
            rawRequest: async (method, reqPath, queryParams) => {
              if (reqPath.includes('inline_extension')) {
                return {
                  ok: true,
                  statusCode: 200,
                  body: '// Executive Revenue App Lit Bundle\\nimport { DataApp, html } from "/runtime/data-app.js";\\nexport class ExecutiveRevenueApp extends DataApp {}\\n'
                };
              }
              if (reqPath.includes('/artifacts/') && reqPath.endsWith('/search')) {
                const items = await mockCore40SDK.search_artifacts(queryParams || {});
                return { ok: true, statusCode: 200, body: JSON.stringify(items) };
              }
              if (reqPath.includes('/artifacts/')) {
                const pathParts = reqPath.split('/').filter(Boolean);
                const lastSeg = decodeURIComponent(pathParts[pathParts.length - 1] || '');
                const key = (queryParams && queryParams.key) || lastSeg;
                const items = await mockCore40SDK.artifact({ key });
                return { ok: true, statusCode: 200, body: JSON.stringify(items) };
              }
              return {
                ok: true,
                statusCode: 200,
                body: JSON.stringify({ method, path: reqPath })
              };
            }
          }
        }
      };

      let savedContextData = {
        authMode: 'oauth',
        clientId: 'looker-data-app-studio.apps.googleusercontent.com',
        projectId: 'looker-private-demo',
        disabledModes: []
      };

      const mockExtensionSDK = {
        lookerHostData: {
          hostUrl: 'https://dev-argolis.looker.com',
          extensionId: 'data_app_builder::data_app_builder',
          mountType: isTile ? 'dashboard_tile' : 'standalone'
        },
        getContextData: () => savedContextData,
        saveContextData: async (ctx) => {
          savedContextData = { ...savedContextData, ...ctx };
          window.__LAST_SAVED_CONTEXT_DATA__ = savedContextData;
          return savedContextData;
        },
        openBrowserWindow: () => {},
        rendered: () => {},
        updateTitle: () => {},
        serverProxy: async (url, init) => {
          window.__INTERACTION_CALLS__ = window.__INTERACTION_CALLS__ || [];
          const body = init && init.body ? JSON.parse(init.body) : undefined;
          window.__INTERACTION_CALLS__.push({ url, method: (init && init.method) || 'GET', body });
          const inputText = (body && body.input && body.input[0] && body.input[0].text) || '';
          if (inputText.includes('[CONVERSATION_LABEL_REQUEST]')) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_label_99',
                status: 'completed',
                output_text: '"Quarterly Order Margin Analysis."'
              })
            };
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_turn1_main',
              environment_id: 'env_dashboard_isolated',
              status: 'completed',
              output_text: 'Created native Looker Dashboard #99 with KPI and trend tiles.\\n<NATIVE_CONTENT_BUNDLE>{"id":"99","content_type":"dashboard","title":"Draft Dashboard 99","folder_id":"5","tile_count":2,"explores":["thelook::order_items"]}</NATIVE_CONTENT_BUNDLE>'
            })
          };
        }
      };

      window.__MOCK_LOOKER_EXTENSION__ = {
        initialRoute: routeMap[scenario] || '/app/42',
        initialPendingPerm: scenario === 'data_app' ? {
          operation: 'create_dashboard',
          httpMethod: 'POST',
          path: '/api/4.0/dashboards',
          args: { title: 'Executive Revenue App', folder_id: '5' }
        } : undefined,
        initialComboOpen:
          scenario === 'explore_dropdown_open_top' || scenario === 'explore_dropdown_scrolled',
        initialExploreScrollTop: scenario === 'explore_dropdown_scrolled' ? 140 : 0,
        initialPrompt:
          scenario === 'chatbar_pasted_image_inspector'
            ? 'Match the layout in this screenshot and add a gross margin breakdown.'
            : scenario === 'chatbar_lookml_skills'
            ? 'Curate descriptions on order_items, generate assert data tests, and capture a LookML parity snapshot.'
            : '',
        initialPastedImages:
          scenario === 'chatbar_pasted_image_inspector'
            ? [
                {
                  mimeType: 'image/png',
                  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                  dataUrl: ${JSON.stringify(SAMPLE_PASTED_IMAGE_DATA_URL)}
                }
              ]
            : [],
        initialInspectorOpen: scenario === 'chatbar_pasted_image_inspector',
        initialBusyStatus:
          scenario === 'chatbar_busy_running'
            ? 'Executing LkrCodeMode Monty Python & validating Looker queries...'
            : null,
        initialError:
          scenario === 'chatbar_error_banner'
            ? 'Looker API Error (422): Field "order_items.unknown_metric" not found in explore "thelook::order_items".'
            : null,
        openSchedulerModal: scenario === 'python_tile_scheduler_modal',
        extensionSDK: mockExtensionSDK,
        core40SDK: mockCore40SDK,
        lookerHostData: mockExtensionSDK.lookerHostData,
        tileHostData: isTile ? {
          elementId: '57',
          dashboardId: '8',
          isDashboardEditing: scenario === 'tile_mount_edit',
          dashboardRunState: 'RUNNING',
          dashboardFilters: { status: 'Complete', model: 'thelook' }
        } : undefined,
        getMockPreviewHtml: (mode) => {
          if (mode === 'dashboard') {
            return \`<!DOCTYPE html><html><body style="font-family:Inter,system-ui,sans-serif;margin:0;padding:24px;background:#f8fafc;color:#0f172a;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <div>
                  <span style="background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;">LOOKER NATIVE UDD #7</span>
                  <h2 style="margin:6px 0 0;font-size:20px;">Executive Order Performance (Native UDD via CodeMode)</h2>
                </div>
                <div style="background:#fff;border:1px solid #cbd5e1;padding:6px 12px;border-radius:6px;font-size:12px;">Filter: <strong>Order Status = Any</strong></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px;">
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                  <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;">Tile #55 · Total Revenue & Orders KPI</div>
                  <div style="font-size:34px;font-weight:800;color:#0f172a;margin-top:12px;">$14,011,848.92</div>
                  <div style="font-size:14px;color:#059669;margin-top:6px;font-weight:600;">303,454 Total Orders (thelook::order_items)</div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                  <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:12px;">Tile #56 · Revenue & Orders by Status (looker_column)</div>
                  <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
                    <div><div style="display:flex;justify-content:space-between;"><span>Complete (289,494)</span><strong>$13,366,666.37</strong></div><div style="height:10px;background:#2563eb;width:95%;border-radius:4px;margin-top:3px;"></div></div>
                    <div><div style="display:flex;justify-content:space-between;"><span>Cancelled (7,789)</span><strong>$362,803.49</strong></div><div style="height:10px;background:#f59e0b;width:18%;border-radius:4px;margin-top:3px;"></div></div>
                    <div><div style="display:flex;justify-content:space-between;"><span>Returned (3,004)</span><strong>$135,824.96</strong></div><div style="height:10px;background:#ef4444;width:10%;border-radius:4px;margin-top:3px;"></div></div>
                  </div>
                </div>
              </div>
            </body></html>\`;
          }
          return \`<!DOCTYPE html><html><body style="font-family:Inter,system-ui,sans-serif;margin:0;padding:24px;background:#0f172a;color:#f8fafc;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
              <div>
                <span style="background:#1e3a8a;color:#93c5fd;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;">LIT DATA APP · db::a1b2c3d4</span>
                <h2 style="margin:6px 0 0;font-size:20px;">Executive Revenue App (Dashboard #42)</h2>
              </div>
              <span style="font-size:12px;color:#94a3b8;">Explore: thelook::order_items</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px;">
              <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;"><div style="font-size:11px;color:#94a3b8;">TOTAL REVENUE</div><div style="font-size:26px;font-weight:700;margin-top:6px;color:#38bdf8;">$14.01M</div><div style="font-size:11px;color:#4ade80;margin-top:4px;">▲ +18.4% YoY</div></div>
              <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;"><div style="font-size:11px;color:#94a3b8;">TOTAL ORDERS</div><div style="font-size:26px;font-weight:700;margin-top:6px;color:#f8fafc;">303,454</div><div style="font-size:11px;color:#4ade80;margin-top:4px;">▲ +12.1% YoY</div></div>
              <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;"><div style="font-size:11px;color:#94a3b8;">AVG ORDER VALUE</div><div style="font-size:26px;font-weight:700;margin-top:6px;color:#a78bfa;">$46.17</div><div style="font-size:11px;color:#4ade80;margin-top:4px;">▲ +5.6% YoY</div></div>
            </div>
            <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:18px;">
              <div style="font-size:12px;color:#94a3b8;margin-bottom:12px;">MONTHLY REVENUE TREND (HIGHCHARTS LIT COMPONENT)</div>
              <div style="display:flex;align-items:flex-end;gap:10px;height:140px;padding-top:10px;">
                <div style="flex:1;background:#38bdf8;height:45%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:52%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:60%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:58%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:72%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:85%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:95%;border-radius:4px 4px 0 0;"></div>
              </div>
            </div>
          </body></html>\`;
        }
      };
    })();
  </script>
</head>
<body>
  <script src="/bundle.js"></script>
</body>
</html>`
}

// Minimal Chrome DevTools Protocol client over built-in WebSocket (ponytail: zero extra npm packages).
async function startHeadlessChrome() {
  const proc = spawn(
    '/usr/bin/google-chrome',
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      '--no-first-run',
      '--disable-background-networking',
      '--hide-scrollbars',
      '--window-size=1440,900',
      '--remote-debugging-port=0',
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )

  const wsBrowserUrl = await new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`Chrome startup timeout: ${stderr}`)), 10000)
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
  })

  const httpBase = wsBrowserUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '')
  const targets = await fetch(`${httpBase}/json/list`).then((r) => r.json())
  const pageTarget = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let msgId = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const data = JSON.parse(String(ev.data))
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id)
      pending.delete(data.id)
      if (data.error) reject(new Error(data.error.message))
      else resolve(data.result)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  })

  return {
    send,
    close: () => {
      try {
        ws.close()
      } catch {}
      proc.kill('SIGKILL')
    }
  }
}

describe('Agent — Mini-App, Config, Dropdown & Chat Bar Visual Snapshot Suite', () => {
  let server
  let port
  let chrome

  beforeAll(async () => {
    expect(existsSync(bundlePath)).toBe(true)
    const bundleContent = readFileSync(bundlePath)
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/bundle.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
        res.end(bundleContent)
        return
      }
      const scenario = url.searchParams.get('scenario') || 'data_app'
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(buildHtmlPage(scenario))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = server.address().port
    chrome = await startHeadlessChrome()
  }, 20000)

  afterAll(async () => {
    if (chrome) chrome.close()
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }

    // Write manifest.json recording which image snapshots are modified/untracked in git vs committed
    try {
      const gitOut = execFileSync(
        'git',
        ['status', '--porcelain', 'src/__tests__/__image_snapshots__'],
        { cwd: repoRoot, encoding: 'utf8' }
      )
      const changedFiles = new Set(
        gitOut
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => path.basename(line.slice(3).trim()))
      )
      const manifest = scenarios.map((s) => ({
        id: s.id,
        category: s.category,
        title: s.title,
        snapshotName: s.snapshotName,
        changedInGit: changedFiles.has(s.snapshotName)
      }))
      writeFileSync(
        path.join(imageSnapshotsDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      )
    } catch {}
  })

  const scenarios = [
    {
      id: 'data_app',
      category: 'Mini-App Modes',
      title: '1. Data App Mode + Inline Mutation Permission Gate',
      snapshotName: '01-mode-data-app-and-permission-gate-snap.png',
      expectText: [
        'Agent',
        'Agentic LookML',
        'Data App',
        'Content Studio',
        'LookML',
        'Health Check',
        'Python Tile',
        'Safe Mode (Ask)',
        'My Creations (5)',
        'Approve Looker State Mutation?',
        'create_dashboard',
        'Executive Revenue App',
        '✨ Update App'
      ]
    },
    {
      id: 'dashboard',
      category: 'Mini-App Modes',
      title: '2. Content Studio Mode (Create & Update UDDs, Looks, Boards, Schedules)',
      snapshotName: '02-mode-native-dashboard-builder-snap.png',
      expectText: [
        'Content Studio',
        'Executive Order Performance (Native UDD)',
        '/embed/dashboards/7',
        '✨ Update Content'
      ]
    },
    {
      id: 'lookml',
      category: 'Mini-App Modes',
      title: '3. Agentic LookML Mode (Turn Skills, Active User Dev Mode & .lkml Diffs)',
      snapshotName: '03-mode-agentic-lookml-snap.png',
      expectText: [
        'Add total_revenue & gross_margin to order_items',
        '⎇ user dev mode',
        '✓ LookML Validator Passed',
        'run_lookml_test (1/1 passed)',
        'TURN SKILLS:',
        '📝 Descriptions & Curation',
        '🧪 Data Tests (.test.lkml)',
        '📸 Snapshot & Parity',
        'bronze/orders.refinement.lkml',
        '✨ Update LookML'
      ]
    },
    {
      id: 'health_check',
      category: 'Mini-App Modes',
      title: '4. 3-Pillar Health Check Mode (Rendered Markdown Viewer & Top-Right Gemini Button)',
      snapshotName: '04-mode-3-pillar-health-check-snap.png',
      expectText: [
        '✨ Run 3-Pillar Audit',
        'All 3 Pillars (Looker + BQ)',
        'Health Score: 70% (B- (Optimization Recommended))',
        'Transcriber: 2.86/4.00',
        'Technical Design Document (TDD): Looker & BigQuery 3-Pillar Health Check',
        '{ } Raw Markdown',
        'Copy Markdown',
        '✨ Download Markdown (.md)'
      ]
    },
    {
      id: 'python_tile_studio',
      category: 'Mini-App Modes',
      title: '5. Python Tile Studio Mode (Mode Selector, Schedule Script & Live Grid)',
      snapshotName: '05-mode-python-tile-studio-snap.png',
      expectText: [
        'Looker Explore & Filter Summary',
        '⏰ Schedule Script',
        '✨ Publish Dashboard',
        '✨ Run Python',
        '✨ Ask AI',
        '⏰ Scheduled: 0 8 * * * · summary',
        'agentic_thelook'
      ]
    },
    {
      id: 'tile_mount_view',
      category: 'Tile & Scheduler Modal',
      title: '6. Dashboard Tile Mount — View Mode',
      snapshotName: '06-dashboard-tile-mount-view-mode-snap.png',
      expectText: ['thelook', 'eCommerce', 'agentic_thelook', 'Complete']
    },
    {
      id: 'tile_mount_edit',
      category: 'Tile & Scheduler Modal',
      title: '7. Dashboard Tile Mount — Edit Mode',
      snapshotName: '07-dashboard-tile-mount-edit-mode-snap.png',
      expectText: [
        'CodeMode Python Tile Configuration',
        'Tile #57',
        'Looker Explore & Filter Summary (demo1)'
      ]
    },
    {
      id: 'config_page',
      category: 'Config & Explore Dropdown',
      title: '8. Extension Auth & Vertex Setup Page (/config)',
      snapshotName: '08-config-page-setup-snap.png',
      expectText: [
        'Agent',
        'Agentic LookML',
        'Configuration',
        'Agent & Vertex / Gemini Setup',
        'Google OAuth',
        '✨ Save Setup'
      ]
    },
    {
      id: 'explore_dropdown_open_top',
      category: 'Config & Explore Dropdown',
      title: '9. Explore Combobox Dropdown — Open (Top Scroll State)',
      snapshotName: '09-explore-dropdown-open-top-snap.png',
      expectText: [
        'Clear selection (let agent decide)',
        'BIGQUERY INFORMATION SCHEMA (BLOCK)',
        'Jobs Timeline by Project',
        'Table Storage & Partitions',
        'ECOMMERCE',
        'Order Items'
      ]
    },
    {
      id: 'explore_dropdown_scrolled',
      category: 'Config & Explore Dropdown',
      title: '10. Explore Combobox Dropdown — Scrolled State (Retail Ops & System Activity)',
      snapshotName: '10-explore-dropdown-scrolled-snap.png',
      expectText: [
        'RETAIL OPERATIONS',
        'Store Transactions',
        'Supply Chain Shipments',
        'SYSTEM ACTIVITY',
        'Query Metrics'
      ]
    },
    {
      id: 'chatbar_lookml_skills',
      category: 'Chat Bar States',
      title: '11. Chat Bar State — LookML Activated Turn Skills & Prompt',
      snapshotName: '11-chatbar-state-lookml-activated-skills-snap.png',
      expectText: [
        'TURN SKILLS:',
        '✓ 📝 Descriptions & Curation',
        '✓ 🧪 Data Tests (.test.lkml)',
        '✓ 📸 Snapshot & Parity',
        '+ 🧱 Bronze View',
        '✨ Run Agentic LookML'
      ]
    },
    {
      id: 'chatbar_pasted_image_inspector',
      category: 'Chat Bar States',
      title: '12. Chat Bar State — Pasted Screenshot Thumbnail & Code/Schema Inspector Open',
      snapshotName: '12-chatbar-state-pasted-image-and-inspector-snap.png',
      expectText: [
        'Inspect Code / Schema',
        'Compiled Explore Schema (/workspace/schema.md)',
        'Test WASM Code Mode (Monty)',
        '✨ Update App'
      ]
    },
    {
      id: 'chatbar_busy_running',
      category: 'Chat Bar States',
      title: '13. Chat Bar State — Busy / Running Spinner Banner',
      snapshotName: '13-chatbar-state-busy-running-snap.png',
      expectText: [
        'Executing LkrCodeMode Monty Python & validating Looker queries...',
        'Executive Revenue App'
      ]
    },
    {
      id: 'chatbar_error_banner',
      category: 'Chat Bar States',
      title: '14. Chat Bar State — Error Diagnostic Banner',
      snapshotName: '14-chatbar-state-error-banner-snap.png',
      expectText: [
        'Error',
        'Looker API Error (422): Field "order_items.unknown_metric" not found in explore "thelook::order_items".'
      ]
    },
    {
      id: 'python_tile_scheduler_modal',
      category: 'Tile & Scheduler Modal',
      title: '15. Custom CodeMode Script Scheduler Modal (Cron, vars.mode & Custom Controls)',
      snapshotName: '15-python-tile-scheduler-modal-snap.png',
      expectText: [
        '⏰ Custom CodeMode Script Scheduler',
        'obj_schedule_demo1',
        'Daily at 8:00 AM (0 8 * * *)',
        'Script Execution Mode (`vars.mode`)',
        'Custom Controls / Non-Query Variables (`vars.custom_controls` JSON)',
        '✨ Save Script Schedule'
      ]
    }
  ]

  let testCount = 0
  test.each(scenarios)(
    'renders $id ($title) with MockLookerExtensionProvider and matches DOM & image snapshots',
    async ({ id, snapshotName, expectText }) => {
      testCount += 1
      if (testCount % 7 === 0) {
        chrome.close()
        chrome = await startHeadlessChrome()
      }
      const url = `http://127.0.0.1:${port}/?scenario=${encodeURIComponent(id)}`
      await chrome.send('Page.navigate', { url })

      let pageState = null
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const evalRes = await chrome.send('Runtime.evaluate', {
          expression: `(() => {
            const href = window.location.href;
            const text = document.body ? document.body.innerText : '';
            const tabs = Array.from(document.querySelectorAll('.dab-mode-tab')).map((el) => ({
              label: (el.textContent || '').trim(),
              active: el.classList.contains('active')
            }));
            const dd = document.querySelector('.dab-dropdown');
            if (dd && window.__MOCK_LOOKER_EXTENSION__ && typeof window.__MOCK_LOOKER_EXTENSION__.initialExploreScrollTop === 'number') {
              dd.scrollTop = window.__MOCK_LOOKER_EXTENSION__.initialExploreScrollTop;
            }
            return {
              href,
              text,
              tabs,
              dropdownScrollTop: dd ? dd.scrollTop : null
            };
          })()`,
          returnByValue: true
        })
        pageState = evalRes.result && evalRes.result.value
        if (
          pageState &&
          String(pageState.text || '').includes('pmhkaepabdniocnppdkfgifgonahhpdi')
        ) {
          chrome.close()
          chrome = await startHeadlessChrome()
          await chrome.send('Page.navigate', { url })
          await new Promise((r) => setTimeout(r, 250))
          continue
        }
        if (pageState && expectText.every((t) => pageState.text.includes(t))) {
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      for (const expected of expectText) {
        expect(pageState.text).toContain(expected)
      }

      // 1. Jest DOM/State snapshot stored in src/__tests__/__snapshots__/miniApps.visual.test.js.snap
      expect({
        scenario: id,
        modeTabs: pageState.tabs,
        dropdownScrollTop: pageState.dropdownScrollTop,
        verifiedVisibleText: expectText
      }).toMatchSnapshot()

      // 2. Visual PNG snapshot stored in src/__tests__/__image_snapshots__/<snapshotName>
      const { data } = await chrome.send('Page.captureScreenshot', { format: 'png' })
      const pngBuffer = Buffer.from(data, 'base64')
      expect(pngBuffer.length).toBeGreaterThan(5000)

      const snapshotPath = path.join(imageSnapshotsDir, snapshotName)
      writeFileSync(snapshotPath, pngBuffer)
      expect(existsSync(snapshotPath)).toBe(true)
    },
    15000
  )

  test('enables/disables individual tool modes via /config and filters topbar tabs, catalog & routes', async () => {
    const url = `http://127.0.0.1:${port}/?scenario=config_page`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="config-mode-toggle-lookml"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    // Disable LookML, Health Check, and Python Tile, then click Save Setup
    const afterSave = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        for (const m of ['lookml', 'health', 'tile']) {
          const cb = document.querySelector('[data-testid="config-mode-toggle-' + m + '"]');
          if (cb) cb.click();
        }
        await new Promise((r) => setTimeout(r, 50));
        const saveBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          (b.textContent || '').includes('Save Setup')
        );
        if (saveBtn) saveBtn.click();
        await new Promise((r) => setTimeout(r, 150));
        const tabs = Array.from(document.querySelectorAll('.dab-mode-tab')).map((el) =>
          (el.textContent || '').trim()
        );
        const text = document.body ? document.body.innerText : '';
        // Navigate to disabled route /lookml and verify redirect back to first enabled mode (/app)
        window.__DAB_STUDIO__.history.push('/lookml/20261030_dev_branch');
        await new Promise((r) => setTimeout(r, 100));
        const activeAfterDisabledPush = (
          document.querySelector('.dab-mode-tab.active')?.textContent || ''
        ).trim();
        // Disable 'dashboard' too so only 1 mode ('app') remains -> mode switcher hides
        window.__DAB_STUDIO__.setDisabledModes(['dashboard', 'lookml', 'health', 'tile']);
        await new Promise((r) => setTimeout(r, 100));
        const switcherHiddenWhenSingleMode = !document.querySelector('.dab-mode-switcher');
        return {
          savedDisabledModes: window.__LAST_SAVED_CONTEXT_DATA__?.disabledModes || [],
          tabs,
          hasFilteredCatalogCount: text.includes('My Creations (2)'),
          activeAfterDisabledPush,
          switcherHiddenWhenSingleMode
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(afterSave.result.value).toEqual({
      savedDisabledModes: ['lookml', 'health', 'tile'],
      tabs: ['Data App', 'Content Studio'],
      hasFilteredCatalogCount: true,
      activeAfterDisabledPush: 'Data App',
      switcherHiddenWhenSingleMode: true
    })
  }, 15000)

  test('switches Antigravity models via config-default-model-select and topbar-model-select and persists defaultModel', async () => {
    const url = `http://127.0.0.1:${port}/?scenario=config_page`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="config-default-model-select"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const configSelect = document.querySelector('[data-testid="config-default-model-select"]');
        const initialDefault = configSelect ? configSelect.value : '';
        const optionIds = configSelect ? Array.from(configSelect.options).map((o) => o.value) : [];

        const setReactSelect = (sel, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, val);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setReactSelect(configSelect, 'gemini-4-argon');
        await new Promise((r) => setTimeout(r, 50));

        const saveBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          (b.textContent || '').includes('Save Setup')
        );
        if (saveBtn) saveBtn.click();
        await new Promise((r) => setTimeout(r, 150));

        const topbarSelect = document.querySelector('[data-testid="topbar-model-select"]');
        const syncedTopbarModel = topbarSelect ? topbarSelect.value : '';

        setReactSelect(topbarSelect, 'gemini-3.5-flash-lite');
        await new Promise((r) => setTimeout(r, 50));
        const afterLiteSwitch = topbarSelect ? topbarSelect.value : '';

        setReactSelect(topbarSelect, 'gemini-3.8-flash');
        await new Promise((r) => setTimeout(r, 50));
        const afterFlashSwitch = topbarSelect ? topbarSelect.value : '';

        return {
          initialDefault,
          optionIds,
          savedDefaultModel: window.__LAST_SAVED_CONTEXT_DATA__?.defaultModel,
          syncedTopbarModel,
          afterLiteSwitch,
          afterFlashSwitch
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      initialDefault: 'gemini-3.8-flash',
      optionIds: [
        'gemini-3.8-flash',
        'gemini-4-argon',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite'
      ],
      savedDefaultModel: 'gemini-4-argon',
      syncedTopbarModel: 'gemini-4-argon',
      afterLiteSwitch: 'gemini-3.5-flash-lite',
      afterFlashSwitch: 'gemini-3.8-flash'
    })
  }, 15000)

  test('auto-labels conversation after Turn 1 via stateless side-request (no previous_interaction_id, tools=[]) and updates user_conversations:1 + sidebar UI', async () => {
    const url = `http://127.0.0.1:${port}/?scenario=dashboard`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('textarea'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const turn1Res = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__INTERACTION_CALLS__ = [];
        window.__ARTIFACT_UPDATES__ = [];
        window.__DAB_STUDIO__.setAuthMode('apikey');
        const newBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          (b.textContent || '').includes('New Content')
        );
        if (newBtn) newBtn.click();
        await new Promise((r) => setTimeout(r, 80));

        const ta = document.querySelector('.dab-composer textarea');
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        taSetter.call(ta, 'Build a quarterly order margin dashboard on order_items');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const sendBtn = document.querySelector('.dab-composer .dab-btn-gemini');
        if (sendBtn) sendBtn.click();

        const waitUntil = Date.now() + 5000;
        while (Date.now() < waitUntil) {
          const bodyText = document.body ? document.body.innerText : '';
          if (bodyText.includes('Quarterly Order Margin Analysis')) break;
          await new Promise((r) => setTimeout(r, 80));
        }

        const labelCall = (window.__INTERACTION_CALLS__ || []).find((c) =>
          ((c.body && c.body.input && c.body.input[0] && c.body.input[0].text) || '').includes('[CONVERSATION_LABEL_REQUEST]')
        );
        const convUpdates = (window.__ARTIFACT_UPDATES__ || []).filter((u) => u.key === 'user_conversations:1');
        const latestConvList = convUpdates.length > 0 ? JSON.parse(convUpdates[convUpdates.length - 1].value) : [];
        const bodyText = document.body ? document.body.innerText : '';
        const sidebarEl = document.querySelector('[data-testid="conversations-sidebar"]');

        return {
          hasLabelCall: Boolean(labelCall),
          labelCallTools: labelCall ? labelCall.body.tools : null,
          labelCallHasPrevId: labelCall ? ('previous_interaction_id' in labelCall.body) : null,
          savedConvLabel: latestConvList[0] ? latestConvList[0].label : null,
          sidebarShowsGeneratedLabel:
            bodyText.includes('[dashboard] Quarterly Order Margin Analysis (#99)') &&
            Boolean(sidebarEl && (sidebarEl.innerText || '').includes('Quarterly Order Margin Analysis'))
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(turn1Res.result.value).toEqual({
      hasLabelCall: true,
      labelCallTools: [],
      labelCallHasPrevId: false,
      savedConvLabel: 'Quarterly Order Margin Analysis',
      sidebarShowsGeneratedLabel: true
    })
  }, 15000)

  test('renders collapsible left conversations sidebar, switches to centered empty-state prompt on + New Conversation, and restores conversation state on click', async () => {
    const url = `http://127.0.0.1:${port}/?scenario=data_app`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const step1 = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const sidebar = document.querySelector('[data-testid="conversations-sidebar"]');
        const toggleBtn = document.querySelector('[data-testid="sidebar-collapse-toggle"]');
        const newBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        const initialItems = Array.from(document.querySelectorAll('.dab-conv-item-label')).map((el) =>
          (el.textContent || '').trim()
        );

        // Collapse and expand sidebar
        toggleBtn.click();
        await new Promise((r) => setTimeout(r, 60));
        const collapsedState = sidebar.classList.contains('collapsed');
        toggleBtn.click();
        await new Promise((r) => setTimeout(r, 60));
        const expandedState = !sidebar.classList.contains('collapsed');

        // Click + New Conversation -> should show centered empty-state prompt box
        newBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        const centeredStage = document.querySelector('[data-testid="centered-empty-prompt"]');
        const promptCard = document.querySelector('.dab-empty-prompt-card');
        const rect = promptCard ? promptCard.getBoundingClientRect() : null;
        return {
          initialItems,
          collapsedState,
          expandedState,
          hasCenteredStage: Boolean(centeredStage),
          centeredHeroText: centeredStage ? centeredStage.innerText : '',
          cardCenteredHorizontally: rect ? rect.left > 240 && rect.right < 1400 : false,
          cardCenteredVertically: rect ? rect.top > 80 && rect.bottom < 860 : false
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(step1.result.value.initialItems).toEqual([
      'Executive Revenue App',
      'Executive Order Performance (Native UDD)',
      'Add total_revenue & gross_margin to order_items',
      '3-Pillar Health Check — thelook_event (70%)',
      'Looker Explore & Filter Summary'
    ])
    expect(step1.result.value.collapsedState).toBe(true)
    expect(step1.result.value.expandedState).toBe(true)
    expect(step1.result.value.hasCenteredStage).toBe(true)
    expect(step1.result.value.centeredHeroText).toContain('New Conversation')
    expect(step1.result.value.centeredHeroText).toContain('Build a Looker Data App with Antigravity')
    expect(step1.result.value.cardCenteredHorizontally).toBe(true)
    expect(step1.result.value.cardCenteredVertically).toBe(true)

    // Save prototype screenshot of sidebar + centered empty-state prompt box
    const { data } = await chrome.send('Page.captureScreenshot', { format: 'png' })
    const pngBuffer = Buffer.from(data, 'base64')
    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchScreenshot = path.join(scratchDir, 'issue-24-sidebar-and-centered-prompt.png')
    writeFileSync(scratchScreenshot, pngBuffer)
    expect(existsSync(scratchScreenshot)).toBe(true)

    // Click previous conversation (conv_dashboard_7) -> switches to Content Studio, restores chat & preview
    const step2 = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const item = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        if (item) item.click();
        await new Promise((r) => setTimeout(r, 200));
        const activeTab = (document.querySelector('.dab-mode-tab.active')?.textContent || '').trim();
        const centeredGone = !document.querySelector('[data-testid="centered-empty-prompt"]');
        const bodyText = document.body ? document.body.innerText : '';
        return {
          activeTab,
          centeredGone,
          restoredChatMsg: bodyText.includes('Created native Looker Dashboard #7'),
          restoredPreview: bodyText.includes('/embed/dashboards/7')
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(step2.result.value).toEqual({
      activeTab: 'Content Studio',
      centeredGone: true,
      restoredChatMsg: true,
      restoredPreview: true
    })
  }, 15000)

  test('defaults use-case selector to Auto on new conversation, gates options by permissions, routes Turn 1 via AGENTS.md, locks to read-only badge, and resets to Auto on New Conversation', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${port}/?scenario=chatbar_error_banner`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="new-conversation-btn"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        // 1. Click + New Conversation to enter clean new conversation state
        const newBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        if (newBtn) newBtn.click();
        await new Promise((r) => setTimeout(r, 100));

        const sel = document.querySelector('[data-testid="use-case-selector"]');
        const defaultUseCase = sel ? sel.value : null;
        const optionValues = sel ? Array.from(sel.options).map((o) => o.value) : [];

        // 2. Verify permission gating disables LookML when user lacks develop permission
        window.__DAB_STUDIO__.setCapabilities({
          isAdmin: false,
          rolesLoaded: true,
          globalPermissions: new Set(['access_data', 'explore', 'save_content', 'save_dashboards']),
          modelsByPermission: { explore: new Set(['thelook']) },
          explorableModels: new Set(['thelook']),
          developableProjects: new Set(),
          readableProjects: new Set(),
          sqlRunnerConnections: new Set(),
          editableFolderIds: new Set(['5']),
          canConfigureExtension: false,
          canManageUserAttributes: false,
          tools: {
            app: { enabled: true, readOnly: false, missingPermissions: [] },
            dashboard: { enabled: true, readOnly: false, missingPermissions: [] },
            lookml: { enabled: false, readOnly: false, missingPermissions: ['develop'], reason: 'Missing Looker permissions: develop' },
            health: { enabled: false, readOnly: false, missingPermissions: ['see_system_activity', 'develop', 'use_sql_runner'] },
            tile: { enabled: true, readOnly: false, missingPermissions: [] }
          }
        });
        await new Promise((r) => setTimeout(r, 80));
        const selRestricted = document.querySelector('[data-testid="use-case-selector"]');
        const lookmlOptDisabledWhenRestricted = selRestricted
          ? Boolean(Array.from(selRestricted.options).find((o) => o.value === 'lookml')?.disabled)
          : false;

        // Restore full admin capabilities so Auto can route to LookML on Turn 1
        window.__DAB_STUDIO__.setCapabilities({
          isAdmin: true,
          rolesLoaded: true,
          globalPermissions: new Set(['admin', 'develop', 'explore', 'save_content', 'save_dashboards']),
          modelsByPermission: {},
          explorableModels: new Set(['*']),
          developableProjects: new Set(['*']),
          readableProjects: new Set(['*']),
          sqlRunnerConnections: new Set(['*']),
          editableFolderIds: new Set(['5', '1']),
          canConfigureExtension: true,
          canManageUserAttributes: true,
          tools: {
            app: { enabled: true, readOnly: false, missingPermissions: [] },
            dashboard: { enabled: true, readOnly: false, missingPermissions: [] },
            lookml: { enabled: true, readOnly: false, missingPermissions: [] },
            health: { enabled: true, readOnly: false, missingPermissions: [] },
            tile: { enabled: true, readOnly: false, missingPermissions: [] }
          }
        });
        await new Promise((r) => setTimeout(r, 80));

        // 3. Submit Turn 1 LookML prompt with selector in 'auto'
        const ta = document.querySelector('[data-testid="studio-prompt-input"]');
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        taSetter.call(ta, 'Add a measure for gross_margin to order_items.view.lkml and run LookML data tests');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const sendBtn = document.querySelector('.dab-composer .dab-btn-gemini');
        if (sendBtn) sendBtn.click();
        await new Promise((r) => setTimeout(r, 200));

        const selectorGoneAfterTurn1 = !document.querySelector('[data-testid="use-case-selector"]');
        const lockedBadge = document.querySelector('[data-testid="locked-use-case-badge"]');
        const lockedBadgeText = lockedBadge ? (lockedBadge.textContent || '').trim() : '';
        const activeModeTab = (document.querySelector('.dab-mode-tab.active')?.textContent || '').trim();
        const nonActiveTabsDisabled = Array.from(document.querySelectorAll('.dab-mode-tab:not(.active)')).every(
          (b) => b.disabled
        );

        const convUpdates = (window.__ARTIFACT_UPDATES__ || []).filter(
          (u) => u.key === 'user_conversations:1'
        );
        const latestConversations =
          convUpdates.length > 0 ? JSON.parse(convUpdates[convUpdates.length - 1].value) : [];

        // 4. Click + New Conversation -> resets back to editable Auto selector
        const resetBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        if (resetBtn) resetBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        const selAfterReset = document.querySelector('[data-testid="use-case-selector"]');
        const badgeAfterReset = document.querySelector('[data-testid="locked-use-case-badge"]');

        return {
          defaultUseCase,
          optionValues,
          lookmlOptDisabledWhenRestricted,
          selectorGoneAfterTurn1,
          lockedBadgeText,
          activeModeTab,
          nonActiveTabsDisabled,
          persistedType: latestConversations[0]?.type,
          resetUseCase: selAfterReset ? selAfterReset.value : null,
          badgeGoneAfterReset: !badgeAfterReset
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      defaultUseCase: 'auto',
      optionValues: [
        'auto',
        'app',
        'dashboard',
        'lookml',
        'health-check',
        'tile',
        'conversational-analytics'
      ],
      lookmlOptDisabledWhenRestricted: true,
      selectorGoneAfterTurn1: true,
      lockedBadgeText: '🔒 LookML',
      activeModeTab: 'LookML',
      nonActiveTabsDisabled: true,
      persistedType: 'lookml',
      resetUseCase: 'auto',
      badgeGoneAfterReset: true
    })
  }, 15000)
})
