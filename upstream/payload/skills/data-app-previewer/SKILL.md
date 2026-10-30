---
name: data-app-previewer
description: |
  Start, inspect, verify, and manage the local preview server for Data Apps.
  Trigger when previewing, inspecting, testing, or reviewing a Data App in the browser.
---

You are managing and verifying the local preview experience for a Looker Data App.
The preview server runs locally on port 8765, proxying Looker queries through
credentials in `data-apps-config.json`.

## 1. Start the Preview Server

Always pass the app path to open *that specific app* directly (on Windows where `python3` is absent or points to the Microsoft Store stub, substitute `python` or `py -3` in all `python3` commands below):

```bash
python3 skills/data-app-previewer/tools/start-preview.py apps/<app-name>/app.js
```

The script is idempotent: an already-running server is reused, and reclaiming a stale port is handled automatically. It launches `serve.py` as a detached daemon process (`start_new_session=True`) so that agent shell commands return immediately while the preview server stays running in the background. Execute `python3 skills/data-app-previewer/tools/start-preview.py apps/<app-name>/app.js` directly and open the preview URL in a new browser tab (using `start-preview.py`'s automatic browser launch plus any available browser or IDE open-tab tool). Do not print `start-preview.py` for the user to run.

## 2. Fast Verification Workflow

1. **Open the preview UI on the same-origin Inspect mount:**
   Navigate to `http://localhost:8765/preview-server/?app=apps/<app-name>/app.js&inspect=1` using your browser tool. Always use `&inspect=1` when interacting with or inspecting the DOM.

2. **Wait for loading to complete:**
   All widgets (`<app-chart>`, `<app-grid>`, `<app-kpi>`) carry a `.loading` class while queries are in flight and remove it as soon as queries resolve:
   ```javascript
   document.querySelectorAll('.loading').length === 0
   ```
   Wait until no `.loading` elements remain in the DOM.

3. **Collect console errors:**
   When a query or render fails, the runtime prints structured diagnostic details to `console.error` (widget tag, title, query fields, and Looker API error). Verify that 0 console errors are logged. If errors occur, diagnose and repair in `app.js`.

4. **Look once and stop unprompted:**
   One page load to confirm it rendered and the console is clean is the whole check. Do not build arbitrary sleep loops or redundant test harnesses.

## 3. Two Preview Modes: Inspect Mode vs. Sandboxed Parity

Understanding how the preview server mounts an app is essential for LLM agents and automated tools:

- **Same-origin Inspect mount (`?app=…&inspect=1`) (MANDATORY FOR AGENT DOM AUTOMATION):**
  * **Direct DOM Mount (No Iframe):** The preview server mounts the custom element directly into the top-level page DOM on the same origin without an iframe.
  * **Inspectable & Automatable:** Browser tools (`execute_javascript_in_active_tab`, `run_browser_steps`, CDP, query selectors) have full direct access to query elements (`document.querySelector`), inspect component properties (e.g. `app.isDark`), simulate user clicks (e.g. theme toggle buttons, filter dropdowns, tab buttons), and check `.loading` classes.

- **Sandboxed Tile Parity (`?app=…` or `?app=…&sandbox=true`) (FOR VISUAL REVIEW ONLY):**
  * **Opaque-Origin Iframe:** When loaded without `&inspect=1`, the preview server embeds the app inside an `<iframe sandbox="allow-scripts">` with a `null` origin and nonce CSP to strictly simulate Looker's production tile frame and `postMessage` query brokering.
  * **Cross-Origin Boundary for Agents:** Because the iframe has an opaque origin, parent-page JavaScript cannot access or inspect elements inside `window.frames[0].document` (throws a cross-origin `DOMException`). Top-level DOM queries for `.loading` or custom elements return nothing.
  * **When to use:** Use sandboxed mode for final visual inspection, screenshot verification, and proving tile sandbox compliance before publishing. Never use it for DOM querying, automated clicking, or property inspection.

## 4. Reporting Preview to the User

Present clickable links and report concrete observations from the dataset:

* **Live App Preview:** `http://localhost:8765/preview-server/?app=apps/<app-name>/app.js`
* **Tile Parity Sandbox:** `http://localhost:8765/preview-server/?app=apps/<app-name>/app.js&sandbox=true`
* **App Gallery:** `http://localhost:8765/preview-server/`

Share the top-level command for the user to start the local server and gallery later (`make start` or `python3 preview-server/serve.py`, and `make stop` to stop it).

### Suggest what you learned

While inspecting the data, note concrete observations from the explore (e.g. additional breakdowns, date ranges, or related explores noticed during discovery) rather than presenting a generic feature list.

## 5. Phase Completion & Next Step Handoff

Present the preview URLs to the user along with next step options:

1. **Iterate on App Design / Data:**
   If the user requests visual modifications, additional tiles, or query changes, hand off back to the **`data-app-creator`** skill (`skills/data-app-creator/SKILL.md`).

2. **Deploy to Looker Instance:**
   When the user is satisfied and explicitly requests publishing the Data App to Looker, hand off to the **`data-app-publisher`** skill (`skills/data-app-publisher/SKILL.md`).

3. **Stop Preview Server:**
   When review is complete or after deployment, stop the server from the install root (or pass `--stop`):
   ```bash
   python3 skills/data-app-previewer/tools/stop-preview.py
   # Or via start-preview:
   python3 skills/data-app-previewer/tools/start-preview.py --stop
   # (alternate shortcut: make stop)
   ```
