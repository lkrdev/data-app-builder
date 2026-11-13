function registerVisualPart04Tests(ctx) {
  const { existsSync, mkdirSync, writeFileSync, path, startHeadlessChrome } = ctx
  test('gates chat submission when signed out with inline Sign In button, prevents hanging oauth2Authenticate popup from locking busyStatus, and surfaces copyable Authorized Redirect URI in /config (Issue #65)', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="studio-send-btn"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    // 1. Verify signed-out state: Send button is disabled, inline Sign In button is rendered, and Cmd+Enter does NOT clear prompt or start a turn
    const signedOutRes = await ctx.chrome.send('Runtime.evaluate', {
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
    const configRes = await ctx.chrome.send('Runtime.evaluate', {
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

    const { data } = await ctx.chrome.send('Page.captureScreenshot', {
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
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt&preserveOAuth=1`
    })
    const reloadDeadline = Date.now() + 8000
    while (Date.now() < reloadDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="topbar-oauth-signin-btn"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 80))
    }
    const persistedRes = await ctx.chrome.send('Runtime.evaluate', {
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
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${ctx.port}/?scenario=python_tile_studio`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `document.querySelectorAll('[data-testid="use-case-info-btn"]').length >= 2`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const openRes = await ctx.chrome.send('Runtime.evaluate', {
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
    const clipRes = await ctx.chrome.send('Runtime.evaluate', {
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
    const { data } = await ctx.chrome.send('Page.captureScreenshot', { format: 'png', clip })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)

    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchModalPath = path.join(scratchDir, 'issue-64-use-case-docs-modal.png')
    writeFileSync(scratchModalPath, pngBuffer)
    expect(existsSync(scratchModalPath)).toBe(true)

    // Switch across LookML, Health Check, and Auto tabs inside the modal, then close
    const tabSwitchRes = await ctx.chrome.send('Runtime.evaluate', {
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
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${ctx.port}/?scenario=data_app`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="archive-conv-conv_app_42"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    // Step 1: Archive conv_lookml_20261030_dev_branch, reveal Show Archived (1), and open Delete modal on conv_app_42
    const modalOpenRes = await ctx.chrome.send('Runtime.evaluate', {
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
    const clipRes = await ctx.chrome.send('Runtime.evaluate', {
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

    const { data } = await ctx.chrome.send('Page.captureScreenshot', {
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
    const afterConfirmRes = await ctx.chrome.send('Runtime.evaluate', {
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

}

module.exports = { registerVisualPart04Tests }
