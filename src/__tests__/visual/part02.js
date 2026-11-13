function registerVisualPart02Tests(ctx) {
  const { existsSync, mkdirSync, writeFileSync, path, startHeadlessChrome } = ctx
  test('defaults use-case selector to Auto on new conversation, gates options by permissions with 🔒 indicator, routes Turn 1 via AGENTS.md, locks to read-only badge, and resets to Auto on New Conversation', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${ctx.port}/?scenario=chatbar_error_banner`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="new-conversation-btn"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
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
    const url = `http://127.0.0.1:${ctx.port}/?scenario=chatbar_error_banner`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="new-conversation-btn"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
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
      await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=${scenario}` })
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const r = await ctx.chrome.send('Runtime.evaluate', {
          expression: `window.location.search.includes('${scenario}') && Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="topbar-fullscreen-toggle"]'))`,
          returnByValue: true
        })
        if (r.result?.value) break
        await new Promise((res) => setTimeout(res, 80))
      }
    }

    await waitForToggle('config_page')
    const standardRes = await ctx.chrome.send('Runtime.evaluate', {
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

    const { data } = await ctx.chrome.send('Page.captureScreenshot', { format: 'png', clip: standardRes.result.value.clip })
    const scratchDir = '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchSnap = path.join(scratchDir, 'issue-48-fullscreen-toggle.png')
    writeFileSync(scratchSnap, Buffer.from(data, 'base64'))
    expect(existsSync(scratchSnap)).toBe(true)

    await waitForToggle('spartan_fullscreen')
    const spartanRes = await ctx.chrome.send('Runtime.evaluate', {
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
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const waitForRenderedCount = async (minCount) => {
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const r = await ctx.chrome.send('Runtime.evaluate', {
          expression: `Boolean(window.__RENDERED_CALLS__ && window.__RENDERED_CALLS__.length >= ${minCount})`,
          returnByValue: true
        })
        if (r.result?.value) break
        await new Promise((res) => setTimeout(res, 50))
      }
    }

    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=tile_mount_view` })
    await waitForRenderedCount(1)

    const boundRes = await ctx.chrome.send('Runtime.evaluate', {
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

    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=tile_mount_unbound` })
    await waitForRenderedCount(1)

    const unboundRes = await ctx.chrome.send('Runtime.evaluate', {
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
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && window.__LOOKER_EMBED_STATE__ && document.querySelector('[data-testid="looker-embed-container"] iframe') && document.querySelector('[data-testid="conversation-item-conv_app_42"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
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

        // 2. Click Reload Viewer on same Dashboard #42 -> /preload bounce + loadDashboard('42')
        const reloadBtn = document.querySelector('[data-testid="preview-reload-viewer-btn"]');
        const callsBeforeReload = (window.__LOOKER_EMBED_STATE__?.calls || []).length;
        if (reloadBtn) reloadBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        const reloadCalls = (window.__LOOKER_EMBED_STATE__?.calls || []).slice(callsBeforeReload);
        const afterWarmRun = {
          hasDashboardRunCall:
            reloadCalls.some((c) => c.method === 'loadUrl' && c.arg === '/preload') &&
            reloadCalls.some((c) => c.method === 'loadDashboard' && c.arg === '42'),
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

}

module.exports = { registerVisualPart02Tests }
