function registerVisualPart13Tests(ctx) {
  test('Issue #224: supports concurrent multi-chat execution, enabled + New Conversation, conv-running-indicator, and background Safe Mode approval without hijacking foreground chat', async () => {
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=dashboard` })
    const readyDeadline = Date.now() + 8000
    while (Date.now() < readyDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="new-conversation-btn"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const res224 = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DAB_STUDIO__.setAuthMode('apikey');
        window.__DAB_STUDIO__.setApiKey('mock-api-key');
        await new Promise((r) => setTimeout(r, 80));

        const sdk = window.__DAB_STUDIO__.core40SDK;
        const origRawReq = sdk.authSession.transport.rawRequest;
        const origDashboard = sdk.dashboard ? sdk.dashboard.bind(sdk) : null;
        sdk.dashboard = async (id) => {
          if (String(id) === '224') {
            return {
              id: '224',
              title: 'Alpha App',
              folder_id: '1',
              dashboard_elements: [{ id: '601', type: 'extension', extension_id: 'db::ext-224', rich_content_json: '{}' }],
              dashboard_layouts: [{ id: '301', active: true, dashboard_layout_components: [] }],
            };
          }
          return origDashboard ? origDashboard(id) : { id: String(id) };
        };
        sdk.authSession.transport.rawRequest = async (method, reqPath, queryParams, body) => {
          const m = String(method || 'GET').toUpperCase();
          if (reqPath.includes('/data_app_extension')) {
            return { ok: true, statusCode: 200, body: JSON.stringify({ id: 'db::ext-224' }) };
          }
          if (reqPath.includes('/inline_extension/')) {
            return { ok: true, statusCode: 200, body: 'export class AlphaApp extends DataApp {}' };
          }
          if (m === 'POST' && reqPath === '/dashboards') {
            return { ok: true, statusCode: 200, body: JSON.stringify({ id: '224' }) };
          }
          if (m === 'POST' && reqPath === '/dashboard_elements') {
            return { ok: true, statusCode: 200, body: JSON.stringify({ id: '601' }) };
          }
          if (m === 'PATCH' && reqPath.startsWith('/dashboard_layouts/')) {
            return { ok: true, statusCode: 200, body: JSON.stringify({ id: '301' }) };
          }
          return origRawReq(method, reqPath, queryParams, body);
        };

        let releaseConvAResponse = null;
        const convAResponseGate = new Promise((resolve) => {
          releaseConvAResponse = resolve;
        });

        const ext = window.__DAB_STUDIO__.extensionSDK;
        const origProxy = ext.serverProxy.bind(ext);
        ext.serverProxy = async (url, init) => {
          const u = String(url || '');
          const method = String((init && init.method) || 'GET').toUpperCase();
          if (u.includes(':stream') || u.includes('alt=sse')) {
            return { ok: false, status: 404, body: 'not found' };
          }
          if (u.includes('/interactions/int_224_alpha') && method === 'GET') {
            await convAResponseGate;
            const appBundle = JSON.stringify({
              title: 'Alpha App',
              raw_code: 'export class AlphaApp extends DataApp {}',
              prod_code: 'export class AlphaApp extends DataApp {}',
              widgets: [],
            });
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_224_alpha',
                environment_id: 'env_224',
                status: 'completed',
                output_text: '<USE_CASE>app</USE_CASE>\\nBuilt Alpha App.\\n<DATA_APP_BUNDLE>' + appBundle + '</DATA_APP_BUNDLE>',
              }),
            };
          }
          const body = init && init.body ? JSON.parse(init.body) : {};
          const inputText = (body.input && body.input[0] && body.input[0].text) || '';
          if (inputText.includes('[CONVERSATION_LABEL_REQUEST]')) {
            const lbl = inputText.includes('Alpha') ? 'Alpha App' : 'Beta Chat';
            return { ok: true, status: 200, body: JSON.stringify({ id: 'int_lbl_224', status: 'completed', output_text: lbl }) };
          }
          if (u.includes('/interactions') && method === 'POST') {
            if (inputText.includes('Build Alpha App')) {
              return {
                ok: true,
                status: 200,
                body: JSON.stringify({
                  id: 'int_224_alpha',
                  environment_id: 'env_224',
                  status: 'in_progress',
                }),
              };
            }
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_224_beta',
                environment_id: 'env_224',
                status: 'completed',
                output_text: '<USE_CASE>tile</USE_CASE>\\nBeta revenue is $1.2M.',
              }),
            };
          }
          return origProxy(url, init);
        };

        // 1. Start new blank conversation A and launch a turn
        document.querySelector('[data-testid="new-conversation-btn"]').click();
        await new Promise((r) => setTimeout(r, 60));
        const convAPromise = window.__DAB_STUDIO__.handleSendPrompt({ text: 'Build Alpha App' });
        await new Promise((r) => setTimeout(r, 120));

        const convAId = window.__DAB_STUDIO__.activeConversationId;
        const newBtnEnabledWhileBusy = !document.querySelector('[data-testid="new-conversation-btn"]').disabled;
        const convARunningBeforeSwitch = Boolean(document.querySelector('[data-testid="conv-running-indicator-' + convAId + '"]'));

        // 2. Click + New Conversation while Conv A is mid-turn
        document.querySelector('[data-testid="new-conversation-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));

        const convBUsableImmediately =
          window.__DAB_STUDIO__.busyStatus === null &&
          window.__DAB_STUDIO__.messages.length === 0 &&
          window.__DAB_STUDIO__.activeConversationId !== convAId;
        const convAStillSpinningInSidebar = Boolean(document.querySelector('[data-testid="conv-running-indicator-' + convAId + '"]'));

        // 3. Send a concurrent prompt in Conv B while Conv A is still running in the background
        await window.__DAB_STUDIO__.handleSendPrompt({ text: 'Summarize Beta revenue' });
        await new Promise((r) => setTimeout(r, 80));
        const convBId = window.__DAB_STUDIO__.activeConversationId;
        const convBMessagesAfterTurn = window.__DAB_STUDIO__.messages.map((m) => m.role + ':' + m.text);
        const convAStillSpinningAfterConvBTurn = Boolean(document.querySelector('[data-testid="conv-running-indicator-' + convAId + '"]'));

        // 4. Release Conv A response so it hits Safe Mode create_dashboard in the background
        releaseConvAResponse();
        const badgeDeadline = Date.now() + 3000;
        while (Date.now() < badgeDeadline && !document.querySelector('[data-testid="background-perm-allow-btn"]')) {
          await new Promise((r) => setTimeout(r, 40));
        }

        const fgPendingPermNull = window.__DAB_STUDIO__.pendingPerm === null;
        const bgPermBadgeVisible = Boolean(document.querySelector('[data-testid="conv-perm-badge-' + convAId + '"]'));
        const bgPermBannerVisible = Boolean(document.querySelector('[data-testid="background-perm-notice"]'));

        // 5. Approve Conv A's Safe Mode mutation directly from the background banner without leaving Conv B
        document.querySelector('[data-testid="background-perm-allow-btn"]').click();
        await convAPromise;
        await new Promise((r) => setTimeout(r, 100));

        const stayedInConvB = window.__DAB_STUDIO__.activeConversationId === convBId;
        const convBNotHijacked =
          window.__DAB_STUDIO__.publishedApp === null &&
          window.__DAB_STUDIO__.messages.length === 2 &&
          !document.querySelector('[data-testid="conv-running-indicator-' + convAId + '"]') &&
          !document.querySelector('[data-testid="conv-perm-badge-' + convAId + '"]');

        // 6. Click Conv A in the sidebar and verify its completed message + published Data App tab hydrate cleanly
        document.querySelector('[data-testid="conversation-item-' + convAId + '"]').click();
        await new Promise((r) => setTimeout(r, 120));

        const convAMsgs = window.__DAB_STUDIO__.messages;
        const convACompletedCleanly =
          window.__DAB_STUDIO__.activeConversationId === convAId &&
          convAMsgs.length === 2 &&
          String(convAMsgs[1]?.text || '').includes('Built Alpha App.') &&
          window.__DAB_STUDIO__.contentItems.some((it) => it.key === 'data_app:224');

        return {
          newBtnEnabledWhileBusy,
          convARunningBeforeSwitch,
          convBUsableImmediately,
          convAStillSpinningInSidebar,
          hasConvBReply: convBMessagesAfterTurn.length === 2 && convBMessagesAfterTurn[1].includes('Beta revenue is $1.2M.'),
          convAStillSpinningAfterConvBTurn,
          fgPendingPermNull,
          bgPermBadgeVisible,
          bgPermBannerVisible,
          stayedInConvB,
          convBNotHijacked,
          convACompletedCleanly,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    if (res224.exceptionDetails) {
      throw new Error(res224.exceptionDetails.exception?.description || res224.exceptionDetails.text)
    }
    expect(res224.result.value).toEqual({
      newBtnEnabledWhileBusy: true,
      convARunningBeforeSwitch: true,
      convBUsableImmediately: true,
      convAStillSpinningInSidebar: true,
      hasConvBReply: true,
      convAStillSpinningAfterConvBTurn: true,
      fgPendingPermNull: true,
      bgPermBadgeVisible: true,
      bgPermBannerVisible: true,
      stayedInConvB: true,
      convBNotHijacked: true,
      convACompletedCleanly: true,
    })
  }, 25000)

  test('Issue #228: renders inline PythonTile editor in Light & Dark themes, saves to IDashboardElement.rich_content_json with 0 artifact writes, previews with dashboard_filters, and round-trips Studio local draft scripts when !isConfigured', async () => {
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 840,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=tile_mount_edit` })
    const tileReadyDeadline = Date.now() + 8000
    while (Date.now() < tileReadyDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="tile-script-title-input"]')?.value && document.querySelector('[data-testid="tile-script-code-input"]')?.value)`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const tileEditRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const setReactValue = (el, val) => {
          const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };

        const card = document.querySelector('[data-testid="tile-edit-mode"]');
        const titleInput = document.querySelector('[data-testid="tile-script-title-input"]');
        const codeInput = document.querySelector('[data-testid="tile-script-code-input"]');
        const saveBtn = document.querySelector('[data-testid="tile-script-save-btn"]');
        const legacySelect = document.querySelector('[data-testid="tile-edit-script-select"]');
        const noOverflow = document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;

        const lightCardBg = getComputedStyle(card).backgroundColor;
        const lightInputBg = getComputedStyle(titleInput).backgroundColor;
        const lightCodeColor = getComputedStyle(codeInput).color;

        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 60));
        const darkRootTheme = document.documentElement.getAttribute('data-theme');
        const darkCardBg = getComputedStyle(card).backgroundColor;
        const darkInputBg = getComputedStyle(titleInput).backgroundColor;
        const darkCodeColor = getComputedStyle(codeInput).color;

        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));

        window.__ARTIFACT_UPDATES__ = [];
        window.__ELEMENT_UPDATES__ = [];
        setReactValue(titleInput, 'Inline Rich Content Revenue Audit');
        setReactValue(
          codeInput,
          'return [{"saved_mode": "rich_content_inline", "active_status": dashboard_filters.get("status", "Unknown")}]'
        );
        await new Promise((r) => setTimeout(r, 40));

        saveBtn.click();
        const saveDeadline = Date.now() + 5000;
        while (Date.now() < saveDeadline) {
          const preview = document.querySelector('[data-testid="tile-edit-live-preview"]');
          if (preview && preview.innerText.includes('rich_content_inline')) break;
          await new Promise((r) => setTimeout(r, 50));
        }

        const previewEl = document.querySelector('[data-testid="tile-edit-live-preview"]');
        const statusEl = document.querySelector('[data-testid="tile-script-status"]');
        const elUpdates = window.__ELEMENT_UPDATES__ || [];
        const savedRich = elUpdates[0] && elUpdates[0].body && elUpdates[0].body.rich_content_json
          ? JSON.parse(elUpdates[0].body.rich_content_json)
          : null;

        return {
          hasInputsAndSaveBtn: Boolean(titleInput && codeInput && saveBtn),
          legacySelectRemoved: legacySelect === null,
          noOverflow,
          darkRootTheme,
          themeContrastsChanged:
            lightCardBg !== darkCardBg &&
            lightInputBg !== darkInputBg &&
            lightCodeColor !== darkCodeColor,
          artifactWriteCount: (window.__ARTIFACT_UPDATES__ || []).length,
          elementUpdateCount: elUpdates.length,
          savedScriptTitle: savedRich?.python_tile_script?.title || null,
          statusMentionsRichContent: String(statusEl?.innerText || '').includes('rich_content_json'),
          previewShowsSavedOutputAndFilter:
            String(previewEl?.innerText || '').includes('rich_content_inline') &&
            String(previewEl?.innerText || '').includes('Complete'),
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    if (tileEditRes.exceptionDetails) {
      throw new Error(tileEditRes.exceptionDetails.exception?.description || tileEditRes.exceptionDetails.text)
    }
    expect(tileEditRes.result.value).toEqual({
      hasInputsAndSaveBtn: true,
      legacySelectRemoved: true,
      noOverflow: true,
      darkRootTheme: 'dark',
      themeContrastsChanged: true,
      artifactWriteCount: 0,
      elementUpdateCount: 1,
      savedScriptTitle: 'Inline Rich Content Revenue Audit',
      statusMentionsRichContent: true,
      previewShowsSavedOutputAndFilter: true,
    })

    // Verify Studio /tile local draft save & reload works when !isConfigured with 0 Looker Artifact writes
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=python_tile_studio&unconfigured=1` })
    const studioDeadline = Date.now() + 8000
    while (Date.now() < studioDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="tile-preview-toolbar"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const studioDraftRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const unconfigured = window.__DAB_STUDIO__.isConfigured === false;
        const stayedOutOfConfig = window.__DAB_STUDIO__.location.pathname !== '/config';
        window.__ARTIFACT_UPDATES__ = [];
        window.__DAB_STUDIO__.setScriptId('local_draft_228');
        window.__DAB_STUDIO__.setScriptTitle('Local Unconfigured Draft');
        await new Promise((r) => setTimeout(r, 40));

        const saved = await window.__DAB_STUDIO__.handleSaveScript('return [{"local_draft": 228}]');
        const scriptArtifactWrites = (window.__ARTIFACT_UPDATES__ || []).filter(
          (u) => String(u.key || '').includes('script') || String(u.key || '').includes('tile_element_')
        );
        const rawLocal = window.localStorage.getItem('dab_draft_python_scripts_v1') || '[]';
        const parsedLocal = JSON.parse(rawLocal);

        window.__DAB_STUDIO__.setScriptCode('return []');
        await new Promise((r) => setTimeout(r, 40));
        await window.__DAB_STUDIO__.loadScriptById('local_draft_228', true);
        await new Promise((r) => setTimeout(r, 80));

        return {
          unconfigured: unconfigured && stayedOutOfConfig,
          savedId: saved?.id || null,
          savedHasNoStaleDash: !saved?.dashboardId && !window.__DAB_STUDIO__.publishedTileDash,
          scriptArtifactWriteCount: scriptArtifactWrites.length,
          storedInDualStorage: parsedLocal.some((d) => d.id === 'local_draft_228' && d.code.includes('228')),
          reloadedCodeMatches: String(window.__DAB_STUDIO__.scriptCode || '').includes('228'),
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    if (studioDraftRes.exceptionDetails) {
      throw new Error(studioDraftRes.exceptionDetails.exception?.description || studioDraftRes.exceptionDetails.text)
    }
    expect(studioDraftRes.result.value).toEqual({
      unconfigured: true,
      savedId: 'local_draft_228',
      savedHasNoStaleDash: true,
      scriptArtifactWriteCount: 0,
      storedInDualStorage: true,
      reloadedCodeMatches: true,
    })
  }, 25000)
}

module.exports = { registerVisualPart13Tests }
