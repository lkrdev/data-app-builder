const SAMPLE_PASTED_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function buildMockFixturesScript(scenario) {
  return `
    (function() {
      const scenario = ${JSON.stringify(scenario)};
      window.lkr_codemode_api_calls = [];
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
            { role: 'assistant', text: 'Built and published Executive Revenue App (Dashboard #42) with 3 KPI cards and a Highcharts monthly trend chart.', dashboardId: '42', widgetCount: 4, crudItems: [{ key: 'data_app:42', id: '42', title: 'Executive Revenue App', contentType: 'data_app', embedPath: '/embed/dashboards/42', action: 'created' }] }
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
              { role: 'assistant', text: 'Built and published Executive Revenue App (Dashboard #42) with 3 KPI cards and a Highcharts monthly trend chart.', dashboardId: '42', widgetCount: 4, crudItems: [{ key: 'data_app:42', id: '42', title: 'Executive Revenue App', contentType: 'data_app', embedPath: '/embed/dashboards/42', action: 'created' }] }
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
        },`
}

module.exports = {
  SAMPLE_PASTED_IMAGE_DATA_URL,
  buildMockFixturesScript
}
