function registerVisualPart07Tests(ctx) {
  const { startHeadlessChrome } = ctx
  test('Issue #130: loads agent-created .md files on click from remote sandbox environment into activity-step-content-preview and sandbox-markdown-preview-modal without writing to Looker artifacts', async () => {
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="completed-thinking-block"], .dab-chat-log'))`, returnByValue: true })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__ARTIFACT_UPDATES__ = []; window.__ENVIRONMENT_FILE_CALLS__ = []; window.__CLIPBOARD_WRITES__ = []; window.__LAST_DOWNLOADED_SANDBOX_MD__ = null;
        window.__DAB_STUDIO__.setMessages([
          { role: 'user', text: 'Investigate Q4 revenue drop and write /workspace/analysis.md and /workspace/report.md' },
          {
            role: 'assistant',
            text: 'Created root-cause summary in \`/workspace/analysis.md\` and remediation steps in [Executive Remediation Report](/workspace/report.md).',
            thinkingDurationSec: 4,
            activitySteps: [{ id: 'st_md_1', kind: 'file', title: 'Editing analysis.md', detail: '/workspace/analysis.md', path: '/workspace/analysis.md', status: 'done' }]
          }
        ]);
        await new Promise((r) => setTimeout(r, 60));
        const completedDetails = document.querySelector('[data-testid="completed-thinking-block"]');
        completedDetails.querySelector('summary').click();
        await new Promise((r) => setTimeout(r, 40));
        const fileStep = completedDetails.querySelector('[data-testid="thinking-step-file"]');
        fileStep.querySelector('summary').click();
        await new Promise((r) => setTimeout(r, 60));
        const previewText = (fileStep.querySelector('[data-testid="activity-step-content-preview"]')?.textContent || '').trim();
        fileStep.querySelector('[data-testid="open-sandbox-markdown-modal-btn"]').click();
        await new Promise((r) => setTimeout(r, 60));
        const modalEl = document.querySelector('[data-testid="sandbox-markdown-preview-modal"]');
        const pathBadgeText = (modalEl?.querySelector('[data-testid="sandbox-markdown-path-badge"]')?.textContent || '').trim();
        const renderedBodyText = (modalEl?.querySelector('[data-testid="sandbox-markdown-rendered-body"]')?.textContent || '').trim();
        modalEl?.querySelector('[data-testid="sandbox-markdown-toggle-raw"]').click();
        await new Promise((r) => setTimeout(r, 40));
        const rawBodyText = (modalEl?.querySelector('[data-testid="sandbox-markdown-raw-body"]')?.textContent || '').trim();
        const copyBtn = modalEl?.querySelector('[data-testid="sandbox-markdown-copy-btn"]');
        copyBtn.click();
        await new Promise((r) => setTimeout(r, 40));
        const copiedAttr = copyBtn?.getAttribute('data-copied');
        modalEl?.querySelector('[data-testid="sandbox-markdown-download-btn"]').click();
        await new Promise((r) => setTimeout(r, 40));
        const downloadedAfterStepModal = window.__LAST_DOWNLOADED_SANDBOX_MD__;
        const chatTriggers = Array.from(document.querySelectorAll('[data-testid="sandbox-markdown-file-trigger"]'));
        chatTriggers[1].click();
        await new Promise((r) => setTimeout(r, 60));
        const modalAfterTrigger = document.querySelector('[data-testid="sandbox-markdown-preview-modal"]');
        const triggerPathBadge = (modalAfterTrigger?.querySelector('[data-testid="sandbox-markdown-path-badge"]')?.textContent || '').trim();
        const triggerRenderedText = (modalAfterTrigger?.querySelector('[data-testid="sandbox-markdown-rendered-body"]')?.textContent || '').trim();
        return {
          previewHasRootCause: previewText.includes('Q4 Revenue Drop Root-Cause Analysis'),
          previewHasOuterwear: previewText.includes('Outerwear stockouts in West region'),
          hasModal: Boolean(modalEl), pathBadgeText,
          renderedHasOuterwear: renderedBodyText.includes('Outerwear stockouts in West region'),
          rawHasMarkdownHeading: rawBodyText.includes('# Q4 Revenue Drop Root-Cause Analysis'),
          copiedAttr,
          clipboardHasAnalysis: (window.__CLIPBOARD_WRITES__ || []).some((t) => t.includes('Q4 Revenue Drop Root-Cause Analysis')),
          downloadedFileName: downloadedAfterStepModal?.fileName || '',
          chatTriggerCount: chatTriggers.length, triggerPathBadge,
          triggerHasRemediation: triggerRenderedText.includes('Executive Remediation Report'),
          envFileCallPaths: (window.__ENVIRONMENT_FILE_CALLS__ || []).map((c) => c.normalizedPath),
          artifactUpdateCount: (window.__ARTIFACT_UPDATES__ || []).length
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })

    expect(res.result.value).toEqual({
      previewHasRootCause: true, previewHasOuterwear: true, hasModal: true, pathBadgeText: '/workspace/analysis.md',
      renderedHasOuterwear: true, rawHasMarkdownHeading: true, copiedAttr: 'true', clipboardHasAnalysis: true,
      downloadedFileName: 'analysis.md', chatTriggerCount: 2, triggerPathBadge: '/workspace/report.md',
      triggerHasRemediation: true, envFileCallPaths: ['workspace/analysis.md', 'workspace/report.md'], artifactUpdateCount: 0
    })
  }, 15000)

  test('Issue #132: renames right pane to Viewer, opens skill and file steps in viewer-document-pane, and hides bottom Thinking section on mobile while sliding up Viewer card on object/step click', async () => {
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="workspace-split-resizer"]'))`, returnByValue: true })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const desktopRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const resizerLabel = document.querySelector('[data-testid="workspace-split-resizer"]')?.getAttribute('aria-label') || '';
        const collapseBtnTitle = document.querySelector('[data-testid="right-pane-collapse-toggle"]')?.getAttribute('title') || '';
        const reloadViewerBtn = Array.from(document.querySelectorAll('.dab-right-pane button')).some((b) => (b.textContent || '').trim() === 'Reload Viewer');
        const iframeTitle = document.querySelector('[data-testid="looker-embed-container"] iframe')?.getAttribute('title') || '';
        window.__DAB_STUDIO__.setMessages([
          { role: 'user', text: 'Build a revenue Data App and investigate drivers' },
          {
            role: 'assistant', text: 'Built app using Data Apps skill and wrote \`/workspace/analysis.md\`.', thinkingDurationSec: 3,
            activitySteps: [
              { id: 'st_skill_da', kind: 'skill', title: 'Reading skill data-apps', detail: '/workspace/skills/data-apps/SKILL.md', path: '/workspace/skills/data-apps/SKILL.md', status: 'done' },
              { id: 'st_file_an', kind: 'file', title: 'Editing analysis.md', detail: '/workspace/analysis.md', path: '/workspace/analysis.md', status: 'done' }
            ]
          }
        ]);
        await new Promise((r) => setTimeout(r, 60));
        const completed = document.querySelector('[data-testid="completed-thinking-block"]');
        completed.querySelector('summary').click();
        await new Promise((r) => setTimeout(r, 40));
        completed.querySelector('[data-testid="thinking-step-skill"] summary').click();
        await new Promise((r) => setTimeout(r, 60));
        const viewerPaneAfterSkill = document.querySelector('[data-testid="viewer-document-pane"]');
        const skillPathBadge = (viewerPaneAfterSkill?.querySelector('[data-testid="viewer-document-path-badge"]')?.textContent || '').trim();
        const skillBodyText = (viewerPaneAfterSkill?.querySelector('[data-testid="viewer-document-body"]')?.textContent || '').trim();
        completed.querySelector('[data-testid="thinking-step-file"] summary').click();
        await new Promise((r) => setTimeout(r, 60));
        const filePathBadge = (document.querySelector('[data-testid="viewer-document-path-badge"]')?.textContent || '').trim();
        const fileBodyText = (document.querySelector('[data-testid="viewer-document-body"]')?.textContent || '').trim();
        document.querySelector('[data-testid="viewer-document-close-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));

        // Issue #151: verify desktop hides mobile-only menu items and supports /skill slash autocomplete
        document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const desktopMobileFolderItemDisplay = window.getComputedStyle(document.querySelector('[data-testid="mobile-menu-folder-btn"]')).display;
        document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 30));

        window.__DAB_STUDIO__.setPrompt('/lookml');
        await new Promise((r) => setTimeout(r, 60));
        const hasSlashMenu = Boolean(document.querySelector('[data-testid="composer-slash-skill-menu"]'));
        document.querySelector('[data-testid="composer-slash-skill-option-lookml-tests"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const promptAfterSlashPick = window.__DAB_STUDIO__.prompt;
        const activatedAfterSlashPick = window.__DAB_STUDIO__.activatedLookmlSkills;

        return {
          resizerLabel, collapseBtnTitle, reloadViewerBtn, iframeTitle,
          hasViewerPaneAfterSkill: Boolean(viewerPaneAfterSkill), skillPathBadge,
          skillBodyHasGuide: skillBodyText.includes('Lit Data App') || skillBodyText.includes('data-app.js'),
          filePathBadge, fileBodyHasAnalysis: fileBodyText.includes('Q4 Revenue Drop Root-Cause Analysis'),
          viewerClosed: !document.querySelector('[data-testid="viewer-document-pane"]'),
          desktopMobileFolderItemDisplay, hasSlashMenu, promptAfterSlashPick, activatedAfterSlashPick
        };
      })()`,
      awaitPromise: true, returnByValue: true
    })

    expect(desktopRes.result.value).toEqual({
      resizerLabel: 'Resize chat and viewer panes', collapseBtnTitle: 'Collapse viewer', reloadViewerBtn: true, iframeTitle: 'Looker Live Viewer',
      hasViewerPaneAfterSkill: true, skillPathBadge: '/workspace/skills/data-apps/SKILL.md', skillBodyHasGuide: true,
      filePathBadge: '/workspace/analysis.md', fileBodyHasAnalysis: true, viewerClosed: true,
      desktopMobileFolderItemDisplay: 'none', hasSlashMenu: true, promptAfterSlashPick: '/lookml-tests ', activatedAfterSlashPick: ['lookml-tests']
    })

    try {
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })
      const mobDeadline = Date.now() + 8000
      while (Date.now() < mobDeadline) {
        const r = await ctx.chrome.send('Runtime.evaluate', { expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('.dab-right-pane'))`, returnByValue: true })
        if (r.result?.value) break
        await new Promise((res) => setTimeout(res, 80))
      }

      const mobRes = await ctx.chrome.send('Runtime.evaluate', {
        expression: `(async () => {
          const s = window.__DAB_STUDIO__;
          const rightPane = document.querySelector('.dab-right-pane');
          const initialCollapsed = s.rightPaneCollapsed;
          const initialDisplay = window.getComputedStyle(rightPane).display;
          s.setPublishedApp(null); s.setContentItems([]); s.setRightPaneCollapsed(false); s.setBusyStatus('Synthesizing Looker query...');
          await new Promise((r) => setTimeout(r, 60));
          const displayWhileThinkingNoContent = window.getComputedStyle(rightPane).display;
          s.setBusyStatus(null);
          s.setPublishedApp({ dashboardId: '42', title: 'Executive Revenue App', folderId: '1', extensionId: 'data_app_builder::data_app_builder', elementId: '101', code: 'export default class {}' });
          s.setRightPaneCollapsed(true);
          await new Promise((r) => setTimeout(r, 60));
          const chip = document.querySelector('[data-testid="chat-object-viewer-chip-data_app:42"]');
          chip.click();
          await new Promise((r) => setTimeout(r, 60));
          const collapsedAfterChipClick = window.__DAB_STUDIO__.rightPaneCollapsed;
          const cardPosition = window.getComputedStyle(rightPane).position;
          const cardDisplay = window.getComputedStyle(rightPane).display;
          const hasCardHandle = Boolean(document.querySelector('[data-testid="mobile-viewer-card-handle"]'));
          document.querySelector('[data-testid="mobile-viewer-card-close"]').click();
          await new Promise((r) => setTimeout(r, 50));

          // Issue #151: verify 1-row mobile top bar hiding and mobile composer '+' menu controls
          const editBtnHiddenOnMobile = window.getComputedStyle(document.querySelector('[data-testid="studio-edit-agent-name-btn"]')).display === 'none';
          const permToggleHiddenOnMobile = window.getComputedStyle(document.querySelector('[data-testid="permission-mode-toggle"]')).display === 'none';
          const folderTriggerHiddenOnMobile = window.getComputedStyle(document.querySelector('[data-testid="topbar-folder-trigger"]')).display === 'none';
          const fullscreenHiddenOnMobile = window.getComputedStyle(document.querySelector('[data-testid="topbar-fullscreen-toggle"]')).display === 'none';

          document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          const mobileFolderBtnDisplay = window.getComputedStyle(document.querySelector('[data-testid="mobile-menu-folder-btn"]')).display;
          const initialPerm = s.requirePermission;
          document.querySelector('[data-testid="mobile-menu-approval-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          const permAfterToggle = window.__DAB_STUDIO__.requirePermission;

          document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          document.querySelector('[data-testid="mobile-menu-folder-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 50));
          const folderModalOpened = Boolean(document.querySelector('[data-testid="folder-advanced-search-modal"]'));
          window.__DAB_STUDIO__.setFolderModalOpen(false);
          await new Promise((r) => setTimeout(r, 40));

          document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          document.querySelector('[data-testid="mobile-menu-edit-agent-name-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 50));
          const agentNameInputOpened = Boolean(document.querySelector('[data-testid="studio-agent-name-input"]'));

          return {
            initialCollapsed, initialDisplay, displayWhileThinkingNoContent,
            hasObjectChip: Boolean(chip), collapsedAfterChipClick, cardPosition, cardDisplay, hasCardHandle,
            collapsedAfterClose: window.__DAB_STUDIO__.rightPaneCollapsed,
            editBtnHiddenOnMobile, permToggleHiddenOnMobile, folderTriggerHiddenOnMobile, fullscreenHiddenOnMobile,
            mobileFolderBtnDisplay, permToggled: permAfterToggle === !initialPerm, folderModalOpened, agentNameInputOpened
          };
        })()`,
        awaitPromise: true, returnByValue: true
      })

      expect(mobRes.result.value).toEqual({
        initialCollapsed: true, initialDisplay: 'none', displayWhileThinkingNoContent: 'none',
        hasObjectChip: true, collapsedAfterChipClick: false, cardPosition: 'absolute', cardDisplay: 'flex', hasCardHandle: true, collapsedAfterClose: true,
        editBtnHiddenOnMobile: true, permToggleHiddenOnMobile: true, folderTriggerHiddenOnMobile: true, fullscreenHiddenOnMobile: true,
        mobileFolderBtnDisplay: 'flex', permToggled: true, folderModalOpened: true, agentNameInputOpened: true
      })
    } finally {
      await ctx.chrome.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    }
  }, 20000)

  test('Issue #156: renders scrollable .lkml file tabs + 3-dot code menu, PanelLeftClose/Open sidebar icon, debounced resizer storage, <Bug /> per-turn & whole-thread sandbox debug copy via clipboardWrite, GFM tables, and uncrushed live thinking block on overflow', async () => {
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=lookml` })
    const lkDeadline = Date.now() + 8000
    while (Date.now() < lkDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="lookml-file-tabs"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const lkRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const noLegacyLookmlInput = !document.querySelector('[data-testid="topbar-lookml-project-input"]');
        const noLegacySessionsSelect = !document.querySelector('[data-testid="topbar-lookml-sessions-select"]');
        const hasUnifiedFolderTrigger = Boolean(document.querySelector('[data-testid="topbar-folder-trigger"]'));
        const sidebarBtn = document.querySelector('[data-testid="sidebar-collapse-toggle"]');
        const sidebarHasSvg = Boolean(sidebarBtn?.querySelector('svg.lucide'));
        const sidebarNoGuillemets = !/[«»]/.test(sidebarBtn?.textContent || '');

        const tabsEl = document.querySelector('[data-testid="lookml-file-tabs"]');
        const tabsStyle = window.getComputedStyle(tabsEl);
        const isSingleLineScrollable = tabsStyle.flexWrap === 'nowrap' && tabsStyle.overflowX === 'auto';

        window.__CLIPBOARD_WRITES__ = [];
        document.querySelector('[data-testid="lookml-code-actions-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const hasActionsMenu = Boolean(document.querySelector('[data-testid="lookml-code-actions-menu"]'));
        const toggleTextBefore = (document.querySelector('[data-testid="lookml-toggle-view-mode-btn"]')?.textContent || '').trim();
        document.querySelector('[data-testid="lookml-toggle-view-mode-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));

        document.querySelector('[data-testid="lookml-code-actions-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const toggleTextAfter = (document.querySelector('[data-testid="lookml-toggle-view-mode-btn"]')?.textContent || '').trim();
        document.querySelector('[data-testid="lookml-copy-file-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const copiedLkmlViaExt = (window.__CLIPBOARD_WRITES__ || []).some((t) => t.includes('measure: total_revenue') || t.includes('orders'));

        return {
          noLegacyLookmlInput, noLegacySessionsSelect, hasUnifiedFolderTrigger,
          sidebarHasSvg, sidebarNoGuillemets, isSingleLineScrollable,
          hasActionsMenu, toggleTextBefore, toggleTextAfter, copiedLkmlViaExt
        };
      })()`,
      awaitPromise: true, returnByValue: true
    })

    expect(lkRes.result.value).toEqual({
      noLegacyLookmlInput: true, noLegacySessionsSelect: true, hasUnifiedFolderTrigger: true,
      sidebarHasSvg: true, sidebarNoGuillemets: true, isSingleLineScrollable: true,
      hasActionsMenu: true, toggleTextBefore: 'View Changeset', toggleTextAfter: 'Back to Files', copiedLkmlViaExt: true
    })

    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })
    const appDeadline = Date.now() + 8000
    while (Date.now() < appDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="workspace-split-resizer"]'))`,
        returnByValue: true
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }

    const chatRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        // 1. Debounced split-pane resizer storage writes (0 mid-drag IPC writes, 1 flushed write on mouseup)
        window.__LOCAL_STORAGE_UPDATES__ = [];
        const resizer = document.querySelector('[data-testid="workspace-split-resizer"]');
        resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 380, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 410, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 440, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 470, bubbles: true }));
        const writesDuringDrag = (window.__LOCAL_STORAGE_UPDATES__ || []).filter((u) => u.key === 'dab_left_pane_width').length;
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const writesAfterMouseUp = (window.__LOCAL_STORAGE_UPDATES__ || []).filter((u) => u.key === 'dab_left_pane_width').length;

        // 2. Overflow chat log + GFM pipe table + <hr> + <ol start> + live thinking block not crushed to 2px + Bug copy buttons
        window.__MOCK_LOOKER_EXTENSION__.mockInteractions = {
          int_chain_2: {
            id: 'int_chain_2', previous_interaction_id: 'int_chain_1', status: 'completed', environment_id: 'env_vis_156',
            steps: [{ id: 's2', type: 'thought', thought: 'Remote sandbox thought from turn 2' }],
            output_text: 'Updated /workspace/analysis.md.'
          },
          int_chain_1: {
            id: 'int_chain_1', status: 'completed', environment_id: 'env_vis_156',
            steps: [{ id: 's1', type: 'code_execution', language: 'BASH', command: 'cat /workspace/analysis.md', stdout: 'SANDBOX_STDOUT_156' }],
            output_text: 'Initial analysis.'
          }
        };
        const manyMsgs = [];
        for (let i = 0; i < 14; i++) {
          manyMsgs.push({ role: 'user', text: 'Follow-up turn ' + (i + 1) + ' with detailed metric filter context' });
          manyMsgs.push({
            role: 'assistant',
            interactionId: i === 13 ? 'int_chain_2' : undefined,
            thinkingDurationSec: 2,
            activitySteps: [{ id: 'st_' + i, kind: 'codemode', title: 'Executing Looker queries...', status: 'done' }],
            text: i === 13
              ? '| Segment | Margin |\\n| :--- | ---: |\\n| Outerwear | $98,400 |\\n\\n---\\n\\n5. Fifth item'
              : 'Assistant response paragraph ' + (i + 1) + ' filling vertical scroll height in chat log.'
          });
        }
        s.setOauthToken('mock_oauth_token_156');
        s.setMessages(manyMsgs);
        s.setBusyStatus('Running sandbox verification...');
        s.setLiveActivitySteps([
          { id: 'live_1', kind: 'thought', title: 'Validating widget queries', detail: 'Checking fields against schema', status: 'running' },
          { id: 'live_2', kind: 'code_execution', language: 'PYTHON', title: 'python3 /workspace/bundle_app.py', status: 'running' }
        ]);
        await new Promise((r) => setTimeout(r, 80));

        const chatLog = document.querySelector('.dab-chat-log');
        const liveBlock = document.querySelector('[data-testid="live-thinking-block"]');
        const liveHeight = liveBlock ? Math.round(liveBlock.getBoundingClientRect().height) : 0;
        const hasGfmTable = Boolean(document.querySelector('[data-testid="chat-markdown-table"]'));
        const hasHr = Boolean(document.querySelector('hr.dab-md-hr'));
        const olStart = document.querySelector('ol.dab-md-list')?.getAttribute('start') || '';

        // Auto-scroll on user send
        chatLog.scrollTop = 0;
        s.setMessages((prev) => [...prev, { role: 'user', text: 'Scroll me to bottom on send' }]);
        await new Promise((r) => setTimeout(r, 60));
        const autoScrolledToBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight <= 20;

        // Per-turn <Bug /> button & Whole-thread <Bug /> Copy Thread button via clipboardWrite
        window.__CLIPBOARD_WRITES__ = [];
        const perTurnBtn = document.querySelector('[data-testid="copy-thinking-trace-btn"]');
        const perTurnTitle = perTurnBtn?.getAttribute('title') || '';
        const perTurnHasBugSvg = Boolean(perTurnBtn?.querySelector('svg.lucide-bug, svg.lucide'));
        perTurnBtn?.click();
        await new Promise((r) => setTimeout(r, 40));
        const perTurnCopiedViaExt = (window.__CLIPBOARD_WRITES__ || []).some((t) => t.includes('## Thinking & Activity Trace'));

        window.__CLIPBOARD_WRITES__ = [];
        const threadBtn = document.querySelector('[data-testid="copy-thread-trace-btn"]');
        threadBtn?.click();
        await new Promise((r) => setTimeout(r, 120));
        const threadDump = (window.__CLIPBOARD_WRITES__ || [])[0] || '';

        return {
          writesDuringDrag, writesAfterMouseUp,
          chatOverflowing: chatLog.scrollHeight > chatLog.clientHeight,
          liveBlockUncrushed: liveHeight >= 40,
          hasGfmTable, hasHr, olStart, autoScrolledToBottom,
          perTurnTitle, perTurnHasBugSvg, perTurnCopiedViaExt,
          threadHasTurn1AndTurn2: threadDump.includes('int_chain_1') && threadDump.includes('int_chain_2'),
          threadHasStdout: threadDump.includes('SANDBOX_STDOUT_156'),
          threadHasLiveStep: threadDump.includes('python3 /workspace/bundle_app.py')
        };
      })()`,
      awaitPromise: true, returnByValue: true
    })

    expect(chatRes.result.value).toEqual({
      writesDuringDrag: 0, writesAfterMouseUp: 1,
      chatOverflowing: true, liveBlockUncrushed: true,
      hasGfmTable: true, hasHr: true, olStart: '5', autoScrolledToBottom: true,
      perTurnTitle: 'Copy debug trace to clipboard', perTurnHasBugSvg: true, perTurnCopiedViaExt: true,
      threadHasTurn1AndTurn2: true, threadHasStdout: true, threadHasLiveStep: true
    })

    // Also verify mobile-menu-copy-thread-btn on <=768px viewport
    try {
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      const mobCopyRes = await ctx.chrome.send('Runtime.evaluate', {
        expression: `(async () => {
          window.__CLIPBOARD_WRITES__ = [];
          const leftHeaderHiddenOnMobile = window.getComputedStyle(document.querySelector('[data-testid="left-pane-header"]')).display === 'none';
          document.querySelector('[data-testid="composer-add-context-btn"]')?.click();
          await new Promise((r) => setTimeout(r, 40));
          const mobCopyBtn = document.querySelector('[data-testid="mobile-menu-copy-thread-btn"]');
          const mobCopyDisplay = mobCopyBtn ? window.getComputedStyle(mobCopyBtn).display : 'missing';
          mobCopyBtn?.click();
          await new Promise((r) => setTimeout(r, 100));
          return {
            leftHeaderHiddenOnMobile,
            mobCopyDisplay,
            copiedOnMobile: (window.__CLIPBOARD_WRITES__ || []).some((t) => t.includes('Conversation Sandbox Debug Dump'))
          };
        })()`,
        awaitPromise: true, returnByValue: true
      })
      expect(mobCopyRes.result.value).toEqual({
        leftHeaderHiddenOnMobile: true,
        mobCopyDisplay: 'flex',
        copiedOnMobile: true
      })
    } finally {
      await ctx.chrome.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    }
  }, 20000)

  test('Issue #155: keeps immutable conv_<id> across LookML -> Dashboard turns with optimistic SWR sidebar insert, hides & restores unified content tabs via 3-dot menu, and navigates synchronously to / on active conversation delete', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="new-conversation-btn"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 100))
    }

    const flowRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DAB_STUDIO__.setAuthMode('apikey');
        window.__DAB_STUDIO__.setApiKey('mock-api-key');
        await new Promise((r) => setTimeout(r, 80));

        window.__INTERACTION_CALLS__ = [];
        window.__ARTIFACT_UPDATES__ = [];
        const ext = window.__DAB_STUDIO__.extensionSDK;
        const origProxy = ext.serverProxy.bind(ext);
        ext.serverProxy = async (url, init) => {
          const body = init && init.body ? JSON.parse(init.body) : {};
          const inputText = (body.input && body.input[0] && body.input[0].text) || '';
          window.__INTERACTION_CALLS__.push({ url, method: (init && init.method) || 'GET', body });
          if (inputText.includes('[CONVERSATION_LABEL_REQUEST]')) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({ id: 'int_lbl_155', status: 'completed', output_text: '"Order Items LookML & UDD"' }),
            };
          }
          if (inputText.includes('order_items.view.lkml')) {
            await new Promise((r) => setTimeout(r, 90));
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_155_turn_1',
                environment_id: 'env_155_shared',
                status: 'completed',
                output_text:
                  '<USE_CASE>lookml</USE_CASE>\\nAdded measures.\\n<LOOKML_BUNDLE>{"id":"thelook_1762720001","title":"Order Items Measures","project_id":"thelook","model_name":"thelook","branch_name":"dev_1","files":[{"path":"views/order_items.view.lkml","action":"updated","content":"view: order_items {}","diff":"@@ -1 +1 @@"}],"validation":{"passed":true,"error_count":0,"errors":[]},"tests":[],"queries":[]}</LOOKML_BUNDLE>',
              }),
            };
          }
          if (inputText.includes('native Looker UDD dashboard')) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_155_turn_2',
                environment_id: 'env_155_shared',
                status: 'completed',
                output_text:
                  '<USE_CASE>dashboard</USE_CASE>\\nCreated Executive KPI UDD.\\n<NATIVE_CONTENT_BUNDLE>{"id":"99","content_type":"dashboard","title":"Executive KPI UDD","folder_id":"5","tile_count":2,"explores":["thelook::order_items"]}</NATIVE_CONTENT_BUNDLE>',
              }),
            };
          }
          return origProxy(url, init);
        };

        // 1. Start fresh conversation at /
        document.querySelector('[data-testid="new-conversation-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));
        const routeAtRoot = window.__DAB_STUDIO__.history.location.pathname;

        // 2. Submit Turn 1 (LookML) and inspect IMMEDIATE optimistic route + sidebar entry before network finishes
        const turn1Promise = window.__DAB_STUDIO__.handleSendPrompt({ text: 'Add total_revenue and gross_margin measures to order_items.view.lkml' });
        await new Promise((r) => setTimeout(r, 15));
        const optimisticRoute = window.__DAB_STUDIO__.history.location.pathname;
        const optimisticConvId = optimisticRoute.replace('/c/', '');
        const optimisticSidebarItem = Boolean(document.querySelector('[data-testid="conversation-item-' + optimisticConvId + '"]'));
        await turn1Promise;
        await new Promise((r) => setTimeout(r, 150));

        const routeAfterLookmlTurn = window.__DAB_STUDIO__.history.location.pathname;
        const lookmlTabPresent = Boolean(document.querySelector('[data-testid^="studio-content-tab-lookml:"]'));

        // 3. Submit Turn 2 (Dashboard) on the SAME conversation -> route & convId stay immutable, messages[] is continuous
        await window.__DAB_STUDIO__.handleSendPrompt({ text: 'Create a native Looker UDD dashboard for executive KPIs' });
        await new Promise((r) => setTimeout(r, 150));

        const routeAfterDashTurn = window.__DAB_STUDIO__.history.location.pathname;
        const matchingSidebarConvs = Array.from(document.querySelectorAll('[data-testid="conversation-item-' + optimisticConvId + '"]')).length;
        const totalMsgCount = window.__DAB_STUDIO__.messages.length;
        const visibleTabEls = Array.from(document.querySelectorAll('[data-testid^="studio-content-tab-"]:not([data-testid^="studio-content-tab-close-"]):not([data-testid^="studio-content-tab-restore-"])'));
        const tabKeysAfter2Turns = visibleTabEls.map((el) => el.getAttribute('data-testid').replace('studio-content-tab-', ''));
        const noMoreBtnBeforeHide = !document.querySelector('[data-testid="studio-content-tabs-more-btn"]');

        // 4. Close (hide) the active dashboard tab -> focuses remaining LookML tab, persists hidden:true, shows 3-dot restore button
        const dashTabKey = tabKeysAfter2Turns.find((k) => k.startsWith('dashboard:'));
        const lookmlTabKey = tabKeysAfter2Turns.find((k) => k.startsWith('lookml:'));
        document.querySelector('[data-testid="studio-content-tab-close-' + dashTabKey + '"]').click();
        await new Promise((r) => setTimeout(r, 100));

        const activeKeyAfterFirstClose = window.__DAB_STUDIO__.activeContentItem?.key || '';
        const moreBtnAfterHide = document.querySelector('[data-testid="studio-content-tabs-more-btn"]');
        const hasMoreBtnAfterHide = Boolean(moreBtnAfterHide);

        // Open 3-dot menu and verify light & dark mode computed styles + restore item presence + union clip rect
        moreBtnAfterHide.click();
        await new Promise((r) => setTimeout(r, 60));
        const menuEl = document.querySelector('[data-testid="studio-content-tabs-more-menu"]');
        const restoreBtn = document.querySelector('[data-testid="studio-content-tab-restore-' + dashTabKey + '"]');
        const lightMenuBg = menuEl ? window.getComputedStyle(menuEl).backgroundColor : '';
        const rects = ['[data-testid="studio-content-tabs"]', '[data-testid="studio-content-tabs-more-menu"]']
          .flatMap((sel) => Array.from(document.querySelectorAll(sel)))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        const ribbonMenuClipValid = rects.length === 2 && rects[1].right <= 1440 && rects[1].bottom <= 900;
        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 40));
        const darkMenuBg = menuEl ? window.getComputedStyle(menuEl).backgroundColor : '';
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));

        // Close remaining LookML tab -> all tabs hidden, ribbon + 3-dot button remain visible, viewer shows empty-hidden state
        document.querySelector('[data-testid="studio-content-tab-close-' + lookmlTabKey + '"]').click();
        await new Promise((r) => setTimeout(r, 80));
        const allHiddenPlaceholder = Boolean(document.querySelector('[data-testid="studio-content-tabs-all-hidden"]'));
        const ribbonStillVisibleWhenAllHidden = Boolean(document.querySelector('[data-testid="studio-content-tabs"]'));

        // Restore dashboard tab from 3-dot menu -> sets hidden:false and activates dashboard tab
        if (!document.querySelector('[data-testid="studio-content-tabs-more-menu"]')) {
          document.querySelector('[data-testid="studio-content-tabs-more-btn"]').click();
          await new Promise((r) => setTimeout(r, 60));
        }
        document.querySelector('[data-testid="studio-content-tab-restore-' + dashTabKey + '"]').click();
        await new Promise((r) => setTimeout(r, 100));
        const activeKeyAfterRestore = window.__DAB_STUDIO__.activeContentItem?.key || '';

        const convUpdates = (window.__ARTIFACT_UPDATES__ || []).filter((u) => u.key === 'user_conversations:1');
        const latestConvs = convUpdates.length ? JSON.parse(convUpdates[convUpdates.length - 1].value) : [];
        const persistedConv = latestConvs.find((c) => c.id === optimisticConvId);
        const hasZeroActivityStepsBloat = !(persistedConv?.messages || []).some((m) => Boolean(m.activitySteps));

        // 5. Synchronous delete-to-/ navigation on active chat-only / conv_<ts> conversation BEFORE deleteUserConversation resolves
        window.__DAB_STUDIO__.setActiveObjectId('');
        const deletePromise = window.__DAB_STUDIO__.handleDeleteConversation(undefined, optimisticConvId, false);
        const routeImmediatelyOnDelete = window.__DAB_STUDIO__.history.location.pathname;
        await deletePromise;

        return {
          routeAtRoot,
          optimisticIsConvPrefix: optimisticRoute.startsWith('/c/conv_'),
          optimisticSidebarItem,
          immutableAcrossLookml: routeAfterLookmlTurn === optimisticRoute,
          immutableAcrossDash: routeAfterDashTurn === optimisticRoute,
          lookmlTabPresent,
          matchingSidebarConvs,
          totalMsgCount,
          hasBothLookmlAndDashTabs: Boolean(lookmlTabKey && dashTabKey),
          noMoreBtnBeforeHide,
          activeKeyAfterFirstCloseMatchesLookml: activeKeyAfterFirstClose === lookmlTabKey,
          hasMoreBtnAfterHide,
          hasRestoreMenuAndItem: Boolean(menuEl && restoreBtn),
          ribbonMenuClipValid,
          themeContrastDistinct: Boolean(lightMenuBg && darkMenuBg && lightMenuBg !== darkMenuBg),
          allHiddenPlaceholder,
          ribbonStillVisibleWhenAllHidden,
          activeKeyAfterRestoreMatchesDash: activeKeyAfterRestore === dashTabKey,
          hasZeroActivityStepsBloat,
          routeImmediatelyOnDelete,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    expect(flowRes.result.value).toEqual({
      routeAtRoot: '/',
      optimisticIsConvPrefix: true,
      optimisticSidebarItem: true,
      immutableAcrossLookml: true,
      immutableAcrossDash: true,
      lookmlTabPresent: true,
      matchingSidebarConvs: 1,
      totalMsgCount: 4,
      hasBothLookmlAndDashTabs: true,
      noMoreBtnBeforeHide: true,
      activeKeyAfterFirstCloseMatchesLookml: true,
      hasMoreBtnAfterHide: true,
      hasRestoreMenuAndItem: true,
      ribbonMenuClipValid: true,
      themeContrastDistinct: true,
      allHiddenPlaceholder: true,
      ribbonStillVisibleWhenAllHidden: true,
      activeKeyAfterRestoreMatchesDash: true,
      hasZeroActivityStepsBloat: true,
      routeImmediatelyOnDelete: '/',
    })
  }, 20000)

}

module.exports = { registerVisualPart07Tests }
