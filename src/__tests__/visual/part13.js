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

  test('Issue #233: renders 24x24 Option A RipperLogo & click-to-home button across Light/Dark themes and 390px mobile without nested buttons, horizontal jump, or topbar overflow', async () => {
    const waitReady = async (expression) => {
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const r = await ctx.chrome.send('Runtime.evaluate', { expression, returnByValue: true })
        if (r.result?.value) return
        await new Promise((res) => setTimeout(res, 60))
      }
    }
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt` })
    await waitReady(`Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="studio-brand-home-btn"]') && document.querySelector('[data-testid="conversation-item-conv_app_42"]'))`)

    const desktopRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const homeBtn = document.querySelector('[data-testid="studio-brand-home-btn"]');
        const logo = document.querySelector('[data-testid="studio-brand-logo"]');
        const topbar = document.querySelector('.dab-topbar');
        const logoRect = logo.getBoundingClientRect();
        const lightColor = getComputedStyle(homeBtn).color;
        const hasNestedButtons = Boolean(document.querySelector('.dab-topbar button button'));
        const desktopNoOverflow = topbar.scrollWidth <= topbar.clientWidth + 1;
        homeBtn.focus();
        const editVisibleOnFocusWithin = getComputedStyle(document.querySelector('[data-testid="studio-edit-agent-name-btn"]')).visibility === 'visible';

        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 60));
        const darkColor = getComputedStyle(homeBtn).color;
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 50));

        // Open active conversation /c/conv_app_42 and seed sticky LookML skill to verify reset
        document.querySelector('[data-testid="conversation-item-conv_app_42"]').click();
        const convDeadline = Date.now() + 5000;
        while (Date.now() < convDeadline) {
          if (window.__DAB_STUDIO__.location.pathname === '/c/conv_app_42' && !window.__DAB_STUDIO__.isEmptyConversation) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        const pathInConv = window.__DAB_STUDIO__.location.pathname;
        window.__DAB_STUDIO__.setActivatedLookmlSkills?.(['lookml-tests']);
        await new Promise((r) => setTimeout(r, 30));

        // Verify edit pencil enters rename without navigating, keeps 24x24 logo at 0px jump, and Escape restores focus
        const idleLeft = document.querySelector('[data-testid="studio-brand-logo"]').getBoundingClientRect().left;
        document.querySelector('[data-testid="studio-edit-agent-name-btn"]').click();
        await new Promise((r) => setTimeout(r, 50));
        const pathDuringEdit = window.__DAB_STUDIO__.location.pathname;
        const editLogoRect = document.querySelector('[data-testid="studio-brand-logo"]').getBoundingClientRect();
        const logoHorizontalJumpPx = Math.abs(editLogoRect.left - idleLeft);
        const inputEl = document.querySelector('[data-testid="studio-agent-name-input"]');
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        const focusRestoredToHomeBtn = document.activeElement?.getAttribute('data-testid') === 'studio-brand-home-btn';

        // Click brand home button -> navigates cleanly from /c/conv_app_42 to '/' (New Conversation) & clears sticky skills
        document.querySelector('[data-testid="studio-brand-home-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));
        const pathAfterHomeClick = window.__DAB_STUDIO__.location.pathname;
        const emptyAfterHomeClick =
          window.__DAB_STUDIO__.isEmptyConversation === true &&
          window.__DAB_STUDIO__.messages.length === 0 &&
          (window.__DAB_STUDIO__.activatedLookmlSkills || []).length === 0;

        return {
          logoWidth: Math.round(logoRect.width),
          logoHeight: Math.round(logoRect.height),
          viewBox: logo.getAttribute('viewBox'),
          ariaHidden: logo.getAttribute('aria-hidden'),
          hasNestedButtons,
          desktopNoOverflow,
          editVisibleOnFocusWithin,
          themeColorsAdapted: lightColor !== darkColor,
          pathInConv,
          pathDuringEdit,
          editLogoWidth: Math.round(editLogoRect.width),
          zeroHorizontalJump: logoHorizontalJumpPx <= 0.5,
          focusRestoredToHomeBtn,
          pathAfterHomeClick,
          emptyAfterHomeClick,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (desktopRes.exceptionDetails) {
      throw new Error(desktopRes.exceptionDetails.exception?.description || desktopRes.exceptionDetails.text)
    }
    expect(desktopRes.result.value).toEqual({
      logoWidth: 24,
      logoHeight: 24,
      viewBox: '6 8 84 80',
      ariaHidden: 'true',
      hasNestedButtons: false,
      desktopNoOverflow: true,
      editVisibleOnFocusWithin: true,
      themeColorsAdapted: true,
      pathInConv: '/c/conv_app_42',
      pathDuringEdit: '/c/conv_app_42',
      editLogoWidth: 24,
      zeroHorizontalJump: true,
      focusRestoredToHomeBtn: true,
      pathAfterHomeClick: '/',
      emptyAfterHomeClick: true,
    })

    // Configured /config -> clicking studio-brand-home-btn navigates to '/'; unconfigured /config (even with app disabled) stays gated on '/config'
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=config_page` })
    await waitReady(`Boolean(window.__DAB_STUDIO__?.location?.pathname === '/config' && document.querySelector('[data-testid="studio-brand-home-btn"]'))`)
    const cfgHomeRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        document.querySelector('[data-testid="studio-brand-home-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));
        return { pathAfterConfigHome: window.__DAB_STUDIO__.location.pathname, isEmptyConversation: window.__DAB_STUDIO__.isEmptyConversation };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    expect(cfgHomeRes.result.value).toEqual({ pathAfterConfigHome: '/', isEmptyConversation: true })

    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=config_page&unconfigured=1` })
    await waitReady(`Boolean(window.__DAB_STUDIO__?.location?.pathname === '/config' && document.querySelector('[data-testid="studio-brand-home-btn"]'))`)
    const uncfgHomeRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DAB_STUDIO__.setDisabledModes?.(['app']);
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="studio-brand-home-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));
        return window.__DAB_STUDIO__.location.pathname;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    expect(uncfgHomeRes.result.value).toBe('/config')

    // Mobile 390x844: 40-char truncation + inline rename non-overlapping bounding rects + click-to-home
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })
    await waitReady(`Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="studio-brand-home-btn"]'))`)
    const mobRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        await window.__DAB_STUDIO__.handleSaveAgentName('Maverick Enterprise Analytics Workspace!');
        await new Promise((r) => setTimeout(r, 60));
        const topbar = document.querySelector('.dab-topbar');
        const logo = document.querySelector('[data-testid="studio-brand-logo"]');
        const strong = document.querySelector('[data-testid="studio-agent-name-label"]');
        const editBtn = document.querySelector('[data-testid="studio-edit-agent-name-btn"]');
        const editBtnHidden = getComputedStyle(editBtn).display === 'none';
        const st = getComputedStyle(strong);
        const topbarRect = topbar.getBoundingClientRect();
        const logoRect = logo.getBoundingClientRect();
        const noViewportOverflow = document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
        const singleRowTopbar = topbarRect.height <= 46;
        const truncatedCleanly = st.overflow === 'hidden' && st.textOverflow === 'ellipsis' && st.whiteSpace === 'nowrap' && strong.scrollWidth > strong.clientWidth;

        // Enter mobile inline rename mode and verify 0px logo jump & zero overlap with right-side controls
        window.__DAB_STUDIO__.setEditingAgentName(true);
        await new Promise((r) => setTimeout(r, 60));
        const editLogoLeft = document.querySelector('[data-testid="studio-brand-logo"]').getBoundingClientRect().left;
        const editorRight = document.querySelector('.dab-agent-name-editor').getBoundingClientRect().right;
        const controlsLeft = document.querySelector('.dab-controls').getBoundingClientRect().left;
        const mobileEditNoOverlap = Math.abs(editLogoLeft - logoRect.left) <= 0.5 && editorRight <= controlsLeft + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
        window.__DAB_STUDIO__.setEditingAgentName(false);
        await new Promise((r) => setTimeout(r, 50));

        document.querySelector('[data-testid="studio-brand-home-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));
        return {
          logoWidth: Math.round(logoRect.width),
          logoHeight: Math.round(logoRect.height),
          editBtnHidden,
          noViewportOverflow,
          singleRowTopbar,
          truncatedCleanly,
          mobileEditNoOverlap,
          mobileHomeNavigated: window.__DAB_STUDIO__.location.pathname === '/' && window.__DAB_STUDIO__.isEmptyConversation === true,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    if (mobRes.exceptionDetails) {
      throw new Error(mobRes.exceptionDetails.exception?.description || mobRes.exceptionDetails.text)
    }
    expect(mobRes.result.value).toEqual({
      logoWidth: 24,
      logoHeight: 24,
      editBtnHidden: true,
      noViewportOverflow: true,
      singleRowTopbar: true,
      truncatedCleanly: true,
      mobileEditNoOverlap: true,
      mobileHomeNavigated: true,
    })
  }, 25000)
}

module.exports = { registerVisualPart13Tests }
