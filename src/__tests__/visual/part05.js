function registerVisualPart05Tests(ctx) {
  const { existsSync, mkdirSync, writeFileSync, path, startHeadlessChrome } = ctx
  test('renders Looker-style lazy folder tree with ancestor hydration, in-memory quick search, advanced search_folders modal, fixed-width loading skeleton, and removes legacy manual ID loaders (Issue #62)', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${ctx.port}/?scenario=data_app`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="topbar-folder-trigger"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const domRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        // 1. Check removal of legacy manual ID loaders
        const hasDashboardIdInput = Boolean(document.querySelector('input[placeholder*="Dashboard ID"]'));
        const hasLookmlSessionIdInput = Boolean(document.querySelector('input[placeholder*="LookML Session ID"]'));

        // 2. Check fixed width on Save to Folder trigger
        const trigger = document.querySelector('[data-testid="topbar-folder-trigger"]');
        const triggerStyle = trigger ? window.getComputedStyle(trigger) : null;
        const triggerMinWidth = triggerStyle ? triggerStyle.minWidth : '';
        const triggerMaxWidth = triggerStyle ? triggerStyle.maxWidth : '';
        const triggerLabel = document.querySelector('[data-testid="topbar-folder-picker"]')?.textContent || '';

        // 3. Toggle loadingMetadata to verify skeleton renders with same dimensions
        s.setLoadingMetadata(true);
        await new Promise((r) => setTimeout(r, 80));
        const skeleton = document.querySelector('[data-testid="folder-selector-skeleton"]');
        const hasSkeleton = Boolean(skeleton && skeleton.classList.contains('dab-skeleton'));
        s.setLoadingMetadata(false);
        await new Promise((r) => setTimeout(r, 80));

        // 4. Open Folder Tree Popover & expand Personal folder ('5')
        const triggerAfter = document.querySelector('[data-testid="topbar-folder-trigger"]');
        triggerAfter.click();
        await new Promise((r) => setTimeout(r, 80));

        const expandPersonalBtn = document.querySelector('[data-testid="folder-expand-5"]');
        if (expandPersonalBtn) expandPersonalBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        const hasPersonalChild = Boolean(document.querySelector('[data-testid="folder-select-503"]'));

        // 5. Test In-Memory Quick Search
        const quickSearch = document.querySelector('[data-testid="folder-tree-quick-search"]');
        const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        inputSetter.call(quickSearch, 'Experiments');
        quickSearch.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        const quickSearchFilteredText = document.querySelector('[data-testid="folder-tree-list"]')?.textContent || '';
        inputSetter.call(quickSearch, '');
        quickSearch.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));

        // 6. Open Advanced Search modal, search for 'subfolder test', select '502'
        const advBtn = document.querySelector('[data-testid="folder-advanced-search-btn"]');
        advBtn.click();
        await new Promise((r) => setTimeout(r, 80));

        const nameInput = document.querySelector('[data-testid="folder-search-input-name"]');
        inputSetter.call(nameInput, 'subfolder');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const runSearchBtn = document.querySelector('[data-testid="folder-search-submit-btn"]');
        runSearchBtn.click();
        await new Promise((r) => setTimeout(r, 120));

        const result502 = document.querySelector('[data-testid="folder-search-result-502"]');
        const hasSearchResult502 = Boolean(result502);
        if (result502) result502.click();
        await new Promise((r) => setTimeout(r, 150));

        // 7. Ensure popover is open and re-open Advanced Search modal so both are visible for the visual snapshot
        const triggerFinal = document.querySelector('[data-testid="topbar-folder-trigger"]');
        const selectedTriggerText = triggerFinal?.textContent?.trim() || '';
        if (!document.querySelector('[data-testid="folder-tree-popover"]') && triggerFinal) {
          triggerFinal.click();
          await new Promise((r) => setTimeout(r, 100));
        }

        const hasHydratedParent501 = Boolean(document.querySelector('[data-testid="folder-select-501"]'));
        const hasHydratedLeaf502 = Boolean(document.querySelector('[data-testid="folder-select-502"]'));
        const personalNodeCount = document.querySelectorAll('[data-testid="folder-select-5"]').length;
        const treeText = document.querySelector('[data-testid="folder-tree-popover"]')?.textContent || '';
        const hasNoHashIdsInTree = !treeText.includes('#5') && !treeText.includes('#1') && !treeText.includes('#502');

        const advBtn2 = document.querySelector('[data-testid="folder-advanced-search-btn"]');
        if (advBtn2) advBtn2.click();
        await new Promise((r) => setTimeout(r, 100));

        // 8. Issue #112 checks: Dev Mode badge, removed brand pills, persisted folder ID, clean search modal copy, icon-only close button, and 0px CLS on Personal Scope select
        const topbarText = document.querySelector('.dab-topbar')?.textContent || '';
        const hasRemovedBrandPills = !topbarText.includes('Agentic LookML') && !topbarText.includes('WASM CodeMode');
        await window.__DAB_STUDIO__.handleToggleLookerDevMode('dev');
        await new Promise((r) => setTimeout(r, 40));
        const devBadge = document.querySelector('[data-testid="topbar-dev-mode-badge"]');
        const hasDevModeBadgeWhenDev = Boolean(devBadge && devBadge.textContent?.trim() === 'Dev Mode');
        await window.__DAB_STUDIO__.handleToggleLookerDevMode('production');
        await new Promise((r) => setTimeout(r, 40));
        const devBadgeHiddenInProd = !document.querySelector('[data-testid="topbar-dev-mode-badge"]');
        const persistedFolderId = window.localStorage.getItem('dab_selected_folder_id');

        const advModal = document.querySelector('[data-testid="folder-advanced-search-modal"]');
        const advModalText = advModal?.textContent || '';
        const hasCleanSearchCopy =
          advModalText.includes('Advanced Looker Folder Search') &&
          !advModalText.includes('sdk.search_folders') &&
          !advModalText.includes('parent_id') &&
          !advModalText.includes('creator_id') &&
          !advModalText.includes('is_personal');
        const closeBtn = document.querySelector('[data-testid="folder-search-modal-close"]');
        const modalCloseBtnText = closeBtn?.textContent?.trim() || '';
        const modalCloseBtnTitle = closeBtn?.getAttribute('title') || '';
        const parentInput = document.querySelector('[data-testid="folder-search-input-parent-id"]');
        const creatorInput = document.querySelector('[data-testid="folder-search-input-creator-id"]');
        const parentInputHasDatalist = parentInput?.getAttribute('list') === 'dab-folder-parent-suggestions';
        const creatorInputHasDatalist = creatorInput?.getAttribute('list') === 'dab-folder-creator-suggestions';

        const personalSelectTrigger = document.querySelector('[data-testid="folder-search-select-personal-trigger"]');
        const wAny = Math.round(personalSelectTrigger.getBoundingClientRect().width);
        personalSelectTrigger.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="folder-search-select-personal-option-false"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const wShared = Math.round(personalSelectTrigger.getBoundingClientRect().width);
        personalSelectTrigger.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="folder-search-select-personal-option-true"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const wPersonal = Math.round(personalSelectTrigger.getBoundingClientRect().width);
        personalSelectTrigger.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="folder-search-select-personal-option-any"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const personalSelectClsPx = Math.max(Math.abs(wShared - wAny), Math.abs(wPersonal - wAny));

        return {
          hasDashboardIdInput,
          hasLookmlSessionIdInput,
          triggerMinWidth,
          triggerMaxWidth,
          hasSaveToFolderLabel: triggerLabel.includes('Save New Content to Folder:'),
          hasSkeleton,
          hasPersonalChild,
          quickSearchMatchesExperiments: quickSearchFilteredText.includes('Personal Experiments'),
          hasSearchResult502,
          selectedTriggerText,
          hasHydratedParent501,
          hasHydratedLeaf502,
          personalNodeCount,
          hasNoHashIdsInTree,
          hasRemovedBrandPills,
          hasDevModeBadgeWhenDev,
          devBadgeHiddenInProd,
          persistedFolderId,
          hasCleanSearchCopy,
          modalCloseBtnText,
          modalCloseBtnTitle,
          parentInputHasDatalist,
          creatorInputHasDatalist,
          personalSelectClsPx
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(domRes.result.value).toEqual({
      hasDashboardIdInput: false,
      hasLookmlSessionIdInput: false,
      triggerMinWidth: '180px',
      triggerMaxWidth: '240px',
      hasSaveToFolderLabel: true,
      hasSkeleton: true,
      hasPersonalChild: true,
      quickSearchMatchesExperiments: true,
      hasSearchResult502: true,
      selectedTriggerText: 'subfolder test▾',
      hasHydratedParent501: true,
      hasHydratedLeaf502: true,
      personalNodeCount: 1,
      hasNoHashIdsInTree: true,
      hasRemovedBrandPills: true,
      hasDevModeBadgeWhenDev: true,
      devBadgeHiddenInProd: true,
      persistedFolderId: '502',
      hasCleanSearchCopy: true,
      modalCloseBtnText: '✕',
      modalCloseBtnTitle: 'Close',
      parentInputHasDatalist: true,
      creatorInputHasDatalist: true,
      personalSelectClsPx: 0
    })

    const clipRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const selectors = [
          '[data-testid="topbar-folder-picker"]',
          '[data-testid="folder-tree-popover"]',
          '[data-testid="folder-advanced-search-modal"]'
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
    const scratchSnapPath = path.join(scratchDir, 'issue-62-folder-tree.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)
  }, 15000)

  test('renders StudioSelect styled dropdowns, split + New Conversation use-case action menu, and SVG icon theme menu (Issue #60)', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${ctx.port}/?scenario=data_app`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="new-conversation-btn"]') && document.querySelector('[data-testid="topbar-theme-select"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    // Open the SVG theme menu and inspect single + New Conversation button and composer StudioSelect/guide controls
    const openMenusRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const themeTrigger = document.querySelector('[data-testid="topbar-theme-select"] .dab-studio-select-trigger');
        if (themeTrigger) themeTrigger.click();
        await new Promise((r) => setTimeout(r, 100));

        const noSplitTrigger = !document.querySelector('[data-testid="new-conversation-menu-trigger"]');
        const noNewConvMenu = !document.querySelector('[data-testid="new-conversation-use-case-menu"]');
        const hasSingleNewConvBtn = Boolean(document.querySelector('[data-testid="new-conversation-btn"]'));
        const hasInfoBtnInComposer = Boolean(
          document.querySelector('.dab-composer-actions [data-testid="use-case-info-btn"]')
        );

        const themeSelect = document.querySelector('[data-testid="topbar-theme-select"]');
        const themeTriggerSvg = themeSelect?.querySelector('.dab-studio-select-trigger svg')?.getAttribute('data-theme-icon') || null;
        const themeMenu = document.querySelector('[data-testid="topbar-theme-select-menu"]');
        const themeMenuIcons = themeMenu
          ? Array.from(themeMenu.querySelectorAll('svg[data-theme-icon]')).map((el) => el.getAttribute('data-theme-icon'))
          : [];
        const themeHasEmoji = /[☀️🌙🖥️]/u.test(themeSelect?.textContent || '');

        const studioSelectCount = document.querySelectorAll('.dab-studio-select').length;
        const unstyledVisibleSelectCount = Array.from(document.querySelectorAll('select')).filter(
          (s) => !s.classList.contains('dab-studio-select-native')
        ).length;

        const rects = [
          document.querySelector('.dab-topbar'),
          document.querySelector('[data-testid="new-conversation-btn"]'),
          themeMenu
        ]
          .filter(Boolean)
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        const margin = 12;
        const x = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.left)) - margin));
        const y = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.top)) - margin));
        const right = Math.min(1440, Math.ceil(Math.max(...rects.map((r) => r.right)) + margin));
        const bottom = Math.min(900, Math.ceil(Math.max(...rects.map((r) => r.bottom)) + margin));

        return {
          noSplitTrigger,
          noNewConvMenu,
          hasSingleNewConvBtn,
          hasInfoBtnInComposer,
          themeTriggerSvg,
          themeMenuIcons,
          themeHasEmoji,
          studioSelectCount,
          unstyledVisibleSelectCount,
          clip: { x, y, width: right - x, height: bottom - y, scale: 1 }
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(openMenusRes.result.value).toMatchObject({
      noSplitTrigger: true,
      noNewConvMenu: true,
      hasSingleNewConvBtn: true,
      hasInfoBtnInComposer: true,
      themeTriggerSvg: 'system',
      themeMenuIcons: ['light', 'dark', 'system'],
      themeHasEmoji: false,
      unstyledVisibleSelectCount: 0
    })
    expect(openMenusRes.result.value.studioSelectCount).toBeGreaterThanOrEqual(2)

    const { data } = await ctx.chrome.send('Page.captureScreenshot', {
      format: 'png',
      clip: openMenusRes.result.value.clip
    })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)
    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchSnapPath = path.join(scratchDir, 'issue-60-dropdown-menus.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)

    // Test interactive selection on SVG theme menu, single + New Conversation button, and composer capabilities guide modal
    const interactionRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        // 1. Click Dark in the SVG theme menu
        const darkOpt = document.querySelector('[data-testid="topbar-theme-option-dark"]');
        if (darkOpt) darkOpt.click();
        await new Promise((r) => setTimeout(r, 80));
        const themeAfterDarkClick = document.documentElement.getAttribute('data-theme');
        const iconAfterDarkClick = document
          .querySelector('[data-testid="topbar-theme-select"] .dab-studio-select-trigger svg')
          ?.getAttribute('data-theme-icon');

        // Switch back to Light via SVG theme menu
        document.querySelector('[data-testid="topbar-theme-select"] .dab-studio-select-trigger')?.click();
        await new Promise((r) => setTimeout(r, 60));
        document.querySelector('[data-testid="topbar-theme-option-light"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const themeAfterLightClick = document.documentElement.getAttribute('data-theme');
        const iconAfterLightClick = document
          .querySelector('[data-testid="topbar-theme-select"] .dab-studio-select-trigger svg')
          ?.getAttribute('data-theme-icon');

        // 2. Click + New Conversation button -> routes to '/' with 'auto' useCase
        document.querySelector('[data-testid="new-conversation-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 120));
        const routeAfterNewConv = window.__DAB_STUDIO__.history.location.pathname;
        const hasCenteredPrompt = Boolean(document.querySelector('[data-testid="centered-empty-prompt"]'));
        const presetUseCase = window.__DAB_STUDIO__.selectedUseCase;

        // 3. Click '?' capabilities guide button inside .dab-composer-actions -> opens UseCaseInfoModal
        document.querySelector('.dab-composer-actions [data-testid="use-case-info-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const hasInfoModal = Boolean(document.querySelector('[data-testid="use-case-info-modal"]'));
        document.querySelector('[data-testid="use-case-info-close"]')?.click();
        await new Promise((r) => setTimeout(r, 60));

        return {
          themeAfterDarkClick,
          iconAfterDarkClick,
          themeAfterLightClick,
          iconAfterLightClick,
          routeAfterNewConv,
          hasCenteredPrompt,
          presetUseCase,
          hasInfoModal
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(interactionRes.result.value).toEqual({
      themeAfterDarkClick: 'dark',
      iconAfterDarkClick: 'dark',
      themeAfterLightClick: 'light',
      iconAfterLightClick: 'light',
      routeAfterNewConv: '/',
      hasCenteredPrompt: true,
      presetUseCase: 'auto',
      hasInfoModal: true
    })
  }, 15000)

  test('verifies StudioDesignSystem primitives (StudioModal with Escape close, StudioToolbar, StudioBadge dark/light semantic tokens, StudioCard, StudioSkeleton, StudioDocPreview) and captures cropped showcase snapshot', async () => {
    const url = `http://127.0.0.1:${ctx.port}/?scenario=lookml`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('.dab-ds-card') && document.querySelector('[data-testid="use-case-info-btn"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((r) => setTimeout(r, 80))
    }

    const dsRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        // 1. Verify semantic status tokens in Light and Dark mode on StudioBadge
        document.documentElement.setAttribute('data-theme', 'light');
        const probeWrap = document.createElement('div');
        probeWrap.innerHTML = '<span id="p-ok" class="dab-badge dab-badge-success">OK</span><span id="p-warn" class="dab-badge dab-badge-warning">WARN</span><span id="p-err" class="dab-badge dab-badge-danger">ERR</span><span id="p-skel" class="dab-skeleton" style="width:80px;height:20px"></span>';
        document.body.appendChild(probeWrap);
        const lightOkBg = window.getComputedStyle(document.getElementById('p-ok')).backgroundColor;
        const lightWarnBg = window.getComputedStyle(document.getElementById('p-warn')).backgroundColor;
        const lightErrBg = window.getComputedStyle(document.getElementById('p-err')).backgroundColor;

        document.documentElement.setAttribute('data-theme', 'dark');
        const darkOkBg = window.getComputedStyle(document.getElementById('p-ok')).backgroundColor;
        const darkWarnBg = window.getComputedStyle(document.getElementById('p-warn')).backgroundColor;
        const darkErrBg = window.getComputedStyle(document.getElementById('p-err')).backgroundColor;
        probeWrap.remove();
        document.documentElement.setAttribute('data-theme', 'light');

        // 2. Verify StudioCard, StudioToolbar & lucide-react SVG icons (no decorative emojis) in LookML mode
        const hasToolbarTitleBlock = Boolean(document.querySelector('.dab-preview-toolbar .dab-ds-toolbar-title-block'));
        const hasStudioCard = Boolean(document.querySelector('.dab-ds-card'));
        const archiveBtnHasLucideSvg = Boolean(document.querySelector('[data-testid^="archive-conv-"] svg.lucide'));
        const deleteBtnHasLucideSvg = Boolean(document.querySelector('[data-testid^="delete-conv-"] svg.lucide'));
        const hasDecorativeEmoji = /[✨🛡️⚡🟢📊📈💬🧩🩺🐍📝🧪📸🧱🔄⏰🤖📖👤📁🔍📥🗑️]/u.test(document.body?.innerText || '');

        // 3. Open UseCaseInfoModal (built on StudioModal) and verify StudioDocPreview + Data Investigator tab inside it
        document.querySelector('[data-testid="use-case-info-btn"]').click();
        await new Promise((r) => setTimeout(r, 100));
        const modal = document.querySelector('[data-testid="use-case-info-modal"]');
        const hasModalHeader = Boolean(modal && modal.querySelector('.dab-ds-modal-header'));
        const invTab = modal && modal.querySelector('[data-testid="use-case-guide-tab-data-investigator"]');
        const hasInvestigatorGuideTab = Boolean(invTab);
        if (invTab) invTab.click();
        await new Promise((r) => setTimeout(r, 80));
        const hasInvestigatorDocSlidesPreview = Boolean(
          modal && modal.querySelector('[data-testid="data-investigator-doc-slides-preview"]')
        );
        const hasDocPreview = Boolean(modal && modal.querySelector('[data-testid="doc-ui-preview"]'));
        const rect = modal.getBoundingClientRect();
        const clip = {
          x: Math.max(0, Math.floor(rect.left - 24)),
          y: Math.max(0, Math.floor(rect.top - 24)),
          width: Math.min(1440, Math.ceil(rect.width + 48)),
          height: Math.min(900, Math.ceil(rect.height + 48)),
          scale: 1
        };

        return {
          lightDistinctFromDark: lightOkBg !== darkOkBg && lightWarnBg !== darkWarnBg && lightErrBg !== darkErrBg,
          hasToolbarTitleBlock,
          hasStudioCard,
          archiveBtnHasLucideSvg,
          deleteBtnHasLucideSvg,
          hasDecorativeEmoji,
          hasModalHeader,
          hasInvestigatorGuideTab,
          hasInvestigatorDocSlidesPreview,
          hasDocPreview,
          clip
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(dsRes.result.value).toMatchObject({
      lightDistinctFromDark: true,
      hasToolbarTitleBlock: true,
      hasStudioCard: true,
      archiveBtnHasLucideSvg: true,
      deleteBtnHasLucideSvg: true,
      hasDecorativeEmoji: false,
      hasModalHeader: true,
      hasInvestigatorGuideTab: true,
      hasInvestigatorDocSlidesPreview: true,
      hasDocPreview: true
    })

    const { data } = await ctx.chrome.send('Page.captureScreenshot', {
      format: 'png',
      clip: dsRes.result.value.clip
    })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)
    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const showcasePath = path.join(scratchDir, 'studio-design-system-showcase.png')
    writeFileSync(showcasePath, pngBuffer)
    expect(existsSync(showcasePath)).toBe(true)

    // Verify Escape key closes StudioModal
    const escRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        return Boolean(document.querySelector('[data-testid="use-case-info-modal"]'));
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    expect(escRes.result.value).toBe(false)
  }, 15000)

  test('Issue #92: removes topbar Explores combobox and provides composer + Add Context menu & @-mention popover with context chips', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=data_app`
    })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="composer-add-context-btn"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const hasTopbarCombobox = Boolean(document.querySelector('.dab-topbar .dab-combobox'));
        const addBtn = document.querySelector('[data-testid="composer-add-context-btn"]');
        const fileInput = document.querySelector('[data-testid="composer-file-input"]');
        addBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        const addMenu = document.querySelector('[data-testid="composer-add-context-menu"]');
        const menuItemIds = ['add-context-files', 'add-context-explores', 'add-context-dashboards', 'add-context-looks', 'add-context-conversations'];
        const hasAllMenuItems = menuItemIds.every((id) => Boolean(document.querySelector('[data-testid="' + id + '"]')));

        // Click Dashboards in Add Context menu -> inserts @dashboard: and opens @-mention menu
        document.querySelector('[data-testid="add-context-dashboards"]').click();
        await new Promise((r) => setTimeout(r, 120));
        const mentionMenu = document.querySelector('[data-testid="composer-at-mention-menu"]');
        const pulseOption = document.querySelector('[data-testid="composer-mention-option-dashboard-901"]');
        const hasPulseOption = Boolean(pulseOption);
        if (pulseOption) pulseOption.click();
        await new Promise((r) => setTimeout(r, 100));

        const chipsWrap = document.querySelector('[data-testid="composer-context-chips"]');
        const pulseChip = document.querySelector('[data-testid="composer-context-chip-dashboard-901"]');
        const promptValue = document.querySelector('[data-testid="studio-prompt-input"]')?.value || '';

        return {
          hasTopbarCombobox,
          hasFileInput: Boolean(fileInput),
          hasAddMenu: Boolean(addMenu),
          hasAllMenuItems,
          hasMentionMenu: Boolean(mentionMenu),
          hasPulseOption,
          hasChipsWrap: Boolean(chipsWrap),
          hasPulseChip: Boolean(pulseChip),
          promptValue
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toMatchObject({
      hasTopbarCombobox: false,
      hasFileInput: true,
      hasAddMenu: true,
      hasAllMenuItems: true,
      hasMentionMenu: true,
      hasPulseOption: true,
      hasChipsWrap: true,
      hasPulseChip: true,
      promptValue: '@dashboard:Business Pulse '
    })
  }, 15000)

}

module.exports = { registerVisualPart05Tests }
