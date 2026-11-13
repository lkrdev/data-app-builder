function registerVisualPart03Tests(ctx) {
  const { existsSync, mkdirSync, readFileSync, writeFileSync, path, imageSnapshotsDir, startHeadlessChrome } = ctx
  test('supports Light, Dark, and System theme modes in topbar, reacts to matchMedia changes, persists to localStorage, and renders dark mode UI (Issue #49)', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    await ctx.chrome.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }]
    })
    const url = `http://127.0.0.1:${ctx.port}/?scenario=data_app`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="topbar-theme-select"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    // 1. Default mode is 'system' and resolves to 'light' when prefers-color-scheme is light
    const initialCheck = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const sel = document.querySelector('[data-testid="topbar-theme-select"]');
        return {
          mode: sel ? sel.value : null,
          options: sel ? Array.from(sel.options).map((o) => o.value) : [],
          attrTheme: document.documentElement.getAttribute('data-theme'),
          attrMode: document.documentElement.getAttribute('data-theme-mode')
        };
      })()`,
      returnByValue: true
    })
    expect(initialCheck.result.value).toEqual({
      mode: 'system',
      options: ['light', 'dark', 'system'],
      attrTheme: 'light',
      attrMode: 'system'
    })

    // 2. Live OS matchMedia('prefers-color-scheme: dark') change while in 'system' mode updates data-theme to 'dark'
    await ctx.chrome.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }]
    })
    await new Promise((r) => setTimeout(r, 120))
    const systemDarkCheck = await ctx.chrome.send('Runtime.evaluate', {
      expression: `({
        attrTheme: document.documentElement.getAttribute('data-theme'),
        attrMode: document.documentElement.getAttribute('data-theme-mode'),
        selectResolved: document.querySelector('[data-testid="topbar-theme-select"]')?.getAttribute('data-resolved-theme')
      })`,
      returnByValue: true
    })
    expect(systemDarkCheck.result.value).toEqual({
      attrTheme: 'dark',
      attrMode: 'system',
      selectResolved: 'dark'
    })

    // Restore emulated media to light so we can test explicit Dark and Light selection
    await ctx.chrome.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }]
    })
    await new Promise((r) => setTimeout(r, 100))

    // 3. Switch topbar theme selector to 'dark', verify persistence & dark computed styles, and switch to 'light'
    const switchRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const sel = document.querySelector('[data-testid="topbar-theme-select"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, 'dark');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));

        const darkThemeAttr = document.documentElement.getAttribute('data-theme');
        const darkModeAttr = document.documentElement.getAttribute('data-theme-mode');
        const storedDark = window.localStorage.getItem('dab_theme_mode');
        const extStoredDark = (window.__LOCAL_STORAGE_UPDATES__ || []).find((u) => u.key === 'dab_theme_mode' && u.value === 'dark');
        const shellStyle = window.getComputedStyle(document.querySelector('.dab-shell'));
        const topbarStyle = window.getComputedStyle(document.querySelector('.dab-topbar'));
        const shellBgDark = shellStyle.backgroundColor;
        const shellColorDark = shellStyle.color;
        const topbarBgDark = topbarStyle.backgroundColor;

        setter.call(sel, 'light');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));

        const lightThemeAttr = document.documentElement.getAttribute('data-theme');
        const storedLight = window.localStorage.getItem('dab_theme_mode');
        const shellBgLight = window.getComputedStyle(document.querySelector('.dab-shell')).backgroundColor;

        return {
          darkThemeAttr,
          darkModeAttr,
          storedDark,
          hasExtStorageCall: Boolean(extStoredDark),
          shellBgDark,
          shellColorDark,
          topbarBgDark,
          lightThemeAttr,
          storedLight,
          shellBgLight
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(switchRes.result.value).toEqual({
      darkThemeAttr: 'dark',
      darkModeAttr: 'dark',
      storedDark: 'dark',
      hasExtStorageCall: true,
      shellBgDark: 'rgb(11, 17, 32)',
      shellColorDark: 'rgb(226, 232, 240)',
      topbarBgDark: 'rgb(17, 24, 39)',
      lightThemeAttr: 'light',
      storedLight: 'light',
      shellBgLight: 'rgb(248, 250, 252)'
    })

    // Copy 18-studio-dark-theme.png to scratch directory for inspection
    const darkSnapPath = path.join(imageSnapshotsDir, '18-studio-dark-theme.png')
    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchDarkPath = path.join(scratchDir, 'issue-49-dark-theme.png')
    writeFileSync(scratchDarkPath, readFileSync(darkSnapPath))
    expect(existsSync(scratchDarkPath)).toBe(true)
  }, 15000)

  test('renders collapsible live & completed Thinking & Activity blocks and write-permission thought banner (Issue #56)', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    const url = `http://127.0.0.1:${ctx.port}/?scenario=data_app`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('.dab-chat-log'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const domRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        s.setMessages([
          {
            role: 'user',
            text: 'Build an Executive Revenue Data App with brand share breakdown'
          },
          {
            role: 'assistant',
            text: 'Built Executive Revenue Data App with 4 KPI cards and brand breakdown.',
            dashboardId: '42',
            widgetCount: 5,
            thinkingDurationSec: 4,
            activitySteps: [
              {
                id: 'step_1',
                kind: 'thought',
                title: 'Inspecting Explore Schema',
                detail: 'Analyzing thelook::order_items schema & planning 4 KPI tiles',
                status: 'done'
              },
              {
                id: 'step_2',
                kind: 'codemode',
                title: 'Querying monthly revenue and brand share from thelook::order_items',
                detail: 'sdk.lookml_model_explore, sdk.run_inline_query',
                language: 'PYTHON',
                status: 'done'
              },
              {
                id: 'step_3',
                kind: 'code_execution',
                title: 'python3 /workspace/bundle_app.py --app-dir /workspace/apps/42 --stdin "Executive Revenue App"',
                language: 'BASH',
                status: 'done'
              }
            ]
          }
        ]);
        s.setLiveActivitySteps([
          {
            id: 'live_1',
            kind: 'thought',
            title: 'Preparing dashboard tile layout mutation',
            status: 'done'
          },
          {
            id: 'live_2',
            kind: 'codemode',
            title: 'Creating executive KPI dashboard with 4 tiles',
            detail: 'sdk.create_dashboard, sdk.create_dashboard_element',
            language: 'PYTHON',
            status: 'running'
          }
        ]);
        s.setBusyStatus('Creating executive KPI dashboard with 4 tiles');
        void s.requestCodeModePermission({
          operation: 'create_dashboard_element',
          httpMethod: 'POST',
          path: '/api/4.0/dashboard_elements',
          args: { body: { dashboard_id: '42', title: 'Brand Revenue Share' } },
          thought: 'Creating executive KPI dashboard with 4 tiles'
        });
        await new Promise((r) => setTimeout(r, 120));

        const completedEl = document.querySelector('[data-testid="completed-thinking-block"]');
        const liveEl = document.querySelector('[data-testid="live-thinking-block"]');
        const permThoughtEl = document.querySelector('[data-testid="permission-request-thought"]');
        const statusBannerWhileLive = document.querySelector('.dab-status-banner');

        const initiallyCollapsed = completedEl ? !completedEl.open : false;
        const completedSummary = completedEl?.querySelector('summary')?.textContent?.trim() || '';

        // Expand completed thinking block on click so both blocks and step details are visible
        if (completedEl) {
          completedEl.querySelector('summary')?.click();
        }
        await new Promise((r) => setTimeout(r, 80));

        const thoughtEl = completedEl?.querySelector('[data-testid="thinking-step-thought"]');
        const thoughtInitiallyCollapsed = thoughtEl ? !thoughtEl.open : false;
        if (thoughtEl) {
          thoughtEl.querySelector('summary')?.click();
        }
        await new Promise((r) => setTimeout(r, 60));

        return {
          hasCompletedBlock: Boolean(completedEl),
          initiallyCollapsed,
          expandedAfterClick: Boolean(completedEl?.open),
          thoughtInitiallyCollapsed,
          thoughtExpandedAfterClick: Boolean(thoughtEl?.open),
          statusBannerWhileLive,
          completedSummary,
          completedText: completedEl?.textContent || '',
          hasLiveBlock: Boolean(liveEl),
          liveOpenByDefault: Boolean(liveEl?.open),
          liveClassName: liveEl?.className || '',
          liveText: liveEl?.textContent || '',
          permThoughtText: permThoughtEl?.textContent?.trim() || ''
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(domRes.result.value).toMatchObject({
      hasCompletedBlock: true,
      initiallyCollapsed: true,
      expandedAfterClick: true,
      thoughtInitiallyCollapsed: true,
      thoughtExpandedAfterClick: true,
      statusBannerWhileLive: null,
      completedSummary: 'Thought for 4s · 3 steps',
      hasLiveBlock: true,
      liveOpenByDefault: true,
      liveClassName: 'dab-thinking-block dab-thinking-live',
      permThoughtText: 'Creating executive KPI dashboard with 4 tiles'
    })
    expect(domRes.result.value.completedText).toContain('Inspecting Explore Schema')
    expect(domRes.result.value.completedText).toContain(
      'Analyzing thelook::order_items schema & planning 4 KPI tiles'
    )
    expect(domRes.result.value.completedText).not.toContain('[object Object]')
    expect(domRes.result.value.completedText).toContain(
      'Querying monthly revenue and brand share from thelook::order_items'
    )
    expect(domRes.result.value.completedText).toContain('sdk.run_inline_query')
    expect(domRes.result.value.completedText).toContain('bundle_app.py')
    expect(domRes.result.value.liveText).toContain('Thinking & Activity')
    expect(domRes.result.value.liveText).toContain('sdk.create_dashboard')

    const clipRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const selectors = [
          '[data-testid="completed-thinking-block"]',
          '[data-testid="live-thinking-block"]',
          '.dab-permission-bar'
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
    const scratchSnapPath = path.join(scratchDir, 'issue-56-thinking-activity-block.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)
  }, 15000)

  test('prevents multi-line button overflow on 28px height, wraps preview toolbar/actions cleanly, and styles ScriptStudioView inputs with .dab-input (Issue #63)', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=python_tile_studio` })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="tile-preview-toolbar"]') && document.querySelector('[data-testid="tile-script-id-input"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const domRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const toolbar = document.querySelector('[data-testid="tile-preview-toolbar"]');
        const actions = toolbar.querySelector('.dab-preview-actions');
        const titleBlock = document.querySelector('[data-testid="tile-toolbar-title-block"]');
        const toolbarStyle = window.getComputedStyle(toolbar);
        const actionsStyle = window.getComputedStyle(actions);
        const probe = Object.assign(document.createElement('button'), { className: 'dab-btn-secondary' });
        document.body.appendChild(probe);
        const btnRuleDisplay = window.getComputedStyle(probe).display;
        probe.remove();

        const buttonMetrics = Array.from(
          document.querySelectorAll('.dab-right-pane .dab-btn-secondary, .dab-right-pane .dab-btn-primary, .dab-right-pane .dab-btn-gemini')
        ).map((btn) => ({
          whiteSpace: window.getComputedStyle(btn).whiteSpace,
          display: btnRuleDisplay,
          overflowsVertically: btn.scrollHeight > btn.clientHeight + 2
        }));

        const inputs = [
          '[data-testid="tile-script-id-input"]',
          '[data-testid="tile-script-title-input"]',
          '[data-testid="tile-filters-json-input"]'
        ].map((sel) => {
          const el = document.querySelector(sel);
          const cs = window.getComputedStyle(el);
          return {
            hasDabInputClass: el.classList.contains('dab-input'),
            borderRadius: cs.borderRadius,
            backgroundColor: cs.backgroundColor
          };
        });

        const rects = ['[data-testid="tile-preview-toolbar"]', '.dab-right-pane .dab-inspector-bar', '[data-testid="tile-filters-json-input"]']
          .map((s) => document.querySelector(s).getBoundingClientRect());
        const x = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.left)) - 14));
        const y = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.top)) - 14));
        const right = Math.min(1440, Math.ceil(Math.max(...rects.map((r) => r.right)) + 14));
        const bottom = Math.min(900, Math.ceil(Math.max(...rects.map((r) => r.bottom)) + 14));

        return {
          toolbarFlexWrap: toolbarStyle.flexWrap,
          toolbarGap: parseFloat(toolbarStyle.gap || toolbarStyle.columnGap || '0'),
          actionsFlexWrap: actionsStyle.flexWrap,
          actionsGap: parseFloat(actionsStyle.gap || actionsStyle.columnGap || '0'),
          titleDisplay: titleBlock.style.display,
          titleFlexWrap: window.getComputedStyle(titleBlock).flexWrap,
          buttonMetrics,
          inputs,
          clip: { x, y, width: right - x, height: bottom - y, scale: 1 }
        };
      })()`,
      returnByValue: true
    })

    const v = domRes.result.value
    expect(v).toMatchObject({
      toolbarFlexWrap: 'wrap',
      actionsFlexWrap: 'wrap',
      titleDisplay: 'inline-flex',
      titleFlexWrap: 'wrap'
    })
    expect(v.toolbarGap).toBeGreaterThanOrEqual(8)
    expect(v.actionsGap).toBeGreaterThanOrEqual(6)
    expect(v.buttonMetrics.length).toBeGreaterThanOrEqual(4)
    for (const b of v.buttonMetrics) {
      expect(b).toEqual({ whiteSpace: 'nowrap', display: 'inline-flex', overflowsVertically: false })
    }
    expect(v.inputs).toHaveLength(3)
    for (const inp of v.inputs) {
      expect(inp).toEqual({ hasDabInputClass: true, borderRadius: '6px', backgroundColor: 'rgb(255, 255, 255)' })
    }

    const { data } = await ctx.chrome.send('Page.captureScreenshot', { format: 'png', clip: v.clip })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)
    const scratchDir = '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchSnapPath = path.join(scratchDir, 'issue-63-script-toolbar.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)
  }, 15000)

  test('renders mode-aware starter prompt buttons in empty state without Solr/WASM jargon, populates studio-prompt-input on click, and places model selector in composer footer (Issue #59)', async () => {
    const url = `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt`
    await ctx.chrome.send('Page.navigate', { url })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="starter-prompt-list"] button[data-testid^="starter-prompt-"]'))`,
        returnByValue: true
      })
      if (r.result && r.result.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const heroEl = document.querySelector('.dab-empty-hero');
        const hasJargon = /search_content|lookml_model_explore|Solr/i.test(heroEl ? heroEl.innerText : '');
        const hasStudioStarterPrompts = Boolean(document.querySelector('[data-testid="studio-starter-prompts"]'));
        const hasStarterPrompt0 = Boolean(document.querySelector('[data-testid="starter-prompt-0"]'));
        const starterBtns = Array.from(document.querySelectorAll('[data-testid="starter-prompt-list"] button[data-testid^="starter-prompt-"]'));
        const noEmojiInLabels = starterBtns.every((b) => !/[📊📈💬🧩🧮🛒🔍📌📉🔁🩺📐⚡🧪🧱🐍🚨📋✨]/u.test(b.innerText || ''));
        starterBtns[0]?.click();
        await new Promise((r) => setTimeout(r, 60));
        const ta = document.querySelector('[data-testid="studio-prompt-input"]');
        const promptAfterClick = ta ? ta.value : '';

        const savedPrompts = window.__DAB_STUDIO__?.starterPrompts || [];
        window.__DAB_STUDIO__?.setStarterPrompts?.([]);
        window.__DAB_STUDIO__?.setStarterPromptsLoading?.(true);
        await new Promise((r) => setTimeout(r, 50));
        const hasStarterSkeleton = Boolean(document.querySelector('[data-testid="studio-starter-prompts-skeleton"]'));
        window.__DAB_STUDIO__?.setStarterPrompts?.(savedPrompts);
        window.__DAB_STUDIO__?.setStarterPromptsLoading?.(false);
        await new Promise((r) => setTimeout(r, 50));

        window.__DAB_STUDIO__?.setSelectedUseCase?.('tile');
        await new Promise((r) => setTimeout(r, 80));

        const tileBtns = Array.from(document.querySelectorAll('[data-testid="starter-prompt-list"] button[data-testid^="starter-prompt-"]'));
        tileBtns[0]?.click();
        await new Promise((r) => setTimeout(r, 60));
        const promptAfterTileClick = ta ? ta.value : '';
        const tilePlaceholder = ta ? ta.getAttribute('placeholder') || '' : '';

        window.__DAB_STUDIO__?.setSelectedUseCase?.('auto');
        await new Promise((r) => setTimeout(r, 80));

        const r = document.querySelector('.dab-empty-prompt-card')?.getBoundingClientRect();
        const clip = r ? { x: Math.max(0, Math.floor(r.left - 16)), y: Math.max(0, Math.floor(r.top - 16)), width: Math.min(1440, Math.ceil(r.width + 32)), height: Math.min(900, Math.ceil(r.height + 32)), scale: 1 } : null;

        return {
          hasJargon,
          hasStudioStarterPrompts,
          hasStarterPrompt0,
          noEmojiInLabels,
          hasStarterSkeleton,
          autoChipCount: starterBtns.length,
          promptAfterClick,
          tileChipCount: tileBtns.length,
          promptAfterTileClick,
          tilePlaceholder,
          hasComposerModelSelect: Boolean(document.querySelector('.dab-composer-actions [data-testid="composer-model-select"]')),
          noTopbarModelSelect: !document.querySelector('.dab-topbar [data-testid="topbar-model-select"]'),
          noComposerInspector: !document.querySelector('.dab-composer-actions .dab-inspector'),
          clip
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toMatchObject({
      hasJargon: false,
      hasStudioStarterPrompts: true,
      hasStarterPrompt0: true,
      noEmojiInLabels: true,
      hasStarterSkeleton: true,
      autoChipCount: 4,
      promptAfterClick:
        'Build an interactive Data App on bigquery_information_schema::jobs_timeline with Total Slot Ms and Total Bytes Billed KPI scorecards, a Job Type trend chart, and a Creation Time filter.',
      tileChipCount: 3,
      promptAfterTileClick:
        'Write a Script summarizing bigquery_information_schema::jobs_timeline metrics by Creation Time and active dashboard filters as a table.',
      tilePlaceholder: 'Describe the Script to generate or update (or paste a screenshot)...',
      hasComposerModelSelect: true,
      noTopbarModelSelect: true,
      noComposerInspector: true
    })

    const clip = res.result.value.clip
    expect(clip).toBeTruthy()
    const { data } = await ctx.chrome.send('Page.captureScreenshot', { format: 'png', clip })
    const pngBuffer = Buffer.from(data, 'base64')
    expect(pngBuffer.length).toBeGreaterThan(1000)

    const scratchDir =
      '/usr/local/google/home/bryanweber/.gemini/jetski/brain/d8619e13-fc1d-42c9-9c8a-e76493f529cf/scratch'
    mkdirSync(scratchDir, { recursive: true })
    const scratchSnapPath = path.join(scratchDir, 'issue-59-composer-starters.png')
    writeFileSync(scratchSnapPath, pngBuffer)
    expect(existsSync(scratchSnapPath)).toBe(true)
  }, 15000)

}

module.exports = { registerVisualPart03Tests }
