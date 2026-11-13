function registerVisualPart10Tests(ctx) {
  const { startHeadlessChrome } = ctx
  test('Unified Stage + pinned far-right Overview Explorer keeps Looker iframe warm (/preload <-> loadDashboard/loadLook/loadExplore) without unmounting across Review, Changed Files, Skills, API Calls, and Content', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && window.__LOOKER_EMBED_STATE__ && document.querySelector('[data-testid="looker-embed-container"] iframe'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        const container = document.querySelector('[data-testid="looker-embed-container"]');
        const iframeContainer = document.querySelector('.dab-iframe-container');
        const iframe0 = container.querySelector('iframe');
        const ov0 = document.querySelector('[data-testid="studio-overview-sidebar"]');

        window.lkr_codemode_api_calls = [
          {
            method: 'GET',
            route: '/lookml_models/thelook/explores/order_items',
            query_params: { fields: 'id,name,dimensions' },
            body: null,
            response: { ok: true, status: 200, body: { name: 'order_items', label: 'Order Items' } },
            timestamp: '2026-11-11T20:00:00Z',
            duration_ms: 48,
          },
          {
            method: 'POST',
            route: '/queries/run/json',
            query_params: { limit: 500 },
            body: { model: 'thelook', view: 'order_items', fields: ['order_items.bad_field'] },
            response: { ok: false, status: 422, body: { message: 'Unknown field order_items.bad_field' } },
            timestamp: '2026-11-11T20:00:01Z',
            duration_ms: 194,
          },
        ];

        s.setLookmlBundle({
          id: 'ecom_proj',
          title: 'LookML: ecom_proj',
          project_id: 'ecom_proj',
          model_name: 'thelook',
          branch_name: 'dev_bryan',
          files: [
            {
              path: 'bronze/orders.view.lkml',
              action: 'created',
              content: 'view: orders {\\n  sql_table_name: ecom.orders ;;\\n}\\n',
              diff: '--- a/bronze/orders.view.lkml\\n+++ b/bronze/orders.view.lkml\\n@@ -0,0 +1,3 @@\\n+view: orders {\\n+  sql_table_name: ecom.orders ;;\\n+}\\n',
            },
            {
              path: 'silver/orders.refinement.lkml',
              action: 'updated',
              content: 'view: +orders {\\n  measure: total_revenue { type: sum sql: \${TABLE}.sale_price ;; }\\n}\\n',
              diff: '--- a/silver/orders.refinement.lkml\\n+++ b/silver/orders.refinement.lkml\\n@@ -1,1 +1,3 @@\\n+view: +orders {\\n+  measure: total_revenue { type: sum sql: \${TABLE}.sale_price ;; }\\n+}\\n',
            },
          ],
          validation: { passed: true, error_count: 0, errors: [] },
          tests: [{ test_name: 'orders_pk_unique', success: true }],
          queries: [{ query_index: 0, label: 'Revenue Parity', sql_slug: 'sql_rev_1', explore_slug: 'exp_rev_1', parity_status: 'matched' }],
        });

        s.setContentItems([
          { key: 'dashboard:42', id: '42', dashboardId: '42', contentType: 'dashboard', title: 'Executive KPIs', embedPath: '/embed/dashboards/42', hidden: false },
          { key: 'look:15', id: '15', lookId: '15', contentType: 'look', title: 'Top Brands Look', embedPath: '/embed/looks/15', hidden: false },
          { key: 'explore:thelook::order_items', id: 'thelook::order_items', exploreId: 'thelook::order_items', contentType: 'explore', title: 'Order Items Explore', embedPath: '/embed/explore/thelook/order_items', hidden: false },
          { key: 'lookml:ecom_proj', id: 'ecom_proj', projectId: 'ecom_proj', contentType: 'lookml', title: 'LookML: ecom_proj', embedPath: '/lookml/ecom_proj', hidden: false },
        ]);
        s.handleSelectContentTab('dashboard:42');
        s.setMessages([
          { role: 'user', text: '/looker-dashboard Build Executive KPIs' },
          { role: 'assistant', text: 'Built [Executive KPIs](/dashboards/42) and LookML refinements.' },
        ]);
        await new Promise((r) => setTimeout(r, 120));

        // 1. Option A layout: Stage + docked 264px Overview rail + active slider resizer
        const resizer = document.querySelector('[data-testid="workspace-split-resizer"]');
        const stageEl = document.querySelector('[data-testid="studio-unified-stage"]');
        const ovDocked = ov0.getAttribute('data-docked') === 'true' && Math.round(ov0.getBoundingClientRect().width) === 236;
        const dashRowActive = document.querySelector('[data-testid="overview-content-item-dashboard:42"]')?.getAttribute('aria-current') === 'true';
        const stageWidthBeforeResize = Math.round(stageEl.getBoundingClientRect().width);
        resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const stageWidthAfterResize = Math.round(stageEl.getBoundingClientRect().width);
        const sliderGrewStage = stageWidthAfterResize > stageWidthBeforeResize;

        // Toggle Explorer rail closed -> Stage widens -> toggle back open
        document.querySelector('[data-testid="stage-explorer-toggle-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const stageWidthRailHidden = Math.round(stageEl.getBoundingClientRect().width);
        document.querySelector('[data-testid="stage-explorer-toggle-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const explorerToggleWorks = stageWidthRailHidden > stageWidthAfterResize && Boolean(document.querySelector('[data-testid="studio-overview-sidebar"]'));

        // 2. Click Review in pinned Overview rail -> transitions iframe to /preload (display:none) without unmounting!
        document.querySelector('[data-testid="overview-nav-review"]')?.click();
        await new Promise((r) => setTimeout(r, 100));
        const reviewState = {
          paneOpen: Boolean(document.querySelector('[data-testid="stage-review-pane"]')),
          reviewRowActive: document.querySelector('[data-testid="overview-nav-review"]')?.getAttribute('aria-current') === 'true',
          hasChecksCard: Boolean(document.querySelector('[data-testid="stage-review-checks-card"]')),
          diffFileCount: document.querySelectorAll('[data-testid^="stage-review-file-"]').length,
          embedPreloaded: container.getAttribute('data-embed-state') === 'preloaded' && container.getAttribute('data-embed-target') === '/preload',
          iframeHidden: window.getComputedStyle(iframeContainer).display === 'none',
          sameIframe: container.querySelector('iframe') === iframe0,
        };

        // 3. Click Changed File #1 (silver/orders.refinement.lkml) in pinned Overview rail -> selects exact .lkml file #1!
        document.querySelector('[data-testid="overview-file-item-1"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const lookmlFileState = {
          fileRowActive: document.querySelector('[data-testid="overview-file-item-1"]')?.getAttribute('aria-current') === 'true',
          secondTabPrimary: document.querySelector('[data-testid="lookml-file-tab-1"]')?.classList.contains('dab-btn-primary'),
          codeContainsRefinement: (document.querySelector('[data-testid="lookml-code-pre"]')?.textContent || '').includes('view: +orders'),
          sameIframe: container.querySelector('iframe') === iframe0,
        };

        // 4. Click Skill in pinned Overview rail -> opens unified viewer-document-pane with Rendered | Raw toggle
        document.querySelector('[data-testid="overview-skill-item-looker-dashboard"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const skillRendered = Boolean(document.querySelector('[data-testid="viewer-document-markdown"]'));
        document.querySelector('[data-testid="viewer-document-mode-raw"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const skillRaw = Boolean(document.querySelector('[data-testid="viewer-document-code"]'));
        const skillState = {
          skillRowActive: document.querySelector('[data-testid="overview-skill-item-looker-dashboard"]')?.getAttribute('aria-current') === 'true',
          skillRendered,
          skillRaw,
          sameIframe: container.querySelector('iframe') === iframe0,
        };

        // 5. Expand API Calls in pinned Overview rail & click failed 422 POST /queries/run/json -> opens stage-api-inspector
        document.querySelector('[data-testid="overview-section-api-calls-toggle"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="overview-api-call-1"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const apiInspectorText = document.querySelector('[data-testid="stage-api-inspector"]')?.innerText || '';
        const apiState = {
          inspectorOpen: Boolean(document.querySelector('[data-testid="stage-api-inspector"]')),
          apiRowActive: document.querySelector('[data-testid="overview-api-call-1"]')?.getAttribute('aria-current') === 'true',
          showsQueryParams: Boolean(document.querySelector('[data-testid="stage-api-query-params"]')),
          showsRequestBody: Boolean(document.querySelector('[data-testid="stage-api-request-body"]')),
          shows422Body: apiInspectorText.includes('Unknown field order_items.bad_field'),
          embedPreloaded: container.getAttribute('data-embed-state') === 'preloaded',
          sameIframe: container.querySelector('iframe') === iframe0,
        };

        // 6. Click Look #15 -> Explore -> Dashboard #42 -> Overview in pinned Overview rail -> loadLook, loadExplore, loadDashboard, /preload on SAME iframe0!
        const callsStart = (window.__LOOKER_EMBED_STATE__?.calls || []).length;
        document.querySelector('[data-testid="overview-content-item-look:15"]')?.click();
        await new Promise((r) => setTimeout(r, 100));
        const afterLook = {
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target'),
          visible: window.getComputedStyle(iframeContainer).display !== 'none',
          sameIframe: container.querySelector('iframe') === iframe0,
        };

        document.querySelector('[data-testid="overview-content-item-explore:thelook::order_items"]')?.click();
        await new Promise((r) => setTimeout(r, 100));
        const afterExplore = {
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target'),
          sameIframe: container.querySelector('iframe') === iframe0,
        };

        document.querySelector('[data-testid="overview-content-item-dashboard:42"]')?.click();
        await new Promise((r) => setTimeout(r, 100));
        const afterDash = {
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target'),
          sameIframe: container.querySelector('iframe') === iframe0,
        };

        document.querySelector('[data-testid="studio-overview-tab"]')?.click();
        await new Promise((r) => setTimeout(r, 100));
        const afterOverview = {
          isOverviewMode: document.querySelector('.dab-right-pane')?.getAttribute('data-overview-mode') === 'true',
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target'),
          sameIframe: container.querySelector('iframe') === iframe0,
          sameOverviewNode: document.querySelector('[data-testid="studio-overview-sidebar"]') === ov0,
        };

        const callSeq = (window.__LOOKER_EMBED_STATE__?.calls || []).slice(callsStart).map((c) => \`\${c.method}:\${c.arg}\`);

        // Dark mode overflow + background-tab hide preservation on Review + Script/Report/CA iframe warmth
        window.__DAB_STUDIO__.setThemeMode('dark');
        document.querySelector('[data-testid="overview-nav-review"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const darkNoOverflow = document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
        document.querySelector('[data-testid="studio-content-tab-close-look:15"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const reviewStayedOnBgTabHide = Boolean(document.querySelector('[data-testid="stage-review-pane"]'));

        window.__DAB_STUDIO__.setHealthReport({ id: 'hc_1', title: 'Audit', tddMarkdown: '# Audit\\nAll clear.', scores: { overallScore: 92, grade: 'A-', transcriberScore: '3.80' } });
        await new Promise((r) => setTimeout(r, 40));
        window.__DAB_STUDIO__.upsertContentItem({ id: 'hc_1', contentType: 'report', title: 'Audit', embedPath: '/health/hc_1', hidden: false }, true);
        await new Promise((r) => setTimeout(r, 50));
        const sameIframeOnReport = container.querySelector('iframe') === iframe0 && container.getAttribute('data-embed-state') === 'preloaded';
        window.__DAB_STUDIO__.upsertContentItem({ id: 'demo1', contentType: 'script', title: 'Script demo1', embedPath: '/tile/demo1', hidden: false }, true);
        await new Promise((r) => setTimeout(r, 50));
        const sameIframeOnScript = container.querySelector('iframe') === iframe0 && container.getAttribute('data-embed-state') === 'preloaded';
        document.querySelector('[data-testid="overview-content-item-dashboard:42"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const sameIframeAcrossAllModes = sameIframeOnReport && sameIframeOnScript && container.querySelector('iframe') === iframe0 && container.getAttribute('data-embed-state') === 'dashboard';
        window.__DAB_STUDIO__.setThemeMode('light');

        return {
          ovDocked,
          dashRowActive,
          sliderGrewStage,
          explorerToggleWorks,
          reviewState,
          lookmlFileState,
          skillState,
          apiState,
          afterLook,
          afterExplore,
          afterDash,
          afterOverview,
          callSeq,
          darkNoOverflow,
          reviewStayedOnBgTabHide,
          sameIframeAcrossAllModes,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    expect(res.result.value).toEqual({
      ovDocked: true,
      dashRowActive: true,
      sliderGrewStage: true,
      explorerToggleWorks: true,
      reviewState: {
        paneOpen: true,
        reviewRowActive: true,
        hasChecksCard: true,
        diffFileCount: 3,
        embedPreloaded: true,
        iframeHidden: true,
        sameIframe: true,
      },
      lookmlFileState: {
        fileRowActive: true,
        secondTabPrimary: true,
        codeContainsRefinement: true,
        sameIframe: true,
      },
      skillState: {
        skillRowActive: true,
        skillRendered: true,
        skillRaw: true,
        sameIframe: true,
      },
      apiState: {
        inspectorOpen: true,
        apiRowActive: true,
        showsQueryParams: true,
        showsRequestBody: true,
        shows422Body: true,
        embedPreloaded: true,
        sameIframe: true,
      },
      afterLook: {
        state: 'look',
        target: '15',
        visible: true,
        sameIframe: true,
      },
      afterExplore: {
        state: 'explore',
        target: 'thelook/order_items',
        sameIframe: true,
      },
      afterDash: {
        state: 'dashboard',
        target: '42',
        sameIframe: true,
      },
      afterOverview: {
        isOverviewMode: true,
        state: 'preloaded',
        target: '/preload',
        sameIframe: true,
        sameOverviewNode: true,
      },
      callSeq: [
        'loadLook:15',
        'loadExplore:thelook/order_items',
        'loadDashboard:42',
        'loadUrl:/preload',
      ],
      darkNoOverflow: true,
      reviewStayedOnBgTabHide: true,
      sameIframeAcrossAllModes: true,
    })

    // 7. Compact <= 1080px slide-over drawer ARIA/Escape/resize sync + 390x844 mobile bottom sheet navigation
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 800, deviceScaleFactor: 1, mobile: false })
    const compactRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.dispatchEvent(new Event('resize'));
        await new Promise((r) => setTimeout(r, 50));
        const btn = document.querySelector('[data-testid="stage-explorer-toggle-btn"]');
        const pressedClosed = btn?.getAttribute('aria-pressed');
        btn?.click();
        await new Promise((r) => setTimeout(r, 50));
        const pressedOpen = btn?.getAttribute('aria-pressed');
        const hasBackdrop = Boolean(document.querySelector('[data-testid="overview-mobile-backdrop"]'));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));
        const pressedAfterEsc = btn?.getAttribute('aria-pressed');
        btn?.click();
        await new Promise((r) => setTimeout(r, 40));
        return { pressedClosed, pressedOpen, hasBackdrop, pressedAfterEsc };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    expect(compactRes.result.value).toEqual({
      pressedClosed: 'false',
      pressedOpen: 'true',
      hasBackdrop: true,
      pressedAfterEsc: 'false',
    })

    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    const desktopAfterResize = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.dispatchEvent(new Event('resize'));
        await new Promise((r) => setTimeout(r, 50));
        document.querySelector('[data-testid="overview-docked-hide-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 50));
        const hiddenAfterDesktopClose = window.getComputedStyle(document.querySelector('[data-testid="studio-overview-sidebar"]')).display === 'none';
        document.querySelector('[data-testid="stage-explorer-toggle-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        return { hiddenAfterDesktopClose };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    expect(desktopAfterResize.result.value).toEqual({ hiddenAfterDesktopClose: true })

    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    const mobileRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.dispatchEvent(new Event('resize'));
        document.querySelector('[data-testid="overview-nav-review"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const tabsHiddenOnNonTabStage = window.getComputedStyle(document.querySelector('[data-testid="studio-content-tabs"]')).display === 'none';
        const noMobileOverflow = document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
        document.querySelector('[data-testid="mobile-viewer-overview-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const returnedToOverview = document.querySelector('.dab-right-pane')?.getAttribute('data-overview-mode') === 'true';
        return { tabsHiddenOnNonTabStage, noMobileOverflow, returnedToOverview };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    expect(mobileRes.result.value).toEqual({
      tabsHiddenOnNonTabStage: true,
      noMobileOverflow: true,
      returnedToOverview: true,
    })
  }, 30000)

  test('Issue #185: clamps >5-line and >360-char user messages with click-to-expand + Show more/Show less toggle and renders single-line /<skill-id> + description without redundant labels', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })
    const readyDeadline = Date.now() + 8000
    while (Date.now() < readyDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="studio-prompt-input"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const res185 = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        const longMultilinePrompt = [
          'Refactor \`order_items\` SQL into Bronze + Silver LookML:',
          '\`\`\`sql',
          'SELECT order_id, user_id, inventory_item_id, status,',
          '  created_at, shipped_at, delivered_at, returned_at,',
          '  sale_price, gross_margin',
          'FROM \`thelook.order_items\`',
          'WHERE status NOT IN (\\'Cancelled\\', \\'Returned\\')',
          '  AND created_at >= TIMESTAMP(\\'2025-01-01\\')',
          'GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10',
          'ORDER BY sale_price DESC',
          'LIMIT 500;',
          '\`\`\`',
          'Reference [Orders Dashboard](/dashboards/42) for KPI parity.',
        ].join('\\n');
        const longSingleLinePrompt = 'Analyze revenue retention across cohorts: ' + 'segment_breakdown_metric '.repeat(18);
        s.setMessages([
          { role: 'user', text: longMultilinePrompt },
          { role: 'assistant', text: 'Modeled order_items in Bronze and Silver.' },
          { role: 'user', text: 'Short 2-line follow-up\\nwith second line.' },
          { role: 'user', text: longSingleLinePrompt },
        ]);
        await new Promise((r) => setTimeout(r, 80));

        const userBodies = Array.from(document.querySelectorAll('.dab-msg-user .dab-msg-body'));
        const body0 = userBodies[0];
        const bodyShort = userBodies[1];
        const bodyLongChars = userBodies[2];
        const toggle0 = document.querySelector('[data-testid="toggle-user-msg-expand-0"]');
        const copyBtn0 = document.querySelector('[data-testid="copy-user-msg-btn-0"]');

        const initialCollapsedAttr = body0?.getAttribute('data-collapsed');
        const hasCollapsedClass = Boolean(body0?.classList.contains('dab-msg-body-collapsed'));
        const collapsedHeight = Math.round(body0.getBoundingClientRect().height);
        const bodyScrollHeight = body0.scrollHeight;
        const shortHasCollapsedAttr = bodyShort?.hasAttribute('data-collapsed');
        const shortHasToggle = Boolean(document.querySelector('[data-testid="toggle-user-msg-expand-2"]'));
        const longCharsCollapsed = bodyLongChars?.getAttribute('data-collapsed') === 'true' && Boolean(document.querySelector('[data-testid="toggle-user-msg-expand-3"]'));
        const toggleInitialLabel = (toggle0?.textContent || '').trim();
        const toggleInitialAria = toggle0?.getAttribute('aria-expanded');
        const toggleAriaControls = toggle0?.getAttribute('aria-controls') === 'user-msg-body-0' && body0?.id === 'user-msg-body-0';
        const toggleCs = window.getComputedStyle(toggle0);
        const toggleTypography = { fontSize: toggleCs.fontSize, fontWeight: toggleCs.fontWeight };
        const toggleUnclipped = Boolean(toggle0 && toggle0.scrollHeight <= toggle0.clientHeight + 2);
        const hasCopyBtn0 = Boolean(copyBtn0);

        // Copying while collapsed copies full unclamped m.text without expanding
        window.__CLIPBOARD_WRITES__ = [];
        copyBtn0?.click();
        await new Promise((r) => setTimeout(r, 40));
        const copiedFullWhileCollapsed =
          (window.__CLIPBOARD_WRITES__ || [])[0] === longMultilinePrompt &&
          body0.getAttribute('data-collapsed') === 'true';

        // Light vs Dark computed styles on fade & expand toggle
        const lightAfterBg = window.getComputedStyle(body0, '::after').backgroundImage;
        const lightToggleColor = window.getComputedStyle(toggle0).color;
        s.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 60));
        const darkAfterBg = window.getComputedStyle(body0, '::after').backgroundImage;
        const darkToggleColor = window.getComputedStyle(toggle0).color;
        const darkToggleUnclipped = toggle0.scrollHeight <= toggle0.clientHeight + 2;
        s.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 50));

        // Guard 1: clicking inline <code> (:not(pre) > code) inside collapsed body does NOT expand
        const inlineCode = body0.querySelector(':not(pre) > code');
        inlineCode?.click();
        await new Promise((r) => setTimeout(r, 30));
        const stayedCollapsedAfterCodeClick = body0.getAttribute('data-collapsed') === 'true';

        // Guard 2: non-empty text selection suppresses click-to-expand
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(body0.querySelector('p') || body0);
        sel.removeAllRanges();
        sel.addRange(range);
        body0.click();
        await new Promise((r) => setTimeout(r, 30));
        const stayedCollapsedWithSelection = body0.getAttribute('data-collapsed') === 'true';
        sel.removeAllRanges();

        // Clicking inside fenced <pre><code> SQL paste expands
        const fencedSqlCode = body0.querySelector('pre > code');
        fencedSqlCode?.click();
        await new Promise((r) => setTimeout(r, 50));
        const expandedAfterBodyClick = body0.getAttribute('data-collapsed') === 'false' && !body0.classList.contains('dab-msg-body-collapsed');
        const expandedHeight = Math.round(body0.getBoundingClientRect().height);
        const toggleExpandedLabel = (toggle0.textContent || '').trim();
        const toggleExpandedAria = toggle0.getAttribute('aria-expanded');

        // Clicking Show less collapses back, clipped scroll (Tab/scrollIntoView into clipped link) auto-expands, Show less + Show more toggle cleanly
        toggle0.click();
        await new Promise((r) => setTimeout(r, 40));
        const collapsedAfterShowLess = body0.getAttribute('data-collapsed') === 'true' && toggle0.getAttribute('aria-expanded') === 'false';
        body0.querySelector('a')?.scrollIntoView();
        await new Promise((r) => setTimeout(r, 50));
        const expandedOnClippedScroll = body0.getAttribute('data-collapsed') === 'false' && body0.scrollTop === 0;
        toggle0.click();
        await new Promise((r) => setTimeout(r, 40));
        toggle0.click();
        await new Promise((r) => setTimeout(r, 40));
        const reExpandedAfterShowMore = body0.getAttribute('data-collapsed') === 'false' && toggle0.getAttribute('aria-expanded') === 'true';

        // Switching activeConversationId resets expansion state
        s.setActiveConversationId('conv_reset_185');
        await new Promise((r) => setTimeout(r, 50));
        const resetOnConvChange = body0.getAttribute('data-collapsed') === 'true';

        // Slash skills menu: non-wrapping /<skill-id> + description, zero redundant sk.label
        const ta = document.querySelector('[data-testid="studio-prompt-input"]');
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        ta.focus();
        nativeSetter.call(ta, '/');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const slashMenu = document.querySelector('[data-testid="composer-slash-skill-menu"]');
        const slashOpts = Array.from(slashMenu?.querySelectorAll('[data-testid^="composer-slash-skill-option-"]') || []);
        const allCodesSingleLine = slashOpts.length >= 10 && slashOpts.every((opt) => {
          const c = opt.querySelector('code');
          return c && window.getComputedStyle(c).whiteSpace === 'nowrap' && c.getClientRects().length === 1;
        });
        const slashText = slashMenu?.textContent || '';
        const removedLabels = ['Project Onboarding', 'Descriptions & Curation', 'Data Tests (.test.lkml)', 'Field Value Profiler', 'Lit Data Apps'];
        const hasAnyRedundantLabel = removedLabels.some((lbl) => slashText.includes(lbl));
        const onboardingOpt = document.querySelector('[data-testid="composer-slash-skill-option-looker-project-onboarding"]');
        const onboardingTitle = onboardingOpt?.getAttribute('title') || '';
        const hasExpectedDescAndTitle =
          slashText.includes('Onboard a new LookML project') &&
          onboardingTitle.startsWith('Onboard a new LookML project') &&
          onboardingTitle.endsWith('(skills/looker-project-onboarding/SKILL.md)') &&
          !onboardingTitle.includes('—');

        // Also check DOC_UI_COMPONENTS.LookmlTurnSkills inside UseCaseInfoModal
        document.querySelector('.dab-composer-actions [data-testid="use-case-info-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        document.querySelector('[data-testid="use-case-guide-tab-lookml"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const docPreview = document.querySelector('[data-testid="doc-slash-skill-menu-preview"]');
        const docPreviewText = docPreview?.textContent || '';
        const docCodesSingleLine = Boolean(docPreview) && Array.from(docPreview.querySelectorAll('code')).every((c) => c.getClientRects().length === 1);
        const docHasDescWithoutLabel =
          docPreviewText.includes('Onboard a new LookML project') &&
          !removedLabels.some((lbl) => docPreviewText.includes(lbl));

        return {
          initialCollapsedAttr,
          hasCollapsedClass,
          clampedHeightBounded: collapsedHeight > 40 && collapsedHeight <= 130 && bodyScrollHeight > collapsedHeight + 40,
          shortHasCollapsedAttr,
          shortHasToggle,
          longCharsCollapsed,
          toggleInitialLabel,
          toggleInitialAria,
          toggleAriaControls,
          toggleTypography,
          toggleUnclipped,
          hasCopyBtn0,
          copiedFullWhileCollapsed,
          themeStylesAdapt: Boolean(lightAfterBg && darkAfterBg && lightAfterBg !== darkAfterBg && lightToggleColor !== darkToggleColor),
          darkToggleUnclipped,
          stayedCollapsedAfterCodeClick,
          stayedCollapsedWithSelection,
          expandedAfterBodyClick,
          grewOnExpand: expandedHeight > collapsedHeight + 40,
          toggleExpandedLabel,
          toggleExpandedAria,
          collapsedAfterShowLess,
          expandedOnClippedScroll,
          reExpandedAfterShowMore,
          resetOnConvChange,
          allCodesSingleLine,
          hasAnyRedundantLabel,
          hasExpectedDescAndTitle,
          docCodesSingleLine,
          docHasDescWithoutLabel,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res185.exceptionDetails) throw new Error(JSON.stringify(res185.exceptionDetails))

    expect(res185.result.value).toEqual({
      initialCollapsedAttr: 'true',
      hasCollapsedClass: true,
      clampedHeightBounded: true,
      shortHasCollapsedAttr: false,
      shortHasToggle: false,
      longCharsCollapsed: true,
      toggleInitialLabel: 'Show more',
      toggleInitialAria: 'false',
      toggleAriaControls: true,
      toggleTypography: { fontSize: '11.5px', fontWeight: '600' },
      toggleUnclipped: true,
      hasCopyBtn0: true,
      copiedFullWhileCollapsed: true,
      themeStylesAdapt: true,
      darkToggleUnclipped: true,
      stayedCollapsedAfterCodeClick: true,
      stayedCollapsedWithSelection: true,
      expandedAfterBodyClick: true,
      grewOnExpand: true,
      toggleExpandedLabel: 'Show less',
      toggleExpandedAria: 'true',
      collapsedAfterShowLess: true,
      expandedOnClippedScroll: true,
      reExpandedAfterShowMore: true,
      resetOnConvChange: true,
      allCodesSingleLine: true,
      hasAnyRedundantLabel: false,
      hasExpectedDescAndTitle: true,
      docCodesSingleLine: true,
      docHasDescWithoutLabel: true,
    })
  }, 25000)

}

module.exports = { registerVisualPart10Tests }
