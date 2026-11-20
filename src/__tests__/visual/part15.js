function registerVisualPart15Tests(ctx) {
  test('Issue #238: stacks bottom-right StudioToast notifications across all 4 tones in Light & Dark themes, routes non-conversation errors out of chat messages, and supports manual & auto-dismiss', async () => {
    if (ctx.chrome) ctx.chrome.close()
    ctx.chrome = await ctx.startHeadlessChrome()
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=skills_outdated`,
    })
    const deadline = Date.now() + 8000
    let ready = false
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="topbar-env-sync-btn"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) {
        ready = true
        break
      }
      await new Promise((res) => setTimeout(res, 60))
    }
    expect(ready).toBe(true)

    const toastCheckRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DAB_STUDIO__.setOauthToken('');
        window.__DAB_STUDIO__.clearToasts();
        window.__DAB_STUDIO__.setMessages([
          { role: 'user', text: 'Existing clean chat turn' },
          { role: 'assistant', text: 'Here is your revenue summary.' },
        ]);
        await new Promise((r) => setTimeout(r, 50));

        // 1. Click topbar-env-sync-btn while signed out: shows error toast without flipping to syncing or adding .dab-msg-error
        document.querySelector('[data-testid="topbar-env-sync-btn"]').click();
        await new Promise((r) => setTimeout(r, 60));
        const envStatusAfterSignedOutSync = window.__DAB_STUDIO__.environmentStatus;

        // Trigger a second non-conversation error (failed Google OAuth popup) so 2 error toasts stack vertically
        window.__MOCK_OAUTH_IMPL__ = async () => {
          throw new Error('popup_closed_by_user');
        };
        await window.__DAB_STUDIO__.handleOAuthLogin();
        window.__MOCK_OAUTH_IMPL__ = null;
        await new Promise((r) => setTimeout(r, 60));

        const chatErrorNodes = document.querySelectorAll('.dab-chat-log .dab-msg-error').length;
        const errorMessagesInState = window.__DAB_STUDIO__.messages.filter((m) => m.role === 'error').length;
        const viewport = document.querySelector('[data-testid="studio-toast-viewport"]');
        const vpStyle = viewport ? getComputedStyle(viewport) : null;
        const vpRect = viewport ? viewport.getBoundingClientRect() : null;
        const stackedErrors = Array.from(document.querySelectorAll('[data-testid="studio-toast"]'));
        const r0 = stackedErrors[0] ? stackedErrors[0].getBoundingClientRect() : null;
        const r1 = stackedErrors[1] ? stackedErrors[1].getBoundingClientRect() : null;
        const t0Style = stackedErrors[0] ? getComputedStyle(stackedErrors[0]) : null;
        // Capture live CSSStyleDeclaration strings before clearToasts() unmounts viewport
        const vpSnap = {
          vpPosition: vpStyle?.position || '',
          vpRight: vpStyle?.right || '',
          vpBottom: vpStyle?.bottom || '',
          vpZIndex: vpStyle?.zIndex || '',
          vpPointerEvents: vpStyle?.pointerEvents || '',
          toastPointerEvents: t0Style?.pointerEvents || '',
        };
        const stackedTexts = stackedErrors.map((el) => (el.querySelector('.dab-toast-message')?.textContent || '').trim());
        const stackedRoles = stackedErrors.map((el) => el.getAttribute('role'));

        // Manual dismiss of the first toast via studio-toast-dismiss-btn leaves only the second toast
        stackedErrors[0]?.querySelector('[data-testid="studio-toast-dismiss-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 50));
        const remainingAfterManualDismiss = Array.from(document.querySelectorAll('[data-testid="studio-toast"]')).map(
          (el) => (el.querySelector('.dab-toast-message')?.textContent || '').trim()
        );

        // 2. Verify all 4 tones (info, success, warning, error) in Light & Dark themes + zero horizontal/vertical clipping
        window.__DAB_STUDIO__.clearToasts();
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));
        for (const tone of ['info', 'success', 'warning', 'error']) {
          window.__DAB_STUDIO__.pushToast({
            tone,
            title: tone.toUpperCase(),
            message: 'Long diagnostic https://dev-argolis.looker.com/extensions/oauth2_redirect?tone=' + tone,
            durationMs: null,
          });
        }
        await new Promise((r) => setTimeout(r, 60));

        const readToneStyles = () =>
          Array.from(document.querySelectorAll('[data-testid="studio-toast"]')).map((el) => {
            const cs = getComputedStyle(el);
            const iconCs = getComputedStyle(el.querySelector('.dab-toast-icon'));
            return {
              tone: el.getAttribute('data-toast-tone'),
              role: el.getAttribute('role'),
              hasSvg: Boolean(el.querySelector('.dab-toast-icon svg')),
              bgColor: cs.backgroundColor,
              textColor: cs.color,
              borderLeftColor: cs.borderLeftColor,
              iconColor: iconCs.color,
              noHorizOverflow: el.scrollWidth <= el.clientWidth + 1,
              noVertClip: el.scrollHeight <= el.clientHeight + 2,
            };
          });

        const lightTones = readToneStyles();
        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 60));
        const isDarkAttr = document.documentElement.getAttribute('data-theme') === 'dark';
        const darkTones = readToneStyles();

        // 3. Verify custom short auto-dismiss timer vs sticky (durationMs: null) toast
        window.__DAB_STUDIO__.setThemeMode('light');
        window.__DAB_STUDIO__.clearToasts();
        await new Promise((r) => setTimeout(r, 40));
        const autoId = window.__DAB_STUDIO__.pushToast({ tone: 'info', message: 'Transient 140ms toast', durationMs: 140 });
        const stickyId = window.__DAB_STUDIO__.pushToast({ tone: 'warning', message: 'Sticky warning toast', durationMs: null });
        await new Promise((r) => setTimeout(r, 40));
        const presentImmediately = Array.from(document.querySelectorAll('[data-testid="studio-toast"]')).map((el) =>
          el.getAttribute('data-toast-id')
        );
        await new Promise((r) => setTimeout(r, 180));
        const presentAfterTimer = Array.from(document.querySelectorAll('[data-testid="studio-toast"]')).map((el) =>
          el.getAttribute('data-toast-id')
        );

        // 4. Verify 5-toast queue cap retains newest 5 items
        window.__DAB_STUDIO__.clearToasts();
        for (let k = 1; k <= 6; k++) {
          window.__DAB_STUDIO__.pushToast({ tone: 'info', message: 'Burst #' + k, durationMs: null });
        }
        await new Promise((r) => setTimeout(r, 40));
        const cappedMessages = Array.from(document.querySelectorAll('[data-testid="studio-toast"] .dab-toast-message')).map((el) =>
          (el.textContent || '').trim()
        );

        // 5. Verify /config route mounts StudioToastViewport on validation failure and never renders chat .dab-msg-error
        window.__DAB_STUDIO__.clearToasts();
        window.__DAB_STUDIO__.setMessages([{ role: 'error', text: 'Prior chat turn failure must not appear on /config' }]);
        window.__DAB_STUDIO__.setClientId('');
        window.__DAB_STUDIO__.history.push('/config');
        await new Promise((r) => setTimeout(r, 60));
        await window.__DAB_STUDIO__.handleSaveAuthSetup();
        await new Promise((r) => setTimeout(r, 60));
        const cfgCheck = {
          pathname: window.__DAB_STUDIO__.location.pathname,
          toastText: (document.querySelector('[data-testid="studio-toast"] .dab-toast-message')?.textContent || '').trim(),
          chatErrorsOnConfig: document.querySelectorAll('.dab-msg-error').length,
        };

        return Object.assign({}, vpSnap, {
          envStatusAfterSignedOutSync,
          chatErrorNodes,
          errorMessagesInState,
          anchoredBottomRight: Boolean(vpRect && vpRect.right >= 1400 && vpRect.bottom >= 860),
          stackedVertically: Boolean(r0 && r1 && r1.top >= r0.bottom + 6 && Math.abs(r0.right - r1.right) <= 2),
          stackedTexts,
          stackedRoles,
          remainingAfterManualDismiss,
          isDarkAttr,
          lightTones,
          darkTones,
          autoId,
          stickyId,
          presentImmediately,
          presentAfterTimer,
          cappedMessages,
          cfgCheck,
        });
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    if (toastCheckRes.exceptionDetails) {
      throw new Error(toastCheckRes.exceptionDetails.exception?.description || toastCheckRes.exceptionDetails.text)
    }

    const v = toastCheckRes.result.value
    expect(v.envStatusAfterSignedOutSync).toBe('active')
    expect(v.chatErrorNodes).toBe(0)
    expect(v.errorMessagesInState).toBe(0)
    expect(v.vpPosition).toBe('fixed')
    expect(v.vpRight).toBe('16px')
    expect(v.vpBottom).toBe('16px')
    expect(v.vpZIndex).toBe('2100')
    expect(v.vpPointerEvents).toBe('none')
    expect(v.toastPointerEvents).toBe('auto')
    expect(v.anchoredBottomRight).toBe(true)
    expect(v.stackedVertically).toBe(true)
    expect(v.stackedTexts).toEqual([
      'Skill sync failed: Please sign in with Google OAuth first.',
      'Google OAuth failed: popup_closed_by_user',
    ])
    expect(v.stackedRoles).toEqual(['alert', 'alert'])
    expect(v.remainingAfterManualDismiss).toEqual(['Google OAuth failed: popup_closed_by_user'])

    expect(v.isDarkAttr).toBe(true)
    expect(v.lightTones).toHaveLength(4)
    expect(v.darkTones).toHaveLength(4)
    expect(v.lightTones.map((t) => t.role)).toEqual(['status', 'status', 'status', 'alert'])
    for (let i = 0; i < 4; i++) {
      expect(v.lightTones[i].hasSvg).toBe(true)
      expect(v.lightTones[i].noHorizOverflow).toBe(true)
      expect(v.lightTones[i].noVertClip).toBe(true)
      expect(v.darkTones[i].noHorizOverflow).toBe(true)
      expect(v.darkTones[i].noVertClip).toBe(true)
      expect(v.darkTones[i].bgColor).not.toBe(v.lightTones[i].bgColor)
      expect(v.darkTones[i].textColor).not.toBe(v.lightTones[i].textColor)
      expect(v.darkTones[i].iconColor).not.toBe(v.lightTones[i].iconColor)
    }
    expect(new Set(v.lightTones.map((t) => t.borderLeftColor)).size).toBe(4)
    expect(new Set(v.darkTones.map((t) => t.borderLeftColor)).size).toBe(4)

    expect(v.presentImmediately).toEqual([v.autoId, v.stickyId])
    expect(v.presentAfterTimer).toEqual([v.stickyId])
    expect(v.cappedMessages).toEqual(['Burst #2', 'Burst #3', 'Burst #4', 'Burst #5', 'Burst #6'])
    expect(v.cfgCheck).toEqual({
      pathname: '/config',
      toastText: 'Enter a Google Web OAuth 2.0 Client ID before saving.',
      chatErrorsOnConfig: 0,
    })
  }, 25000)

  test('Issue #245: keeps Ripper brand untruncated on 360x800 & 390x844 mobile with icon-only Dev Mode badge and 3-dot topbar overflow menu while keeping 1440x900 desktop unchanged', async () => {
    if (ctx.chrome) ctx.chrome.close()
    ctx.chrome = await ctx.startHeadlessChrome()

    try {
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await ctx.chrome.send('Page.navigate', {
        url: `http://127.0.0.1:${ctx.port}/?scenario=skills_outdated`,
      })
      const deadline = Date.now() + 8000
      let ready = false
      while (Date.now() < deadline) {
        const r = await ctx.chrome.send('Runtime.evaluate', {
          expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="topbar-env-sync-btn"]'))`,
          returnByValue: true,
        })
        if (r.result?.value) {
          ready = true
          break
        }
        await new Promise((res) => setTimeout(res, 60))
      }
      expect(ready).toBe(true)

      // 1. Desktop (1440x900) verification: full text Dev Mode badge, inline Environment/Theme/OAuth controls visible, mobile 3-dot hidden
      const deskRes = await ctx.chrome.send('Runtime.evaluate', {
        expression: `(async () => {
          await window.__DAB_STUDIO__.handleToggleLookerDevMode('dev');
          await new Promise((r) => setTimeout(r, 50));
          const devBadge = document.querySelector('[data-testid="topbar-dev-mode-badge"]');
          const devIcon = devBadge?.querySelector('.dab-mobile-dev-icon');
          const devLabel = devBadge?.querySelector('.dab-dev-mode-label');
          return {
            devIconHidden: Boolean(devIcon && getComputedStyle(devIcon).display === 'none'),
            devLabelVisible: Boolean(devLabel && getComputedStyle(devLabel).display !== 'none'),
            envBtnVisible: getComputedStyle(document.querySelector('[data-testid="topbar-environment-btn"]')).display !== 'none',
            themeSelectVisible: getComputedStyle(document.querySelector('[data-testid="topbar-theme-select"]')).display !== 'none',
            oauthBtnVisible: getComputedStyle(document.querySelector('[data-testid="topbar-oauth-signin-btn"]')).display !== 'none',
            moreWrapHidden: getComputedStyle(document.querySelector('.dab-mobile-more-wrap')).display === 'none',
            moreBtnHidden: getComputedStyle(document.querySelector('[data-testid="topbar-mobile-more-btn"]')).display === 'none',
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      })
      if (deskRes.exceptionDetails) {
        throw new Error(deskRes.exceptionDetails.exception?.description || deskRes.exceptionDetails.text)
      }
      expect(deskRes.result.value).toEqual({
        devIconHidden: true,
        devLabelVisible: true,
        envBtnVisible: true,
        themeSelectVisible: true,
        oauthBtnVisible: true,
        moreWrapHidden: true,
        moreBtnHidden: true,
      })

      // 2. Mobile 360x800 & 390x844 layout + non-truncation check with isLookerDevMode=true, environmentStatus='syncing', envSkillsOutdated=true
      const inspectMobileLayout = async (width, height) => {
        await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 2,
          mobile: true,
        })
        const res = await ctx.chrome.send('Runtime.evaluate', {
          expression: `(async () => {
            await window.__DAB_STUDIO__.handleSaveAgentName('Ripper');
            await window.__DAB_STUDIO__.handleToggleLookerDevMode('dev');
            const prevStatus = window.__DAB_STUDIO__.environmentStatus;
            window.__DAB_STUDIO__.setEnvironmentStatus?.('syncing');
            await new Promise((r) => setTimeout(r, 60));
            const brandLabel = document.querySelector('[data-testid="studio-agent-name-label"]');
            const topbar = document.querySelector('.dab-topbar');
            const devBadge = document.querySelector('[data-testid="topbar-dev-mode-badge"]');
            const devRect = devBadge.getBoundingClientRect();
            const devIcon = devBadge.querySelector('.dab-mobile-dev-icon');
            const devLabel = devBadge.querySelector('.dab-dev-mode-label');
            const moreBtn = document.querySelector('[data-testid="topbar-mobile-more-btn"]');
            const moreRect = moreBtn.getBoundingClientRect();
            const snap = {
              labelText: (brandLabel?.textContent || '').trim(),
              brandUntruncated: Boolean(brandLabel && brandLabel.clientWidth >= 36 && brandLabel.scrollWidth <= brandLabel.clientWidth),
              singleRowTopbar: topbar.getBoundingClientRect().height <= 46,
              noViewportOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
              devBadgeSize: [Math.round(devRect.width), Math.round(devRect.height)],
              devIconVisible: getComputedStyle(devIcon).display !== 'none',
              devLabelHidden: getComputedStyle(devLabel).display === 'none',
              envWrapHidden: getComputedStyle(document.querySelector('.dab-env-menu-wrap')).display === 'none',
              envBtnHidden: getComputedStyle(document.querySelector('[data-testid="topbar-environment-btn"]')).display === 'none',
              envSyncBtnHidden: Boolean(
                !document.querySelector('[data-testid="topbar-env-sync-btn"]') ||
                getComputedStyle(document.querySelector('[data-testid="topbar-env-sync-btn"]')).display === 'none'
              ),
              themeSelectHidden: getComputedStyle(document.querySelector('[data-testid="topbar-theme-select"]')).display === 'none',
              oauthBtnHidden: getComputedStyle(document.querySelector('[data-testid="topbar-oauth-signin-btn"]')).display === 'none',
              moreBtnSize: [Math.round(moreRect.width), Math.round(moreRect.height)],
              hasDot: Boolean(moreBtn.querySelector('.dab-mobile-more-dot')),
            };
            window.__DAB_STUDIO__.setEnvironmentStatus?.(prevStatus);
            return snap;
          })()`,
          awaitPromise: true,
          returnByValue: true,
        })
        if (res.exceptionDetails) {
          throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text)
        }
        return res.result.value
      }

      const layout360 = await inspectMobileLayout(360, 800)
      const layout390 = await inspectMobileLayout(390, 844)
      for (const layout of [layout360, layout390]) {
        expect(layout).toEqual({
          labelText: 'Ripper',
          brandUntruncated: true,
          singleRowTopbar: true,
          noViewportOverflow: true,
          devBadgeSize: [28, 28],
          devIconVisible: true,
          devLabelHidden: true,
          envWrapHidden: true,
          envBtnHidden: true,
          envSyncBtnHidden: true,
          themeSelectHidden: true,
          oauthBtnHidden: true,
          moreBtnSize: [28, 28],
          hasDot: true,
        })
      }

      // 3. Interactive mobile 3-dot overflow menu actions at 360x800 (Sign In, Theme Dark/Light, Sync Skills, Stop Env, Reset Env -> Modal, Sign Out, Escape & outside mousedown)
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
        width: 360,
        height: 800,
        deviceScaleFactor: 2,
        mobile: true,
      })
      const actionsRes = await ctx.chrome.send('Runtime.evaluate', {
        expression: `(async () => {
          const getMoreBtn = () => document.querySelector('[data-testid="topbar-mobile-more-btn"]');

          // Initially signed out: verify Sign In with Google row, Light style, Escape & outside mousedown, then sign in via mobile-more-signin-btn
          window.__DAB_STUDIO__.setOauthToken('');
          window.__DAB_STUDIO__.setThemeMode('light');
          await new Promise((r) => setTimeout(r, 40));
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 40));
          const menuLight = document.querySelector('[data-testid="topbar-mobile-more-menu"]');
          const menuRect = menuLight.getBoundingClientRect();
          const signInLabelBeforeAuth = (document.querySelector('[data-testid="mobile-more-signin-btn"]')?.textContent || '').trim();
          const lightStyle = {
            bg: getComputedStyle(menuLight).backgroundColor,
            color: getComputedStyle(menuLight).color,
            clampedInViewport: menuRect.top >= 34 && menuRect.top <= 60 && menuRect.left >= 8 && menuRect.right <= 352 && menuRect.bottom <= 792,
            noVertClip: menuLight.scrollHeight <= menuLight.clientHeight + 2,
            initialEnvStatus: (document.querySelector('[data-testid="mobile-more-env-status"]')?.textContent || '').trim(),
            hasUpdateBadge: (document.querySelector('[data-testid="mobile-more-sync-skills-btn"]')?.textContent || '').includes('Update available'),
          };

          // Dismiss via Escape (verifying focus returns to topbar-mobile-more-btn & ArrowDown roves menu items), then reopen & dismiss via outside touchstart + mousedown
          const focusedFirstItemOnOpen = document.activeElement?.closest?.('[data-testid="topbar-mobile-more-menu"]') !== null;
          menuLight.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
          const rovedTestId = document.activeElement?.getAttribute?.('data-testid') || '';
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise((r) => setTimeout(r, 30));
          const closedOnEscape = !document.querySelector('[data-testid="topbar-mobile-more-menu"]');
          const focusReturnedToTrigger = document.activeElement === getMoreBtn();
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          document.body.dispatchEvent(new Event('touchstart', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 30));
          const closedOnOutsideTouchStart = !document.querySelector('[data-testid="topbar-mobile-more-menu"]');
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 30));
          const closedOnOutsideMouseDown = !document.querySelector('[data-testid="topbar-mobile-more-menu"]');

          // Verify 450ms touch long-press tooltip on 28x28 icon-only topbar-dev-mode-badge (dispatching synthetic post-touchend click to clear suppressNextClickRef)
          const devBadgeEl = document.querySelector('[data-testid="topbar-dev-mode-badge"]');
          devBadgeEl.dispatchEvent(new Event('touchstart', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 480));
          const devLongPressTooltip = (document.querySelector('[data-testid="studio-longpress-tooltip"]')?.textContent || '').trim();
          devBadgeEl.dispatchEvent(new Event('touchend', { bubbles: true }));
          devBadgeEl.click();
          document.querySelector('.dab-shell')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

          // Pending OAuth popup cancel via mobile-more-signin-btn, then live sign-in
          window.__MOCK_OAUTH_IMPL__ = () => new Promise(() => {});
          void window.__DAB_STUDIO__.handleOAuthLogin();
          await new Promise((r) => setTimeout(r, 30));
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          const signingInCancelLabel = (document.querySelector('[data-testid="mobile-more-signin-btn"]')?.textContent || '').trim();
          document.querySelector('[data-testid="mobile-more-signin-btn"]').click();
          await new Promise((r) => setTimeout(r, 40));
          const oauthCancelledCleanly = !window.__DAB_STUDIO__.oauthSigningIn && !window.__DAB_STUDIO__.oauthToken;
          window.__MOCK_OAUTH_IMPL__ = null;

          // Sign in via mobile-more-signin-btn
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          document.querySelector('[data-testid="mobile-more-signin-btn"]').click();
          await new Promise((r) => setTimeout(r, 80));
          const tokenAfterSignIn = window.__DAB_STUDIO__.oauthToken;

          // Switch across Dark -> System -> Light via mobile-more-theme-*
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          document.querySelector('[data-testid="mobile-more-theme-dark"]').click();
          await new Promise((r) => setTimeout(r, 50));
          const darkAttrAfterSwitch = document.documentElement.getAttribute('data-theme');
          const menuClosedAfterTheme = !document.querySelector('[data-testid="topbar-mobile-more-menu"]');

          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 40));
          const menuDark = document.querySelector('[data-testid="topbar-mobile-more-menu"]');
          const darkStyle = {
            bg: getComputedStyle(menuDark).backgroundColor,
            color: getComputedStyle(menuDark).color,
            darkChecked: document.querySelector('[data-testid="mobile-more-theme-dark"]')?.getAttribute('aria-checked'),
          };
          document.querySelector('[data-testid="mobile-more-theme-system"]').click();
          await new Promise((r) => setTimeout(r, 40));
          const systemModeSet = window.__DAB_STUDIO__.themeMode === 'system';
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          const systemChecked = document.querySelector('[data-testid="mobile-more-theme-system"]')?.getAttribute('aria-checked');
          document.querySelector('[data-testid="mobile-more-theme-light"]').click();
          await new Promise((r) => setTimeout(r, 40));
          const lightAttrRestored = document.documentElement.getAttribute('data-theme');

          // Sync skills via mobile-more-sync-skills-btn
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          document.querySelector('[data-testid="mobile-more-sync-skills-btn"]').click();
          const syncWaitEnd = Date.now() + 3000;
          while (Date.now() < syncWaitEnd) {
            if (!window.__DAB_STUDIO__.envSkillsOutdated && window.__DAB_STUDIO__.environmentStatus === 'active') break;
            await new Promise((r) => setTimeout(r, 50));
          }
          const outdatedAfterSync = window.__DAB_STUDIO__.envSkillsOutdated;
          const dotGoneAfterSync = !getMoreBtn().querySelector('.dab-mobile-more-dot');

          // Stop environment via mobile-more-stop-env-btn
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          const statusAfterSync = (document.querySelector('[data-testid="mobile-more-env-status"]')?.textContent || '').trim();
          document.querySelector('[data-testid="mobile-more-stop-env-btn"]').click();
          await new Promise((r) => setTimeout(r, 50));
          const envStatusAfterStop = window.__DAB_STUDIO__.environmentStatus;

          // Reset environment via mobile-more-reset-env-btn -> opens reset-env-modal on mobile!
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          const statusWhileStopped = (document.querySelector('[data-testid="mobile-more-env-status"]')?.textContent || '').trim();
          document.querySelector('[data-testid="mobile-more-reset-env-btn"]').click();
          await new Promise((r) => setTimeout(r, 50));
          const resetModal = document.querySelector('[data-testid="reset-env-modal"]');
          const resetModalVisibleOnMobile = Boolean(resetModal && resetModal.getBoundingClientRect().width > 200);
          const confirmInput = document.querySelector('[data-testid="reset-env-confirm-input"]');
          const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          inputSetter.call(confirmInput, 'DELETE');
          confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));
          document.querySelector('[data-testid="confirm-reset-env-btn"]').click();
          const resetWaitEnd = Date.now() + 3000;
          while (Date.now() < resetWaitEnd) {
            if (!document.querySelector('[data-testid="reset-env-modal"]') && window.__DAB_STUDIO__.environmentStatus === 'active') break;
            await new Promise((r) => setTimeout(r, 50));
          }
          const resetModalClosed = !document.querySelector('[data-testid="reset-env-modal"]');

          // Sign out via mobile-more-signout-btn -> transitions back to mobile-more-signin-btn
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          const statusAfterReset = (document.querySelector('[data-testid="mobile-more-env-status"]')?.textContent || '').trim();
          document.querySelector('[data-testid="mobile-more-signout-btn"]').click();
          await new Promise((r) => setTimeout(r, 50));
          const tokenAfterSignOut = window.__DAB_STUDIO__.oauthToken;
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          const signInLabelWhenSignedOut = (document.querySelector('[data-testid="mobile-more-signin-btn"]')?.textContent || '').trim();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

          // Verify authMode === 'apikey' & report contentType on 360x800 mobile + /config theme switcher visibility on mobile
          window.__DAB_STUDIO__.setAuthMode('apikey');
          window.__DAB_STUDIO__.setContentItems([{ key: 'report:1', contentType: 'report', contentId: '1', title: 'Audit', createdInConversation: true }]);
          window.__DAB_STUDIO__.setActiveContentTabKey('report:1');
          await new Promise((r) => setTimeout(r, 50));
          const apiKeyTopbarHidden = getComputedStyle(document.querySelector('.dab-topbar-apikey-badge')).display === 'none';
          const healthSelectHiddenOnMobile = getComputedStyle(document.querySelector('[data-testid="topbar-health-scope-select"]')).display === 'none';
          const brandLabelOnReport = document.querySelector('[data-testid="studio-agent-name-label"]');
          const brandUntruncatedOnReport = Boolean(brandLabelOnReport && brandLabelOnReport.scrollWidth <= brandLabelOnReport.clientWidth);
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          const apiKeyBadgeInMenu = (document.querySelector('[data-testid="mobile-more-apikey-badge"]')?.textContent || '').trim();
          const hasRunAuditInMenu = Boolean(document.querySelector('[data-testid="mobile-more-run-audit-btn"]'));

          // Leave menu open before resizing > 768px below; first check /config at 360x800 after closing
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          window.__DAB_STUDIO__.setAuthMode('oauth');
          window.__DAB_STUDIO__.history.push('/config');
          await new Promise((r) => setTimeout(r, 50));
          const configThemeVisibleOnMobile = getComputedStyle(document.querySelector('[data-testid="topbar-theme-select"]')).display !== 'none';
          window.__DAB_STUDIO__.history.push('/');
          await new Promise((r) => setTimeout(r, 50));
          getMoreBtn().click();
          await new Promise((r) => setTimeout(r, 30));
          const openBeforeDesktopResize = Boolean(document.querySelector('[data-testid="topbar-mobile-more-menu"]'));

          return {
            signInLabelBeforeAuth,
            signingInCancelLabel,
            oauthCancelledCleanly,
            tokenAfterSignIn,
            lightStyle,
            darkStyle,
            focusedFirstItemOnOpen,
            rovedTestId,
            closedOnEscape,
            focusReturnedToTrigger,
            closedOnOutsideTouchStart,
            closedOnOutsideMouseDown,
            devLongPressTooltip,
            darkAttrAfterSwitch,
            menuClosedAfterTheme,
            systemModeSet,
            systemChecked,
            lightAttrRestored,
            outdatedAfterSync,
            dotGoneAfterSync,
            statusAfterSync,
            envStatusAfterStop,
            statusWhileStopped,
            resetModalVisibleOnMobile,
            resetModalClosed,
            statusAfterReset,
            tokenAfterSignOut,
            signInLabelWhenSignedOut,
            apiKeyTopbarHidden,
            healthSelectHiddenOnMobile,
            brandUntruncatedOnReport,
            apiKeyBadgeInMenu,
            hasRunAuditInMenu,
            configThemeVisibleOnMobile,
            openBeforeDesktopResize,
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      })
      if (actionsRes.exceptionDetails) {
        throw new Error(actionsRes.exceptionDetails.exception?.description || actionsRes.exceptionDetails.text)
      }
      const a = actionsRes.result.value
      expect(a.signInLabelBeforeAuth).toBe('Sign In with Google')
      expect(a.signingInCancelLabel).toBe('Signing in… (Cancel)')
      expect(a.oauthCancelledCleanly).toBe(true)
      expect(a.tokenAfterSignIn).toBe('mock_oauth_token_123')
      expect(a.lightStyle).toMatchObject({
        clampedInViewport: true,
        noVertClip: true,
        initialEnvStatus: 'Environment',
        hasUpdateBadge: true,
      })
      expect(a.darkStyle.darkChecked).toBe('true')
      expect(a.darkStyle.bg).not.toBe(a.lightStyle.bg)
      expect(a.darkStyle.color).not.toBe(a.lightStyle.color)
      expect(a.focusedFirstItemOnOpen).toBe(true)
      expect(a.rovedTestId.length).toBeGreaterThan(0)
      expect(a.closedOnEscape).toBe(true)
      expect(a.focusReturnedToTrigger).toBe(true)
      expect(a.closedOnOutsideTouchStart).toBe(true)
      expect(a.closedOnOutsideMouseDown).toBe(true)
      expect(a.devLongPressTooltip).toBe('Looker session is in Development Mode')
      expect(a.darkAttrAfterSwitch).toBe('dark')
      expect(a.menuClosedAfterTheme).toBe(true)
      expect(a.systemModeSet).toBe(true)
      expect(a.systemChecked).toBe('true')
      expect(a.lightAttrRestored).toBe('light')
      expect(a.outdatedAfterSync).toBe(false)
      expect(a.dotGoneAfterSync).toBe(true)
      expect(a.statusAfterSync).toBe('✓ Skills Updated')
      expect(a.envStatusAfterStop).toBe('stopped')
      expect(a.statusWhileStopped).toBe('Environment (Stopped)')
      expect(a.resetModalVisibleOnMobile).toBe(true)
      expect(a.resetModalClosed).toBe(true)
      expect(a.statusAfterReset).toBe('✓ Environment Reset')
      expect(a.tokenAfterSignOut).toBe('')
      expect(a.signInLabelWhenSignedOut).toBe('Sign In with Google')
      expect(a.apiKeyTopbarHidden).toBe(true)
      expect(a.healthSelectHiddenOnMobile).toBe(true)
      expect(a.brandUntruncatedOnReport).toBe(true)
      expect(a.apiKeyBadgeInMenu).toBe('API Key (User Attr) ✓')
      expect(a.hasRunAuditInMenu).toBe(true)
      expect(a.configThemeVisibleOnMobile).toBe(true)
      expect(a.openBeforeDesktopResize).toBe(true)

      // Verify > 768px viewport resize auto-closes open topbar-mobile-more-menu
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
        width: 1024,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      })
      const resizeCloseRes = await ctx.chrome.send('Runtime.evaluate', {
        expression: `(async () => {
          window.dispatchEvent(new Event('resize'));
          await new Promise((r) => setTimeout(r, 30));
          return !document.querySelector('[data-testid="topbar-mobile-more-menu"]') &&
            document.querySelector('[data-testid="topbar-mobile-more-btn"]')?.getAttribute('aria-expanded') === 'false';
        })()`,
        awaitPromise: true,
        returnByValue: true,
      })
      expect(resizeCloseRes.result.value).toBe(true)
    } finally {
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
  }, 25000)
}

module.exports = { registerVisualPart15Tests }
