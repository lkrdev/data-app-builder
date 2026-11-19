function registerVisualPart15Tests(ctx) {
  test('Issue #238: stacks bottom-right StudioToast notifications across all 4 tones in Light & Dark themes, routes non-conversation errors out of chat messages, and supports manual & auto-dismiss', async () => {
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    // 1. Boot on /?scenario=skills_outdated while signed out: clicking topbar-env-sync-btn shows error toast without flipping to syncing or adding .dab-msg-error to chat
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=skills_outdated`,
    })
    const syncBtnDeadline = Date.now() + 8000
    while (Date.now() < syncBtnDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="topbar-env-sync-btn"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const toastCheckRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        s.setOauthToken('');
        s.clearToasts();
        s.setMessages([{ role: 'user', text: 'Existing clean chat turn' }, { role: 'assistant', text: 'Here is your revenue summary.' }]);
        await new Promise((r) => setTimeout(r, 50));

        // Click topbar-env-sync-btn while signed out
        const syncBtn = document.querySelector('[data-testid="topbar-env-sync-btn"]');
        syncBtn.click();
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
        const firstDismissBtn = stackedErrors[0]?.querySelector('[data-testid="studio-toast-dismiss-btn"]');
        firstDismissBtn?.click();
        await new Promise((r) => setTimeout(r, 50));
        const remainingAfterManualDismiss = Array.from(document.querySelectorAll('[data-testid="studio-toast"]')).map(
          (el) => (el.querySelector('.dab-toast-message')?.textContent || '').trim()
        );

        // Verify all 4 tones (info, success, warning, error) in Light & Dark themes + zero horizontal/vertical clipping
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

        // Verify custom short auto-dismiss timer vs sticky (durationMs: null) toast
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

        // Verify 5-toast queue cap retains newest 5 items
        window.__DAB_STUDIO__.clearToasts();
        for (let k = 1; k <= 6; k++) {
          window.__DAB_STUDIO__.pushToast({ tone: 'info', message: 'Burst #' + k, durationMs: null });
        }
        await new Promise((r) => setTimeout(r, 40));
        const cappedMessages = Array.from(document.querySelectorAll('[data-testid="studio-toast"] .dab-toast-message')).map((el) =>
          (el.textContent || '').trim()
        );

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
        });
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

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

    // 2. Also verify /config route mounts StudioToastViewport when Save Setup fails validation (and never leaks chat turn errors)
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt&unconfigured=1`,
    })
    const cfgDeadline = Date.now() + 8000
    while (Date.now() < cfgDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && window.__DAB_STUDIO__.location.pathname === '/config')`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const cfgToastRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DAB_STUDIO__.setMessages([{ role: 'error', text: 'Prior chat turn failure must not appear on /config' }]);
        window.__DAB_STUDIO__.setClientId('');
        await new Promise((r) => setTimeout(r, 40));
        await window.__DAB_STUDIO__.handleSaveAuthSetup();
        await new Promise((r) => setTimeout(r, 60));
        return {
          pathname: window.__DAB_STUDIO__.location.pathname,
          toastText: (document.querySelector('[data-testid="studio-toast"] .dab-toast-message')?.textContent || '').trim(),
          chatErrorsOnConfig: document.querySelectorAll('.dab-msg-error').length,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    expect(cfgToastRes.result.value).toEqual({
      pathname: '/config',
      toastText: 'Enter a Google Web OAuth 2.0 Client ID before saving.',
      chatErrorsOnConfig: 0,
    })
  }, 25000)
}

module.exports = { registerVisualPart15Tests }
