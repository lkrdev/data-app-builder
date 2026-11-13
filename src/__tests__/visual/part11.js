function registerVisualPart11Tests(ctx) {
  test('Issue #186: renders Max Tool Rounds select + accessible Info tooltip in light/dark themes on /config and persists maxToolRounds without .dab-info-trigger regression', async () => {
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await ctx.chrome.send('Page.bringToFront')
    await ctx.chrome.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=config_page` })
    const cfgDeadline = Date.now() + 8000
    while (Date.now() < cfgDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="config-max-tool-rounds-select"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const cfgRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));

        const roundsSelect = document.querySelector('[data-testid="config-max-tool-rounds-select"]');
        const initialValue = roundsSelect ? roundsSelect.value : '';
        const optionValues = roundsSelect ? Array.from(roundsSelect.options).map((o) => o.value) : [];
        const optionLabels = roundsSelect ? Array.from(roundsSelect.options).map((o) => (o.textContent || '').trim()) : [];

        const infoBtn = document.querySelector('[data-testid="config-max-tool-rounds-info"]');
        const tooltipEl = document.querySelector('[data-testid="config-max-tool-rounds-tooltip"]');
        const tabIndexAttr = infoBtn ? infoBtn.getAttribute('tabindex') : null;
        const roleAttr = tooltipEl ? tooltipEl.getAttribute('role') : null;
        const hiddenBeforeFocus = tooltipEl ? window.getComputedStyle(tooltipEl).visibility === 'hidden' : false;

        infoBtn?.focus();
        await new Promise((r) => setTimeout(r, 40));
        const lightCs = tooltipEl ? window.getComputedStyle(tooltipEl) : null;
        const lightVisible = Boolean(lightCs && lightCs.visibility === 'visible' && Number(lightCs.opacity) === 1);
        const lightBg = lightCs ? lightCs.backgroundColor : '';
        const lightColor = lightCs ? lightCs.color : '';
        const lightFits = tooltipEl ? tooltipEl.scrollHeight <= tooltipEl.clientHeight + 2 : false;
        const tooltipText = (tooltipEl?.textContent || '').trim();

        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 40));
        const darkCs = tooltipEl ? window.getComputedStyle(tooltipEl) : null;
        const darkVisible = Boolean(darkCs && darkCs.visibility === 'visible' && Number(darkCs.opacity) === 1);
        const darkBg = darkCs ? darkCs.backgroundColor : '';
        const darkColor = darkCs ? darkCs.color : '';
        const darkFits = tooltipEl ? tooltipEl.scrollHeight <= tooltipEl.clientHeight + 2 : false;

        infoBtn?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const hiddenAfterEscape = tooltipEl ? window.getComputedStyle(tooltipEl).visibility === 'hidden' : false;

        infoBtn?.blur();
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));

        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(roundsSelect, '25');
        roundsSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));

        const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Save Setup'));
        saveBtn?.click();
        await new Promise((r) => setTimeout(r, 120));

        const useCaseInfoBtn = document.querySelector('[data-testid="use-case-info-btn"]');
        const useCaseInfoWidth = useCaseInfoBtn ? Math.round(useCaseInfoBtn.getBoundingClientRect().width) : 24;

        return {
          initialValue,
          optionValues,
          optionLabels,
          tabIndexAttr,
          roleAttr,
          hiddenBeforeFocus,
          hiddenAfterEscape,
          lightVisible,
          darkVisible,
          lightFits,
          darkFits,
          distinctThemeSurfaces: Boolean(lightBg && darkBg && lightBg !== darkBg && lightColor !== darkColor),
          hasCeilingCopy: tooltipText.includes('50 default, 100 max') && tooltipText.includes('1M-token') && tooltipText.includes('OAuth'),
          hasLowerCopy: tooltipText.includes('15–25') && tooltipText.includes('BigQuery') && tooltipText.includes('quota'),
          hasSdkJargon: tooltipText.includes('saveContextData'),
          savedMaxToolRounds: window.__LAST_SAVED_CONTEXT_DATA__?.maxToolRounds,
          useCaseInfoPreserved: useCaseInfoWidth >= 24,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    expect(cfgRes.result.value).toEqual({
      initialValue: '50',
      optionValues: ['15', '25', '50', '100'],
      optionLabels: [
        '15 rounds',
        '25 rounds',
        '50 rounds (Default — High)',
        '100 rounds (Max)',
      ],
      tabIndexAttr: '0',
      roleAttr: 'tooltip',
      hiddenBeforeFocus: true,
      hiddenAfterEscape: true,
      lightVisible: true,
      darkVisible: true,
      lightFits: true,
      darkFits: true,
      distinctThemeSurfaces: true,
      hasCeilingCopy: true,
      hasLowerCopy: true,
      hasSdkJargon: false,
      savedMaxToolRounds: 25,
      useCaseInfoPreserved: true,
    })
  }, 20000)

  test('Issue #189: renders compact E/V/T/D/M/R/F LookML badges across file tabs, sticky FolderOpen file-opener menu, and Overview Changed Files in light & dark themes, and consolidates Open in IDE', async () => {
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await ctx.chrome.send('Page.bringToFront')
    await ctx.chrome.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=lookml` })
    const lkDeadline = Date.now() + 8000
    while (Date.now() < lkDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="lookml-file-tabs"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const res189 = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        s.setThemeMode('light');
        window.__OPENED_WINDOWS__ = [];
        s.setLookmlBundle({
          id: 'multi_lkml_proj',
          title: 'LookML: multi_lkml_proj',
          project_id: 'multi_lkml_proj',
          model_name: 'thelook',
          branch_name: 'dev_bryan',
          files: [
            { path: 'thelook.model.lkml', action: 'created', content: 'connection: "bq"\\n' },
            { path: 'manifest.lkml', action: 'created', content: 'project_name: "multi_lkml_proj"\\n' },
            { path: 'bronze/distribution_centers.view.lkml', action: 'created', content: 'view: distribution_centers {}\\n' },
            { path: 'models/enterprise_warehouse/regional_emea/finance/ledger_entries.view.lkml', action: 'created', content: 'view: ledger_entries {}\\n' },
            { path: 'silver/orders.refinement.lkml', action: 'updated', content: 'view: +orders {}\\n' },
            { path: 'bronze/explores/order_items_base.explore.lkml', action: 'created', content: 'explore: order_items_base {}\\n' },
            { path: 'tests/bronze/orders.test.lkml', action: 'created', content: 'test: orders_pk {}\\n' },
            { path: 'dashboards/exec_pulse.dashboard.lookml', action: 'created', content: '- dashboard: exec_pulse\\n  title: Exec Pulse\\n' },
            { path: 'legacy/obsolete.view.lkml', action: 'deleted', diff: '--- a/legacy/obsolete.view.lkml\\n+++ /dev/null\\n' },
          ],
          validation: { passed: true, error_count: 0, errors: [] },
        });
        await new Promise((r) => setTimeout(r, 80));

        // 1. Verify compact file tabs + hover titles + sticky left picker outside horizontal scroll container
        const tabsEl = document.querySelector('[data-testid="lookml-file-tabs"]');
        const pickerBtn = document.querySelector('[data-testid="lookml-file-picker-btn"]');
        const pickerBeforeLeft = pickerBtn ? Math.round(pickerBtn.getBoundingClientRect().left) : -1;
        const tabsLeft = tabsEl ? Math.round(tabsEl.getBoundingClientRect().left) : -1;
        const pickerIsLeftOfTabs = pickerBeforeLeft > 0 && pickerBeforeLeft < tabsLeft && !tabsEl.contains(pickerBtn);
        if (tabsEl) tabsEl.scrollLeft = 180;
        await new Promise((r) => setTimeout(r, 30));
        const pickerStaysStickyOnScroll = pickerBtn ? Math.round(pickerBtn.getBoundingClientRect().left) === pickerBeforeLeft : false;
        const pickerTitle = pickerBtn?.getAttribute('title') || '';
        const pickerHasFolderSvg = Boolean(pickerBtn?.querySelector('svg.lucide'));

        const tabEls = Array.from(document.querySelectorAll('[data-testid^="lookml-file-tab-"]'));
        const tabsUnclipped = tabEls.every((el) => el.scrollHeight <= el.clientHeight + 2);
        const tabBadgesAndStems = tabEls.map((el) => ({
          kind: el.querySelector('.dab-lkml-kind-badge')?.getAttribute('data-kind') || '',
          text: (el.textContent || '').trim(),
          title: el.getAttribute('title') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
        }));

        // 2. Verify Overview Changed Files rows show compact badge + stem with full path in title & aria-label
        const ovItem0 = document.querySelector('[data-testid="overview-file-item-0"]');
        const ovItem2 = document.querySelector('[data-testid="overview-file-item-2"]');
        const ov0Kind = ovItem0?.querySelector('.dab-lkml-kind-badge')?.getAttribute('data-kind') || '';
        const ov0Txt = (ovItem0?.querySelector('.dab-ov-txt')?.textContent || '').trim();
        const ov0Title = ovItem0?.getAttribute('title') || '';
        const ov2Kind = ovItem2?.querySelector('.dab-lkml-kind-badge')?.getAttribute('data-kind') || '';
        const ov2Txt = (ovItem2?.querySelector('.dab-ov-txt')?.textContent || '').trim();
        const ov2Title = ovItem2?.getAttribute('title') || '';

        // 3. Open file picker menu -> verify items, deep-dir stem readability, keyboard ArrowDown + Escape focus restoration, outside mousedown, and mutual exclusion
        pickerBtn?.focus();
        pickerBtn?.click();
        await new Promise((r) => setTimeout(r, 40));
        const menuEl = document.querySelector('[data-testid="lookml-file-picker-menu"]');
        const menuOpen1 = Boolean(menuEl);
        const item0 = document.querySelector('[data-testid="lookml-file-picker-item-0"]');
        const item3Deep = document.querySelector('[data-testid="lookml-file-picker-item-3"]');
        const item5 = document.querySelector('[data-testid="lookml-file-picker-item-5"]');
        const item0Active = item0?.getAttribute('aria-current') === 'true' && item0.classList.contains('active');
        const item5Spans = item5 ? Array.from(item5.querySelectorAll('span')).map((sp) => (sp.textContent || '').trim()) : [];
        const item5Title = item5?.getAttribute('title') || '';
        const deepStemReadableAndNoOverflow = (() => {
          if (!item3Deep) return false;
          const stemRect = item3Deep.querySelector('.dab-ov-txt')?.getBoundingClientRect();
          return Boolean(
            stemRect &&
            stemRect.width >= 60 &&
            item3Deep.scrollHeight <= item3Deep.clientHeight + 2 &&
            item3Deep.scrollWidth <= item3Deep.clientWidth + 1
          );
        })();

        item0?.focus();
        menuEl?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 25));
        const arrowNavMovedFocus = document.activeElement === document.querySelector('[data-testid="lookml-file-picker-item-1"]');

        const lightMenuCs = window.getComputedStyle(menuEl);
        const lightMenuBg = lightMenuCs.backgroundColor;
        const lightBadgeBorder = window.getComputedStyle(document.querySelector('[data-testid="lookml-file-tab-0"] .dab-lkml-kind-badge')).borderTopColor;
        const badgeBox14 = (() => {
          const r = document.querySelector('[data-testid="lookml-file-tab-0"] .dab-lkml-kind-badge')?.getBoundingClientRect();
          return Boolean(r && Math.round(r.width) === 14 && Math.round(r.height) === 14);
        })();

        s.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 40));
        const darkMenuCs = window.getComputedStyle(document.querySelector('[data-testid="lookml-file-picker-menu"]'));
        const darkMenuBg = darkMenuCs.backgroundColor;
        const darkActiveTabBg = window.getComputedStyle(document.querySelector('[data-testid="lookml-file-tab-0"]')).backgroundColor;
        const darkInactiveBadgeBorder = window.getComputedStyle(document.querySelector('[data-testid="lookml-file-tab-1"] .dab-lkml-kind-badge')).borderTopColor;
        s.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));
        const lightInactiveBadgeBorder = window.getComputedStyle(document.querySelector('[data-testid="lookml-file-tab-1"] .dab-lkml-kind-badge')).borderTopColor;

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const closedOnEscape = !document.querySelector('[data-testid="lookml-file-picker-menu"]') && document.activeElement === pickerBtn;

        // Outside mousedown dismissal
        pickerBtn?.click();
        await new Promise((r) => setTimeout(r, 30));
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
        const closedOnOutsideMouseDown = !document.querySelector('[data-testid="lookml-file-picker-menu"]');

        // Mutual exclusion between file picker menu and 3-dot code actions menu + narrow-subbar containment check
        const subbarEl = document.querySelector('.dab-lookml-subbar');
        pickerBtn?.click();
        await new Promise((r) => setTimeout(r, 30));
        document.querySelector('[data-testid="lookml-code-actions-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        const actionsClosedPicker = !document.querySelector('[data-testid="lookml-file-picker-menu"]') && Boolean(document.querySelector('[data-testid="lookml-code-actions-menu"]'));
        if (subbarEl) subbarEl.style.width = '254px';
        await new Promise((r) => setTimeout(r, 25));
        const narrowActionsRect = document.querySelector('[data-testid="lookml-code-actions-menu"]')?.getBoundingClientRect();
        const narrowSubbarRect = subbarEl?.getBoundingClientRect();
        pickerBtn?.click();
        await new Promise((r) => setTimeout(r, 30));
        const narrowPickerRect = document.querySelector('[data-testid="lookml-file-picker-menu"]')?.getBoundingClientRect();
        const pickerClosedActions = Boolean(narrowPickerRect) && !document.querySelector('[data-testid="lookml-code-actions-menu"]');
        const narrowMenusUnclipped = Boolean(
          narrowActionsRect && narrowPickerRect && narrowSubbarRect &&
          narrowActionsRect.left >= narrowSubbarRect.left && narrowActionsRect.right <= narrowSubbarRect.right + 1 &&
          narrowPickerRect.left >= narrowSubbarRect.left && narrowPickerRect.right <= narrowSubbarRect.right + 1
        );
        if (subbarEl) subbarEl.style.width = '';

        document.querySelector('[data-testid="lookml-file-picker-item-5"]')?.click();
        await new Promise((r) => setTimeout(r, 50));
        const closedAfterSelect = !document.querySelector('[data-testid="lookml-file-picker-menu"]');
        const selectedTab5Active = document.querySelector('[data-testid="lookml-file-tab-5"]')?.getAttribute('aria-current') === 'true';
        const codeShowsExplore = (document.querySelector('[data-testid="lookml-code-pre"]')?.textContent || '').includes('explore: order_items_base');

        // 4. Consolidated Open in IDE opens selected file #5 directly; 3-dot menu has no lookml-open-file-ide-btn
        document.querySelector('[data-testid="lookml-code-actions-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const noDuplicateMenuIdeBtn = !document.querySelector('[data-testid="lookml-open-file-ide-btn"]');
        document.querySelector('[data-testid="lookml-toolbar-open-ide-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const openedSelectedExploreIdeUrl = (window.__OPENED_WINDOWS__ || []).slice(-1)[0]?.url || '';

        // Deleted file (#8), traversal path, and '#'/'?' special chars in activeFile.path
        document.querySelector('[data-testid="lookml-file-tab-8"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        document.querySelector('[data-testid="lookml-toolbar-open-ide-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        const openedDeletedFallbackIdeUrl = (window.__OPENED_WINDOWS__ || []).slice(-1)[0]?.url || '';

        s.setLookmlBundle({
          id: 'multi_lkml_proj',
          title: 'LookML: multi_lkml_proj',
          project_id: 'multi_lkml_proj',
          files: [
            { path: 'bronze/rev#1?v=2.view.lkml', action: 'created', content: 'view: rev {}\\n' },
            { path: '../escape.view.lkml', action: 'created', content: 'view: escape {}\\n' },
          ],
        });
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="lookml-toolbar-open-ide-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        const openedEncodedIdeUrl = (window.__OPENED_WINDOWS__ || []).slice(-1)[0]?.url || '';
        document.querySelector('[data-testid="lookml-file-tab-1"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        document.querySelector('[data-testid="lookml-toolbar-open-ide-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        const openedTraversalFallbackIdeUrl = (window.__OPENED_WINDOWS__ || []).slice(-1)[0]?.url || '';

        // Tab-out (focusin outside) closes open file-picker menu cleanly
        document.querySelector('[data-testid="lookml-file-picker-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));
        document.querySelector('[data-testid="lookml-toolbar-open-ide-btn"]')?.focus();
        await new Promise((r) => setTimeout(r, 30));
        const closedOnFocusOut = !document.querySelector('[data-testid="lookml-file-picker-menu"]');

        // Empty files fallback -> toolbar Open in IDE falls back to /projects/multi_lkml_proj and hides file picker
        s.setLookmlBundle({ id: 'multi_lkml_proj', title: 'LookML: multi_lkml_proj', project_id: 'multi_lkml_proj', files: [] });
        await new Promise((r) => setTimeout(r, 50));
        const pickerHiddenWhenNoFiles = !document.querySelector('[data-testid="lookml-file-picker-btn"]');
        document.querySelector('[data-testid="lookml-toolbar-open-ide-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const openedFallbackProjIdeUrl = (window.__OPENED_WINDOWS__ || []).slice(-1)[0]?.url || '';

        return {
          pickerIsLeftOfTabs,
          pickerStaysStickyOnScroll,
          pickerTitle,
          pickerHasFolderSvg,
          tabsUnclipped,
          tabKinds: tabBadgesAndStems.map((t) => t.kind),
          tab0: tabBadgesAndStems[0],
          tab5: tabBadgesAndStems[5],
          ov0: { kind: ov0Kind, txt: ov0Txt, title: ov0Title },
          ov2: { kind: ov2Kind, txt: ov2Txt, title: ov2Title },
          menuOpen1,
          item0Active,
          item5Spans,
          item5Title,
          deepStemReadableAndNoOverflow,
          arrowNavMovedFocus,
          badgeBox14,
          darkActiveTabBg,
          themeDistinct: Boolean(lightMenuBg !== darkMenuBg && lightInactiveBadgeBorder !== darkInactiveBadgeBorder && lightBadgeBorder),
          closedOnEscape,
          closedOnOutsideMouseDown,
          mutualExclusionBothWays: actionsClosedPicker && pickerClosedActions,
          narrowMenusUnclipped,
          closedAfterSelect,
          selectedTab5Active,
          codeShowsExplore,
          noDuplicateMenuIdeBtn,
          openedSelectedExploreIdeUrl,
          openedDeletedFallbackIdeUrl,
          openedEncodedIdeUrl,
          openedTraversalFallbackIdeUrl,
          closedOnFocusOut,
          pickerHiddenWhenNoFiles,
          openedFallbackProjIdeUrl,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res189.exceptionDetails) throw new Error(JSON.stringify(res189.exceptionDetails))

    expect(res189.result.value).toEqual({
      pickerIsLeftOfTabs: true,
      pickerStaysStickyOnScroll: true,
      pickerTitle: 'Browse files (9)',
      pickerHasFolderSvg: true,
      tabsUnclipped: true,
      tabKinds: ['M', 'F', 'V', 'V', 'R', 'E', 'T', 'D', 'V'],
      tab0: { kind: 'M', text: 'Mthelook', title: 'thelook.model.lkml', ariaLabel: 'thelook.model.lkml' },
      tab5: { kind: 'E', text: 'Eorder_items_base', title: 'bronze/explores/order_items_base.explore.lkml', ariaLabel: 'bronze/explores/order_items_base.explore.lkml' },
      ov0: { kind: 'M', txt: 'thelook', title: 'thelook.model.lkml' },
      ov2: { kind: 'V', txt: 'distribution_centers', title: 'bronze/distribution_centers.view.lkml' },
      menuOpen1: true,
      item0Active: true,
      item5Spans: ['E', 'order_items_base', 'bronze/explores'],
      item5Title: 'bronze/explores/order_items_base.explore.lkml',
      deepStemReadableAndNoOverflow: true,
      arrowNavMovedFocus: true,
      badgeBox14: true,
      darkActiveTabBg: 'rgb(37, 99, 235)',
      themeDistinct: true,
      closedOnEscape: true,
      closedOnOutsideMouseDown: true,
      mutualExclusionBothWays: true,
      narrowMenusUnclipped: true,
      closedAfterSelect: true,
      selectedTab5Active: true,
      codeShowsExplore: true,
      noDuplicateMenuIdeBtn: true,
      openedSelectedExploreIdeUrl: '/projects/multi_lkml_proj/files/bronze/explores/order_items_base.explore.lkml',
      openedDeletedFallbackIdeUrl: '/projects/multi_lkml_proj',
      openedEncodedIdeUrl: '/projects/multi_lkml_proj/files/bronze/rev%231%3Fv%3D2.view.lkml',
      openedTraversalFallbackIdeUrl: '/projects/multi_lkml_proj',
      closedOnFocusOut: true,
      pickerHiddenWhenNoFiles: true,
      openedFallbackProjIdeUrl: '/projects/multi_lkml_proj',
    })
  }, 20000)

}

module.exports = { registerVisualPart11Tests }
