function registerVisualPart08Tests(ctx) {
  const { startHeadlessChrome } = ctx
  test('Issue #166: keeps right pane hidden on chat-only intake turns, merges multi-turn LookML into single lookml:<projectId> tab, auto-opens .dashboard.lookml & chat content links in viewer, and renders LookML details modal + tab hover popover', async () => {
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
      await new Promise((res) => setTimeout(res, 80))
    }

    const res166 = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const dataAppToolbarText = (document.querySelector('.dab-right-pane .dab-ds-toolbar-title-block')?.textContent || '').trim();
        const hasExtensionDbJargon = /Extension\\s+db::/i.test(dataAppToolbarText);

        // Verify <X /> viewer-document-close-btn icon-only button
        await window.__DAB_STUDIO__.openViewerDocument({ path: '/workspace/analysis.md' });
        await new Promise((r) => setTimeout(r, 60));
        const closeDocBtn = document.querySelector('[data-testid="viewer-document-close-btn"]');
        const closeDocBtnText = (closeDocBtn?.textContent || '').trim();
        const closeDocBtnHasSvg = Boolean(closeDocBtn?.querySelector('svg.lucide'));
        closeDocBtn?.click();
        await new Promise((r) => setTimeout(r, 40));

        window.__DAB_STUDIO__.setAuthMode('apikey');
        window.__DAB_STUDIO__.setApiKey('mock-api-key-166');
        await new Promise((r) => setTimeout(r, 60));

        window.__OPENED_WINDOWS__ = [];
        const ext = window.__DAB_STUDIO__.extensionSDK;
        const origProxy = ext.serverProxy.bind(ext);
        const bundleTurn2 = JSON.stringify({
          id: 'bryan_test2_101',
          title: 'Bronze Model',
          project_id: 'bryan_test2',
          model_name: 'bryan_test2',
          branch_name: 'dev_166',
          files: [{
            path: 'bryan_test2.model.lkml',
            action: 'created',
            content: 'connection: "bq"\\n',
            diff: '--- a/bryan_test2.model.lkml\\n+++ b/bryan_test2.model.lkml\\n@@ -0,0 +1 @@\\n+connection: "bq"\\n',
          }],
          validation: { passed: true, error_count: 0, errors: [] },
        });
        const bundleTurn3 = JSON.stringify({
          id: 'bryan_test2_102',
          title: 'Silver & Dashboard',
          project_id: 'bryan_test2',
          model_name: 'bryan_test2',
          branch_name: 'dev_166',
          files: [{
            path: 'dashboards/exec_pulse.dashboard.lookml',
            action: 'created',
            content: '- dashboard: exec_pulse\\n  title: Executive Sales Pulse\\n',
          }],
          validation: { passed: true, error_count: 0, errors: [] },
        });
        ext.serverProxy = async (url, init) => {
          const body = init && init.body ? JSON.parse(init.body) : {};
          const inputText = (body.input && body.input[0] && body.input[0].text) || '';
          if (inputText.includes('[CONVERSATION_LABEL_REQUEST]')) {
            return { ok: true, status: 200, body: JSON.stringify({ id: 'lbl_166', status: 'completed', output_text: 'Bryan Test2 Onboarding' }) };
          }
          if (inputText.includes('Hello, help me plan')) {
            return {
              ok: true, status: 200,
              body: JSON.stringify({
                id: 'int_166_t1', status: 'completed',
                output_text: '<USE_CASE>lookml</USE_CASE>\\nStage 1 $\\\\rightarrow$ Stage 2: please choose a connection and project name.',
              }),
            };
          }
          if (inputText.includes('Create bryan_test2 bronze model')) {
            return {
              ok: true, status: 200,
              body: JSON.stringify({
                id: 'int_166_t2', environment_id: 'env_166', status: 'completed',
                output_text: '<USE_CASE>lookml</USE_CASE>\\nCreated Bronze model. [Open bryan_test2 in Looker IDE](/projects/bryan_test2)\\n<LOOKML_BUNDLE>' + bundleTurn2 + '</LOOKML_BUNDLE>',
              }),
            };
          }
          if (inputText.includes('Add exec_pulse.dashboard.lookml')) {
            return {
              ok: true, status: 200,
              body: JSON.stringify({
                id: 'int_166_t3', environment_id: 'env_166', status: 'completed',
                output_text: '<USE_CASE>lookml</USE_CASE>\\nAdded Silver explore & LookML dashboard. [Open Executive Sales Pulse](/dashboards/bryan_test2::exec_pulse)\\n<LOOKML_BUNDLE>' + bundleTurn3 + '</LOOKML_BUNDLE>',
              }),
            };
          }
          return origProxy(url, init);
        };

        // 1. Fresh conversation -> Turn 1 chat-only intake renders Overview right rail (display:flex) and normalizes LaTeX arrow as →
        document.querySelector('[data-testid="new-conversation-btn"]').click();
        await new Promise((r) => setTimeout(r, 80));
        await window.__DAB_STUDIO__.handleSendPrompt({ text: 'Hello, help me plan a new project' });
        await new Promise((r) => setTimeout(r, 120));
        const rightDisplayAfterChatIntake = window.getComputedStyle(document.querySelector('.dab-right-pane')).display;
        const leftWidthFullOnChatIntake = document.querySelector('.dab-left-pane').getBoundingClientRect().width > 900;
        const chatBodyAfterT1 = document.querySelector('.dab-chat-log')?.innerText || '';
        const normalizedArrowInChat = chatBodyAfterT1.includes('Stage 1 → Stage 2') && !chatBodyAfterT1.includes('\\\\rightarrow');

        // 2. Turn 2 LookML -> opens single lookml:bryan_test2 tab in clean File View
        await window.__DAB_STUDIO__.handleSendPrompt({ text: 'Create bryan_test2 bronze model on bq' });
        await new Promise((r) => setTimeout(r, 140));
        const rightDisplayAfterLookml = window.getComputedStyle(document.querySelector('.dab-right-pane')).display;
        const firstFileTabLabel = (document.querySelector('[data-testid="lookml-file-tab-0"]')?.textContent || '').trim();
        const lookmlToolbarText = (document.querySelector('.dab-right-pane .dab-ds-toolbar-title-block')?.textContent || '').trim();
        const noObjLookmlJargon = !/obj_lookml_/i.test(lookmlToolbarText);

        // Open 3-dot LookML actions menu -> verify View Changeset <-> Back to Files, Open File in IDE & View Details modal
        document.querySelector('[data-testid="lookml-code-actions-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const toggleLabelInFileMode = (document.querySelector('[data-testid="lookml-toggle-view-mode-btn"]')?.textContent || '').trim();
        document.querySelector('[data-testid="lookml-toggle-view-mode-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="lookml-code-actions-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const toggleLabelInDiffMode = (document.querySelector('[data-testid="lookml-toggle-view-mode-btn"]')?.textContent || '').trim();
        document.querySelector('[data-testid="lookml-toggle-view-mode-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));

        document.querySelector('[data-testid="lookml-code-actions-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const noOpenFileMenuBtn = !document.querySelector('[data-testid="lookml-open-file-ide-btn"]');
        document.querySelector('[data-testid="lookml-toolbar-open-ide-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const openedFileIdeUrl = (window.__OPENED_WINDOWS__ || []).slice(-1)[0]?.url || '';

        document.querySelector('[data-testid="lookml-code-actions-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('[data-testid="lookml-view-details-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const detailsModal = document.querySelector('[data-testid="lookml-details-modal"]');
        const hasDetailsModal = Boolean(detailsModal);
        const lightModalBg = detailsModal ? window.getComputedStyle(detailsModal).backgroundColor : '';
        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 40));
        const darkModalBg = detailsModal ? window.getComputedStyle(detailsModal).backgroundColor : '';
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));

        // 3. Turn 3 LookML + .dashboard.lookml -> merges into SAME lookml:bryan_test2 tab AND auto-opens lookml_dashboard:bryan_test2::exec_pulse
        await window.__DAB_STUDIO__.handleSendPrompt({ text: 'Add exec_pulse.dashboard.lookml' });
        await new Promise((r) => setTimeout(r, 150));
        const tabEls = Array.from(document.querySelectorAll('[data-testid^="studio-content-tab-"]:not([data-testid^="studio-content-tab-close-"]):not([data-testid^="studio-content-tab-restore-"])'));
        const tabKeys = tabEls.map((el) => el.getAttribute('data-testid').replace('studio-content-tab-', ''));
        const activeAfterDashAutoUpsert = window.__DAB_STUDIO__.activeContentItem?.key || '';
        const mergedLookmlFileCount = (window.__DAB_STUDIO__.lookmlBundle?.files || []).length;

        // Hover LookML tab -> verify content-tab-popover-lookml:bryan_test2 + lookml-open-ide-btn opens /projects/bryan_test2 (no /files)
        const lookmlTabWrap = document.querySelector('[data-testid="studio-content-tab-lookml:bryan_test2"]')?.parentElement;
        lookmlTabWrap?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));
        const popoverEl = document.querySelector('[data-testid="content-tab-popover-lookml:bryan_test2"]');
        const popoverVisible = popoverEl ? window.getComputedStyle(popoverEl).display !== 'none' : false;
        popoverEl?.querySelector('[data-testid="lookml-open-ide-btn"]')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const openedProjIdeUrl = (window.__OPENED_WINDOWS__ || []).slice(-1)[0]?.url || '';

        // 4. Hide dashboard tab -> per-turn crudItems pill persists in Turn 3 -> click pill unhides & focuses; hide again -> click chat /dashboards/ link -> unhides & focuses in viewer; external btn opens browser window
        document.querySelector('[data-testid="studio-content-tab-close-lookml_dashboard:bryan_test2::exec_pulse"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const crudChip = document.querySelector('[data-testid="chat-object-viewer-chip-lookml_dashboard:bryan_test2::exec_pulse"]');
        const chipHiddenWhenTabHidden = Boolean(crudChip);
        crudChip?.click();
        await new Promise((r) => setTimeout(r, 60));
        document.querySelector('[data-testid="studio-content-tab-close-lookml_dashboard:bryan_test2::exec_pulse"]')?.click();
        await new Promise((r) => setTimeout(r, 60));

        const dashChatLinks = Array.from(document.querySelectorAll('[data-testid="chat-markdown-link"]')).filter((a) => (a.getAttribute('href') || '').includes('/dashboards/bryan_test2::exec_pulse'));
        const openCountBeforeChatClick = (window.__OPENED_WINDOWS__ || []).length;
        dashChatLinks[0]?.click();
        await new Promise((r) => setTimeout(r, 80));
        const openCountAfterChatClick = (window.__OPENED_WINDOWS__ || []).length;
        const activeAfterChatLinkClick = window.__DAB_STUDIO__.activeContentItem?.key || '';
        const chipRestoredAfterChatClick = Boolean(document.querySelector('[data-testid="chat-object-viewer-chip-lookml_dashboard:bryan_test2::exec_pulse"]'));

        const extBtn = dashChatLinks[0]?.parentElement?.querySelector('[data-testid="markdown-link-external-btn"]');
        extBtn?.click();
        await new Promise((r) => setTimeout(r, 40));
        const openedViaExtBtn = (window.__OPENED_WINDOWS__ || []).slice(-1)[0]?.url || '';

        ext.serverProxy = origProxy;
        return {
          hasExtensionDbJargon,
          closeDocBtnText,
          closeDocBtnHasSvg,
          rightDisplayAfterChatIntake,
          leftWidthFullOnChatIntake,
          normalizedArrowInChat,
          rightDisplayAfterLookml,
          firstFileTabLabel,
          noObjLookmlJargon,
          toggleLabelInFileMode,
          toggleLabelInDiffMode,
          noOpenFileMenuBtn,
          openedFileIdeUrl,
          hasDetailsModal,
          modalThemeDistinct: Boolean(lightModalBg && darkModalBg && lightModalBg !== darkModalBg),
          tabKeys,
          activeAfterDashAutoUpsert,
          mergedLookmlFileCount,
          popoverVisible,
          openedProjIdeUrl,
          chipHiddenWhenTabHidden,
          didNotOpenWindowOnChatContentLink: openCountAfterChatClick === openCountBeforeChatClick,
          activeAfterChatLinkClick,
          chipRestoredAfterChatClick,
          openedViaExtBtn,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    expect(res166.result.value).toEqual({
      hasExtensionDbJargon: false,
      closeDocBtnText: '',
      closeDocBtnHasSvg: true,
      rightDisplayAfterChatIntake: 'flex',
      leftWidthFullOnChatIntake: true,
      normalizedArrowInChat: true,
      rightDisplayAfterLookml: 'flex',
      firstFileTabLabel: 'Mbryan_test2',
      noObjLookmlJargon: true,
      toggleLabelInFileMode: 'View Changeset',
      toggleLabelInDiffMode: 'Back to Files',
      noOpenFileMenuBtn: true,
      openedFileIdeUrl: '/projects/bryan_test2/files/bryan_test2.model.lkml',
      hasDetailsModal: true,
      modalThemeDistinct: true,
      tabKeys: ['lookml:bryan_test2', 'lookml_dashboard:bryan_test2::exec_pulse'],
      activeAfterDashAutoUpsert: 'lookml_dashboard:bryan_test2::exec_pulse',
      mergedLookmlFileCount: 2,
      popoverVisible: true,
      openedProjIdeUrl: '/projects/bryan_test2',
      chipHiddenWhenTabHidden: true,
      didNotOpenWindowOnChatContentLink: true,
      activeAfterChatLinkClick: 'lookml_dashboard:bryan_test2::exec_pulse',
      chipRestoredAfterChatClick: true,
      openedViaExtBtn: '/dashboards/bryan_test2::exec_pulse',
    })
  }, 20000)

  test('Issue #165: expandable untruncated step code, retained Thinking & Activity after turn completion, lazy reload hydration via hydrateInteractionActivitySteps, and local SKILL.md resolution without 404 overwrite', async () => {
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
      await new Promise((res) => setTimeout(res, 60))
    }

    const res = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DAB_STUDIO__.setAuthMode('apikey');
        window.__DAB_STUDIO__.setApiKey('mock-api-key');
        await new Promise((r) => setTimeout(r, 80));

        window.__INTERACTION_CALLS__ = [];
        window.__ARTIFACT_UPDATES__ = [];
        window.__MOCK_FORCE_ENV_FILE_404__ = true;
        window.__MOCK_LOOKER_EXTENSION__.mockInteractions = {
          int_165_hist_prev: {
            id: 'int_165_hist_prev',
            status: 'completed',
            steps: [{ id: 's_old_leak', type: 'thought', summary: 'Prior turn step must NOT leak into turn 2' }],
          },
          int_165_hist_2a: {
            id: 'int_165_hist_2a',
            previous_interaction_id: 'int_165_hist_prev',
            status: 'requires_action',
            steps: [
              { id: 's_skill_165', type: 'function_call', name: 'lookup_skill', arguments: { skill: 'looker-dashboard' } },
              {
                id: 's_cm_165',
                type: 'function_call',
                name: 'run_looker_codemode',
                arguments: {
                  thought: 'Profile order_items distributions via Looker Code Mode before charting',
                  code: Array.from({ length: 12 }, (_, i) => '# line ' + (i + 1) + '\\nres = profile_fields("thelook", "order_items")').join('\\n'),
                },
                endpoint_logs: ['GET /api/4.0/lookml_models/thelook/explores/order_items (41ms)'],
              },
            ],
          },
          int_165_hist_2b: {
            id: 'int_165_hist_2b',
            previous_interaction_id: 'int_165_hist_2a',
            status: 'completed',
            input: [{ type: 'function_result', call_id: 's_cm_165', name: 'run_looker_codemode', result: { row_count: 42 } }],
            steps: [{ id: 's_bash_165', type: 'code_execution', code: 'ls -la /workspace/skills/looker-dashboard\\nwc -l /workspace/AGENTS.md', stdout: 'total 12\\n148 /workspace/AGENTS.md' }],
            output_text: 'Built KPI dashboard.',
          },
        };

        const ext = window.__DAB_STUDIO__.extensionSDK;
        const origProxy = ext.serverProxy.bind(ext);
        ext.serverProxy = async (url, init) => {
          const body = init && init.body ? JSON.parse(init.body) : {};
          const inputText = (body.input && body.input[0] && body.input[0].text) || '';
          if (inputText.includes('Inspect order_items for #165')) {
            window.__INTERACTION_CALLS__.push({ url, method: (init && init.method) || 'GET', body });
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_165_live_turn1',
                environment_id: 'env_165_live',
                status: 'completed',
                steps: [
                  { id: 's_live_skill', type: 'function_call', name: 'lookup_skill', arguments: { skill: 'looker-dashboard' } },
                  {
                    id: 's_live_exec',
                    type: 'code_execution',
                    code: Array.from({ length: 10 }, (_, i) => 'echo "step line ' + (i + 1) + '"').join('\\n'),
                    stdout: 'step line 1\\nstep line 10',
                  },
                ],
                output_text: '<USE_CASE>conversational-analytics</USE_CASE>\\nOrder revenue is $14.01M across 303,454 orders.',
              }),
            };
          }
          return origProxy(url, init);
        };

        // 1. Fresh Turn 1: verify completed-thinking-block stays mounted after user_conversations:1 persistence & expandable step <pre> works
        document.querySelector('[data-testid="new-conversation-btn"]').click();
        await new Promise((r) => setTimeout(r, 60));
        await window.__DAB_STUDIO__.handleSendPrompt({ text: 'Inspect order_items for #165' });
        await new Promise((r) => setTimeout(r, 160));

        const liveThinkingBlock = document.querySelector('[data-testid="completed-thinking-block"]');
        const retainedAfterPersist = Boolean(liveThinkingBlock);
        liveThinkingBlock.querySelector('summary').click();
        await new Promise((r) => setTimeout(r, 50));

        const expandableStep = liveThinkingBlock.querySelector('[data-testid="thinking-step-expandable"]');
        const collapsedByDefault = Boolean(expandableStep && !expandableStep.open);
        expandableStep.querySelector('summary').click();
        await new Promise((r) => setTimeout(r, 40));
        const preEl = expandableStep.querySelector('.dab-thinking-step-pre');
        const preText = preEl ? preEl.textContent : '';
        const lightPreBg = preEl ? window.getComputedStyle(preEl).backgroundColor : '';
        window.__DAB_STUDIO__.setThemeMode('dark');
        await new Promise((r) => setTimeout(r, 40));
        const darkPreBg = preEl ? window.getComputedStyle(preEl).backgroundColor : '';
        window.__DAB_STUDIO__.setThemeMode('light');
        await new Promise((r) => setTimeout(r, 40));

        const convUpdates = (window.__ARTIFACT_UPDATES__ || []).filter((u) => u.key === 'user_conversations:1');
        const latestConvs = convUpdates.length ? JSON.parse(convUpdates[convUpdates.length - 1].value) : [];
        const zeroPersistedActivitySteps = !latestConvs.some((c) => (c.messages || []).some((m) => Boolean(m.activitySteps)));

        // 2. Clicking built-in skill step with __MOCK_FORCE_ENV_FILE_404__ = true resolves locally with 0 remote /files calls
        const envCallsBeforeSkillClick = window.__INTERACTION_CALLS__.filter((c) => c.url.includes('/environments/')).length;
        const skillStepEl = liveThinkingBlock.querySelector('[data-testid="thinking-step-skill"]');
        skillStepEl.click();
        await new Promise((r) => setTimeout(r, 80));
        const envCallsAfterSkillClick = window.__INTERACTION_CALLS__.filter((c) => c.url.includes('/environments/')).length;
        const viewerDocText = document.querySelector('[data-testid="viewer-document-pane"]')?.innerText || '';
        const skillResolvedLocally =
          envCallsAfterSkillClick === envCallsBeforeSkillClick &&
          viewerDocText.length > 100 &&
          !viewerDocText.includes('Error Loading File');

        // Also verify non-builtin openViewerDocument with initialContent is NEVER overwritten when remote 404s
        await window.__DAB_STUDIO__.openViewerDocument({
          path: '/workspace/custom_investigation_notes.md',
          title: 'Custom Notes',
          kind: 'markdown',
          initialContent: '# Preserved Local Snapshot\\nKeep this exact body on 404.',
        });
        await new Promise((r) => setTimeout(r, 80));
        const preservedViewerText = document.querySelector('[data-testid="viewer-document-pane"]')?.innerText || '';
        const initialContentPreservedOn404 =
          preservedViewerText.includes('Preserved Local Snapshot') &&
          !preservedViewerText.includes('Error Loading File');

        // 3. Reload / historical messages with interactionId & NO activitySteps -> collapsed block + lazy StudioSkeleton + chain walk
        window.__MOCK_INTERACTION_DELAY_MS__ = 110;
        window.__DAB_STUDIO__.setMessages([
          { role: 'user', text: 'First question' },
          { role: 'assistant', text: 'First answer', interactionId: 'int_165_hist_prev' },
          { role: 'user', text: 'Second question' },
          { role: 'assistant', text: 'Built KPI dashboard.', interactionId: 'int_165_hist_2b' },
        ]);
        await new Promise((r) => setTimeout(r, 60));

        const blocks = Array.from(document.querySelectorAll('[data-testid="completed-thinking-block"]'));
        const turn2Block = blocks[1];
        const renderedCollapsedFromInteractionIdOnly = blocks.length === 2 && !turn2Block.open;
        turn2Block.open = true;
        turn2Block.dispatchEvent(new Event('toggle'));
        await new Promise((r) => setTimeout(r, 30));
        const sawSkeletonWhileHydrating = Boolean(turn2Block.querySelector('[data-testid="thinking-hydration-loading"]'));
        await new Promise((r) => setTimeout(r, 260));

        const hydratedText = turn2Block.innerText || '';
        const hydratedExpandables = Array.from(turn2Block.querySelectorAll('[data-testid="thinking-step-expandable"]'));
        hydratedExpandables.forEach((d) => { d.open = true; });
        await new Promise((r) => setTimeout(r, 30));
        const hydratedPreText = Array.from(turn2Block.querySelectorAll('.dab-thinking-step-pre')).map((el) => el.textContent).join('\\n');

        return {
          retainedAfterPersist,
          collapsedByDefault,
          untruncatedPreLines: preText.includes('step line 1') && preText.includes('step line 10') && preText.includes('# Output'),
          themeDistinctPreBg: Boolean(lightPreBg && darkPreBg && lightPreBg !== darkPreBg),
          zeroPersistedActivitySteps,
          skillResolvedLocally,
          initialContentPreservedOn404,
          renderedCollapsedFromInteractionIdOnly,
          sawSkeletonWhileHydrating,
          hydratedWalkedChainWithoutPriorTurnLeak:
            hydratedText.includes('Reading skill looker-dashboard') &&
            hydratedText.includes('Profile order_items distributions before charting') &&
            !hydratedText.includes('via Looker Code Mode') &&
            !hydratedText.includes('Prior turn step must NOT leak') &&
            hydratedPreText.includes('# line 12') &&
            hydratedPreText.includes('GET /api/4.0/lookml_models/thelook/explores/order_items (41ms)') &&
            hydratedPreText.includes('"row_count": 42'),
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    expect(res.result.value).toEqual({
      retainedAfterPersist: true,
      collapsedByDefault: true,
      untruncatedPreLines: true,
      themeDistinctPreBg: true,
      zeroPersistedActivitySteps: true,
      skillResolvedLocally: true,
      initialContentPreservedOn404: true,
      renderedCollapsedFromInteractionIdOnly: true,
      sawSkeletonWhileHydrating: true,
      hydratedWalkedChainWithoutPriorTurnLeak: true,
    })
  }, 20000)

}

module.exports = { registerVisualPart08Tests }
