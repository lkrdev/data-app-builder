function registerVisualPart14Tests(ctx) {
  test('Issue #230: renders sidebar relative timestamps & <= 4 tag pills in Light/Dark themes with 0 pre-select remote GETs, hydrates turnInteractionIds on cold select, and prunes expired sandbox conversations with dismissible banner', async () => {
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    // 1. Boot on '/' (centered_empty_prompt): verify 0 pre-select GET /interactions/* calls + sidebar tags & timestamps
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt`,
    })
    const readyDeadline = Date.now() + 8000
    while (Date.now() < readyDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="conversation-item-conv_app_42"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const sidebarIdleRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        await new Promise((r) => setTimeout(r, 120));
        const preSelectGetInteractions = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/')
        );
        const row = document.querySelector('[data-testid="conversation-item-conv_app_42"]');
        const updatedEl = document.querySelector('[data-testid="conv-item-updated-conv_app_42"]');
        const tagsEl = document.querySelector('[data-testid="conv-item-tags-conv_app_42"]');
        const pills = tagsEl ? Array.from(tagsEl.querySelectorAll('.dab-conv-tag-pill')) : [];
        const lightPillStyle = pills[0] ? getComputedStyle(pills[0]) : null;
        const lightUpdatedStyle = updatedEl ? getComputedStyle(updatedEl) : null;
        const hasHorizontalOverflow = row ? row.scrollWidth > row.clientWidth + 1 : false;

        // Cold-select conv_app_42 -> parallel GET /interactions/v1_app_42_r + v1_app_42
        row.click();
        const hydDeadline = Date.now() + 5000;
        while (Date.now() < hydDeadline) {
          const txt = document.body.innerText || '';
          if (txt.includes('Build an Executive Revenue Data App on order_items') && txt.includes('Built and published Executive Revenue App')) {
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }

        const getCallsAfterFirstSelect = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/v1_app_42')
        ).length;
        const bodyAfterSelect = document.body.innerText || '';

        // Switch to conv_dashboard_7 then back to conv_app_42 -> 0 extra GETs for v1_app_42*
        const dashRow = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        dashRow.click();
        await new Promise((r) => setTimeout(r, 150));
        document.querySelector('[data-testid="conversation-item-conv_app_42"]').click();
        await new Promise((r) => setTimeout(r, 150));

        const getCallsAfterReselect = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/v1_app_42')
        ).length;
        const artifactUpdateKeys = (window.__ARTIFACT_UPDATES__ || []).map((u) => u.key);

        return {
          preSelectGetCount: preSelectGetInteractions.length,
          updatedText: updatedEl ? updatedEl.textContent.trim() : null,
          pillTexts: pills.map((p) => p.textContent.trim()),
          pillCount: pills.length,
          lightPillBg: lightPillStyle ? lightPillStyle.backgroundColor : null,
          lightPillColor: lightPillStyle ? lightPillStyle.color : null,
          lightUpdatedColor: lightUpdatedStyle ? lightUpdatedStyle.color : null,
          hasHorizontalOverflow,
          getCallsAfterFirstSelect,
          getCallsAfterReselect,
          hasHydratedUserPrompt: bodyAfterSelect.includes('Build an Executive Revenue Data App on order_items'),
          hasRawControlTag: bodyAfterSelect.includes('<USER_MESSAGE>'),
          artifactUpdateKeys,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    const s1 = sidebarIdleRes.result.value
    expect(s1.preSelectGetCount).toBe(0)
    expect(s1.updatedText).toBe('Oct 30')
    expect(s1.pillCount).toBeGreaterThan(0)
    expect(s1.pillCount).toBeLessThanOrEqual(4)
    expect(s1.pillTexts).toEqual(['Data App', 'order_items'])
    expect(s1.hasHorizontalOverflow).toBe(false)
    expect(s1.hasHydratedUserPrompt).toBe(true)
    expect(s1.hasRawControlTag).toBe(false)
    expect(s1.getCallsAfterFirstSelect).toBe(2)
    expect(s1.getCallsAfterReselect).toBe(2)
    for (const k of s1.artifactUpdateKeys) {
      expect(k).toMatch(/^user_(env|config|conversations):/)
    }

    // 2. Verify Dark theme computed colors differ from Light theme on tag pills & timestamp
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=studio_dark_theme`,
    })
    const darkDeadline = Date.now() + 8000
    while (Date.now() < darkDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.documentElement.getAttribute('data-theme') === 'dark' && document.querySelector('[data-testid="conv-item-tags-conv_app_42"] .dab-conv-tag-pill'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }
    const darkStyleRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const pill = document.querySelector('[data-testid="conv-item-tags-conv_app_42"] .dab-conv-tag-pill');
        const updatedEl = document.querySelector('[data-testid="conv-item-updated-conv_app_42"]');
        return {
          darkPillBg: pill ? getComputedStyle(pill).backgroundColor : null,
          darkPillColor: pill ? getComputedStyle(pill).color : null,
          darkUpdatedColor: updatedEl ? getComputedStyle(updatedEl).color : null,
        };
      })()`,
      returnByValue: true,
    })
    const dark = darkStyleRes.result.value
    expect(dark.darkPillColor).not.toBe(s1.lightPillColor)
    expect(dark.darkUpdatedColor).not.toBe(s1.lightUpdatedColor)

    // 3. Boot on '/?scenario=expired_conv' (/c/conv_expired_old with dead env_old_expired): prunes pointer, renders banner, redirects to '/', and dismisses cleanly
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=expired_conv`,
    })
    const expDeadline = Date.now() + 8000
    while (Date.now() < expDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="expired-conversation-banner"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const expRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        await new Promise((r) => setTimeout(r, 120));
        const banner = document.querySelector('[data-testid="expired-conversation-banner"]');
        const bannerText = banner ? banner.textContent.trim() : '';
        const expiredRowStillInSidebar = Boolean(document.querySelector('[data-testid="conversation-item-conv_expired_old"]'));
        const activeRowsCount = document.querySelectorAll('[data-testid^="conversation-item-conv_"]').length;
        const dismissBtn = document.querySelector('[data-testid="dismiss-expired-conversation-banner"]');
        if (dismissBtn) dismissBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        const bannerAfterDismiss = Boolean(document.querySelector('[data-testid="expired-conversation-banner"]'));

        // Also test runtime 404 Environment not found when selecting a conversation whose interaction returns 404
        window.__MOCK_LOOKER_EXTENSION__.mockInteractions.v1_native_7_r = {
          __mockError: { ok: false, status: 404, body: JSON.stringify({ error: { message: 'Environment env_42 not found (404)' } }) }
        };
        const dashBtn = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        if (dashBtn) dashBtn.click();
        const r404Deadline = Date.now() + 5000;
        while (Date.now() < r404Deadline) {
          if (document.querySelector('[data-testid="expired-conversation-banner"]')) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        const bannerAfterRuntime404 = Boolean(document.querySelector('[data-testid="expired-conversation-banner"]'));
        const dashPrunedFromSidebar = !document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        const updates = (window.__ARTIFACT_UPDATES__ || []).map((u) => u.key);

        return {
          bannerText,
          expiredRowStillInSidebar,
          activeRowsCount,
          bannerAfterDismiss,
          bannerAfterRuntime404,
          dashPrunedFromSidebar,
          updates,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    const exp = expRes.result.value
    expect(exp.bannerText).toContain('expired')
    expect(exp.expiredRowStillInSidebar).toBe(false)
    expect(exp.activeRowsCount).toBe(5)
    expect(exp.bannerAfterDismiss).toBe(false)
    expect(exp.bannerAfterRuntime404).toBe(true)
    expect(exp.dashPrunedFromSidebar).toBe(true)
    for (const k of exp.updates) {
      expect(k).toMatch(/^user_(env|config|conversations):/)
    }
  }, 25000)

  test('verifies Data App bundles load in sandboxed srcdoc iframe before turn completion, catching render() TypeErrors, tab-switch ReferenceErrors, and blank 0px mounts', async () => {
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt`,
    })
    const readyDeadline = Date.now() + 8000
    while (Date.now() < readyDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__VERIFY_DATA_APP_BUNDLE__)`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const fixtures = {
      brokenRender: [
        'class BrokenApp extends HTMLElement {',
        '  connectedCallback() { this.innerHTML = this.renderFilterBar(); }',
        '}',
        'customElements.define("pf-broken-app", BrokenApp);',
      ].join('\n'),
      blankMount: [
        'class BlankApp extends HTMLElement {',
        '  connectedCallback() { this.innerHTML = ""; }',
        '}',
        'customElements.define("pf-blank-app", BlankApp);',
      ].join('\n'),
      brokenTab: [
        'class BrokenTabApp extends HTMLElement {',
        '  connectedCallback() {',
        '    this.style.display = "block";',
        '    const wrap = document.createElement("div");',
        '    wrap.style.minHeight = "120px";',
        '    const b1 = document.createElement("button"); b1.className = "da-tab-btn active"; b1.textContent = "Pulse";',
        '    const b2 = document.createElement("button"); b2.className = "da-tab-btn"; b2.textContent = "Forecast";',
        '    b2.addEventListener("click", () => { window.nonexistentForecastHelper(); });',
        '    wrap.append(b1, b2); this.appendChild(wrap);',
        '  }',
        '}',
        'customElements.define("pf-broken-tab-app", BrokenTabApp);',
      ].join('\n'),
      validApp: [
        'class HealthyApp extends HTMLElement {',
        '  connectedCallback() { this.style.display = "block"; this.tab = "pulse"; this.draw(); }',
        '  draw() {',
        '    this.textContent = "";',
        '    const wrap = document.createElement("div"); wrap.className = "da-container"; wrap.style.minHeight = "180px";',
        '    for (const t of ["pulse", "tree"]) {',
        '      const b = document.createElement("button"); b.className = "da-tab-btn"; b.textContent = t;',
        '      b.addEventListener("click", () => { this.tab = t; this.draw(); }); wrap.appendChild(b);',
        '    }',
        '    const sec = document.createElement("section"); sec.textContent = this.tab; wrap.appendChild(sec);',
        '    this.appendChild(wrap);',
        '  }',
        '}',
        'customElements.define("pf-healthy-app", HealthyApp);',
      ].join('\n'),
    }

    const pfRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const fx = ${JSON.stringify(fixtures)};
        const verify = window.__VERIFY_DATA_APP_BUNDLE__;
        const beforeIframes = document.querySelectorAll('iframe').length;
        const brokenRender = await verify({ title: 'Broken FilterBar App', raw_code: '', widgets: [], prod_code: fx.brokenRender }, { forceLive: true });
        const blankMount = await verify({ title: 'Blank App', raw_code: '', widgets: [], prod_code: fx.blankMount }, { forceLive: true });
        const brokenTab = await verify({ title: 'Broken Tab 2 App', raw_code: '', widgets: [], prod_code: fx.brokenTab }, { forceLive: true });
        const validApp = await verify({ title: 'Healthy Sticker App', raw_code: '', widgets: [], prod_code: fx.validApp }, { forceLive: true });
        const afterIframes = document.querySelectorAll('iframe').length;
        return { brokenRender, blankMount, brokenTab, validApp, leakedIframes: afterIframes - beforeIframes };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    if (pfRes.exceptionDetails) {
      throw new Error(pfRes.exceptionDetails.exception?.description || pfRes.exceptionDetails.text)
    }
    const v = pfRes.result.value
    expect(v.brokenRender.ok).toBe(false)
    expect(v.brokenRender.errors.join('\n')).toContain('renderFilterBar is not a function')
    expect(v.blankMount.ok).toBe(false)
    expect(v.blankMount.errors.join('\n')).toContain('rendered blank')
    expect(v.brokenTab.ok).toBe(false)
    expect(v.brokenTab.errors.join('\n')).toContain('nonexistentForecastHelper is not a function')
    expect(v.validApp).toMatchObject({ ok: true, errors: [], tabsChecked: 2 })
    expect(v.validApp.height).toBeGreaterThanOrEqual(180)
    expect(v.leakedIframes).toBe(0)
  }, 20000)

  test('Issue #239: renders centered Sign In to See Conversation gate on signed-out conversations with 0 pre-auth GETs across Light/Dark themes and auto-hydrates turns in-place upon sign-in', async () => {
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    // 1. Boot unauthenticated on '/' with ?requireAuthForHydration=1, click conv_app_42, verify gate + header + right-pane preview + Light/Dark tokens + 0 GETs
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt&requireAuthForHydration=1`,
    })
    const readyDeadline = Date.now() + 8000
    while (Date.now() < readyDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="conversation-item-conv_app_42"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const signedOutRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__INTERACTION_CALLS__ = [];
        window.__OAUTH_CALLS__ = [];
        const row = document.querySelector('[data-testid="conversation-item-conv_app_42"]');
        row.click();

        const gateDeadline = Date.now() + 5000;
        while (Date.now() < gateDeadline) {
          if (
            document.querySelector('[data-testid="conv-signin-gate"]') &&
            window.__DAB_STUDIO__?.publishedApp?.dashboardId === '42'
          ) {
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }

        const headerEl = document.querySelector('[data-testid="left-pane-header"]');
        const copyBtnBeforeAuth = document.querySelector('[data-testid="copy-thread-trace-btn"]');
        const gateEl = document.querySelector('[data-testid="conv-signin-gate"]');
        const signInBtn = document.querySelector('[data-testid="conv-signin-btn"]');
        const titleEl = gateEl ? gateEl.querySelector('.dab-conv-signin-title') : null;
        const descEl = gateEl ? gateEl.querySelector('.dab-conv-signin-desc') : null;
        const emptyStarterHero = document.querySelector('.dab-empty-chat');
        const centeredEmptyStage = document.querySelector('[data-testid="centered-empty-prompt"]');

        const getCallsWhileSignedOut = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/')
        ).length;

        const lightCardBg = gateEl ? getComputedStyle(gateEl).backgroundColor : null;
        const lightTitleColor = titleEl ? getComputedStyle(titleEl).color : null;
        const lightDescColor = descEl ? getComputedStyle(descEl).color : null;
        const btnNoClip = signInBtn ? signInBtn.scrollHeight <= signInBtn.clientHeight + 2 : false;

        const chatLogRect = document.querySelector('.dab-chat-log')?.getBoundingClientRect();
        const gateRect = gateEl ? gateEl.getBoundingClientRect() : null;
        const isCenteredInChatLog = Boolean(
          chatLogRect &&
          gateRect &&
          gateRect.top > chatLogRect.top + 20 &&
          gateRect.bottom < chatLogRect.bottom - 20
        );

        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 60));
        const darkCardBg = gateEl ? getComputedStyle(gateEl).backgroundColor : null;
        const darkTitleColor = titleEl ? getComputedStyle(titleEl).color : null;
        const darkDescColor = descEl ? getComputedStyle(descEl).color : null;
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 60));

        const paneRect = document.querySelector('.dab-left-pane')?.getBoundingClientRect();
        const clip = paneRect
          ? {
              x: Math.max(0, Math.floor(paneRect.left - 24)),
              y: Math.max(0, Math.floor(paneRect.top - 24)),
              width: Math.min(1440, Math.ceil(paneRect.width + 48)),
              height: Math.min(900, Math.ceil(paneRect.height + 48)),
              scale: 1,
            }
          : null;

        return {
          isAuthenticated: Boolean(window.__DAB_STUDIO__?.isAuthenticated),
          isEmptyConversation: Boolean(window.__DAB_STUDIO__?.isEmptyConversation),
          routePathname: window.__DAB_STUDIO__?.location?.pathname,
          headerText: headerEl ? headerEl.textContent.trim() : null,
          hasCopyBtnBeforeAuth: Boolean(copyBtnBeforeAuth),
          hasGate: Boolean(gateEl),
          signInBtnText: signInBtn ? signInBtn.textContent.trim() : null,
          btnNoClip,
          isCenteredInChatLog,
          hasEmptyStarterHero: Boolean(emptyStarterHero),
          hasCenteredEmptyStage: Boolean(centeredEmptyStage),
          hasSyntheticFallbackMsg: (document.body.innerText || '').includes('Loaded existing Data App'),
          rightPanePreviewDashboardId: window.__DAB_STUDIO__?.publishedApp?.dashboardId || null,
          getCallsWhileSignedOut,
          lightCardBg,
          darkCardBg,
          lightTitleColor,
          darkTitleColor,
          lightDescColor,
          darkDescColor,
          clip,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    const so = signedOutRes.result.value
    expect(so.isAuthenticated).toBe(false)
    expect(so.isEmptyConversation).toBe(false)
    expect(so.routePathname).toBe('/c/conv_app_42')
    expect(so.headerText).toBe('Executive Revenue App')
    expect(so.hasCopyBtnBeforeAuth).toBe(false)
    expect(so.hasGate).toBe(true)
    expect(so.signInBtnText).toBe('Sign In to See Conversation')
    expect(so.btnNoClip).toBe(true)
    expect(so.isCenteredInChatLog).toBe(true)
    expect(so.hasEmptyStarterHero).toBe(false)
    expect(so.hasCenteredEmptyStage).toBe(false)
    expect(so.hasSyntheticFallbackMsg).toBe(false)
    expect(so.rightPanePreviewDashboardId).toBe('42')
    expect(so.getCallsWhileSignedOut).toBe(0)
    expect(so.darkCardBg).not.toBe(so.lightCardBg)
    expect(so.darkTitleColor).not.toBe(so.lightTitleColor)
    expect(so.darkDescColor).not.toBe(so.lightDescColor)
    expect(so.clip).toBeTruthy()

    const { data: gatePng } = await ctx.chrome.send('Page.captureScreenshot', {
      format: 'png',
      clip: so.clip,
    })
    expect(Buffer.from(gatePng, 'base64').length).toBeGreaterThan(1000)

    // Verify <= 768px mobile keeps left-pane-header visible when conv-signin-gate is active
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    const mobGateHeaderRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `window.getComputedStyle(document.querySelector('[data-testid="left-pane-header"]')).display`,
      returnByValue: true,
    })
    expect(mobGateHeaderRes.result.value).toBe('flex')
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    // 2. Click conv-signin-btn -> authenticates via OAuth and auto-hydrates conv_app_42 turns in-place
    const afterSignInRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const signInBtn = document.querySelector('[data-testid="conv-signin-btn"]');
        signInBtn.click();

        const hydDeadline = Date.now() + 5000;
        while (Date.now() < hydDeadline) {
          const txt = document.body.innerText || '';
          if (
            txt.includes('Build an Executive Revenue Data App on order_items') &&
            txt.includes('Built and published Executive Revenue App')
          ) {
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        await new Promise((r) => setTimeout(r, 80));

        const getCallsAfterSignIn = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/v1_app_42')
        ).length;

        // Switching to + New Conversation and reselecting conv_app_42 makes 0 additional GETs
        document.querySelector('[data-testid="new-conversation-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));
        document.querySelector('[data-testid="conversation-item-conv_app_42"]').click();
        await new Promise((r) => setTimeout(r, 120));
        const getCallsAfterReselect = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/v1_app_42')
        ).length;

        return {
          oauthCallCount: (window.__OAUTH_CALLS__ || []).length,
          isAuthenticatedAfter: Boolean(window.__DAB_STUDIO__?.isAuthenticated),
          gateGoneAfterSignIn: !document.querySelector('[data-testid="conv-signin-gate"]'),
          hasCopyBtnAfterSignIn: Boolean(document.querySelector('[data-testid="copy-thread-trace-btn"]')),
          getCallsAfterSignIn,
          getCallsAfterReselect,
          msgCount: (window.__DAB_STUDIO__?.messages || []).length,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    const as1 = afterSignInRes.result.value
    expect(as1.oauthCallCount).toBe(1)
    expect(as1.isAuthenticatedAfter).toBe(true)
    expect(as1.gateGoneAfterSignIn).toBe(true)
    expect(as1.hasCopyBtnAfterSignIn).toBe(true)
    // Exact 4 GETs: 2 from hydrateRemoteConversationMessages (v1_app_42_r + v1_app_42) + 2 from StudioOverviewSidebar lazy activitySteps cache
    expect(as1.getCallsAfterSignIn).toBe(4)
    expect(as1.getCallsAfterReselect).toBe(4)
    expect(as1.msgCount).toBe(2)

    // 3. Cold-open /c/conv_dashboard_7 directly while signed out (?scenario=dashboard&requireAuthForHydration=1), then setOauthToken -> auto-hydrates
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=dashboard&requireAuthForHydration=1`,
    })
    const coldDeadline = Date.now() + 8000
    while (Date.now() < coldDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="conv-signin-gate"]') && window.__DAB_STUDIO__?.nativeContent?.id === '7')`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const coldHydrateRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const preAuthGets = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/')
        ).length;
        const hadFallbackBeforeAuth = (document.body.innerText || '').includes('Loaded native Looker');
        window.__DAB_STUDIO__.setOauthToken('mock_oauth_cold_hydrate');
        const hydDeadline = Date.now() + 5000;
        while (Date.now() < hydDeadline) {
          if ((document.body.innerText || '').includes('Created native Looker Dashboard #7')) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        await new Promise((r) => setTimeout(r, 80));
        const postAuthGets = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/v1_native_7')
        ).length;

        // 4. Signed-out selection of LookML conversation -> 0 pre-auth GETs, gate stays mounted without load error/toast, bundle + messages hydrate on sign-in
        window.__DAB_STUDIO__.setOauthToken('');
        await new Promise((r) => setTimeout(r, 60));
        window.__INTERACTION_CALLS__ = [];
        document.querySelector('[data-testid="conversation-item-conv_lookml_20261030_dev_branch"]').click();
        const lkGateDeadline = Date.now() + 5000;
        while (Date.now() < lkGateDeadline) {
          if (document.querySelector('[data-testid="conv-signin-gate"]')) break;
          await new Promise((r) => setTimeout(r, 40));
        }
        await new Promise((r) => setTimeout(r, 80));
        const lkPreAuthGets = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/')
        ).length;
        const lkBeforeAuth = {
          preAuthGets: lkPreAuthGets,
          hasGateBeforeAuth: Boolean(document.querySelector('[data-testid="conv-signin-gate"]')),
          hasErrorMsg: Boolean(document.querySelector('.dab-msg-error') || document.querySelector('[data-testid="studio-toast"]')),
          bundleBeforeAuth: window.__DAB_STUDIO__?.lookmlBundle || null,
        };
        window.__DAB_STUDIO__.setOauthToken('mock_oauth_lookml_hydrate');
        const lkHydDeadline = Date.now() + 5000;
        while (Date.now() < lkHydDeadline) {
          if (window.__DAB_STUDIO__?.lookmlBundle?.project_id === 'deploytobarerepo_temp' && (window.__DAB_STUDIO__?.messages || []).length >= 2) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        const lkAfterAuth = Object.assign({}, lkBeforeAuth, {
          bundleProjectAfterAuth: window.__DAB_STUDIO__?.lookmlBundle?.project_id || null,
          msgCountAfterAuth: (window.__DAB_STUDIO__?.messages || []).length,
        });

        // 5. 401 UNAUTHENTICATED on conversation select -> clears expired token & renders conv-signin-gate without fallbackText
        window.__MOCK_LOOKER_EXTENSION__.mockInteractions.v1_health_demo_r = {
          __mockError: 'Antigravity API error (401): UNAUTHENTICATED token expired'
        };
        document.querySelector('[data-testid="conversation-item-conv_health_demo"]').click();
        const r401Deadline = Date.now() + 5000;
        while (Date.now() < r401Deadline) {
          if (document.querySelector('[data-testid="conv-signin-gate"]') && window.__DAB_STUDIO__?.healthReport?.id === 'demo') break;
          await new Promise((r) => setTimeout(r, 50));
        }
        const after401 = {
          isAuthAfter401: Boolean(window.__DAB_STUDIO__?.isAuthenticated),
          hasGateAfter401: Boolean(document.querySelector('[data-testid="conv-signin-gate"]')),
          hasFallbackAfter401: (document.body.innerText || '').includes('Loaded "3-Pillar'),
          healthReportIdAfter401: window.__DAB_STUDIO__?.healthReport?.id || null,
        };

        // 6. Post-login 404 Environment not found -> prunes conversation, shows expired banner, and resets right-pane viewer cleanly to '/'
        window.__MOCK_LOOKER_EXTENSION__.mockInteractions.v1_health_demo_r = {
          __mockError: { ok: false, status: 404, body: JSON.stringify({ error: { message: 'Environment env_42 not found (404)' } }) }
        };
        window.__DAB_STUDIO__.setOauthToken('mock_oauth_fresh_after_401');
        const expPostLoginDeadline = Date.now() + 5000;
        while (Date.now() < expPostLoginDeadline) {
          if (document.querySelector('[data-testid="expired-conversation-banner"]')) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        await new Promise((r) => setTimeout(r, 80));
        const afterPostLogin404 = {
          hasExpiredBanner: Boolean(document.querySelector('[data-testid="expired-conversation-banner"]')),
          routeAfter404: window.__DAB_STUDIO__?.location?.pathname,
          isEmptyAfter404: Boolean(window.__DAB_STUDIO__?.isEmptyConversation),
          healthReportCleared: window.__DAB_STUDIO__?.healthReport === null,
        };

        return {
          preAuthGets,
          hadFallbackBeforeAuth,
          gateGone: Boolean(after401.hasGateAfter401),
          postAuthGets,
          lkAfterAuth,
          after401,
          afterPostLogin404,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    const coldHydrate = coldHydrateRes.result.value
    expect(coldHydrate.preAuthGets).toBe(0)
    expect(coldHydrate.hadFallbackBeforeAuth).toBe(false)
    expect(coldHydrate.postAuthGets).toBe(4)
    expect(coldHydrate.lkAfterAuth).toEqual({
      preAuthGets: 0,
      hasGateBeforeAuth: true,
      hasErrorMsg: false,
      bundleBeforeAuth: null,
      bundleProjectAfterAuth: 'deploytobarerepo_temp',
      msgCountAfterAuth: 2,
    })
    expect(coldHydrate.after401).toEqual({
      isAuthAfter401: false,
      hasGateAfter401: true,
      hasFallbackAfter401: false,
      healthReportIdAfter401: 'demo',
    })
    expect(coldHydrate.afterPostLogin404).toEqual({
      hasExpiredBanner: true,
      routeAfter404: '/',
      isEmptyAfter404: true,
      healthReportCleared: true,
    })
  }, 25000)
}

module.exports = { registerVisualPart14Tests }
