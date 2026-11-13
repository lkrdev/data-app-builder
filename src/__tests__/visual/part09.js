function registerVisualPart09Tests(ctx) {
  const { startHeadlessChrome } = ctx
  test('Issue #172: full-screen View app.js + icon Copy app.js, /preload bounce Reload Viewer, per-turn CRUD pills, 180ms-bridged clickable tab popovers + LookML Open in IDE, and ArrowUp/ArrowDown prompt history + hover/long-press user copy', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="preview-view-code-btn"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const res172 = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        window.__CLIPBOARD_WRITES__ = [];
        window.__OPENED_WINDOWS__ = [];

        // 1. Item 4: Full-screen View app.js (display:none on iframe without unmounting) & icon-only Copy app.js
        const iframeContainer = document.querySelector('.dab-iframe-container');
        const iframe0 = document.querySelector('[data-testid="looker-embed-container"] iframe');
        const viewBtn = document.querySelector('[data-testid="preview-view-code-btn"]');
        const viewBtnTextBefore = (viewBtn?.textContent || '').trim();
        const viewBtnHasCodeSvg = Boolean(viewBtn?.querySelector('svg.lucide'));
        const viewBtnNoBraces = !viewBtnTextBefore.includes('{ }');

        viewBtn?.click();
        await new Promise((r) => setTimeout(r, 60));
        const drawer = document.querySelector('[data-testid="preview-app-code-drawer"]');
        const rightPane = document.querySelector('.dab-right-pane');
        const drawerStyle = drawer ? window.getComputedStyle(drawer) : null;
        const iframeDisplayWhileCodeOpen = iframeContainer ? window.getComputedStyle(iframeContainer).display : '';
        const drawerFillsHeight = Boolean(drawer && rightPane && drawer.getBoundingClientRect().height >= rightPane.getBoundingClientRect().height - 100);
        const lightDrawerBg = drawerStyle ? drawerStyle.backgroundColor : '';

        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 40));
        const darkDrawerBg = drawer ? window.getComputedStyle(drawer).backgroundColor : '';
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));

        const copyCodeBtn = document.querySelector('[data-testid="preview-copy-code-btn"]');
        const copyCodeIconOnly = Boolean(copyCodeBtn && (copyCodeBtn.textContent || '').trim() === '' && copyCodeBtn.querySelector('svg.lucide'));
        const copyCodeTitleBefore = copyCodeBtn?.getAttribute('title') || '';
        copyCodeBtn?.click();
        await new Promise((r) => setTimeout(r, 40));
        const copyCodeTitleAfter = document.querySelector('[data-testid="preview-copy-code-btn"]')?.getAttribute('title') || '';
        const copiedAppCodeViaSdk = (window.__CLIPBOARD_WRITES__ || []).length > 0;

        // Toggling Hide app.js restores iframe display without remounting or reloading iframe0
        const loadsBeforeHide = window.__LOOKER_EMBED_STATE__?.loadCount || 0;
        document.querySelector('[data-testid="preview-view-code-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 50));
        const loadsAfterHide = window.__LOOKER_EMBED_STATE__?.loadCount || 0;
        const sameIframeAfterHide = document.querySelector('[data-testid="looker-embed-container"] iframe') === iframe0;
        const iframeRestoredAfterHide = iframeContainer ? window.getComputedStyle(iframeContainer).display !== 'none' : false;

        // 2. Item 5: Reload Viewer spins <RotateCw /> and bounces /preload -> loadDashboard('42')
        const callsIdx = (window.__LOOKER_EMBED_STATE__?.calls || []).length;
        const reloadBtn = document.querySelector('[data-testid="preview-reload-viewer-btn"]');
        reloadBtn?.click();
        await new Promise((r) => setTimeout(r, 120));
        const bounceCalls = (window.__LOOKER_EMBED_STATE__?.calls || []).slice(callsIdx);
        const bouncedThroughPreload =
          bounceCalls.length >= 2 &&
          bounceCalls[0].method === 'loadUrl' && bounceCalls[0].arg === '/preload' &&
          bounceCalls[1].method === 'loadDashboard' && bounceCalls[1].arg === '42';

        // 3. Item 8: Per-turn CRUD pills only on mutating turns (omitted on chat-only and error turns), superseded deleted pills disabled, and dark-mode active/deleted colors not overridden by green .dab-msg-pill
        window.__DAB_STUDIO__.setMessages([
          { role: 'user', text: 'First prompt @explore:thelook::order_items' },
          {
            role: 'assistant',
            text: 'Created app #42 and temp dashboard #77.',
            crudItems: [
              { key: 'data_app:42', id: '42', title: 'Executive Revenue App', contentType: 'data_app', embedPath: '/embed/dashboards/42', action: 'created' },
              { key: 'dashboard:77', id: '77', title: 'Temp Dashboard 77', contentType: 'dashboard', embedPath: '/embed/dashboards/77', action: 'created' },
            ],
          },
          { role: 'user', text: 'Delete temp dashboard #77' },
          {
            role: 'assistant',
            text: 'Deleted temp dashboard #77.',
            crudItems: [{ key: 'dashboard:77', id: '77', title: 'Temp Dashboard 77', contentType: 'dashboard', action: 'deleted' }],
          },
          { role: 'user', text: 'Second prompt\\nmultiline beta' },
          { role: 'assistant', text: 'Chat-only explanation turn with zero mutations.' },
          { role: 'error', text: 'Transient timeout' },
        ]);
        await new Promise((r) => setTimeout(r, 60));
        const allChipStrips = document.querySelectorAll('[data-testid="chat-object-viewer-chips"]');
        const assistantBubbles = document.querySelectorAll('.dab-msg-assistant');
        const supersededTurn1Chip77 = assistantBubbles[0]?.querySelector('[data-testid="chat-object-viewer-chip-dashboard:77"]');
        const deletedTurn2Chip77 = assistantBubbles[1]?.querySelector('[data-testid="chat-object-viewer-chip-dashboard:77"]');
        const activeTurn1Chip42 = assistantBubbles[0]?.querySelector('[data-testid="chat-object-viewer-chip-data_app:42"]');
        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 40));
        const darkActiveChipBg = activeTurn1Chip42 ? window.getComputedStyle(activeTurn1Chip42).backgroundColor : '';
        const darkDeletedChipBg = deletedTurn2Chip77 ? window.getComputedStyle(deletedTurn2Chip77).backgroundColor : '';
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));
        const crudOnlyOnFirstAssistant =
          allChipStrips.length === 2 &&
          Boolean(activeTurn1Chip42) &&
          Boolean(supersededTurn1Chip77?.disabled && deletedTurn2Chip77?.disabled) &&
          !darkActiveChipBg.includes('34, 197, 94') && !darkActiveChipBg.includes('16, 185, 129') &&
          !darkDeletedChipBg.includes('34, 197, 94') && !darkDeletedChipBg.includes('16, 185, 129') &&
          !assistantBubbles[2]?.querySelector('[data-testid="chat-object-viewer-chips"]');

        // 4. Item 9: 180ms neighbor hover debounce + popover onMouseEnter cancellation + dark #1e293b + LookML toolbar Open in IDE
        window.__DAB_STUDIO__.setLookmlBundle({ id: 'bryan_proj', title: 'LookML: bryan_proj', project_id: 'bryan_proj', files: [{ path: 'orders.view.lkml', action: 'created', content: 'view: orders {}' }] });
        await new Promise((r) => setTimeout(r, 40));
        window.__DAB_STUDIO__.upsertContentItem({ id: 'bryan_proj', projectId: 'bryan_proj', contentType: 'lookml', title: 'LookML: bryan_proj', embedPath: '/lookml/bryan_proj', hidden: false }, true);
        await new Promise((r) => setTimeout(r, 60));

        const tabA = document.querySelector('[data-testid="studio-content-tab-data_app:42"]')?.parentElement;
        const tabB = document.querySelector('[data-testid="studio-content-tab-lookml:bryan_proj"]')?.parentElement;
        const popA = document.querySelector('[data-testid="content-tab-popover-data_app:42"]');
        const popB = document.querySelector('[data-testid="content-tab-popover-lookml:bryan_proj"]');

        tabA?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        const popAOpenedImmediately = popA?.classList.contains('open') === true;

        // Brush neighbor tab B briefly (< 180ms) and enter popA -> popA stays open past 220ms!
        tabB?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));
        const popAStillOpenDuringBrush = popA?.classList.contains('open') === true && !popB?.classList.contains('open');
        popA?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 210));
        const popAStayedOpenOnEnter = popA?.classList.contains('open') === true && !popB?.classList.contains('open');

        // Sustained hover on tab B (>= 200ms) switches to popB; verify dark mode #1e293b (rgb(30, 41, 59))
        tabB?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 210));
        const popBSwitchedAfterDebounce = popB?.classList.contains('open') === true;
        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 40));
        const darkPopoverBg = popB ? window.getComputedStyle(popB).backgroundColor : '';
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));

        const lookmlToolbarIdeBtn = document.querySelector('[data-testid="lookml-toolbar-open-ide-btn"]');
        const lookmlToolbarBtnLabel = (lookmlToolbarIdeBtn?.textContent || '').trim();
        const lookmlToolbarUnclipped = Boolean(
          lookmlToolbarIdeBtn &&
          lookmlToolbarIdeBtn.scrollHeight <= lookmlToolbarIdeBtn.clientHeight + 2 &&
          lookmlToolbarIdeBtn.getBoundingClientRect().height >= 28
        );
        lookmlToolbarIdeBtn?.click();
        await new Promise((r) => setTimeout(r, 40));
        const openedIdeFromToolbar = (window.__OPENED_WINDOWS__ || []).slice(-1)[0]?.url || '';

        // 5. Item 10: Composer ArrowUp/ArrowDown prompt history (suppressing @-mention popup on recall) + desktop hover copy-user-msg-btn-0
        const ta = document.querySelector('[data-testid="studio-prompt-input"]');
        ta.focus();
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 30));
        const recalledNewest = ta.value; // 'Second prompt\\nmultiline beta' (caret at end = line 2)
        // Put caret on line 1 so second ArrowUp steps to 'Delete temp dashboard #77', third ArrowUp steps to 'First prompt @explore:thelook::order_items'
        ta.setSelectionRange(0, 0);
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 25));
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 30));
        const recalledOldest = ta.value; // 'First prompt @explore:thelook::order_items'
        const mentionSuppressedOnRecall = !document.querySelector('[data-testid="composer-at-mention-menu"]');
        // ArrowDown twice steps forward to newest, then ArrowDown on last line restores empty draft
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 25));
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 30));
        const steppedForward = ta.value;
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 30));
        const restoredEmptyDraft = ta.value;

        window.__CLIPBOARD_WRITES__ = [];
        const userCopyBtn0 = document.querySelector('[data-testid="copy-user-msg-btn-0"]');
        userCopyBtn0?.click();
        await new Promise((r) => setTimeout(r, 40));
        const copiedUserMsgDesktop = (window.__CLIPBOARD_WRITES__ || [])[0] || '';

        return {
          viewBtnTextBefore, viewBtnHasCodeSvg, viewBtnNoBraces,
          iframeDisplayWhileCodeOpen, drawerFillsHeight,
          drawerThemeDistinct: Boolean(lightDrawerBg && darkDrawerBg && lightDrawerBg !== darkDrawerBg),
          copyCodeIconOnly, copyCodeTitleBefore, copyCodeTitleAfter, copiedAppCodeViaSdk,
          noExtraLoadsOnHide: loadsAfterHide === loadsBeforeHide, sameIframeAfterHide, iframeRestoredAfterHide,
          bouncedThroughPreload, crudOnlyOnFirstAssistant,
          popAOpenedImmediately, popAStillOpenDuringBrush, popAStayedOpenOnEnter, popBSwitchedAfterDebounce,
          darkPopoverBg, lookmlToolbarBtnLabel, lookmlToolbarUnclipped, openedIdeFromToolbar,
          recalledNewest, recalledOldest, mentionSuppressedOnRecall, steppedForward, restoredEmptyDraft, copiedUserMsgDesktop,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res172.exceptionDetails) throw new Error(JSON.stringify(res172.exceptionDetails))

    expect(res172.result.value).toEqual({
      viewBtnTextBefore: 'View app.js', viewBtnHasCodeSvg: true, viewBtnNoBraces: true,
      iframeDisplayWhileCodeOpen: 'none', drawerFillsHeight: true,
      drawerThemeDistinct: true,
      copyCodeIconOnly: true, copyCodeTitleBefore: 'Copy app.js', copyCodeTitleAfter: 'Copied!', copiedAppCodeViaSdk: true,
      noExtraLoadsOnHide: true, sameIframeAfterHide: true, iframeRestoredAfterHide: true,
      bouncedThroughPreload: true, crudOnlyOnFirstAssistant: true,
      popAOpenedImmediately: true, popAStillOpenDuringBrush: true, popAStayedOpenOnEnter: true, popBSwitchedAfterDebounce: true,
      darkPopoverBg: 'rgb(30, 41, 59)', lookmlToolbarBtnLabel: 'Open in IDE', lookmlToolbarUnclipped: true, openedIdeFromToolbar: '/projects/bryan_proj/files/orders.view.lkml',
      recalledNewest: 'Second prompt\nmultiline beta', recalledOldest: 'First prompt @explore:thelook::order_items',
      mentionSuppressedOnRecall: true, steppedForward: 'Second prompt\nmultiline beta', restoredEmptyDraft: '',
      copiedUserMsgDesktop: 'First prompt @explore:thelook::order_items',
    })

    // Verify mobile touch long-press (450ms) & >10px touchmove cancellation
    try {
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      await ctx.chrome.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      const mobLongPress = await ctx.chrome.send('Runtime.evaluate', {
        expression: `(async () => {
          window.__CLIPBOARD_WRITES__ = [];
          const userMsg0 = document.querySelectorAll('.dab-msg-user')[0];
          const hoverCopyHiddenOnTouch = window.getComputedStyle(document.querySelector('[data-testid="copy-user-msg-btn-0"]')).display === 'none';

          // 1. Touch start + >10px move cancels long-press menu
          const mkTouch = (type, x, y) => {
            const ev = new Event(type, { bubbles: true, cancelable: true });
            ev.touches = [{ clientX: x, clientY: y }];
            return ev;
          };
          userMsg0.dispatchEvent(mkTouch('touchstart', 50, 50));
          await new Promise((r) => setTimeout(r, 80));
          userMsg0.dispatchEvent(mkTouch('touchmove', 50, 75));
          await new Promise((r) => setTimeout(r, 420));
          const cancelledOnScroll = !document.querySelector('[data-testid="user-msg-longpress-menu-0"]');

          // 2. Stationary 450ms touch opens long-press menu, survives compatibility mousedown, and copies message
          userMsg0.dispatchEvent(mkTouch('touchstart', 50, 50));
          await new Promise((r) => setTimeout(r, 480));
          userMsg0.dispatchEvent(mkTouch('touchend', 50, 50));
          userMsg0.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          const menuOpen = Boolean(document.querySelector('[data-testid="user-msg-longpress-menu-0"]'));
          document.querySelector('[data-testid="user-msg-longpress-copy-0"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          const copiedViaLongPress = (window.__CLIPBOARD_WRITES__ || [])[0] || '';

          return { hoverCopyHiddenOnTouch, cancelledOnScroll, menuOpen, copiedViaLongPress };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      })
      expect(mobLongPress.result.value).toEqual({
        hoverCopyHiddenOnTouch: true,
        cancelledOnScroll: true,
        menuOpen: true,
        copiedViaLongPress: 'First prompt @explore:thelook::order_items',
      })
    } finally {
      await ctx.chrome.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    }
  }, 25000)

  test('Issue #178: populates window.lkr_codemode_api_calls on session API calls, opens target Looker folder via folder-popover-open-target-btn in light/dark themes, and omits extensionSDK.saveContextData on /config', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()

    // 1. Verify /config subtitle omits SDK jargon
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=config_page` })
    const cfgDeadline = Date.now() + 8000
    while (Date.now() < cfgDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="config-auth-mode-select"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }
    const cfgCopyRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const txt = document.body.innerText || '';
        return {
          hasCleanSubtitle: txt.includes('Configure extension-wide authentication'),
          hasSdkJargon: txt.includes('extensionSDK.saveContextData'),
        };
      })()`,
      returnByValue: true,
    })
    expect(cfgCopyRes.result.value).toEqual({
      hasCleanSubtitle: true,
      hasSdkJargon: false,
    })

    // 2. Verify window.lkr_codemode_api_calls & folder-popover-open-target-btn in light & dark themes
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })
    const appDeadline = Date.now() + 8000
    while (Date.now() < appDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="topbar-folder-trigger"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const folderAndTelemetryRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__OPENED_WINDOWS__ = [];
        const calls = Array.isArray(window.lkr_codemode_api_calls) ? window.lkr_codemode_api_calls : null;
        const hasInitialApiCalls = Boolean(calls && calls.length > 0 && calls.every((c) => typeof c.method === 'string' && !c.route.includes('?') && typeof c.query_params === 'object' && c.response && typeof c.response.ok === 'boolean'));

        const trigger = document.querySelector('[data-testid="topbar-folder-trigger"]');
        trigger.click();
        await new Promise((r) => setTimeout(r, 80));

        const openBtn = document.querySelector('[data-testid="folder-popover-open-target-btn"]');
        const rect = openBtn.getBoundingClientRect();
        const lightStyle = window.getComputedStyle(openBtn);
        const lightBg = lightStyle.backgroundColor;
        const lightColor = lightStyle.color;
        const titleBefore = openBtn.getAttribute('title');
        const ariaBefore = openBtn.getAttribute('aria-label');
        const unclipped = openBtn.scrollHeight <= openBtn.clientHeight + 2;

        openBtn.click();
        await new Promise((r) => setTimeout(r, 40));
        const openedDefault = (window.__OPENED_WINDOWS__ || [])[0] || null;

        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 60));
        const darkStyle = window.getComputedStyle(openBtn);
        const darkBg = darkStyle.backgroundColor;
        const darkColor = darkStyle.color;

        window.__DAB_STUDIO__.setSelectedFolderId('folder/special 502');
        await new Promise((r) => setTimeout(r, 60));
        openBtn.click();
        await new Promise((r) => setTimeout(r, 40));
        const openedEncoded = (window.__OPENED_WINDOWS__ || [])[1] || null;

        return {
          hasInitialApiCalls,
          btnWidth: Math.round(rect.width),
          btnHeight: Math.round(rect.height),
          unclipped,
          titleBefore,
          ariaBefore,
          lightDarkDistinct: lightBg !== darkBg && lightColor !== darkColor,
          openedDefault,
          openedEncoded,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (folderAndTelemetryRes.exceptionDetails) {
      throw new Error(JSON.stringify(folderAndTelemetryRes.exceptionDetails))
    }
    expect(folderAndTelemetryRes.result.value).toEqual({
      hasInitialApiCalls: true,
      btnWidth: 22,
      btnHeight: 22,
      unclipped: true,
      titleBefore: 'Open My folder in Looker',
      ariaBefore: 'Open My folder in Looker',
      lightDarkDistinct: true,
      openedDefault: { url: '/folders/5', target: '_blank' },
      openedEncoded: { url: '/folders/folder%2Fspecial%20502', target: '_blank' },
    })
  }, 20000)

  test('Overview sidebar renders when no content is selected, supports Customize Sections and Overview tab switching, and opens as a mobile bottom sheet', async () => {
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
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="new-conversation-btn"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const desktopRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        window.lkr_codemode_api_calls = Array.from({ length: 100 }, (_, i) => ({
          method: i % 5 === 0 ? 'POST' : 'GET',
          route: i === 2 || i === 7 ? '/queries/run/json' : \`/lookml_models/thelook/explores/order_items_\${i % 8}\`,
          duration_ms: 25 + (i % 40),
          response: { ok: i !== 2 && i !== 7, status: i === 2 || i === 7 ? 422 : 200, body: {} }
        }));
        s.setRightPaneCollapsed(false);
        s.setContentItems([
          { key: 'dashboard:42', id: '42', contentType: 'dashboard', title: 'Executive KPIs', embedPath: '/embed/dashboards/42', hidden: false }
        ]);
        s.setMessages([
          { role: 'user', text: '/looker-dashboard Build Executive KPIs' },
          { role: 'assistant', text: 'Created [Executive KPIs](/dashboards/42) and saved \`/workspace/content_inventory.md\`.' }
        ]);
        await new Promise((r) => setTimeout(r, 80));

        // Click Overview pill in content tabs
        document.querySelector('[data-testid="studio-overview-tab"]')?.click();
        await new Promise((r) => setTimeout(r, 80));

        const rightPane = document.querySelector('.dab-right-pane');
        const ovSidebar = document.querySelector('[data-testid="studio-overview-sidebar"]');
        const ovCard = document.querySelector('.dab-ov-card');
        const rightWidth = Math.round(rightPane.getBoundingClientRect().width);
        const overflowX = ovCard.scrollWidth > ovCard.clientWidth + 1;
        const embedStillMounted = Boolean(document.querySelector('[data-testid="looker-embed-container"]'));
        const noDuplicateTopNavItems =
          !document.querySelector('[data-testid="overview-nav-api-calls"]') &&
          !document.querySelector('[data-testid="overview-nav-content"]') &&
          !document.querySelector('[data-testid="overview-nav-files"]');
        const apiSec = document.querySelector('[data-testid="overview-section-api-calls"]');
        const collapsedErrBadge = (apiSec?.querySelector('.dab-badge')?.textContent || '').trim();
        const apiCollapsedByDefault =
          Boolean(apiSec) &&
          apiSec.getAttribute('data-collapsed') === 'true' &&
          collapsedErrBadge === '2 err' &&
          !document.querySelector('[data-testid="overview-api-call-0"]');

        // Expand API Calls (100 calls) -> shows summary + 5 preview rows + See all (100) -> bounded 216px scroll container
        document.querySelector('[data-testid="overview-section-api-calls-toggle"]')?.click();
        await new Promise((r) => setTimeout(r, 50));
        const apiSummaryText = (document.querySelector('[data-testid="overview-api-summary"]')?.textContent || '').trim();
        const previewApiRows = document.querySelectorAll('[data-testid^="overview-api-call-"]').length;
        document.querySelector('[data-testid="overview-api-calls-toggle-all"]')?.click();
        await new Promise((r) => setTimeout(r, 50));
        const scrollWrap = document.querySelector('[data-testid="overview-api-scroll"]');
        const expanded100Bounded =
          Boolean(scrollWrap) &&
          document.querySelectorAll('[data-testid^="overview-api-call-"]').length === 100 &&
          window.getComputedStyle(scrollWrap).maxHeight === '216px' &&
          scrollWrap.scrollHeight > scrollWrap.clientHeight;

        // Toggle Customize Sections -> uncheck Links -> verify hidden -> recheck -> Escape closes menu
        document.querySelector('[data-testid="overview-customize-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const menuOpen = Boolean(document.querySelector('[data-testid="overview-customize-menu"]'));
        document.querySelector('[data-testid="overview-customize-item-links"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const hasLinksAfterHide = Boolean(document.querySelector('[data-testid="overview-section-links"]'));
        document.querySelector('[data-testid="overview-customize-item-links"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
        const menuClosedOnEscape = !document.querySelector('[data-testid="overview-customize-menu"]');

        // Click Skills Used -> opens viewer-document-pane -> close document -> returns to Overview with API Calls still expanded
        document.querySelector('[data-testid="overview-skill-item-looker-dashboard"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const skillDocOpened = Boolean(document.querySelector('[data-testid="viewer-document-pane"]'));
        document.querySelector('[data-testid="viewer-document-close-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 50));
        const apiStillExpandedAfterDocClose =
          document.querySelector('[data-testid="overview-section-api-calls"]')?.getAttribute('data-collapsed') === 'false';

        // Click Content row -> switches to dashboard:42 viewer, then click tab ribbon Overview pill back
        document.querySelector('[data-testid="overview-content-item-dashboard:42"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const switchedBackToViewer = rightPane.getAttribute('data-overview-mode') === 'false';

        return {
          hasOverviewSidebar: Boolean(ovSidebar),
          rightWidth,
          overflowX,
          embedStillMounted,
          noDuplicateTopNavItems,
          apiCollapsedByDefault,
          hasApiSummary: apiSummaryText.includes('80 GET') && apiSummaryText.includes('20 POST') && apiSummaryText.includes('2 failed'),
          previewApiRows,
          expanded100Bounded,
          menuOpen,
          hasLinksAfterHide,
          menuClosedOnEscape,
          skillDocOpened,
          apiStillExpandedAfterDocClose,
          switchedBackToViewer,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    expect(desktopRes.result.value).toEqual({
      hasOverviewSidebar: true,
      rightWidth: 296,
      overflowX: false,
      embedStillMounted: true,
      noDuplicateTopNavItems: true,
      apiCollapsedByDefault: true,
      hasApiSummary: true,
      previewApiRows: 5,
      expanded100Bounded: true,
      menuOpen: true,
      hasLinksAfterHide: false,
      menuClosedOnEscape: true,
      skillDocOpened: true,
      apiStillExpandedAfterDocClose: true,
      switchedBackToViewer: true,
    })

    // Mobile 390x844: hidden when chatting with no content, opens via + menu Overview button as bottom sheet
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    const mobileRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        s.setContentItems([]);
        s.setPublishedApp(null);
        s.setNativeContent(null);
        s.setActiveContentTabKey('');
        await new Promise((r) => setTimeout(r, 80));

        const rightPane = document.querySelector('.dab-right-pane');
        const hiddenByDefaultOnMobile = window.getComputedStyle(rightPane).display === 'none';

        document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 50));
        document.querySelector('[data-testid="mobile-menu-overview-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 80));

        const visibleAfterMenuOpen = window.getComputedStyle(rightPane).display === 'flex';
        const handleTitle = (document.querySelector('.dab-mobile-viewer-card-title')?.textContent || '').trim();
        document.querySelector('[data-testid="mobile-viewer-card-close"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const collapsedAfterClose = window.getComputedStyle(rightPane).display === 'none';

        return { hiddenByDefaultOnMobile, visibleAfterMenuOpen, handleTitle, collapsedAfterClose };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    expect(mobileRes.result.value).toEqual({
      hiddenByDefaultOnMobile: true,
      visibleAfterMenuOpen: true,
      handleTitle: 'Overview',
      collapsedAfterClose: true,
    })
  }, 20000)

}

module.exports = { registerVisualPart09Tests }
