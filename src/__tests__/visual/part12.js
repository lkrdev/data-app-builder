function registerVisualPart12Tests(ctx) {
  const { startHeadlessChrome } = ctx
  test('Issue #190: Safe Mode (Ask) gates host-side Data App publishing (create_dashboard & update_dashboard) and resets turn-scoped approvals across turns', async () => {
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=dashboard` })
    const readyDeadline = Date.now() + 8000
    while (Date.now() < readyDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="new-conversation-btn"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 80))
    }
    const safeModeRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        window.__DAB_STUDIO__.setAuthMode('apikey');
        window.__DAB_STUDIO__.setApiKey('mock-api-key');
        await new Promise((r) => setTimeout(r, 80));

        const sdk = window.__DAB_STUDIO__.core40SDK;
        const pubMutations = [];
        const origRawReq = sdk.authSession.transport.rawRequest;
        sdk.authSession.transport.rawRequest = async (method, reqPath, queryParams, body) => {
          const m = String(method || 'GET').toUpperCase();
          if (reqPath.includes('/data_app_extension')) {
            pubMutations.push(m + ' ' + reqPath);
            return { ok: true, statusCode: 200, body: JSON.stringify({ id: 'db::ext-190' }) };
          }
          if (m === 'POST' && reqPath === '/dashboards') {
            pubMutations.push('POST /dashboards');
            return { ok: true, statusCode: 200, body: JSON.stringify({ id: '190' }) };
          }
          if (m === 'POST' && reqPath === '/dashboard_elements') {
            pubMutations.push('POST /dashboard_elements');
            return { ok: true, statusCode: 200, body: JSON.stringify({ id: '501' }) };
          }
          if (m === 'PATCH' && reqPath.startsWith('/dashboard_layouts/')) {
            pubMutations.push('PATCH ' + reqPath);
            return { ok: true, statusCode: 200, body: JSON.stringify({ id: '201' }) };
          }
          if (m === 'DELETE' && reqPath.startsWith('/dashboards/')) {
            pubMutations.push('DELETE ' + reqPath);
            return { ok: true, statusCode: 200, body: '' };
          }
          return origRawReq(method, reqPath, queryParams, body);
        };
        sdk.update_dashboard = async (id, body) => {
          pubMutations.push('PATCH /dashboards/' + id + ':' + (body && body.title));
          return { id: String(id), title: body && body.title };
        };
        sdk.update_dashboard_element = async (id) => {
          pubMutations.push('PATCH /dashboard_elements/' + id);
          return { id: String(id) };
        };

        const ext = window.__DAB_STUDIO__.extensionSDK;
        const origProxy = ext.serverProxy.bind(ext);
        let turnNum = 0;
        let nextTurnKind = 'app';
        ext.serverProxy = async (url, init) => {
          const u = String(url || '');
          const body = init && init.body ? JSON.parse(init.body) : {};
          const inputText = (body.input && body.input[0] && body.input[0].text) || '';
          if (inputText.includes('[CONVERSATION_LABEL_REQUEST]')) {
            return { ok: true, status: 200, body: JSON.stringify({ id: 'int_lbl_190', status: 'completed', output_text: 'Safe Pulse App' }) };
          }
          if (u.includes('/interactions') && String((init && init.method) || 'GET').toUpperCase() === 'POST') {
            turnNum += 1;
            if (nextTurnKind === 'qa') {
              return {
                ok: true,
                status: 200,
                body: JSON.stringify({
                  id: 'int_190_qa_' + turnNum,
                  environment_id: 'env_190',
                  status: 'completed',
                  output_text: '<USE_CASE>app</USE_CASE>\\nSafe Pulse v3 currently displays zero widgets.'
                })
              };
            }
            if (nextTurnKind === 'tile') {
              return {
                ok: true,
                status: 200,
                body: JSON.stringify({
                  id: 'int_190_t' + turnNum,
                  environment_id: 'env_190',
                  status: 'completed',
                  output_text: '<USE_CASE>tile</USE_CASE>\\nGenerated cleanup script:\\n\`\`\`python\\nreturn delete_dashboard("190")\\n\`\`\`'
                })
              };
            }
            const appBundle = JSON.stringify({
              title: 'Safe Pulse v' + turnNum,
              raw_code: 'export class SafePulse extends DataApp {}',
              prod_code: 'export class SafePulse extends DataApp {}',
              widgets: []
            });
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_190_t' + turnNum,
                environment_id: 'env_190',
                status: 'completed',
                output_text: '<USE_CASE>app</USE_CASE>\\nBuilt Safe Pulse v' + turnNum + '.\\n<DATA_APP_BUNDLE>' + appBundle + '</DATA_APP_BUNDLE>'
              })
            };
          }
          return origProxy(url, init);
        };

        document.querySelector('[data-testid="new-conversation-btn"]').click();
        await new Promise((r) => setTimeout(r, 60));
        const defaultRequirePerm = window.__DAB_STUDIO__.requirePermission;

        // Turn 1: create_dashboard pauses in Safe Mode before upsertPublishedDataApp; approve with allow_all
        const t1 = window.__DAB_STUDIO__.handleSendPrompt({ text: 'Build Safe Pulse v1' });
        await new Promise((r) => setTimeout(r, 120));
        const t1Perm = window.__DAB_STUDIO__.pendingPerm?.req || null;
        const t1ThoughtDom = document.querySelector('[data-testid="permission-request-thought"]')?.textContent?.trim() || '';
        const mutationsBeforeApproveT1 = pubMutations.length;
        window.__DAB_STUDIO__.resolvePermDecision('allow_all');
        await t1;
        await new Promise((r) => setTimeout(r, 80));
        const publishedDashAfterT1 = window.__DAB_STUDIO__.publishedApp?.dashboardId || '';
        const mutationsAfterT1 = pubMutations.slice();

        // Turn 2: approvedOpsRef MUST reset at start of handleSendPrompt even though Turn 1 chose 'allow_all'!
        // Prompts update_dashboard on PATCH /api/4.0/dashboards/190; click 'deny' -> blocks mutation and records PermissionError
        pubMutations.length = 0;
        const t2 = window.__DAB_STUDIO__.handleSendPrompt({ text: 'Update Safe Pulse v2' });
        await new Promise((r) => setTimeout(r, 120));
        const t2Perm = window.__DAB_STUDIO__.pendingPerm?.req || null;
        window.__DAB_STUDIO__.resolvePermDecision('deny');
        await t2;
        await new Promise((r) => setTimeout(r, 80));
        const mutationsAfterDeniedT2 = pubMutations.length;
        const lastMsgAfterDeniedT2 = window.__DAB_STUDIO__.messages[window.__DAB_STUDIO__.messages.length - 1] || null;
        const sessionInteractionPreserved = window.__DAB_STUDIO__.agentSession?.lastInteractionId === 'int_190_t2';

        // Turn 3: approve update_dashboard ('allow_op') -> executes PATCH /dashboards/190 and PATCH /data_app_extension/...
        pubMutations.length = 0;
        const t3 = window.__DAB_STUDIO__.handleSendPrompt({ text: 'Update Safe Pulse v3' });
        await new Promise((r) => setTimeout(r, 120));
        const t3Perm = window.__DAB_STUDIO__.pendingPerm?.req || null;
        window.__DAB_STUDIO__.resolvePermDecision('allow_op');
        await t3;
        await new Promise((r) => setTimeout(r, 80));
        const mutationsAfterAllowedT3 = pubMutations.slice();
        const titleAfterT3 = window.__DAB_STUDIO__.publishedApp?.title || '';

        // Turn 4: abort via handleStopTurn() while pendingPerm is open -> clears pendingPerm without mutating or overwriting agentSession
        pubMutations.length = 0;
        const t4 = window.__DAB_STUDIO__.handleSendPrompt({ text: 'Update Safe Pulse v4' });
        await new Promise((r) => setTimeout(r, 120));
        const t4HadPerm = Boolean(window.__DAB_STUDIO__.pendingPerm);
        window.__DAB_STUDIO__.handleStopTurn();
        await t4;
        await new Promise((r) => setTimeout(r, 60));
        const permClearedAfterStop = window.__DAB_STUDIO__.pendingPerm === null;
        const mutationsAfterStoppedT4 = pubMutations.length;
        const sessionStayedOnT3AfterStop = window.__DAB_STUDIO__.agentSession?.lastInteractionId === 'int_190_t3';

        // Turn 4b: read-only non-bundle Q&A follow-up while publishedApp (#190) is active in Safe Mode does NOT call sdk.update_dashboard_element
        pubMutations.length = 0;
        nextTurnKind = 'qa';
        await window.__DAB_STUDIO__.handleSendPrompt({ text: 'Explain Safe Pulse v3' });
        await new Promise((r) => setTimeout(r, 60));
        nextTurnKind = 'app';
        const qaNoDashboardElemMut = pubMutations.length === 0 && window.__DAB_STUDIO__.publishedApp?.dashboardId === '190';

        // Turn 5: auto-executed tile Python script + standalone handleRunPython (manual Run Python / loadScriptById) enforce Safe Mode
        pubMutations.length = 0;
        const origScriptCode = window.__DAB_STUDIO__.scriptCode;
        const scriptTabsBeforeT5 = window.__DAB_STUDIO__.contentItems.filter((it) => it.contentType === 'script').length;
        nextTurnKind = 'tile';
        const t5 = window.__DAB_STUDIO__.handleSendPrompt({ text: 'Write a reusable Python script to delete dashboard 190' });
        await new Promise((r) => setTimeout(r, 220));
        const t5PermOp = window.__DAB_STUDIO__.pendingPerm?.req?.operation || '';
        window.__DAB_STUDIO__.resolvePermDecision('deny');
        await t5;
        await new Promise((r) => setTimeout(r, 80));
        nextTurnKind = 'app';
        const t5DeniedMsg = window.__DAB_STUDIO__.messages[window.__DAB_STUDIO__.messages.length - 1]?.text || '';
        const t5ScriptCodeUnchanged = window.__DAB_STUDIO__.scriptCode === origScriptCode;
        const t5NoScriptSaved = window.__DAB_STUDIO__.contentItems.filter((it) => it.contentType === 'script').length === scriptTabsBeforeT5;
        const t5Mutations = pubMutations.length;

        // Standalone read-only handleRunPython auto-executes with 0 prompts; standalone mutating handleRunPython prompts in Safe Mode
        const roPyPromise = window.__DAB_STUDIO__.handleRunPython('return all_lookml_models()');
        const roHadNoPrompt = window.__DAB_STUDIO__.pendingPerm === null;
        await roPyPromise;
        const mutPyPromise = window.__DAB_STUDIO__.handleRunPython('return delete_dashboard("190")');
        await new Promise((r) => setTimeout(r, 120));
        const standaloneMutPermOp = window.__DAB_STUDIO__.pendingPerm?.req?.operation || '';
        window.__DAB_STUDIO__.resolvePermDecision('deny');
        const standaloneMutOut = await mutPyPromise;
        await new Promise((r) => setTimeout(r, 50));

        // Turn 6: live setRequirePermission(false) while pendingPerm is open resolves 'allow_once', and re-enabling Safe Mode does NOT leak '*'
        pubMutations.length = 0;
        const t6 = window.__DAB_STUDIO__.handleSendPrompt({ text: 'Update Safe Pulse v6' });
        await new Promise((r) => setTimeout(r, 120));
        const t6HadPermBeforeToggle = Boolean(window.__DAB_STUDIO__.pendingPerm);
        window.__DAB_STUDIO__.setRequirePermission(false);
        await t6;
        await new Promise((r) => setTimeout(r, 80));
        const t6PublishedAfterYolo = pubMutations.some((m) => m.startsWith('PATCH /dashboards/190:'));
        window.__DAB_STUDIO__.setRequirePermission(true);
        await new Promise((r) => setTimeout(r, 40));
        const reEnabledSafePy = window.__DAB_STUDIO__.handleRunPython('return delete_dashboard("190")');
        await new Promise((r) => setTimeout(r, 120));
        const reEnabledSafeStillPrompts = window.__DAB_STUDIO__.pendingPerm?.req?.operation === 'delete_dashboard';
        window.__DAB_STUDIO__.resolvePermDecision('deny');
        await reEnabledSafePy;
        await new Promise((r) => setTimeout(r, 50));

        // Turn 7: switching conversations (handleNewConversation) while pendingPerm is open cancels the turn with 0 mutations AND does NOT pollute new conversation messages
        pubMutations.length = 0;
        const t7 = window.__DAB_STUDIO__.handleSendPrompt({ text: 'Update Safe Pulse v7' });
        await new Promise((r) => setTimeout(r, 120));
        const t7HadPerm = Boolean(window.__DAB_STUDIO__.pendingPerm);
        window.__DAB_STUDIO__.handleNewConversation('auto');
        await t7;
        await new Promise((r) => setTimeout(r, 80));
        const permClearedAfterSwitch = window.__DAB_STUDIO__.pendingPerm === null;
        const mutationsAfterSwitchedT7 = pubMutations.length;
        const newConvMsgsClean = window.__DAB_STUDIO__.messages.length === 0 && window.__DAB_STUDIO__.busyStatus === null;

        // Turn 8: standalone handleRunPython running slow read-only call before mutation does NOT pop late prompt or leave busyStatus stuck after conversation switch
        window.__DAB_STUDIO__.setActiveConversationId('conv_slow_script_A');
        await new Promise((r) => setTimeout(r, 40));
        let slowReadTriggered = false;
        const prevRaw8 = sdk.authSession.transport.rawRequest;
        sdk.authSession.transport.rawRequest = async (method, reqPath, queryParams, body) => {
          if (String(method || 'GET').toUpperCase() === 'GET' && String(reqPath || '').includes('/projects')) {
            slowReadTriggered = true;
            await new Promise((r) => setTimeout(r, 140));
            return { ok: true, statusCode: 200, body: '[]' };
          }
          return prevRaw8(method, reqPath, queryParams, body);
        };
        const slowStandalone = window.__DAB_STUDIO__.handleRunPython('all_projects()\\nreturn delete_dashboard("190")');
        await new Promise((r) => setTimeout(r, 40));
        window.__DAB_STUDIO__.setActiveConversationId('conv_switched_B');
        await new Promise((r) => setTimeout(r, 20));
        const busyClearedImmediatelyOnSwitch = window.__DAB_STUDIO__.busyStatus === null;
        const slowStandaloneOut = await slowStandalone;
        await new Promise((r) => setTimeout(r, 40));
        sdk.authSession.transport.rawRequest = prevRaw8;
        const noZombiePromptInConvB =
          window.__DAB_STUDIO__.pendingPerm === null &&
          window.__DAB_STUDIO__.busyStatus === null &&
          busyClearedImmediatelyOnSwitch &&
          pubMutations.length === 0 &&
          slowReadTriggered &&
          String(slowStandaloneOut).includes('PermissionError:');

        return {
          defaultRequirePerm,
          t1Op: t1Perm?.operation,
          t1Method: t1Perm?.httpMethod,
          t1Path: t1Perm?.path,
          t1ThoughtDom,
          mutationsBeforeApproveT1,
          publishedDashAfterT1,
          hasCreateMutationsT1: mutationsAfterT1.includes('POST /dashboards') && mutationsAfterT1.some((m) => m.startsWith('POST /data_app_extension')),
          t2Op: t2Perm?.operation,
          t2Method: t2Perm?.httpMethod,
          t2Path: t2Perm?.path,
          mutationsAfterDeniedT2,
          deniedRole: lastMsgAfterDeniedT2?.role,
          deniedHasPermErr: String(lastMsgAfterDeniedT2?.text || '').includes("PermissionError: Operation 'update_dashboard' mutates Looker state and was not approved."),
          sessionInteractionPreserved,
          t3Op: t3Perm?.operation,
          hasUpdateMutationsT3: mutationsAfterAllowedT3.some((m) => m.startsWith('PATCH /dashboards/190:')) && mutationsAfterAllowedT3.some((m) => m.startsWith('PATCH /data_app_extension/')),
          titleAfterT3,
          t4HadPerm,
          permClearedAfterStop,
          mutationsAfterStoppedT4,
          sessionStayedOnT3AfterStop,
          qaNoDashboardElemMut,
          t5PermOp,
          t5DeniedHasPermErr: t5DeniedMsg.includes("PermissionError: Operation 'delete_dashboard'"),
          t5ScriptCodeUnchanged,
          t5NoScriptSaved,
          t5Mutations,
          roHadNoPrompt,
          standaloneMutPermOp,
          standaloneMutDenied: String(standaloneMutOut).includes("PermissionError: Operation 'delete_dashboard'"),
          t6HadPermBeforeToggle,
          t6PublishedAfterYolo,
          reEnabledSafeStillPrompts,
          t7HadPerm,
          permClearedAfterSwitch,
          mutationsAfterSwitchedT7,
          newConvMsgsClean,
          noZombiePromptInConvB
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    expect(safeModeRes.result.value).toEqual({
      defaultRequirePerm: true,
      t1Op: 'create_dashboard',
      t1Method: 'POST',
      t1Path: '/api/4.0/dashboards',
      t1ThoughtDom: 'Publish Data App "Safe Pulse v1" to Looker dashboard',
      mutationsBeforeApproveT1: 0,
      publishedDashAfterT1: '190',
      hasCreateMutationsT1: true,
      t2Op: 'update_dashboard',
      t2Method: 'PATCH',
      t2Path: '/api/4.0/dashboards/190',
      mutationsAfterDeniedT2: 0,
      deniedRole: 'error',
      deniedHasPermErr: true,
      sessionInteractionPreserved: true,
      t3Op: 'update_dashboard',
      hasUpdateMutationsT3: true,
      titleAfterT3: 'Safe Pulse v3',
      t4HadPerm: true,
      permClearedAfterStop: true,
      mutationsAfterStoppedT4: 0,
      sessionStayedOnT3AfterStop: true,
      qaNoDashboardElemMut: true,
      t5PermOp: 'delete_dashboard',
      t5DeniedHasPermErr: true,
      t5ScriptCodeUnchanged: true,
      t5NoScriptSaved: true,
      t5Mutations: 0,
      roHadNoPrompt: true,
      standaloneMutPermOp: 'delete_dashboard',
      standaloneMutDenied: true,
      t6HadPermBeforeToggle: true,
      t6PublishedAfterYolo: true,
      reEnabledSafeStillPrompts: true,
      t7HadPerm: true,
      permClearedAfterSwitch: true,
      mutationsAfterSwitchedT7: 0,
      newConvMsgsClean: true,
      noZombiePromptInConvB: true,
    })
  }, 25000)

  test('Issue #196: supports .sql/.json drag-drop onto chat-composer-dropzone, renders chat-attached-file chips & Overview filenames, removes Overview Hidden badge, links dashboard/Look contentRows, and isolates Turn Code Mode API Calls per conversation', async () => {
    ctx.chrome.close()
    ctx.chrome = await startHeadlessChrome()
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await ctx.chrome.send('Page.navigate', { url: `http://127.0.0.1:${ctx.port}/?scenario=data_app` })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="chat-composer-dropzone"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const res196 = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        const s = window.__DAB_STUDIO__;
        const dropzone = document.querySelector('[data-testid="chat-composer-dropzone"]');
        const dt = new DataTransfer();
        dt.items.add(new File(['SELECT region, SUM(sale_price) FROM order_items GROUP BY 1;'], 'revenue_by_region.sql', { type: '' }));
        dt.items.add(new File(['{"model":"thelook"}'], 'config.json', { type: 'application/json' }));
        const overEv = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
        dropzone.dispatchEvent(overEv);
        const dropEv = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
        dropzone.dispatchEvent(dropEv);
        await new Promise((r) => setTimeout(r, 80));

        const chip0 = (document.querySelector('[data-testid="attached-file-chip-0"]')?.textContent || '').trim();
        const chip1 = (document.querySelector('[data-testid="attached-file-chip-1"]')?.textContent || '').trim();

        const convA = s.activeConversationId || 'conv_a_196';
        s.setActiveConversationId(convA);
        s.setRightPaneCollapsed(false);
        s.setContentItems([
          { key: 'dashboard:42', id: '42', contentType: 'dashboard', title: 'Executive KPIs', embedPath: '/embed/dashboards/42', hidden: true },
          { key: 'look:19', id: '19', contentType: 'look', title: 'Margin Look', embedPath: '/embed/looks/19', hidden: true },
        ]);
        // Push 1 host call (codemode: false) + 1 convA Code Mode call + 1 convB Code Mode call onto the live initial array
        if (Array.isArray(window.lkr_codemode_api_calls)) {
          window.lkr_codemode_api_calls.push(
            { method: 'GET', route: '/api/4.0/session', codemode: false, duration_ms: 8, response: { ok: true, status: 200, body: {} } },
            { method: 'POST', route: '/api/4.0/queries/run/json', codemode: true, conversation_id: convA, duration_ms: 42, response: { ok: true, status: 200, body: [] } },
            { method: 'GET', route: '/api/4.0/projects/ecom', codemode: true, conversation_id: 'conv_b_196', duration_ms: 19, response: { ok: true, status: 200, body: {} } }
          );
        }
        s.setMessages([
          {
            role: 'user',
            text: 'Refactor attached SQL and JSON',
            images: [
              'data:text/plain;name=revenue_by_region.sql;base64,U0VMRUNUIDE7',
              'data:application/json;name=config.json;base64,e30=',
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            ],
          },
          { role: 'assistant', text: 'Refactored SQL and JSON.' },
        ]);
        await new Promise((r) => setTimeout(r, 80));

        const attachedChip0 = (document.querySelector('[data-testid="chat-attached-file-0"]')?.textContent || '').trim();
        const attachedChip1 = (document.querySelector('[data-testid="chat-attached-file-1"]')?.textContent || '').trim();
        const brokenTextImgs = Array.from(document.querySelectorAll('.dab-msg-user img')).filter((im) =>
          (im.getAttribute('src') || '').startsWith('data:text/') || (im.getAttribute('src') || '').startsWith('data:application/')
        ).length;
        const validPngImgs = Array.from(document.querySelectorAll('.dab-msg-user img')).filter((im) =>
          (im.getAttribute('src') || '').startsWith('data:image/png')
        ).length;

        document.querySelector('[data-testid="studio-overview-tab"]')?.click();
        await new Promise((r) => setTimeout(r, 60));

        const dashMeta = (document.querySelector('[data-testid="overview-content-item-dashboard:42"] .dab-ov-meta')?.textContent || '').trim();
        const lookMeta = (document.querySelector('[data-testid="overview-content-item-look:19"] .dab-ov-meta')?.textContent || '').trim();
        const linkLabels = Array.from(document.querySelectorAll('[data-testid^="overview-link-item-"] .dab-ov-txt')).map((el) => (el.textContent || '').trim());
        const uploadLabels = Array.from(document.querySelectorAll('[data-testid="overview-section-uploads"] .dab-ov-txt')).map((el) => (el.textContent || '').trim());

        document.querySelector('[data-testid="overview-section-api-calls-toggle"]')?.click();
        await new Promise((r) => setTimeout(r, 50));
        const convAApiRoutes = Array.from(document.querySelectorAll('[data-testid^="overview-api-call-"] .dab-ov-txt')).map((el) => (el.textContent || '').trim());

        s.history.push('/c/conv_b_196');
        s.setActiveConversationId('conv_b_196');
        await new Promise((r) => setTimeout(r, 60));
        document.querySelector('[data-testid="overview-section-api-calls-toggle"]')?.click();
        await new Promise((r) => setTimeout(r, 50));
        const convBApiRoutes = Array.from(document.querySelectorAll('[data-testid^="overview-api-call-"] .dab-ov-txt')).map((el) => (el.textContent || '').trim());

        return {
          overDefaultPrevented: overEv.defaultPrevented,
          dropDefaultPrevented: dropEv.defaultPrevented,
          chip0,
          chip1,
          attachedChip0,
          attachedChip1,
          brokenTextImgs,
          validPngImgs,
          dashMeta,
          lookMeta,
          linkLabels,
          uploadLabels,
          convAApiRoutes,
          convBApiRoutes,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    expect(res196.result.value).toEqual({
      overDefaultPrevented: true,
      dropDefaultPrevented: true,
      chip0: 'revenue_by_region.sql',
      chip1: 'config.json',
      attachedChip0: 'revenue_by_region.sql',
      attachedChip1: 'config.json',
      brokenTextImgs: 0,
      validPngImgs: 1,
      dashMeta: 'UDD',
      lookMeta: 'Look',
      linkLabels: ['Open Executive KPIs', 'Open Margin Look'],
      uploadLabels: ['revenue_by_region.sql', 'config.json', 'Screenshot #3', 'revenue_by_region.sql', 'config.json'],
      convAApiRoutes: ['/queries/run/json'],
      convBApiRoutes: ['/projects/ecom'],
    })
  }, 20000)
}

module.exports = { registerVisualPart12Tests }
