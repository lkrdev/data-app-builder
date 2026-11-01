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
        'obj_conversational-analytics_ca_conv_streaming_1': {
          id: 'ca_conv_streaming_1',
          type: 'conversational-analytics',
          title: 'BigQuery Streaming Buffer & Order Revenue Q&A',
          caConversationId: 'ca_conv_streaming_1',
          agentId: 'ca_agent_ecommerce',
          agentName: 'eCommerce & BigQuery Analytics Agent',
          embedPath: '/embed/conversations/ca_conv_streaming_1?agent_id=ca_agent_ecommerce',
          explores: ['thelook::order_items', 'bigquery_information_schema::streaming_timeline'],
          selectionRationale: 'Matched order revenue + BigQuery streaming buffer explores on eCommerce & BigQuery Analytics Agent.',
          updatedAt: '2026-10-30T23:41:00Z',
          createdBy: '1',
          messages: [
            { role: 'user', text: 'Why did order revenue spike in Q4 and which BigQuery tables had the highest streaming buffer volume?' },
            { role: 'assistant', text: 'Routed to Looker Conversational Analytics Agent "eCommerce & BigQuery Analytics Agent" (ca_agent_ecommerce).\\n\\nQ4 order revenue rose +18.4% YoY ($4.28M), while looker-private-demo.thelook.events accounted for 84% of streaming buffer bytes (507.5 MB across 2.89M rows).' }
          ]
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
        data_app: '/c/conv_app_42',
        dashboard: '/c/conv_dashboard_7',
        lookml: '/c/conv_lookml_20261030_dev_branch',
        health_check: '/c/conv_health_demo',
        python_tile_studio: '/c/conv_tile_demo1',
        tile_mount_view: '/',
        tile_mount_edit: '/',
        tile_mount_unbound: '/',
        config_page: '/config',
        explore_dropdown_open_top: '/c/conv_app_42',
        explore_dropdown_scrolled: '/c/conv_app_42',
        chatbar_lookml_skills: '/lookml',
        chatbar_pasted_image_inspector: '/c/conv_app_42',
        chatbar_busy_running: '/c/conv_app_42',
        chatbar_error_banner: '/',
        python_tile_scheduler_modal: '/c/conv_tile_demo1',
        conversational_analytics: '/c/ca_conv_streaming_1',
        centered_empty_prompt: '/',
        studio_dark_theme: '/c/conv_app_42'
      };

      try {
        if (scenario === 'studio_dark_theme') {
          window.localStorage.setItem('dab_theme_mode', 'dark');
        } else if (!window.location.search.includes('preserveTheme=1')) {
          window.localStorage.removeItem('dab_theme_mode');
        }
      } catch {}

      const isTile =
        scenario === 'tile_mount_view' ||
        scenario === 'tile_mount_edit' ||
        scenario === 'tile_mount_unbound';

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
        search_agents: async () => [
          {
            id: 'ca_agent_ecommerce',
            name: 'eCommerce & BigQuery Analytics Agent',
            description: 'Answers order revenue, gross margin, customer retention, and BigQuery streaming buffer questions.',
            explores: ['thelook::order_items', 'bigquery_information_schema::streaming_timeline']
          },
          {
            id: 'ca_agent_retail_ops',
            name: 'Retail Operations Agent',
            description: 'Answers store transactions, supply chain shipments, and warehouse stock questions.',
            explores: ['retail_ops::store_transactions', 'retail_ops::warehouse_stock']
          }
        ],
        create_conversation: async (body) => ({
          id: 'ca_conv_live_77',
          agent_id: (body && body.agent_id) || 'ca_agent_ecommerce',
          title: (body && body.title) || 'Conversational Analytics Chat'
        }),
        conversational_analytics_chat: async () => ({
          reply: 'Top 3 categories by gross margin in Q4: Outerwear ($1.42M, 54.2% margin), Jeans ($1.18M, 51.8% margin), and Sweaters ($940K, 49.6% margin).'
        }),
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
          hostType: scenario === 'spartan_fullscreen' ? 'spartan' : 'standard',
          mountPoint: isTile ? 'dashboard-tile' : 'standalone',
          mountType: isTile ? 'dashboard_tile' : scenario === 'spartan_fullscreen' ? 'fullscreen' : 'standalone'
        },
        getContextData: () => savedContextData,
        saveContextData: async (ctx) => {
          savedContextData = { ...savedContextData, ...ctx };
          window.__LAST_SAVED_CONTEXT_DATA__ = savedContextData;
          return savedContextData;
        },
        localStorageGetItem: async (key) => {
          try {
            return window.localStorage.getItem(key);
          } catch {
            return null;
          }
        },
        localStorageSetItem: async (key, value) => {
          window.__LOCAL_STORAGE_UPDATES__ = window.__LOCAL_STORAGE_UPDATES__ || [];
          window.__LOCAL_STORAGE_UPDATES__.push({ key, value });
          try {
            window.localStorage.setItem(key, value);
          } catch {}
        },
        openBrowserWindow: () => {},
        oauth2Authenticate: async (authUrl, params, method) => {
          window.__OAUTH_CALLS__ = window.__OAUTH_CALLS__ || [];
          window.__OAUTH_CALLS__.push({ authUrl, params, method });
          if (typeof window.__MOCK_OAUTH_IMPL__ === 'function') {
            return window.__MOCK_OAUTH_IMPL__(authUrl, params, method);
          }
          return { access_token: 'mock_oauth_token_123' };
        },
        updateLocation: (url, state, target) => {
          window.__UPDATED_LOCATIONS__ = window.__UPDATED_LOCATIONS__ || [];
          window.__UPDATED_LOCATIONS__.push({ url, state, target });
        },
        rendered: () => {
          window.__RENDERED_CALLS__ = window.__RENDERED_CALLS__ || [];
          const tableEl = document.querySelector('.dab-tile-table, .dab-py-table');
          const markdownEl = document.querySelector('.dab-py-markdown');
          const idleEl = document.querySelector('.dab-tile-idle');
          const editEl = document.querySelector('.dab-tile-edit');
          window.__RENDERED_CALLS__.push({
            hasTableInDom: Boolean(tableEl),
            tableRowCount: tableEl ? tableEl.querySelectorAll('tbody tr').length : 0,
            tableText: tableEl ? (tableEl.innerText || '').trim() : '',
            hasMarkdownInDom: Boolean(markdownEl),
            hasIdleInDom: Boolean(idleEl),
            hasEditInDom: Boolean(editEl),
            bodyText: document.body ? (document.body.innerText || '').trim() : ''
          });
        },
        updateTitle: () => {},
        serverProxy: async (url, init) => {
          window.__INTERACTION_CALLS__ = window.__INTERACTION_CALLS__ || [];
          const body = init && init.body ? JSON.parse(init.body) : undefined;
          window.__INTERACTION_CALLS__.push({ url, method: (init && init.method) || 'GET', body });
          const inputText = (body && body.input && body.input[0] && body.input[0].text) || '';
          if (inputText.includes('[CA_AGENT_SELECTION_REQUEST]')) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_ca_subagent_1',
                status: 'completed',
                output_text: '<CA_AGENT_SELECTION>{"agent_id":"ca_agent_ecommerce","agent_name":"eCommerce & BigQuery Analytics Agent","rationale":"Question asks about gross margin by product category in thelook::order_items.","initial_question":"What are the top 3 product categories by gross margin in Q4?"}</CA_AGENT_SELECTION>'
              })
            };
          }
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
        initialThemeMode: scenario === 'studio_dark_theme' ? 'dark' : undefined,
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
          elementId: scenario === 'tile_mount_unbound' ? '999' : '57',
          dashboardId: '8',
          isDashboardEditing: scenario === 'tile_mount_edit',
          dashboardRunState: 'NOT_RUNNING',
          dashboardFilters: { status: 'Complete', model: 'thelook' }
        } : undefined,
        getMockPreviewHtml: (mode, objectId) => {
          if (mode === 'conversational-analytics') {
            return \`<!DOCTYPE html><html><body style="font-family:Inter,system-ui,sans-serif;margin:0;padding:24px;background:#f8fafc;color:#0f172a;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <div>
                  <span style="background:#ede9fe;color:#6d28d9;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;">LOOKER CONVERSATIONAL ANALYTICS · \${objectId || 'ca_conv_streaming_1'}</span>
                  <h2 style="margin:6px 0 0;font-size:20px;">eCommerce &amp; BigQuery Analytics Agent (Embedded Conversation)</h2>
                </div>
                <span style="background:#fff;border:1px solid #cbd5e1;padding:6px 12px;border-radius:6px;font-size:12px;">Agent ID: <strong>ca_agent_ecommerce</strong></span>
              </div>
              <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:14px;">
                <div style="font-size:12px;color:#64748b;font-weight:600;">USER QUESTION</div>
                <div style="font-size:14px;color:#0f172a;margin-top:4px;font-weight:600;">Why did order revenue spike in Q4 and which BigQuery tables had the highest streaming buffer volume?</div>
              </div>
              <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;">
                <div style="font-size:12px;color:#6d28d9;font-weight:700;">CA AGENT VERIFIED ANSWER · thelook::order_items + streaming_timeline</div>
                <p style="font-size:13px;line-height:1.5;color:#1e293b;margin:8px 0 12px;">Q4 order revenue rose <strong>+18.4% YoY ($4.28M)</strong> led by Outerwear and Jeans, while <strong>looker-private-demo.thelook.events</strong> accounted for 84% of streaming buffer bytes (507.5 MB across 2.89M rows).</p>
              </div>
            </body></html>\`;
          }
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
      '--disable-dev-shm-usage',
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

  const rawSend = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const send = async (method, params = {}) => {
    if (method === 'Page.navigate') {
      try {
        await rawSend('Runtime.evaluate', {
          expression: `(() => {
            delete window.__DAB_STUDIO__;
            delete window.__RENDERED_CALLS__;
            delete window.__LOOKER_EMBED_STATE__;
            if (document.body) document.body.innerHTML = '';
          })()`
        })
      } catch {}
    }
    return rawSend(method, params)
  }

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

  function writeSnapshotManifest() {
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
    const manifest = scenarios.map((s) => {
      const snapFile = path.join(imageSnapshotsDir, s.snapshotName)
      const buf = existsSync(snapFile) ? readFileSync(snapFile) : null
      const width = buf && buf.length >= 24 ? buf.readUInt32BE(16) : 1440
      const height = buf && buf.length >= 24 ? buf.readUInt32BE(20) : 900
      return {
        id: s.id,
        category: s.category,
        title: s.title,
        snapshotName: s.snapshotName,
        width,
        height,
        ...(s.clipSelector ? { clipSelector: s.clipSelector, clipMargin: s.clipMargin ?? 24 } : {}),
        changedInGit: changedFiles.has(s.snapshotName)
      }
    })
    writeFileSync(path.join(imageSnapshotsDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    return manifest
  }

  afterAll(async () => {
    if (chrome) chrome.close()
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }

    // Write manifest.json recording snapshot dimensions, crop selectors, and git status
    try {
      writeSnapshotManifest()
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
        '🔒 Data App',
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
      clipSelector: ['.dab-combobox', '.dab-dropdown'],
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
      clipSelector: ['.dab-combobox', '.dab-dropdown'],
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
      clipSelector: '.dab-composer',
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
      title: '12. Chat Bar State — Pasted Screenshot Thumbnail & Composer Model Selector',
      snapshotName: '12-chatbar-state-pasted-image-and-inspector-snap.png',
      clipSelector: '.dab-composer',
      expectText: [
        'Gemini 3.8 Flash',
        '✨ Update App'
      ]
    },
    {
      id: 'chatbar_busy_running',
      category: 'Chat Bar States',
      title: '13. Chat Bar State — Busy / Running Spinner Banner',
      snapshotName: '13-chatbar-state-busy-running-snap.png',
      clipSelector: ['.dab-status-banner', '.dab-composer'],
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
      clipSelector: ['.dab-msg-error', '.dab-composer'],
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
      clipSelector: '.dab-modal',
      expectText: [
        '⏰ Custom CodeMode Script Scheduler',
        'obj_schedule_demo1',
        'Daily at 8:00 AM (0 8 * * *)',
        'Script Execution Mode (`vars.mode`)',
        'Custom Controls / Non-Query Variables (`vars.custom_controls` JSON)',
        '✨ Save Script Schedule'
      ]
    },
    {
      id: 'conversational_analytics',
      category: 'Mini-App Modes',
      title: '16. Conversational Analytics Mode (Isolated Sub-Agent Selection & Embedded CA Chat)',
      snapshotName: '16-mode-conversational-analytics-snap.png',
      expectText: [
        '🔒 Conversational Analytics',
        'BigQuery Streaming Buffer & Order Revenue Q&A',
        '🤖 Agent: eCommerce & BigQuery Analytics Agent (ca_agent_ecommerce)',
        'Isolated Sub-Agent Selection:',
        '/embed/conversations/ca_conv_streaming_1',
        '✨ Ask CA Agent'
      ]
    },
    {
      id: 'centered_empty_prompt',
      category: 'Chat Bar States',
      title: '17. Centered New-Conversation Empty Prompt Box (Use-Case Selector, Input & Actions)',
      snapshotName: '17-centered-empty-prompt-snap.png',
      clipSelector: '.dab-empty-prompt-card',
      expectText: [
        'New Conversation',
        'Build a Looker Data App with Antigravity',
        'Use Case:',
        '✨ Build App',
        'My Creations (5)'
      ]
    },
    {
      id: 'studio_dark_theme',
      category: 'Mini-App Modes',
      title: '18. Studio Dark Theme Mode (Semantic Dark Surface & Text Tokens)',
      snapshotName: '18-studio-dark-theme.png',
      expectText: [
        'Agent',
        'Agentic LookML',
        'Executive Revenue App',
        '✨ Update App'
      ]
    }
  ]

  let testCount = 0
  test.each(scenarios)(
    'renders $id ($title) with MockLookerExtensionProvider and matches DOM & image snapshots',
    async ({ id, snapshotName, expectText, clipSelector, clipMargin = 24 }) => {
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
      let clip
      if (clipSelector) {
        const selectors = [clipSelector].flat()
        const clipRes = await chrome.send('Runtime.evaluate', {
          expression: `(() => {
            const rects = ${JSON.stringify(selectors)}
              .flatMap((s) => Array.from(document.querySelectorAll(s)))
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.width > 0 && r.height > 0);
            if (!rects.length) return null;
            const x = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.left)) - ${clipMargin}));
            const y = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.top)) - ${clipMargin}));
            const right = Math.min(1440, Math.ceil(Math.max(...rects.map((r) => r.right)) + ${clipMargin}));
            const bottom = Math.min(900, Math.ceil(Math.max(...rects.map((r) => r.bottom)) + ${clipMargin}));
            return { x, y, width: right - x, height: bottom - y, scale: 1 };
          })()`,
          returnByValue: true
        })
        clip = clipRes.result?.value
        expect(clip).toBeTruthy()
      }

      const { data } = await chrome.send('Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip } : {})
      })
      const pngBuffer = Buffer.from(data, 'base64')
      expect(pngBuffer.length).toBeGreaterThan(1000)

      const width = pngBuffer.readUInt32BE(16)
      const height = pngBuffer.readUInt32BE(20)
      expect(width).toBe(clip ? clip.width : 1440)
      expect(height).toBe(clip ? clip.height : 900)

      const snapshotPath = path.join(imageSnapshotsDir, snapshotName)
      writeFileSync(snapshotPath, pngBuffer)
      expect(existsSync(snapshotPath)).toBe(true)
    },
    15000
  )

  test('records cropped component dimensions and clipSelector metadata in manifest.json', () => {
    const manifest = writeSnapshotManifest()
    for (const { id, clipSelector } of scenarios.filter((s) => s.clipSelector)) {
      const entry = manifest.find((m) => m.id === id)
      expect(entry).toMatchObject({ clipSelector, clipMargin: 24 })
      expect(entry.width).toBeGreaterThan(100)
      expect(entry.height).toBeGreaterThan(80)
      expect(entry.width).toBeLessThan(1440)
      expect(entry.height).toBeLessThan(900)
    }
    const fullPageEntry = manifest.find((m) => m.id === 'data_app')
    expect(fullPageEntry).toMatchObject({ width: 1440, height: 900 })
    expect(fullPageEntry.clipSelector).toBeUndefined()
  })

  test('enables/disables individual tool modes via /config and filters use-case-selector options, catalog & routes', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
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
        const sel = document.querySelector('[data-testid="use-case-selector"]');
        const useCaseOptionsAfterSave = sel ? Array.from(sel.options).map((o) => o.value) : [];
        const text = document.body ? document.body.innerText : '';
        // Navigate to disabled route /lookml/20261030_dev_branch and verify redirect back to '/'
        window.__DAB_STUDIO__.history.push('/lookml/20261030_dev_branch');
        await new Promise((r) => setTimeout(r, 120));
        const routeAfterDisabledPush = window.__DAB_STUDIO__.history.location.pathname;
        const noTopbarModeSwitcher = !document.querySelector('.dab-mode-switcher');
        return {
          savedDisabledModes: window.__LAST_SAVED_CONTEXT_DATA__?.disabledModes || [],
          useCaseOptionsAfterSave,
          hasFilteredCatalogCount: text.includes('My Creations (2)'),
          routeAfterDisabledPush,
          noTopbarModeSwitcher
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(afterSave.result.value).toEqual({
      savedDisabledModes: ['lookml', 'health', 'tile'],
      useCaseOptionsAfterSave: ['auto', 'dashboard', 'conversational-analytics', 'app'],
      hasFilteredCatalogCount: true,
      routeAfterDisabledPush: '/',
      noTopbarModeSwitcher: true
    })
  }, 15000)

  test('switches Antigravity models via config-default-model-select and composer-model-select in composer footer and persists defaultModel (Issue #59)', async () => {
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

        const noTopbarModelSelect = !document.querySelector('.dab-topbar [data-testid="topbar-model-select"]');
        const noComposerInspector = !document.querySelector('.dab-composer-actions .dab-inspector');
        const composerSelect = document.querySelector('.dab-composer-actions [data-testid="composer-model-select"]');
        const syncedComposerModel = composerSelect ? composerSelect.value : '';

        setReactSelect(composerSelect, 'gemini-3.5-flash-lite');
        await new Promise((r) => setTimeout(r, 50));
        const afterLiteSwitch = composerSelect ? composerSelect.value : '';

        setReactSelect(composerSelect, 'gemini-3.8-flash');
        await new Promise((r) => setTimeout(r, 50));
        const afterFlashSwitch = composerSelect ? composerSelect.value : '';

        return {
          initialDefault,
          optionIds,
          savedDefaultModel: window.__LAST_SAVED_CONTEXT_DATA__?.defaultModel,
          noTopbarModelSelect,
          noComposerInspector,
          syncedComposerModel,
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
      noTopbarModelSelect: true,
      noComposerInspector: true,
      syncedComposerModel: 'gemini-4-argon',
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
        window.__DAB_STUDIO__.setApiKey('mock-api-key');
        const newBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        if (newBtn) newBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        window.__DAB_STUDIO__.setSelectedUseCase('dashboard');
        await new Promise((r) => setTimeout(r, 50));

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
          routeAfterTurn1: window.__DAB_STUDIO__.history.location.pathname,
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
      routeAfterTurn1: '/c/99',
      sidebarShowsGeneratedLabel: true
    })
  }, 15000)

  test('renders collapsible left conversations sidebar, switches to centered empty-state prompt on + New Conversation, and restores conversation state on /c/:conversationId click', async () => {
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

        // Click + New Conversation -> should route to '/' and show centered empty-state prompt box
        newBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        const centeredStage = document.querySelector('[data-testid="centered-empty-prompt"]');
        const promptCard = document.querySelector('.dab-empty-prompt-card');
        const rect = promptCard ? promptCard.getBoundingClientRect() : null;
        return {
          initialItems,
          collapsedState,
          expandedState,
          routeOnNew: window.__DAB_STUDIO__.history.location.pathname,
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
    expect(step1.result.value.routeOnNew).toBe('/')
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
    const issue47Screenshot = path.join(scratchDir, 'issue-47-unified-routing.png')
    writeFileSync(issue47Screenshot, pngBuffer)
    expect(existsSync(issue47Screenshot)).toBe(true)

    // Click previous conversation (conv_dashboard_7) -> routes to /c/7, shows 🔒 Content Studio badge, restores chat & preview
    const step2 = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const item = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        if (item) item.click();
        await new Promise((r) => setTimeout(r, 200));
        const topbarBadge = (document.querySelector('[data-testid="topbar-use-case-badge"]')?.textContent || '').trim();
        const routeAfterSelect = window.__DAB_STUDIO__.history.location.pathname;
        const centeredGone = !document.querySelector('[data-testid="centered-empty-prompt"]');
        const bodyText = document.body ? document.body.innerText : '';

        // Also test legacy route redirect (/lookml/20261030_dev_branch -> /c/20261030_dev_branch)
        window.__DAB_STUDIO__.history.push('/lookml/20261030_dev_branch');
        await new Promise((r) => setTimeout(r, 150));
        const redirectedLegacyRoute = window.__DAB_STUDIO__.history.location.pathname;
        const lookmlBadge = (document.querySelector('[data-testid="topbar-use-case-badge"]')?.textContent || '').trim();

        return {
          topbarBadge,
          routeAfterSelect,
          centeredGone,
          restoredChatMsg: bodyText.includes('Created native Looker Dashboard #7'),
          restoredPreview: bodyText.includes('/embed/dashboards/7'),
          redirectedLegacyRoute,
          lookmlBadge
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(step2.result.value).toEqual({
      topbarBadge: '🔒 Content Studio',
      routeAfterSelect: '/c/7',
      centeredGone: true,
      restoredChatMsg: true,
      restoredPreview: true,
      redirectedLegacyRoute: '/c/20261030_dev_branch',
      lookmlBadge: '🔒 LookML'
    })
  }, 15000)

  test('defaults use-case selector to Auto on new conversation, gates options by permissions with 🔒 indicator, routes Turn 1 via AGENTS.md, locks to read-only badge, and resets to Auto on New Conversation', async () => {
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
        const optionLabels = sel ? Array.from(sel.options).map((o) => (o.textContent || '').trim()) : [];

        // 2. Verify permission gating disables LookML with 🔒 indicator & tooltip when user lacks develop permission
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
        const lookmlOpt = selRestricted
          ? Array.from(selRestricted.options).find((o) => o.value === 'lookml')
          : null;
        const lookmlOptDisabledWhenRestricted = Boolean(lookmlOpt?.disabled);
        const lookmlOptHasLockLabel = Boolean((lookmlOpt?.textContent || '').includes('🔒') && (lookmlOpt?.textContent || '').includes('(Locked)'));
        const lookmlOptTitle = lookmlOpt?.getAttribute('title') || '';

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
        window.__DAB_STUDIO__.setOauthToken('mock_oauth_token');
        await new Promise((r) => setTimeout(r, 40));
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
        const topbarBadge = document.querySelector('[data-testid="topbar-use-case-badge"]');
        const topbarBadgeText = topbarBadge ? (topbarBadge.textContent || '').trim() : '';
        const noModeSwitcher = !document.querySelector('.dab-mode-switcher');

        const convUpdates = (window.__ARTIFACT_UPDATES__ || []).filter(
          (u) => u.key === 'user_conversations:1'
        );
        const latestConversations =
          convUpdates.length > 0 ? JSON.parse(convUpdates[convUpdates.length - 1].value) : [];

        // 4. Click + New Conversation -> resets back to editable Auto selector at '/'
        const resetBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        if (resetBtn) resetBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        const selAfterReset = document.querySelector('[data-testid="use-case-selector"]');
        const badgeAfterReset = document.querySelector('[data-testid="locked-use-case-badge"]');

        return {
          defaultUseCase,
          optionValues,
          optionLabels,
          lookmlOptDisabledWhenRestricted,
          lookmlOptHasLockLabel,
          lookmlOptTitle,
          selectorGoneAfterTurn1,
          lockedBadgeText,
          topbarBadgeText,
          noModeSwitcher,
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
        'dashboard',
        'conversational-analytics',
        'app',
        'health-check',
        'lookml',
        'tile'
      ],
      optionLabels: [
        'Auto',
        'Content Studio',
        'Conversational Analytics',
        'Data App',
        'Health Check',
        'LookML',
        'Script'
      ],
      lookmlOptDisabledWhenRestricted: true,
      lookmlOptHasLockLabel: true,
      lookmlOptTitle: 'Missing Looker permissions: develop',
      selectorGoneAfterTurn1: true,
      lockedBadgeText: '🔒 LookML',
      topbarBadgeText: '🔒 LookML',
      noModeSwitcher: true,
      persistedType: 'lookml',
      resetUseCase: 'auto',
      badgeGoneAfterReset: true
    })
  }, 15000)

  test('routes Turn-1 Auto question to Conversational Analytics via stateless isolated sub-agent (no previous_interaction_id, tools=[]), embeds CA conversation, and persists to user_conversations:1', async () => {
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
        window.__INTERACTION_CALLS__ = [];
        window.__ARTIFACT_UPDATES__ = [];
        window.__DAB_STUDIO__.setAuthMode('apikey');
        window.__DAB_STUDIO__.setApiKey('mock-api-key');
        const newBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        if (newBtn) newBtn.click();
        await new Promise((r) => setTimeout(r, 100));

        const ta = document.querySelector('[data-testid="studio-prompt-input"]');
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        taSetter.call(ta, 'What are the top 3 product categories by gross margin in Q4?');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const sendBtn = document.querySelector('[data-testid="studio-send-btn"]');
        if (sendBtn) sendBtn.click();

        const waitUntil = Date.now() + 5000;
        while (Date.now() < waitUntil) {
          if (document.querySelector('[data-testid="ca-selected-agent-badge"]')) break;
          await new Promise((r) => setTimeout(r, 80));
        }

        const subagentCall = (window.__INTERACTION_CALLS__ || []).find((c) =>
          ((c.body && c.body.input && c.body.input[0] && c.body.input[0].text) || '').includes('[CA_AGENT_SELECTION_REQUEST]')
        );
        const lockedBadge = document.querySelector('[data-testid="locked-use-case-badge"]');
        const agentBadge = document.querySelector('[data-testid="ca-selected-agent-badge"]');
        const caIframe = document.querySelector('[data-testid="ca-embed-iframe"]');
        const convUpdates = (window.__ARTIFACT_UPDATES__ || []).filter((u) => u.key === 'user_conversations:1');
        const latestConversations =
          convUpdates.length > 0 ? JSON.parse(convUpdates[convUpdates.length - 1].value) : [];

        return {
          hasSubagentCall: Boolean(subagentCall),
          subagentTools: subagentCall ? subagentCall.body.tools : null,
          subagentHasPrevId: subagentCall ? ('previous_interaction_id' in subagentCall.body) : null,
          lockedBadgeText: lockedBadge ? (lockedBadge.textContent || '').trim() : '',
          agentBadgeText: agentBadge ? (agentBadge.textContent || '').trim() : '',
          hasCaIframe: Boolean(caIframe),
          persistedType: latestConversations[0]?.type,
          persistedCaId: latestConversations[0]?.content?.caConversationId,
          persistedAgentId: latestConversations[0]?.content?.agentId
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      hasSubagentCall: true,
      subagentTools: [],
      subagentHasPrevId: false,
      lockedBadgeText: '🔒 Conversational Analytics',
      agentBadgeText: '🤖 Agent: eCommerce & BigQuery Analytics Agent (ca_agent_ecommerce)',
      hasCaIframe: true,
      persistedType: 'conversational-analytics',
      persistedCaId: 'ca_conv_live_77',
      persistedAgentId: 'ca_agent_ecommerce'
    })
  }, 15000)

  test('toggles Full Screen between /extensions/* and /spartan/* via lookerHostData while preserving internal route', async () => {
    const waitForToggle = async (scenario) => {
      await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=${scenario}` })
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const r = await chrome.send('Runtime.evaluate', {
          expression: `Boolean(document.querySelector('[data-testid="topbar-fullscreen-toggle"]'))`,
          returnByValue: true
        })
        if (r.result?.value) break
        await new Promise((res) => setTimeout(res, 80))
      }
    }

    await waitForToggle('config_page')
    const standardRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__UPDATED_LOCATIONS__ = [];
        const btn = document.querySelector('[data-testid="topbar-fullscreen-toggle"]');
        const configLabel = (btn?.textContent || '').trim();
        btn?.click();
        window.__DAB_STUDIO__.history.push('/c/42');
        await new Promise((r) => setTimeout(r, 80));
        document.querySelector('[data-testid="topbar-fullscreen-toggle"]')?.click();
        const r = document.querySelector('.dab-topbar').getBoundingClientRect();
        return {
          configLabel,
          calls: window.__UPDATED_LOCATIONS__,
          clip: { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.min(1440, Math.ceil(r.width)), height: Math.min(900, Math.ceil(r.height) + 8), scale: 1 }
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(standardRes.result.value.configLabel).toBe('⤢ Full Screen')
    expect(standardRes.result.value.calls).toEqual([
      { url: '/spartan/data_app_builder::data_app_builder/config', state: undefined, target: '_top' },
      { url: '/spartan/data_app_builder::data_app_builder/c/42', state: undefined, target: '_top' }
    ])

    const { data } = await chrome.send('Page.captureScreenshot', { format: 'png', clip: standardRes.result.value.clip })
    const scratchDir = '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchSnap = path.join(scratchDir, 'issue-48-fullscreen-toggle.png')
    writeFileSync(scratchSnap, Buffer.from(data, 'base64'))
    expect(existsSync(scratchSnap)).toBe(true)

    await waitForToggle('spartan_fullscreen')
    const spartanRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        await new Promise((r) => setTimeout(r, 80));
        window.__UPDATED_LOCATIONS__ = [];
        const btn = document.querySelector('[data-testid="topbar-fullscreen-toggle"]');
        const spartanLabel = (btn?.textContent || '').trim();
        btn?.click();
        window.__MOCK_LOOKER_EXTENSION__.lookerHostData.mountPoint = 'dashboard-tile';
        window.__DAB_STUDIO__.history.push('/c/7');
        await new Promise((r) => setTimeout(r, 80));
        return {
          spartanLabel,
          calls: window.__UPDATED_LOCATIONS__,
          hiddenInTile: !document.querySelector('[data-testid="topbar-fullscreen-toggle"]')
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(spartanRes.result.value).toEqual({
      spartanLabel: '⤡ Exit Full Screen',
      calls: [{ url: '/extensions/data_app_builder::data_app_builder/c/42', state: undefined, target: '_top' }],
      hiddenInTile: true
    })
  }, 15000)

  test('auto-executes bound Python script on initial tile mount (when dashboardRunState is NOT_RUNNING), fires extensionSDK.rendered() only after DOM paint, re-executes on dashboardFilters and dashboardRunState -> RUNNING changes, and fires rendered() on unbound tile fallback', async () => {
    const waitForRenderedCount = async (minCount) => {
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const r = await chrome.send('Runtime.evaluate', {
          expression: `Boolean(window.__RENDERED_CALLS__ && window.__RENDERED_CALLS__.length >= ${minCount})`,
          returnByValue: true
        })
        if (r.result?.value) break
        await new Promise((res) => setTimeout(res, 50))
      }
    }

    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=tile_mount_view` })
    await waitForRenderedCount(1)

    const boundRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const waitCalls = async (n) => {
          const d = Date.now() + 4000;
          while (Date.now() < d && window.__RENDERED_CALLS__.length < n) {
            await new Promise((r) => setTimeout(r, 40));
          }
        };
        const initialCall = window.__RENDERED_CALLS__[0];

        window.__MOCK_LOOKER_EXTENSION__.setTileHostData((prev) => ({
          ...prev,
          dashboardRunState: 'NOT_RUNNING',
          dashboardFilters: { status: 'Cancelled', model: 'thelook' }
        }));
        await waitCalls(2);
        const afterFilterCall = window.__RENDERED_CALLS__[1];

        window.__MOCK_LOOKER_EXTENSION__.setTileHostData((prev) => ({
          ...prev,
          dashboardRunState: 'RUNNING'
        }));
        await waitCalls(3);
        const afterRunStateCall = window.__RENDERED_CALLS__[2];

        return {
          totalRenderedCalls: window.__RENDERED_CALLS__.length,
          initialHasTable: initialCall?.hasTableInDom,
          initialRowCount: initialCall?.tableRowCount,
          initialHasComplete: (initialCall?.tableText || '').includes('Complete'),
          filterHasTable: afterFilterCall?.hasTableInDom,
          filterHasCancelled: (afterFilterCall?.tableText || '').includes('Cancelled'),
          runStateHasTable: afterRunStateCall?.hasTableInDom,
          runStateHasCancelled: (afterRunStateCall?.tableText || '').includes('Cancelled')
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(boundRes.result.value).toEqual({
      totalRenderedCalls: 3,
      initialHasTable: true,
      initialRowCount: 2,
      initialHasComplete: true,
      filterHasTable: true,
      filterHasCancelled: true,
      runStateHasTable: true,
      runStateHasCancelled: true
    })

    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=tile_mount_unbound` })
    await waitForRenderedCount(1)

    const unboundRes = await chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const call = (window.__RENDERED_CALLS__ || [])[0];
        return {
          renderedCount: (window.__RENDERED_CALLS__ || []).length,
          hasTableInDom: Boolean(call?.hasTableInDom),
          hasIdleInDom: Boolean(call?.hasIdleInDom),
          showsUnboundMessage: (call?.bodyText || '').includes('No script bound to tile #999')
        };
      })()`,
      returnByValue: true
    })

    expect(unboundRes.result.value).toEqual({
      renderedCount: 1,
      hasTableInDom: false,
      hasIdleInDom: true,
      showsUnboundMessage: true
    })
  }, 15000)

  test('preloads @looker/embed-sdk immediately on empty centered stage and reuses the single iframe DOM node across loadDashboard, asDashboardConnection().run(), loadLook, loadUrl, and + New Conversation (Issue #45)', async () => {
    const url = `http://127.0.0.1:${port}/?scenario=centered_empty_prompt`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && window.__LOOKER_EMBED_STATE__ && document.querySelector('[data-testid="looker-embed-container"] iframe'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const container = document.querySelector('[data-testid="looker-embed-container"]');
        const iframe0 = container ? container.querySelector('iframe') : null;
        const initialEmbedState = {
          state: container ? container.getAttribute('data-embed-state') : null,
          target: container ? container.getAttribute('data-embed-target') : null,
          hasCenteredPrompt: Boolean(document.querySelector('[data-testid="centered-empty-prompt"]'))
        };

        // 1. Select Data App #42 from sidebar -> connection.loadDashboard({ id: '42' })
        const convApp42 = document.querySelector('[data-testid="conversation-item-conv_app_42"]');
        if (convApp42) convApp42.click();
        await new Promise((r) => setTimeout(r, 180));
        const afterApp42 = {
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target'),
          sameIframe: container.querySelector('iframe') === iframe0
        };

        // 2. Click Reload Preview on same Dashboard #42 -> connection.asDashboardConnection().run()
        const reloadBtn = Array.from(document.querySelectorAll('.dab-preview-actions button')).find(
          (b) => (b.textContent || '').includes('Reload Preview')
        );
        if (reloadBtn) reloadBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        const afterWarmRun = {
          hasDashboardRunCall: (window.__LOOKER_EMBED_STATE__?.calls || []).some(
            (c) => c.method === 'asDashboardConnection.run' && c.arg === '42'
          ),
          sameIframe: container.querySelector('iframe') === iframe0
        };

        // 3. Switch to Native UDD #7 from sidebar -> connection.loadDashboard({ id: '7' })
        const convDash7 = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        if (convDash7) convDash7.click();
        await new Promise((r) => setTimeout(r, 180));
        const afterDash7 = {
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target'),
          sameIframe: container.querySelector('iframe') === iframe0
        };

        // 4. Switch to Saved Look #15 in Content Studio -> connection.loadLook({ id: '15' })
        window.__DAB_STUDIO__.setNativeContent({
          id: '15',
          lookId: '15',
          contentType: 'look',
          title: 'Top Customers Look',
          embedPath: '/embed/looks/15',
          folderId: '5'
        });
        await new Promise((r) => setTimeout(r, 120));
        const afterLook15 = {
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target'),
          sameIframe: container.querySelector('iframe') === iframe0
        };

        // 5. Switch to LookML Dashboard -> connection.loadUrl({ url: '/embed/dashboards/thelook::executive_pulse' })
        window.__DAB_STUDIO__.setNativeContent({
          id: 'thelook::executive_pulse',
          lookmlDashboardId: 'thelook::executive_pulse',
          contentType: 'lookml_dashboard',
          title: 'Executive Pulse (LookML)',
          embedPath: '/embed/dashboards/thelook::executive_pulse',
          folderId: '5'
        });
        await new Promise((r) => setTimeout(r, 120));
        const afterLookmlDash = {
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target'),
          sameIframe: container.querySelector('iframe') === iframe0
        };

        // 6. Click + New Conversation -> connection.loadUrl({ url: '/preload' }) while keeping same iframe warm
        const newBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        if (newBtn) newBtn.click();
        await new Promise((r) => setTimeout(r, 140));
        const afterReset = {
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target'),
          sameIframe: container.querySelector('iframe') === iframe0,
          hasCenteredPrompt: Boolean(document.querySelector('[data-testid="centered-empty-prompt"]'))
        };

        return {
          initialEmbedState,
          afterApp42,
          afterWarmRun,
          afterDash7,
          afterLook15,
          afterLookmlDash,
          afterReset
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      initialEmbedState: {
        state: 'preloaded',
        target: '/preload',
        hasCenteredPrompt: true
      },
      afterApp42: {
        state: 'dashboard',
        target: '42',
        sameIframe: true
      },
      afterWarmRun: {
        hasDashboardRunCall: true,
        sameIframe: true
      },
      afterDash7: {
        state: 'dashboard',
        target: '7',
        sameIframe: true
      },
      afterLook15: {
        state: 'look',
        target: '15',
        sameIframe: true
      },
      afterLookmlDash: {
        state: 'url',
        target: '/embed/dashboards/thelook::executive_pulse',
        sameIframe: true
      },
      afterReset: {
        state: 'preloaded',
        target: '/preload',
        sameIframe: true,
        hasCenteredPrompt: true
      }
    })
  }, 15000)

  test('supports Light, Dark, and System theme modes in topbar, reacts to matchMedia changes, persists to localStorage, and renders dark mode UI (Issue #49)', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    await chrome.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }]
    })
    const url = `http://127.0.0.1:${port}/?scenario=data_app`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="topbar-theme-select"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    // 1. Default mode is 'system' and resolves to 'light' when prefers-color-scheme is light
    const initialCheck = await chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const sel = document.querySelector('[data-testid="topbar-theme-select"]');
        return {
          mode: sel ? sel.value : null,
          options: sel ? Array.from(sel.options).map((o) => o.value) : [],
          attrTheme: document.documentElement.getAttribute('data-theme'),
          attrMode: document.documentElement.getAttribute('data-theme-mode')
        };
      })()`,
      returnByValue: true
    })
    expect(initialCheck.result.value).toEqual({
      mode: 'system',
      options: ['light', 'dark', 'system'],
      attrTheme: 'light',
      attrMode: 'system'
    })

    // 2. Live OS matchMedia('prefers-color-scheme: dark') change while in 'system' mode updates data-theme to 'dark'
    await chrome.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }]
    })
    await new Promise((r) => setTimeout(r, 120))
    const systemDarkCheck = await chrome.send('Runtime.evaluate', {
      expression: `({
        attrTheme: document.documentElement.getAttribute('data-theme'),
        attrMode: document.documentElement.getAttribute('data-theme-mode'),
        selectResolved: document.querySelector('[data-testid="topbar-theme-select"]')?.getAttribute('data-resolved-theme')
      })`,
      returnByValue: true
    })
    expect(systemDarkCheck.result.value).toEqual({
      attrTheme: 'dark',
      attrMode: 'system',
      selectResolved: 'dark'
    })

    // Restore emulated media to light so we can test explicit Dark and Light selection
    await chrome.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }]
    })
    await new Promise((r) => setTimeout(r, 100))

    // 3. Switch topbar theme selector to 'dark', verify persistence & dark computed styles, and switch to 'light'
    const switchRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const sel = document.querySelector('[data-testid="topbar-theme-select"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, 'dark');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));

        const darkThemeAttr = document.documentElement.getAttribute('data-theme');
        const darkModeAttr = document.documentElement.getAttribute('data-theme-mode');
        const storedDark = window.localStorage.getItem('dab_theme_mode');
        const extStoredDark = (window.__LOCAL_STORAGE_UPDATES__ || []).find((u) => u.key === 'dab_theme_mode' && u.value === 'dark');
        const shellStyle = window.getComputedStyle(document.querySelector('.dab-shell'));
        const topbarStyle = window.getComputedStyle(document.querySelector('.dab-topbar'));
        const shellBgDark = shellStyle.backgroundColor;
        const shellColorDark = shellStyle.color;
        const topbarBgDark = topbarStyle.backgroundColor;

        setter.call(sel, 'light');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));

        const lightThemeAttr = document.documentElement.getAttribute('data-theme');
        const storedLight = window.localStorage.getItem('dab_theme_mode');
        const shellBgLight = window.getComputedStyle(document.querySelector('.dab-shell')).backgroundColor;

        return {
          darkThemeAttr,
          darkModeAttr,
          storedDark,
          hasExtStorageCall: Boolean(extStoredDark),
          shellBgDark,
          shellColorDark,
          topbarBgDark,
          lightThemeAttr,
          storedLight,
          shellBgLight
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(switchRes.result.value).toEqual({
      darkThemeAttr: 'dark',
      darkModeAttr: 'dark',
      storedDark: 'dark',
      hasExtStorageCall: true,
      shellBgDark: 'rgb(11, 17, 32)',
      shellColorDark: 'rgb(226, 232, 240)',
      topbarBgDark: 'rgb(17, 24, 39)',
      lightThemeAttr: 'light',
      storedLight: 'light',
      shellBgLight: 'rgb(248, 250, 252)'
    })

    // Copy 18-studio-dark-theme.png to scratch directory for inspection
    const darkSnapPath = path.join(imageSnapshotsDir, '18-studio-dark-theme.png')
    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchDarkPath = path.join(scratchDir, 'issue-49-dark-theme.png')
    writeFileSync(scratchDarkPath, readFileSync(darkSnapPath))
    expect(existsSync(scratchDarkPath)).toBe(true)
  }, 15000)

  test('renders collapsible live & completed Thinking & Activity blocks and write-permission thought banner (Issue #56)', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${port}/?scenario=data_app`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('.dab-chat-log'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const domRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        s.setMessages([
          {
            role: 'user',
            text: 'Build an Executive Revenue Data App with brand share breakdown'
          },
          {
            role: 'assistant',
            text: 'Built Executive Revenue Data App with 4 KPI cards and brand breakdown.',
            dashboardId: '42',
            widgetCount: 5,
            thinkingDurationSec: 4,
            activitySteps: [
              {
                id: 'step_1',
                kind: 'thought',
                title: 'Analyzing thelook::order_items schema & planning 4 KPI tiles',
                status: 'done'
              },
              {
                id: 'step_2',
                kind: 'codemode',
                title: 'Querying monthly revenue and brand share from thelook::order_items',
                detail: 'sdk.lookml_model_explore, sdk.run_inline_query',
                language: 'PYTHON',
                status: 'done'
              },
              {
                id: 'step_3',
                kind: 'code_execution',
                title: 'python3 /workspace/bundle_app.py --app-dir /workspace/apps/42 --stdin "Executive Revenue App"',
                language: 'BASH',
                status: 'done'
              }
            ]
          }
        ]);
        s.setLiveActivitySteps([
          {
            id: 'live_1',
            kind: 'thought',
            title: 'Preparing dashboard tile layout mutation',
            status: 'done'
          },
          {
            id: 'live_2',
            kind: 'codemode',
            title: 'Creating executive KPI dashboard with 4 tiles',
            detail: 'sdk.create_dashboard, sdk.create_dashboard_element',
            language: 'PYTHON',
            status: 'running'
          }
        ]);
        s.setBusyStatus('Creating executive KPI dashboard with 4 tiles');
        void s.requestCodeModePermission({
          operation: 'create_dashboard_element',
          httpMethod: 'POST',
          path: '/api/4.0/dashboard_elements',
          args: { body: { dashboard_id: '42', title: 'Brand Revenue Share' } },
          thought: 'Creating executive KPI dashboard with 4 tiles'
        });
        await new Promise((r) => setTimeout(r, 120));

        const completedEl = document.querySelector('[data-testid="completed-thinking-block"]');
        const liveEl = document.querySelector('[data-testid="live-thinking-block"]');
        const permThoughtEl = document.querySelector('[data-testid="permission-request-thought"]');

        const initiallyCollapsed = completedEl ? !completedEl.open : false;
        const completedSummary = completedEl?.querySelector('summary')?.textContent?.trim() || '';

        // Expand completed thinking block on click so both blocks and step details are visible
        if (completedEl) {
          completedEl.querySelector('summary')?.click();
        }
        await new Promise((r) => setTimeout(r, 80));

        return {
          hasCompletedBlock: Boolean(completedEl),
          initiallyCollapsed,
          expandedAfterClick: Boolean(completedEl?.open),
          completedSummary,
          completedText: completedEl?.textContent || '',
          hasLiveBlock: Boolean(liveEl),
          liveOpenByDefault: Boolean(liveEl?.open),
          liveClassName: liveEl?.className || '',
          liveText: liveEl?.textContent || '',
          permThoughtText: permThoughtEl?.textContent?.trim() || ''
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(domRes.result.value).toMatchObject({
      hasCompletedBlock: true,
      initiallyCollapsed: true,
      expandedAfterClick: true,
      completedSummary: 'Thought for 4s · 3 steps',
      hasLiveBlock: true,
      liveOpenByDefault: true,
      liveClassName: 'dab-thinking-block dab-thinking-live',
      permThoughtText: 'Creating executive KPI dashboard with 4 tiles'
    })
    expect(domRes.result.value.completedText).toContain(
      'Querying monthly revenue and brand share from thelook::order_items'
    )
    expect(domRes.result.value.completedText).toContain('sdk.run_inline_query')
    expect(domRes.result.value.completedText).toContain('bundle_app.py')
    expect(domRes.result.value.liveText).toContain('Thinking & Activity')
    expect(domRes.result.value.liveText).toContain('sdk.create_dashboard')

    const clipRes = await chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const selectors = [
          '[data-testid="completed-thinking-block"]',
          '[data-testid="live-thinking-block"]',
          '.dab-permission-bar'
        ];
        const rects = selectors
          .flatMap((s) => Array.from(document.querySelectorAll(s)))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        if (!rects.length) return null;
        const margin = 16;
        const x = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.left)) - margin));
        const y = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.top)) - margin));
        const right = Math.min(1440, Math.ceil(Math.max(...rects.map((r) => r.right)) + margin));
        const bottom = Math.min(900, Math.ceil(Math.max(...rects.map((r) => r.bottom)) + margin));
        return { x, y, width: right - x, height: bottom - y, scale: 1 };
      })()`,
      returnByValue: true
    })
    const clip = clipRes.result?.value
    expect(clip).toBeTruthy()

    const { data } = await chrome.send('Page.captureScreenshot', {
      format: 'png',
      clip
    })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)

    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchSnapPath = path.join(scratchDir, 'issue-56-thinking-activity-block.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)
  }, 15000)

  test('prevents multi-line button overflow on 28px height, wraps preview toolbar/actions cleanly, and styles ScriptStudioView inputs with .dab-input (Issue #63)', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=python_tile_studio` })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="tile-preview-toolbar"]') && document.querySelector('[data-testid="tile-script-id-input"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const domRes = await chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const toolbar = document.querySelector('[data-testid="tile-preview-toolbar"]');
        const actions = toolbar.querySelector('.dab-preview-actions');
        const titleBlock = document.querySelector('[data-testid="tile-toolbar-title-block"]');
        const toolbarStyle = window.getComputedStyle(toolbar);
        const actionsStyle = window.getComputedStyle(actions);
        const probe = Object.assign(document.createElement('button'), { className: 'dab-btn-secondary' });
        document.body.appendChild(probe);
        const btnRuleDisplay = window.getComputedStyle(probe).display;
        probe.remove();

        const buttonMetrics = Array.from(
          document.querySelectorAll('.dab-right-pane .dab-btn-secondary, .dab-right-pane .dab-btn-primary, .dab-right-pane .dab-btn-gemini')
        ).map((btn) => ({
          whiteSpace: window.getComputedStyle(btn).whiteSpace,
          display: btnRuleDisplay,
          overflowsVertically: btn.scrollHeight > btn.clientHeight + 2
        }));

        const inputs = [
          '[data-testid="tile-script-id-input"]',
          '[data-testid="tile-script-title-input"]',
          '[data-testid="tile-filters-json-input"]'
        ].map((sel) => {
          const el = document.querySelector(sel);
          const cs = window.getComputedStyle(el);
          return {
            hasDabInputClass: el.classList.contains('dab-input'),
            borderRadius: cs.borderRadius,
            backgroundColor: cs.backgroundColor
          };
        });

        const rects = ['[data-testid="tile-preview-toolbar"]', '.dab-right-pane .dab-inspector-bar', '[data-testid="tile-filters-json-input"]']
          .map((s) => document.querySelector(s).getBoundingClientRect());
        const x = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.left)) - 14));
        const y = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.top)) - 14));
        const right = Math.min(1440, Math.ceil(Math.max(...rects.map((r) => r.right)) + 14));
        const bottom = Math.min(900, Math.ceil(Math.max(...rects.map((r) => r.bottom)) + 14));

        return {
          toolbarFlexWrap: toolbarStyle.flexWrap,
          toolbarGap: parseFloat(toolbarStyle.gap || toolbarStyle.columnGap || '0'),
          actionsFlexWrap: actionsStyle.flexWrap,
          actionsGap: parseFloat(actionsStyle.gap || actionsStyle.columnGap || '0'),
          titleDisplay: titleBlock.style.display,
          titleFlexWrap: window.getComputedStyle(titleBlock).flexWrap,
          buttonMetrics,
          inputs,
          clip: { x, y, width: right - x, height: bottom - y, scale: 1 }
        };
      })()`,
      returnByValue: true
    })

    const v = domRes.result.value
    expect(v).toMatchObject({
      toolbarFlexWrap: 'wrap',
      actionsFlexWrap: 'wrap',
      titleDisplay: 'inline-flex',
      titleFlexWrap: 'wrap'
    })
    expect(v.toolbarGap).toBeGreaterThanOrEqual(8)
    expect(v.actionsGap).toBeGreaterThanOrEqual(6)
    expect(v.buttonMetrics.length).toBeGreaterThanOrEqual(4)
    for (const b of v.buttonMetrics) {
      expect(b).toEqual({ whiteSpace: 'nowrap', display: 'inline-flex', overflowsVertically: false })
    }
    expect(v.inputs).toHaveLength(3)
    for (const inp of v.inputs) {
      expect(inp).toEqual({ hasDabInputClass: true, borderRadius: '6px', backgroundColor: 'rgb(255, 255, 255)' })
    }

    const { data } = await chrome.send('Page.captureScreenshot', { format: 'png', clip: v.clip })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)
    const scratchDir = '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchSnapPath = path.join(scratchDir, 'issue-63-script-toolbar.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)
  }, 15000)

  test('renders mode-aware starter prompt buttons in empty state without Solr/WASM jargon, populates studio-prompt-input on click, and places model selector in composer footer (Issue #59)', async () => {
    const url = `http://127.0.0.1:${port}/?scenario=centered_empty_prompt`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="starter-prompt-list"] button[data-testid^="starter-prompt-"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const heroEl = document.querySelector('.dab-empty-hero');
        const hasJargon = /search_content|lookml_model_explore|Solr/i.test(heroEl ? heroEl.innerText : '');
        const starterBtns = Array.from(document.querySelectorAll('[data-testid="starter-prompt-list"] button[data-testid^="starter-prompt-"]'));
        starterBtns[0]?.click();
        await new Promise((r) => setTimeout(r, 60));
        const ta = document.querySelector('[data-testid="studio-prompt-input"]');
        const promptAfterClick = ta ? ta.value : '';

        const ucSelect = document.querySelector('[data-testid="use-case-selector"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(ucSelect, 'tile');
        ucSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));

        const tileBtns = Array.from(document.querySelectorAll('[data-testid="starter-prompt-list"] button[data-testid^="starter-prompt-"]'));
        tileBtns[0]?.click();
        await new Promise((r) => setTimeout(r, 60));
        const promptAfterTileClick = ta ? ta.value : '';
        const tilePlaceholder = ta ? ta.getAttribute('placeholder') || '' : '';

        setter.call(ucSelect, 'auto');
        ucSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const r = document.querySelector('.dab-empty-prompt-card')?.getBoundingClientRect();
        const clip = r ? { x: Math.max(0, Math.floor(r.left - 16)), y: Math.max(0, Math.floor(r.top - 16)), width: Math.min(1440, Math.ceil(r.width + 32)), height: Math.min(900, Math.ceil(r.height + 32)), scale: 1 } : null;

        return {
          hasJargon,
          autoChipCount: starterBtns.length,
          promptAfterClick,
          tileChipCount: tileBtns.length,
          promptAfterTileClick,
          tilePlaceholder,
          hasComposerModelSelect: Boolean(document.querySelector('.dab-composer-actions [data-testid="composer-model-select"]')),
          noTopbarModelSelect: !document.querySelector('.dab-topbar [data-testid="topbar-model-select"]'),
          noComposerInspector: !document.querySelector('.dab-composer-actions .dab-inspector'),
          clip
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toMatchObject({
      hasJargon: false,
      autoChipCount: 4,
      promptAfterClick:
        'Build an Executive Revenue Data App on order_items with Total Revenue, Total Orders, Avg Order Value KPIs and a monthly trend chart.',
      tileChipCount: 3,
      promptAfterTileClick:
        'Write a Script summarizing visible LookML models, explores, and active dashboard filters as a table.',
      tilePlaceholder: 'Describe the Script to generate or update (or paste a screenshot)...',
      hasComposerModelSelect: true,
      noTopbarModelSelect: true,
      noComposerInspector: true
    })

    const clip = res.result.value.clip
    expect(clip).toBeTruthy()
    const { data } = await chrome.send('Page.captureScreenshot', { format: 'png', clip })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)

    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchSnapPath = path.join(scratchDir, 'issue-59-composer-starters.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)
  }, 15000)

  test('gates chat submission when signed out with inline Sign In button, prevents hanging oauth2Authenticate popup from locking busyStatus, and surfaces copyable Authorized Redirect URI in /config (Issue #65)', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${port}/?scenario=centered_empty_prompt`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="studio-send-btn"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    // 1. Verify signed-out state: Send button is disabled, inline Sign In button is rendered, and Cmd+Enter does NOT clear prompt or start a turn
    const signedOutRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const ta = document.querySelector('[data-testid="studio-prompt-input"]');
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        taSetter.call(ta, 'Build an executive revenue dashboard');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const sendBtn = document.querySelector('[data-testid="studio-send-btn"]');
        const inlineSignInBtn = document.querySelector('[data-testid="composer-signin-inline-btn"]');
        const sendDisabledWhenSignedOut = Boolean(sendBtn?.disabled);
        const inlineSignInText = (inlineSignInBtn?.textContent || '').trim();
        const inlineSignInClass = inlineSignInBtn?.className || '';

        // Attempt Cmd+Enter and clicking disabled Send button while signed out
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
        sendBtn?.click();
        await new Promise((r) => setTimeout(r, 80));

        const promptPreserved = ta.value === 'Build an executive revenue dashboard';
        const stillEmptyCentered = Boolean(document.querySelector('[data-testid="centered-empty-prompt"]'));
        const useCaseStillUnlocked = Boolean(document.querySelector('[data-testid="use-case-selector"]'));
        const noErrorBanner = !document.querySelector('.dab-msg-error');

        // 2. Simulate hanging oauth2Authenticate (e.g. closed popup or Error 400: redirect_uri_mismatch)
        window.__MOCK_LOOKER_EXTENSION__.oauthFocusReturnDelayMs = 80;
        window.__MOCK_OAUTH_IMPL__ = () => new Promise(() => {});
        inlineSignInBtn?.click();
        await new Promise((r) => setTimeout(r, 40));

        const cancelBtnDuringSignIn = document.querySelector('[data-testid="topbar-oauth-cancel-btn"]');
        const topbarSignInBtn = document.querySelector('[data-testid="topbar-oauth-signin-btn"]');
        const newConvBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        const busyBannerDuringOAuth = document.querySelector('.dab-status-banner');
        const duringHangingPopup = {
          hasCancelBtn: Boolean(cancelBtnDuringSignIn),
          topbarSignInText: (topbarSignInBtn?.textContent || '').trim(),
          topbarSignInDisabled: Boolean(topbarSignInBtn?.disabled),
          promptInputDisabled: Boolean(ta.disabled),
          newConvDisabled: Boolean(newConvBtn?.disabled),
          hasGlobalBusyBanner: Boolean(busyBannerDuringOAuth)
        };

        // 3. Simulate host window regaining focus after popup closed/failed -> clears oauthSigningIn after settle delay
        window.dispatchEvent(new Event('focus'));
        await new Promise((r) => setTimeout(r, 150));
        const afterFocusRecovery = {
          hasCancelBtn: Boolean(document.querySelector('[data-testid="topbar-oauth-cancel-btn"]')),
          topbarSignInText: (document.querySelector('[data-testid="topbar-oauth-signin-btn"]')?.textContent || '').trim()
        };

        // 4. Re-click Sign In and cancel immediately via Cancel Sign-In button
        document.querySelector('[data-testid="topbar-oauth-signin-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        const hasCancelBeforeClick = Boolean(document.querySelector('[data-testid="topbar-oauth-cancel-btn"]'));
        document.querySelector('[data-testid="topbar-oauth-cancel-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        const hasCancelAfterClick = Boolean(document.querySelector('[data-testid="topbar-oauth-cancel-btn"]'));

        // 5. Restore working OAuth mock and click inline Sign In button -> enables Send button
        window.__MOCK_OAUTH_IMPL__ = null;
        document.querySelector('[data-testid="composer-signin-inline-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const afterSuccessSignIn = {
          sendDisabled: Boolean(document.querySelector('[data-testid="studio-send-btn"]')?.disabled),
          hasInlineSignInBtn: Boolean(document.querySelector('[data-testid="composer-signin-inline-btn"]')),
          topbarText: (document.querySelector('[data-testid="topbar-oauth-signin-btn"]')?.textContent || '').trim()
        };

        // Reset back to signed-out so we can also test missing clientId -> /config navigation & screenshot
        window.__DAB_STUDIO__.setOauthToken('');
        await new Promise((r) => setTimeout(r, 50));

        return {
          sendDisabledWhenSignedOut,
          inlineSignInText,
          inlineSignInClass,
          promptPreserved,
          stillEmptyCentered,
          useCaseStillUnlocked,
          noErrorBanner,
          duringHangingPopup,
          afterFocusRecovery,
          hasCancelBeforeClick,
          hasCancelAfterClick,
          afterSuccessSignIn
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(signedOutRes.result.value).toEqual({
      sendDisabledWhenSignedOut: true,
      inlineSignInText: 'Sign in to send',
      inlineSignInClass: 'dab-inline-signin-btn',
      promptPreserved: true,
      stillEmptyCentered: true,
      useCaseStillUnlocked: true,
      noErrorBanner: true,
      duringHangingPopup: {
        hasCancelBtn: true,
        topbarSignInText: 'Retry Sign In',
        topbarSignInDisabled: false,
        promptInputDisabled: false,
        newConvDisabled: false,
        hasGlobalBusyBanner: false
      },
      afterFocusRecovery: {
        hasCancelBtn: false,
        topbarSignInText: 'Sign In'
      },
      hasCancelBeforeClick: true,
      hasCancelAfterClick: false,
      afterSuccessSignIn: {
        sendDisabled: false,
        hasInlineSignInBtn: false,
        topbarText: '✓ Signed In'
      }
    })

    // Navigate to /config and verify Authorized Redirect URI helper + Copy button
    const configRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DAB_STUDIO__.setClientId('');
        await new Promise((r) => setTimeout(r, 40));
        const missingClientBtnText = (document.querySelector('[data-testid="composer-signin-inline-btn"]')?.textContent || '').trim();
        document.querySelector('[data-testid="composer-signin-inline-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 80));

        const routeAfterClick = window.__DAB_STUDIO__.history.location.pathname;
        const redirectUriEl = document.querySelector('[data-testid="config-oauth-redirect-uri"]');
        const copyBtn = document.querySelector('[data-testid="config-copy-redirect-uri-btn"]');
        const redirectUriText = (redirectUriEl?.textContent || '').trim();
        const copyBtnInitialText = (copyBtn?.textContent || '').trim();
        copyBtn?.click();
        await new Promise((r) => setTimeout(r, 40));
        const copyBtnAfterText = (copyBtn?.textContent || '').trim();

        const helperRect = document.querySelector('.dab-oauth-redirect-helper')?.getBoundingClientRect();
        const clip = helperRect
          ? {
              x: Math.max(0, Math.floor(helperRect.left - 20)),
              y: Math.max(0, Math.floor(helperRect.top - 20)),
              width: Math.min(1440, Math.ceil(helperRect.width + 40)),
              height: Math.min(900, Math.ceil(helperRect.height + 40)),
              scale: 1
            }
          : null;

        return {
          missingClientBtnText,
          routeAfterClick,
          redirectUriText,
          copyBtnInitialText,
          copyBtnAfterText,
          clip
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(configRes.result.value).toMatchObject({
      missingClientBtnText: 'Configure credentials to send',
      routeAfterClick: '/config',
      redirectUriText: 'https://dev-argolis.looker.com/extensions/oauth2_redirect',
      copyBtnInitialText: 'Copy Redirect URI',
      copyBtnAfterText: '✓ Copied Redirect URI'
    })
    expect(configRes.result.value.clip).toBeTruthy()

    const { data } = await chrome.send('Page.captureScreenshot', {
      format: 'png',
      clip: configRes.result.value.clip
    })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(500)
    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchSnapPath = path.join(scratchDir, 'issue-65-auth-gate-redirect-uri.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)
  }, 15000)
})
