function registerVisualPart06Tests(ctx) {
  const { startHeadlessChrome } = ctx
  test('Issue #99: renders meaningful content tabs in StudioRightPane and switches between Dashboard, Look, Explore, and Data App tabs via @looker/embed-sdk loadX()', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=data_app`
    })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        // Select conversation conv_dashboard_7 so right pane is visible
        const convDash7 = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        if (convDash7) convDash7.click();
        await new Promise((r) => setTimeout(r, 180));

        const container = document.querySelector('[data-testid="looker-embed-container"]');
        const studio = window.__DAB_STUDIO__;

        // Upsert Look #15, Explore thelook::order_items, and Data App #42 into the active conversation
        studio.upsertContentItem({
          id: '15',
          lookId: '15',
          contentType: 'look',
          title: 'Monthly Churn Look',
          embedPath: '/embed/looks/15'
        });
        studio.upsertContentItem({
          id: 'thelook::order_items',
          exploreId: 'thelook::order_items',
          contentType: 'explore',
          title: 'eCommerce: Order Items',
          embedPath: '/embed/explore/thelook/order_items'
        });
        studio.upsertContentItem({
          id: '42',
          dashboardId: '42',
          contentType: 'data_app',
          title: 'Executive Revenue Overview',
          embedPath: '/embed/dashboards/42'
        });
        await new Promise((r) => setTimeout(r, 140));

        const tabBar = document.querySelector('[data-testid="studio-content-tabs"]');
        const tabDash = document.querySelector('[data-testid="studio-content-tab-dashboard:7"]');
        const tabLook = document.querySelector('[data-testid="studio-content-tab-look:15"]');
        const tabExplore = document.querySelector('[data-testid="studio-content-tab-explore:thelook::order_items"]');
        const tabApp = document.querySelector('[data-testid="studio-content-tab-data_app:42"]');

        const labels = [tabDash, tabLook, tabExplore, tabApp].map((el) => (el?.textContent || '').trim());
        const allHaveSvg = [tabDash, tabLook, tabExplore, tabApp].every((el) => Boolean(el?.querySelector('svg')));

        // 1. Click Look tab -> loadLook({ id: '15' })
        tabLook.click();
        await new Promise((r) => setTimeout(r, 120));
        const afterClickLook = {
          selected: tabLook.getAttribute('aria-selected'),
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target')
        };

        // 2. Click Explore tab -> loadExplore({ id: 'thelook/order_items' })
        tabExplore.click();
        await new Promise((r) => setTimeout(r, 120));
        const afterClickExplore = {
          selected: tabExplore.getAttribute('aria-selected'),
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target')
        };

        // 3. Click Dashboard tab -> loadDashboard({ id: '7' })
        tabDash.click();
        await new Promise((r) => setTimeout(r, 120));
        const afterClickDash = {
          selected: tabDash.getAttribute('aria-selected'),
          state: container.getAttribute('data-embed-state'),
          target: container.getAttribute('data-embed-target')
        };

        const calls = (window.__LOOKER_EMBED_STATE__?.calls || []).map((c) => c.method + ':' + c.arg);

        return {
          hasTabBar: Boolean(tabBar),
          labels,
          allHaveSvg,
          afterClickLook,
          afterClickExplore,
          afterClickDash,
          calls
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toMatchObject({
      hasTabBar: true,
      labels: [
        'Executive Order Performance (Native UDD)',
        'Monthly Churn Look',
        'eCommerce: Order Items',
        'Executive Revenue Overview'
      ],
      allHaveSvg: true,
      afterClickLook: {
        selected: 'true',
        state: 'look',
        target: '15'
      },
      afterClickExplore: {
        selected: 'true',
        state: 'explore',
        target: 'thelook/order_items'
      },
      afterClickDash: {
        selected: 'true',
        state: 'dashboard',
        target: '7'
      }
    })
    expect(res.result.value.calls).toEqual(
      expect.arrayContaining([
        'loadLook:15',
        'loadExplore:thelook/order_items',
        'loadDashboard:7',
        'loadDashboard:42'
      ])
    )
  }, 15000)

  test('Issue #105: provides in-flight Stop, Queue & Interject composer controls and topbar Environment Reset/Stop popover menu', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=chatbar_busy_running`
    })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="studio-stop-btn"]') && document.querySelector('[data-testid="topbar-environment-btn"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        s.setOauthToken('mock_oauth_token');
        await new Promise((r) => setTimeout(r, 40));
        const ta = document.querySelector('[data-testid="studio-prompt-input"]');
        const addBtn = document.querySelector('[data-testid="composer-add-context-btn"]');
        const splitGroup = document.querySelector('[data-testid="studio-busy-action-group"]');
        const queueBtn = document.querySelector('[data-testid="studio-queue-btn"]');
        const menuTrigger = document.querySelector('[data-testid="studio-busy-action-menu-trigger"]');
        const stopBtn = document.querySelector('[data-testid="studio-stop-btn"]');
        const sendBtnWhileBusy = document.querySelector('[data-testid="studio-send-btn"]');

        // Open split button caret menu, switch to Interject -> verifies studio-interject-btn & localStorage persistence, then switch back to Queue
        menuTrigger?.click();
        await new Promise((r) => setTimeout(r, 40));
        const interjectOption = document.querySelector('[data-testid="studio-busy-action-option-interject"]');
        interjectOption?.click();
        await new Promise((r) => setTimeout(r, 40));
        const hasInterjectAfterSwitch = Boolean(document.querySelector('[data-testid="studio-interject-btn"]'));
        const storedAfterInterject = window.localStorage.getItem('dab_busy_send_action');
        document.querySelector('[data-testid="studio-busy-action-menu-trigger"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="studio-busy-action-option-queue"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const storedAfterQueue = window.localStorage.getItem('dab_busy_send_action');

        const initialBusyCheck = {
          textareaDisabled: Boolean(ta?.disabled),
          addContextDisabled: Boolean(addBtn?.disabled),
          hasSplitGroup: Boolean(splitGroup),
          hasQueueBtn: Boolean(queueBtn),
          hasInterjectBtn: hasInterjectAfterSwitch,
          storedAfterInterject,
          storedAfterQueue,
          hasStopBtn: Boolean(stopBtn),
          hasSendBtnWhileBusy: Boolean(sendBtnWhileBusy)
        };

        // 1. Type a follow-up prompt while busy and click Queue
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        taSetter.call(ta, 'Add a regional breakdown filter');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        document.querySelector('[data-testid="studio-queue-btn"]').click();
        await new Promise((r) => setTimeout(r, 60));

        // 2. Type a second follow-up prompt while busy and press Cmd+Enter to queue it
        taSetter.call(ta, 'Export summary table to CSV');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        const queuedBar = document.querySelector('[data-testid="queued-prompts-bar"]');
        const queuedItemsBeforeRemove = Array.from(document.querySelectorAll('[data-testid="queued-prompt-item"]')).map(
          (el) => el.querySelector('.dab-queued-prompt-text')?.textContent?.trim() || ''
        );

        // Remove second queued prompt via its remove button
        const removeBtns = Array.from(document.querySelectorAll('[data-testid^="queued-prompt-remove-"]'));
        removeBtns[1]?.click();
        await new Promise((r) => setTimeout(r, 60));
        const queuedCountAfterRemove = document.querySelectorAll('[data-testid="queued-prompt-item"]').length;

        // 3. Test Stop button: set liveActivitySteps and click Stop
        s.setLiveActivitySteps([
          { id: 'step_stop_1', kind: 'thought', title: 'Inspecting order_items', status: 'running' }
        ]);
        await new Promise((r) => setTimeout(r, 50));
        document.querySelector('[data-testid="studio-stop-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));

        const afterStop = {
          hasStopBtn: Boolean(document.querySelector('[data-testid="studio-stop-btn"]')),
          hasSendBtn: Boolean(document.querySelector('[data-testid="studio-send-btn"]')),
          bodyContainsStoppedMsg: document.body.innerText.includes('Stopped by user.')
        };

        // 4. Test Interject from queued item while busy
        s.setBusyStatus('Running Looker Code Mode...');
        s.setLiveActivitySteps([
          { id: 'step_int_1', kind: 'codemode', title: 'Querying brand revenue', status: 'running' }
        ]);
        await new Promise((r) => setTimeout(r, 60));
        const interjectQueuedBtn = document.querySelector('[data-testid^="queued-prompt-interject-"]');
        interjectQueuedBtn?.click();
        await new Promise((r) => setTimeout(r, 200));

        const afterQueuedInterject = {
          queuedBarGone: !document.querySelector('[data-testid="queued-prompts-bar"]'),
          bodyContainsInterjectedMsg: document.body.innerText.includes('Interjected by user.'),
          bodyContainsQueuedPromptText: document.body.innerText.includes('Add a regional breakdown filter')
        };

        // 5. Verify topbar Environment button & popover menu (Reset Environment & Stop Environment)
        const envBtn = document.querySelector('[data-testid="topbar-environment-btn"]');
        const envBtnText = (envBtn?.textContent || '').trim();
        const hasRawEnvLabel = /Env\\s*\\[/i.test(document.querySelector('.dab-topbar')?.innerText || '');

        envBtn.click();
        await new Promise((r) => setTimeout(r, 60));
        const envMenu = document.querySelector('[data-testid="topbar-environment-menu"]');
        const resetBtn = document.querySelector('[data-testid="env-reset-btn"]');
        const stopEnvBtn = document.querySelector('[data-testid="env-stop-btn"]');
        const menuOpenCheck = {
          hasMenu: Boolean(envMenu),
          hasResetBtn: Boolean(resetBtn),
          hasStopEnvBtn: Boolean(stopEnvBtn)
        };

        // Click Stop Environment -> closes menu and sets status to 'stopped' (neutral badge)
        stopEnvBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        const afterStopEnv = {
          menuClosed: !document.querySelector('[data-testid="topbar-environment-menu"]'),
          status: window.__DAB_STUDIO__.environmentStatus,
          hasNeutralClass: envBtn.classList.contains('dab-badge-neutral'),
          text: (envBtn?.textContent || '').trim()
        };

        // Re-open menu and click Reset Environment -> sets status to 'active' (success badge) & shows reset notice
        envBtn.click();
        await new Promise((r) => setTimeout(r, 60));
        document.querySelector('[data-testid="env-reset-btn"]').click();
        await new Promise((r) => setTimeout(r, 120));
        const afterResetEnv = {
          menuClosed: !document.querySelector('[data-testid="topbar-environment-menu"]'),
          status: window.__DAB_STUDIO__.environmentStatus,
          hasSuccessClass: envBtn.classList.contains('dab-badge-success'),
          hasResetNoticeAttr: envBtn.getAttribute('data-env-reset-notice') === 'true',
          text: (envBtn?.textContent || '').trim()
        };

        // 6. Verify right-pane Overview sidebar Active Step when busy without active embed, and neutral Ready copy when idle
        window.lkr_codemode_api_calls = [];
        s.setPublishedApp(null);
        s.setContentItems([]);
        s.setCurrentAppCode('');
        s.setLiveActivitySteps([]);
        s.setBusyStatus('Synthesizing Looker query...');
        await new Promise((r) => setTimeout(r, 60));
        const busyEl = document.querySelector('[data-testid="overview-busy-status"]');
        const rightOverviewTitle = (document.querySelector('[data-testid="overview-header"] .dab-ov-title')?.textContent || '').trim();
        const thinkingCheck = {
          hasOverviewBusyState: Boolean(busyEl),
          thinkingText: (busyEl?.textContent || '').trim(),
          headerText: rightOverviewTitle
        };

        s.setBusyStatus(null);
        await new Promise((r) => setTimeout(r, 60));
        const idleOverviewText = (document.querySelector('[data-testid="overview-empty-state"]')?.textContent || '').trim();
        const rightHeaderIdleText = (document.querySelector('[data-testid="overview-header"] .dab-ov-title')?.textContent || '').trim();
        const idleCheck = {
          hasOverviewBusyState: Boolean(document.querySelector('[data-testid="overview-busy-status"]')),
          headerText: rightHeaderIdleText,
          hasReadyCopy: idleOverviewText.includes('Ready when you are'),
          hasHardcodedDataAppCopy: /Data App/i.test(idleOverviewText) || /Data App/i.test(rightHeaderIdleText)
        };

        return {
          initialBusyCheck,
          hasQueuedBar: Boolean(queuedBar),
          queuedItemsBeforeRemove,
          queuedCountAfterRemove,
          afterStop,
          afterQueuedInterject,
          envBtnText,
          hasRawEnvLabel,
          menuOpenCheck,
          afterStopEnv,
          afterResetEnv,
          thinkingCheck,
          idleCheck
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      initialBusyCheck: {
        textareaDisabled: false,
        addContextDisabled: false,
        hasSplitGroup: true,
        hasQueueBtn: true,
        hasInterjectBtn: true,
        storedAfterInterject: 'interject',
        storedAfterQueue: 'queue',
        hasStopBtn: true,
        hasSendBtnWhileBusy: false
      },
      hasQueuedBar: true,
      queuedItemsBeforeRemove: [
        'Add a regional breakdown filter',
        'Export summary table to CSV'
      ],
      queuedCountAfterRemove: 1,
      afterStop: {
        hasStopBtn: false,
        hasSendBtn: true,
        bodyContainsStoppedMsg: true
      },
      afterQueuedInterject: {
        queuedBarGone: true,
        bodyContainsInterjectedMsg: true,
        bodyContainsQueuedPromptText: true
      },
      envBtnText: 'Environment',
      hasRawEnvLabel: false,
      menuOpenCheck: {
        hasMenu: true,
        hasResetBtn: true,
        hasStopEnvBtn: true
      },
      afterStopEnv: {
        menuClosed: true,
        status: 'stopped',
        hasNeutralClass: true,
        text: 'Environment (Stopped)'
      },
      afterResetEnv: {
        menuClosed: true,
        status: 'active',
        hasSuccessClass: true,
        hasResetNoticeAttr: true,
        text: '✓ Environment Reset'
      },
      thinkingCheck: {
        hasOverviewBusyState: true,
        thinkingText: 'Active StepSynthesizing Looker query...',
        headerText: 'Overview'
      },
      idleCheck: {
        hasOverviewBusyState: false,
        headerText: 'Overview',
        hasReadyCopy: true,
        hasHardcodedDataAppCopy: false
      }
    })
  }, 15000)

  test('Issue #119: supports draggable split resizer, collapsible right artifact icon rail, clickable file/skill steps, and copy reasoning button', async () => {
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="workspace-split-resizer"]'))`, returnByValue: true })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const workspace = document.querySelector('.dab-workspace');
        const resizer = document.querySelector('[data-testid="workspace-split-resizer"]');
        const initialWidth = window.__DAB_STUDIO__.leftPaneWidth;
        resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 380, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 460, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const widthAfterDrag = window.__DAB_STUDIO__.leftPaneWidth;
        const cssVarAfterDrag = workspace.style.getPropertyValue('--dab-left-pane-width');
        const storedWidth = window.localStorage.getItem('dab_left_pane_width');
        resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const widthAfterKey = window.__DAB_STUDIO__.leftPaneWidth;

        window.__DAB_STUDIO__.setContentItems([
          { key: 'data_app:42', id: '42', contentType: 'data_app', title: 'Executive Revenue App', embedPath: '/embed/dashboards/42', extensionId: 'db::exec-rev' },
          { key: 'dashboard:108', id: '108', contentType: 'dashboard', title: 'Regional Margin UDD', embedPath: '/embed/dashboards/108' }
        ]);
        await new Promise((r) => setTimeout(r, 50));
        document.querySelector('[data-testid="right-pane-collapse-toggle"]').click();
        await new Promise((r) => setTimeout(r, 50));
        const railEl = document.querySelector('[data-testid="right-pane-collapsed-rail"]');
        const hasCollapsedClass = workspace.classList.contains('dab-workspace-right-collapsed');
        const storedCollapsed = window.localStorage.getItem('dab_right_pane_collapsed');
        const artifactBtnApp = document.querySelector('[data-testid="right-rail-artifact-data_app:42"]');
        const artifactBtnDash = document.querySelector('[data-testid="right-rail-artifact-dashboard:108"]');
        const resizerWhileCollapsed = document.querySelector('[data-testid="workspace-split-resizer"]');
        artifactBtnDash.click();
        await new Promise((r) => setTimeout(r, 60));
        const afterRailArtifactClick = { rightPaneCollapsed: window.__DAB_STUDIO__.rightPaneCollapsed, activeContentTabKey: window.__DAB_STUDIO__.activeContentTabKey, railGone: !document.querySelector('[data-testid="right-pane-collapsed-rail"]') };

        window.__DAB_STUDIO__.setMessages([
          { role: 'user', text: 'Investigate order items revenue drop' },
          { role: 'assistant', text: 'Completed root-cause investigation.', thinkingDurationSec: 5, activitySteps: [
            { id: 'st_thought', kind: 'thought', title: 'Framing investigation plan', detail: 'Checking key driver skill and DATA_INVESTIGATOR_GUIDE.md.', status: 'done' },
            { id: 'st_file', kind: 'file', title: 'Viewing DATA_INVESTIGATOR_GUIDE.md', detail: '/workspace/DATA_INVESTIGATOR_GUIDE.md', path: '/workspace/DATA_INVESTIGATOR_GUIDE.md', status: 'done' },
            { id: 'st_skill', kind: 'skill', title: 'Reading skill key-driver-analysis', detail: 'skills/key-driver-analysis/SKILL.md', path: 'skills/key-driver-analysis/SKILL.md', status: 'done' },
            { id: 'st_codemode', kind: 'codemode', title: 'Executing Looker queries for Order Items...', detail: 'sdk.run_inline_query', status: 'done' }
          ] }
        ]);
        await new Promise((r) => setTimeout(r, 60));
        const completedDetails = document.querySelector('[data-testid="completed-thinking-block"]');
        const wasOpenBeforeCopy = completedDetails.hasAttribute('open');
        const copyBtn = completedDetails.querySelector('[data-testid="copy-thinking-trace-btn"]');
        copyBtn.click();
        await new Promise((r) => setTimeout(r, 40));
        const wasOpenAfterCopy = completedDetails.hasAttribute('open');
        const copyBtnTextAfterClick = (copyBtn.textContent || '').trim();
        const copiedMarkdown = window.__LAST_COPIED_THINKING_TRACE__ || '';
        completedDetails.querySelector('summary').click();
        await new Promise((r) => setTimeout(r, 40));
        completedDetails.querySelector('[data-testid="thinking-step-file"] summary').click();
        completedDetails.querySelector('[data-testid="thinking-step-skill"] summary').click();
        await new Promise((r) => setTimeout(r, 40));
        const previews = Array.from(completedDetails.querySelectorAll('[data-testid="activity-step-content-preview"]')).map((el) => (el.textContent || '').trim());
        return {
          initialWidth, widthAfterDrag, cssVarAfterDrag, storedWidth, widthAfterKey,
          hasRail: Boolean(railEl), hasCollapsedClass, storedCollapsed,
          hasArtifactBtnApp: Boolean(artifactBtnApp), hasArtifactBtnDash: Boolean(artifactBtnDash),
          hasResizerWhileCollapsed: Boolean(resizerWhileCollapsed), afterRailArtifactClick,
          wasOpenBeforeCopy, wasOpenAfterCopy, copyBtnTextAfterClick,
          copiedContainsHeader: copiedMarkdown.includes('## Thinking & Activity Trace (5s · 4 steps)'),
          copiedContainsPrompt: copiedMarkdown.includes('Investigate order items revenue drop'),
          copiedContainsFriendlyStep: copiedMarkdown.includes('Executing Looker queries for Order Items...'),
          previewCount: previews.length,
          filePreviewHasGuide: previews.some((p) => p.includes('Data Investigator')),
          skillPreviewHasKda: previews.some((p) => p.includes('Key Driver Analysis'))
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      initialWidth: 380, widthAfterDrag: 460, cssVarAfterDrag: '460px', storedWidth: '460', widthAfterKey: 476,
      hasRail: true, hasCollapsedClass: true, storedCollapsed: 'true', hasArtifactBtnApp: true, hasArtifactBtnDash: true, hasResizerWhileCollapsed: false,
      afterRailArtifactClick: { rightPaneCollapsed: false, activeContentTabKey: 'dashboard:108', railGone: true },
      wasOpenBeforeCopy: false, wasOpenAfterCopy: false, copyBtnTextAfterClick: 'Copied',
      copiedContainsHeader: true, copiedContainsPrompt: true, copiedContainsFriendlyStep: true,
      previewCount: 2, filePreviewHasGuide: true, skillPreviewHasKda: true
    })
  }, 15000)

  test('Issue #126: renders Barrel Tube Vortex surf loader, edits per-user agent name inline with extensionSDK.updateTitle, renders rich Markdown links with openBrowserWindow & clipboardWrite fallback, collapses CA embed panels, and adapts layout on <=768px mobile viewport', async () => {
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=ripper_surf_loader` })
    const loaderDeadline = Date.now() + 8000
    while (Date.now() < loaderDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="ripper-surf-loader"]'))`, returnByValue: true })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const loaderRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const loader = document.querySelector('[data-testid="ripper-surf-loader"]');
        const svg = document.querySelector('[data-testid="ripper-surf-loader-svg"]');
        const hasThreeRipCurlRibbons = Boolean(svg?.querySelector('.dab-ripper-ribbon-1') && svg?.querySelector('.dab-ripper-ribbon-2') && svg?.querySelector('.dab-ripper-ribbon-3') && svg?.querySelector('.dab-ripper-board-ride'));
        const loaderText = loader ? (loader.textContent || '').trim() : '';
        window.__DAB_STUDIO__.setAppInitializing(false);
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('[data-testid="studio-edit-agent-name-btn"]') && document.querySelector('[data-testid="chat-msg-agent-author"]')) break;
          await new Promise((r) => setTimeout(r, 40));
        }
        const labelBefore = (document.querySelector('[data-testid="studio-agent-name-label"]')?.textContent || '').trim();
        const authorBefore = (document.querySelector('[data-testid="chat-msg-agent-author"]')?.textContent || '').trim();
        document.querySelector('[data-testid="studio-edit-agent-name-btn"]').click();
        await new Promise((r) => setTimeout(r, 40));
        const input = document.querySelector('[data-testid="studio-agent-name-input"]');
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Maverick');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
        document.querySelector('[data-testid="studio-save-agent-name-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));
        const labelAfter = (document.querySelector('[data-testid="studio-agent-name-label"]')?.textContent || '').trim();
        const authorAfter = (document.querySelector('[data-testid="chat-msg-agent-author"]')?.textContent || '').trim();
        const updatedTitles = window.__UPDATED_TITLES__ || [];
        const userConfigUpdate = (window.__ARTIFACT_UPDATES__ || []).find((u) => u.key === 'user_config:1');

        window.__OPENED_WINDOWS__ = [];
        window.__CLIPBOARD_WRITES__ = [];
        window.__DAB_STUDIO__.setMessages([{
          role: 'assistant',
          text: [
            '### Revenue Breakdown',
            '- Open [Executive Dashboard](/dashboards/42) or [LookML Field Docs](https://docs.cloud.google.com/looker/docs/r/sql/LookML-field)',
            '- External vendor link [Vendor Portal](https://unlisted-vendor.example.org/report)',
            '\`\`\`sql',
            'SELECT status, COUNT(*) FROM order_items GROUP BY 1;',
            '\`\`\`'
          ].join('\\n')
        }]);
        await new Promise((r) => setTimeout(r, 80));
        const mdBody = document.querySelector('[data-testid="studio-markdown-body"]');
        const links = Array.from(document.querySelectorAll('[data-testid="chat-markdown-link"]'));
        const copyBtns = Array.from(document.querySelectorAll('[data-testid="chat-markdown-link-copy"]'));
        const extBtns = Array.from(document.querySelectorAll('[data-testid="markdown-link-external-btn"]'));
        links[0].click(); links[1].click(); links[2].click();
        await new Promise((r) => setTimeout(r, 60));
        const routedInViewerKey = window.__DAB_STUDIO__.activeContentItem?.key || null;
        extBtns[0]?.click();
        await new Promise((r) => setTimeout(r, 40));
        const thirdCopiedAttr = copyBtns[2]?.getAttribute('data-copied');
        copyBtns[0].click();
        await new Promise((r) => setTimeout(r, 40));
        const firstCopiedAttr = copyBtns[0]?.getAttribute('data-copied');
        return {
          hasLoader: Boolean(loader), hasSvg: Boolean(svg), hasThreeRipCurlRibbons,
          loaderHasRipper: loaderText.includes('Ripper'),
          loaderHasSubtitle: loaderText.includes('Dropping into your Looker workspace'),
          labelBefore, authorBefore, labelAfter, authorAfter,
          titleUpdatedToMaverick: updatedTitles.includes('Maverick'),
          savedUserConfigAgentName: userConfigUpdate ? JSON.parse(userConfigUpdate.value).agentName : null,
          hasH3: Boolean(mdBody?.querySelector('h3')),
          hasList: Boolean(mdBody?.querySelector('ul')),
          hasCodeBlock: Boolean(mdBody?.querySelector('pre code')),
          linkCount: links.length, copyBtnCount: copyBtns.length,
          routedInViewerKey,
          openedWindows: window.__OPENED_WINDOWS__, clipboardWrites: window.__CLIPBOARD_WRITES__,
          thirdCopiedAttr, firstCopiedAttr
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(loaderRes.result.value).toEqual({
      hasLoader: true, hasSvg: true, hasThreeRipCurlRibbons: true, loaderHasRipper: true, loaderHasSubtitle: true,
      labelBefore: 'Ripper', authorBefore: 'Ripper', labelAfter: 'Maverick', authorAfter: 'Maverick',
      titleUpdatedToMaverick: true, savedUserConfigAgentName: 'Maverick',
      hasH3: true, hasList: true, hasCodeBlock: true, linkCount: 3, copyBtnCount: 3,
      routedInViewerKey: 'data_app:42',
      openedWindows: [
        { url: 'https://docs.cloud.google.com/looker/docs/r/sql/LookML-field', target: '_blank' },
        { url: '/dashboards/42', target: '_blank' }
      ],
      clipboardWrites: ['https://unlisted-vendor.example.org/report', '/dashboards/42'],
      thirdCopiedAttr: 'true', firstCopiedAttr: 'true'
    })

    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=conversational_analytics` })
    const caDeadline = Date.now() + 8000
    while (Date.now() < caDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', { expression: `Boolean(document.querySelector('[data-testid="ca-embed-iframe"]'))`, returnByValue: true })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const caRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const iframe = document.querySelector('[data-testid="ca-embed-iframe"]');
        return { embedSrc: iframe?.getAttribute('data-embed-src') || '', panelsCollapsedAttr: iframe?.getAttribute('data-ca-panels-collapsed') || '' };
      })()`,
      returnByValue: true
    })
    expect(caRes.result.value.embedSrc).toContain('/embed/conversations/ca_conv_streaming_1?agent_id=ca_agent_ecommerce')
    expect(caRes.result.value.embedSrc).toContain('hide_sidebar=true&hide_data_source_panel=true&sidebar_collapsed=true&right_panel_collapsed=true')
    expect(caRes.result.value.panelsCollapsedAttr).toBe('true')

    try {
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt` })
      const mobDeadline = Date.now() + 8000
      while (Date.now() < mobDeadline) {
        const r = await ctx.chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="studio-empty-stage"]'))`, returnByValue: true })
        if (r.result?.value) break
        await new Promise((res) => setTimeout(res, 80))
      }

      const mobRes = await ctx.chrome.send('Runtime.evaluate', {
        expression: `(async () => {
          const initialCollapsed = window.__DAB_STUDIO__.sidebarCollapsed;
          window.__DAB_STUDIO__.setSidebarCollapsed(false);
          await new Promise((r) => setTimeout(r, 50));
          const sidebarEl = document.querySelector('[data-testid="conversations-sidebar"]');
          const sidebarPosition = sidebarEl ? window.getComputedStyle(sidebarEl).position : '';
          await window.__DAB_STUDIO__.handleSelectConversation({
            id: 'conv_app_42', type: 'app', label: 'Executive Revenue App',
            content: { dashboardId: '42', appArtifactId: 'obj_app_42' }, updatedAt: '2026-10-30T23:40:00Z'
          });
          await new Promise((r) => setTimeout(r, 80));
          return { initialCollapsed, sidebarPosition, collapsedAfterSelect: window.__DAB_STUDIO__.sidebarCollapsed };
        })()`,
        awaitPromise: true,
        returnByValue: true
      })
      expect(mobRes.result.value).toEqual({ initialCollapsed: true, sidebarPosition: 'absolute', collapsedAfterSelect: true })
    } finally {
      await ctx.chrome.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    }
  }, 20000)

}

module.exports = { registerVisualPart06Tests }
