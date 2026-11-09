// Jest visual & DOM snapshot suite for all 5 Studio mini-apps, Config page,
// Explore combobox scroll states, Chat Bar states, and Custom Script Scheduler modal
// using MockLookerExtensionProvider (window.__MOCK_LOOKER_EXTENSION__).
const { execFileSync, spawn } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '../..')
const bundlePath = path.join(repoRoot, 'dist/bundle.js')
const codemodePath = path.join(repoRoot, 'src/vendor/codemode.js')
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
  <meta name="viewport" content="width=device-width, initial-scale=1" />
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
        studio_dark_theme: '/c/conv_app_42',
        ripper_surf_loader: '/c/conv_app_42'
      };

      try {
        if (scenario === 'studio_dark_theme') {
          window.localStorage.setItem('dab_theme_mode', 'dark');
        } else if (!window.location.search.includes('preserveTheme=1')) {
          window.localStorage.removeItem('dab_theme_mode');
        }
        if (!window.location.search.includes('preserveOAuth=1')) {
          window.localStorage.removeItem('dab_oauth_session');
        }
        if (!window.location.search.includes('preserveFolder=1')) {
          window.localStorage.removeItem('dab_selected_folder_id');
        }
        if (!window.location.search.includes('preserveLayout=1')) {
          window.localStorage.removeItem('dab_left_pane_width');
          window.localStorage.removeItem('dab_right_pane_collapsed');
        }
        if (!window.location.search.includes('preserveBusyAction=1')) {
          window.localStorage.removeItem('dab_busy_send_action');
        }
        if (!window.location.search.includes('preserveThinkingLevel=1')) {
          window.localStorage.removeItem('dab_thinking_level');
        }
      } catch {}

      const isTile =
        scenario === 'tile_mount_view' ||
        scenario === 'tile_mount_edit' ||
        scenario === 'tile_mount_unbound';

      const mockCore40SDK = {
        ok: async (p) => p,
        me: async () => ({ id: '1', display_name: 'Bryan Weber', personal_folder_id: '5' }),
        session: async () => ({
          workspace_id: window.location.search.includes('devMode=1') ? 'dev' : 'production'
        }),
        update_session: async (body) => ({
          workspace_id: (body && body.workspace_id) || 'production'
        }),
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
        lookml_model_explore: async (modelName, exploreName) => {
          if (exploreName === 'jobs_timeline') {
            return {
              id: modelName + '::' + exploreName,
              name: exploreName,
              label: 'Jobs Timeline (By Period)',
              model_name: modelName,
              fields: {
                dimensions: [
                  { name: 'jobs_timeline.job_type', label_short: 'Job Type', type: 'string' },
                  { name: 'jobs_timeline.creation_time', label_short: 'Creation Time', type: 'date_time' }
                ],
                measures: [
                  { name: 'jobs_timeline.total_slot_ms', label_short: 'Total Slot Ms', type: 'sum' },
                  { name: 'jobs_timeline.total_bytes_billed', label_short: 'Total Bytes Billed', type: 'sum' }
                ]
              }
            };
          }
          if (exploreName === 'store_transactions') {
            return {
              id: modelName + '::' + exploreName,
              name: exploreName,
              label: 'Store Transactions',
              model_name: modelName,
              fields: {
                dimensions: [
                  { name: 'store_transactions.store_region', label_short: 'Store Region', type: 'string' },
                  { name: 'store_transactions.transaction_month', label_short: 'Transaction Month', type: 'date_month' }
                ],
                measures: [
                  { name: 'store_transactions.net_sales', label_short: 'Net Sales', type: 'sum' },
                  { name: 'store_transactions.basket_count', label_short: 'Basket Count', type: 'count' }
                ]
              }
            };
          }
          return {
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
          };
        },
        all_folders: async () => [
          { id: '5', name: 'Bryan Weber (Personal)', parent_id: '2', is_personal: true, child_count: 1 },
          { id: '1', name: 'Shared', parent_id: null, is_personal: false, child_count: 1 },
          { id: '501', name: 'Marketing Analytics', parent_id: '1', is_personal: false, child_count: 1 },
          { id: '502', name: 'subfolder test', parent_id: '501', is_personal: false, child_count: 0 },
          { id: '503', name: 'Personal Experiments', parent_id: '5', is_personal: true, child_count: 0 }
        ],
        folder_children: async (params) => {
          const pid = String((params && params.folder_id) || params || '');
          const map = {
            '5': [
              { id: '503', name: 'Personal Experiments', parent_id: '5', is_personal: true, child_count: 0 }
            ],
            '1': [
              { id: '501', name: 'Marketing Analytics', parent_id: '1', is_personal: false, child_count: 1 }
            ],
            '501': [
              { id: '502', name: 'subfolder test', parent_id: '501', is_personal: false, child_count: 0 }
            ]
          };
          return map[pid] || [];
        },
        folder: async (params) => {
          const fid = String((params && params.folder_id) || params || '');
          const map = {
            '5': { id: '5', name: 'My folder', parent_id: '2', is_personal: true, child_count: 1 },
            '1': { id: '1', name: 'Shared folders', parent_id: null, is_personal: false, child_count: 1 },
            '501': { id: '501', name: 'Marketing Analytics', parent_id: '1', is_personal: false, child_count: 1 },
            '502': { id: '502', name: 'subfolder test', parent_id: '501', is_personal: false, child_count: 0 },
            '503': { id: '503', name: 'Personal Experiments', parent_id: '5', is_personal: true, child_count: 0 }
          };
          return map[fid] || { id: fid, name: 'Folder ' + fid, parent_id: '1', child_count: 0 };
        },
        folder_ancestors: async (params) => {
          const fid = String((params && params.folder_id) || params || '');
          if (fid === '502') {
            return [
              { id: '1', name: 'Shared folders', parent_id: null, is_personal: false, child_count: 1 },
              { id: '501', name: 'Marketing Analytics', parent_id: '1', is_personal: false, child_count: 1 }
            ];
          }
          if (fid === '501') {
            return [
              { id: '1', name: 'Shared folders', parent_id: null, is_personal: false, child_count: 1 }
            ];
          }
          return [];
        },
        search_folders: async (params) => {
          const all = [
            { id: '5', name: 'My folder', parent_id: '2', is_personal: true, creator_id: '1', child_count: 1 },
            { id: '1', name: 'Shared folders', parent_id: null, is_personal: false, child_count: 1 },
            { id: '501', name: 'Marketing Analytics', parent_id: '1', is_personal: false, child_count: 1 },
            { id: '502', name: 'subfolder test', parent_id: '501', is_personal: false, child_count: 0 },
            { id: '503', name: 'Personal Experiments', parent_id: '5', is_personal: true, creator_id: '1', child_count: 0 }
          ];
          const p = params || {};
          return all.filter((f) => {
            if (p.id && String(f.id) !== String(p.id)) return false;
            if (p.parent_id && String(f.parent_id || '') !== String(p.parent_id)) return false;
            if (p.creator_id && String(f.creator_id || '') !== String(p.creator_id)) return false;
            if (typeof p.is_personal === 'boolean' && Boolean(f.is_personal) !== p.is_personal) return false;
            if (p.name) {
              const needle = String(p.name).replace(/%/g, '').toLowerCase();
              if (needle && !String(f.name).toLowerCase().includes(needle)) return false;
            }
            return true;
          });
        },
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
        delete_artifact: async (_ns, keys) => {
          window.__DELETED_ARTIFACTS__ = window.__DELETED_ARTIFACTS__ || [];
          for (const k of String(keys || '').split(',')) {
            const clean = k.trim();
            if (!clean) continue;
            window.__DELETED_ARTIFACTS__.push(clean);
            delete artifactObjects[clean];
            const idx = catalogEntries.findIndex((e) => e.key === clean);
            if (idx >= 0) catalogEntries.splice(idx, 1);
          }
          return {};
        },
        delete_dashboard: async (id) => {
          window.__DELETED_DASHBOARDS__ = window.__DELETED_DASHBOARDS__ || [];
          window.__DELETED_DASHBOARDS__.push(String(id));
          return {};
        },
        delete_look: async (id) => {
          window.__DELETED_LOOKS__ = window.__DELETED_LOOKS__ || [];
          window.__DELETED_LOOKS__.push(String(id));
          return {};
        },
        content_summary: async () => [
          {
            id: 'cs_1',
            content_type: 'dashboard',
            content_id: '901',
            title: 'Business Pulse',
            description: 'Executive KPIs and order margin breakdown',
            view_count: 142
          },
          {
            id: 'cs_2',
            content_type: 'look',
            content_id: '301',
            title: 'Monthly Order Margin Look',
            description: 'Monthly revenue and gross margin trend',
            view_count: 64
          }
        ],
        search_content: async (params) => {
          const t = String((params && params.terms) || '').toLowerCase();
          const all = [
            { content_id: '901', type: 'dashboard', title: 'Business Pulse', description: 'Executive KPIs and order margin breakdown' },
            { content_id: '301', type: 'look', title: 'Monthly Order Margin Look', description: 'Monthly revenue and gross margin trend' }
          ];
          return all.filter((item) => !t || item.title.toLowerCase().includes(t));
        },
        look: async (idOrParams) => {
          const lid = String((idOrParams && idOrParams.look_id) || idOrParams || '301');
          return {
            id: lid,
            title: 'Monthly Order Margin Look',
            folder_id: '5',
            query: {
              model: 'thelook',
              view: 'order_items',
              fields: ['order_items.created_month', 'order_items.total_sale_price'],
              sorts: ['order_items.created_month desc'],
              limit: '12'
            }
          };
        },
        dashboard: async (id) => {
          const did = String((id && id.dashboard_id) || id || '');
          if (did === '901') {
            return {
              id: '901',
              title: 'Business Pulse',
              description: 'Executive KPIs and order margin breakdown',
              folder: { id: '5' },
              dashboard_filters: [{ name: 'Created Date', field: 'order_items.created_date', default_value: '30 days' }],
              dashboard_elements: [
                {
                  id: '9011',
                  title: 'Revenue by Category',
                  type: 'vis',
                  query: {
                    model: 'thelook',
                    view: 'order_items',
                    fields: ['products.category', 'order_items.total_sale_price'],
                    sorts: ['order_items.total_sale_price desc'],
                    limit: '10'
                  }
                }
              ],
              dashboard_layouts: [{ id: '9012', type: 'newspaper', active: true }]
            };
          }
          if (did === '7') {
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
              if (reqPath.includes('content_summary')) {
                const items = await mockCore40SDK.content_summary(queryParams || {});
                return { ok: true, statusCode: 200, body: JSON.stringify(items) };
              }
              if (reqPath.includes('global_search_v2')) {
                const term = String((queryParams && queryParams.term) || '').toLowerCase();
                const items = [
                  { content_type: 'dashboard', content_id: '901', title: 'Business Pulse', description: 'Executive KPIs and order margin breakdown' },
                  { content_type: 'look', content_id: '301', title: 'Monthly Order Margin Look', description: 'Monthly revenue and gross margin trend' },
                  { content_type: 'explore', id: 'thelook::order_items', model_name: 'thelook', explore_name: 'order_items', title: 'Order Items' }
                ].filter((it) => !term || it.title.toLowerCase().includes(term));
                return { ok: true, statusCode: 200, body: JSON.stringify({ results: items }) };
              }
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
        openBrowserWindow: (url, target) => {
          window.__OPENED_WINDOWS__ = window.__OPENED_WINDOWS__ || [];
          window.__OPENED_WINDOWS__.push({ url, target });
        },
        clipboardWrite: async (text) => {
          window.__CLIPBOARD_WRITES__ = window.__CLIPBOARD_WRITES__ || [];
          window.__CLIPBOARD_WRITES__.push(text);
        },
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
        updateTitle: (title) => {
          window.__UPDATED_TITLES__ = window.__UPDATED_TITLES__ || [];
          window.__UPDATED_TITLES__.push(title);
        },
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
            ? '/lookml'
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
            ? 'Executing Looker queries for Order Items...'
            : null,
        initialError:
          scenario === 'chatbar_error_banner'
            ? 'Looker API Error (422): Field "order_items.unknown_metric" not found in explore "thelook::order_items".'
            : null,
        openSchedulerModal: scenario === 'python_tile_scheduler_modal',
        forceAppInitializing: scenario === 'ripper_surf_loader',
        environmentFiles: {
          '/workspace/analysis.md': '# Q4 Revenue Drop Root-Cause Analysis\\n\\n- **Primary Driver:** Outerwear stockouts in West region (-$420K YoY)\\n- **Secondary Driver:** Shipping carrier delay on express orders',
          '/workspace/report.md': '# Executive Remediation Report\\n\\n1. Rebalance West warehouse inventory\\n2. Enable fallback regional carrier routing'
        },
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
  <script src="/codemode.js"></script>
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
      } catch {
        /* ignore */
      }
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
      } catch {
        /* ignore */
      }
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
    const codemodeContent = readFileSync(codemodePath)
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/codemode.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        })
        res.end(codemodeContent)
        return
      }
      if (url.pathname === '/bundle.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        })
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
    } catch {
      /* ignore */
    }
  })

  const scenarios = [
    {
      id: 'data_app',
      category: 'Mini-App Modes',
      title: '1. Data App Mode + Inline Mutation Permission Gate',
      snapshotName: '01-mode-data-app-and-permission-gate-snap.png',
      expectText: [
        'Ripper',
        'Data App',
        'Safe Mode (Ask)',
        'Approve Looker State Mutation?',
        'create_dashboard',
        'Executive Revenue App',
        'Send Message'
      ]
    },
    {
      id: 'dashboard',
      category: 'Mini-App Modes',
      title: '2. Content Studio Mode (Create & Update UDDs, Looks, Boards, Schedules)',
      snapshotName: '02-mode-native-dashboard-builder-snap.png',
      expectText: [
        'Executive Order Performance (Native UDD)',
        '/embed/dashboards/7',
        'Update Content'
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
        'bronze/orders.refinement.lkml',
        'Update LookML'
      ]
    },
    {
      id: 'health_check',
      category: 'Mini-App Modes',
      title: '4. 3-Pillar Health Check Mode (Rendered Markdown Viewer & Top-Right Gemini Button)',
      snapshotName: '04-mode-3-pillar-health-check-snap.png',
      expectText: [
        'Run 3-Pillar Audit',
        'All 3 Pillars (Looker + BQ)',
        'Health Score: 70% (B- (Optimization Recommended))',
        'Transcriber: 2.86/4.00',
        'Technical Design Document (TDD): Looker & BigQuery 3-Pillar Health Check',
        '{ } Raw Markdown',
        'Copy Markdown',
        'Download Markdown (.md)'
      ]
    },
    {
      id: 'python_tile_studio',
      category: 'Mini-App Modes',
      title: '5. Python Tile Studio Mode (Mode Selector, Schedule Script & Live Grid)',
      snapshotName: '05-mode-python-tile-studio-snap.png',
      expectText: [
        'Looker Explore & Filter Summary',
        'Schedule Script',
        'Publish Dashboard',
        'Run Python',
        'Ask AI',
        'Scheduled: 0 8 * * * · summary',
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
        'Configuration',
        'Agent & Vertex / Gemini Setup',
        'Google OAuth',
        'Save Setup'
      ]
    },
    {
      id: 'explore_dropdown_open_top',
      category: 'Config & Explore Dropdown',
      title: '9. Explore Combobox Dropdown — Open (Top Scroll State)',
      snapshotName: '09-explore-dropdown-open-top-snap.png',
      clipSelector: ['[data-testid="composer-at-mention-menu"]', '.dab-composer'],
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
      clipSelector: ['[data-testid="composer-at-mention-menu"]', '.dab-composer'],
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
      clipSelector: ['[data-testid="composer-slash-skill-menu"]', '.dab-composer'],
      expectText: [
        '/lookml-field-curation',
        '/lookml-tests',
        '/lookml-snapshot',
        'Run Agentic LookML'
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
        'Send Message'
      ]
    },
    {
      id: 'chatbar_busy_running',
      category: 'Chat Bar States',
      title: '13. Chat Bar State — Busy / Running Spinner Banner',
      snapshotName: '13-chatbar-state-busy-running-snap.png',
      clipSelector: ['.dab-status-banner', '.dab-composer'],
      expectText: [
        'Executing Looker queries for Order Items...',
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
        'Custom CodeMode Script Scheduler',
        'obj_schedule_demo1',
        'Daily at 8:00 AM (0 8 * * *)',
        'Script Execution Mode (`vars.mode`)',
        'Custom Controls / Non-Query Variables (`vars.custom_controls` JSON)',
        'Save Script Schedule'
      ]
    },
    {
      id: 'conversational_analytics',
      category: 'Mini-App Modes',
      title: '16. Conversational Analytics Mode (Isolated Sub-Agent Selection & Embedded CA Chat)',
      snapshotName: '16-mode-conversational-analytics-snap.png',
      expectText: [
        'Conversational Analytics',
        'BigQuery Streaming Buffer & Order Revenue Q&A',
        'Agent: eCommerce & BigQuery Analytics Agent (ca_agent_ecommerce)',
        'Isolated Sub-Agent Selection:',
        '/embed/conversations/ca_conv_streaming_1',
        'Ask CA Agent'
      ]
    },
    {
      id: 'centered_empty_prompt',
      category: 'Chat Bar States',
      title: '17. Centered New-Conversation Empty Prompt Box (Use-Case Selector, Input & Actions)',
      snapshotName: '17-centered-empty-prompt-snap.png',
      clipSelector: '.dab-empty-prompt-card',
      expectText: [
        'Ripper is ready',
        'Send Message'
      ]
    },
    {
      id: 'studio_dark_theme',
      category: 'Mini-App Modes',
      title: '18. Studio Dark Theme Mode (Semantic Dark Surface & Text Tokens)',
      snapshotName: '18-studio-dark-theme.png',
      expectText: [
        'Ripper',
        'Executive Revenue App',
        'Send Message'
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
            const dd =
              document.querySelector('[data-testid="composer-at-mention-menu"]') ||
              document.querySelector('.dab-dropdown');
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
        const useCaseOptionsAfterSave = (window.__DAB_STUDIO__.useCaseOptions || []).map((o) => o.value);
        const text = document.body ? document.body.innerText : '';
        // Navigate to disabled route /lookml/20261030_dev_branch and verify redirect back to '/'
        window.__DAB_STUDIO__.history.push('/lookml/20261030_dev_branch');
        await new Promise((r) => setTimeout(r, 120));
        const routeAfterDisabledPush = window.__DAB_STUDIO__.history.location.pathname;
        const noTopbarModeSwitcher = !document.querySelector('.dab-mode-switcher');
        return {
          savedDisabledModes: window.__LAST_SAVED_CONTEXT_DATA__?.disabledModes || [],
          useCaseOptionsAfterSave,
          hasFilteredCatalogCount: text.includes('Conversations (2)') && !document.querySelector('.dab-catalog-bar'),
          routeAfterDisabledPush,
          noTopbarModeSwitcher
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(afterSave.result.value).toEqual({
      savedDisabledModes: ['lookml', 'health', 'tile'],
      useCaseOptionsAfterSave: [
        'auto',
        'dashboard',
        'conversational-analytics',
        'app',
        'data-investigator'
      ],
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

        const thinkingSelect = document.querySelector('[data-testid="config-default-thinking-level-select"]');
        const initialThinkingDefault = thinkingSelect ? thinkingSelect.value : '';
        const thinkingOptionIds = thinkingSelect ? Array.from(thinkingSelect.options).map((o) => o.value) : [];

        const maxTokensSelect = document.querySelector('[data-testid="config-max-total-tokens-select"]');
        const initialMaxTokensDefault = maxTokensSelect ? maxTokensSelect.value : '';
        const maxTokensOptionIds = maxTokensSelect ? Array.from(maxTokensSelect.options).map((o) => o.value) : [];

        const setReactSelect = (sel, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, val);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setReactSelect(configSelect, 'gemini-4-argon');
        setReactSelect(maxTokensSelect, '262144');
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

        const triggerBtn = document.querySelector('[data-testid="composer-model-select-trigger"]');
        const beforeTriggerRect = triggerBtn ? triggerBtn.getBoundingClientRect() : null;
        if (triggerBtn) triggerBtn.click();
        await new Promise((r) => setTimeout(r, 60));

        const menuOptionOrder = Array.from(
          document.querySelectorAll('[data-testid="composer-model-select-menu"] > .dab-studio-menu-item-row > [role="option"]')
        ).map((el) => el.getAttribute('data-value'));
        const argonOption = document.querySelector('[data-testid="composer-model-select-option-gemini-4-argon"]');
        const argonRowSubLabel = (argonOption?.querySelector('.dab-studio-menu-sublabel')?.textContent || '').trim();
        if (argonOption) {
          argonOption.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        }
        await new Promise((r) => setTimeout(r, 60));

        const flyoutMenu = document.querySelector('[data-testid="composer-thinking-level-menu"]');
        const flyoutOptionIds = Array.from(flyoutMenu?.querySelectorAll('[role="menuitemradio"]') || []).map((el) =>
          el.getAttribute('data-testid')
        );
        const mediumOption = document.querySelector('[data-testid="thinking-level-option-medium"]');
        const mediumInitiallyChecked = mediumOption?.getAttribute('aria-checked') === 'true';

        const menuEl = document.querySelector('[data-testid="composer-model-select-menu"]');
        const menuRect = menuEl ? menuEl.getBoundingClientRect() : null;
        const flyoutRect = flyoutMenu ? flyoutMenu.getBoundingClientRect() : null;
        const unionClip = menuRect && flyoutRect ? {
          x: Math.max(0, Math.floor(Math.min(menuRect.left, flyoutRect.left) - 24)),
          y: Math.max(0, Math.floor(Math.min(menuRect.top, flyoutRect.top) - 24)),
          width: Math.min(1440, Math.ceil(Math.max(menuRect.right, flyoutRect.right) - Math.min(menuRect.left, flyoutRect.left) + 48)),
          height: Math.min(900, Math.ceil(Math.max(menuRect.bottom, flyoutRect.bottom) - Math.min(menuRect.top, flyoutRect.top) + 48)),
          scale: 1
        } : null;

        const highOption = document.querySelector('[data-testid="thinking-level-option-high"]');
        if (highOption) highOption.click();
        await new Promise((r) => setTimeout(r, 60));

        const afterHighModel = composerSelect ? composerSelect.value : '';
        const afterHighThinkingLevel = window.__DAB_STUDIO__?.thinkingLevel;
        const afterTriggerRect = triggerBtn ? triggerBtn.getBoundingClientRect() : null;
        const noTriggerHeightShift =
          beforeTriggerRect && afterTriggerRect
            ? Math.abs(beforeTriggerRect.height - afterTriggerRect.height) <= 1
            : false;

        return {
          initialDefault,
          optionIds,
          initialThinkingDefault,
          thinkingOptionIds,
          initialMaxTokensDefault,
          maxTokensOptionIds,
          savedDefaultModel: window.__LAST_SAVED_CONTEXT_DATA__?.defaultModel,
          savedDefaultThinkingLevel: window.__LAST_SAVED_CONTEXT_DATA__?.defaultThinkingLevel,
          savedMaxTotalTokens: window.__LAST_SAVED_CONTEXT_DATA__?.maxTotalTokens,
          noTopbarModelSelect,
          noComposerInspector,
          syncedComposerModel,
          afterLiteSwitch,
          afterFlashSwitch,
          menuOptionOrder,
          argonRowSubLabel,
          flyoutOptionIds,
          mediumInitiallyChecked,
          afterHighModel,
          afterHighThinkingLevel,
          noTriggerHeightShift,
          unionClip
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    const { unionClip, ...modelSelectResult } = res.result.value
    expect(modelSelectResult).toEqual({
      initialDefault: 'gemini-3.8-flash',
      optionIds: [
        'gemini-4-argon',
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite'
      ],
      initialThinkingDefault: 'high',
      thinkingOptionIds: ['low', 'medium', 'high'],
      initialMaxTokensDefault: '131072',
      maxTokensOptionIds: ['32768', '65536', '131072', '262144'],
      savedDefaultModel: 'gemini-4-argon',
      savedDefaultThinkingLevel: 'high',
      savedMaxTotalTokens: 262144,
      noTopbarModelSelect: true,
      noComposerInspector: true,
      syncedComposerModel: 'gemini-4-argon',
      afterLiteSwitch: 'gemini-3.5-flash-lite',
      afterFlashSwitch: 'gemini-3.8-flash',
      menuOptionOrder: [
        'gemini-4-argon',
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite'
      ],
      argonRowSubLabel: 'High',
      flyoutOptionIds: [
        'thinking-level-option-low',
        'thinking-level-option-medium',
        'thinking-level-option-high'
      ],
      mediumInitiallyChecked: false,
      afterHighModel: 'gemini-4-argon',
      afterHighThinkingLevel: 'high',
      noTriggerHeightShift: true
    })
    expect(unionClip).toBeTruthy()
    const { data: flyoutPngData } = await chrome.send('Page.captureScreenshot', {
      format: 'png',
      clip: unionClip
    })
    expect(Buffer.from(flyoutPngData, 'base64').length).toBeGreaterThan(500)
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
          routeIsImmutableConv: window.__DAB_STUDIO__.history.location.pathname.startsWith('/c/conv_'),
          sidebarShowsGeneratedLabel:
            !document.querySelector('.dab-catalog-bar') &&
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
      routeIsImmutableConv: true,
      sidebarShowsGeneratedLabel: true
    })
  }, 15000)

  test('renders collapsible left conversations sidebar, switches to centered empty-state prompt on + New Conversation, and restores conversation state on /c/:conversationId click', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
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
    expect(step1.result.value.centeredHeroText).not.toContain('New Conversation')
    expect(step1.result.value.centeredHeroText).toContain('Ripper is ready')
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

    // Click previous conversation (conv_dashboard_7) -> routes to /c/7, restores chat & preview without topbar use-case badge
    const step2 = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const item = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        if (item) item.click();
        await new Promise((r) => setTimeout(r, 200));
        const noTopbarBadge = !document.querySelector('[data-testid="topbar-use-case-badge"]');
        const selectedUseCaseAfterSelect = window.__DAB_STUDIO__.selectedUseCase;
        const routeAfterSelect = window.__DAB_STUDIO__.history.location.pathname;
        const centeredGone = !document.querySelector('[data-testid="centered-empty-prompt"]');
        const bodyText = document.body ? document.body.innerText : '';

        // Also test legacy route redirect (/lookml/20261030_dev_branch -> /c/20261030_dev_branch)
        window.__DAB_STUDIO__.history.push('/lookml/20261030_dev_branch');
        await new Promise((r) => setTimeout(r, 150));
        const redirectedLegacyRoute = window.__DAB_STUDIO__.history.location.pathname;
        const lookmlUseCase = window.__DAB_STUDIO__.selectedUseCase;

        return {
          noTopbarBadge,
          selectedUseCaseAfterSelect,
          routeAfterSelect,
          centeredGone,
          restoredChatMsg: bodyText.includes('Created native Looker Dashboard #7'),
          restoredPreview: bodyText.includes('/embed/dashboards/7'),
          redirectedLegacyRoute,
          lookmlUseCase
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(step2.result.value).toEqual({
      noTopbarBadge: true,
      selectedUseCaseAfterSelect: 'dashboard',
      routeAfterSelect: '/c/conv_dashboard_7',
      centeredGone: true,
      restoredChatMsg: true,
      restoredPreview: true,
      redirectedLegacyRoute: '/c/20261030_dev_branch',
      lookmlUseCase: 'lookml'
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

        const noUseCaseSelector = !document.querySelector('[data-testid="use-case-selector"]');
        const noSplitNewConvTrigger = !document.querySelector('[data-testid="new-conversation-menu-trigger"]');
        const hasInfoBtnInComposerActions = Boolean(
          document.querySelector('.dab-composer-actions [data-testid="use-case-info-btn"]')
        );
        const defaultUseCase = window.__DAB_STUDIO__.selectedUseCase;
        const optionValues = (window.__DAB_STUDIO__.useCaseOptions || []).map((o) => o.value);
        const optionLabels = (window.__DAB_STUDIO__.useCaseOptions || []).map((o) => o.label);

        // 2. Verify permission gating excludes LookML & Health Check from allowedUseCases when user lacks develop permission
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
        const restrictedAllowed = window.__DAB_STUDIO__.allowedUseCases || [];
        const lookmlExcludedWhenRestricted = !restrictedAllowed.includes('lookml');
        const healthExcludedWhenRestricted = !restrictedAllowed.includes('health-check');

        // Restore full admin capabilities so Auto can route to LookML on Turn 1 and Dashboard on Turn 2
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

        // 3. Submit Turn 1 LookML prompt with dynamic auto-routing
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

        const useCaseAfterTurn1 = window.__DAB_STUDIO__.selectedUseCase;
        const isLockedAfterTurn1 = window.__DAB_STUDIO__.isUseCaseLocked;
        const noLockedBadge = !document.querySelector('[data-testid="locked-use-case-badge"]');
        const noTopbarBadge = !document.querySelector('[data-testid="topbar-use-case-badge"]');
        const noModeSwitcher = !document.querySelector('.dab-mode-switcher');

        const convUpdates = (window.__ARTIFACT_UPDATES__ || []).filter(
          (u) => u.key === 'user_conversations:1'
        );
        const latestConversations =
          convUpdates.length > 0 ? JSON.parse(convUpdates[convUpdates.length - 1].value) : [];

        // 4. Submit Turn 2 Dashboard prompt in the SAME conversation -> dynamically routes to 'dashboard' without locking
        const ta2 = document.querySelector('[data-testid="studio-prompt-input"]');
        const sendBtn2 = document.querySelector('[data-testid="studio-send-btn"]');
        taSetter.call(ta2, 'Create a native Looker UDD dashboard for executive KPIs');
        ta2.dispatchEvent(new Event('input', { bubbles: true }));
        ta2.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        if (sendBtn2) sendBtn2.click();
        await new Promise((r) => setTimeout(r, 200));
        const useCaseAfterTurn2 = window.__DAB_STUDIO__.selectedUseCase;

        // 5. Click + New Conversation -> resets back to 'auto' at '/'
        const resetBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        if (resetBtn) resetBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        const resetUseCase = window.__DAB_STUDIO__.selectedUseCase;

        return {
          noUseCaseSelector,
          noSplitNewConvTrigger,
          hasInfoBtnInComposerActions,
          defaultUseCase,
          optionValues,
          optionLabels,
          lookmlExcludedWhenRestricted,
          healthExcludedWhenRestricted,
          useCaseAfterTurn1,
          isLockedAfterTurn1,
          noLockedBadge,
          noTopbarBadge,
          noModeSwitcher,
          persistedType: latestConversations[0]?.type,
          useCaseAfterTurn2,
          resetUseCase
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      noUseCaseSelector: true,
      noSplitNewConvTrigger: true,
      hasInfoBtnInComposerActions: true,
      defaultUseCase: 'auto',
      optionValues: [
        'auto',
        'dashboard',
        'conversational-analytics',
        'app',
        'data-investigator',
        'health-check',
        'lookml',
        'tile'
      ],
      optionLabels: [
        'Auto',
        'Content Studio',
        'Conversational Analytics',
        'Data App',
        'Data Investigator',
        'Health Check',
        'LookML',
        'Script'
      ],
      lookmlExcludedWhenRestricted: true,
      healthExcludedWhenRestricted: true,
      useCaseAfterTurn1: 'lookml',
      isLockedAfterTurn1: false,
      noLockedBadge: true,
      noTopbarBadge: true,
      noModeSwitcher: true,
      persistedType: 'lookml',
      useCaseAfterTurn2: 'dashboard',
      resetUseCase: 'auto'
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
        taSetter.call(ta, 'Ask the Conversational Analytics CA agent: What are the top 3 product categories by gross margin in Q4?');
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
        const noLockedBadge = !document.querySelector('[data-testid="locked-use-case-badge"]');
        const selectedUseCase = window.__DAB_STUDIO__.selectedUseCase;
        const agentBadge = document.querySelector('[data-testid="ca-selected-agent-badge"]');
        const caIframe = document.querySelector('[data-testid="ca-embed-iframe"]');
        const convUpdates = (window.__ARTIFACT_UPDATES__ || []).filter((u) => u.key === 'user_conversations:1');
        const latestConversations =
          convUpdates.length > 0 ? JSON.parse(convUpdates[convUpdates.length - 1].value) : [];

        return {
          hasSubagentCall: Boolean(subagentCall),
          subagentTools: subagentCall ? subagentCall.body.tools : null,
          subagentHasPrevId: subagentCall ? ('previous_interaction_id' in subagentCall.body) : null,
          noLockedBadge,
          selectedUseCase,
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
      noLockedBadge: true,
      selectedUseCase: 'conversational-analytics',
      agentBadgeText: 'Agent: eCommerce & BigQuery Analytics Agent (ca_agent_ecommerce)',
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
          expression: `window.location.search.includes('${scenario}') && Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="topbar-fullscreen-toggle"]'))`,
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
        const configTitle = btn?.getAttribute('title') || '';
        const hasSvg = Boolean(btn?.querySelector('svg'));
        btn?.click();
        window.__DAB_STUDIO__.history.push('/c/42');
        await new Promise((r) => setTimeout(r, 80));
        document.querySelector('[data-testid="topbar-fullscreen-toggle"]')?.click();
        const r = document.querySelector('.dab-topbar').getBoundingClientRect();
        return {
          configLabel,
          configTitle,
          hasSvg,
          calls: window.__UPDATED_LOCATIONS__,
          clip: { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.min(1440, Math.ceil(r.width)), height: Math.min(900, Math.ceil(r.height) + 8), scale: 1 }
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(standardRes.result.value.configLabel).toBe('')
    expect(standardRes.result.value.configTitle).toBe('Full Screen')
    expect(standardRes.result.value.hasSvg).toBe(true)
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
        const spartanTitle = btn?.getAttribute('title') || '';
        const hasSvg = Boolean(btn?.querySelector('svg'));
        btn?.click();
        window.__MOCK_LOOKER_EXTENSION__.lookerHostData.mountPoint = 'dashboard-tile';
        window.__DAB_STUDIO__.history.push('/c/7');
        await new Promise((r) => setTimeout(r, 80));
        return {
          spartanLabel,
          spartanTitle,
          hasSvg,
          calls: window.__UPDATED_LOCATIONS__,
          hiddenInTile: !document.querySelector('[data-testid="topbar-fullscreen-toggle"]')
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(spartanRes.result.value).toEqual({
      spartanLabel: '',
      spartanTitle: 'Exit Full Screen',
      hasSvg: true,
      calls: [{ url: '/extensions/data_app_builder::data_app_builder/c/42', state: undefined, target: '_top' }],
      hiddenInTile: true
    })
  }, 15000)

  test('auto-executes bound Python script on initial tile mount (when dashboardRunState is NOT_RUNNING), fires extensionSDK.rendered() only after DOM paint, re-executes on dashboardFilters and dashboardRunState -> RUNNING changes, and fires rendered() on unbound tile fallback', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
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
    chrome.close()
    chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${port}/?scenario=centered_empty_prompt`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && window.__LOOKER_EMBED_STATE__ && document.querySelector('[data-testid="looker-embed-container"] iframe') && document.querySelector('[data-testid="conversation-item-conv_app_42"]'))`,
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

        // 2. Click Reload Viewer on same Dashboard #42 -> connection.asDashboardConnection().run()
        const reloadBtn = Array.from(document.querySelectorAll('.dab-preview-actions button')).find(
          (b) => (b.textContent || '').includes('Reload Viewer')
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
        state: 'dashboard',
        target: 'thelook::executive_pulse',
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
                title: 'Inspecting Explore Schema',
                detail: 'Analyzing thelook::order_items schema & planning 4 KPI tiles',
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
        const statusBannerWhileLive = document.querySelector('.dab-status-banner');

        const initiallyCollapsed = completedEl ? !completedEl.open : false;
        const completedSummary = completedEl?.querySelector('summary')?.textContent?.trim() || '';

        // Expand completed thinking block on click so both blocks and step details are visible
        if (completedEl) {
          completedEl.querySelector('summary')?.click();
        }
        await new Promise((r) => setTimeout(r, 80));

        const thoughtEl = completedEl?.querySelector('[data-testid="thinking-step-thought"]');
        const thoughtInitiallyCollapsed = thoughtEl ? !thoughtEl.open : false;
        if (thoughtEl) {
          thoughtEl.querySelector('summary')?.click();
        }
        await new Promise((r) => setTimeout(r, 60));

        return {
          hasCompletedBlock: Boolean(completedEl),
          initiallyCollapsed,
          expandedAfterClick: Boolean(completedEl?.open),
          thoughtInitiallyCollapsed,
          thoughtExpandedAfterClick: Boolean(thoughtEl?.open),
          statusBannerWhileLive,
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
      thoughtInitiallyCollapsed: true,
      thoughtExpandedAfterClick: true,
      statusBannerWhileLive: null,
      completedSummary: 'Thought for 4s · 3 steps',
      hasLiveBlock: true,
      liveOpenByDefault: true,
      liveClassName: 'dab-thinking-block dab-thinking-live',
      permThoughtText: 'Creating executive KPI dashboard with 4 tiles'
    })
    expect(domRes.result.value.completedText).toContain('Inspecting Explore Schema')
    expect(domRes.result.value.completedText).toContain(
      'Analyzing thelook::order_items schema & planning 4 KPI tiles'
    )
    expect(domRes.result.value.completedText).not.toContain('[object Object]')
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
        const hasStudioStarterPrompts = Boolean(document.querySelector('[data-testid="studio-starter-prompts"]'));
        const hasStarterPrompt0 = Boolean(document.querySelector('[data-testid="starter-prompt-0"]'));
        const starterBtns = Array.from(document.querySelectorAll('[data-testid="starter-prompt-list"] button[data-testid^="starter-prompt-"]'));
        const noEmojiInLabels = starterBtns.every((b) => !/[📊📈💬🧩🧮🛒🔍📌📉🔁🩺📐⚡🧪🧱🐍🚨📋✨]/u.test(b.innerText || ''));
        starterBtns[0]?.click();
        await new Promise((r) => setTimeout(r, 60));
        const ta = document.querySelector('[data-testid="studio-prompt-input"]');
        const promptAfterClick = ta ? ta.value : '';

        const savedPrompts = window.__DAB_STUDIO__?.starterPrompts || [];
        window.__DAB_STUDIO__?.setStarterPrompts?.([]);
        window.__DAB_STUDIO__?.setStarterPromptsLoading?.(true);
        await new Promise((r) => setTimeout(r, 50));
        const hasStarterSkeleton = Boolean(document.querySelector('[data-testid="studio-starter-prompts-skeleton"]'));
        window.__DAB_STUDIO__?.setStarterPrompts?.(savedPrompts);
        window.__DAB_STUDIO__?.setStarterPromptsLoading?.(false);
        await new Promise((r) => setTimeout(r, 50));

        window.__DAB_STUDIO__?.setSelectedUseCase?.('tile');
        await new Promise((r) => setTimeout(r, 80));

        const tileBtns = Array.from(document.querySelectorAll('[data-testid="starter-prompt-list"] button[data-testid^="starter-prompt-"]'));
        tileBtns[0]?.click();
        await new Promise((r) => setTimeout(r, 60));
        const promptAfterTileClick = ta ? ta.value : '';
        const tilePlaceholder = ta ? ta.getAttribute('placeholder') || '' : '';

        window.__DAB_STUDIO__?.setSelectedUseCase?.('auto');
        await new Promise((r) => setTimeout(r, 80));

        const r = document.querySelector('.dab-empty-prompt-card')?.getBoundingClientRect();
        const clip = r ? { x: Math.max(0, Math.floor(r.left - 16)), y: Math.max(0, Math.floor(r.top - 16)), width: Math.min(1440, Math.ceil(r.width + 32)), height: Math.min(900, Math.ceil(r.height + 32)), scale: 1 } : null;

        return {
          hasJargon,
          hasStudioStarterPrompts,
          hasStarterPrompt0,
          noEmojiInLabels,
          hasStarterSkeleton,
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
      hasStudioStarterPrompts: true,
      hasStarterPrompt0: true,
      noEmojiInLabels: true,
      hasStarterSkeleton: true,
      autoChipCount: 4,
      promptAfterClick:
        'Build an interactive Data App on bigquery_information_schema::jobs_timeline with Total Slot Ms and Total Bytes Billed KPI scorecards, a Job Type trend chart, and a Creation Time filter.',
      tileChipCount: 3,
      promptAfterTileClick:
        'Write a Script summarizing bigquery_information_schema::jobs_timeline metrics by Creation Time and active dashboard filters as a table.',
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
        const useCaseStillUnlocked = !window.__DAB_STUDIO__.isUseCaseLocked && !document.querySelector('[data-testid="use-case-selector"]');
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

        // 4. Re-click Sign In and cancel immediately via clicking topbar-oauth-signin-btn while 'Signing in…'
        document.querySelector('[data-testid="topbar-oauth-signin-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        const signingInBeforeCancel = (document.querySelector('[data-testid="topbar-oauth-signin-btn"]')?.textContent || '').trim() === 'Signing in…';
        document.querySelector('[data-testid="topbar-oauth-signin-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        const signInRestoredAfterCancel = (document.querySelector('[data-testid="topbar-oauth-signin-btn"]')?.textContent || '').trim() === 'Sign In';

        // 5. Restore working OAuth mock and click inline Sign In button -> enables Send button
        window.__MOCK_OAUTH_IMPL__ = null;
        document.querySelector('[data-testid="composer-signin-inline-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const afterSuccessSignIn = {
          sendDisabled: Boolean(document.querySelector('[data-testid="studio-send-btn"]')?.disabled),
          hasInlineSignInBtn: Boolean(document.querySelector('[data-testid="composer-signin-inline-btn"]')),
          topbarText: (document.querySelector('[data-testid="topbar-oauth-signin-btn"]')?.textContent || '').trim(),
          topbarTitle: document.querySelector('[data-testid="topbar-oauth-signin-btn"]')?.getAttribute('title') || '',
          topbarHasSvg: Boolean(document.querySelector('[data-testid="topbar-oauth-signin-btn"] svg'))
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
          signingInBeforeCancel,
          signInRestoredAfterCancel,
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
        hasCancelBtn: false,
        topbarSignInText: 'Signing in…',
        topbarSignInDisabled: false,
        promptInputDisabled: false,
        newConvDisabled: false,
        hasGlobalBusyBanner: false
      },
      afterFocusRecovery: {
        hasCancelBtn: false,
        topbarSignInText: 'Sign In'
      },
      signingInBeforeCancel: true,
      signInRestoredAfterCancel: true,
      afterSuccessSignIn: {
        sendDisabled: false,
        hasInlineSignInBtn: false,
        topbarText: '',
        topbarTitle: 'Sign Out',
        topbarHasSvg: true
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
        const spartanRedirectUriEl = document.querySelector('[data-testid="config-spartan-oauth-redirect-uri"]');
        const copyBtn = document.querySelector('[data-testid="config-copy-redirect-uri-btn"]');
        const copySpartanBtn = document.querySelector('[data-testid="copy-spartan-redirect-uri-btn"]');
        const redirectUriText = (redirectUriEl?.textContent || '').trim();
        const spartanRedirectUriText = (spartanRedirectUriEl?.textContent || '').trim();
        const copyBtnInitialText = (copyBtn?.textContent || '').trim();
        const copySpartanBtnInitialText = (copySpartanBtn?.textContent || '').trim();
        copyBtn?.click();
        copySpartanBtn?.click();
        await new Promise((r) => setTimeout(r, 40));
        const copyBtnAfterText = (copyBtn?.textContent || '').trim();
        const copySpartanBtnAfterText = (copySpartanBtn?.textContent || '').trim();

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
          spartanRedirectUriText,
          copyBtnInitialText,
          copyBtnAfterText,
          copySpartanBtnInitialText,
          copySpartanBtnAfterText,
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
      spartanRedirectUriText: 'https://dev-argolis.looker.com/spartan/oauth2_redirect',
      copyBtnInitialText: 'Copy Redirect URI',
      copyBtnAfterText: '✓ Copied Redirect URI',
      copySpartanBtnInitialText: 'Copy Spartan URI',
      copySpartanBtnAfterText: '✓ Copied Spartan URI'
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

    // Issue #93: Verify persisted dab_oauth_session hydrates across full page refresh
    await chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${port}/?scenario=centered_empty_prompt&preserveOAuth=1`
    })
    const reloadDeadline = Date.now() + 8000
    while (Date.now() < reloadDeadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="topbar-oauth-signin-btn"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 80))
    }
    const persistedRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const stored = JSON.parse(window.localStorage.getItem('dab_oauth_session') || '{}');
        const btn = document.querySelector('[data-testid="topbar-oauth-signin-btn"]');
        const beforeLogout = {
          storedToken: stored.token,
          hasExpiresAt: typeof stored.expiresAt === 'number' && stored.expiresAt > Date.now(),
          isAuthenticated: Boolean(window.__DAB_STUDIO__?.isAuthenticated),
          topbarText: (btn?.textContent || '').trim(),
          topbarTitle: btn?.getAttribute('title') || '',
          topbarHasSvg: Boolean(btn?.querySelector('svg')),
          hasInlineSignInBtn: Boolean(document.querySelector('[data-testid="composer-signin-inline-btn"]'))
        };
        btn?.click();
        await new Promise((r) => setTimeout(r, 60));
        const btnAfter = document.querySelector('[data-testid="topbar-oauth-signin-btn"]');
        const afterLogout = {
          storedAfter: window.localStorage.getItem('dab_oauth_session'),
          isAuthenticated: Boolean(window.__DAB_STUDIO__?.isAuthenticated),
          topbarText: (btnAfter?.textContent || '').trim()
        };
        return { ...beforeLogout, afterLogout };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    expect(persistedRes.result.value).toEqual({
      storedToken: 'mock_oauth_token_123',
      hasExpiresAt: true,
      isAuthenticated: true,
      topbarText: '',
      topbarTitle: 'Sign Out',
      topbarHasSvg: true,
      hasInlineSignInBtn: false,
      afterLogout: {
        storedAfter: '',
        isAuthenticated: false,
        topbarText: 'Sign In'
      }
    })
  }, 15000)

  test('renders contextual ? use-case info buttons across StudioComposer and preview toolbars, opens use-case-info-modal with Markdown + non-actionable live React UI previews, and switches across all 7 use-case tabs (Issue #64)', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${port}/?scenario=python_tile_studio`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `document.querySelectorAll('[data-testid="use-case-info-btn"]').length >= 2`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const openRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const btns = Array.from(document.querySelectorAll('[data-testid="use-case-info-btn"]'));
        const composerBtn = document.querySelector('.dab-composer-actions [data-testid="use-case-info-btn"]');
        const toolbarBtn = document.querySelector('[data-testid="tile-preview-toolbar"] [data-testid="use-case-info-btn"]');
        if (toolbarBtn) toolbarBtn.click();
        await new Promise((r) => setTimeout(r, 120));

        const modal = document.querySelector('[data-testid="use-case-info-modal"]');
        const previews = modal
          ? Array.from(modal.querySelectorAll('[data-testid="doc-ui-preview"]')).map((el) => ({
              component: el.getAttribute('data-component'),
              pointerEvents: window.getComputedStyle(el).pointerEvents,
              userSelect: window.getComputedStyle(el).userSelect,
              ariaHidden: el.getAttribute('aria-hidden'),
              tabIndex: el.getAttribute('tabindex'),
              text: (el.textContent || '').trim()
            }))
          : [];
        const tabs = modal
          ? Array.from(modal.querySelectorAll('[role="tab"]')).map((t) => ({
              label: (t.textContent || '').trim(),
              selected: t.getAttribute('aria-selected') === 'true'
            }))
          : [];
        return {
          btnCount: btns.length,
          hasComposerBtn: Boolean(composerBtn),
          hasToolbarBtn: Boolean(toolbarBtn),
          btnTitle: toolbarBtn?.getAttribute('title') || '',
          btnClassName: toolbarBtn?.className || '',
          modalOpen: Boolean(modal),
          modalText: modal?.innerText || '',
          previews,
          tabs
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(openRes.result.value.btnCount).toBeGreaterThanOrEqual(2)
    expect(openRes.result.value.hasComposerBtn).toBe(true)
    expect(openRes.result.value.hasToolbarBtn).toBe(true)
    expect(openRes.result.value.btnTitle).toBe('Use case guide & controls reference')
    expect(openRes.result.value.btnClassName).toContain('dab-info-trigger')
    expect(openRes.result.value.modalOpen).toBe(true)
    expect(openRes.result.value.modalText).toContain('Publish As Dashboard')
    expect(openRes.result.value.modalText).toContain('Execute & Test Script Mode')
    expect(openRes.result.value.tabs).toEqual([
      { label: 'Auto', selected: false },
      { label: 'Agentic LookML', selected: false },
      { label: 'Content Studio', selected: false },
      { label: 'Conversational Analytics', selected: false },
      { label: 'Data App', selected: false },
      { label: 'Data Investigator', selected: false },
      { label: 'Health Check', selected: false },
      { label: 'Script', selected: true }
    ])
    expect(openRes.result.value.previews).toEqual([
      expect.objectContaining({
        component: 'PublishDashboardButton',
        pointerEvents: 'none',
        ariaHidden: 'true',
        tabIndex: '-1',
        text: 'Publish Dashboard'
      }),
      expect.objectContaining({
        component: 'RunPythonButton',
        pointerEvents: 'none',
        ariaHidden: 'true',
        tabIndex: '-1',
        text: 'Run Python'
      }),
      expect.objectContaining({
        component: 'ScriptModeSelect',
        pointerEvents: 'none',
        ariaHidden: 'true',
        tabIndex: '-1'
      }),
      expect.objectContaining({
        component: 'SaveScriptButton',
        pointerEvents: 'none',
        ariaHidden: 'true',
        tabIndex: '-1',
        text: 'Save Script'
      }),
      expect.objectContaining({
        component: 'ScheduleScriptButton',
        pointerEvents: 'none',
        ariaHidden: 'true',
        tabIndex: '-1',
        text: 'Schedule Script'
      })
    ])

    // Capture cropped screenshot of the open Use Case Guide modal
    const clipRes = await chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.dab-use-case-info-modal');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const margin = 20;
        const x = Math.max(0, Math.floor(r.left - margin));
        const y = Math.max(0, Math.floor(r.top - margin));
        const right = Math.min(1440, Math.ceil(r.right + margin));
        const bottom = Math.min(900, Math.ceil(r.bottom + margin));
        return { x, y, width: right - x, height: bottom - y, scale: 1 };
      })()`,
      returnByValue: true
    })
    const clip = clipRes.result?.value
    expect(clip).toBeTruthy()
    const { data } = await chrome.send('Page.captureScreenshot', { format: 'png', clip })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)

    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchModalPath = path.join(scratchDir, 'issue-64-use-case-docs-modal.png')
    writeFileSync(scratchModalPath, pngBuffer)
    expect(existsSync(scratchModalPath)).toBe(true)

    // Switch across LookML, Health Check, and Auto tabs inside the modal, then close
    const tabSwitchRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const clickTab = async (uc) => {
          const btn = document.querySelector('[data-testid="use-case-guide-tab-' + uc + '"]');
          if (btn) btn.click();
          await new Promise((r) => setTimeout(r, 80));
          const modal = document.querySelector('[data-testid="use-case-info-modal"]');
          return Array.from(modal?.querySelectorAll('[data-testid="doc-ui-preview"]') || []).map((el) =>
            el.getAttribute('data-component')
          );
        };
        const lookmlComponents = await clickTab('lookml');
        const healthComponents = await clickTab('health-check');
        const autoComponents = await clickTab('auto');
        const autoBodyText = (document.querySelector('[data-testid="use-case-info-mdx-body"]')?.textContent || '').trim();
        const modelSelectOuter = document.querySelector('[data-testid="composer-model-select"]');
        const modelSelectTrigger = document.querySelector('[data-testid="composer-model-select-trigger"]');
        const outerBorderWidth = modelSelectOuter ? window.getComputedStyle(modelSelectOuter).borderTopWidth : null;
        const triggerBorderWidth = modelSelectTrigger ? window.getComputedStyle(modelSelectTrigger).borderTopWidth : null;
        const closeBtn = document.querySelector('[data-testid="use-case-info-close-btn"]');
        if (closeBtn) closeBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        return {
          lookmlComponents,
          healthComponents,
          autoComponents,
          hasAutoBody: autoBodyText.includes('Automatic Workflow Discovery') && !autoBodyText.includes('Conversation Use-Case Lock'),
          outerBorderWidth,
          triggerBorderWidth,
          modalClosed: !document.querySelector('[data-testid="use-case-info-modal"]')
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(tabSwitchRes.result.value).toEqual({
      lookmlComponents: ['LookmlTurnSkills', 'PushLookmlButton'],
      healthComponents: ['ExportHealthTddButton'],
      autoComponents: [],
      hasAutoBody: true,
      outerBorderWidth: '0px',
      triggerBorderWidth: '1px',
      modalClosed: true
    })
  }, 15000)

  test('Issue #61: removes My Creations bar, archives/unarchives conversations, opens Delete Confirmation Modal with related content, deletes index + related artifacts, and never resurrects deleted items', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${port}/?scenario=data_app`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="archive-conv-conv_app_42"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    // Step 1: Archive conv_lookml_20261030_dev_branch, reveal Show Archived (1), and open Delete modal on conv_app_42
    const modalOpenRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DELETED_ARTIFACTS__ = [];
        window.__DELETED_DASHBOARDS__ = [];
        const hasCatalogBar = Boolean(document.querySelector('.dab-catalog-bar'));
        const bodyTextBefore = document.body?.innerText || '';
        const hasMyCreationsText = bodyTextBefore.includes('My Creations');

        // Archive LookML conversation
        const archiveLookmlBtn = document.querySelector('[data-testid="archive-conv-conv_lookml_20261030_dev_branch"]');
        if (archiveLookmlBtn) archiveLookmlBtn.click();
        await new Promise((r) => setTimeout(r, 120));

        const toggleArchivedBtn = document.querySelector('[data-testid="toggle-archived-convs"]');
        const toggleTextBeforeExpand = toggleArchivedBtn?.textContent?.trim() || '';
        const lookmlHiddenBeforeExpand = !document.querySelector('[data-testid="conversation-item-conv_lookml_20261030_dev_branch"]');

        // Expand archived section so archived item is visible
        if (toggleArchivedBtn) toggleArchivedBtn.click();
        await new Promise((r) => setTimeout(r, 100));
        const toggleTextAfterExpand = toggleArchivedBtn?.textContent?.trim() || '';
        const archivedListEl = document.querySelector('[data-testid="archived-conversations-list"]');
        const lookmlVisibleInArchived = Boolean(
          archivedListEl?.querySelector('[data-testid="conversation-item-conv_lookml_20261030_dev_branch"]')
        );

        // Click Delete on conv_app_42 to open the confirmation modal
        const deleteAppBtn = document.querySelector('[data-testid="delete-conv-conv_app_42"]');
        if (deleteAppBtn) deleteAppBtn.click();
        await new Promise((r) => setTimeout(r, 100));

        const modalEl = document.querySelector('[data-testid="delete-conv-modal"]');
        const checkboxEl = document.querySelector('[data-testid="delete-related-content-checkbox"]');
        if (checkboxEl && !checkboxEl.checked) {
          checkboxEl.click();
        }
        await new Promise((r) => setTimeout(r, 60));

        const contentLinkEl = modalEl?.querySelector('[data-testid="delete-modal-content-link-0"]');

        return {
          hasCatalogBar,
          hasMyCreationsText,
          toggleTextBeforeExpand,
          lookmlHiddenBeforeExpand,
          toggleTextAfterExpand,
          lookmlVisibleInArchived,
          hasDeleteModal: Boolean(modalEl),
          modalText: modalEl?.innerText || '',
          contentLinkHref: contentLinkEl?.getAttribute('href') || '',
          contentLinkTarget: contentLinkEl?.getAttribute('target') || '',
          checkboxChecked: Boolean(checkboxEl?.checked),
          hasCancelBtn: Boolean(document.querySelector('[data-testid="cancel-delete-conv-btn"]')),
          hasConvOnlyBtn: Boolean(document.querySelector('[data-testid="confirm-delete-conv-only-btn"]')),
          hasConvAndContentBtn: Boolean(document.querySelector('[data-testid="confirm-delete-conv-and-content-btn"]')),
          hasConfirmBtn: Boolean(document.querySelector('[data-testid="confirm-delete-conv-btn"]'))
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(modalOpenRes.result.value).toMatchObject({
      hasCatalogBar: false,
      hasMyCreationsText: false,
      toggleTextBeforeExpand: 'Show Archived (1)',
      lookmlHiddenBeforeExpand: true,
      toggleTextAfterExpand: 'Hide Archived (1)',
      lookmlVisibleInArchived: true,
      hasDeleteModal: true,
      contentLinkTarget: '_blank',
      checkboxChecked: true,
      hasCancelBtn: true,
      hasConvOnlyBtn: true,
      hasConvAndContentBtn: true,
      hasConfirmBtn: true
    })
    expect(modalOpenRes.result.value.contentLinkHref).toContain('/dashboards/42')
    expect(modalOpenRes.result.value.modalText).toContain('Executive Revenue App')
    expect(modalOpenRes.result.value.modalText).toContain('Looker Dashboard #42 (sdk.delete_dashboard)')
    expect(modalOpenRes.result.value.modalText).toContain('Shared app artifact (obj_app_42)')

    // Capture cropped screenshot of sidebar archive controls + delete confirmation modal
    const clipRes = await chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const selectors = [
          '[data-testid="conversations-sidebar"]',
          '[data-testid="delete-conv-modal"]'
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
    const scratchSnapPath = path.join(scratchDir, 'issue-61-archive-delete-modal.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)

    // Step 2: Confirm deletion (with related content checked), unarchive LookML, then delete remaining items and verify no resurrection
    const afterConfirmRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const confirmBtn = document.querySelector('[data-testid="confirm-delete-conv-btn"]');
        if (confirmBtn) confirmBtn.click();
        await new Promise((r) => setTimeout(r, 150));

        const deletedArtifactsAfterApp42 = [...(window.__DELETED_ARTIFACTS__ || [])];
        const deletedDashboardsAfterApp42 = [...(window.__DELETED_DASHBOARDS__ || [])];

        // Unarchive conv_lookml_20261030_dev_branch
        const unarchiveLookmlBtn = document.querySelector('[data-testid="archive-conv-conv_lookml_20261030_dev_branch"]');
        if (unarchiveLookmlBtn) unarchiveLookmlBtn.click();
        await new Promise((r) => setTimeout(r, 120));

        // Delete all remaining conversations (conversation-only button)
        const remainingIds = [
          'conv_dashboard_7',
          'conv_lookml_20261030_dev_branch',
          'conv_health_demo',
          'conv_tile_demo1'
        ];
        for (const id of remainingIds) {
          const delBtn = document.querySelector('[data-testid="delete-conv-' + id + '"]');
          if (delBtn) delBtn.click();
          await new Promise((r) => setTimeout(r, 60));
          const onlyBtn = document.querySelector('[data-testid="confirm-delete-conv-only-btn"]');
          if (onlyBtn) onlyBtn.click();
          await new Promise((r) => setTimeout(r, 100));
        }

        const sidebarText = document.querySelector('[data-testid="conversations-sidebar"]')?.innerText || '';
        const remainingItemsCount = document.querySelectorAll('[data-testid^="conversation-item-"]').length;
        return {
          deletedArtifactsAfterApp42,
          deletedDashboardsAfterApp42,
          allDeletedArtifacts: [...(window.__DELETED_ARTIFACTS__ || [])],
          remainingItemsCount,
          showsEmptyMessage: sidebarText.includes('No previous conversations yet.')
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(afterConfirmRes.result.value.deletedArtifactsAfterApp42).toEqual(
      expect.arrayContaining(['user_1_app_42', 'obj_app_42'])
    )
    expect(afterConfirmRes.result.value.deletedDashboardsAfterApp42).toEqual(['42'])
    expect(afterConfirmRes.result.value.allDeletedArtifacts).toEqual(
      expect.arrayContaining([
        'user_1_app_42',
        'user_1_dashboard_7',
        'user_1_lookml_20261030_dev_branch',
        'user_1_health_check_demo',
        'user_1_script_demo1'
      ])
    )
    expect(afterConfirmRes.result.value.remainingItemsCount).toBe(0)
    expect(afterConfirmRes.result.value.showsEmptyMessage).toBe(true)
  }, 20000)

  test('renders Looker-style lazy folder tree with ancestor hydration, in-memory quick search, advanced search_folders modal, fixed-width loading skeleton, and removes legacy manual ID loaders (Issue #62)', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${port}/?scenario=data_app`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="topbar-folder-trigger"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const domRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        // 1. Check removal of legacy manual ID loaders
        const hasDashboardIdInput = Boolean(document.querySelector('input[placeholder*="Dashboard ID"]'));
        const hasLookmlSessionIdInput = Boolean(document.querySelector('input[placeholder*="LookML Session ID"]'));

        // 2. Check fixed width on Save to Folder trigger
        const trigger = document.querySelector('[data-testid="topbar-folder-trigger"]');
        const triggerStyle = trigger ? window.getComputedStyle(trigger) : null;
        const triggerMinWidth = triggerStyle ? triggerStyle.minWidth : '';
        const triggerMaxWidth = triggerStyle ? triggerStyle.maxWidth : '';
        const triggerLabel = document.querySelector('[data-testid="topbar-folder-picker"]')?.textContent || '';

        // 3. Toggle loadingMetadata to verify skeleton renders with same dimensions
        s.setLoadingMetadata(true);
        await new Promise((r) => setTimeout(r, 80));
        const skeleton = document.querySelector('[data-testid="folder-selector-skeleton"]');
        const hasSkeleton = Boolean(skeleton && skeleton.classList.contains('dab-skeleton'));
        s.setLoadingMetadata(false);
        await new Promise((r) => setTimeout(r, 80));

        // 4. Open Folder Tree Popover & expand Personal folder ('5')
        const triggerAfter = document.querySelector('[data-testid="topbar-folder-trigger"]');
        triggerAfter.click();
        await new Promise((r) => setTimeout(r, 80));

        const expandPersonalBtn = document.querySelector('[data-testid="folder-expand-5"]');
        if (expandPersonalBtn) expandPersonalBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        const hasPersonalChild = Boolean(document.querySelector('[data-testid="folder-select-503"]'));

        // 5. Test In-Memory Quick Search
        const quickSearch = document.querySelector('[data-testid="folder-tree-quick-search"]');
        const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        inputSetter.call(quickSearch, 'Experiments');
        quickSearch.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        const quickSearchFilteredText = document.querySelector('[data-testid="folder-tree-list"]')?.textContent || '';
        inputSetter.call(quickSearch, '');
        quickSearch.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));

        // 6. Open Advanced Search modal, search for 'subfolder test', select '502'
        const advBtn = document.querySelector('[data-testid="folder-advanced-search-btn"]');
        advBtn.click();
        await new Promise((r) => setTimeout(r, 80));

        const nameInput = document.querySelector('[data-testid="folder-search-input-name"]');
        inputSetter.call(nameInput, 'subfolder');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const runSearchBtn = document.querySelector('[data-testid="folder-search-submit-btn"]');
        runSearchBtn.click();
        await new Promise((r) => setTimeout(r, 120));

        const result502 = document.querySelector('[data-testid="folder-search-result-502"]');
        const hasSearchResult502 = Boolean(result502);
        if (result502) result502.click();
        await new Promise((r) => setTimeout(r, 150));

        // 7. Ensure popover is open and re-open Advanced Search modal so both are visible for the visual snapshot
        const triggerFinal = document.querySelector('[data-testid="topbar-folder-trigger"]');
        const selectedTriggerText = triggerFinal?.textContent?.trim() || '';
        if (!document.querySelector('[data-testid="folder-tree-popover"]') && triggerFinal) {
          triggerFinal.click();
          await new Promise((r) => setTimeout(r, 100));
        }

        const hasHydratedParent501 = Boolean(document.querySelector('[data-testid="folder-select-501"]'));
        const hasHydratedLeaf502 = Boolean(document.querySelector('[data-testid="folder-select-502"]'));
        const personalNodeCount = document.querySelectorAll('[data-testid="folder-select-5"]').length;
        const treeText = document.querySelector('[data-testid="folder-tree-popover"]')?.textContent || '';
        const hasNoHashIdsInTree = !treeText.includes('#5') && !treeText.includes('#1') && !treeText.includes('#502');

        const advBtn2 = document.querySelector('[data-testid="folder-advanced-search-btn"]');
        if (advBtn2) advBtn2.click();
        await new Promise((r) => setTimeout(r, 100));

        // 8. Issue #112 checks: Dev Mode badge, removed brand pills, persisted folder ID, clean search modal copy, icon-only close button, and 0px CLS on Personal Scope select
        const topbarText = document.querySelector('.dab-topbar')?.textContent || '';
        const hasRemovedBrandPills = !topbarText.includes('Agentic LookML') && !topbarText.includes('WASM CodeMode');
        await window.__DAB_STUDIO__.handleToggleLookerDevMode('dev');
        await new Promise((r) => setTimeout(r, 40));
        const devBadge = document.querySelector('[data-testid="topbar-dev-mode-badge"]');
        const hasDevModeBadgeWhenDev = Boolean(devBadge && devBadge.textContent?.trim() === 'Dev Mode');
        await window.__DAB_STUDIO__.handleToggleLookerDevMode('production');
        await new Promise((r) => setTimeout(r, 40));
        const devBadgeHiddenInProd = !document.querySelector('[data-testid="topbar-dev-mode-badge"]');
        const persistedFolderId = window.localStorage.getItem('dab_selected_folder_id');

        const advModal = document.querySelector('[data-testid="folder-advanced-search-modal"]');
        const advModalText = advModal?.textContent || '';
        const hasCleanSearchCopy =
          advModalText.includes('Advanced Looker Folder Search') &&
          !advModalText.includes('sdk.search_folders') &&
          !advModalText.includes('parent_id') &&
          !advModalText.includes('creator_id') &&
          !advModalText.includes('is_personal');
        const closeBtn = document.querySelector('[data-testid="folder-search-modal-close"]');
        const modalCloseBtnText = closeBtn?.textContent?.trim() || '';
        const modalCloseBtnTitle = closeBtn?.getAttribute('title') || '';
        const parentInput = document.querySelector('[data-testid="folder-search-input-parent-id"]');
        const creatorInput = document.querySelector('[data-testid="folder-search-input-creator-id"]');
        const parentInputHasDatalist = parentInput?.getAttribute('list') === 'dab-folder-parent-suggestions';
        const creatorInputHasDatalist = creatorInput?.getAttribute('list') === 'dab-folder-creator-suggestions';

        const personalSelectTrigger = document.querySelector('[data-testid="folder-search-select-personal-trigger"]');
        const wAny = Math.round(personalSelectTrigger.getBoundingClientRect().width);
        personalSelectTrigger.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="folder-search-select-personal-option-false"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const wShared = Math.round(personalSelectTrigger.getBoundingClientRect().width);
        personalSelectTrigger.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="folder-search-select-personal-option-true"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const wPersonal = Math.round(personalSelectTrigger.getBoundingClientRect().width);
        personalSelectTrigger.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="folder-search-select-personal-option-any"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const personalSelectClsPx = Math.max(Math.abs(wShared - wAny), Math.abs(wPersonal - wAny));

        return {
          hasDashboardIdInput,
          hasLookmlSessionIdInput,
          triggerMinWidth,
          triggerMaxWidth,
          hasSaveToFolderLabel: triggerLabel.includes('Save New Content to Folder:'),
          hasSkeleton,
          hasPersonalChild,
          quickSearchMatchesExperiments: quickSearchFilteredText.includes('Personal Experiments'),
          hasSearchResult502,
          selectedTriggerText,
          hasHydratedParent501,
          hasHydratedLeaf502,
          personalNodeCount,
          hasNoHashIdsInTree,
          hasRemovedBrandPills,
          hasDevModeBadgeWhenDev,
          devBadgeHiddenInProd,
          persistedFolderId,
          hasCleanSearchCopy,
          modalCloseBtnText,
          modalCloseBtnTitle,
          parentInputHasDatalist,
          creatorInputHasDatalist,
          personalSelectClsPx
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(domRes.result.value).toEqual({
      hasDashboardIdInput: false,
      hasLookmlSessionIdInput: false,
      triggerMinWidth: '180px',
      triggerMaxWidth: '240px',
      hasSaveToFolderLabel: true,
      hasSkeleton: true,
      hasPersonalChild: true,
      quickSearchMatchesExperiments: true,
      hasSearchResult502: true,
      selectedTriggerText: 'subfolder test▾',
      hasHydratedParent501: true,
      hasHydratedLeaf502: true,
      personalNodeCount: 1,
      hasNoHashIdsInTree: true,
      hasRemovedBrandPills: true,
      hasDevModeBadgeWhenDev: true,
      devBadgeHiddenInProd: true,
      persistedFolderId: '502',
      hasCleanSearchCopy: true,
      modalCloseBtnText: '✕',
      modalCloseBtnTitle: 'Close',
      parentInputHasDatalist: true,
      creatorInputHasDatalist: true,
      personalSelectClsPx: 0
    })

    const clipRes = await chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const selectors = [
          '[data-testid="topbar-folder-picker"]',
          '[data-testid="folder-tree-popover"]',
          '[data-testid="folder-advanced-search-modal"]'
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
    const scratchSnapPath = path.join(scratchDir, 'issue-62-folder-tree.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)
  }, 15000)

  test('renders StudioSelect styled dropdowns, split + New Conversation use-case action menu, and SVG icon theme menu (Issue #60)', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${port}/?scenario=data_app`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="new-conversation-btn"]') && document.querySelector('[data-testid="topbar-theme-select"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    // Open the SVG theme menu and inspect single + New Conversation button and composer StudioSelect/guide controls
    const openMenusRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const themeTrigger = document.querySelector('[data-testid="topbar-theme-select"] .dab-studio-select-trigger');
        if (themeTrigger) themeTrigger.click();
        await new Promise((r) => setTimeout(r, 100));

        const noSplitTrigger = !document.querySelector('[data-testid="new-conversation-menu-trigger"]');
        const noNewConvMenu = !document.querySelector('[data-testid="new-conversation-use-case-menu"]');
        const hasSingleNewConvBtn = Boolean(document.querySelector('[data-testid="new-conversation-btn"]'));
        const hasInfoBtnInComposer = Boolean(
          document.querySelector('.dab-composer-actions [data-testid="use-case-info-btn"]')
        );

        const themeSelect = document.querySelector('[data-testid="topbar-theme-select"]');
        const themeTriggerSvg = themeSelect?.querySelector('.dab-studio-select-trigger svg')?.getAttribute('data-theme-icon') || null;
        const themeMenu = document.querySelector('[data-testid="topbar-theme-select-menu"]');
        const themeMenuIcons = themeMenu
          ? Array.from(themeMenu.querySelectorAll('svg[data-theme-icon]')).map((el) => el.getAttribute('data-theme-icon'))
          : [];
        const themeHasEmoji = /[☀️🌙🖥️]/u.test(themeSelect?.textContent || '');

        const studioSelectCount = document.querySelectorAll('.dab-studio-select').length;
        const unstyledVisibleSelectCount = Array.from(document.querySelectorAll('select')).filter(
          (s) => !s.classList.contains('dab-studio-select-native')
        ).length;

        const rects = [
          document.querySelector('.dab-topbar'),
          document.querySelector('[data-testid="new-conversation-btn"]'),
          themeMenu
        ]
          .filter(Boolean)
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        const margin = 12;
        const x = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.left)) - margin));
        const y = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.top)) - margin));
        const right = Math.min(1440, Math.ceil(Math.max(...rects.map((r) => r.right)) + margin));
        const bottom = Math.min(900, Math.ceil(Math.max(...rects.map((r) => r.bottom)) + margin));

        return {
          noSplitTrigger,
          noNewConvMenu,
          hasSingleNewConvBtn,
          hasInfoBtnInComposer,
          themeTriggerSvg,
          themeMenuIcons,
          themeHasEmoji,
          studioSelectCount,
          unstyledVisibleSelectCount,
          clip: { x, y, width: right - x, height: bottom - y, scale: 1 }
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(openMenusRes.result.value).toMatchObject({
      noSplitTrigger: true,
      noNewConvMenu: true,
      hasSingleNewConvBtn: true,
      hasInfoBtnInComposer: true,
      themeTriggerSvg: 'system',
      themeMenuIcons: ['light', 'dark', 'system'],
      themeHasEmoji: false,
      unstyledVisibleSelectCount: 0
    })
    expect(openMenusRes.result.value.studioSelectCount).toBeGreaterThanOrEqual(2)

    const { data } = await chrome.send('Page.captureScreenshot', {
      format: 'png',
      clip: openMenusRes.result.value.clip
    })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)
    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchSnapPath = path.join(scratchDir, 'issue-60-dropdown-menus.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)

    // Test interactive selection on SVG theme menu, single + New Conversation button, and composer capabilities guide modal
    const interactionRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        // 1. Click Dark in the SVG theme menu
        const darkOpt = document.querySelector('[data-testid="topbar-theme-option-dark"]');
        if (darkOpt) darkOpt.click();
        await new Promise((r) => setTimeout(r, 80));
        const themeAfterDarkClick = document.documentElement.getAttribute('data-theme');
        const iconAfterDarkClick = document
          .querySelector('[data-testid="topbar-theme-select"] .dab-studio-select-trigger svg')
          ?.getAttribute('data-theme-icon');

        // Switch back to Light via SVG theme menu
        document.querySelector('[data-testid="topbar-theme-select"] .dab-studio-select-trigger')?.click();
        await new Promise((r) => setTimeout(r, 60));
        document.querySelector('[data-testid="topbar-theme-option-light"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const themeAfterLightClick = document.documentElement.getAttribute('data-theme');
        const iconAfterLightClick = document
          .querySelector('[data-testid="topbar-theme-select"] .dab-studio-select-trigger svg')
          ?.getAttribute('data-theme-icon');

        // 2. Click + New Conversation button -> routes to '/' with 'auto' useCase
        document.querySelector('[data-testid="new-conversation-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 120));
        const routeAfterNewConv = window.__DAB_STUDIO__.history.location.pathname;
        const hasCenteredPrompt = Boolean(document.querySelector('[data-testid="centered-empty-prompt"]'));
        const presetUseCase = window.__DAB_STUDIO__.selectedUseCase;

        // 3. Click '?' capabilities guide button inside .dab-composer-actions -> opens UseCaseInfoModal
        document.querySelector('.dab-composer-actions [data-testid="use-case-info-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const hasInfoModal = Boolean(document.querySelector('[data-testid="use-case-info-modal"]'));
        document.querySelector('[data-testid="use-case-info-close"]')?.click();
        await new Promise((r) => setTimeout(r, 60));

        return {
          themeAfterDarkClick,
          iconAfterDarkClick,
          themeAfterLightClick,
          iconAfterLightClick,
          routeAfterNewConv,
          hasCenteredPrompt,
          presetUseCase,
          hasInfoModal
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(interactionRes.result.value).toEqual({
      themeAfterDarkClick: 'dark',
      iconAfterDarkClick: 'dark',
      themeAfterLightClick: 'light',
      iconAfterLightClick: 'light',
      routeAfterNewConv: '/',
      hasCenteredPrompt: true,
      presetUseCase: 'auto',
      hasInfoModal: true
    })
  }, 15000)

  test('verifies StudioDesignSystem primitives (StudioModal with Escape close, StudioToolbar, StudioBadge dark/light semantic tokens, StudioCard, StudioSkeleton, StudioDocPreview) and captures cropped showcase snapshot', async () => {
    const url = `http://127.0.0.1:${port}/?scenario=lookml`
    await chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('.dab-ds-card') && document.querySelector('[data-testid="use-case-info-btn"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((r) => setTimeout(r, 80))
    }

    const dsRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        // 1. Verify semantic status tokens in Light and Dark mode on StudioBadge
        document.documentElement.setAttribute('data-theme', 'light');
        const probeWrap = document.createElement('div');
        probeWrap.innerHTML = '<span id="p-ok" class="dab-badge dab-badge-success">OK</span><span id="p-warn" class="dab-badge dab-badge-warning">WARN</span><span id="p-err" class="dab-badge dab-badge-danger">ERR</span><span id="p-skel" class="dab-skeleton" style="width:80px;height:20px"></span>';
        document.body.appendChild(probeWrap);
        const lightOkBg = window.getComputedStyle(document.getElementById('p-ok')).backgroundColor;
        const lightWarnBg = window.getComputedStyle(document.getElementById('p-warn')).backgroundColor;
        const lightErrBg = window.getComputedStyle(document.getElementById('p-err')).backgroundColor;

        document.documentElement.setAttribute('data-theme', 'dark');
        const darkOkBg = window.getComputedStyle(document.getElementById('p-ok')).backgroundColor;
        const darkWarnBg = window.getComputedStyle(document.getElementById('p-warn')).backgroundColor;
        const darkErrBg = window.getComputedStyle(document.getElementById('p-err')).backgroundColor;
        probeWrap.remove();
        document.documentElement.setAttribute('data-theme', 'light');

        // 2. Verify StudioCard, StudioToolbar & lucide-react SVG icons (no decorative emojis) in LookML mode
        const hasToolbarTitleBlock = Boolean(document.querySelector('.dab-preview-toolbar .dab-ds-toolbar-title-block'));
        const hasStudioCard = Boolean(document.querySelector('.dab-ds-card'));
        const archiveBtnHasLucideSvg = Boolean(document.querySelector('[data-testid^="archive-conv-"] svg.lucide'));
        const deleteBtnHasLucideSvg = Boolean(document.querySelector('[data-testid^="delete-conv-"] svg.lucide'));
        const hasDecorativeEmoji = /[✨🛡️⚡🟢📊📈💬🧩🩺🐍📝🧪📸🧱🔄⏰🤖📖👤📁🔍📥🗑️]/u.test(document.body?.innerText || '');

        // 3. Open UseCaseInfoModal (built on StudioModal) and verify StudioDocPreview + Data Investigator tab inside it
        document.querySelector('[data-testid="use-case-info-btn"]').click();
        await new Promise((r) => setTimeout(r, 100));
        const modal = document.querySelector('[data-testid="use-case-info-modal"]');
        const hasModalHeader = Boolean(modal && modal.querySelector('.dab-ds-modal-header'));
        const invTab = modal && modal.querySelector('[data-testid="use-case-guide-tab-data-investigator"]');
        const hasInvestigatorGuideTab = Boolean(invTab);
        if (invTab) invTab.click();
        await new Promise((r) => setTimeout(r, 80));
        const hasInvestigatorDocSlidesPreview = Boolean(
          modal && modal.querySelector('[data-testid="data-investigator-doc-slides-preview"]')
        );
        const hasDocPreview = Boolean(modal && modal.querySelector('[data-testid="doc-ui-preview"]'));
        const rect = modal.getBoundingClientRect();
        const clip = {
          x: Math.max(0, Math.floor(rect.left - 24)),
          y: Math.max(0, Math.floor(rect.top - 24)),
          width: Math.min(1440, Math.ceil(rect.width + 48)),
          height: Math.min(900, Math.ceil(rect.height + 48)),
          scale: 1
        };

        return {
          lightDistinctFromDark: lightOkBg !== darkOkBg && lightWarnBg !== darkWarnBg && lightErrBg !== darkErrBg,
          hasToolbarTitleBlock,
          hasStudioCard,
          archiveBtnHasLucideSvg,
          deleteBtnHasLucideSvg,
          hasDecorativeEmoji,
          hasModalHeader,
          hasInvestigatorGuideTab,
          hasInvestigatorDocSlidesPreview,
          hasDocPreview,
          clip
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(dsRes.result.value).toMatchObject({
      lightDistinctFromDark: true,
      hasToolbarTitleBlock: true,
      hasStudioCard: true,
      archiveBtnHasLucideSvg: true,
      deleteBtnHasLucideSvg: true,
      hasDecorativeEmoji: false,
      hasModalHeader: true,
      hasInvestigatorGuideTab: true,
      hasInvestigatorDocSlidesPreview: true,
      hasDocPreview: true
    })

    const { data } = await chrome.send('Page.captureScreenshot', {
      format: 'png',
      clip: dsRes.result.value.clip
    })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)
    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const showcasePath = path.join(scratchDir, 'studio-design-system-showcase.png')
    writeFileSync(showcasePath, pngBuffer)
    expect(existsSync(showcasePath)).toBe(true)

    // Verify Escape key closes StudioModal
    const escRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        return Boolean(document.querySelector('[data-testid="use-case-info-modal"]'));
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    expect(escRes.result.value).toBe(false)
  }, 15000)

  test('Issue #92: removes topbar Explores combobox and provides composer + Add Context menu & @-mention popover with context chips', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    await chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${port}/?scenario=data_app`
    })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="composer-add-context-btn"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const hasTopbarCombobox = Boolean(document.querySelector('.dab-topbar .dab-combobox'));
        const addBtn = document.querySelector('[data-testid="composer-add-context-btn"]');
        const fileInput = document.querySelector('[data-testid="composer-file-input"]');
        addBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        const addMenu = document.querySelector('[data-testid="composer-add-context-menu"]');
        const menuItemIds = ['add-context-files', 'add-context-explores', 'add-context-dashboards', 'add-context-looks', 'add-context-conversations'];
        const hasAllMenuItems = menuItemIds.every((id) => Boolean(document.querySelector('[data-testid="' + id + '"]')));

        // Click Dashboards in Add Context menu -> inserts @dashboard: and opens @-mention menu
        document.querySelector('[data-testid="add-context-dashboards"]').click();
        await new Promise((r) => setTimeout(r, 120));
        const mentionMenu = document.querySelector('[data-testid="composer-at-mention-menu"]');
        const pulseOption = document.querySelector('[data-testid="composer-mention-option-dashboard-901"]');
        const hasPulseOption = Boolean(pulseOption);
        if (pulseOption) pulseOption.click();
        await new Promise((r) => setTimeout(r, 100));

        const chipsWrap = document.querySelector('[data-testid="composer-context-chips"]');
        const pulseChip = document.querySelector('[data-testid="composer-context-chip-dashboard-901"]');
        const promptValue = document.querySelector('[data-testid="studio-prompt-input"]')?.value || '';

        return {
          hasTopbarCombobox,
          hasFileInput: Boolean(fileInput),
          hasAddMenu: Boolean(addMenu),
          hasAllMenuItems,
          hasMentionMenu: Boolean(mentionMenu),
          hasPulseOption,
          hasChipsWrap: Boolean(chipsWrap),
          hasPulseChip: Boolean(pulseChip),
          promptValue
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toMatchObject({
      hasTopbarCombobox: false,
      hasFileInput: true,
      hasAddMenu: true,
      hasAllMenuItems: true,
      hasMentionMenu: true,
      hasPulseOption: true,
      hasChipsWrap: true,
      hasPulseChip: true,
      promptValue: '@dashboard:Business Pulse '
    })
  }, 15000)

  test('Issue #99: renders meaningful content tabs in StudioRightPane and switches between Dashboard, Look, Explore, and Data App tabs via @looker/embed-sdk loadX()', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    await chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${port}/?scenario=data_app`
    })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        // Select conversation conv_dashboard_7 so right pane is visible
        const convDash7 = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        if (convDash7) convDash7.click();
        await new Promise((r) => setTimeout(r, 180));

        const container = document.querySelector('[data-testid="looker-embed-container"]');
        const studio = window.__DAB_STUDIO__;

        // Upsert Look #15, Explore thelook::order_items, and Data App #42 into the active conversation
        studio.upsertContentItem({
          id: '15',
          lookId: '15',
          contentType: 'look',
          title: 'Monthly Churn Look',
          embedPath: '/embed/looks/15'
        });
        studio.upsertContentItem({
          id: 'thelook::order_items',
          exploreId: 'thelook::order_items',
          contentType: 'explore',
          title: 'eCommerce: Order Items',
          embedPath: '/embed/explore/thelook/order_items'
        });
        studio.upsertContentItem({
          id: '42',
          dashboardId: '42',
          contentType: 'data_app',
          title: 'Executive Revenue Overview',
          embedPath: '/embed/dashboards/42'
        });
        await new Promise((r) => setTimeout(r, 140));

        const tabBar = document.querySelector('[data-testid="studio-content-tabs"]');
        const tabDash = document.querySelector('[data-testid="studio-content-tab-dashboard:7"]');
        const tabLook = document.querySelector('[data-testid="studio-content-tab-look:15"]');
        const tabExplore = document.querySelector('[data-testid="studio-content-tab-explore:thelook::order_items"]');
        const tabApp = document.querySelector('[data-testid="studio-content-tab-data_app:42"]');

        const labels = [tabDash, tabLook, tabExplore, tabApp].map((el) => (el?.textContent || '').trim());
        const allHaveSvg = [tabDash, tabLook, tabExplore, tabApp].every((el) => Boolean(el?.querySelector('svg')));

        // 1. Click Look tab -> loadLook({ id: '15' })
        tabLook.click();
        await new Promise((r) => setTimeout(r, 120));
        const afterClickLook = {
          selected: tabLook.getAttribute('aria-selected'),
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target')
        };

        // 2. Click Explore tab -> loadExplore({ id: 'thelook/order_items' })
        tabExplore.click();
        await new Promise((r) => setTimeout(r, 120));
        const afterClickExplore = {
          selected: tabExplore.getAttribute('aria-selected'),
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target')
        };

        // 3. Click Dashboard tab -> loadDashboard({ id: '7' })
        tabDash.click();
        await new Promise((r) => setTimeout(r, 120));
        const afterClickDash = {
          selected: tabDash.getAttribute('aria-selected'),
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target')
        };

        const calls = (window.__LOOKER_EMBED_STATE__?.calls || []).map((c) => c.method + ':' + c.arg);

        return {
          hasTabBar: Boolean(tabBar),
          labels,
          allHaveSvg,
          afterClickLook,
          afterClickExplore,
          afterClickDash,
          calls
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toMatchObject({
      hasTabBar: true,
      labels: [
        'Executive Order Performance (Native UDD)',
        'Monthly Churn Look',
        'eCommerce: Order Items',
        'Executive Revenue Overview'
      ],
      allHaveSvg: true,
      afterClickLook: {
        selected: 'true',
        state: 'look',
        target: '15'
      },
      afterClickExplore: {
        selected: 'true',
        state: 'explore',
        target: 'thelook/order_items'
      },
      afterClickDash: {
        selected: 'true',
        state: 'dashboard',
        target: '7'
      }
    })
    expect(res.result.value.calls).toEqual(
      expect.arrayContaining([
        'loadLook:15',
        'loadExplore:thelook/order_items',
        'loadDashboard:7',
        'loadDashboard:42'
      ])
    )
  }, 15000)

  test('Issue #105: provides in-flight Stop, Queue & Interject composer controls and topbar Environment Reset/Stop popover menu', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    await chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${port}/?scenario=chatbar_busy_running`
    })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="studio-stop-btn"]') && document.querySelector('[data-testid="topbar-environment-btn"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const res = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        s.setOauthToken('mock_oauth_token');
        await new Promise((r) => setTimeout(r, 40));
        const ta = document.querySelector('[data-testid="studio-prompt-input"]');
        const addBtn = document.querySelector('[data-testid="composer-add-context-btn"]');
        const splitGroup = document.querySelector('[data-testid="studio-busy-action-group"]');
        const queueBtn = document.querySelector('[data-testid="studio-queue-btn"]');
        const menuTrigger = document.querySelector('[data-testid="studio-busy-action-menu-trigger"]');
        const stopBtn = document.querySelector('[data-testid="studio-stop-btn"]');
        const sendBtnWhileBusy = document.querySelector('[data-testid="studio-send-btn"]');

        // Open split button caret menu, switch to Interject -> verifies studio-interject-btn & localStorage persistence, then switch back to Queue
        menuTrigger?.click();
        await new Promise((r) => setTimeout(r, 40));
        const interjectOption = document.querySelector('[data-testid="studio-busy-action-option-interject"]');
        interjectOption?.click();
        await new Promise((r) => setTimeout(r, 40));
        const hasInterjectAfterSwitch = Boolean(document.querySelector('[data-testid="studio-interject-btn"]'));
        const storedAfterInterject = window.localStorage.getItem('dab_busy_send_action');
        document.querySelector('[data-testid="studio-busy-action-menu-trigger"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="studio-busy-action-option-queue"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const storedAfterQueue = window.localStorage.getItem('dab_busy_send_action');

        const initialBusyCheck = {
          textareaDisabled: Boolean(ta?.disabled),
          addContextDisabled: Boolean(addBtn?.disabled),
          hasSplitGroup: Boolean(splitGroup),
          hasQueueBtn: Boolean(queueBtn),
          hasInterjectBtn: hasInterjectAfterSwitch,
          storedAfterInterject,
          storedAfterQueue,
          hasStopBtn: Boolean(stopBtn),
          hasSendBtnWhileBusy: Boolean(sendBtnWhileBusy)
        };

        // 1. Type a follow-up prompt while busy and click Queue
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        taSetter.call(ta, 'Add a regional breakdown filter');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        document.querySelector('[data-testid="studio-queue-btn"]').click();
        await new Promise((r) => setTimeout(r, 60));

        // 2. Type a second follow-up prompt while busy and press Cmd+Enter to queue it
        taSetter.call(ta, 'Export summary table to CSV');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const queuedBar = document.querySelector('[data-testid="queued-prompts-bar"]');
        const queuedItemsBeforeRemove = Array.from(document.querySelectorAll('[data-testid="queued-prompt-item"]')).map(
          (el) => el.querySelector('.dab-queued-prompt-text')?.textContent?.trim() || ''
        );

        // Remove second queued prompt via its remove button
        const removeBtns = Array.from(document.querySelectorAll('[data-testid^="queued-prompt-remove-"]'));
        removeBtns[1]?.click();
        await new Promise((r) => setTimeout(r, 60));
        const queuedCountAfterRemove = document.querySelectorAll('[data-testid="queued-prompt-item"]').length;

        // 3. Test Stop button: set liveActivitySteps and click Stop
        s.setLiveActivitySteps([
          { id: 'step_stop_1', kind: 'thought', title: 'Inspecting order_items', status: 'running' }
        ]);
        await new Promise((r) => setTimeout(r, 50));
        document.querySelector('[data-testid="studio-stop-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));

        const afterStop = {
          hasStopBtn: Boolean(document.querySelector('[data-testid="studio-stop-btn"]')),
          hasSendBtn: Boolean(document.querySelector('[data-testid="studio-send-btn"]')),
          bodyContainsStoppedMsg: document.body.innerText.includes('Stopped by user.')
        };

        // 4. Test Interject from queued item while busy
        s.setBusyStatus('Running Looker Code Mode...');
        s.setLiveActivitySteps([
          { id: 'step_int_1', kind: 'codemode', title: 'Querying brand revenue', status: 'running' }
        ]);
        await new Promise((r) => setTimeout(r, 60));
        const interjectQueuedBtn = document.querySelector('[data-testid^="queued-prompt-interject-"]');
        interjectQueuedBtn?.click();
        await new Promise((r) => setTimeout(r, 200));

        const afterQueuedInterject = {
          queuedBarGone: !document.querySelector('[data-testid="queued-prompts-bar"]'),
          bodyContainsInterjectedMsg: document.body.innerText.includes('Interjected by user.'),
          bodyContainsQueuedPromptText: document.body.innerText.includes('Add a regional breakdown filter')
        };

        // 5. Verify topbar Environment button & popover menu (Reset Environment & Stop Environment)
        const envBtn = document.querySelector('[data-testid="topbar-environment-btn"]');
        const envBtnText = (envBtn?.textContent || '').trim();
        const hasRawEnvLabel = /Env\\s*\\[/i.test(document.querySelector('.dab-topbar')?.innerText || '');

        envBtn.click();
        await new Promise((r) => setTimeout(r, 60));
        const envMenu = document.querySelector('[data-testid="topbar-environment-menu"]');
        const resetBtn = document.querySelector('[data-testid="env-reset-btn"]');
        const stopEnvBtn = document.querySelector('[data-testid="env-stop-btn"]');
        const menuOpenCheck = {
          hasMenu: Boolean(envMenu),
          hasResetBtn: Boolean(resetBtn),
          hasStopEnvBtn: Boolean(stopEnvBtn)
        };

        // Click Stop Environment -> closes menu and sets status to 'stopped' (neutral badge)
        stopEnvBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        const afterStopEnv = {
          menuClosed: !document.querySelector('[data-testid="topbar-environment-menu"]'),
          status: window.__DAB_STUDIO__.environmentStatus,
          hasNeutralClass: envBtn.classList.contains('dab-badge-neutral'),
          text: (envBtn?.textContent || '').trim()
        };

        // Re-open menu and click Reset Environment -> sets status to 'active' (success badge) & shows reset notice
        envBtn.click();
        await new Promise((r) => setTimeout(r, 60));
        document.querySelector('[data-testid="env-reset-btn"]').click();
        await new Promise((r) => setTimeout(r, 120));
        const afterResetEnv = {
          menuClosed: !document.querySelector('[data-testid="topbar-environment-menu"]'),
          status: window.__DAB_STUDIO__.environmentStatus,
          hasSuccessClass: envBtn.classList.contains('dab-badge-success'),
          hasResetNoticeAttr: envBtn.getAttribute('data-env-reset-notice') === 'true',
          text: (envBtn?.textContent || '').trim()
        };

        // 6. Verify right-pane Thinking logo state when busy without active embed, and neutral copy when idle
        s.setPublishedApp(null);
        s.setContentItems([]);
        s.setBusyStatus('Synthesizing Looker query...');
        await new Promise((r) => setTimeout(r, 60));
        const thinkingEl = document.querySelector('[data-testid="right-pane-thinking-state"]');
        const rightToolbarThinkingText = (document.querySelector('.dab-right-pane .dab-ds-toolbar-title-block')?.textContent || '').trim();
        const thinkingCheck = {
          hasThinkingState: Boolean(thinkingEl),
          thinkingText: (thinkingEl?.textContent || '').trim(),
          toolbarText: rightToolbarThinkingText
        };

        s.setBusyStatus(null);
        await new Promise((r) => setTimeout(r, 60));
        const idlePlaceholderText = (document.querySelector('.dab-right-pane .dab-placeholder')?.textContent || '').trim();
        const rightToolbarIdleText = (document.querySelector('.dab-right-pane .dab-ds-toolbar-title-block')?.textContent || '').trim();
        const idleCheck = {
          hasThinkingState: Boolean(document.querySelector('[data-testid="right-pane-thinking-state"]')),
          toolbarText: rightToolbarIdleText,
          hasReadyCopy: idlePlaceholderText.includes('Ready when you are'),
          hasHardcodedDataAppCopy: /Data App/i.test(idlePlaceholderText) || /Data App/i.test(rightToolbarIdleText)
        };

        return {
          initialBusyCheck,
          hasQueuedBar: Boolean(queuedBar),
          queuedItemsBeforeRemove,
          queuedCountAfterRemove,
          afterStop,
          afterQueuedInterject,
          envBtnText,
          hasRawEnvLabel,
          menuOpenCheck,
          afterStopEnv,
          afterResetEnv,
          thinkingCheck,
          idleCheck
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      initialBusyCheck: {
        textareaDisabled: false,
        addContextDisabled: false,
        hasSplitGroup: true,
        hasQueueBtn: true,
        hasInterjectBtn: true,
        storedAfterInterject: 'interject',
        storedAfterQueue: 'queue',
        hasStopBtn: true,
        hasSendBtnWhileBusy: false
      },
      hasQueuedBar: true,
      queuedItemsBeforeRemove: [
        'Add a regional breakdown filter',
        'Export summary table to CSV'
      ],
      queuedCountAfterRemove: 1,
      afterStop: {
        hasStopBtn: false,
        hasSendBtn: true,
        bodyContainsStoppedMsg: true
      },
      afterQueuedInterject: {
        queuedBarGone: true,
        bodyContainsInterjectedMsg: true,
        bodyContainsQueuedPromptText: true
      },
      envBtnText: 'Environment',
      hasRawEnvLabel: false,
      menuOpenCheck: {
        hasMenu: true,
        hasResetBtn: true,
        hasStopEnvBtn: true
      },
      afterStopEnv: {
        menuClosed: true,
        status: 'stopped',
        hasNeutralClass: true,
        text: 'Environment (Stopped)'
      },
      afterResetEnv: {
        menuClosed: true,
        status: 'active',
        hasSuccessClass: true,
        hasResetNoticeAttr: true,
        text: '✓ Environment Reset'
      },
      thinkingCheck: {
        hasThinkingState: true,
        thinkingText: 'Thinking...Synthesizing Looker query...',
        toolbarText: 'Thinking...'
      },
      idleCheck: {
        hasThinkingState: false,
        toolbarText: 'Viewer will appear here when Looker content is ready',
        hasReadyCopy: true,
        hasHardcodedDataAppCopy: false
      }
    })
  }, 15000)

  test('Issue #119: supports draggable split resizer, collapsible right artifact icon rail, clickable file/skill steps, and copy reasoning button', async () => {
    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=data_app` })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="workspace-split-resizer"]'))`, returnByValue: true })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const res = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const workspace = document.querySelector('.dab-workspace');
        const resizer = document.querySelector('[data-testid="workspace-split-resizer"]');
        const initialWidth = window.__DAB_STUDIO__.leftPaneWidth;
        resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 380, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 460, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const widthAfterDrag = window.__DAB_STUDIO__.leftPaneWidth;
        const cssVarAfterDrag = workspace.style.getPropertyValue('--dab-left-pane-width');
        const storedWidth = window.localStorage.getItem('dab_left_pane_width');
        resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const widthAfterKey = window.__DAB_STUDIO__.leftPaneWidth;

        window.__DAB_STUDIO__.setContentItems([
          { key: 'data_app:42', id: '42', contentType: 'data_app', title: 'Executive Revenue App', embedPath: '/embed/dashboards/42', extensionId: 'db::exec-rev' },
          { key: 'dashboard:108', id: '108', contentType: 'dashboard', title: 'Regional Margin UDD', embedPath: '/embed/dashboards/108' }
        ]);
        await new Promise((r) => setTimeout(r, 50));
        document.querySelector('[data-testid="right-pane-collapse-toggle"]').click();
        await new Promise((r) => setTimeout(r, 50));
        const railEl = document.querySelector('[data-testid="right-pane-collapsed-rail"]');
        const hasCollapsedClass = workspace.classList.contains('dab-workspace-right-collapsed');
        const storedCollapsed = window.localStorage.getItem('dab_right_pane_collapsed');
        const artifactBtnApp = document.querySelector('[data-testid="right-rail-artifact-data_app:42"]');
        const artifactBtnDash = document.querySelector('[data-testid="right-rail-artifact-dashboard:108"]');
        const resizerWhileCollapsed = document.querySelector('[data-testid="workspace-split-resizer"]');
        artifactBtnDash.click();
        await new Promise((r) => setTimeout(r, 60));
        const afterRailArtifactClick = { rightPaneCollapsed: window.__DAB_STUDIO__.rightPaneCollapsed, activeContentTabKey: window.__DAB_STUDIO__.activeContentTabKey, railGone: !document.querySelector('[data-testid="right-pane-collapsed-rail"]') };

        window.__DAB_STUDIO__.setMessages([
          { role: 'user', text: 'Investigate order items revenue drop' },
          { role: 'assistant', text: 'Completed root-cause investigation.', thinkingDurationSec: 5, activitySteps: [
            { id: 'st_thought', kind: 'thought', title: 'Framing investigation plan', detail: 'Checking key driver skill and DATA_INVESTIGATOR_GUIDE.md.', status: 'done' },
            { id: 'st_file', kind: 'file', title: 'Viewing DATA_INVESTIGATOR_GUIDE.md', detail: '/workspace/DATA_INVESTIGATOR_GUIDE.md', path: '/workspace/DATA_INVESTIGATOR_GUIDE.md', status: 'done' },
            { id: 'st_skill', kind: 'skill', title: 'Reading skill key-driver-analysis', detail: 'skills/key-driver-analysis/SKILL.md', path: 'skills/key-driver-analysis/SKILL.md', status: 'done' },
            { id: 'st_codemode', kind: 'codemode', title: 'Executing Looker queries for Order Items...', detail: 'sdk.run_inline_query', status: 'done' }
          ] }
        ]);
        await new Promise((r) => setTimeout(r, 60));
        const completedDetails = document.querySelector('[data-testid="completed-thinking-block"]');
        const wasOpenBeforeCopy = completedDetails.hasAttribute('open');
        const copyBtn = completedDetails.querySelector('[data-testid="copy-thinking-trace-btn"]');
        copyBtn.click();
        await new Promise((r) => setTimeout(r, 40));
        const wasOpenAfterCopy = completedDetails.hasAttribute('open');
        const copyBtnTextAfterClick = (copyBtn.textContent || '').trim();
        const copiedMarkdown = window.__LAST_COPIED_THINKING_TRACE__ || '';
        completedDetails.querySelector('summary').click();
        await new Promise((r) => setTimeout(r, 40));
        completedDetails.querySelector('[data-testid="thinking-step-file"] summary').click();
        completedDetails.querySelector('[data-testid="thinking-step-skill"] summary').click();
        await new Promise((r) => setTimeout(r, 40));
        const previews = Array.from(completedDetails.querySelectorAll('[data-testid="activity-step-content-preview"]')).map((el) => (el.textContent || '').trim());
        return {
          initialWidth, widthAfterDrag, cssVarAfterDrag, storedWidth, widthAfterKey,
          hasRail: Boolean(railEl), hasCollapsedClass, storedCollapsed,
          hasArtifactBtnApp: Boolean(artifactBtnApp), hasArtifactBtnDash: Boolean(artifactBtnDash),
          hasResizerWhileCollapsed: Boolean(resizerWhileCollapsed), afterRailArtifactClick,
          wasOpenBeforeCopy, wasOpenAfterCopy, copyBtnTextAfterClick,
          copiedContainsHeader: copiedMarkdown.includes('## Thinking & Activity Trace (5s · 4 steps)'),
          copiedContainsPrompt: copiedMarkdown.includes('Investigate order items revenue drop'),
          copiedContainsFriendlyStep: copiedMarkdown.includes('Executing Looker queries for Order Items...'),
          previewCount: previews.length,
          filePreviewHasGuide: previews.some((p) => p.includes('Data Investigator')),
          skillPreviewHasKda: previews.some((p) => p.includes('Key Driver Analysis'))
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      initialWidth: 380, widthAfterDrag: 460, cssVarAfterDrag: '460px', storedWidth: '460', widthAfterKey: 476,
      hasRail: true, hasCollapsedClass: true, storedCollapsed: 'true', hasArtifactBtnApp: true, hasArtifactBtnDash: true, hasResizerWhileCollapsed: false,
      afterRailArtifactClick: { rightPaneCollapsed: false, activeContentTabKey: 'dashboard:108', railGone: true },
      wasOpenBeforeCopy: false, wasOpenAfterCopy: false, copyBtnTextAfterClick: 'Copied',
      copiedContainsHeader: true, copiedContainsPrompt: true, copiedContainsFriendlyStep: true,
      previewCount: 2, filePreviewHasGuide: true, skillPreviewHasKda: true
    })
  }, 15000)

  test('Issue #126: renders Barrel Tube Vortex surf loader, edits per-user agent name inline with extensionSDK.updateTitle, renders rich Markdown links with openBrowserWindow & clipboardWrite fallback, collapses CA embed panels, and adapts layout on <=768px mobile viewport', async () => {
    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=ripper_surf_loader` })
    const loaderDeadline = Date.now() + 8000
    while (Date.now() < loaderDeadline) {
      const r = await chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="ripper-surf-loader"]'))`, returnByValue: true })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const loaderRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const loader = document.querySelector('[data-testid="ripper-surf-loader"]');
        const svg = document.querySelector('[data-testid="ripper-surf-loader-svg"]');
        const hasThreeRipCurlRibbons = Boolean(svg?.querySelector('.dab-ripper-ribbon-1') && svg?.querySelector('.dab-ripper-ribbon-2') && svg?.querySelector('.dab-ripper-ribbon-3') && svg?.querySelector('.dab-ripper-board-ride'));
        const loaderText = loader ? (loader.textContent || '').trim() : '';
        window.__DAB_STUDIO__.setAppInitializing(false);
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('[data-testid="studio-edit-agent-name-btn"]') && document.querySelector('[data-testid="chat-msg-agent-author"]')) break;
          await new Promise((r) => setTimeout(r, 40));
        }
        const labelBefore = (document.querySelector('[data-testid="studio-agent-name-label"]')?.textContent || '').trim();
        const authorBefore = (document.querySelector('[data-testid="chat-msg-agent-author"]')?.textContent || '').trim();
        document.querySelector('[data-testid="studio-edit-agent-name-btn"]').click();
        await new Promise((r) => setTimeout(r, 40));
        const input = document.querySelector('[data-testid="studio-agent-name-input"]');
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Maverick');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
        document.querySelector('[data-testid="studio-save-agent-name-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));
        const labelAfter = (document.querySelector('[data-testid="studio-agent-name-label"]')?.textContent || '').trim();
        const authorAfter = (document.querySelector('[data-testid="chat-msg-agent-author"]')?.textContent || '').trim();
        const updatedTitles = window.__UPDATED_TITLES__ || [];
        const userConfigUpdate = (window.__ARTIFACT_UPDATES__ || []).find((u) => u.key === 'user_config:1');

        window.__OPENED_WINDOWS__ = [];
        window.__CLIPBOARD_WRITES__ = [];
        window.__DAB_STUDIO__.setMessages([{
          role: 'assistant',
          text: [
            '### Revenue Breakdown',
            '- Open [Executive Dashboard](/dashboards/42) or [LookML Field Docs](https://docs.cloud.google.com/looker/docs/r/sql/LookML-field)',
            '- External vendor link [Vendor Portal](https://unlisted-vendor.example.org/report)',
            '\`\`\`sql',
            'SELECT status, COUNT(*) FROM order_items GROUP BY 1;',
            '\`\`\`'
          ].join('\\n')
        }]);
        await new Promise((r) => setTimeout(r, 80));
        const mdBody = document.querySelector('[data-testid="studio-markdown-body"]');
        const links = Array.from(document.querySelectorAll('[data-testid="chat-markdown-link"]'));
        const copyBtns = Array.from(document.querySelectorAll('[data-testid="chat-markdown-link-copy"]'));
        links[0].click(); links[1].click(); links[2].click();
        await new Promise((r) => setTimeout(r, 60));
        const thirdCopiedAttr = copyBtns[2]?.getAttribute('data-copied');
        copyBtns[0].click();
        await new Promise((r) => setTimeout(r, 40));
        const firstCopiedAttr = copyBtns[0]?.getAttribute('data-copied');
        return {
          hasLoader: Boolean(loader), hasSvg: Boolean(svg), hasThreeRipCurlRibbons,
          loaderHasRipper: loaderText.includes('Ripper'),
          loaderHasSubtitle: loaderText.includes('Dropping into your Looker workspace'),
          labelBefore, authorBefore, labelAfter, authorAfter,
          titleUpdatedToMaverick: updatedTitles.includes('Maverick'),
          savedUserConfigAgentName: userConfigUpdate ? JSON.parse(userConfigUpdate.value).agentName : null,
          hasH3: Boolean(mdBody?.querySelector('h3')),
          hasList: Boolean(mdBody?.querySelector('ul')),
          hasCodeBlock: Boolean(mdBody?.querySelector('pre code')),
          linkCount: links.length, copyBtnCount: copyBtns.length,
          openedWindows: window.__OPENED_WINDOWS__, clipboardWrites: window.__CLIPBOARD_WRITES__,
          thirdCopiedAttr, firstCopiedAttr
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(loaderRes.result.value).toEqual({
      hasLoader: true, hasSvg: true, hasThreeRipCurlRibbons: true, loaderHasRipper: true, loaderHasSubtitle: true,
      labelBefore: 'Ripper', authorBefore: 'Ripper', labelAfter: 'Maverick', authorAfter: 'Maverick',
      titleUpdatedToMaverick: true, savedUserConfigAgentName: 'Maverick',
      hasH3: true, hasList: true, hasCodeBlock: true, linkCount: 3, copyBtnCount: 3,
      openedWindows: [
        { url: '/dashboards/42', target: '_blank' },
        { url: 'https://docs.cloud.google.com/looker/docs/r/sql/LookML-field', target: '_blank' }
      ],
      clipboardWrites: ['https://unlisted-vendor.example.org/report', '/dashboards/42'],
      thirdCopiedAttr: 'true', firstCopiedAttr: 'true'
    })

    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=conversational_analytics` })
    const caDeadline = Date.now() + 8000
    while (Date.now() < caDeadline) {
      const r = await chrome.send('Runtime.evaluate', { expression: `Boolean(document.querySelector('[data-testid="ca-embed-iframe"]'))`, returnByValue: true })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const caRes = await chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const iframe = document.querySelector('[data-testid="ca-embed-iframe"]');
        return { embedSrc: iframe?.getAttribute('data-embed-src') || '', panelsCollapsedAttr: iframe?.getAttribute('data-ca-panels-collapsed') || '' };
      })()`,
      returnByValue: true
    })
    expect(caRes.result.value.embedSrc).toContain('/embed/conversations/ca_conv_streaming_1?agent_id=ca_agent_ecommerce')
    expect(caRes.result.value.embedSrc).toContain('hide_sidebar=true&hide_data_source_panel=true&sidebar_collapsed=true&right_panel_collapsed=true')
    expect(caRes.result.value.panelsCollapsedAttr).toBe('true')

    try {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=centered_empty_prompt` })
      const mobDeadline = Date.now() + 8000
      while (Date.now() < mobDeadline) {
        const r = await chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="studio-empty-stage"]'))`, returnByValue: true })
        if (r.result?.value) break
        await new Promise((res) => setTimeout(res, 80))
      }

      const mobRes = await chrome.send('Runtime.evaluate', {
        expression: `(async () => {
          const initialCollapsed = window.__DAB_STUDIO__.sidebarCollapsed;
          window.__DAB_STUDIO__.setSidebarCollapsed(false);
          await new Promise((r) => setTimeout(r, 50));
          const sidebarEl = document.querySelector('[data-testid="conversations-sidebar"]');
          const sidebarPosition = sidebarEl ? window.getComputedStyle(sidebarEl).position : '';
          await window.__DAB_STUDIO__.handleSelectConversation({
            id: 'conv_app_42', type: 'app', label: 'Executive Revenue App',
            content: { dashboardId: '42', appArtifactId: 'obj_app_42' }, updatedAt: '2026-10-30T23:40:00Z'
          });
          await new Promise((r) => setTimeout(r, 80));
          return { initialCollapsed, sidebarPosition, collapsedAfterSelect: window.__DAB_STUDIO__.sidebarCollapsed };
        })()`,
        awaitPromise: true,
        returnByValue: true
      })
      expect(mobRes.result.value).toEqual({ initialCollapsed: true, sidebarPosition: 'absolute', collapsedAfterSelect: true })
    } finally {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    }
  }, 20000)

  test('Issue #130: loads agent-created .md files on click from remote sandbox environment into activity-step-content-preview and sandbox-markdown-preview-modal without writing to Looker artifacts', async () => {
    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=data_app` })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="completed-thinking-block"], .dab-chat-log'))`, returnByValue: true })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const res = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__ARTIFACT_UPDATES__ = []; window.__ENVIRONMENT_FILE_CALLS__ = []; window.__CLIPBOARD_WRITES__ = []; window.__LAST_DOWNLOADED_SANDBOX_MD__ = null;
        window.__DAB_STUDIO__.setMessages([
          { role: 'user', text: 'Investigate Q4 revenue drop and write /workspace/analysis.md and /workspace/report.md' },
          {
            role: 'assistant',
            text: 'Created root-cause summary in \`/workspace/analysis.md\` and remediation steps in [Executive Remediation Report](/workspace/report.md).',
            thinkingDurationSec: 4,
            activitySteps: [{ id: 'st_md_1', kind: 'file', title: 'Editing analysis.md', detail: '/workspace/analysis.md', path: '/workspace/analysis.md', status: 'done' }]
          }
        ]);
        await new Promise((r) => setTimeout(r, 60));
        const completedDetails = document.querySelector('[data-testid="completed-thinking-block"]');
        completedDetails.querySelector('summary').click();
        await new Promise((r) => setTimeout(r, 40));
        const fileStep = completedDetails.querySelector('[data-testid="thinking-step-file"]');
        fileStep.querySelector('summary').click();
        await new Promise((r) => setTimeout(r, 60));
        const previewText = (fileStep.querySelector('[data-testid="activity-step-content-preview"]')?.textContent || '').trim();
        fileStep.querySelector('[data-testid="open-sandbox-markdown-modal-btn"]').click();
        await new Promise((r) => setTimeout(r, 60));
        const modalEl = document.querySelector('[data-testid="sandbox-markdown-preview-modal"]');
        const pathBadgeText = (modalEl?.querySelector('[data-testid="sandbox-markdown-path-badge"]')?.textContent || '').trim();
        const renderedBodyText = (modalEl?.querySelector('[data-testid="sandbox-markdown-rendered-body"]')?.textContent || '').trim();
        modalEl?.querySelector('[data-testid="sandbox-markdown-toggle-raw"]').click();
        await new Promise((r) => setTimeout(r, 40));
        const rawBodyText = (modalEl?.querySelector('[data-testid="sandbox-markdown-raw-body"]')?.textContent || '').trim();
        const copyBtn = modalEl?.querySelector('[data-testid="sandbox-markdown-copy-btn"]');
        copyBtn.click();
        await new Promise((r) => setTimeout(r, 40));
        const copiedAttr = copyBtn?.getAttribute('data-copied');
        modalEl?.querySelector('[data-testid="sandbox-markdown-download-btn"]').click();
        await new Promise((r) => setTimeout(r, 40));
        const downloadedAfterStepModal = window.__LAST_DOWNLOADED_SANDBOX_MD__;
        const chatTriggers = Array.from(document.querySelectorAll('[data-testid="sandbox-markdown-file-trigger"]'));
        chatTriggers[1].click();
        await new Promise((r) => setTimeout(r, 60));
        const modalAfterTrigger = document.querySelector('[data-testid="sandbox-markdown-preview-modal"]');
        const triggerPathBadge = (modalAfterTrigger?.querySelector('[data-testid="sandbox-markdown-path-badge"]')?.textContent || '').trim();
        const triggerRenderedText = (modalAfterTrigger?.querySelector('[data-testid="sandbox-markdown-rendered-body"]')?.textContent || '').trim();
        return {
          previewHasRootCause: previewText.includes('Q4 Revenue Drop Root-Cause Analysis'),
          previewHasOuterwear: previewText.includes('Outerwear stockouts in West region'),
          hasModal: Boolean(modalEl), pathBadgeText,
          renderedHasOuterwear: renderedBodyText.includes('Outerwear stockouts in West region'),
          rawHasMarkdownHeading: rawBodyText.includes('# Q4 Revenue Drop Root-Cause Analysis'),
          copiedAttr,
          clipboardHasAnalysis: (window.__CLIPBOARD_WRITES__ || []).some((t) => t.includes('Q4 Revenue Drop Root-Cause Analysis')),
          downloadedFileName: downloadedAfterStepModal?.fileName || '',
          chatTriggerCount: chatTriggers.length, triggerPathBadge,
          triggerHasRemediation: triggerRenderedText.includes('Executive Remediation Report'),
          envFileCallPaths: (window.__ENVIRONMENT_FILE_CALLS__ || []).map((c) => c.normalizedPath),
          artifactUpdateCount: (window.__ARTIFACT_UPDATES__ || []).length
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      previewHasRootCause: true, previewHasOuterwear: true, hasModal: true, pathBadgeText: '/workspace/analysis.md',
      renderedHasOuterwear: true, rawHasMarkdownHeading: true, copiedAttr: 'true', clipboardHasAnalysis: true,
      downloadedFileName: 'analysis.md', chatTriggerCount: 2, triggerPathBadge: '/workspace/report.md',
      triggerHasRemediation: true, envFileCallPaths: ['workspace/analysis.md', 'workspace/report.md'], artifactUpdateCount: 0
    })
  }, 15000)

  test('Issue #132: renames right pane to Viewer, opens skill and file steps in viewer-document-pane, and hides bottom Thinking section on mobile while sliding up Viewer card on object/step click', async () => {
    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=data_app` })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="workspace-split-resizer"]'))`, returnByValue: true })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const desktopRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const resizerLabel = document.querySelector('[data-testid="workspace-split-resizer"]')?.getAttribute('aria-label') || '';
        const collapseBtnTitle = document.querySelector('[data-testid="right-pane-collapse-toggle"]')?.getAttribute('title') || '';
        const reloadViewerBtn = Array.from(document.querySelectorAll('.dab-right-pane button')).some((b) => (b.textContent || '').trim() === 'Reload Viewer');
        const iframeTitle = document.querySelector('[data-testid="looker-embed-container"] iframe')?.getAttribute('title') || '';
        window.__DAB_STUDIO__.setMessages([
          { role: 'user', text: 'Build a revenue Data App and investigate drivers' },
          {
            role: 'assistant', text: 'Built app using Data Apps skill and wrote \`/workspace/analysis.md\`.', thinkingDurationSec: 3,
            activitySteps: [
              { id: 'st_skill_da', kind: 'skill', title: 'Reading skill data-apps', detail: '/workspace/skills/data-apps/SKILL.md', path: '/workspace/skills/data-apps/SKILL.md', status: 'done' },
              { id: 'st_file_an', kind: 'file', title: 'Editing analysis.md', detail: '/workspace/analysis.md', path: '/workspace/analysis.md', status: 'done' }
            ]
          }
        ]);
        await new Promise((r) => setTimeout(r, 60));
        const completed = document.querySelector('[data-testid="completed-thinking-block"]');
        completed.querySelector('summary').click();
        await new Promise((r) => setTimeout(r, 40));
        completed.querySelector('[data-testid="thinking-step-skill"] summary').click();
        await new Promise((r) => setTimeout(r, 60));
        const viewerPaneAfterSkill = document.querySelector('[data-testid="viewer-document-pane"]');
        const skillPathBadge = (viewerPaneAfterSkill?.querySelector('[data-testid="viewer-document-path-badge"]')?.textContent || '').trim();
        const skillBodyText = (viewerPaneAfterSkill?.querySelector('[data-testid="viewer-document-body"]')?.textContent || '').trim();
        completed.querySelector('[data-testid="thinking-step-file"] summary').click();
        await new Promise((r) => setTimeout(r, 60));
        const filePathBadge = (document.querySelector('[data-testid="viewer-document-path-badge"]')?.textContent || '').trim();
        const fileBodyText = (document.querySelector('[data-testid="viewer-document-body"]')?.textContent || '').trim();
        document.querySelector('[data-testid="viewer-document-close-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));

        // Issue #151: verify desktop hides mobile-only menu items and supports /skill slash autocomplete
        document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const desktopMobileFolderItemDisplay = window.getComputedStyle(document.querySelector('[data-testid="mobile-menu-folder-btn"]')).display;
        document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));

        window.__DAB_STUDIO__.setPrompt('/lookml');
        await new Promise((r) => setTimeout(r, 60));
        const hasSlashMenu = Boolean(document.querySelector('[data-testid="composer-slash-skill-menu"]'));
        document.querySelector('[data-testid="composer-slash-skill-option-lookml-tests"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const promptAfterSlashPick = window.__DAB_STUDIO__.prompt;
        const activatedAfterSlashPick = window.__DAB_STUDIO__.activatedLookmlSkills;

        return {
          resizerLabel, collapseBtnTitle, reloadViewerBtn, iframeTitle,
          hasViewerPaneAfterSkill: Boolean(viewerPaneAfterSkill), skillPathBadge,
          skillBodyHasGuide: skillBodyText.includes('Lit Data App') || skillBodyText.includes('data-app.js'),
          filePathBadge, fileBodyHasAnalysis: fileBodyText.includes('Q4 Revenue Drop Root-Cause Analysis'),
          viewerClosed: !document.querySelector('[data-testid="viewer-document-pane"]'),
          desktopMobileFolderItemDisplay, hasSlashMenu, promptAfterSlashPick, activatedAfterSlashPick
        };
      })()`,
      awaitPromise: true, returnByValue: true
    })

    expect(desktopRes.result.value).toEqual({
      resizerLabel: 'Resize chat and viewer panes', collapseBtnTitle: 'Collapse viewer', reloadViewerBtn: true, iframeTitle: 'Looker Live Viewer',
      hasViewerPaneAfterSkill: true, skillPathBadge: '/workspace/skills/data-apps/SKILL.md', skillBodyHasGuide: true,
      filePathBadge: '/workspace/analysis.md', fileBodyHasAnalysis: true, viewerClosed: true,
      desktopMobileFolderItemDisplay: 'none', hasSlashMenu: true, promptAfterSlashPick: '/lookml-tests ', activatedAfterSlashPick: ['lookml-tests']
    })

    try {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=data_app` })
      const mobDeadline = Date.now() + 8000
      while (Date.now() < mobDeadline) {
        const r = await chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('.dab-right-pane'))`, returnByValue: true })
        if (r.result?.value) break
        await new Promise((res) => setTimeout(res, 80))
      }

      const mobRes = await chrome.send('Runtime.evaluate', {
        expression: `(async () => {
          const s = window.__DAB_STUDIO__;
          const rightPane = document.querySelector('.dab-right-pane');
          const initialCollapsed = s.rightPaneCollapsed;
          const initialDisplay = window.getComputedStyle(rightPane).display;
          s.setPublishedApp(null); s.setContentItems([]); s.setRightPaneCollapsed(false); s.setBusyStatus('Synthesizing Looker query...');
          await new Promise((r) => setTimeout(r, 60));
          const displayWhileThinkingNoContent = window.getComputedStyle(rightPane).display;
          s.setBusyStatus(null);
          s.setPublishedApp({ dashboardId: '42', title: 'Executive Revenue App', folderId: '1', extensionId: 'data_app_builder::data_app_builder', elementId: '101', code: 'export default class {}' });
          s.setRightPaneCollapsed(true);
          await new Promise((r) => setTimeout(r, 60));
          const chip = document.querySelector('[data-testid="chat-object-viewer-chip-data_app:42"]');
          chip.click();
          await new Promise((r) => setTimeout(r, 60));
          const collapsedAfterChipClick = window.__DAB_STUDIO__.rightPaneCollapsed;
          const cardPosition = window.getComputedStyle(rightPane).position;
          const cardDisplay = window.getComputedStyle(rightPane).display;
          const hasCardHandle = Boolean(document.querySelector('[data-testid="mobile-viewer-card-handle"]'));
          document.querySelector('[data-testid="mobile-viewer-card-close"]').click();
          await new Promise((r) => setTimeout(r, 50));

          // Issue #151: verify 1-row mobile top bar hiding and mobile composer '+' menu controls
          const editBtnHiddenOnMobile = window.getComputedStyle(document.querySelector('[data-testid="studio-edit-agent-name-btn"]')).display === 'none';
          const permToggleHiddenOnMobile = window.getComputedStyle(document.querySelector('[data-testid="permission-mode-toggle"]')).display === 'none';
          const folderTriggerHiddenOnMobile = window.getComputedStyle(document.querySelector('[data-testid="topbar-folder-trigger"]')).display === 'none';
          const fullscreenHiddenOnMobile = window.getComputedStyle(document.querySelector('[data-testid="topbar-fullscreen-toggle"]')).display === 'none';

          document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          const mobileFolderBtnDisplay = window.getComputedStyle(document.querySelector('[data-testid="mobile-menu-folder-btn"]')).display;
          const initialPerm = s.requirePermission;
          document.querySelector('[data-testid="mobile-menu-approval-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          const permAfterToggle = window.__DAB_STUDIO__.requirePermission;

          document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          document.querySelector('[data-testid="mobile-menu-folder-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 50));
          const folderModalOpened = Boolean(document.querySelector('[data-testid="folder-advanced-search-modal"]'));
          window.__DAB_STUDIO__.setFolderModalOpen(false);
          await new Promise((r) => setTimeout(r, 40));

          document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          document.querySelector('[data-testid="mobile-menu-edit-agent-name-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 50));
          const agentNameInputOpened = Boolean(document.querySelector('[data-testid="studio-agent-name-input"]'));

          return {
            initialCollapsed, initialDisplay, displayWhileThinkingNoContent,
            hasObjectChip: Boolean(chip), collapsedAfterChipClick, cardPosition, cardDisplay, hasCardHandle,
            collapsedAfterClose: window.__DAB_STUDIO__.rightPaneCollapsed,
            editBtnHiddenOnMobile, permToggleHiddenOnMobile, folderTriggerHiddenOnMobile, fullscreenHiddenOnMobile,
            mobileFolderBtnDisplay, permToggled: permAfterToggle === !initialPerm, folderModalOpened, agentNameInputOpened
          };
        })()`,
        awaitPromise: true, returnByValue: true
      })

      expect(mobRes.result.value).toEqual({
        initialCollapsed: true, initialDisplay: 'none', displayWhileThinkingNoContent: 'none',
        hasObjectChip: true, collapsedAfterChipClick: false, cardPosition: 'absolute', cardDisplay: 'flex', hasCardHandle: true, collapsedAfterClose: true,
        editBtnHiddenOnMobile: true, permToggleHiddenOnMobile: true, folderTriggerHiddenOnMobile: true, fullscreenHiddenOnMobile: true,
        mobileFolderBtnDisplay: 'flex', permToggled: true, folderModalOpened: true, agentNameInputOpened: true
      })
    } finally {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    }
  }, 20000)

  test('Issue #156: renders scrollable .lkml file tabs + 3-dot code menu, PanelLeftClose/Open sidebar icon, debounced resizer storage, <Bug /> per-turn & whole-thread sandbox debug copy via clipboardWrite, GFM tables, and uncrushed live thinking block on overflow', async () => {
    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=lookml` })
    const lkDeadline = Date.now() + 8000
    while (Date.now() < lkDeadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="lookml-file-tabs"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const lkRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const noLegacyLookmlInput = !document.querySelector('[data-testid="topbar-lookml-project-input"]');
        const noLegacySessionsSelect = !document.querySelector('[data-testid="topbar-lookml-sessions-select"]');
        const hasUnifiedFolderTrigger = Boolean(document.querySelector('[data-testid="topbar-folder-trigger"]'));
        const sidebarBtn = document.querySelector('[data-testid="sidebar-collapse-toggle"]');
        const sidebarHasSvg = Boolean(sidebarBtn?.querySelector('svg.lucide'));
        const sidebarNoGuillemets = !/[«»]/.test(sidebarBtn?.textContent || '');

        const tabsEl = document.querySelector('[data-testid="lookml-file-tabs"]');
        const tabsStyle = window.getComputedStyle(tabsEl);
        const isSingleLineScrollable = tabsStyle.flexWrap === 'nowrap' && tabsStyle.overflowX === 'auto';

        window.__CLIPBOARD_WRITES__ = [];
        document.querySelector('[data-testid="lookml-code-actions-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const hasActionsMenu = Boolean(document.querySelector('[data-testid="lookml-code-actions-menu"]'));
        const toggleTextBefore = (document.querySelector('[data-testid="lookml-toggle-view-mode-btn"]')?.textContent || '').trim();
        document.querySelector('[data-testid="lookml-toggle-view-mode-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));

        document.querySelector('[data-testid="lookml-code-actions-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const toggleTextAfter = (document.querySelector('[data-testid="lookml-toggle-view-mode-btn"]')?.textContent || '').trim();
        document.querySelector('[data-testid="lookml-copy-file-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const copiedLkmlViaExt = (window.__CLIPBOARD_WRITES__ || []).some((t) => t.includes('measure: total_revenue') || t.includes('orders'));

        return {
          noLegacyLookmlInput, noLegacySessionsSelect, hasUnifiedFolderTrigger,
          sidebarHasSvg, sidebarNoGuillemets, isSingleLineScrollable,
          hasActionsMenu, toggleTextBefore, toggleTextAfter, copiedLkmlViaExt
        };
      })()`,
      awaitPromise: true, returnByValue: true
    })

    expect(lkRes.result.value).toEqual({
      noLegacyLookmlInput: true, noLegacySessionsSelect: true, hasUnifiedFolderTrigger: true,
      sidebarHasSvg: true, sidebarNoGuillemets: true, isSingleLineScrollable: true,
      hasActionsMenu: true, toggleTextBefore: 'Show Full .lkml', toggleTextAfter: 'Show Unified Diff', copiedLkmlViaExt: true
    })

    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=data_app` })
    const appDeadline = Date.now() + 8000
    while (Date.now() < appDeadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="workspace-split-resizer"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const chatRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        // 1. Debounced split-pane resizer storage writes (0 mid-drag IPC writes, 1 flushed write on mouseup)
        window.__LOCAL_STORAGE_UPDATES__ = [];
        const resizer = document.querySelector('[data-testid="workspace-split-resizer"]');
        resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 380, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 410, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 440, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 470, bubbles: true }));
        const writesDuringDrag = (window.__LOCAL_STORAGE_UPDATES__ || []).filter((u) => u.key === 'dab_left_pane_width').length;
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const writesAfterMouseUp = (window.__LOCAL_STORAGE_UPDATES__ || []).filter((u) => u.key === 'dab_left_pane_width').length;

        // 2. Overflow chat log + GFM pipe table + <hr> + <ol start> + live thinking block not crushed to 2px + Bug copy buttons
        window.__MOCK_LOOKER_EXTENSION__.mockInteractions = {
          int_chain_2: {
            id: 'int_chain_2', previous_interaction_id: 'int_chain_1', status: 'completed', environment_id: 'env_vis_156',
            steps: [{ id: 's2', type: 'thought', thought: 'Remote sandbox thought from turn 2' }],
            output_text: 'Updated /workspace/analysis.md.'
          },
          int_chain_1: {
            id: 'int_chain_1', status: 'completed', environment_id: 'env_vis_156',
            steps: [{ id: 's1', type: 'code_execution', language: 'BASH', command: 'cat /workspace/analysis.md', stdout: 'SANDBOX_STDOUT_156' }],
            output_text: 'Initial analysis.'
          }
        };
        const manyMsgs = [];
        for (let i = 0; i < 14; i++) {
          manyMsgs.push({ role: 'user', text: 'Follow-up turn ' + (i + 1) + ' with detailed metric filter context' });
          manyMsgs.push({
            role: 'assistant',
            interactionId: i === 13 ? 'int_chain_2' : undefined,
            thinkingDurationSec: 2,
            activitySteps: [{ id: 'st_' + i, kind: 'codemode', title: 'Executing Looker queries...', status: 'done' }],
            text: i === 13
              ? '| Segment | Margin |\\n| :--- | ---: |\\n| Outerwear | $98,400 |\\n\\n---\\n\\n5. Fifth item'
              : 'Assistant response paragraph ' + (i + 1) + ' filling vertical scroll height in chat log.'
          });
        }
        s.setOauthToken('mock_oauth_token_156');
        s.setMessages(manyMsgs);
        s.setBusyStatus('Running sandbox verification...');
        s.setLiveActivitySteps([
          { id: 'live_1', kind: 'thought', title: 'Validating widget queries', detail: 'Checking fields against schema', status: 'running' },
          { id: 'live_2', kind: 'code_execution', language: 'PYTHON', title: 'python3 /workspace/bundle_app.py', status: 'running' }
        ]);
        await new Promise((r) => setTimeout(r, 80));

        const chatLog = document.querySelector('.dab-chat-log');
        const liveBlock = document.querySelector('[data-testid="live-thinking-block"]');
        const liveHeight = liveBlock ? Math.round(liveBlock.getBoundingClientRect().height) : 0;
        const hasGfmTable = Boolean(document.querySelector('[data-testid="chat-markdown-table"]'));
        const hasHr = Boolean(document.querySelector('hr.dab-md-hr'));
        const olStart = document.querySelector('ol.dab-md-list')?.getAttribute('start') || '';

        // Auto-scroll on user send
        chatLog.scrollTop = 0;
        s.setMessages((prev) => [...prev, { role: 'user', text: 'Scroll me to bottom on send' }]);
        await new Promise((r) => setTimeout(r, 60));
        const autoScrolledToBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight <= 20;

        // Per-turn <Bug /> button & Whole-thread <Bug /> Copy Thread button via clipboardWrite
        window.__CLIPBOARD_WRITES__ = [];
        const perTurnBtn = document.querySelector('[data-testid="copy-thinking-trace-btn"]');
        const perTurnTitle = perTurnBtn?.getAttribute('title') || '';
        const perTurnHasBugSvg = Boolean(perTurnBtn?.querySelector('svg.lucide-bug, svg.lucide'));
        perTurnBtn?.click();
        await new Promise((r) => setTimeout(r, 40));
        const perTurnCopiedViaExt = (window.__CLIPBOARD_WRITES__ || []).some((t) => t.includes('## Thinking & Activity Trace'));

        window.__CLIPBOARD_WRITES__ = [];
        const threadBtn = document.querySelector('[data-testid="copy-thread-trace-btn"]');
        threadBtn?.click();
        await new Promise((r) => setTimeout(r, 120));
        const threadDump = (window.__CLIPBOARD_WRITES__ || [])[0] || '';

        return {
          writesDuringDrag, writesAfterMouseUp,
          chatOverflowing: chatLog.scrollHeight > chatLog.clientHeight,
          liveBlockUncrushed: liveHeight >= 40,
          hasGfmTable, hasHr, olStart, autoScrolledToBottom,
          perTurnTitle, perTurnHasBugSvg, perTurnCopiedViaExt,
          threadHasTurn1AndTurn2: threadDump.includes('int_chain_1') && threadDump.includes('int_chain_2'),
          threadHasStdout: threadDump.includes('SANDBOX_STDOUT_156'),
          threadHasLiveStep: threadDump.includes('python3 /workspace/bundle_app.py')
        };
      })()`,
      awaitPromise: true, returnByValue: true
    })

    expect(chatRes.result.value).toEqual({
      writesDuringDrag: 0, writesAfterMouseUp: 1,
      chatOverflowing: true, liveBlockUncrushed: true,
      hasGfmTable: true, hasHr: true, olStart: '5', autoScrolledToBottom: true,
      perTurnTitle: 'Copy debug trace to clipboard', perTurnHasBugSvg: true, perTurnCopiedViaExt: true,
      threadHasTurn1AndTurn2: true, threadHasStdout: true, threadHasLiveStep: true
    })

    // Also verify mobile-menu-copy-thread-btn on <=768px viewport
    try {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      const mobCopyRes = await chrome.send('Runtime.evaluate', {
        expression: `(async () => {
          window.__CLIPBOARD_WRITES__ = [];
          const leftHeaderHiddenOnMobile = window.getComputedStyle(document.querySelector('[data-testid="left-pane-header"]')).display === 'none';
          document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          const mobCopyBtn = document.querySelector('[data-testid="mobile-menu-copy-thread-btn"]');
          const mobCopyDisplay = mobCopyBtn ? window.getComputedStyle(mobCopyBtn).display : 'missing';
          mobCopyBtn?.click();
          await new Promise((r) => setTimeout(r, 100));
          return {
            leftHeaderHiddenOnMobile,
            mobCopyDisplay,
            copiedOnMobile: (window.__CLIPBOARD_WRITES__ || []).some((t) => t.includes('Conversation Sandbox Debug Dump'))
          };
        })()`,
        awaitPromise: true, returnByValue: true
      })
      expect(mobCopyRes.result.value).toEqual({
        leftHeaderHiddenOnMobile: true,
        mobCopyDisplay: 'flex',
        copiedOnMobile: true
      })
    } finally {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    }
  }, 20000)

  test('Issue #155: keeps immutable conv_<id> across LookML -> Dashboard turns with optimistic SWR sidebar insert, hides & restores unified content tabs via 3-dot menu, and navigates synchronously to / on active conversation delete', async () => {
    chrome.close()
    chrome = await startHeadlessChrome()
    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=data_app` })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="new-conversation-btn"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const flowRes = await chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DAB_STUDIO__.setAuthMode('apikey');
        window.__DAB_STUDIO__.setApiKey('mock-api-key');
        await new Promise((r) => setTimeout(r, 80));

        window.__INTERACTION_CALLS__ = [];
        window.__ARTIFACT_UPDATES__ = [];
        const ext = window.__DAB_STUDIO__.extensionSDK;
        const origProxy = ext.serverProxy.bind(ext);
        ext.serverProxy = async (url, init) => {
          const body = init && init.body ? JSON.parse(init.body) : {};
          const inputText = (body.input && body.input[0] && body.input[0].text) || '';
          window.__INTERACTION_CALLS__.push({ url, method: (init && init.method) || 'GET', body });
          if (inputText.includes('[CONVERSATION_LABEL_REQUEST]')) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({ id: 'int_lbl_155', status: 'completed', output_text: '"Order Items LookML & UDD"' }),
            };
          }
          if (inputText.includes('order_items.view.lkml')) {
            await new Promise((r) => setTimeout(r, 90));
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_155_turn_1',
                environment_id: 'env_155_shared',
                status: 'completed',
                output_text:
                  '<USE_CASE>lookml</USE_CASE>\\nAdded measures.\\n<LOOKML_BUNDLE>{"id":"thelook_1762720001","title":"Order Items Measures","project_id":"thelook","model_name":"thelook","branch_name":"dev_1","files":[{"path":"views/order_items.view.lkml","action":"updated","content":"view: order_items {}","diff":"@@ -1 +1 @@"}],"validation":{"passed":true,"error_count":0,"errors":[]},"tests":[],"queries":[]}</LOOKML_BUNDLE>',
              }),
            };
          }
          if (inputText.includes('native Looker UDD dashboard')) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_155_turn_2',
                environment_id: 'env_155_shared',
                status: 'completed',
                output_text:
                  '<USE_CASE>dashboard</USE_CASE>\\nCreated Executive KPI UDD.\\n<NATIVE_CONTENT_BUNDLE>{"id":"99","content_type":"dashboard","title":"Executive KPI UDD","folder_id":"5","tile_count":2,"explores":["thelook::order_items"]}</NATIVE_CONTENT_BUNDLE>',
              }),
            };
          }
          return origProxy(url, init);
        };

        // 1. Start fresh conversation at /
        document.querySelector('[data-testid="new-conversation-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));
        const routeAtRoot = window.__DAB_STUDIO__.history.location.pathname;

        // 2. Submit Turn 1 (LookML) and inspect IMMEDIATE optimistic route + sidebar entry before network finishes
        const turn1Promise = window.__DAB_STUDIO__.handleSendPrompt({ text: 'Add total_revenue and gross_margin measures to order_items.view.lkml' });
        await new Promise((r) => setTimeout(r, 15));
        const optimisticRoute = window.__DAB_STUDIO__.history.location.pathname;
        const optimisticConvId = optimisticRoute.replace('/c/', '');
        const optimisticSidebarItem = Boolean(document.querySelector('[data-testid="conversation-item-' + optimisticConvId + '"]'));
        await turn1Promise;
        await new Promise((r) => setTimeout(r, 150));

        const routeAfterLookmlTurn = window.__DAB_STUDIO__.history.location.pathname;
        const lookmlTabPresent = Boolean(document.querySelector('[data-testid^="studio-content-tab-lookml:"]'));

        // 3. Submit Turn 2 (Dashboard) on the SAME conversation -> route & convId stay immutable, messages[] is continuous
        await window.__DAB_STUDIO__.handleSendPrompt({ text: 'Create a native Looker UDD dashboard for executive KPIs' });
        await new Promise((r) => setTimeout(r, 150));

        const routeAfterDashTurn = window.__DAB_STUDIO__.history.location.pathname;
        const matchingSidebarConvs = Array.from(document.querySelectorAll('[data-testid="conversation-item-' + optimisticConvId + '"]')).length;
        const totalMsgCount = window.__DAB_STUDIO__.messages.length;
        const visibleTabEls = Array.from(document.querySelectorAll('[data-testid^="studio-content-tab-"]:not([data-testid^="studio-content-tab-close-"]):not([data-testid^="studio-content-tab-restore-"])'));
        const tabKeysAfter2Turns = visibleTabEls.map((el) => el.getAttribute('data-testid').replace('studio-content-tab-', ''));
        const noMoreBtnBeforeHide = !document.querySelector('[data-testid="studio-content-tabs-more-btn"]');

        // 4. Close (hide) the active dashboard tab -> focuses remaining LookML tab, persists hidden:true, shows 3-dot restore button
        const dashTabKey = tabKeysAfter2Turns.find((k) => k.startsWith('dashboard:'));
        const lookmlTabKey = tabKeysAfter2Turns.find((k) => k.startsWith('lookml:'));
        document.querySelector('[data-testid="studio-content-tab-close-' + dashTabKey + '"]').click();
        await new Promise((r) => setTimeout(r, 100));

        const activeKeyAfterFirstClose = window.__DAB_STUDIO__.activeContentItem?.key || '';
        const moreBtnAfterHide = document.querySelector('[data-testid="studio-content-tabs-more-btn"]');
        const hasMoreBtnAfterHide = Boolean(moreBtnAfterHide);

        // Open 3-dot menu and verify light & dark mode computed styles + restore item presence + union clip rect
        moreBtnAfterHide.click();
        await new Promise((r) => setTimeout(r, 60));
        const menuEl = document.querySelector('[data-testid="studio-content-tabs-more-menu"]');
        const restoreBtn = document.querySelector('[data-testid="studio-content-tab-restore-' + dashTabKey + '"]');
        const lightMenuBg = menuEl ? window.getComputedStyle(menuEl).backgroundColor : '';
        const rects = ['[data-testid="studio-content-tabs"]', '[data-testid="studio-content-tabs-more-menu"]']
          .flatMap((sel) => Array.from(document.querySelectorAll(sel)))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        const ribbonMenuClipValid = rects.length === 2 && rects[1].right <= 1440 && rects[1].bottom <= 900;
        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 40));
        const darkMenuBg = menuEl ? window.getComputedStyle(menuEl).backgroundColor : '';
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));

        // Close remaining LookML tab -> all tabs hidden, ribbon + 3-dot button remain visible, viewer shows empty-hidden state
        document.querySelector('[data-testid="studio-content-tab-close-' + lookmlTabKey + '"]').click();
        await new Promise((r) => setTimeout(r, 80));
        const allHiddenPlaceholder = Boolean(document.querySelector('[data-testid="studio-content-tabs-all-hidden"]'));
        const ribbonStillVisibleWhenAllHidden = Boolean(document.querySelector('[data-testid="studio-content-tabs"]'));

        // Restore dashboard tab from 3-dot menu -> sets hidden:false and activates dashboard tab
        if (!document.querySelector('[data-testid="studio-content-tabs-more-menu"]')) {
          document.querySelector('[data-testid="studio-content-tabs-more-btn"]').click();
          await new Promise((r) => setTimeout(r, 60));
        }
        document.querySelector('[data-testid="studio-content-tab-restore-' + dashTabKey + '"]').click();
        await new Promise((r) => setTimeout(r, 100));
        const activeKeyAfterRestore = window.__DAB_STUDIO__.activeContentItem?.key || '';

        const convUpdates = (window.__ARTIFACT_UPDATES__ || []).filter((u) => u.key === 'user_conversations:1');
        const latestConvs = convUpdates.length ? JSON.parse(convUpdates[convUpdates.length - 1].value) : [];
        const persistedConv = latestConvs.find((c) => c.id === optimisticConvId);
        const hasZeroActivityStepsBloat = !(persistedConv?.messages || []).some((m) => Boolean(m.activitySteps));

        // 5. Synchronous delete-to-/ navigation on active chat-only / conv_<ts> conversation BEFORE deleteUserConversation resolves
        window.__DAB_STUDIO__.setActiveObjectId('');
        const deletePromise = window.__DAB_STUDIO__.handleDeleteConversation(undefined, optimisticConvId, false);
        const routeImmediatelyOnDelete = window.__DAB_STUDIO__.history.location.pathname;
        await deletePromise;

        return {
          routeAtRoot,
          optimisticIsConvPrefix: optimisticRoute.startsWith('/c/conv_'),
          optimisticSidebarItem,
          immutableAcrossLookml: routeAfterLookmlTurn === optimisticRoute,
          immutableAcrossDash: routeAfterDashTurn === optimisticRoute,
          lookmlTabPresent,
          matchingSidebarConvs,
          totalMsgCount,
          hasBothLookmlAndDashTabs: Boolean(lookmlTabKey && dashTabKey),
          noMoreBtnBeforeHide,
          activeKeyAfterFirstCloseMatchesLookml: activeKeyAfterFirstClose === lookmlTabKey,
          hasMoreBtnAfterHide,
          hasRestoreMenuAndItem: Boolean(menuEl && restoreBtn),
          ribbonMenuClipValid,
          themeContrastDistinct: Boolean(lightMenuBg && darkMenuBg && lightMenuBg !== darkMenuBg),
          allHiddenPlaceholder,
          ribbonStillVisibleWhenAllHidden,
          activeKeyAfterRestoreMatchesDash: activeKeyAfterRestore === dashTabKey,
          hasZeroActivityStepsBloat,
          routeImmediatelyOnDelete,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    expect(flowRes.result.value).toEqual({
      routeAtRoot: '/',
      optimisticIsConvPrefix: true,
      optimisticSidebarItem: true,
      immutableAcrossLookml: true,
      immutableAcrossDash: true,
      lookmlTabPresent: true,
      matchingSidebarConvs: 1,
      totalMsgCount: 4,
      hasBothLookmlAndDashTabs: true,
      noMoreBtnBeforeHide: true,
      activeKeyAfterFirstCloseMatchesLookml: true,
      hasMoreBtnAfterHide: true,
      hasRestoreMenuAndItem: true,
      ribbonMenuClipValid: true,
      themeContrastDistinct: true,
      allHiddenPlaceholder: true,
      ribbonStillVisibleWhenAllHidden: true,
      activeKeyAfterRestoreMatchesDash: true,
      hasZeroActivityStepsBloat: true,
      routeImmediatelyOnDelete: '/',
    })
  }, 20000)
})
