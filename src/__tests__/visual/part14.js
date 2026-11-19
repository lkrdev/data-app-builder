function registerVisualPart14Tests(ctx) {
  test('Issue #230: renders sidebar relative timestamps & <= 4 tag pills in Light/Dark themes with 0 pre-select remote GETs, hydrates turnInteractionIds on cold select, and prunes expired sandbox conversations with dismissible banner', async () => {
    await ctx.chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    // 1. Boot on '/' (centered_empty_prompt): verify 0 pre-select GET /interactions/* calls + sidebar tags & timestamps
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=centered_empty_prompt`,
    })
    const readyDeadline = Date.now() + 8000
    while (Date.now() < readyDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(window.__DAB_STUDIO__ && document.querySelector('[data-testid="conversation-item-conv_app_42"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const sidebarIdleRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        await new Promise((r) => setTimeout(r, 120));
        const preSelectGetInteractions = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/')
        );
        const row = document.querySelector('[data-testid="conversation-item-conv_app_42"]');
        const updatedEl = document.querySelector('[data-testid="conv-item-updated-conv_app_42"]');
        const tagsEl = document.querySelector('[data-testid="conv-item-tags-conv_app_42"]');
        const pills = tagsEl ? Array.from(tagsEl.querySelectorAll('.dab-conv-tag-pill')) : [];
        const lightPillStyle = pills[0] ? getComputedStyle(pills[0]) : null;
        const lightUpdatedStyle = updatedEl ? getComputedStyle(updatedEl) : null;
        const hasHorizontalOverflow = row ? row.scrollWidth > row.clientWidth + 1 : false;

        // Cold-select conv_app_42 -> parallel GET /interactions/v1_app_42_r + v1_app_42
        row.click();
        const hydDeadline = Date.now() + 5000;
        while (Date.now() < hydDeadline) {
          const txt = document.body.innerText || '';
          if (txt.includes('Build an Executive Revenue Data App on order_items') && txt.includes('Built and published Executive Revenue App')) {
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }

        const getCallsAfterFirstSelect = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/v1_app_42')
        ).length;
        const bodyAfterSelect = document.body.innerText || '';

        // Switch to conv_dashboard_7 then back to conv_app_42 -> 0 extra GETs for v1_app_42*
        const dashRow = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        dashRow.click();
        await new Promise((r) => setTimeout(r, 150));
        document.querySelector('[data-testid="conversation-item-conv_app_42"]').click();
        await new Promise((r) => setTimeout(r, 150));

        const getCallsAfterReselect = (window.__INTERACTION_CALLS__ || []).filter(
          (c) => (c.method || 'GET').toUpperCase() === 'GET' && String(c.url || '').includes('/interactions/v1_app_42')
        ).length;
        const artifactUpdateKeys = (window.__ARTIFACT_UPDATES__ || []).map((u) => u.key);

        return {
          preSelectGetCount: preSelectGetInteractions.length,
          updatedText: updatedEl ? updatedEl.textContent.trim() : null,
          pillTexts: pills.map((p) => p.textContent.trim()),
          pillCount: pills.length,
          lightPillBg: lightPillStyle ? lightPillStyle.backgroundColor : null,
          lightPillColor: lightPillStyle ? lightPillStyle.color : null,
          lightUpdatedColor: lightUpdatedStyle ? lightUpdatedStyle.color : null,
          hasHorizontalOverflow,
          getCallsAfterFirstSelect,
          getCallsAfterReselect,
          hasHydratedUserPrompt: bodyAfterSelect.includes('Build an Executive Revenue Data App on order_items'),
          hasRawControlTag: bodyAfterSelect.includes('<USER_MESSAGE>'),
          artifactUpdateKeys,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    const s1 = sidebarIdleRes.result.value
    expect(s1.preSelectGetCount).toBe(0)
    expect(s1.updatedText).toBe('Oct 30')
    expect(s1.pillCount).toBeGreaterThan(0)
    expect(s1.pillCount).toBeLessThanOrEqual(4)
    expect(s1.pillTexts).toEqual(['Data App', 'order_items'])
    expect(s1.hasHorizontalOverflow).toBe(false)
    expect(s1.hasHydratedUserPrompt).toBe(true)
    expect(s1.hasRawControlTag).toBe(false)
    expect(s1.getCallsAfterFirstSelect).toBe(2)
    expect(s1.getCallsAfterReselect).toBe(2)
    for (const k of s1.artifactUpdateKeys) {
      expect(k).toMatch(/^user_(env|config|conversations):/)
    }

    // 2. Verify Dark theme computed colors differ from Light theme on tag pills & timestamp
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=studio_dark_theme`,
    })
    const darkDeadline = Date.now() + 8000
    while (Date.now() < darkDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.documentElement.getAttribute('data-theme') === 'dark' && document.querySelector('[data-testid="conv-item-tags-conv_app_42"] .dab-conv-tag-pill'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }
    const darkStyleRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(() => {
        const pill = document.querySelector('[data-testid="conv-item-tags-conv_app_42"] .dab-conv-tag-pill');
        const updatedEl = document.querySelector('[data-testid="conv-item-updated-conv_app_42"]');
        return {
          darkPillBg: pill ? getComputedStyle(pill).backgroundColor : null,
          darkPillColor: pill ? getComputedStyle(pill).color : null,
          darkUpdatedColor: updatedEl ? getComputedStyle(updatedEl).color : null,
        };
      })()`,
      returnByValue: true,
    })
    const dark = darkStyleRes.result.value
    expect(dark.darkPillColor).not.toBe(s1.lightPillColor)
    expect(dark.darkUpdatedColor).not.toBe(s1.lightUpdatedColor)

    // 3. Boot on '/?scenario=expired_conv' (/c/conv_expired_old with dead env_old_expired): prunes pointer, renders banner, redirects to '/', and dismisses cleanly
    await ctx.chrome.send('Page.navigate', {
      url: `http://127.0.0.1:${ctx.port}/?scenario=expired_conv`,
    })
    const expDeadline = Date.now() + 8000
    while (Date.now() < expDeadline) {
      const r = await ctx.chrome.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="expired-conversation-banner"]'))`,
        returnByValue: true,
      })
      if (r.result?.value) break
      await new Promise((res) => setTimeout(res, 60))
    }

    const expRes = await ctx.chrome.send('Runtime.evaluate', {
      expression: `(async () => {
        await new Promise((r) => setTimeout(r, 120));
        const banner = document.querySelector('[data-testid="expired-conversation-banner"]');
        const bannerText = banner ? banner.textContent.trim() : '';
        const expiredRowStillInSidebar = Boolean(document.querySelector('[data-testid="conversation-item-conv_expired_old"]'));
        const activeRowsCount = document.querySelectorAll('[data-testid^="conversation-item-conv_"]').length;
        const dismissBtn = document.querySelector('[data-testid="dismiss-expired-conversation-banner"]');
        if (dismissBtn) dismissBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        const bannerAfterDismiss = Boolean(document.querySelector('[data-testid="expired-conversation-banner"]'));

        // Also test runtime 404 Environment not found when selecting a conversation whose interaction returns 404
        window.__MOCK_LOOKER_EXTENSION__.mockInteractions.v1_native_7_r = {
          __mockError: { ok: false, status: 404, body: JSON.stringify({ error: { message: 'Environment env_42 not found (404)' } }) }
        };
        const dashBtn = document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        if (dashBtn) dashBtn.click();
        const r404Deadline = Date.now() + 5000;
        while (Date.now() < r404Deadline) {
          if (document.querySelector('[data-testid="expired-conversation-banner"]')) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        const bannerAfterRuntime404 = Boolean(document.querySelector('[data-testid="expired-conversation-banner"]'));
        const dashPrunedFromSidebar = !document.querySelector('[data-testid="conversation-item-conv_dashboard_7"]');
        const updates = (window.__ARTIFACT_UPDATES__ || []).map((u) => u.key);

        return {
          bannerText,
          expiredRowStillInSidebar,
          activeRowsCount,
          bannerAfterDismiss,
          bannerAfterRuntime404,
          dashPrunedFromSidebar,
          updates,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })

    const exp = expRes.result.value
    expect(exp.bannerText).toContain('expired')
    expect(exp.expiredRowStillInSidebar).toBe(false)
    expect(exp.activeRowsCount).toBe(5)
    expect(exp.bannerAfterDismiss).toBe(false)
    expect(exp.bannerAfterRuntime404).toBe(true)
    expect(exp.dashPrunedFromSidebar).toBe(true)
    for (const k of exp.updates) {
      expect(k).toMatch(/^user_(env|config|conversations):/)
    }
  }, 25000)
}

module.exports = { registerVisualPart14Tests }
