function registerVisualPart01Tests(ctx) {
  const { existsSync, mkdirSync, writeFileSync, path, imageSnapshotsDir, scenarios, startHeadlessChrome, writeSnapshotManifest } = ctx
  let testCount = 0
  test.each(scenarios)(
    'renders $id ($title) with MockLookerExtensionProvider and matches DOM & image snapshots',
    async ({ id, snapshotName, expectText, clipSelector, clipMargin = 24 }) => {
      testCount += 1
      if (testCount % 7 === 0) {
        ctx.chrome.close()
        ctx.chrome = await startHeadlessChrome()
      }
      const url = `http://127.0.0.1:${ctx.port}/?scenario=${encodeURIComponent(id)}`
      await ctx.chrome.send('Page.navigate', { url })

      let pageState = null
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const evalRes = await ctx.chrome.send('Runtime.evaluate', {
          expression: `(() => {
            const href = window.location.href;
            const text = document.body ? document.body.innerText : '';
            const tabs = Array.from(document.querySelectorAll('.dab-mode-tab')).map((el) => ({
              label: (el.textContent || '').trim(),
              active: el.classList.contains('active')
            }));
            const dd =
              document.querySelector('[data-testid="composer-at-mention-menu"]') ||
              document.querySelector('.dab-dropdown');
            if (dd && window.__MOCK_LOOKER_EXTENSION__ && typeof window.__MOCK_LOOKER_EXTENSION__.initialExploreScrollTop === 'number') {
              dd.scrollTop = window.__MOCK_LOOKER_EXTENSION__.initialExploreScrollTop;
            }
            return {
              href,
              text,
              tabs,
              dropdownScrollTop: dd ? dd.scrollTop : null
            };
          })()`,
          returnByValue: true
        })
        pageState = evalRes.result && evalRes.result.value
        if (
          pageState &&
          String(pageState.text || '').includes('pmhkaepabdniocnppdkfgifgonahhpdi')
        ) {
          ctx.chrome.close()
          ctx.chrome = await startHeadlessChrome()
          await ctx.chrome.send('Page.navigate', { url })
          await new Promise((r) => setTimeout(r, 250))
          continue
        }
        if (pageState && expectText.every((t) => pageState.text.includes(t))) {
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      for (const expected of expectText) {
        expect(pageState.text).toContain(expected)
      }

      // 1. Jest DOM/State snapshot stored in src/__tests__/__snapshots__/miniApps.visual.test.js.snap
      expect({
        scenario: id,
        modeTabs: pageState.tabs,
        dropdownScrollTop: pageState.dropdownScrollTop,
        verifiedVisibleText: expectText
      }).toMatchSnapshot()

      // 2. Visual PNG snapshot stored in src/__tests__/__image_snapshots__/<snapshotName>
      let clip
      if (clipSelector) {
        const selectors = [clipSelector].flat()
        const clipRes = await ctx.chrome.send('Runtime.evaluate', {
          expression: `(() => {
            const rects = ${JSON.stringify(selectors)}
              .flatMap((s) => Array.from(document.querySelectorAll(s)))
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.width > 0 && r.height > 0);
            if (!rects.length) return null;
            const x = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.left)) - ${clipMargin}));
            const y = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.top)) - ${clipMargin}));
            const right = Math.min(1440, Math.ceil(Math.max(...rects.map((r) => r.right)) + ${clipMargin}));
            const bottom = Math.min(900, Math.ceil(Math.max(...rects.map((r) => r.bottom)) + ${clipMargin}));
            return { x, y, width: right - x, height: bottom - y, scale: 1 };
          })()`,
          returnByValue: true
        })
        clip = clipRes.result?.value
        expect(clip).toBeTruthy()
      }

      const { data } = await ctx.chrome.send('Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip } : {})
      })
      const pngBuffer = Buffer.from(data, 'base64')
      expect(pngBuffer.length).toBeGreaterThan(1000)

      const width = pngBuffer.readUInt32BE(16)
      const height = pngBuffer.readUInt32BE(20)
      expect(width).toBe(clip ? clip.width : 1440)
      expect(height).toBe(clip ? clip.height : 900)

      const snapshotPath = path.join(imageSnapshotsDir, snapshotName)
      writeFileSync(snapshotPath, pngBuffer)
      expect(existsSync(snapshotPath)).toBe(true)
    },
    15000
  )

  test('records cropped component dimensions and clipSelector metadata in manifest.json', () => {
    const manifest = writeSnapshotManifest()
    for (const { id, clipSelector } of scenarios.filter((s) => s.clipSelector)) {
      const entry = manifest.find((m) => m.id === id)
      expect(entry).toMatchObject({ clipSelector, clipMargin: 24 })
      expect(entry.width).toBeGreaterThan(100)
      expect(entry.height).toBeGreaterThan(80)
      expect(entry.width).toBeLessThan(1440)
      expect(entry.height).toBeLessThan(900)
    }
    const fullPageEntry = manifest.find((m) => m.id === 'data_app')
    expect(fullPageEntry).toMatchObject({ width: 1440, height: 900 })
    expect(fullPageEntry.clipSelector).toBeUndefined()
  })

  test('enables/disables individual tool modes via /config and filters use-case-selector options, catalog & routes', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${ctx.port}/?scenario=config_page`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="config-mode-toggle-lookml"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    // Disable LookML, Health Check, and Python Tile, then click Save Setup
    const afterSave = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        for (const m of ['lookml', 'health', 'tile']) {
          const cb = document.querySelector('[data-testid="config-mode-toggle-' + m + '"]');
          if (cb) cb.click();
        }
        await new Promise((r) => setTimeout(r, 50));
        const saveBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          (b.textContent || '').includes('Save Setup')
        );
        if (saveBtn) saveBtn.click();
        await new Promise((r) => setTimeout(r, 150));
        const useCaseOptionsAfterSave = (window.__DAB_STUDIO__.useCaseOptions || []).map((o) => o.value);
        const text = document.body ? document.body.innerText : '';
        // Navigate to disabled route /lookml/20261030_dev_branch and verify redirect back to '/'
        window.__DAB_STUDIO__.history.push('/lookml/20261030_dev_branch');
        await new Promise((r) => setTimeout(r, 120));
        const routeAfterDisabledPush = window.__DAB_STUDIO__.history.location.pathname;
        const noTopbarModeSwitcher = !document.querySelector('.dab-mode-switcher');
        return {
          savedDisabledModes: window.__LAST_SAVED_CONTEXT_DATA__?.disabledModes || [],
          useCaseOptionsAfterSave,
          hasFilteredCatalogCount: text.includes('Conversations (2)') && !document.querySelector('.dab-catalog-bar'),
          routeAfterDisabledPush,
          noTopbarModeSwitcher
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(afterSave.result.value).toEqual({
      savedDisabledModes: ['lookml', 'health', 'tile'],
      useCaseOptionsAfterSave: [
        'auto',
        'dashboard',
        'conversational-analytics',
        'app',
        'data-investigator'
      ],
      hasFilteredCatalogCount: true,
      routeAfterDisabledPush: '/',
      noTopbarModeSwitcher: true
    })
  }, 15000)

  test('switches Antigravity models via config-default-model-select and composer-model-select in composer footer and persists defaultModel (Issue #59)', async () => {
    const url = `http://127.0.0.1:${ctx.port}/?scenario=config_page`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="config-default-model-select"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const configSelect = document.querySelector('[data-testid="config-default-model-select"]');
        const initialDefault = configSelect ? configSelect.value : '';
        const optionIds = configSelect ? Array.from(configSelect.options).map((o) => o.value) : [];

        const thinkingSelect = document.querySelector('[data-testid="config-default-thinking-level-select"]');
        const initialThinkingDefault = thinkingSelect ? thinkingSelect.value : '';
        const thinkingOptionIds = thinkingSelect ? Array.from(thinkingSelect.options).map((o) => o.value) : [];

        const maxTokensSelect = document.querySelector('[data-testid="config-max-total-tokens-select"]');
        const initialMaxTokensDefault = maxTokensSelect ? maxTokensSelect.value : '';
        const maxTokensOptionIds = maxTokensSelect ? Array.from(maxTokensSelect.options).map((o) => o.value) : [];

        const setReactSelect = (sel, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, val);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setReactSelect(configSelect, 'gemini-4-argon');
        setReactSelect(maxTokensSelect, '262144');
        await new Promise((r) => setTimeout(r, 50));

        const saveBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          (b.textContent || '').includes('Save Setup')
        );
        if (saveBtn) saveBtn.click();
        await new Promise((r) => setTimeout(r, 150));

        const noTopbarModelSelect = !document.querySelector('.dab-topbar [data-testid="topbar-model-select"]');
        const noComposerInspector = !document.querySelector('.dab-composer-actions .dab-inspector');
        const composerSelect = document.querySelector('.dab-composer-actions [data-testid="composer-model-select"]');
        const syncedComposerModel = composerSelect ? composerSelect.value : '';

        setReactSelect(composerSelect, 'gemini-3.5-flash-lite');
        await new Promise((r) => setTimeout(r, 50));
        const afterLiteSwitch = composerSelect ? composerSelect.value : '';

        setReactSelect(composerSelect, 'gemini-3.8-flash');
        await new Promise((r) => setTimeout(r, 50));
        const afterFlashSwitch = composerSelect ? composerSelect.value : '';

        const triggerBtn = document.querySelector('[data-testid="composer-model-select-trigger"]');
        const beforeTriggerRect = triggerBtn ? triggerBtn.getBoundingClientRect() : null;
        if (triggerBtn) triggerBtn.click();
        await new Promise((r) => setTimeout(r, 60));

        const menuOptionOrder = Array.from(
          document.querySelectorAll('[data-testid="composer-model-select-menu"] > .dab-studio-menu-item-row > [role="option"]')
        ).map((el) => el.getAttribute('data-value'));
        const argonOption = document.querySelector('[data-testid="composer-model-select-option-gemini-4-argon"]');
        const argonRowSubLabel = (argonOption?.querySelector('.dab-studio-menu-sublabel')?.textContent || '').trim();
        if (argonOption) {
          argonOption.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        }
        await new Promise((r) => setTimeout(r, 60));

        const flyoutMenu = document.querySelector('[data-testid="composer-thinking-level-menu"]');
        const flyoutOptionIds = Array.from(flyoutMenu?.querySelectorAll('[role="menuitemradio"]') || []).map((el) =>
          el.getAttribute('data-testid')
        );
        const mediumOption = document.querySelector('[data-testid="thinking-level-option-medium"]');
        const mediumInitiallyChecked = mediumOption?.getAttribute('aria-checked') === 'true';

        const menuEl = document.querySelector('[data-testid="composer-model-select-menu"]');
        const menuRect = menuEl ? menuEl.getBoundingClientRect() : null;
        const flyoutRect = flyoutMenu ? flyoutMenu.getBoundingClientRect() : null;
        const unionClip = menuRect && flyoutRect ? {
          x: Math.max(0, Math.floor(Math.min(menuRect.left, flyoutRect.left) - 24)),
          y: Math.max(0, Math.floor(Math.min(menuRect.top, flyoutRect.top) - 24)),
          width: Math.min(1440, Math.ceil(Math.max(menuRect.right, flyoutRect.right) - Math.min(menuRect.left, flyoutRect.left) + 48)),
          height: Math.min(900, Math.ceil(Math.max(menuRect.bottom, flyoutRect.bottom) - Math.min(menuRect.top, flyoutRect.top) + 48)),
          scale: 1
        } : null;

        const highOption = document.querySelector('[data-testid="thinking-level-option-high"]');
        if (highOption) highOption.click();
        await new Promise((r) => setTimeout(r, 60));

        const afterHighModel = composerSelect ? composerSelect.value : '';
        const afterHighThinkingLevel = window.__DAB_STUDIO__?.thinkingLevel;
        const afterTriggerRect = triggerBtn ? triggerBtn.getBoundingClientRect() : null;
        const noTriggerHeightShift =
          beforeTriggerRect && afterTriggerRect
            ? Math.abs(beforeTriggerRect.height - afterTriggerRect.height) <= 1
            : false;

        return {
          initialDefault,
          optionIds,
          initialThinkingDefault,
          thinkingOptionIds,
          initialMaxTokensDefault,
          maxTokensOptionIds,
          savedDefaultModel: window.__LAST_SAVED_CONTEXT_DATA__?.defaultModel,
          savedDefaultThinkingLevel: window.__LAST_SAVED_CONTEXT_DATA__?.defaultThinkingLevel,
          savedMaxTotalTokens: window.__LAST_SAVED_CONTEXT_DATA__?.maxTotalTokens,
          noTopbarModelSelect,
          noComposerInspector,
          syncedComposerModel,
          afterLiteSwitch,
          afterFlashSwitch,
          menuOptionOrder,
          argonRowSubLabel,
          flyoutOptionIds,
          mediumInitiallyChecked,
          afterHighModel,
          afterHighThinkingLevel,
          noTriggerHeightShift,
          unionClip
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    const { unionClip, ...modelSelectResult } = res.result.value
    expect(modelSelectResult).toEqual({
      initialDefault: 'gemini-3.8-flash',
      optionIds: [
        'gemini-4-argon',
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite'
      ],
      initialThinkingDefault: 'high',
      thinkingOptionIds: ['low', 'medium', 'high'],
      initialMaxTokensDefault: '131072',
      maxTokensOptionIds: ['32768', '65536', '131072', '262144'],
      savedDefaultModel: 'gemini-4-argon',
      savedDefaultThinkingLevel: 'high',
      savedMaxTotalTokens: 262144,
      noTopbarModelSelect: true,
      noComposerInspector: true,
      syncedComposerModel: 'gemini-4-argon',
      afterLiteSwitch: 'gemini-3.5-flash-lite',
      afterFlashSwitch: 'gemini-3.8-flash',
      menuOptionOrder: [
        'gemini-4-argon',
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite'
      ],
      argonRowSubLabel: 'High',
      flyoutOptionIds: [
        'thinking-level-option-low',
        'thinking-level-option-medium',
        'thinking-level-option-high'
      ],
      mediumInitiallyChecked: false,
      afterHighModel: 'gemini-4-argon',
      afterHighThinkingLevel: 'high',
      noTriggerHeightShift: true
    })
    expect(unionClip).toBeTruthy()
    const { data: flyoutPngData } = await ctx.chrome.send('Page.captureScreenshot', {
      format: 'png',
      clip: unionClip
    })
    expect(Buffer.from(flyoutPngData, 'base64').length).toBeGreaterThan(500)
  }, 15000)

  test('auto-labels conversation after Turn 1 via stateless side-request (no previous_interaction_id, tools=[]) and updates user_conversations:1 + sidebar UI', async () => {
    const url = `http://127.0.0.1:${ctx.port}/?scenario=dashboard`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('textarea'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const turn1Res = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__INTERACTION_CALLS__ = [];
        window.__ARTIFACT_UPDATES__ = [];
        window.__DAB_STUDIO__.setAuthMode('apikey');
        window.__DAB_STUDIO__.setApiKey('mock-api-key');
        const newBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        if (newBtn) newBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        window.__DAB_STUDIO__.setSelectedUseCase('dashboard');
        await new Promise((r) => setTimeout(r, 50));

        const ta = document.querySelector('.dab-composer textarea');
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        taSetter.call(ta, 'Build a quarterly order margin dashboard on order_items');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const sendBtn = document.querySelector('.dab-composer .dab-btn-gemini');
        if (sendBtn) sendBtn.click();

        const waitUntil = Date.now() + 5000;
        while (Date.now() < waitUntil) {
          const bodyText = document.body ? document.body.innerText : '';
          if (bodyText.includes('Quarterly Order Margin Analysis')) break;
          await new Promise((r) => setTimeout(r, 80));
        }

        const labelCall = (window.__INTERACTION_CALLS__ || []).find((c) =>
          ((c.body && c.body.input && c.body.input[0] && c.body.input[0].text) || '').includes('[CONVERSATION_LABEL_REQUEST]')
        );
        const convUpdates = (window.__ARTIFACT_UPDATES__ || []).filter((u) => u.key === 'user_conversations:1');
        const latestConvList = convUpdates.length > 0 ? JSON.parse(convUpdates[convUpdates.length - 1].value) : [];
        const bodyText = document.body ? document.body.innerText : '';
        const sidebarEl = document.querySelector('[data-testid="conversations-sidebar"]');

        return {
          hasLabelCall: Boolean(labelCall),
          labelCallTools: labelCall ? labelCall.body.tools : null,
          labelCallHasPrevId: labelCall ? ('previous_interaction_id' in labelCall.body) : null,
          savedConvLabel: latestConvList[0] ? latestConvList[0].label : null,
          routeIsImmutableConv: window.__DAB_STUDIO__.history.location.pathname.startsWith('/c/conv_'),
          sidebarShowsGeneratedLabel:
            !document.querySelector('.dab-catalog-bar') &&
            Boolean(sidebarEl && (sidebarEl.innerText || '').includes('Quarterly Order Margin Analysis'))
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(turn1Res.result.value).toEqual({
      hasLabelCall: true,
      labelCallTools: [],
      labelCallHasPrevId: false,
      savedConvLabel: 'Quarterly Order Margin Analysis',
      routeIsImmutableConv: true,
      sidebarShowsGeneratedLabel: true
    })
  }, 15000)

  test('renders collapsible left conversations sidebar, switches to centered empty-state prompt on + New Conversation, and restores conversation state on /c/:conversationId click', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${ctx.port}/?scenario=data_app`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const step1 = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const sidebar = document.querySelector('[data-testid="conversations-sidebar"]');
        const toggleBtn = document.querySelector('[data-testid="sidebar-collapse-toggle"]');
        const newBtn = document.querySelector('[data-testid="new-conversation-btn"]');
        const initialItems = Array.from(document.querySelectorAll('.dab-conv-item-label')).map((el) =>
          (el.textContent || '').trim()
        );

        // Collapse and expand sidebar
        toggleBtn.click();
        await new Promise((r) => setTimeout(r, 60));
        const collapsedState = sidebar.classList.contains('collapsed');
        toggleBtn.click();
        await new Promise((r) => setTimeout(r, 60));
        const expandedState = !sidebar.classList.contains('collapsed');

        // Click + New Conversation -> should route to '/' and show centered empty-state prompt box
        newBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        const centeredStage = document.querySelector('[data-testid="centered-empty-prompt"]');
        const promptCard = document.querySelector('.dab-empty-prompt-card');
        const rect = promptCard ? promptCard.getBoundingClientRect() : null;
        return {
          initialItems,
          collapsedState,
          expandedState,
          routeOnNew: window.__DAB_STUDIO__.history.location.pathname,
          hasCenteredStage: Boolean(centeredStage),
          centeredHeroText: centeredStage ? centeredStage.innerText : '',
          cardCenteredHorizontally: rect ? rect.left > 240 && rect.right < 1400 : false,
          cardCenteredVertically: rect ? rect.top > 80 && rect.bottom < 860 : false
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(step1.result.value.initialItems).toEqual([
      'Executive Revenue App',
      'Executive Order Performance (Native UDD)',
      'Add total_revenue & gross_margin to order_items',
      '3-Pillar Health Check — thelook_event (70%)',
      'Looker Explore & Filter Summary'
    ])
    expect(step1.result.value.collapsedState).toBe(true)
    expect(step1.result.value.expandedState).toBe(true)
    expect(step1.result.value.routeOnNew).toBe('/')
    expect(step1.result.value.hasCenteredStage).toBe(true)
    expect(step1.result.value.centeredHeroText).not.toContain('New Conversation')
    expect(step1.result.value.centeredHeroText).toContain('Ripper is ready')
    expect(step1.result.value.cardCenteredHorizontally).toBe(true)
    expect(step1.result.value.cardCenteredVertically).toBe(true)

    // Save prototype screenshot of sidebar + centered empty-state prompt box
    const { data } = await ctx.chrome.send('Page.captureScreenshot', { format: 'png' })
    const pngBuffer = Buffer.from(data, 'base64')
    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchScreenshot = path.join(scratchDir, 'issue-24-sidebar-and-centered-prompt.png')
    writeFileSync(scratchScreenshot, pngBuffer)
    expect(existsSync(scratchScreenshot)).toBe(true)
    const issue47Screenshot = path.join(scratchDir, 'issue-47-unified-routing.png')
    writeFileSync(issue47Screenshot, pngBuffer)
    expect(existsSync(issue47Screenshot)).toBe(true)

    // Click previous conversation (conv_dashboard_7) -> routes to /c/7, restores chat & preview without topbar use-case badge
    const step2 = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const item = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        if (item) item.click();
        await new Promise((r) => setTimeout(r, 200));
        const noTopbarBadge = !document.querySelector('[data-testid="topbar-use-case-badge"]');
        const selectedUseCaseAfterSelect = window.__DAB_STUDIO__.selectedUseCase;
        const routeAfterSelect = window.__DAB_STUDIO__.history.location.pathname;
        const centeredGone = !document.querySelector('[data-testid="centered-empty-prompt"]');
        const bodyText = document.body ? document.body.innerText : '';

        // Also test legacy route redirect (/lookml/20261030_dev_branch -> /c/20261030_dev_branch)
        window.__DAB_STUDIO__.history.push('/lookml/20261030_dev_branch');
        await new Promise((r) => setTimeout(r, 150));
        const redirectedLegacyRoute = window.__DAB_STUDIO__.history.location.pathname;
        const lookmlUseCase = window.__DAB_STUDIO__.selectedUseCase;

        return {
          noTopbarBadge,
          selectedUseCaseAfterSelect,
          routeAfterSelect,
          centeredGone,
          restoredChatMsg: bodyText.includes('Created native Looker Dashboard #7'),
          restoredPreview: bodyText.includes('/embed/dashboards/7'),
          redirectedLegacyRoute,
          lookmlUseCase
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(step2.result.value).toEqual({
      noTopbarBadge: true,
      selectedUseCaseAfterSelect: 'dashboard',
      routeAfterSelect: '/c/conv_dashboard_7',
      centeredGone: true,
      restoredChatMsg: true,
      restoredPreview: true,
      redirectedLegacyRoute: '/c/20261030_dev_branch',
      lookmlUseCase: 'lookml'
    })
  }, 15000)

}

module.exports = { registerVisualPart01Tests }
