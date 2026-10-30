/**
 * data-app.js — Reactive Lit-based Data Apps Framework for Looker Data Apps.
 * 
 * Philosophy:
 *  - The skill is the loop: AI agents and authors craft self-contained ES module
 *    apps that mount natively in Looker tile extensions.
 *  - Zero-build native standard: runs directly in the browser with no Webpack or
 *    bundlers required, keeping customer deployment instantaneous.
 *  - Light DOM by design: components render into Light DOM so corporate styling,
 *    custom CSS classes, and Looker themes cascade naturally without Shadow DOM friction.
 *  - Universal resilience: in-place series data diffing (setData), abort controller race guards,
 *    and automatic ResizeObserver circuit breakers prevent runaway layout feedback loops.
 * 
 * Interactive Controls & Keyboard Shortcuts:
 *  - Global 'R' key: refreshes all KPIs, charts, and tables across the dashboard.
 *  - Point click: dispatches 'app-chart-click' for cross-filtering and drill-downs.
 */

import { LitElement, html, svg, css, noChange, nothing } from '../vendor/lit/3.3.1/lit.mjs';
export { LitElement, html, css, noChange, nothing };

/**
 * Base Directive class and directive wrapper for custom Lit directives.
 */
export class Directive {
  constructor(partInfo) {
    this._$part = partInfo;
  }
  _$AT(part, parent, index) {
    this._$part = part;
    this._$parent = parent;
    this._$index = index;
  }
  _$AS(part, values) {
    return this.update(part, values);
  }
  update(part, values) {
    return this.render(...values);
  }
}

export const directive = (c) => (...values) => ({
  _$litDirective$: c,
  values,
});

/**
 * keyed directive: forces a full remount / identity reset of a Lit template or component
 * whenever the provided key changes:
 *   ${keyed(this.activeMetric, html`<app-grid ...></app-grid>`)}
 */
export class KeyedDirective extends Directive {
  constructor(partInfo) {
    super(partInfo);
    this.key = undefined;
  }
  render(k, v) {
    return v;
  }
  update(part, [k, v]) {
    if (k !== this.key) {
      this.key = k;
      if (part && part._$AH !== undefined && part._$AH !== nothing) {
        if (typeof part._$AR === 'function') {
          part._$AR();
        }
        part._$AH = nothing;
      }
    }
    return v;
  }
}

export const keyed = directive(KeyedDirective);

// Ensure global DataApps namespace exists for query execution
window.DataApps = window.DataApps || {};

// --- Looker tile bootstrap ---------------------------------------------------
//
// A published app is itself the extension, so there is no host script in front
// of it: this module connects to Looker directly via the Extension SDK.
//
// A host that already installed a queryRunner (the local preview server) keeps
// it, and none of this runs. That is the only thing distinguishing the two
// environments, and it is checked before anything is fetched.

/**
 * Formats an ISO-8601 or human timestamp for the Data App stamp.
 * Converts ISO timestamps (e.g. `2026-09-27T22:55:00-07:00`) to `YYYY-MM-DD HH:MM`
 * in local time, or returns non-ISO strings as-is.
 *
 * @param {string} raw
 * @return {string}
 */
export function formatStampDate(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const dt = new Date(trimmed);
    if (!Number.isNaN(dt.getTime())) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    }
  }
  return trimmed;
}

const RUNTIME_BASE = new URL('./', import.meta.url).href;
// Vendored libraries are shared by every published version and live one
// directory above the runtime, not beside it. Keeping the reference relative
// means the same bytes resolve correctly from the local preview server, from
// GCS, and from gstatic, none of which share a hostname.
const VENDOR_BASE = new URL('../vendor/', import.meta.url).href;

const VENDOR_CSS = [
  'ag-grid/31.3.4/ag-grid.css',
  'ag-grid/31.3.4/ag-theme-quartz.css',
];
// Order matters: highcharts core, then -more (solid-gauge depends on it),
// then the leaf modules.
const VENDOR_JS_ORDERED = [
  'ag-grid/31.3.4/ag-grid-community.min.js',
  'highcharts/11.4.8/highcharts.js',
  'highcharts/11.4.8/highcharts-more.js',
];
const VENDOR_JS_PARALLEL = [
  'highcharts/11.4.8/highcharts-solid-gauge.js',
  'highcharts/11.4.8/highcharts-funnel.js',
  'highcharts/11.4.8/highcharts-treemap.js',
];

/**
 * Asynchronously injects an external CSS stylesheet into the document head.
 *
 * If the stylesheet fails to load (e.g. 404 or network timeout), it logs a runtime
 * error to telemetry via `reportRuntimeError` and resolves `{ ok: false, error }`
 * instead of rejecting, ensuring that the remaining assets and scripts continue loading.
 *
 * @param {string} href - Full URL of the stylesheet.
 * @return {Promise<{ok: boolean, href: string, error?: Error}>}
 */
export function loadCSS(href) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve({ ok: true, href });
    link.onerror = () => {
      const err = new Error('failed to load CSS: ' + href);
      reportRuntimeError('loadCSS', err, { href });
      resolve({ ok: false, href, error: err });
    };
    document.head.appendChild(link);
  });
}

/**
 * Asynchronously injects an external JavaScript file into the document head.
 *
 * If the script fails to load (e.g. blocked by corporate firewall, proxy, or 404),
 * it logs a runtime error to host telemetry via `reportRuntimeError` and resolves
 * `{ ok: false, error }` instead of rejecting, allowing the remaining vendor libraries
 * and application code to continue loading best-effort.
 *
 * @param {string} src - Full URL of the JavaScript file.
 * @return {Promise<{ok: boolean, src: string, error?: Error}>}
 */
export function loadJS(src) {
  return new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve({ ok: true, src });
    el.onerror = () => {
      const err = new Error('failed to load JS: ' + src);
      reportRuntimeError('loadJS', err, { src });
      resolve({ ok: false, src, error: err });
    };
    document.head.appendChild(el);
  });
}

/**
 * Loads all vendor stylesheets and JavaScript bundles required for Looker tile runtime.
 *
 * Loading order:
 * 1. Stylesheets loaded in parallel.
 * 2. Ordered core JS bundles (ag-grid, highcharts core, highcharts-more) loaded sequentially
 *    to satisfy strict dependency order.
 * 3. Feature-specific Highcharts modules (solid-gauge, funnel, treemap) loaded in parallel.
 *
 * Fault tolerance:
 * Individual asset failures are caught, reported to telemetry, and isolated so that if
 * a single vendor library fails (e.g. AG Grid is blocked), the rest of the application
 * (e.g. Highcharts, KPI widgets, core SDK) still loads and renders successfully.
 *
 * @return {Promise<void>}
 */
export async function loadVendors() {
  await Promise.all([
    loadCSS(RUNTIME_BASE + 'data-app.css'),
    ...VENDOR_CSS.map(f => loadCSS(VENDOR_BASE + f)),
  ]);
  for (const f of VENDOR_JS_ORDERED) await loadJS(VENDOR_BASE + f);
  await Promise.all(VENDOR_JS_PARALLEL.map(f => loadJS(VENDOR_BASE + f)));
}

/**
 * Translates Looker dashboard filters (keyed by filter name) into the LookML field keys
 * that application widgets query with, then broadcasts the merged filter state.
 *
 * DataApp listens for the `looker-dashboard-filters-changed` event to trigger re-queries.
 *
 * @param {Object} tileHostData - Tile host data from Looker extension host.
 * @param {Object.<string, {field: string, model: ?string, explore: ?string}>} filterDefByName -
 *   Mapping from dashboard filter name to field definition.
 * @param {Object.<string, any>} localCrossFilters - Active interactive cross-filters.
 */
function broadcastFilters(tileHostData, filterDefByName, localCrossFilters) {
  const raw = (tileHostData && tileHostData.dashboardFilters) || {};
  const looker = {};
  for (const [name, value] of Object.entries(raw)) {
    const def = filterDefByName && filterDefByName[name];
    if (!def || !def.field) continue;
    looker[def.field] = value == null ? '' : value;
  }
  const merged = { ...looker, ...localCrossFilters };
  window.__lookerDashboardFilters = merged;
  window.dispatchEvent(new CustomEvent('looker-dashboard-filters-changed', { detail: merged }));
}

/**
 * Internal helper to bridge diagnostic errors to the parent Looker host application.
 *
 * Communication channels:
 * 1. Looker Extension SDK (`extensionSDK.error()`):
 *    When connected, routes across Chatty RPC to the host's `ExtensionErrorApi.handleRequest()`,
 *    which enriches the error with `{ component: 'data_app' }` and records it in `logException()`
 *    for central logging in Monarch and Cloud Logging.
 * 2. Window postMessage (`LOOKER_DATA_APP_CRITICAL_ERROR` or `LOOKER_DATA_APP_ERROR`):
 *    If `fatal` is true (critical unrecoverable crash) or the SDK has not yet connected, sends
 *    an immediate message to `window.parent`. For critical crashes, this allows the host to
 *    fail fast and display the error card immediately instead of waiting for the 30s timeout.
 *
 * @param {string} message - Formatted error message.
 * @param {Error|any} err - The error object or reason.
 * @param {Object} [context] - Optional metadata (e.g. scope, parameters).
 * @param {boolean} [fatal=false] - Whether this represents a fatal crash that terminates the tile.
 */
let _extensionSDK = null;
let _tileChartClickListenerRegistered = false;

function handleTileChartClick(e) {
  if (!_extensionSDK || e.defaultPrevented) return;
  const detail = e.detail;
  if (!detail || !detail.field || detail.value === undefined) return;
  if (!_extensionSDK.tileSDK || typeof _extensionSDK.tileSDK.toggleCrossFilter !== 'function') {
    reportRuntimeWarning(
      'cross-filter capability missing',
      new Error('tileSDK.toggleCrossFilter is not available on this host.')
    );
    return;
  }
  try {
    _extensionSDK.tileSDK.toggleCrossFilter(
      { row: { [detail.field]: detail.value } }, detail.mouseEvent);
  } catch (err) {
    reportRuntimeWarning(
      'cross-filter toggle failed',
      err,
      { field: detail.field }
    );
  }
}

/**
 * Test hook to inject an Extension SDK mock in unit tests without polluting window.
 * @param {Object|null} sdk
 */
export function _setExtensionSDKForTesting(sdk) {
  _extensionSDK = sdk;
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    if (sdk && !_tileChartClickListenerRegistered) {
      window.addEventListener('app-chart-click', handleTileChartClick);
      _tileChartClickListenerRegistered = true;
    } else if (!sdk && _tileChartClickListenerRegistered && typeof window.removeEventListener === 'function') {
      window.removeEventListener('app-chart-click', handleTileChartClick);
      _tileChartClickListenerRegistered = false;
    }
  }
}

/**
 * Internal helper to bridge diagnostic errors to the parent Looker host application
 * via the standard Looker Extension SDK error channel.
 *
 * Routes across Chatty RPC via `_extensionSDK.error()`. The host's `ExtensionErrorApi`
 * records this in `logException()` under `component: 'data_app'` for central logging
 * in Monarch and Cloud Logging.
 *
 * @param {string} message - Formatted error message.
 * @param {Error|any} err - The error object or reason.
 * @param {Object} [context] - Optional metadata (e.g. scope, parameters).
 * @param {boolean} [fatal=false] - Whether this error represents a fatal crash.
 */
export function forwardErrorToHost(message, err, context, fatal = false) {
  const detail = (err && err.stack) || (err && err.message) || String(err);
  if (_extensionSDK && typeof _extensionSDK.error === 'function') {
    try {
      _extensionSDK.error({
        component: 'data_app',
        message,
        error: detail,
      });
    } catch (_) {}
  }
  try {
    if (typeof window !== 'undefined') {
      const target = (window.parent && window.parent !== window) ? window.parent : window;
      // nosemgrep: looker-internal.javascript.browser.security.wildcard-postmessage-configuration, wildcard-postmessage-configuration
      target.postMessage({
        type: fatal ? 'LOOKER_DATA_APP_CRITICAL_ERROR' : 'LOOKER_DATA_APP_ERROR',
        component: 'data_app',
        message,
        stack: detail,
        context: context || null,
      }, '*');
    }
  } catch (_) {}
}

/**
 * Reports a critical, fatal error where the application runtime has failed and
 * cannot recover or continue best-effort rendering ("turn off the lights").
 *
 * Terminology:
 * - Critical: High importance / high severity in error logging and telemetry.
 * - Fatal: Unrecoverable — Looker host will transition the tile to `cannotConnect`
 *   and display the generic error fallback card.
 *
 * When to use:
 * - Extension SDK connection fails (`connectExtensionHost` rejection).
 * - Fatal unhandled promise rejection during tile bootstrap.
 *
 * For important non-fatal errors (e.g. an individual vendor lib fails to load,
 * rendering crash, 5s timeout), use `reportRuntimeError` so that error telemetry
 * is still captured in dashboards while allowing the app to keep the lights on
 * and render remaining widgets best-effort.
 *
 * @param {string} scope - The critical subsystem or operation that failed (e.g. 'connectExtensionHost').
 * @param {Error|any} err - The error object or reason.
 * @param {Object} [context] - Optional debugging metadata.
 */
export function reportCriticalError(scope, err, context) {
  const message = `[data-app critical error] ${scope}: ${(err && err.message) || err}`;
  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
  console.error(message, {
    ...(context || {}),
    error: err,
    stack: err && err.stack,
  });
  forwardErrorToHost(message, err, context, /* fatal */ true);
}

const CD_DEBUG = (function () {
  try {
    if (window.location && window.location.search &&
        /[?&]debug=(1|true|on)\b/i.test(window.location.search)) return true;
    if (window.localStorage && window.localStorage.getItem('dataAppsDebug')) return true;
  } catch (e) { /* opaque origin: storage throws */ }
  return false;
})();

/**
 * Reports a runtime error where an operation, library, or API failed, but the application
 * continues running in best-effort mode.
 *
 * When to use:
 * - A vendor library or stylesheet failed to load (network/proxy error).
 * - A widget rendering crash (e.g. Highcharts or AG Grid internal exception).
 * - Tile context timed out after 5s (proceeds rendering unfiltered).
 * - Interactive cross-filtering failure or missing capability.
 * - Dashboard filter metadata fetch failure from Looker core API.
 * - Theme change observer callback exception.
 *
 * Error Routing:
 * - Non-query runtime errors: Logged with `[data-app error]` and forwarded to Looker host
 *   telemetry (`logException` with `component: 'data_app'`). The tile remains alive (`fatal: false`).
 * - Author query errors (`query failed` / `runQuery failed`): Logged to the console for the author,
 *   rendered on the widget's local error card, and NOT forwarded to host telemetry to avoid alert fatigue.
 *
 * @param {string} scope - The subsystem, widget, or operation where the error occurred.
 * @param {Error|any} err - The error object or message.
 * @param {Object} [context] - Additional debugging properties (query, options, tags, etc.).
 */
export function reportRuntimeError(scope, err, context) {
  const message = `[data-app error] ${scope}: ${(err && err.message) || err}`;
  const inTile = !!(window.DataApps && window.DataApps._extensionInitPromise);
  if (inTile && !CD_DEBUG) {
    console.error(message);
  } else {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
    console.error(message, {
      ...(context || {}),
      error: err,
      hint: err && err.hint,
      suggested_action: err && err.suggested_action,
    });
  }

  // Author or warehouse query failures are rendered on the widget error card.
  // Unexpected runtime errors (e.g. vendor script failed to load, rendering crash,
  // host timeout, cross-filtering failure) are system errors and must be reported
  // to host telemetry without crashing the whole tile.
  const isQueryError = scope.includes('query failed') || scope.includes('runQuery failed');
  if (!isQueryError) {
    forwardErrorToHost(message, err, context, /* fatal */ false);
  }
}

// Backwards-compatible alias for non-critical runtime telemetry
export const reportRuntimeWarning = reportRuntimeError;

/**
 * Render-complete tracking.
 *
 * Looker's PDF and image renderer, which also serves scheduled deliveries, holds
 * the whole dashboard until every element reports that it has rendered
 * (`extensionSDK.rendered()`). A Data App reports once the page has settled: the
 * tile bootstrap is done, every connected `DataApp` and widget has drawn its
 * current state (data, error, or empty), and no `runQuery()` is in flight, all
 * continuously for `RENDER_SETTLE_QUIET_MS`. The quiet period absorbs cascades in
 * which one result starts more work, such as dashboard filters arriving and the
 * widgets refetching. `RENDERED_SIGNAL_CEILING_MS` reports anyway, so a query
 * that never returns cannot hold a delivery until the renderer's own timeout.
 *
 * Settledness is read from widget state on a poll rather than counted from
 * start/finish events, because a count that misses one of the many early-return
 * paths through a fetch never reaches zero.
 */
export const RENDER_SETTLE_POLL_MS = 250;
export const RENDER_SETTLE_QUIET_MS = 1000;
export const RENDERED_SIGNAL_CEILING_MS = 270000;

const _connectedDataApps = new Set();
let _pendingAppQueries = 0;

/**
 * Whether Looker is rendering this tile to a PDF or image: a download or a
 * scheduled delivery. The host says so once, in the Extension SDK handshake
 * (`lookerHostData.isRendering`), and sends none of the render's settings.
 * The renderer captures shortly after the tile reports rendered, so anything
 * still moving would be caught mid-frame. In render mode the runtime builds
 * charts and grids without animation, and `body[data-rendering]` in
 * `data-app.css` finishes every CSS animation and transition at once,
 * including the app's own.
 */
let _isRendering = false;

/**
 * Enters or leaves render mode. `data-rendering` is an attribute rather than
 * a class because `_syncDarkTheme()` owns the document and body classes.
 *
 * @param {boolean} on
 */
function _setRendering(on) {
  const next = Boolean(on);
  if (next === _isRendering) return;
  _isRendering = next;
  try {
    if (document.body) {
      if (next) document.body.setAttribute('data-rendering', '');
      else document.body.removeAttribute('data-rendering');
    }
  } catch (_) {}
  for (const app of _connectedDataApps) {
    try { app.requestUpdate(); } catch (_) {}
  }
}

export const _setRenderingForTesting = _setRendering;

/**
 * Returns built Highcharts options with every animation turned off, including
 * any the author turned back on through `.options`.
 *
 * @param {Object} opts - Final options, after the author's are merged in.
 * @return {Object}
 */
function withoutChartAnimation(opts) {
  if (!opts || typeof opts !== 'object') return opts;
  const plotOptions = { ...(opts.plotOptions || {}) };
  plotOptions.series = { ...(plotOptions.series || {}) };
  for (const key of Object.keys(plotOptions)) {
    const typeOpts = plotOptions[key];
    if (typeOpts && typeof typeOpts === 'object') {
      plotOptions[key] = { ...typeOpts, animation: false };
    }
  }
  const out = {
    ...opts,
    chart: { ...(opts.chart || {}), animation: false },
    plotOptions,
  };
  if (Array.isArray(opts.series)) {
    out.series = opts.series.map((s) => (s && typeof s === 'object' ? { ...s, animation: false } : s));
  }
  if (opts.drilldown && typeof opts.drilldown === 'object') {
    out.drilldown = { ...opts.drilldown, animation: false };
  }
  return out;
}

/**
 * Whether everything the runtime knows how to draw has been drawn.
 *
 * @param {ParentNode} [root] - Where to look for widgets (defaults to `document`).
 * @return {boolean}
 */
export function isRenderSettled(root = document) {
  const init = window.DataApps && window.DataApps._extensionInitPromise;
  if (init) {
    _trackInitPromise(init);
    if (_isInitPromisePending(init)) return false;
  }
  if (_pendingAppQueries > 0) return false;
  if (_connectedDataApps.size === 0) return false;
  for (const app of _connectedDataApps) {
    if (!app.hasUpdated || app.isUpdatePending) return false;
  }
  for (const el of findAppWidgets(root)) {
    if (el instanceof AppWidget) {
      if (!el.isRenderSettled()) return false;
    } else if (el.hasUpdated === false || el.isUpdatePending === true) {
      return false;
    }
  }
  return true;
}

/**
 * Lists the widgets still holding the render-complete signal, for diagnostics.
 *
 * @param {ParentNode} [root] - Where to look for widgets (defaults to `document`).
 * @return {string[]}
 */
function _unsettledWidgetLabels(root = document) {
  const labels = [];
  try {
    const init = window.DataApps && window.DataApps._extensionInitPromise;
    if (init && _isInitPromisePending(init)) {
      labels.push('[bootstrap in progress]');
    }
    if (_pendingAppQueries > 0) {
      labels.push(`[${_pendingAppQueries} runQuery call(s) in flight]`);
    }
    if (_connectedDataApps.size === 0) {
      labels.push('[no connected DataApp]');
    }
    for (const app of _connectedDataApps) {
      if (!app.hasUpdated || app.isUpdatePending) {
        const tag = (app.localName || app.tagName || 'data-app').toLowerCase();
        labels.push(`<${tag}> [update pending]`);
      }
    }
    for (const el of findAppWidgets(root)) {
      if (el instanceof AppWidget) {
        if (!el.isRenderSettled()) {
          const tag = (el.localName || el.tagName || 'app-widget').toLowerCase();
          labels.push(`<${tag}> "${el.title || el.label || ''}"`);
        }
      } else if (el.hasUpdated === false || el.isUpdatePending === true) {
        const tag = (el.localName || el.tagName || 'app-widget').toLowerCase();
        labels.push(`<${tag}> "${el.title || el.label || ''}"`);
      }
    }
  } catch (_) {}
  return labels;
}

/**
 * Calls `onComplete` once: when the page has stayed settled for `quietMs`, or
 * after `ceilingMs`, whichever comes first.
 *
 * @param {(detail: {reason: string, elapsedMs: number}) => void} onComplete -
 *     Receives `reason` (`'settled'` or `'ceiling'`) and `elapsedMs`.
 * @param {Object} [options]
 * @param {ParentNode} [options.root] - Where to look for widgets.
 * @param {number} [options.pollMs]
 * @param {number} [options.quietMs]
 * @param {number} [options.ceilingMs]
 * @return {() => void} Stops watching without calling `onComplete`.
 */
export function watchRenderComplete(onComplete, {
  root,
  pollMs = RENDER_SETTLE_POLL_MS,
  quietMs = RENDER_SETTLE_QUIET_MS,
  ceilingMs = RENDERED_SIGNAL_CEILING_MS,
} = {}) {
  const startedAt = Date.now();
  let settledSince = null;
  let done = false;
  let pollTimer = null;
  let ceilingTimer = null;
  const unref = (t) => {
    if (t && typeof t.unref === 'function') t.unref();
    return t;
  };
  const stop = () => {
    done = true;
    clearTimeout(pollTimer);
    clearTimeout(ceilingTimer);
  };
  const finish = (reason) => {
    if (done) return;
    stop();
    onComplete({ reason, elapsedMs: Date.now() - startedAt });
  };
  const poll = () => {
    if (done) return;
    let settled = false;
    try {
      settled = isRenderSettled(root || document);
    } catch (_) {
      settled = false;
    }
    if (!settled) {
      settledSince = null;
    } else if (settledSince == null) {
      settledSince = Date.now();
    } else if (Date.now() - settledSince >= quietMs) {
      finish('settled');
      return;
    }
    pollTimer = unref(setTimeout(poll, pollMs));
  };
  ceilingTimer = unref(setTimeout(() => {
    const stuck = _unsettledWidgetLabels(root || document);
    console.warn(`[data-app] reporting rendered after ${ceilingMs}ms without settling`
      + (stuck.length ? `; still drawing: ${stuck.join(', ')}` : ''));
    finish('ceiling');
  }, ceilingMs));
  pollTimer = unref(setTimeout(poll, pollMs));
  return stop;
}

/**
 * Records that the app has rendered and, in a Looker tile, tells the host.
 *
 * Sets `window.DataApps.renderComplete` and dispatches `data-app-render-complete`
 * on `window` with the same detail, so the local preview can observe the signal
 * without a Looker host. `rendered()` is called with no failure message on
 * purpose: the host turns a failure message into a tile render failure, which
 * fails the whole download or delivery rather than just this tile.
 *
 * @param {{reason: string, elapsedMs: number}} detail
 */
export function reportRenderComplete(detail) {
  window.DataApps.renderComplete = detail;
  try {
    window.dispatchEvent(new CustomEvent('data-app-render-complete', { detail }));
  } catch (_) {}
  const sdk = _extensionSDK;
  if (!sdk) return;
  if (typeof sdk.rendered !== 'function') {
    reportRuntimeWarning(
      'rendered signal',
      new Error('extensionSDK.rendered is not available on this host.')
    );
    return;
  }
  try {
    sdk.rendered();
  } catch (err) {
    reportRuntimeWarning('rendered signal', err);
  }
}

/**
 * Bootstraps the Looker Dashboard Tile environment for an inlined Data App.
 *
 * Lifecycle:
 * 1. Applies tile styles and injects module preloads for Extension SDK dependencies.
 * 2. Establishes the Chatty connection early with `connectExtensionHost()` to enable
 *    host communication and telemetry even while vendor assets are still downloading,
 *    and starts watching for the render-complete signal (`watchRenderComplete`).
 * 3. Loads vendor libraries in parallel/sequence best-effort.
 * 4. Initializes the `coreSDK` inline query runner (`window.DataApps.queryRunner`).
 * 5. Listens for interactive cross-filtering events.
 * 6. Fetches dashboard filter definitions (with a 5s fallback to unfiltered rendering).
 *
 * @return {Promise<void>}
 */
async function bootstrapLookerTile() {
  if (!document.body) return;
  document.body.setAttribute('data-context', 'tile');
  Object.assign(document.body.style, { margin: '0', background: 'transparent' });

  const SDK_BASE = VENDOR_BASE + 'looker-extension-sdk/24.20.0/';
  for (const m of ['extension-sdk.mjs', 'node/process.mjs',
                   'node/buffer.mjs', 'node/events.mjs',
                   'node/tty.mjs', 'node/async_hooks.mjs']) {
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = SDK_BASE + m;
    if (document.head) document.head.appendChild(link);
  }
  const sdkModulePromise = import(SDK_BASE + 'extension-sdk.mjs');

  let latestTileHostData = null;
  let filterDefByName = null;
  const localCrossFilters = {};
  const applyIfReady = () => {
    if (filterDefByName == null) return;
    broadcastFilters(latestTileHostData || {}, filterDefByName, localCrossFilters);
  };

  let firstTileResolve;
  const firstTile = new Promise(r => { firstTileResolve = r; });

  let extensionSDK = null;
  let sdkModule = null;

  try {
    sdkModule = await sdkModulePromise;
    extensionSDK = await sdkModule.connectExtensionHost({
      tileHostDataChangedCallback: (newData) => {
        latestTileHostData = newData;
        _setWidgetActions(newData?.widgetActions);
        const elementId = newData && (newData.elementId || newData.tileId);
        if (firstTileResolve && elementId) {
          firstTileResolve(newData);
          firstTileResolve = null;
        }
        applyIfReady();
      },
    });
    _extensionSDK = extensionSDK;
  } catch (sdkErr) {
    reportCriticalError('connectExtensionHost', sdkErr);
    throw sdkErr;
  }

  // Started before anything below can fail. A failure from here on still
  // settles the bootstrap and leaves the widgets drawing error cards, so the
  // tile reports in rather than holding a render job.
  watchRenderComplete(reportRenderComplete);

  // Known once connectExtensionHost() resolves, and set before vendors load,
  // so no chart or grid is ever built with animation during a render.
  _setRendering(Boolean(extensionSDK.lookerHostData && extensionSDK.lookerHostData.isRendering));

  // Load vendors in parallel/sequence. If one fails (e.g. AG Grid or a Highcharts
  // module), it reports a runtime error to telemetry and continues loading the
  // remaining libraries best-effort.
  await loadVendors();

  const coreSDK = sdkModule.LookerExtensionSDK.createClient(extensionSDK);

  window.DataApps.queryRunner = async (rawQuery, signal) => {
    const normalized = normalizeQueryPayload(rawQuery);
    return await coreSDK.ok(coreSDK.run_inline_query({
      result_format: 'json',
      body: { ...normalized, view: normalized.view || normalized.explore },
    }));
  };

  // Cross-filtering goes through the tile SDK and comes back via
  // tileHostDataChangedCallback. There is no local fallback, so a missing
  // method is reported rather than swallowed.
  if (!_tileChartClickListenerRegistered) {
    window.addEventListener('app-chart-click', handleTileChartClick);
    _tileChartClickListenerRegistered = true;
  }

  const tileHostData = await Promise.race([
    firstTile,
    new Promise(r => {
      const t = setTimeout(() => r(null), 5000);
      if (t && typeof t.unref === 'function') t.unref();
    }),
  ]);
  if (!tileHostData) {
    reportRuntimeWarning(
      'tile context timeout',
      new Error('no tile context after 5s; rendering unfiltered.')
    );
    filterDefByName = {};
    applyIfReady();
    return;
  }

  // Filter definitions name the dimension each dashboard filter maps to.
  // Failure here is not fatal: the app renders, just without filters applied.
  const dashboardKey = String(tileHostData.dashboardId || tileHostData.dashboard_id || '');
  try {
    const dash = await coreSDK.ok(coreSDK.dashboard(dashboardKey, 'dashboard_filters'));
    const map = {};
    for (const df of (dash && dash.dashboard_filters) || []) {
      if (!df || !df.name) continue;
      map[df.name] = { field: df.dimension || null, model: df.model || null, explore: df.explore || null };
    }
    filterDefByName = map;
  } catch (e) {
    reportRuntimeWarning('fetch dashboard_filters failed', e, { dashboardKey });
    filterDefByName = {};
  }
  applyIfReady();
}

// Native JavaScript Promises do not expose synchronous inspection of their
// lifecycle state (pending vs settled). We track _extensionInitPromise across WeakSets
// so widgets can synchronously check if asynchronous vendor downloading is still
// in-flight over the network without declaring premature errors.
const _settledInitPromises = new WeakSet();
const _trackedInitPromises = new WeakSet();

function _trackInitPromise(p) {
  if (!p || typeof p.then !== 'function' || _trackedInitPromises.has(p)) return;
  _trackedInitPromises.add(p);
  const onSettle = () => {
    _settledInitPromises.add(p);
  };
  Promise.resolve(p).then(onSettle, onSettle);
}

function _isInitPromisePending(p) {
  if (!p || typeof p.then !== 'function') return false;
  return !_settledInitPromises.has(p);
}

if (window.DataApps.queryRunner) {
  // A host already provides one (local preview). Leave it alone, but record the
  // render-complete signal so it can be checked without a Looker host.
  watchRenderComplete(reportRenderComplete);
} else if (window.parent !== window) {
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('error', (e) => {
      const msg = (e && e.message) || (e && e.error && e.error.message) || '';
      if (typeof msg === 'string' && msg.includes('ResizeObserver loop')) return;
      reportRuntimeError('uncaught error', (e && e.error) || msg || 'Script error');
    });
    window.addEventListener('unhandledrejection', (e) => {
      reportRuntimeError('unhandledrejection', e && e.reason);
    });
  }
  const initPromise = bootstrapLookerTile().catch((err) => {
    reportCriticalError('bootstrap', err);
  });
  window.DataApps._extensionInitPromise = initPromise;
  _trackInitPromise(initPromise);
} else {
  window.DataApps.queryRunner = async () => {
    throw new Error('Data App: no queryRunner installed and not running in a Looker tile.');
  };
}

export const FORMATTERS = Object.freeze({
  int: (n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 }),
  decimal1: (n) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  decimal2: (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  percent: (n) => {
    const scaled = Math.abs(n) > 0 && Math.abs(n) <= 1 ? n * 100 : n;
    return scaled.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  },
  percent1: (n) => (n * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%',
  percent2: (n) => (n * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%',
  'percent-100': (n) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%',
  'percent1-signed': (n) => {
    const scaled = n * 100;
    const rounded = Number(scaled.toFixed(1));
    if (rounded === 0) return '0.0%';
    const sign = rounded > 0 ? '+' : '-';
    return sign + Math.abs(rounded).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  },
  'percent2-signed': (n) => {
    const scaled = n * 100;
    const rounded = Number(scaled.toFixed(2));
    if (rounded === 0) return '0.00%';
    const sign = rounded > 0 ? '+' : '-';
    return sign + Math.abs(rounded).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  },
  usd: (n) => {
    const absVal = Math.abs(n).toLocaleString('en-US', {
      maximumFractionDigits: 0
    });
    if (absVal === '0') return '$0';
    return (n < 0 ? '-$' : '$') + absVal;
  },
  usd2: (n) => {
    const absVal = Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    if (absVal === '0.00') return '$0.00';
    return (n < 0 ? '-$' : '$') + absVal;
  },
});
export const NUMERIC_FORMATS = new Set(Object.keys(FORMATTERS));

/**
 * Format numeric and string values according to standard format vocabulary:
 * the keys of `FORMATTERS`
 */
/**
 * Resolves `'percent'` across a series or column of values so all values in the
 * series or column use the same scale:
 * - If any finite value has `|v| > 1`, the whole series/column uses `'percent100'` (0..100 scale, so `0.4` -> `'0.4%'`).
 * - If all finite values are in `[-1, 1]` and at least one is non-zero, the whole series/column uses `'percent1'` (0..1 ratio scale, so `0.4` -> `'40.0%'`).
 */
export function parsePointValue(raw, allowSparseNull = false) {
  if (raw == null || raw === '' || typeof raw === 'boolean') return allowSparseNull ? null : 0;
  const val = Number(raw);
  return Number.isFinite(val) ? val : (allowSparseNull ? null : 0);
}

export function resolvePercentFormat(fmt, numericValues) {
  if (fmt !== 'percent' || !Array.isArray(numericValues)) return fmt;
  const finite = numericValues.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (finite.length === 0) return 'percent';
  if (finite.some(v => Math.abs(v) > 1)) return 'percent100';
  if (finite.some(v => v !== 0)) return 'percent1';
  return 'percent100';
}

export function formatValue(val, fmt) {
  if (val == null || val === '') return '';
  if (typeof val === 'boolean' || Array.isArray(val)) return String(val);
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  const key = fmt === 'percent100' ? 'percent-100' : fmt;
  if (Object.prototype.hasOwnProperty.call(FORMATTERS, key) && FORMATTERS[key]) {
    return FORMATTERS[key](n);
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Format axis tick values for compact display (e.g. 100K, 1.5M, $2.5M).
 * Used specifically for chart value axes. Preserves strings and percentages.
 */
export function formatAxisValue(v, fmt) {
  const n = Number(v);
  if (v == null || v === '') return '';
  if (!Number.isFinite(n) || typeof v === 'string') return String(v);
  if (typeof fmt === 'string' && fmt.startsWith('percent')) {
    return formatValue(n, fmt);
  }
  if (Math.abs(n) < 1000) {
    return fmt ? formatValue(n, fmt) : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  const c = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Math.abs(n));
  const sign = n < 0 ? '-' : '';
  if (fmt === 'usd' || fmt === 'usd2') {
    return sign + '$' + c;
  }
  return sign + c;
}

/**
 * Fast shallow comparison of tabular data row arrays to prevent redundant component updates
 */
export function areDataRowsEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const rowA = a[i];
    const rowB = b[i];
    if (rowA === rowB) continue;
    if (!rowA || !rowB || typeof rowA !== 'object' || typeof rowB !== 'object') return false;
    const keysA = Object.keys(rowA);
    const keysB = Object.keys(rowB);
    if (keysA.length !== keysB.length) return false;
    for (let k = 0; k < keysA.length; k++) {
      const key = keysA[k];
      const valA = rowA[key];
      const valB = rowB[key];
      if (valA !== valB) {
        if (valA && valB && typeof valA === 'object' && typeof valB === 'object') {
          if ('value' in valA && 'value' in valB) {
            if (valA.value !== valB.value || valA.rendered !== valB.rendered) return false;
          } else {
            return false;
          }
        } else {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * Deep comparison of column definitions to prevent redundant AG Grid columnDefs reloads
 */
export function areColumnDefsEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const typeA = typeof a;
  const typeB = typeof b;
  if (typeA !== typeB) return false;

  if (typeA === 'function') {
    return String(a) === String(b);
  }

  if (typeA !== 'object') {
    return a === b;
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!areColumnDefsEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!areColumnDefsEqual(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Semantic equality comparison of Looker query objects and filter sets
 * Prevents redundant query re-executions when parent components re-render
 * with new object literal references containing the exact same query parameters.
 */
export function areQueriesEqual(a, b) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    const valA = a[key];
    const valB = b[key];
    if (valA === valB) continue;

    if (Array.isArray(valA) && Array.isArray(valB)) {
      if (valA.length !== valB.length) return false;
      for (let j = 0; j < valA.length; j++) {
        if (valA[j] !== valB[j]) return false;
      }
    } else if (valA && valB && typeof valA === 'object' && typeof valB === 'object') {
      if (!areQueriesEqual(valA, valB)) return false;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Normalizes a Looker query object so that `filters` values and `limit` are
 * always JSON strings as required by Looker's `/api/4.0/queries/run/json`
 * validator (`validate_model` in `queries_controller.rb`, which rejects
 * non-string filter values with `HTTP 422: filter values must be strings`).
 *
 * - Numbers (`2017`) -> `'2017'`
 * - Booleans (`true`/`false`) -> `'Yes'`/`'No'` (LookML yesno filter syntax)
 * - Arrays (`[2017, 2018]`) -> `'2017,2018'`. `^` and `,` inside each item are
 *   escaped so a comma is not read as a separator
 *   (`['Portland, OR', 'Austin']` -> `'Portland^, OR,Austin'`). Other filter
 *   syntax in an item still applies (`%`/`_` wildcards, a leading `-` negates,
 *   a leading quote starts a quoted value, `NULL`/`EMPTY`), so pass a string
 *   for a full filter expression.
 * - `null`, `undefined`, `NaN`, and `±Infinity` filter values -> omitted so
 *   unset slicers do not filter for the literal string `'null'`,
 *   `'undefined'`, or `'NaN'` (pass `'NULL'` to match null values)
 * - `limit` (`500`) -> `'500'`; a non-finite `limit` is dropped, so Looker's
 *   default row limit applies
 *
 * @param {Object} query
 * @return {Object}
 */
export function normalizeQueryPayload(query) {
  if (!query || typeof query !== 'object') return query;
  const isUnset = v =>
    v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));
  const out = { ...query };
  if (typeof out.limit === 'number' && !Number.isFinite(out.limit)) {
    delete out.limit;
  } else if (out.limit != null && typeof out.limit !== 'string') {
    out.limit = String(out.limit);
  }
  if (out.filters && typeof out.filters === 'object' && !Array.isArray(out.filters)) {
    const normalizedFilters = {};
    for (const [k, v] of Object.entries(out.filters)) {
      if (isUnset(v)) continue;
      if (typeof v === 'string') {
        normalizedFilters[k] = v;
      } else if (typeof v === 'boolean') {
        normalizedFilters[k] = v ? 'Yes' : 'No';
      } else if (Array.isArray(v)) {
        const items = v
          .filter(item => !isUnset(item))
          .map(item => {
            if (typeof item === 'boolean') return item ? 'Yes' : 'No';
            return String(item).replace(/[\^,]/g, '^$&');
          });
        if (items.length > 0) {
          normalizedFilters[k] = items.join(',');
        }
      } else {
        normalizedFilters[k] = String(v);
      }
    }
    out.filters = normalizedFilters;
  }
  return out;
}

/**
 * Loading skeleton shimmer bars matching standard app shimmer
 */
export function renderLoadingSkeleton() {
  return html`
    <div class="da-state-overlay da-loading-skeleton">
      <div class="da-skeleton-bar"></div>
      <div class="da-skeleton-bar"></div>
      <div class="da-skeleton-bar"></div>
    </div>
  `;
}

/**
 * Grid loading skeleton matching table shimmer
 */
export function renderGridLoadingSkeleton() {
  return html`
    <div class="da-state-overlay da-loading-skeleton da-grid-skeleton">
      <div class="da-skeleton-row header"></div>
      <div class="da-skeleton-row row-item"></div>
      <div class="da-skeleton-row row-item"></div>
      <div class="da-skeleton-row row-item"></div>
      <div class="da-skeleton-row row-item"></div>
      <div class="da-skeleton-row row-item"></div>
      <div class="da-skeleton-row row-item"></div>
    </div>
  `;
}

/**
 * Empty state card (.da-empty-card)
 */
export function renderEmptyCard(message = 'No data returned') {
  return html`
    <div class="da-state-overlay da-empty-card">
      <div class="da-empty-icon" aria-hidden="true">∅</div>
      <div class="da-empty-message">${message}</div>
    </div>
  `;
}

/**
 * Normalizes error messages.
 * @param {any} error
 * @returns {{ message: string }}
 */
export function describeError(error) {
  const raw = error && typeof error === 'object' && typeof error.message === 'string'
    ? error.message
    : String(error || 'Unknown error');
  let message = raw;
  let errorItems = null;

  if (error && typeof error === 'object' && Array.isArray(error.errors)) {
    errorItems = error.errors;
  }

  // Scope JSON tail extraction to serve.py HTTP error envelope shape:
  // e.g. "Looker rejected the query (HTTP 422): { ... }" or "Looker returned HTTP 400: { ... }"
  const httpEnvelopeMatch = typeof raw === 'string' && raw.match(/HTTP\s+\d+\)?:\s*(\{[\s\S]*)$/);
  if (httpEnvelopeMatch) {
    try {
      const parsed = JSON.parse(httpEnvelopeMatch[1]);
      if (parsed && typeof parsed === 'object') {
        const hasParsedMessage = typeof parsed.message === 'string' && parsed.message.trim().length > 0;
        const hasParsedErrors = Array.isArray(parsed.errors) && parsed.errors.length > 0;
        if (hasParsedMessage) {
          message = parsed.message.trim();
        } else if (hasParsedErrors) {
          message = '';
        }
        if (Array.isArray(parsed.errors)) {
          errorItems = parsed.errors;
        }
      }
    } catch (_e) {
      // Keep raw message when trailing text is not valid JSON
    }
  }

  // Also extract from raw JSON object or error.raw
  if (error && typeof error === 'object' && error.raw && typeof error.raw === 'object') {
    if (Array.isArray(error.raw.errors) && !errorItems) {
      errorItems = error.raw.errors;
    }
    if (typeof error.raw.message === 'string' && (!message || message === raw)) {
      message = error.raw.message.trim();
    }
  }

  if (Array.isArray(errorItems)) {
    const detailLines = errorItems
      .map((e) => (e && typeof e.message === 'string' ? e.message.trim() : ''))
      .filter(Boolean);
    if (detailLines.length > 0) {
      message = message ? `${message}\n${detailLines.join('\n')}` : detailLines.join('\n');
    }
  }

  return { message };
}

/**
 * Error card (.da-error-card)
 */
export function renderErrorCard({ error, onRetry }) {
  const { message } = describeError(error);
  return html`
    <div class="da-error-card" role="alert">
      <div class="da-error-icon" aria-hidden="true">!</div>
      <div class="da-error-message" title=${message}>${message}</div>
      ${onRetry ? html`
        <div class="da-error-actions">
          <button type="button" class="da-error-btn" @click=${onRetry}>Retry</button>
        </div>
      ` : ''}
    </div>
  `;
}

export const KNOWN_WIDGET_TAGS = new Set(['app-chart', 'app-grid', 'app-kpi', 'app-select']);
export const CHART_TYPES = new Set(['column', 'bar', 'line', 'spline', 'area', 'areaspline', 'pie', 'donut', 'scatter', 'solidgauge', 'gauge', 'treemap', 'funnel', 'pyramid']);
/** Segmented chart types where a click selects one category and drives cross-filtering. */
export const CROSS_FILTER_CHART_TYPES = new Set(['column', 'bar', 'pie', 'donut', 'treemap', 'funnel', 'pyramid']);

/**
 * Registers a custom widget tag into the known widget set.
 * Widgets must use the `app-*` prefix namespace.
 * @param {string} tag
 */
export function registerWidgetTag(tag) {
  if (tag && typeof tag === 'string') {
    const lower = tag.toLowerCase();
    if (lower.startsWith('app-')) {
      KNOWN_WIDGET_TAGS.add(lower);
    }
  }
}

/**
 * Returns true if an element is a modern Data App widget.
 * By contract, live data widgets strictly use the `app-*` prefix namespace (e.g. <app-chart>,
 * <app-grid>, <app-kpi>, <app-select>, <app-gauge>, etc.) or extend AppWidget.
 * Cosmetic, layout, and container components use standard HTML or the `da-*` namespace.
 *
 * @param {Element|null|undefined} el
 * @return {boolean}
 */
export function isAppWidget(el) {
  if (!el || el.nodeType !== 1) return false;
  if (typeof DataApp !== 'undefined' && el instanceof DataApp) return false;
  const tag = (el.localName || el.tagName || '').toLowerCase();
  return KNOWN_WIDGET_TAGS.has(tag) ||
    (typeof AppWidget !== 'undefined' && el instanceof AppWidget) ||
    tag.startsWith('app-');
}

/**
 * Resolves the top-level container element of a Data App.
 * Prefers `.da-container` if present,
 * otherwise returns the first non-style, non-widget child element
 * (skipping any `app-*` widgets or <style> tags).
 *
 * @param {Element} appEl - The DataApp instance
 * @return {Element|null}
 */
export function getAppContainer(appEl) {
  if (!appEl) return null;
  if (appEl.querySelector) {
    const container = appEl.querySelector('.da-container');
    if (container && !isAppWidget(container)) return container;
  }
  const children = Array.from(appEl.children || []);
  return children.find(el => (el.localName || el.tagName || '').toLowerCase() !== 'style' && !isAppWidget(el)) || null;
}

/**
 * Discovers all widget elements within a root element.
 * Queries registered widget tags in KNOWN_WIDGET_TAGS in O(widgets) without
 * traversing arbitrary descendant node trees.
 *
 * @param {Element} root
 * @return {Element[]}
 */
export function findAppWidgets(root) {
  if (!root) return [];
  const widgets = [];
  const seen = new Set();
  const add = (el) => {
    if (!el || el.nodeType !== 1 || seen.has(el)) return;
    seen.add(el);
    widgets.push(el);
  };

  const selector = Array.from(KNOWN_WIDGET_TAGS).join(', ');
  if (selector && root.querySelectorAll) {
    try {
      const found = root.querySelectorAll(selector);
      for (let i = 0; i < found.length; i++) add(found[i]);
    } catch (_) {}
  }

  return widgets;
}

/**
 * DataApp — Base class for Looker Lit Data Apps.
 * 
 * Provides reactive filter synchronization, keyboard shortcuts ('R' to refresh),
 * container-level Looker model scoping, and programmatic query execution.
 * 
 * @example
 * ```javascript
 * export class MyDataApp extends DataApp {
 *   constructor() {
 *     super();
 *     this.lookerModel = 'ecommerce';
 *   }
 * }
 * ```
 */
export class DataApp extends LitElement {
  static properties = {
    /**
     * Reactive dark theme state. When true, automatically applies and synchronizes
     * .dark-theme across the custom element, inner container, and document root.
     */
    isDark: { type: Boolean, attribute: 'is-dark', reflect: true },
    /** Looker model name inherited by child widgets. */
    lookerModel: { type: String, attribute: 'looker-model', reflect: true },
    /** Reactive dictionary of active Looker dashboard filter bar values. */
    dashboardFilters: { type: Object, attribute: 'dashboard-filters' },
    /** Reactive dictionary of active cross-filter values. */
    crossFilters: { type: Object },
    /** Global loading state indicator. */
    loading: { type: Boolean },
    /** Global error object if a top-level error occurs. */
    /**
     * Layout descriptor forwarded by the host from the app module's
     * optional `export const layout` (the `>>> app-layout >>>` theme
     * section). Absent → default theme. See applyAppLayout().
     */
    appLayout: { type: Object, attribute: false },
  };

  constructor() {
    super();
    this.loading = false;
    this.error = null;
    this.dashboardFilters = window.__lookerDashboardFilters || {};
    this.crossFilters = {};
    this._crossFilterRaw = new Map();
    this._crossFilterOrigins = new Map();
    this._onLookerFiltersChanged = (e) => {
      this.dashboardFilters = { ...(e.detail || {}) };
      this.requestUpdate();
    };
    this._initLookerContext();
  }

  /**
   * True while Looker renders this dashboard to a PDF or image, for a download
   * or a scheduled delivery. Known once the tile connects to Looker, before any
   * widget receives data. The runtime already turns off its own chart, grid and
   * CSS animations; check this to skip motion the app adds itself, such as a
   * count-up or a staged reveal, and draw the final state instead.
   *
   * @return {boolean}
   */
  get isRendering() {
    return _isRendering;
  }

  get isDark() {
    if (this._isDark !== undefined) return this._isDark;
    const container = getAppContainer(this);
    return Boolean(
      this.classList?.contains('dark-theme') ||
      container?.classList?.contains('dark-theme')
    );
  }

  _syncDarkTheme(nextDark) {
    if (this.classList && this.isConnected !== false) {
      if (typeof this.classList.toggle === 'function') {
        this.classList.toggle('dark-theme', nextDark);
      } else {
        if (nextDark) this.classList.add?.('dark-theme');
        else this.classList.remove?.('dark-theme');
      }
    }
    const container = getAppContainer(this);
    if (container?.classList && !isAppWidget(container)) {
      if (typeof container.classList.toggle === 'function') {
        container.classList.toggle('dark-theme', nextDark);
      } else {
        if (nextDark) container.classList.add?.('dark-theme');
        else container.classList.remove?.('dark-theme');
      }
    }

    if (typeof document !== 'undefined') {
      if (document.documentElement?.classList) {
        if (typeof document.documentElement.classList.toggle === 'function') {
          document.documentElement.classList.toggle('dark-theme', nextDark);
        } else {
          if (nextDark) document.documentElement.classList.add?.('dark-theme');
          else document.documentElement.classList.remove?.('dark-theme');
        }
      }
      if (document.body?.classList) {
        if (typeof document.body.classList.toggle === 'function') {
          document.body.classList.toggle('dark-theme', nextDark);
        } else {
          if (nextDark) document.body.classList.add?.('dark-theme');
          else document.body.classList.remove?.('dark-theme');
        }
      }
      if (document.body?.style) {
        document.body.style.backgroundColor = nextDark ? 'var(--app-bg, #0b0f19)' : '';
      }
    }

    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      // Wildcard target origin is deliberate: a published app runs in Looker's
      // extension iframe under `sandbox="allow-scripts"`, so its origin is
      // opaque and the parent's is unknowable from here. A `document.referrer`
      // fallback would fail silently whenever Referrer-Policy strips it, and
      // the payload is a theme string with nothing sensitive in it.
      try {
        // nosemgrep: looker-internal.javascript.browser.security.wildcard-postmessage-configuration, wildcard-postmessage-configuration
        window.parent.postMessage({ type: 'canvas-theme', theme: nextDark ? 'dark-theme' : 'light' }, '*');
      } catch (_) {}
    }
    this._hasSyncedTheme = true;
  }

  set isDark(val) {
    const nextDark = Boolean(val);
    if (this._isDark !== undefined && this._isDark === nextDark && this._hasSyncedTheme) return;
    const oldDark = this.isDark;
    this._isDark = nextDark;
    this._syncDarkTheme(nextDark);
    this.requestUpdate('isDark', oldDark);
  }

  connectedCallback() {
    super.connectedCallback();
    _connectedDataApps.add(this);
    window.addEventListener('looker-dashboard-filters-changed', this._onLookerFiltersChanged);

    // Synchronize theme on initial mount if an explicit isDark setting exists
    if (this._isDark !== undefined) {
      this._syncDarkTheme(this._isDark);
    }

    // Global 'R' key refreshes every chart/grid/kpi in the dashboard.
    // Ignored when the user is typing in an input, textarea, select, or contenteditable.
    this._keydownHandler = (e) => {
      if (e.key !== 'r' && e.key !== 'R') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      this.refreshAll();
    };
    window.addEventListener('keydown', this._keydownHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    _connectedDataApps.delete(this);
    window.removeEventListener('looker-dashboard-filters-changed', this._onLookerFiltersChanged);
    if (this._keydownHandler) {
      window.removeEventListener('keydown', this._keydownHandler);
      this._keydownHandler = null;
    }
  }

  /**
   * Refreshes every KPI, chart, and grid in this Data App.
   * Triggered by the global 'R' shortcut, filter changes, or manual invocations.
   */
  refreshAll() {
    const widgets = findAppWidgets(this);
    widgets.forEach(c => {
      if (typeof c.refresh === 'function') {
        try { c.refresh(); } catch {}
      } else if (typeof c.fetchData === 'function') {
        try { c.fetchData(); } catch {}
      }
    });
    if (typeof this.onRefresh === 'function') {
      try { this.onRefresh(); } catch {}
    }
    this.requestUpdate();
  }

  setCrossFilter(field, value, originElement) {
    if (!field) return;
    if (!this._crossFilterOrigins) this._crossFilterOrigins = new Map();
    if (!this._crossFilterRaw) this._crossFilterRaw = new Map();
    if (!this.crossFilters) this.crossFilters = {};
    if (originElement) {
      this._crossFilterOrigins.set(field, originElement);
      noteCrossFilterOrigin(field, originElement);
    }
    this._crossFilterRaw.set(field, value);
    const filterExpr = formatLookerCrossFilterValue(value);
    this.crossFilters = { ...this.crossFilters, [field]: filterExpr };
    this.requestUpdate();
    this._scheduleCrossFilterRepaint();
  }

  clearCrossFilter(field) {
    if (!field) {
      this.clearCrossFilters();
      return;
    }
    const prevOrigin = this._crossFilterOrigins instanceof Map ? this._crossFilterOrigins.get(field) : null;
    if (this._crossFilterRaw) this._crossFilterRaw.delete(field);
    if (this._crossFilterOrigins) this._crossFilterOrigins.delete(field);
    _crossFilterOrigin.delete(field);
    if (this.crossFilters && Object.prototype.hasOwnProperty.call(this.crossFilters, field)) {
      const { [field]: _removed, ...rest } = this.crossFilters;
      this.crossFilters = rest;
    }
    this.requestUpdate();
    this._scheduleCrossFilterRepaint(prevOrigin ? [prevOrigin] : []);
  }

  clearCrossFilters() {
    const keysToDelete = new Set(Object.keys(this.crossFilters || {}));
    const prevOrigins = this._crossFilterOrigins instanceof Map ? Array.from(this._crossFilterOrigins.values()) : [];
    if (this._crossFilterRaw) {
      for (const k of this._crossFilterRaw.keys()) keysToDelete.add(k);
      this._crossFilterRaw.clear();
    }
    if (this._crossFilterOrigins) {
      for (const k of this._crossFilterOrigins.keys()) keysToDelete.add(k);
      this._crossFilterOrigins.clear();
    }
    for (const k of keysToDelete) {
      _crossFilterOrigin.delete(k);
    }
    if ((!this.crossFilters || Object.keys(this.crossFilters).length === 0) && keysToDelete.size === 0) return;
    this.crossFilters = {};
    this.requestUpdate();
    this._scheduleCrossFilterRepaint(prevOrigins);
  }

  _scheduleCrossFilterRepaint(extraOrigins = []) {
    this._pendingCfOrigins ??= new Set();
    for (const o of extraOrigins) {
      if (o) this._pendingCfOrigins.add(o);
    }
    if (this._crossFilterOrigins instanceof Map) {
      for (const o of this._crossFilterOrigins.values()) {
        if (o) this._pendingCfOrigins.add(o);
      }
    }
    if (this._cfRepaintPending) return;
    this._cfRepaintPending = true;
    queueMicrotask(() => {
      const origins = Array.from(this._pendingCfOrigins || []);
      this._pendingCfOrigins?.clear();
      this._cfRepaintPending = false;
      if (this.isConnected === false) return;
      const widgets = new Set([
        ...findAppWidgets(this),
        ...origins,
        ...(this._crossFilterOrigins instanceof Map ? this._crossFilterOrigins.values() : []),
      ]);
      for (const w of widgets) {
        if (!w || w.isConnected === false) continue;
        if (typeof w._renderHighchart === 'function' && !w.loading) {
          const rows = w.data || w._fetchedRows;
          if (rows && rows.length > 0) {
            w._renderHighchart(rows);
          }
        }
      }
    });
  }

  toggleCrossFilter(field, value, originElement) {
    const hasFilter = Boolean(this.crossFilters && Object.prototype.hasOwnProperty.call(this.crossFilters, field));
    const hasRaw = this._crossFilterRaw instanceof Map && this._crossFilterRaw.has(field);
    if (hasFilter) {
      const currentRaw = hasRaw ? this._crossFilterRaw.get(field) : this.crossFilters[field];
      if (currentRaw === value) {
        this.clearCrossFilter(field);
        return;
      }
    }
    this.setCrossFilter(field, value, originElement);
  }

  /**
   * Returns merged filters combining Looker's dashboard filter bar values with local slicers.
   * 
   * @param {Object} [localFilters={}] - Local component-level filter overrides (e.g. `{ 'orders.status': 'complete' }`).
   * @return {Object} Combined filter dictionary.
   */
  getEffectiveFilters(localFilters = {}) {
    return { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}), ...localFilters };
  }

  /**
   * Toggles or explicitly sets dark mode across the app container, root document, and child widgets.
   *
   * @param {boolean} [force] - If provided, forces dark mode on (`true`) or off (`false`). If omitted, toggles current state.
   * @return {boolean} The new dark mode state (`true` if dark mode is active, `false` otherwise).
   *
   * @example
   * ```javascript
   * // Toggle dark mode on a button click
   * <button @click=${() => this.toggleDarkMode()}>🌓 Toggle Theme</button>
   *
   * // Explicitly set dark mode
   * this.toggleDarkMode(true);
   * ```
   */
  toggleDarkMode(force) {
    this.isDark = typeof force === 'boolean' ? force : !this.isDark;
    return this.isDark;
  }

  renderThemeToggle(options = {}) {
    const isChecked = Boolean(this.isDark);
    const hasCustomLabel = options.label !== undefined;
    const showLabel = options.showLabel !== false;
    const isSingleOrBare = !showLabel || hasCustomLabel;
    const ariaLabel = hasCustomLabel ? options.label : 'Dark mode';
    const lightLabel = options.lightLabel !== undefined ? options.lightLabel : 'Light';
    const darkLabel = options.darkLabel !== undefined ? options.darkLabel : 'Dark';
    const extraClass = [
      isSingleOrBare ? 'da-theme-toggle--bare' : '',
      options.class || '',
    ].filter(Boolean).join(' ');

    return html`
      <label
        class="da-theme-toggle ${extraClass}"
        title="${hasCustomLabel ? options.label : (showLabel ? '' : ariaLabel)}"
      >
        <input
          type="checkbox"
          role="switch"
          .checked=${isChecked}
          aria-label="${ariaLabel}"
          @change=${(e) => {
            this.toggleDarkMode();
            if (typeof options.onChange === 'function') options.onChange(this.isDark, e);
          }}
        />
        ${showLabel && !hasCustomLabel
          ? html`<span
              class="da-theme-toggle-label"
              data-mode="light"
              aria-hidden="true"
              @click=${(e) => { if (!this.isDark) e.preventDefault(); }}
            >${lightLabel}</span>`
          : ''}
        <span class="da-theme-toggle-slider" aria-hidden="true">
          <span class="da-theme-toggle-knob"></span>
        </span>
        ${showLabel
          ? (hasCustomLabel
              ? html`<span class="da-theme-toggle-label" aria-hidden="true">${options.label}</span>`
              : html`<span
                  class="da-theme-toggle-label"
                  data-mode="dark"
                  aria-hidden="true"
                  @click=${(e) => { if (this.isDark) e.preventDefault(); }}
                >${darkLabel}</span>`)
          : ''}
      </label>
    `;
  }

  _resolveToolkitVersion(runtimeUrl = RUNTIME_BASE) {
    const match = typeof runtimeUrl === 'string' ? runtimeUrl.match(/\/versions\/([^/]+)\//) : null;
    return match ? match[1].trim().replace(/^v/i, '') : '';
  }

  _resolveLastUpdated() {
    const raw =
      (typeof window !== 'undefined' && window.__lookerDataAppMeta?.publishedAt) ||
      '';
    return formatStampDate(String(raw || ''));
  }

  _formatStampText(runtimeUrl = RUNTIME_BASE) {
    const ver = this._resolveToolkitVersion(runtimeUrl);
    const upd = this._resolveLastUpdated();
    const verPart = ver ? ` v${ver}` : '';
    const datePart = upd ? ` - last update ${upd}` : ' - local dev';
    return `powered by Looker Data Apps${verPart}${datePart}`;
  }

  _syncStamp() {
    if (!this.isConnected || typeof document === 'undefined' || !document.body) return;
    if (typeof this.querySelector !== 'function') return;
    const target = getAppContainer(this) || this;
    if (!target || typeof target.appendChild !== 'function') return;
    let stampEl = this.querySelector('.da-stamp');
    if (typeof this.querySelectorAll === 'function') {
      const allStamps = Array.from(this.querySelectorAll('.da-stamp'));
      if (allStamps.length > 1) {
        stampEl = allStamps[0];
        for (let i = 1; i < allStamps.length; i++) {
          if (allStamps[i].parentNode) allStamps[i].parentNode.removeChild(allStamps[i]);
        }
      }
    }
    if (!stampEl) {
      stampEl = document.createElement('div');
      if (!stampEl || !stampEl.style) return;
      stampEl.className = 'da-stamp';
    }
    stampEl.textContent = this._formatStampText();
    if (stampEl.parentNode !== target || target.lastElementChild !== stampEl) {
      target.appendChild(stampEl);
    }
  }

  createRenderRoot() {
    return this;
  }

  /**
   * Re-assert the app's layout after every Lit render. Running here
   * (rather than once at mount) is what keeps additive styles from being
   * clobbered by a re-render — filter change, cross-filter, tab switch. A
   * missing descriptor short-circuits inside applyAppLayout before any DOM
   * read, so apps without a layout section pay nothing.
   */
  updated(changedProps) {
    super.updated(changedProps);
    try {
      // Grid-native placement first (the default layout path); then the legacy
      // descriptor applier, which no-ops for an app with no `layout` section.
      applyGridCells(this);
      applyAppLayout(this, this.appLayout);
    } catch (e) {
      if (window.DataApps && window.DataApps._debug) {
        console.warn('[data-app] layout apply failed:', e);
      }
    }
    try {
      const container = getAppContainer(this);
      if (this._isDark === undefined) {
        if (container?.classList?.contains('dark-theme') && !isAppWidget(container)) {
          this.isDark = true;
        }
      } else {
        if (container?.classList && !isAppWidget(container)) {
          if (container.classList.contains('dark-theme') !== this.isDark) {
            container.classList.toggle('dark-theme', this.isDark);
          }
        }
      }
    } catch (_) {}
    try {
      this._syncStamp();
    } catch (_) {}
  }

  async _initLookerContext() {
    if (window.DataApps && window.DataApps._extensionInitPromise) {
      await window.DataApps._extensionInitPromise;
      this.requestUpdate();
    }
  }

  /**
   * Programmatically execute an arbitrary Looker query via the host SDK or preview proxy.
   * Useful for dynamic filter dropdown options, lookup tables, and multi-explore data aggregation.
   * 
   * @param {Object} query - Looker query object.
   * @param {string} [query.model] - LookML model name (defaults to `this.lookerModel`).
   * @param {string} [query.explore] - LookML explore name (e.g. `'orders'`).
   * @param {string} [query.view] - Alias for `query.explore`.
   * @param {string[]} query.fields - List of LookML dimensions and measures (e.g. `['orders.category']`).
   * @param {Object} [query.filters] - Map of filter expressions (supports substrings `%...%`, measure bounds `<0.60`, dates).
   * @param {string[]} [query.sorts] - Sort directives (e.g. `['orders.created_date desc']`).
   * @param {string|number} [query.limit='500'] - Maximum rows to return.
   * @param {AbortSignal} [signal] - Optional AbortSignal for request cancellation.
   * @return {Promise<Array<Object>>} Resolves to array of raw Looker row dictionaries with dotted LookML keys.
   * 
   * @example
   * ```javascript
   * const rows = await this.runQuery({
   *   explore: 'orders',
   *   fields: ['orders.category'],
   *   filters: { 'orders.is_active': 'Yes' },
   *   limit: '50'
   * });
   * ```
   */
  async runQuery(query, signal) {
    if (!query) throw new Error('runQuery: query definition is required');
    // Holds the render-complete signal while in flight: the app renders what
    // this returns, which no widget's state reflects.
    _pendingAppQueries++;
    try {
      if (window.DataApps._extensionInitPromise) {
        await window.DataApps._extensionInitPromise;
      }
      const model = query.model || this.lookerModel;
      if (!model && !query.model) {
        throw new Error('runQuery: model must be specified on query or DataApp');
      }
      const fullQuery = normalizeQueryPayload({ ...query, model: query.model || model });
      try {
        return await window.DataApps.queryRunner(fullQuery, signal);
      } catch (err) {
        reportRuntimeError('DataApp.runQuery failed', err, { query: fullQuery });
        throw err;
      }
    } finally {
      _pendingAppQueries--;
    }
  }

  /**
   * Execute multiple queries in parallel and merge their row results into a unified array by join key(s).
   * Streamlines combining multi-array view metrics into composite multi-series charts without manual map/reduce code.
   *
   * @param {Object} options - Merge configuration.
   * @param {string|string[]} [options.on] - Dimension key or array of keys to join rows on (e.g. `'code_coverage.test_suite'`).
   * @param {Array<Object>|Object} [options.queries] - Array of query objects or named query dictionary.
   * @param {AbortSignal} [options.signal] - Optional AbortSignal for request cancellation.
   * @return {Promise<Array<Object>>} Full outer joined rows array.
   *
   * @example
   * ```javascript
   * const rows = await this.mergeQueries({
   *   lines: { explore: 'code_coverage', fields: ['code_coverage.test_suite', 'coverage__file_info__line_details.absolute_coverage_percentage'] },
   *   branches: { explore: 'code_coverage', fields: ['code_coverage.test_suite', 'coverage__file_info__branch_details.absolute_coverage_percentage'] },
   *   on: 'code_coverage.test_suite',
   * });
   * ```
   */
  async mergeQueries(options = {}) {
    if (!options || typeof options !== 'object') {
      throw new Error('mergeQueries: options object is required');
    }

    let queryList = [];
    if (Array.isArray(options.queries)) {
      queryList = options.queries;
    } else if (options.queries && typeof options.queries === 'object') {
      queryList = Object.values(options.queries);
    } else {
      for (const [k, v] of Object.entries(options)) {
        if (k !== 'on' && k !== 'signal' && k !== 'model' && k !== 'explore' && k !== 'view' && v && typeof v === 'object' && Array.isArray(v.fields)) {
          queryList.push(v);
        }
      }
    }

    if (queryList.length === 0) return [];
    if (queryList.length === 1) return await this.runQuery(queryList[0], options.signal);

    let joinKeys = options.on;
    if (typeof joinKeys === 'string') {
      joinKeys = [joinKeys];
    } else if (!Array.isArray(joinKeys) || joinKeys.length === 0) {
      // Auto-detect first common field across all queries
      const fieldSets = queryList.map(q => new Set(q.fields || []));
      const commonFields = (queryList[0].fields || []).filter(f => fieldSets.every(s => s.has(f)));
      if (commonFields.length > 0) {
        joinKeys = [commonFields[0]];
      } else {
        throw new Error('mergeQueries: No join key specified in "on", and no common fields found across queries.');
      }
    }

    const signal = options.signal;
    const results = await Promise.all(
      queryList.map(q => this.runQuery(q, signal))
    );

    const getRowKey = (row) => joinKeys.map(k => String(row[k] ?? '')).join(':::');
    const mergedMap = new Map();

    for (const rows of results) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row) continue;
        const key = getRowKey(row);
        let existing = mergedMap.get(key);
        if (!existing) {
          existing = {};
          mergedMap.set(key, existing);
        }
        Object.assign(existing, row);
      }
    }

    return Array.from(mergedMap.values());
  }
}

// Auto-mount any DataApp custom element if running in a tile and no instance is attached
if (typeof customElements !== 'undefined' && customElements.define) {
  const originalDefine = customElements.define.bind(customElements);
  customElements.define = function (name, constructor, options) {
    originalDefine(name, constructor, options);
    const isAppSubclass = Boolean(
      constructor &&
      typeof constructor === 'function' &&
      (constructor.prototype instanceof DataApp || constructor === DataApp)
    );
    if (name && typeof name === 'string' && !isAppSubclass) {
      registerWidgetTag(name);
    }
    if (isAppSubclass) {
      const mount = () => {
        if (
          typeof document !== 'undefined' &&
          document.body &&
          !document.getElementById('app-root') &&
          !document.getElementById('sandboxed-app-root') &&
          !document.querySelector(name)
        ) {
          const el = document.createElement(name);
          if (constructor.layout) {
            el.appLayout = constructor.layout;
          }
          document.body.appendChild(el);
        }
      };
      if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', mount, { once: true });
        } else {
          queueMicrotask(mount);
        }
      }
    }
  };
}

/**
 * Helper to resolve Looker model from widget, parent container attributes, or parent DataApp instance.
 */
export function resolveParentModel(el) {
  if (el.lookerModel) return el.lookerModel;
  let cur = el.parentElement;
  while (cur) {
    if (cur.getAttribute && cur.getAttribute('looker-model')) {
      return cur.getAttribute('looker-model');
    }
    if (cur.lookerModel) {
      return cur.lookerModel;
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Helper to resolve Looker explore from widget or parent container attributes.
 */
export function resolveParentExplore(el) {
  if (el.explore) return el.explore;
  let cur = el.parentElement;
  while (cur) {
    if (cur.getAttribute && cur.getAttribute('explore')) {
      return cur.getAttribute('explore');
    }
    if (cur.explore) {
      return cur.explore;
    }
    cur = cur.parentElement;
  }
  return null;
}

/* ==========================================================================
   Layout support — theme and the coordinate grid.

   An app's layout is CSS the author writes. The runtime adds only two things:

   1. THEME. An app may carry a theme (colour roles, font, light/dark) in an
      `export const layout = { theme }` section, delimited by
      `>>> app-layout >>>` sentinels. The retired local editor wrote these
      sections; apps that still have one keep rendering with it. The host
      forwards it as `.appLayout` and `applyAppLayout` re-applies it to the
      live DOM after every Lit render. No descriptor === no-op, at zero cost.

   2. THE COORDINATE GRID (opt-in). An app that wants BI-style fixed tiles
      renders `.da-grid` and gives each child a `cell="x y w h"`. See
      `applyGridCells`.
    - Coordinate flattening / layout descriptor: removed. Superseded by the
      native coordinate grid above.
    ========================================================================== */

// Font choices are limited to system / web-safe stacks on purpose: the tile
// runs under a strict CSP with no web-font egress, so a saved font must render
// from families already on the machine.
export const LAYOUT_FONT_STACKS = {
  'System': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  'Inter': 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  'Mono': 'ui-monospace, "SF Mono", Monaco, "Cascadia Mono", monospace',
  'Serif': 'Georgia, Cambria, "Times New Roman", Times, serif',
};

/**
 * The layout root of a mounted app: its `.da-container` if it draws one,
 * else the app element itself (a custom shell).
 *
 * @param {Element} appEl
 * @return {Element|null}
 */
export function resolveAppRoot(appEl) {
  if (!appEl) return null;
  return getAppContainer(appEl) || appEl;
}

/**
 * Apply an app-layout theme to a mounted app's live DOM.
 *
 * Idempotent and additive: it writes only `--app-*` custom properties,
 * `font-family`, and the `.dark-theme` class, tracking what it set so a role
 * dropped from the descriptor resets cleanly on the next pass. The author's own
 * styles are never touched.
 *
 * @param {Element} appEl - the mounted DataApp element.
 * @param {Object} [layout] - descriptor { theme }. Falsy → no-op.
 */
export function applyAppLayout(appEl, layout) {
  if (!layout || typeof layout !== 'object') return;
  const theme = layout.theme;
  if (!theme || typeof theme !== 'object') return;
  const containerEl = resolveAppRoot(appEl);
  if (!containerEl) return;

  const managed = new Set();
  if (theme.vars && typeof theme.vars === 'object') {
    for (const [k, v] of Object.entries(theme.vars)) {
      if (typeof k === 'string' && k.startsWith('--') &&
          (typeof v === 'string' || typeof v === 'number')) {
        containerEl.style.setProperty(k, String(v));
        managed.add(k);
      }
    }
  }
  // Clear a var we set on a previous pass but the descriptor dropped.
  const prevVars = containerEl._cdManagedVars;
  if (prevVars) {
    for (const k of prevVars) {
      if (!managed.has(k)) containerEl.style.removeProperty(k);
    }
  }
  containerEl._cdManagedVars = managed;

  if (theme.font) {
    containerEl.style.fontFamily = LAYOUT_FONT_STACKS[theme.font] || theme.font;
    containerEl.dataset.cdFont = '1';
  } else if (containerEl.dataset.cdFont) {
    containerEl.style.fontFamily = '';
    delete containerEl.dataset.cdFont;
  }

  if (theme.dark === true) containerEl.classList.add('dark-theme');
  else if (theme.dark === false) containerEl.classList.remove('dark-theme');
}


/* ==========================================================================
   Grid-native layout — the app's main layout IS a real, fine CSS grid.

   A grid-native app renders `.da-grid` (a real `display:grid`; see
   data-app.css) and gives each direct child a `cell="W H"` — a column-span
   over the grid's N columns and a row-span over its small row unit. The browser
   lays the grid out natively; this function only turns that compact attribute
   into the two properties the grid reads (`grid-column`/`grid-row`), plus an
   optional legacy `order`. There is no seed, no flatten,
   no reverse-engineering: the markup is the single source of the layout.

   Runs from DataApp.updated() every render (additive + idempotent), so a tile
   Lit re-creates on a filter change gets its span re-applied.
   ========================================================================== */

/** Turn one element's `cell` attribute into inline grid placement. Two forms:
 *
 *   cell="x y w h"  — COORDINATE placement (the BI-grid default). `x`/`y` are the
 *                     0-based start column/row; `w`/`h` are the spans. Becomes
 *                     `grid-column: (x+1) / span w; grid-row: (y+1) / span h`, so
 *                     the tile owns a FIXED cell — moving/resizing one tile never
 *                     reflows another. The columns are fractional (see
 *                     data-app.css), so the placement is a proportion that
 *                     scales with width, and the grid collapses to a single
 *                     stacked column when narrow.
 *
 *   cell="w h"      — LEGACY size-only span (auto-flow): `grid-column: span w;
 *                     grid-row: span h`, packed in source order. Retained so apps
 *                     authored before the coordinate model keep working untouched.
 *
 * A missing/empty value clears the placement (the element flows normally).
 * Exported for tests. */
export function applyCellTo(el) {
  if (!el || el.nodeType !== 1 || !el.getAttribute) return;
  const raw = el.getAttribute('cell');
  if (raw != null && raw !== '') {
    const p = String(raw).trim().split(/[\s,]+/).map(Number);
    if (p.length >= 4 && p.slice(0, 4).every(Number.isFinite)) {
      // Coordinate placement: x y w h (0-based x/y, ≥1 spans w/h).
      const x = Math.max(0, Math.floor(p[0]));
      const y = Math.max(0, Math.floor(p[1]));
      const w = Math.max(1, Math.floor(p[2]));
      const h = Math.max(1, Math.floor(p[3]));
      el.style.gridColumn = (x + 1) + ' / span ' + w;
      el.style.gridRow = (y + 1) + ' / span ' + h;
      if (w <= 28) {
        el.dataset.gridSpan = 'quarter';
      } else if (w <= 40) {
        el.dataset.gridSpan = 'third';
      } else if (w <= 64) {
        el.dataset.gridSpan = 'half';
      } else {
        el.dataset.gridSpan = 'full';
      }
    } else {
      // Legacy size-only span → auto-flow placement.
      const w = Math.floor(p[0]);
      const h = Math.floor(p[1]);
      el.style.gridColumn = Number.isFinite(w) && w >= 1 ? 'span ' + w : '';
      el.style.gridRow = Number.isFinite(h) && h >= 1 ? 'span ' + h : '';
      delete el.dataset.gridSpan;
    }
  } else {
    el.style.gridColumn = '';
    el.style.gridRow = '';
    delete el.dataset.gridSpan;
  }
  // `order` only means anything in the legacy auto-flow model; a coordinate tile
  // has an explicit position and ignores it. Honoured here for old apps only.
  const ord = el.getAttribute('order');
  if (ord != null && ord !== '') {
    const n = Number(ord);
    el.style.order = Number.isFinite(n) ? String(Math.floor(n)) : '';
  } else if (el.style.order) {
    el.style.order = '';
  }
}

/**
 * Apply every `.da-grid` tile's `cell` span in a mounted app. Called after
 * each render.
 *
 * @param {Element} appEl - the mounted DataApp element.
 */
export function applyGridCells(appEl) {
  if (!appEl || !appEl.querySelectorAll) return;
  const grids = appEl.querySelectorAll('.da-grid');
  for (const grid of grids) {
    for (const child of grid.children) {
      applyCellTo(child);
    }
  }
}

/**
 * <app-kpi> — Reactive KPI card component.
 *
 * Self-contained card with label, formatted metric value, period-over-period delta badge,
 * icon, subtitle, and automatic query fetching.
 * 
 * @example
 * ```html
 * <app-kpi
 *   explore="orders"
 *   query-field="orders.total_revenue"
 *   label="Total Revenue"
 *   format="usd"
 *   icon="💰"
 *   .filters=${this.getEffectiveFilters()}
 * ></app-kpi>
 * ```
 */

/**
 * Shared query lifecycle for every data-bound widget.
 *
 * KPI, chart, and grid differ only in *what they ask for* and *what they do
 * with the rows*. Everything in between — dedupe, abort, staleness guards,
 * loading/error state — was copy-pasted three ways and had already drifted.
 * It lives here once.
 *
 * Subclasses implement:
 *   `_buildQuery()`      → a Looker query object, or a falsy value to skip.
 *   `_receiveRows(rows)` → store and/or render the result.
 *   `_skipFetch()`       → optional; true when the widget shouldn't query at all.
 *
 * Subclasses set `_ignoreWhenDataSet = true` when an author-supplied `.data`
 * should win over an in-flight response (chart and grid; a KPI has no `.data`).
 */
/**
 * Is this element rendering on a dark surface?
 *
 * The theme is a CSS class on an ancestor (`.dark-theme`), not a reactive
 * property, so Lit never sees it change. Widgets that paint their own pixels
 * (Highcharts SVG, AG Grid) therefore can't re-theme on their own — hence the
 * observer below. An explicit `theme="dark"` / `theme="light"` on the widget
 * wins over the surrounding class.
 */
export function isDarkContext(el) {
  if (!el) return false;
  if (el.theme === 'dark' || el.theme === 'quartz-dark') return true;
  if (el.theme === 'light' || el.theme === 'quartz') return false;
  return Boolean(
    el.closest?.('.dark-theme') ||
    el.classList?.contains('dark-theme')
  );
}

/**
 * Resolve a CSS custom-property reference to a concrete colour, read from the
 * live cascade at `el`. Highcharts takes colour strings verbatim — it does no
 * `var()` resolution — so a chart authored `color="var(--brand-red)"` (or a
 * `.options.colors` / `categoryColors` entry that is a `var()`) must be turned
 * into a real colour here, before the value reaches Highcharts. This is also
 * what lets a theme-panel token edit recolour a chart: the panel changes the
 * variable, and the chart re-resolves it on its next render.
 *
 * - A non-string, or a string that is not a `var(...)` expression, is returned
 *   unchanged — a literal hex / rgb / gradient object passes straight through.
 * - `var(--x)` → the computed value of `--x` at `el`. That value may itself be a
 *   `var()` (an app may route `--app-primary: var(--brand-red)`), so resolve
 *   recursively.
 * - `var(--x, fallback)` → the fallback (recursively resolved) when `--x` is
 *   undefined/empty.
 * Falls back to the original string when nothing resolves, so a bad token
 * degrades to a visible value rather than throwing.
 *
 * @param {*} value - a colour string, or anything (non-strings pass through).
 * @param {Element} el - the element whose computed style supplies the variable.
 * @return {*}
 */
export function resolveColor(value, el) {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!s.startsWith('var(')) return value;
  const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,([\s\S]*))?\)$/.exec(s);
  if (!m) return value;
  const name = m[1];
  const fallback = m[2] != null ? m[2].trim() : '';
  let resolved = '';
  try {
    if (el && typeof getComputedStyle === 'function') {
      resolved = getComputedStyle(el).getPropertyValue(name).trim();
    }
  } catch (_) { /* detached node / no view */ }
  if (resolved) return resolveColor(resolved, el);
  if (fallback) return resolveColor(fallback, el);
  return value;
}

// One observer for every mounted widget, rather than one each. Watches class
// attributes anywhere in the document so a toggle on the app root — the usual
// place — reaches widgets nested arbitrarily deep.
const _themeAware = new Set();
let _themeObserver = null;

function _watchTheme(el) {
  el._isDarkTheme = isDarkContext(el);
  _themeAware.add(el);
  if (_themeObserver || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  _themeObserver = new MutationObserver(() => {
    for (const w of _themeAware) {
      const now = isDarkContext(w);
      if (now === w._isDarkTheme) continue;
      w._isDarkTheme = now;
      try { w.onThemeChange(now); } catch (e) { reportRuntimeWarning('theme change failed', e); }
    }
  });
  _themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: true,
  });
}

function _unwatchTheme(el) {
  _themeAware.delete(el);
}

let _widgetActions = {};
export const TILE_WIDGET_ACTION = 'TILE_WIDGET_ACTION';

export function _setWidgetActions(actions) {
  const next = actions && typeof actions === 'object' && !Array.isArray(actions) ? actions : {};
  if (areQueriesEqual(_widgetActions, next)) return;
  _widgetActions = next;
  // _themeAware holds all currently connected AppWidget instances (registered in connectedCallback).
  for (const w of _themeAware) {
    w.requestUpdate();
  }
}


/**
 * First-paint filter gate (tile context only).
 *
 * The runtime bootstrap resolves the dashboard's filters asynchronously and
 * then sets `window.__lookerDashboardFilters` + dispatches
 * `looker-dashboard-filters-changed`. Widgets that fetch straight from
 * `firstUpdated()` therefore fire an UNFILTERED query, and re-fetch the
 * filtered one the moment the broadcast lands -- two queries per widget on
 * every load of a filtered dashboard, plus the flicker of showing the wrong
 * numbers first.
 *
 * So the first fetch waits for the broadcast. Outside a tile (local preview,
 * standalone) there is no broadcast and no wait. The timeout keeps a host
 * that never broadcasts from leaving the app blank forever -- it renders
 * unfiltered instead, which is the old behaviour.
 */
/**
 * Runtime error reporting.
 *
 * The message line is ALWAYS logged. An authoring agent watching the console is
 * how a broken query gets noticed during local development, and gating that
 * behind a flag means the agent never sees the thing it is meant to fix.
 *
 * The structured payload is not always logged. It carries the query and, for a
 * render failure, the options the chart was built from -- which contain the
 * fetched rows. `dist/SECURITY.md` tells customer security teams that
 * diagnostic surfaces in the published tile are gated behind `?debug=1` or
 * `localStorage.dataAppsDebug`, so inside a tile that is exactly what gates it.
 * Outside one -- the preview, where authoring happens -- it is always on.
 *
 * Nothing here is handed the widget itself. The console retains whatever it is
 * given, and a widget reference pins that widget and every row it fetched for
 * the life of the page.
 */

const FILTER_GATE_TIMEOUT_MS = 4000;
let _filterGate = null;

export function whenDashboardFiltersReady() {
  if (_filterGate) return _filterGate;

  const inTile = !!(window.DataApps && window.DataApps._extensionInitPromise);
  if (!inTile || window.__lookerDashboardFilters) {
    _filterGate = Promise.resolve();
    return _filterGate;
  }

  _filterGate = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener('looker-dashboard-filters-changed', finish);
      resolve();
    };
    window.addEventListener('looker-dashboard-filters-changed', finish);
    setTimeout(() => {
      if (!settled) {
        console.warn(
          '[data-app] dashboard filters did not arrive within '
          + FILTER_GATE_TIMEOUT_MS + 'ms; rendering unfiltered.'
        );
      }
      finish();
    }, FILTER_GATE_TIMEOUT_MS);
  });
  return _filterGate;
}


/**
 * Cross-filter self-exclusion.
 *
 * In legacy runtimes a chart never applied a broadcast filter naming its own
 * category or slice field (getBroadcastFilters).
 * Without that guard, clicking a bar to cross-filter the dashboard also
 * filters the clicked chart itself, so it collapses to the single bar you
 * just clicked -- which reads as the chart breaking.
 *
 * The filter bar and cross-filter clicks arrive merged as one flat
 * `{field: value}` map, so provenance cannot be recovered downstream. Record
 * it here instead: which element last set a field by a click. Only that
 * element skips the field; every other widget still filters on it, which is
 * the entire point of cross-filtering.
 */
const _crossFilterOrigin = new Map();

function stripAuthorPointClickOptions(opts) {
  if (!opts || typeof opts !== 'object' || !opts.plotOptions || typeof opts.plotOptions !== 'object') {
    return opts;
  }
  let clonedPlotOptions = null;
  for (const [k, v] of Object.entries(opts.plotOptions)) {
    if (v && typeof v === 'object' && v.point?.events?.click) {
      if (!clonedPlotOptions) clonedPlotOptions = { ...opts.plotOptions };
      const nextEvents = { ...v.point.events };
      delete nextEvents.click;
      clonedPlotOptions[k] = {
        ...v,
        point: { ...v.point, events: nextEvents },
      };
    }
  }
  return clonedPlotOptions ? { ...opts, plotOptions: clonedPlotOptions } : opts;
}

/**
 * Converts a raw clicked dimension value into a Looker filter expression.
 * String values escape ^, ,, %, _, a leading -, and reserved string filter
 * keywords (NULL, EMPTY, NOT NULL) per Looker's filter expression syntax:
 * https://cloud.google.com/looker/docs/filter-expressions
 */
function formatLookerCrossFilterValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return 'NULL';
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? String(rawValue) : 'NULL';
  }
  const str = String(rawValue);
  if (str === '') return 'EMPTY';
  let escaped = str.replace(/[\^,%_]/g, '^$&');
  if (escaped.startsWith('-')) {
    escaped = '^' + escaped;
  } else if (/^(?:NULL|EMPTY|NOT\s+NULL)$/i.test(escaped)) {
    escaped = '^' + escaped;
  }
  return escaped;
}

export function noteCrossFilterOrigin(field, element) {
  if (field) {
    _crossFilterOrigin.set(field, element);
  }
}

// Every property declared on AppWidget and AppChart must appear in exactly one of
// CHART_IDENTITY_PROPS or CHART_NON_IDENTITY_PROPS. tests/unit_runtime.test.js enforces this partition.
export const CHART_IDENTITY_PROPS = ['cell', 'type', 'title', 'yScaleGroup', 'lookerModel', 'explore', 'query', 'fields', 'dimensions', 'measures', 'pivots', 'pivotBy', 'crossFilter', 'sorts', 'limit'];
export const CHART_NON_IDENTITY_PROPS = ['height', 'filters', 'valueFormat', 'color', 'polarity', 'categoryColors', 'selectedValue', 'selected', 'options', 'data', 'sampleData', 'bare', 'theme', 'loading', 'error'];

/** Properties that feed `_buildQuery()`. A change to any of them schedules a fetch; `fetchData()` still skips the round-trip when the effective query is unchanged. */
export const QUERY_INPUT_PROPS = new Set(['lookerModel', 'explore', 'queryField', 'fields', 'dimensions', 'pivots', 'pivotBy', 'measures', 'sorts', 'limit']);

/** Default query limits and sort direction shared by widget `_buildQuery()` methods and `widget_extractor.py`. */
export const WIDGET_QUERY_DEFAULTS = {
  chartLimit: '500',
  gridLimit: '100',
  kpiLimit: '1',
  kpiSparklineLimit: '24',
  kpiSparklineSortDir: 'desc',
};

function _originSignature(el) {
  if (!el) return '';
  const parts = CHART_IDENTITY_PROPS.map(p => {
    const v = el[p];
    if (p === 'query' && v && typeof v === 'object') {
      const { filters, ...rest } = v;   // filters follow dashboard and cross-filter state, not identity
      return rest;
    }
    return v ?? '';
  });
  return JSON.stringify([el.tagName || '', el.id || '', el.subtitle || '', ...parts]);
}

export function isSameCrossFilterOrigin(origin, element) {
  if (origin === element) return true;
  if (!origin || !element || origin.isConnected !== false || origin.constructor !== element.constructor) return false;
  const originHost = origin._cachedHostApp || (typeof origin._hostApp === 'function' ? origin._hostApp() : null);
  const elemHost = (typeof element._hostApp === 'function' ? element._hostApp() : null) || element._cachedHostApp;
  if (originHost && elemHost && originHost !== elemHost) return false;
  return _originSignature(origin) === _originSignature(element);
}

function dropSelfCrossFilters(filters, element) {
  if (!filters || !element) return filters;
  const hostOrigins = typeof element._hostApp === 'function' ? element._hostApp()?._crossFilterOrigins : null;
  let out = null;
  for (const key of Object.keys(filters)) {
    const hasHostOrigin = hostOrigins instanceof Map && hostOrigins.has(key);
    const origin = hasHostOrigin
      ? hostOrigins.get(key)
      : _crossFilterOrigin.get(key);
    if (isSameCrossFilterOrigin(origin, element)) {
      if (origin !== element) {
        if (hasHostOrigin) {
          hostOrigins.set(key, element);
        }
        if (_crossFilterOrigin.get(key) === origin) {
          _crossFilterOrigin.set(key, element);
        }
      }
      out = out || { ...filters };
      delete out[key];
    }
  }
  return out || filters;
}

export class AppWidget extends LitElement {
  static properties = {
    /**
     * Grid placement on a `.da-grid`: `cell="x y w h"` — the 0-based
     * start column/row and the column/row spans — which the runtime turns into
     * `grid-column: (x+1) / span w; grid-row: (y+1) / span h` (see applyCellTo).
     * Each tile owns a fixed cell, so moving or resizing one never disturbs
     * another (the BI-grid feel). The layout lives in the markup. A 2-number `cell="w h"`
     * is still accepted as a legacy size-only span (auto-flow). Absent → the
     * widget is not a grid tile (nested content, or a free-form custom layout).
     */
    cell: { type: String, reflect: true },
  };

  /** `da-<tag>-<slug>` from the title, label, query-field or fields: the name the
   * publisher derives (widget_extractor.py; kept in sync by tests/parity_harness.mjs). */
  _baseWidgetSlug() {
    const tag = (this.tagName || 'widget').toLowerCase().replace(/^app-/, '');
    const source = this.title || this.label || this.queryField
      || this._resolveFields(this.query || {}, 'fields', 'dimensions', 'measures').join('-');
    const slug = String(source || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+/, '')
      .slice(0, 48)
      .replace(/-+$/, '');
    return { baseId: slug ? `da-${tag}-${slug}` : `da-${tag}`, hasSlug: Boolean(slug) };
  }

  _getKeyedCopyId(allWidgets = null) {
    const key = this.getAttribute?.('data-da-key');
    if (!key) return '';
    const all = allWidgets || findAppWidgets(this._hostApp() || this.getRootNode?.() || (typeof document !== 'undefined' ? document : null));
    const twins = all.filter((w) => w.getAttribute?.('data-da-key') === key);
    const idx = twins.indexOf(this);
    return `${key}~${idx < 0 ? 0 : idx}`;
  }

  /** Unique instance id: the stamped `id`, else `<data-da-key>~<index>` for copies
   * rendered from one tag, else a `da-local-` id the publisher never emits. */
  getWidgetId() {
    const explicit = this.id || this.getAttribute?.('id') || '';
    const key = this.getAttribute?.('data-da-key');
    if (key) {
      const root = this._hostApp() || this.getRootNode?.() || (typeof document !== 'undefined' ? document : null);
      const all = findAppWidgets(root);
      if (explicit && !all.some((w) => w !== this && (w.id || w.getAttribute?.('id')) === explicit)) {
        return explicit;
      }
      return this._getKeyedCopyId(all);
    }
    if (explicit) return explicit;
    return this._baseWidgetSlug().baseId.replace(/^da-/, 'da-local-');
  }

  /** Manifest key for this widget: the shared `data-da-key`, else its id. */
  getQueryKey() {
    return this.getAttribute?.('data-da-key') || this.getWidgetId();
  }

  /**
   * Action key for this widget: its per-instance `getWidgetId()` or `<key>~<index>`
   * when the host offered actions for that unrolled copy, falling back to `getQueryKey()`.
   */
  _resolveActionKey() {
    const wid = this.getWidgetId();
    if (wid && Object.hasOwn(_widgetActions, wid)) return wid;
    const keyedId = this._getKeyedCopyId();
    if (keyedId && Object.hasOwn(_widgetActions, keyedId)) return keyedId;
    return this.getQueryKey();
  }

  /**
   * Returns the host-offered widget actions for this widget.
   *
   * @return {Array<{id: string, label: string, icon: string}>}
   */
  getOfferedWidgetActions() {
    const key = this._resolveActionKey();
    const actions = key && Object.hasOwn(_widgetActions, key) ? _widgetActions[key] : null;
    return Array.isArray(actions) ? actions : [];
  }

  _getWidgetActionQuery() {
    if (this._lastFetchedQuery) return JSON.parse(JSON.stringify(this._lastFetchedQuery));
    const built = typeof this._buildQuery === 'function' ? this._buildQuery() : null;
    if (!built) return null;
    return normalizeQueryPayload({
      ...built,
      ...(built.filters ? { filters: dropSelfCrossFilters(built.filters, this) } : {}),
    });
  }

  triggerWidgetAction(actionId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const widgetId = this._resolveActionKey();
    if (!actionId || !widgetId || typeof _extensionSDK?.send !== 'function') return false;
    const query = this._getWidgetActionQuery();
    try {
      _extensionSDK.send(TILE_WIDGET_ACTION, {
        actionId,
        widgetId,
        filters: query?.filters ? { ...query.filters } : {},
        query,
      });
      return true;
    } catch (err) {
      reportRuntimeWarning('widget action failed', err, { actionId, widgetId });
      return false;
    }
  }

  renderWidgetActions() {
    const actions = this.getOfferedWidgetActions();
    if (!actions.length) return nothing;
    return html`
      <div class="da-widget-actions">
        ${actions.map((action) => html`
          <button
            type="button"
            class="da-widget-action-btn"
            data-action-id="${action.id}"
            title="${action.label}"
            aria-label="${action.label}"
            @click=${(e) => this.triggerWidgetAction(action.id, e)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="${action.icon}"></path>
            </svg>
          </button>
        `)}
      </div>
    `;
  }

  _hostApp() {
    if (this._cachedHostApp && this._cachedHostApp.isConnected) {
      return this._cachedHostApp;
    }
    let cur = this.parentElement;
    while (cur) {
      if ((typeof DataApp !== 'undefined' && cur instanceof DataApp) ||
          cur.tagName?.toLowerCase() === 'data-app' ||
          typeof cur.getEffectiveFilters === 'function') {
        this._cachedHostApp = cur;
        return cur;
      }
      cur = cur.parentElement;
    }
    this._cachedHostApp = null;
    return null;
  }

  _queryInputsChanged(changedProps) {
    for (const key of changedProps.keys()) {
      if (QUERY_INPUT_PROPS.has(key)) return true;
    }
    return false;
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    _watchTheme(this);
    if (this.loading) {
      this.classList.add('loading');
    }
    // A layout re-apply can move this node — a cross-row placement, an
    // edit-mode reorder, or the coordinate-grid flatten (any mode) — which
    // disconnects then reconnects the element and aborts an in-flight query
    // (see disconnectedCallback -> _abort). The initial fetch is issued once
    // from firstUpdated() and never again, so re-issue it on a reconnect. Do
    // NOT gate on `!loading`: an aborted fetch leaves `loading` stuck true (its
    // AbortError path returns without clearing it), so gating would strand
    // exactly the widget we mean to recover. fetchData() re-issues a fetch whose
    // dedupe key disconnectedCallback cleared, and dedupes to a no-op for a
    // widget that was already loaded (key kept). The very first connect
    // (hasUpdated === false) is left to firstUpdated().
    if (this.hasUpdated) {
      Promise.resolve().then(() => {
        if (this.isConnected) this.fetchData();
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    _unwatchTheme(this);
    // Capture BEFORE _abort() nulls it. An in-flight fetch aborted here has its
    // dedupe key (`_lastFetchedQuery`) cleared only by the fetch's async catch,
    // which runs AFTER connectedCallback's reconnect refetch has already deduped
    // against the abandoned query — leaving the widget stuck at loading:true.
    // Clear it synchronously so the reconnect actually re-issues. A widget that
    // already finished has no controller (nulled on completion), so its key is
    // kept and a reconnect refetch dedupes to a harmless no-op.
    const inFlight = !!this._abortController;
    this._abort();
    if (inFlight) this._lastFetchedQuery = null;
    this.classList.remove('loading');
  }

  /** Called when the surrounding theme flips. Widgets that paint their own
   *  pixels override this; the KPI needs nothing, since it is styled entirely
   *  by CSS variables that re-cascade on their own. */
  onThemeChange() {}

  /**
   * Whether this widget has drawn its current state (data, error, or empty) and
   * has nothing in flight. Read by the render-complete signal (`isRenderSettled`).
   * Widgets that draw outside Lit's `render()` override `_isDrawSettled()`.
   *
   * @return {boolean}
   */
  isRenderSettled() {
    if (!this.hasUpdated || this.isUpdatePending) return false;
    if (this._awaitingFilterGate || this.loading || this._vendorRetryPending) return false;
    return this._isDrawSettled();
  }

  /** Whatever this widget draws outside Lit's `render()` is on the page. */
  _isDrawSettled() {
    return true;
  }

  _abort() {
    if (this._abortController) {
      try { this._abortController.abort(); } catch {}
      this._abortController = null;
    }
  }

  refresh() {
    this._forceRefresh = true;
    this._lastFetchedQuery = null;
    return this.fetchData();
  }

  async fetchData() {
    if (typeof this._skipFetch === 'function' && this._skipFetch()) {
      this.loading = false;
      this.classList.remove('loading');
      if (this._forceRefresh || this._hasRenderError) {
        this._forceRefresh = false;
        if (Array.isArray(this.data) && this.data.length > 0) {
          if (typeof this._renderHighchart === 'function') {
            this._renderHighchart(this.data);
          } else if (typeof this._renderGrid === 'function') {
            this._renderGrid(this.data);
          }
        }
      }
      return;
    }

    let query = this._buildQuery();
    if (!query) {
      this.loading = false;
      this.classList.remove('loading');
      return;
    }

    // A chart must not be filtered by the click it just emitted.
    if (query.filters) {
      query.filters = dropSelfCrossFilters(query.filters, this);
    }
    query = normalizeQueryPayload(query);

    // Skip the round-trip when the effective query is unchanged. This is what
    // makes `filters: this.getEffectiveFilters()` — a fresh object on every
    // render — harmless, and it is why a *hardcoded* filter object never
    // refetches (see SKILL.md, gotcha 1).
    if (this._lastFetchedQuery && areQueriesEqual(this._lastFetchedQuery, query) && !this._forceRefresh) {
      const displayRows = this.data || this._fetchedRows;
      if (!this.loading && displayRows && displayRows.length > 0) {
        if (typeof this._renderHighchart === 'function') {
          this._renderHighchart(displayRows);
        } else if (typeof this._renderGrid === 'function' && !this.gridApi) {
          this._renderGrid(displayRows);
        }
      }
      return;
    }

    const fetchId = (this._activeFetchId = (this._activeFetchId || 0) + 1);
    this._abort();
    const controller = new AbortController();
    this._abortController = controller;
    this._lastFetchedQuery = JSON.parse(JSON.stringify(query));
    this._forceRefresh = false;

    this.loading = true;
    this.error = null;
    this._hasRenderError = false;
    this.classList.add('loading');
    this.classList.remove('empty', 'error');
    this._usingSample = false;
    this.requestUpdate();

    try {
      if (window.DataApps && window.DataApps._extensionInitPromise) {
        await window.DataApps._extensionInitPromise;
      }
      if (typeof window.DataApps?.queryRunner !== 'function') {
        throw new Error('Data App: queryRunner is not available.');
      }
      const rows = await window.DataApps.queryRunner(query, controller.signal);
      if (this._activeFetchId !== fetchId) return;
      if (controller.signal.aborted) {
        this.loading = false;
        this.classList.remove('loading');
        return;
      }
      if (this._ignoreWhenDataSet && this.data && this.data.length > 0) {
        this.loading = false;
        this.classList.remove('loading');
        return;
      }
      this._abortController = null;
      this.loading = false;
      this.classList.remove('loading');
      this.error = null;
      this._hasRenderError = false;
      this._receiveRows(rows);
      this.requestUpdate();
    } catch (err) {
      if (this._activeFetchId !== fetchId) return;
      if (this._activeFetchId === fetchId && (controller.signal.aborted || err?.name === 'AbortError')) {
        this._lastFetchedQuery = null;
        this.loading = false;
        this.classList.remove('loading');
        return;
      }
      this._abortController = null;
      this._lastFetchedQuery = null;
      this.loading = false;
      this.classList.remove('loading');
      this.error = err;
      this._hasRenderError = false;
      const tag = this.tagName ? this.tagName.toLowerCase() : 'widget';
      const label = this.title || this.label || this.queryField || (query && query.fields && query.fields.join(', ')) || '';
      reportRuntimeError(`<${tag}> "${label}" query failed`, err, { tag, label, query });
      this.requestUpdate();
    }
  }

  /** Normalizes `fields` / `dimensions` / `measures` from either the `.query`
   *  object or the comma-separated attribute form into one deduped array. */
  _resolveFields(q, ...keys) {
    const out = [];
    for (const key of keys) {
      const raw = q[key] ?? this[key];
      if (!raw) continue;
      const list = Array.isArray(raw) ? raw : String(raw).split(',');
      for (const f of list) {
        const t = String(f).trim();
        if (t) out.push(t);
      }
    }
    return Array.from(new Set(out));
  }

  /** Resolves model + explore, falling back up the DOM to a parent container. */
  _resolveTarget(q) {
    return {
      model: q.model || this.lookerModel || resolveParentModel(this) || 'basic_ecomm',
      view: q.explore || q.view || this.explore || resolveParentExplore(this),
    };
  }

  /**
   * Coordinates vendor availability during async tile bootstrap.
   * If vendor assets are still downloading, registers a single retry callback and returns true.
   * If the init promise settled and the vendor is still missing, reports a runtime error and returns true.
   *
   * @param {string} vendorName - Display name (e.g. 'Highcharts', 'AG Grid').
   * @param {() => void} retryFn - Callback invoked when the init promise resolves.
   * @param {Object} [errorContext] - Metadata for telemetry reporting.
   * @return {boolean} True if rendering should be deferred or aborted due to missing vendor.
   */
  _handleVendorUnavailable(vendorName, retryFn, errorContext) {
    const initPromise = window.DataApps?._extensionInitPromise;
    if (initPromise && typeof initPromise.then === 'function') {
      _trackInitPromise(initPromise);
      if (_isInitPromisePending(initPromise)) {
        if (!this._vendorRetried) {
          this._vendorRetried = true;
          this._vendorRetryPending = true;
          const onRetry = () => {
            this._vendorRetryPending = false;
            if (this.isConnected === false) {
              this._vendorRetried = false;
              return;
            }
            retryFn();
          };
          Promise.resolve(initPromise).then(onRetry, onRetry);
        }
        return true;
      }
    }
    if (this._vendorRetryPending) {
      return true;
    }
    const err = new Error(`${vendorName} vendor bundle is not available`);
    this.error = err;
    this._hasRenderError = true;
    const tag = errorContext?.tag || (this.tagName ? this.tagName.toLowerCase() : 'app-widget');
    reportRuntimeError(`<${tag}> ${vendorName} render failed`, err, errorContext);
    this.requestUpdate();
    return true;
  }
}

export class AppKPI extends AppWidget {
  static properties = {
    /** LookML model name (inherited from parent container if omitted). */
    lookerModel: { type: String, attribute: 'looker-model', reflect: true },
    /** LookML explore view name (e.g. `'orders'`). */
    explore: { type: String, reflect: true },
    /** Single LookML measure field name to query (e.g. `'orders.total_revenue'`). */
    queryField: { type: String, attribute: 'query-field' },
    /** Comma-separated list of field names. */
    fields: { type: String },
    /** Full Looker query definition object. */
    query: { type: Object },
    /** Dynamic filter dictionary passed to Looker query runner. */
    filters: { type: Object },
    /** Card label title. */
    label: { type: String },
    /** Explicit override headline value (bypasses query fetch unless sparkline is enabled with a 2-field query). */
    value: { type: String },
    /** Delta / period-over-period change string (e.g. `'+14.2%'`). */
    change: { type: String },
    /** Change type for delta badge tone: `'positive'` | `'negative'` | `'neutral'`. */
    changeType: { type: String, attribute: 'change-type' },
    /** Value format: one of `FORMATTERS` (see LIT_DATA_APPS.md). */
    format: { type: String },
    /** Optional secondary text rendered inline in parentheses next to the label. */
    subtitle: { type: String },
    /** Emoji or SVG icon displayed in KPI top-right. */
    icon: { type: String },
    /** Optional mini sparkline chart rendered in the KPI card. */
    sparkline: {
      converter: (v) => {
        if (v === '' || v === 'true') return true;
        if (v === 'false' || v === null) return false;
        try {
          const parsed = JSON.parse(v);
          return Array.isArray(parsed) ? parsed : true;
        } catch {
          return true;
        }
      },
    },
    /** Aggregation mode for sparkline headline number: 'last' | 'sum' | 'avg' (defaults to 'last'). */
    sparklineAgg: { type: String, attribute: 'sparkline-agg' },
    /** Optional custom color for sparkline stroke and fill (defaults to var(--app-chart-1, #4285f4)). */
    color: { type: String },
    /** Metric polarity for delta badge tone: 'higher-better' | 'lower-better' (defaults to 'higher-better'). */
    polarity: { type: String },
    /** Drop the built-in card chrome (background, border, radius, shadow, padding). */
    bare: { type: Boolean, reflect: true },
    /** In-flight fetch loading indicator. */
    loading: { type: Boolean },
    /** Query error state. */
    error: { type: Object },
    _sparklinePoints: { state: true },
    _sparklineLabels: { state: true },
    _hoverIndex: { state: true },
    _computedChange: { state: true },
    _computedChangeType: { state: true },
  };

  constructor() {
    super();
    this.loading = false;
    this.error = null;
    this.filters = {};
    this.bare = false;
    this.sparkline = false;
    this.sparklineAgg = 'last';
    this.color = null;
    this.polarity = 'higher-better';
    this._sparklinePoints = null;
    this._sparklineLabels = null;
    this._hoverIndex = null;
    this._computedChange = null;
    this._computedChangeType = null;
    this._abortController = null;
    this._sparklineValues = null;
  }

  _isSparklineEnabled() {
    return this.sparkline === true || Array.isArray(this.sparkline);
  }

  _hasSparklineQuery() {
    if (!this._isSparklineEnabled()) return false;
    const q = this.query || {};
    const fields = this._resolveFields(q, 'fields', 'dimensions', 'measures');
    return fields.length > 1;
  }

  // Static headline value with no sparkline query; skips automatic fetches.
  _hasStaticValue() {
    return this.value != null && this.value !== '' && !this._hasSparklineQuery();
  }

  _isDrawSettled() {
    if (this.error || this._hasStaticValue()) return true;
    const q = this._buildQuery();
    if (!q || !q.view) return true;
    return this._fetchedValue !== undefined;
  }

  async firstUpdated() {
    this._awaitingFilterGate = true;
    try {
      await whenDashboardFiltersReady();
    } finally {
      this._awaitingFilterGate = false;
    }
    if (!this._hasStaticValue()) {
      if (this.explore || this.query?.explore || this.query?.view || this.queryField || this.query?.fields || this.query?.measures || this.query?.dimensions || resolveParentExplore(this)) {
        this.fetchData();
      }
    }
  }

  updated(changedProps) {
    const canFetch = !this._hasStaticValue();
    if (changedProps.has('value') && !canFetch) return;

    let needsFetch = false;
    if (this._queryInputsChanged(changedProps)) {
      needsFetch = true;
    }
    if (changedProps.has('sparkline')) {
      needsFetch = true;
    }
    if (changedProps.has('polarity') && this._sparklinePoints) {
      const delta = this._computeSparklineDelta(this._sparklinePoints);
      this._computedChange = delta.change;
      this._computedChangeType = delta.changeType;
    }
    if (changedProps.has('filters')) {
      const prev = changedProps.get('filters');
      if (!areQueriesEqual(prev, this.filters)) needsFetch = true;
    }
    if (changedProps.has('query')) {
      const prev = changedProps.get('query');
      if (!areQueriesEqual(prev, this.query)) needsFetch = true;
    }

    if (needsFetch && canFetch) {
      if (this._awaitingFilterGate) return;
      if (this.explore || this.query?.explore || this.query?.view || this.queryField || this.query?.fields || this.query?.measures || this.query?.dimensions || resolveParentExplore(this)) {
        this.fetchData();
      }
    }
  }

  _computeSparklineHeadline(points, fallbackLastVal) {
    const mode = (this.sparklineAgg || 'last').toLowerCase();
    const finite = Array.isArray(points) ? points.filter(n => typeof n === 'number' && Number.isFinite(n)) : [];
    if (mode === 'sum' && finite.length > 0) {
      return finite.reduce((acc, n) => acc + n, 0);
    }
    if (mode === 'avg' && finite.length > 0) {
      return finite.reduce((acc, n) => acc + n, 0) / finite.length;
    }
    if (mode === 'min' && finite.length > 0) {
      return Math.min(...finite);
    }
    if (mode === 'max' && finite.length > 0) {
      return Math.max(...finite);
    }
    return fallbackLastVal !== undefined ? fallbackLastVal : (finite.length > 0 ? finite[finite.length - 1] : null);
  }

  _computeSparklineDelta(pts) {
    if (pts && pts.length >= 2) {
      const prev = pts[pts.length - 2];
      const curr = pts[pts.length - 1];
      if (prev !== 0 && Number.isFinite(prev) && Number.isFinite(curr)) {
        const diff = curr - prev;
        const pct = (diff / Math.abs(prev)) * 100;
        const sign = pct > 0 ? '+' : '';
        const isLowerBetter = this.polarity === 'lower-better';
        const posTone = isLowerBetter ? 'negative' : 'positive';
        const negTone = isLowerBetter ? 'positive' : 'negative';
        return {
          change: `${sign}${pct.toFixed(1)}%`,
          changeType: pct > 0 ? posTone : (pct < 0 ? negTone : 'neutral'),
        };
      }
    }
    return { change: null, changeType: null };
  }

  // A KPI is one measure, one row (or dimension + measure when sparkline is enabled).
  _buildQuery() {
    const q = this.query || {};
    const fields = this._resolveFields(q, 'fields', 'dimensions', 'measures');
    if (this.queryField && !fields.includes(this.queryField)) {
      fields.push(this.queryField);
    }
    if (fields.length === 0) return null;

    if (this._isSparklineEnabled() && fields.length > 1) {
      this._dimField = fields[0];
      this._valueField = fields[fields.length - 1];
      const sorts = q.sorts || [`${this._dimField} ${WIDGET_QUERY_DEFAULTS.kpiSparklineSortDir}`];
      const limit = q.limit || WIDGET_QUERY_DEFAULTS.kpiSparklineLimit;
      return {
        ...this._resolveTarget(q),
        fields,
        filters: q.filters || this.filters || {},
        sorts,
        limit,
      };
    }

    const field = this.queryField || fields[0];
    this._valueField = field;
    this._dimField = null;
    return {
      ...this._resolveTarget(q),
      fields: [field],
      filters: q.filters || this.filters || {},
      limit: WIDGET_QUERY_DEFAULTS.kpiLimit,
    };
  }

  _parseDateDimValue(val) {
    if (val == null || val === '') return null;
    const s = String(val).trim();
    const iso = /^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)?$/.exec(s);
    if (iso) {
      return Date.UTC(
        Number(iso[1]),
        Number(iso[2]) - 1,
        iso[3] ? Number(iso[3]) : 1,
        iso[4] ? Number(iso[4]) : 0,
        iso[5] ? Number(iso[5]) : 0,
        iso[6] ? Number(iso[6]) : 0
      );
    }
    const qw = /^(\d{4})[-/\s]?(?:Q([1-4])|W(\d{1,2}))$/i.exec(s);
    if (qw) {
      return qw[2]
        ? Date.UTC(Number(qw[1]), (Number(qw[2]) - 1) * 3, 1)
        : Number(qw[1]) * 100 + Number(qw[3]);
    }
    if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,-]+\d{1,4}(?:[\s,-]+\d{2,4})?$/i.test(s)) {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : null;
    }
    return null;
  }

  _receiveRows(rows) {
    if (!rows || rows.length === 0) {
      this._fetchedValue = null;
      this._sparklinePoints = null;
      this._sparklineLabels = null;
      this._sparklineValues = null;
      this._hoverIndex = null;
      this._computedChange = null;
      this._computedChangeType = null;
      return;
    }

    if (!this._valueField) {
      this._buildQuery();
    }

    if (!this._isSparklineEnabled() || rows.length === 1) {
      this._fetchedValue = rows[0][this._valueField];
      this._sparklinePoints = null;
      this._sparklineLabels = null;
      this._sparklineValues = null;
      this._hoverIndex = null;
      this._computedChange = null;
      this._computedChangeType = null;
      return;
    }

    let orderedRows = rows;
    if (this._dimField && rows.length >= 2) {
      const nonEmptyDims = rows
        .map((r) => r[this._dimField])
        .filter((v) => v !== null && v !== undefined && v !== '');
      const allNumeric = nonEmptyDims.length > 0 && nonEmptyDims.every((v) =>
        typeof v === 'number' ? Number.isFinite(v) : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
      );
      const allDates = !allNumeric && nonEmptyDims.length > 0 && nonEmptyDims.every((v) => this._parseDateDimValue(v) !== null);

      if (allNumeric) {
        orderedRows = [...rows].sort((a, b) => Number(a[this._dimField]) - Number(b[this._dimField]));
      } else if (allDates) {
        orderedRows = [...rows].sort((a, b) => (this._parseDateDimValue(a[this._dimField]) ?? 0) - (this._parseDateDimValue(b[this._dimField]) ?? 0));
      } else {
        const effectiveSorts = this.query?.sorts || [`${this._dimField} desc`];
        const dimPrefix = `${this._dimField.toLowerCase()} desc`;
        const isDescSort = effectiveSorts.some((s) =>
          String(s).trim().toLowerCase().startsWith(dimPrefix)
        );
        if (isDescSort) {
          orderedRows = [...rows].reverse();
        }
      }
    }

    let effectiveRows = orderedRows;
    while (effectiveRows.length > 0) {
      const newestVal = effectiveRows[effectiveRows.length - 1]?.[this._valueField];
      if (newestVal === null || newestVal === undefined || newestVal === '') {
        effectiveRows = effectiveRows.slice(0, -1);
      } else {
        break;
      }
    }

    const lastRow = effectiveRows[effectiveRows.length - 1];
    this._fetchedValue = lastRow ? lastRow[this._valueField] : null;

    const points = [];
    const labels = [];
    for (const r of effectiveRows) {
      const raw = r[this._valueField];
      if (raw === null || raw === undefined || raw === '') continue;
      const v = Number(raw);
      if (Number.isFinite(v)) {
        points.push(v);
        labels.push(this._dimField && r[this._dimField] != null ? String(r[this._dimField]) : null);
      }
    }
    if (points.length === 0) {
      this._sparklineValues = null;
    } else {
      this._sparklineValues = points;
      this._fetchedValue = points[points.length - 1];
    }
    this._sparklinePoints = points.length >= 3 ? points : null;
    this._sparklineLabels = points.length >= 3 ? labels : null;
    this._hoverIndex = null;

    const delta = this._computeSparklineDelta(points);
    this._computedChange = delta.change;
    this._computedChangeType = delta.changeType;
  }

  _resolveHeadlineValue(pts) {
    if (this.value != null && this.value !== '') return this.value;
    if (Array.isArray(this.sparkline)) {
      return this.sparkline.length > 0
        ? this._computeSparklineHeadline(pts || this.sparkline.map(Number), this.sparkline[this.sparkline.length - 1])
        : null;
    }
    if (this._isSparklineEnabled() && this._sparklineValues) {
      return this._computeSparklineHeadline(this._sparklineValues, this._fetchedValue);
    }
    return this._fetchedValue ?? null;
  }

  _getSparklinePoints() {
    if (Array.isArray(this.sparkline)) {
      const pts = this.sparkline.map(Number).filter(Number.isFinite);
      return pts.length >= 3 ? pts : null;
    }
    if (this._sparklinePoints && this._sparklinePoints.length >= 3) {
      return this._sparklinePoints;
    }
    return null;
  }

  _onSparklineMove(e) {
    const pts = this._getSparklinePoints();
    if (!pts || pts.length < 3) return;
    const rect = e.currentTarget?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) return;
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(relX * (pts.length - 1));
    if (this._hoverIndex !== idx) {
      this._hoverIndex = idx;
    }
  }

  _onSparklineLeave() {
    if (this._hoverIndex !== null) {
      this._hoverIndex = null;
    }
  }

  _renderSparkline(pts) {
    if (!pts || pts.length < 3) return nothing;
    const w = 100;
    const h = 24;
    const padTop = 2;
    const padBottom = 2;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min;
    const n = pts.length;

    const coords = pts.map((val, i) => {
      const x = Number(((i / (n - 1)) * w).toFixed(2));
      let y;
      if (range === 0) {
        y = Number((h / 2).toFixed(2));
      } else {
        const norm = (val - min) / range;
        y = Number(((h - padBottom) - norm * (h - padTop - padBottom)).toFixed(2));
      }
      return [x, y];
    });

    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c[0]} ${c[1]}`).join(' ');
    const firstX = coords[0][0];
    const lastX = coords[coords.length - 1][0];
    const areaPath = `${linePath} L ${lastX} ${h} L ${firstX} ${h} Z`;

    const color = this.color || 'var(--app-chart-1, #4285f4)';
    if (!this._gradientId) {
      this._gradientId = 'kpi-grad-' + Math.random().toString(36).slice(2, 9);
    }
    const gradId = this._gradientId;

    const hoverIdx = (this._hoverIndex != null && this._hoverIndex >= 0 && this._hoverIndex < pts.length) ? this._hoverIndex : null;
    let hoverCrosshair = nothing;
    let hoverOverlay = nothing;
    if (hoverIdx != null) {
      const [hoverX, hoverY] = coords[hoverIdx];
      const hoverTopPct = Number(((hoverY / h) * 100).toFixed(2));
      const rawPointVal = pts[hoverIdx];
      const formattedPointVal = this.format
        ? formatValue(rawPointVal, this.format)
        : (Number.isInteger(rawPointVal) ? rawPointVal.toLocaleString('en-US') : rawPointVal.toLocaleString('en-US', { maximumFractionDigits: 2 }));
      const dimLabel = (!Array.isArray(this.sparkline) && this._sparklineLabels && this._sparklineLabels[hoverIdx]) ? this._sparklineLabels[hoverIdx] : null;
      hoverCrosshair = svg`<line class="kpi-sparkline-crosshair" x1="${hoverX}" y1="0" x2="${hoverX}" y2="${h}" stroke="${color}" stroke-opacity="0.35" stroke-width="1" vector-effect="non-scaling-stroke"></line>`;
      hoverOverlay = html`
        <span class="kpi-sparkline-dot" style="left: ${hoverX}%; top: ${hoverTopPct}%; background: ${color};"></span>
        <div class="kpi-sparkline-tooltip" style="left: ${hoverX}%; transform: translateX(-${hoverX}%);">
          ${dimLabel ? html`<div class="kpi-sparkline-tooltip-title">${dimLabel}</div>` : nothing}
          <div class="kpi-sparkline-tooltip-row">
            <span class="kpi-sparkline-tooltip-swatch" style="background: ${color};"></span>
            <span>${this.label ? `${this.label}: ` : ''}<strong>${formattedPointVal}</strong></span>
          </div>
        </div>
      `;
    }

    return html`
      <div class="kpi-sparkline ${this.loading ? 'loading' : ''}" @mousemove=${this._onSparklineMove} @mouseleave=${this._onSparklineLeave}>
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${color}" stop-opacity="0.3"></stop>
              <stop offset="100%" stop-color="${color}" stop-opacity="0.0"></stop>
            </linearGradient>
          </defs>
          <path class="kpi-sparkline-area" d="${areaPath}" fill="url(#${gradId})"></path>
          <path class="kpi-sparkline-line" d="${linePath}" stroke="${color}" style="stroke: ${color};" vector-effect="non-scaling-stroke"></path>
          ${hoverCrosshair}
        </svg>
        ${hoverOverlay}
      </div>
    `;
  }

  render() {
    if (this.error) {
      const errMsg = describeError(this.error).message;
      return html`
        <div class="da-kpi-wrap error" title="${errMsg}">
          ${this.renderWidgetActions()}
          <div class="kpi-body">
            <div class="kpi-label">${this.label || 'KPI Error'}</div>
            <div class="kpi-value error">
              ${errMsg.length > 28 ? errMsg.slice(0, 25) + '…' : errMsg}
            </div>
          </div>
        </div>
      `;
    }

    const pts = this._getSparklinePoints();
    let computedChange = this._computedChange;
    let computedChangeType = this._computedChangeType;

    if (!this.change && !computedChange) {
      const delta = this._computeSparklineDelta(pts);
      computedChange = delta.change;
      computedChangeType = delta.changeType;
    }

    const effectiveChange = this.change || computedChange;
    const isLowerBetter = this.polarity === 'lower-better';
    const inferredTone = effectiveChange && effectiveChange.startsWith('+')
      ? (isLowerBetter ? 'negative' : 'positive')
      : (effectiveChange && effectiveChange.startsWith('-')
          ? (isLowerBetter ? 'positive' : 'negative')
          : null);
    const effectiveChangeType = this.changeType || (this.change ? inferredTone : (computedChangeType || inferredTone));
    const changeClass = effectiveChangeType ? `kpi-change ${effectiveChangeType}` : 'kpi-change';

    const rawVal = this._resolveHeadlineValue(pts);
    const hasValue = rawVal != null && rawVal !== '';
    const formattedValue = hasValue
      ? (this.format
          ? formatValue(rawVal, this.format)
          : (typeof rawVal === 'number' && Number.isFinite(rawVal) && !Number.isInteger(rawVal) ? Number(rawVal.toFixed(2)) : rawVal))
      : null;

    const subText = this.subtitle ? String(this.subtitle).trim() : '';

    return html`
      <div class="da-kpi-wrap ${this.loading ? 'loading' : ''}">
        ${this.renderWidgetActions()}
        ${this.icon ? html`<div class="kpi-icon">${this.icon}</div>` : nothing}
        <div class="kpi-body">
          <div class="kpi-label" title=${this.label || ''}>
            ${this.label}${this.loading && hasValue ? html`<span class="da-kpi-spinner" title="Refreshing metric..."></span>` : nothing}
          </div>
          <div class="kpi-value ${this.loading && hasValue ? 'loading' : ''}">
            ${this.loading && !hasValue
              ? html`<span class="da-kpi-spinner large" title="Loading metric..."></span>`
              : html`<span class="kpi-value-text" title=${formattedValue ?? ''}
                     >${formattedValue ?? '—'}</span>`}
            ${effectiveChange ? html`<span class="${changeClass}">${effectiveChange}</span>` : nothing}
          </div>
          ${subText ? html`<div class="kpi-subtitle" title=${subText}>${subText}</div>` : nothing}
          ${this._renderSparkline(pts)}
        </div>
      </div>
    `;
  }
}
if (!customElements.get('app-kpi')) {
  customElements.define('app-kpi', AppKPI);
}

const _yScaleGroups = new Map();

/**
 * <app-chart> — Reactive Highcharts visualizer.
 * 
 * Self-contained card with title header, animated loading skeleton, error banner,
 * automatic 2-dimension pivoting, in-place `.setData()` updates, and `@app-chart-click` cross-filtering.
 * 
 * @fires app-chart-click - Fired when a user clicks a bar, column, slice, or point. Detail: `{ field, value, y, mouseEvent, chartComponent }`.
 * 
 * @example
 * ```html
 * <app-chart
 *   title="Revenue by Category"
 *   type="column"
 *   explore="orders"
 *   value-format="usd"
 *   .query=${{
 *     fields: ['orders.category', 'orders.total_revenue'],
 *     filters: this.getEffectiveFilters(),
 *     sorts: ['orders.total_revenue desc'],
 *     limit: '20'
 *   }}
 *   @app-chart-click=${(e) => this.selectedCategory = e.detail.value}
 * ></app-chart>
 * ```
 */
function colorWithAlpha(colorStr, alpha) {
  const s = String(colorStr || '').trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
  }
  const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }
  return s;
}

function buildAreaGradient(colorStr, topAlpha = 0.3, bottomAlpha = 0.1) {
  return {
    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    stops: [
      [0, colorWithAlpha(colorStr, topAlpha)],
      [1, colorWithAlpha(colorStr, bottomAlpha)],
    ],
  };
}

const FUNNEL_SEQUENTIAL_LIGHT = ['#4285f4', '#689df6', '#8eb6f8', '#b3cefb', '#d9e7fd'];
const FUNNEL_SEQUENTIAL_DARK = ['#4285f4', '#386fd0', '#2e59ac', '#244389', '#1a2d65'];
const UNSELECTED_GRAY_LIGHT = '#dadce0';
const UNSELECTED_GRAY_DARK = '#374151';

export class AppChart extends AppWidget {
  static properties = {
    /** Chart visualization type: one of `CHART_TYPES` (see LIT_DATA_APPS.md). */
    type: { type: String, reflect: true },
    /** Header title string. */
    title: { type: String },
    /** Explicit chart height (e.g. `'320px'`). Defaults to responsive flex fill (`100%`). */
    height: { type: String, reflect: true },
    /** Shared Y-axis scale synchronization group identifier across multiple charts. */
    yScaleGroup: { type: String, attribute: 'y-scale-group', reflect: true },
    /** LookML model name (inherited from parent container if omitted). */
    lookerModel: { type: String, attribute: 'looker-model', reflect: true },
    /** LookML explore name (e.g. `'orders'`). */
    explore: { type: String, reflect: true },
    /** Looker query object `{ fields: [...], filters: {...}, sorts: [...], limit: '500' }`. */
    query: { type: Object },
    /** Comma-separated list of field names. */
    fields: { type: String },
    /** Comma-separated list of dimension field names. */
    dimensions: { type: String },
    /** Comma-separated list of measure field names. */
    measures: { type: String },
    /** Pivot field names for 2-dimension multi-series pivoting. */
    pivots: { type: Array },
    /** Pivot dimension field name for 2-dimension multi-series pivoting. */
    pivotBy: { type: String, attribute: 'pivot-by' },
    /** Map of filter expressions (supports substrings `%...%`, measure bounds `<0.60`, dates). */
    filters: { type: Object },
    /** Declarative cross-filter attribute: bare/empty string uses dimField; explicit string sets filter field. */
    crossFilter: { type: String, attribute: 'cross-filter' },
    /** Sort directives (e.g. `['orders.created_date asc']`). */
    sorts: { type: Array },
    /** Row limit (default `'500'`). */
    limit: { type: String },
    /** Value format for axes and tooltips: one of `FORMATTERS` (see LIT_DATA_APPS.md). */
    valueFormat: { type: String, attribute: 'value-format' },
    /** Primary series hex color code (e.g. `'#6366f1'`). */
    color: { type: String },
    /** Metric polarity for color tones: `'higher-better'` | `'lower-better'`. */
    polarity: { type: String },
    /** Map of category string values to specific hex colors `{ "Apparel": "#6366f1", "Home": "#0d9488" }`. */
    categoryColors: { type: Object },
    /** Currently selected category string (highlights matching bar/slice, dims others). */
    selectedValue: { type: String, attribute: 'selected-value' },
    /** Selected item descriptor object. */
    selected: { type: Object },
    /** Highcharts options deep override object merged into generated configuration. */
    options: { type: Object },
    /** Pre-computed array of data rows to render directly (bypasses Looker network query). */
    data: { type: Array },
    /** Sample preview rows displayed before first live query completes. */
    sampleData: { type: Array },
    /** Drop the built-in card chrome (background, border, radius, shadow, padding). */
    bare: { type: Boolean, reflect: true },
    /** Force a palette: `'dark'` | `'light'`. Omit to follow the surrounding
     *  `.dark-theme` class, which is the usual case. */
    theme: { type: String },
    /** In-flight fetch loading indicator. */
    loading: { type: Boolean },
    /** Query error state. */
    error: { type: Object },
  };

  constructor() {
    super();
    this.type = 'column';
    this.polarity = 'higher-better';
    this.categoryColors = null;
    this.selectedValue = null;
    this.selected = null;
    this.loading = false;
    this.error = null;
    this.filters = {};
    this.bare = false;
    this._ignoreWhenDataSet = true;
    this.chartInstance = null;
    this.color = null;
    this.yScaleGroup = null;
    this._syncingYScale = false;
    this._abortController = null;
    this._reflowRafId = null;
    this._noPoints = false;
    this._trailingResizeTimer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.yScaleGroup) {
      let group = _yScaleGroups.get(this.yScaleGroup);
      if (!group) {
        group = new Set();
        _yScaleGroups.set(this.yScaleGroup, group);
      }
      group.add(this);
    }
    if (this._hasRenderedOnce && !this.chartInstance && (this.data?.length > 0 || this._fetchedRows?.length > 0)) {
      this._container = this.querySelector('.chart-container');
      this._setupResizeObserver();
      this._renderHighchart(this.data || this._fetchedRows);
    }
  }

  _setupResizeObserver() {
    if (!this._container || typeof ResizeObserver === 'undefined' || this._resizeObserver) return;
    let lastWidth = 0;
    let lastHeight = 0;
    let prevWidth = 0;
    let prevHeight = 0;
    let targetWidth = 0;
    let targetHeight = 0;
    let hasAppliedFirst = false;
    let checkedFirstHeight = false;
    let resizeTimestamps = [];
    let tripCount = 0;
    let retries = 0;

    const checkFirstFloor = (h) => {
      if (checkedFirstHeight || this.height) return;
      checkedFirstHeight = true;
      if (h < 4) {
        let customMin = 0;
        try {
          customMin = parseFloat(getComputedStyle(this).getPropertyValue('--app-chart-min-height')) || 0;
        } catch {}
        if (customMin <= 0) {
          if (this._container) {
            this._container.style.minHeight = '300px';
          }
        }
      }
    };

    // Check initial layout before Highcharts mounts and falls back to 400px
    const initialH = this._container ? this._container.getBoundingClientRect().height : 0;
    checkFirstFloor(initialH);

    const applySize = () => {
      if (this._reflowRafId) cancelAnimationFrame(this._reflowRafId);
      this._reflowRafId = requestAnimationFrame(() => {
        this._reflowRafId = null;
        if (this.chartInstance && this._container && this._container.offsetWidth > 0) {
          try {
            prevWidth = lastWidth;
            prevHeight = lastHeight;
            lastWidth = targetWidth;
            lastHeight = targetHeight;
            hasAppliedFirst = true;
            // Use explicit setSize instead of reflow() because Highcharts getChartSize()
            // falls back to 400px when the container parent lacks an inline height.
            this.chartInstance.setSize(targetWidth, targetHeight, false);
          } catch {}
        } else if (!hasAppliedFirst && this.isConnected && targetWidth > 0 && targetHeight > 0 && retries++ < 30) {
          // If chartInstance is not yet created when the frame fires,
          // retry next frame until the initial chart is mounted.
          applySize();
        }
      });
    };

    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width);
        const height = Math.round(entry.contentRect.height);

        // At first measurement on an unsized chart, if container height is effectively zero
        // (< 4px), apply a 300px default to .chart-container unless overridden by the author.
        checkFirstFloor(height);

        // Ignore 0-sized measurements
        if (width <= 0 || height <= 0) continue;

        // Ensure the first real measurement always applies; subsequent evaluations require significant change (>3px)
        const isFirst = !hasAppliedFirst;
        if (isFirst || Math.abs(width - lastWidth) > 3 || Math.abs(height - lastHeight) > 3) {
          targetWidth = width;
          targetHeight = height;

          const now = Date.now();
          const prevLen = resizeTimestamps.length;
          resizeTimestamps = resizeTimestamps.filter(t => now - t < 1000);
          if (prevLen > 0 && resizeTimestamps.length === 0) {
            tripCount = 0;
          }
          resizeTimestamps.push(now);

          // Circuit breaker: throttle runaway feedback loops (>15 per second) without permanently breaking the chart
          if (resizeTimestamps.length > 15) {
            console.warn(`[AppChart] Circuit breaker: throttled rapid resize feedback loop.`);
            resizeTimestamps = [];
            const isTwoStepOscillation =
              prevWidth > 0 &&
              Math.abs(targetWidth - prevWidth) <= 3 &&
              Math.abs(targetHeight - prevHeight) <= 3;
            if (isTwoStepOscillation || tripCount >= 2) {
              if (this._trailingResizeTimer) {
                clearTimeout(this._trailingResizeTimer);
                this._trailingResizeTimer = null;
              }
              return;
            }
            if (this._trailingResizeTimer) {
              clearTimeout(this._trailingResizeTimer);
            }
            this._trailingResizeTimer = setTimeout(() => {
              this._trailingResizeTimer = null;
              tripCount++;
              applySize();
            }, 150);
            return;
          }

          // Coalesce rapid resize events (e.g. tab switches, window resizing) via requestAnimationFrame
          applySize();
        }
      }
    });
    this._resizeObserver.observe(this._container);
  }

  async firstUpdated() {
    this._hasRenderedOnce = true;
    this._container = this.querySelector('.chart-container');
    this._setupResizeObserver();
    if (this.data && this.data.length > 0) {
      this.loading = false;
      this.error = null;
      this._hasRenderError = false;
      this._renderHighchart(this.data);
      return;
    }
    this._awaitingFilterGate = true;
    try {
      await whenDashboardFiltersReady();
    } finally {
      this._awaitingFilterGate = false;
    }
    if (this.isConnected === false) return;
    if (this.data && this.data.length > 0) {
      this.loading = false;
      this.error = null;
      this._hasRenderError = false;
      this._renderHighchart(this.data);
    } else if (this.explore || this.query?.explore || this.query?.view || resolveParentExplore(this)) {
      this.fetchData();
    }
  }

  updated(changedProps) {
    if (changedProps.has('yScaleGroup')) {
      const oldGroup = changedProps.get('yScaleGroup');
      if (oldGroup && _yScaleGroups.has(oldGroup)) {
        const g = _yScaleGroups.get(oldGroup);
        g.delete(this);
        if (g.size === 0) {
          _yScaleGroups.delete(oldGroup);
        } else {
          this._syncYScaleGroup(oldGroup);
        }
      }
      if (this.yScaleGroup) {
        let g = _yScaleGroups.get(this.yScaleGroup);
        if (!g) {
          g = new Set();
          _yScaleGroups.set(this.yScaleGroup, g);
        }
        g.add(this);
        this._syncYScaleGroup();
      }
    }

    if (changedProps.has('data')) {
      const prevData = changedProps.get('data');
      const dataChanged = !areDataRowsEqual(prevData, this.data);
      if (Array.isArray(this.data)) {
        if (dataChanged) {
          this._activeFetchId = (this._activeFetchId || 0) + 1;
          this.loading = false;
          this.error = null;
          this._hasRenderError = false;
          this._renderHighchart(this.data);
        }
      } else if (this.data == null && (this.explore || this.query?.explore || this.query?.view || resolveParentExplore(this))) {
        if (this.chartInstance) {
          this.chartInstance.destroy();
          this.chartInstance = null;
        }
        this.fetchData();
      }
      return;
    }

    const displayRows = this.data || this._fetchedRows;
    let needsFetch = false;

    if (changedProps.has('type')) {
      if (displayRows && displayRows.length > 0) {
        this._renderHighchart(displayRows);
      } else {
        needsFetch = true;
      }
    }

    if (this._queryInputsChanged(changedProps)) {
      needsFetch = true;
    }
    if (changedProps.has('filters')) {
      const prev = changedProps.get('filters');
      if (!areQueriesEqual(prev, this.filters)) needsFetch = true;
    }
    if (changedProps.has('query')) {
      const prev = changedProps.get('query');
      if (!areQueriesEqual(prev, this.query)) needsFetch = true;
    }

    if (needsFetch) {
      if (!this._awaitingFilterGate) {
        if ((this.explore || this.query?.explore || this.query?.view || resolveParentExplore(this)) && (!this.data || this._forceLive) && !this._usingSample) {
          this.fetchData();
        } else if (displayRows && displayRows.length > 0) {
          this._renderHighchart(displayRows);
        }
      }
    } else if (changedProps.has('selectedValue') || changedProps.has('selected') || changedProps.has('categoryColors') || changedProps.has('color')) {
      if (displayRows && displayRows.length > 0) {
        this._renderHighchart(displayRows);
      }
    } else if (changedProps.has('options')) {
      const prevOptions = changedProps.get('options');
      if (!areQueriesEqual(prevOptions, this.options) && displayRows && displayRows.length > 0) {
        this._renderHighchart(displayRows);
      }
    }
  }

  // Author-supplied `.data` wins over the network unless a refresh forces live.
  _skipFetch() {
    return Boolean(this.data && this.data.length > 0 && !this._forceLive);
  }

  _isCrossFilterSurface() {
    const t = String(this.type || 'column').trim().toLowerCase();
    return CROSS_FILTER_CHART_TYPES.has(t);
  }

  // Highcharts draws synchronously, so rows to show and no chart yet means the
  // draw has not happened. `_noPoints` and an empty result draw the empty card.
  _isDrawSettled() {
    if (this.error) return true;
    const rows = this.data || this._fetchedRows;
    if (!Array.isArray(rows)) {
      if (this._skipFetch()) return true;
      const q = this._buildQuery();
      return !q || !q.view;
    }
    if (rows.length === 0) return true;
    return Boolean(this.chartInstance) || Boolean(this._noPoints);
  }

  _crossFilterField(dimField) {
    if (this.crossFilter == null || !this._isCrossFilterSurface()) return null;
    return (typeof this.crossFilter === 'string' && this.crossFilter.trim()) ? this.crossFilter.trim() : dimField;
  }

  _rawPivotField() {
    const raw = this.pivotBy
      || (Array.isArray(this.pivots) ? this.pivots[0] : (typeof this.pivots === 'string' ? this.pivots.split(',')[0].trim() : null))
      || (Array.isArray(this.query?.pivots) ? this.query.pivots[0] : (typeof this.query?.pivots === 'string' ? this.query.pivots.split(',')[0].trim() : null));
    return raw ? String(raw).trim() : '';
  }

  _dimField(rows) {
    const firstRow = (rows && rows[0]) || (this.data && this.data[0]) || (this._fetchedRows && this._fetchedRows[0]) || {};
    const keys = Object.keys(firstRow);
    const xKey = keys[0];
    const pivotField = this._rawPivotField();
    const rawDims = this.dimensions
      ? (Array.isArray(this.dimensions) ? this.dimensions : String(this.dimensions).split(',').map(s => s.trim()).filter(Boolean))
      : (Array.isArray(this.fields) ? this.fields : (typeof this.fields === 'string' ? this.fields.split(',').map(s => s.trim()).filter(Boolean) : keys));
    if (pivotField && rawDims.length >= 2 && rawDims[0] === pivotField) {
      return rawDims[1];
    }
    return rawDims[0] || xKey;
  }

  _hasActiveCrossFilter(dimField) {
    const filterField = this._crossFilterField(dimField);
    if (!filterField) return false;
    const host = this._hostApp();
    return Boolean(host && host.crossFilters && Object.prototype.hasOwnProperty.call(host.crossFilters, filterField));
  }

  _currentCrossFilterSelection(dimField) {
    const filterField = this._crossFilterField(dimField);
    if (filterField) {
      const host = this._hostApp();
      if (host && host.crossFilters && Object.prototype.hasOwnProperty.call(host.crossFilters, filterField)) {
        if (host._crossFilterRaw instanceof Map && host._crossFilterRaw.has(filterField)) {
          return host._crossFilterRaw.get(filterField);
        }
        return host.crossFilters[filterField] ?? null;
      }
    }
    return null;
  }

  _buildQuery() {
    const q = this.query || {};
    const fields = this._resolveFields(q, 'fields', 'dimensions', 'pivots', 'pivotBy', 'measures');
    if (fields.length === 0) return null;
    const query = {
      ...this._resolveTarget(q),
      fields,
      filters: q.filters || this.filters || {},
      limit: q.limit || this.limit || WIDGET_QUERY_DEFAULTS.chartLimit,
    };
    if (q.sorts || this.sorts) query.sorts = q.sorts || this.sorts;
    return query;
  }

  _receiveRows(rows) {
    this._fetchedRows = rows;
    this._renderHighchart(rows);
  }

  onThemeChange() {
    const rows = this.data || this._fetchedRows;
    if (!this.chartInstance || !rows || rows.length === 0) return;
    // Highcharts paints axis lines, labels, gauge panes and data-label colours
    // into the SVG at build time, so a CSS class flip cannot reach them. Both
    // of _renderHighchart's fast paths would swallow this: the first returns
    // early on unchanged data, and the second only calls setData() per series,
    // which never revisits axes or panes. Dropping the instance forces the
    // full rebuild. Theme flips are user-initiated and rare, so the cost is
    // not worth optimising around.
    this.chartInstance.destroy();
    this.chartInstance = null;
    this._prevRows = null;
    this._renderHighchart(rows);
  }

  _hasAuthorMarker(idx) {
    return Boolean(
      this.options?.plotOptions?.[this.type]?.marker ||
      this.options?.plotOptions?.series?.marker ||
      (Array.isArray(this.options?.series) && this.options.series[idx]?.marker !== undefined)
    );
  }

  _renderHighchart(rows) {
    if (!this._container) return;
    if (!window.Highcharts) {
      this._handleVendorUnavailable('Highcharts', () => {
        this._renderHighchart(this.data || this._fetchedRows);
      }, { tag: this.tagName ? this.tagName.toLowerCase() : 'app-chart', label: this.title || '', options: this.options || {} });
      return;
    }

    const dimField = this._dimField(rows);
    const pivotField = this._rawPivotField();
    const currentHasCf = this._hasActiveCrossFilter(dimField);
    const currentCrossFilter = this._currentCrossFilterSelection(dimField);
    const dimFieldChanged = this._prevDimField !== dimField;
    const pivotFieldChanged = (this._prevPivotField || '') !== pivotField;
    const valueFormatChanged = this._prevValueFormat !== this.valueFormat;
    const selectionUnchanged = (
      this._prevSelectedValue === this.selectedValue &&
      this._prevSelected === this.selected &&
      Boolean(this._prevHasCrossFilter) === currentHasCf &&
      (this._prevCrossFilterSelection ?? null) === currentCrossFilter
    );
    const colorsUnchanged = this._prevColor === this.color && areQueriesEqual(this._prevCategoryColors, this.categoryColors);
    const optionsUnchanged = areQueriesEqual(this._prevOptions, this.options);

    // Fast-path: if chart already exists with same type and identical data, selection, colors, and options, skip re-render completely
    if (this.chartInstance && !this._hasRenderError && this._prevType === this.type && !dimFieldChanged && !pivotFieldChanged && !valueFormatChanged && this._prevRows && areDataRowsEqual(rows, this._prevRows) && selectionUnchanged && colorsUnchanged && optionsUnchanged) {
      return;
    }

    this._prevDimField = dimField;
    this._prevPivotField = pivotField;
    this._prevValueFormat = this.valueFormat;
    this._prevSelectedValue = this.selectedValue;
    this._prevSelected = this.selected;
    this._prevHasCrossFilter = currentHasCf;
    this._prevCrossFilterSelection = currentCrossFilter;
    this._prevColor = this.color;
    this._prevCategoryColors = this.categoryColors;
    this._prevOptions = this.options;

    if (!rows || rows.length === 0) {
      if (this.chartInstance) {
        this.chartInstance.destroy();
        this.chartInstance = null;
      }
      this._prevRows = rows;
      this._prevType = this.type;
      if (this._noPoints) {
        this._noPoints = false;
        this.requestUpdate();
      }
      this._container.innerHTML = '';
      if (this._hasRenderError) {
        this._hasRenderError = false;
        this.error = null;
        this.requestUpdate();
      }
      return;
    }

    let finalOptions;
    try {
      const prevResolvedFormat = this._resolvedFormat;
      finalOptions = this._buildHighchartsOptions(rows);
      const resolvedFormatChanged = prevResolvedFormat !== undefined && prevResolvedFormat !== this._resolvedFormat;
      const totalPoints = (finalOptions.series || []).reduce((acc, s) => acc + (s.data ? s.data.length : 0), 0);

      if (totalPoints === 0) {
        if (this.chartInstance) {
          this.chartInstance.destroy();
          this.chartInstance = null;
        }
        this._prevRows = rows;
        this._prevType = this.type;
        this._container.innerHTML = '';
        if (!this._noPoints) {
          this._noPoints = true;
          this.requestUpdate();
        }
        if (this._hasRenderError) {
          this._hasRenderError = false;
          this.error = null;
          this.requestUpdate();
        }
        return;
      }

      if (this._noPoints) {
        this._noPoints = false;
        this.requestUpdate();
      }

      // In-place series update: if chart instance exists with matching series count and same chart type, update data
      const hasActivePieResponsive = (this.type === 'pie' || this.type === 'donut') && Boolean(this.chartInstance?.currentResponsive);
      if (this.chartInstance && this._prevType === this.type && !dimFieldChanged && !pivotFieldChanged && !valueFormatChanged && !resolvedFormatChanged && optionsUnchanged && !hasActivePieResponsive && this.chartInstance.series && finalOptions.series && this.chartInstance.series.length === finalOptions.series.length) {
        this._prevRows = rows;
        if (finalOptions.xAxis && finalOptions.xAxis.categories && this.chartInstance.xAxis && this.chartInstance.xAxis[0]) {
          this.chartInstance.xAxis[0].setCategories(finalOptions.xAxis.categories, false);
        }
        finalOptions.series.forEach((s, idx) => {
          if (this.chartInstance.series[idx]) {
            this.chartInstance.series[idx].setData(s.data, false);
            const updates = {};
            if (this.chartInstance.series[idx].name !== s.name) updates.name = s.name;
            if (s.color && this.chartInstance.series[idx].color !== s.color) updates.color = s.color;
            if (s.opacity != null && this.chartInstance.series[idx].options?.opacity !== s.opacity) updates.opacity = s.opacity;
            if (s.fillColor !== undefined) updates.fillColor = s.fillColor;
            const isLineLikeSeries = ['line', 'spline', 'area', 'areaspline'].includes(this.chartInstance.series[idx]?.type);
            if (s.marker !== undefined) {
              updates.marker = s.marker;
            } else if (isLineLikeSeries && !this._hasAuthorMarker(idx) && this.chartInstance.series[idx]?.options?.marker?.enabled) {
              updates.marker = { enabled: false };
            }
            if (Object.keys(updates).length > 0 && typeof this.chartInstance.series[idx].update === 'function') {
              this.chartInstance.series[idx].update(updates, false);
            }
          }
        });
        if ((this.type === 'pie' || this.type === 'donut') && typeof this.chartInstance.setTitle === 'function') {
          this.chartInstance.setTitle(finalOptions.title, finalOptions.subtitle, false);
        }
        const authorPrimaryYAxis = Array.isArray(this.options?.yAxis) ? this.options.yAxis[0] : this.options?.yAxis;
        const primaryFinalYAxis = Array.isArray(finalOptions.yAxis) ? finalOptions.yAxis[0] : finalOptions.yAxis;
        if (primaryFinalYAxis && this.chartInstance.yAxis && this.chartInstance.yAxis[0] && !authorPrimaryYAxis?.plotLines) {
          const nextPlotLines = primaryFinalYAxis?.plotLines || [];
          if (typeof this.chartInstance.yAxis[0].update === 'function') {
            this.chartInstance.yAxis[0].update({ plotLines: nextPlotLines }, false);
          } else if (this.chartInstance.yAxis[0].options) {
            this.chartInstance.yAxis[0].options.plotLines = nextPlotLines;
          }
        }
        if (this.options && typeof this.options === 'object' && Object.keys(this.options).length > 0) {
          const cleanOptions = stripAuthorPointClickOptions(this.options);
          this.chartInstance.update(_isRendering ? withoutChartAnimation(cleanOptions) : cleanOptions, false);
        }
        this.chartInstance.redraw(false);
        this._syncYScaleGroup();
        // Clear any prior render/vendor error on successful in-place redraw
        if (this._hasRenderError) {
          this._hasRenderError = false;
          this.error = null;
          this.requestUpdate();
        }
        return;
      }

      if (this.chartInstance) {
        this.chartInstance.destroy();
        this.chartInstance = null;
      }
      this._prevRows = rows;
      this._prevType = this.type;
      if (typeof Highcharts === 'undefined' || !Highcharts || typeof Highcharts.chart !== 'function') {
        throw new Error('Highcharts vendor bundle is not available');
      }
      if (this._hasRenderError && this._container?.style) {
        this._container.style.display = '';
      }
      this.chartInstance = Highcharts.chart(this._container, finalOptions);
      this._syncYScaleGroup();
      // Clear any prior render/vendor error on successful chart instantiation
      if (this._hasRenderError) {
        this._hasRenderError = false;
        this.error = null;
        this.requestUpdate();
      }
    } catch (err) {
      if (this.chartInstance) {
        try { this.chartInstance.destroy(); } catch {}
        this.chartInstance = null;
      }
      this._prevRows = null;
      this.error = err;
      this._hasRenderError = true;
      const tag = this.tagName ? this.tagName.toLowerCase() : 'app-chart';
      reportRuntimeError(`<${tag}> Highcharts render failed`, err,
        { tag, label: this.title || '', options: finalOptions });
      this.requestUpdate();
    }
  }

  _syncYScaleGroup(groupName) {
    const targetGroup = groupName || this.yScaleGroup;
    if (!targetGroup || !_yScaleGroups.has(targetGroup)) return;
    const group = _yScaleGroups.get(targetGroup);
    let groupMax = -Infinity;
    for (const member of group) {
      const yAxis = member.chartInstance?.yAxis?.[0];
      if (yAxis) {
        const dm = yAxis.dataMax;
        if (typeof dm === 'number' && Number.isFinite(dm)) {
          if (dm > groupMax) groupMax = dm;
        }
      }
    }
    if (!Number.isFinite(groupMax)) return;
    for (const member of group) {
      const yAxis = member.chartInstance?.yAxis?.[0];
      // Compare the requested max: `yAxis.max` is rounded up to the next tick.
      if (yAxis && yAxis.options?.max !== groupMax) {
        if (member._syncingYScale) continue;
        member._syncingYScale = true;
        try {
          yAxis.update({ max: groupMax }, true);
        } finally {
          member._syncingYScale = false;
        }
      }
    }
    let ceilMax = groupMax;
    for (const member of group) {
      const ym = member.chartInstance?.yAxis?.[0]?.max;
      if (typeof ym === 'number' && Number.isFinite(ym) && ym > ceilMax) {
        ceilMax = ym;
      }
    }
    if (ceilMax > groupMax) {
      for (const member of group) {
        const yAxis = member.chartInstance?.yAxis?.[0];
        if (yAxis && typeof yAxis.max === 'number' && yAxis.max < ceilMax) {
          if (member._syncingYScale) continue;
          member._syncingYScale = true;
          try {
            yAxis.update({ max: ceilMax }, true);
          } finally {
            member._syncingYScale = false;
          }
        }
      }
    }
  }

  _buildHighchartsOptions(rows) {
    if (!rows || rows.length === 0) return {};

    const firstRow = rows[0] || {};
    const keys = Object.keys(firstRow);
    const xKey = keys[0];
    const dimField = this._dimField(rows);
    const isPie = this.type === 'pie' || this.type === 'donut';
    const isArea = this.type === 'area' || this.type === 'areaspline';
    const isLine = this.type === 'line' || this.type === 'spline';
    const isLineLike = isLine || isArea;
    const isScatter = this.type === 'scatter';
    const isTreemap = this.type === 'treemap';
    const isGauge = this.type === 'gauge' || this.type === 'solidgauge';
    const isFunnel = this.type === 'funnel' || this.type === 'pyramid';
    const rc = (c) => resolveColor(c, this);
    const isDark = isDarkContext(this);
    const unselectedGray = rc(`var(--app-chart-unselected, ${isDark ? UNSELECTED_GRAY_DARK : UNSELECTED_GRAY_LIGHT})`);
    const isStacked = Boolean(this.stacked || this.options?.plotOptions?.series?.stacking || this.options?.plotOptions?.column?.stacking || this.options?.plotOptions?.bar?.stacking);
    const customScatterMarker = {
      ...(this.options?.plotOptions?.series?.marker || {}),
      ...(this.options?.plotOptions?.scatter?.marker || {}),
    };
    const primaryColor = rc(this.color);
    // The single-series / line / area default follows the app accent token, so a
    // palette edit recolours it; an explicit `color=` (literal or var()) wins.
    // For a default app `--app-primary` is `#4285f4` (data-app.css), so the
    // default primary is Looker's first palette color.
    const baseColor = primaryColor || rc('var(--app-primary, #4285f4)');
    const rawCustom = this.options?.colors || (Array.isArray(this.color) ? this.color : null);
    const customColors = Array.isArray(rawCustom) ? rawCustom.map(rc) : (rawCustom ? rc(rawCustom) : null);
    // Default categorical palette expressed as tokens (declared in data-app.css
    // with these exact hex fallbacks) followed by Looker's remaining 13 palette
    // colors so up to 20 series or slices never repeat without token overrides.
    const tokenFallbacks = ['#4285f4', '#ed984d', '#ad7fe6', '#b5c665', '#2bb8ca', '#eac43b', '#e574b1'];
    const tokenColors = tokenFallbacks.map((hex, i) => rc(`var(--app-chart-${i + 1}, ${hex})`));
    const allDefaultTokens = tokenColors.every((c, i) => String(c).trim().toLowerCase() === tokenFallbacks[i]);
    const extendedFallbacks = [
      '#6666ba', '#ddba83', '#99d8f4', '#1c7781', '#e3aef2',
      '#803e8f', '#70783a', '#b95b41', '#56bbe5', '#3364a7',
      '#966b54', '#cc9434', '#c4cce1',
    ];
    const defaultColors = customColors || (allDefaultTokens
      ? [
          ...tokenColors,
          ...extendedFallbacks.map((hex, i) => rc(`var(--app-chart-${i + 8}, ${hex})`)),
        ]
      : tokenColors);
    const rawCat = this.categoryColors || this.options?.categoryColors || {};
    const catColors = {};
    for (const k in rawCat) catColors[k] = rc(rawCat[k]);
    const hasCfSelection = this._hasActiveCrossFilter(dimField);
    const cfVal = this._currentCrossFilterSelection(dimField);
    const selVal = this.selectedValue !== undefined && this.selectedValue !== null ? this.selectedValue : cfVal;
    const hasNullCfSelection = this.selectedValue == null && hasCfSelection && (cfVal === null || cfVal === undefined);
    const sel = this.selected;
    const hasSelection = this._isCrossFilterSurface() && Boolean(
      hasNullCfSelection ||
      (selVal != null && selVal !== '' && selVal !== 'All' && selVal !== 'all') ||
      (sel != null && (Array.isArray(sel) ? sel.length > 0 : (sel !== '' && sel !== 'All' && sel !== 'all')))
    );

    function isCategorySelected(catName, rawCatVal = undefined) {
      if (!hasSelection) return true;
      if (hasNullCfSelection) {
        if (rawCatVal !== undefined) return rawCatVal === null || rawCatVal === undefined;
        return catName === null || catName === undefined || catName === '';
      }
      const c = String(rawCatVal ?? catName ?? '').trim().toLowerCase();
      if (selVal != null && selVal !== '' && selVal !== 'All' && selVal !== 'all') {
        if (c === String(selVal).trim().toLowerCase()) return true;
      }
      if (sel != null) {
        if (Array.isArray(sel)) {
          if (sel.some(s => String(s).trim().toLowerCase() === c)) return true;
        } else if (sel !== '' && sel !== 'All' && sel !== 'all') {
          if (c === String(sel).trim().toLowerCase()) return true;
        }
      }
      return false;
    }

    let categories;
    let seriesList;

    // Check if 2 dimensions + 1 measure were queried (e.g. [date, test_suite, metric] or [origin, dep_year, count])
    const queryDims = this.query?.dimensions ?? this.dimensions;
    const hasTwoExplicitDims = Array.isArray(queryDims)
      ? queryDims.length >= 2
      : (typeof queryDims === 'string' && queryDims.split(',').map(s => s.trim()).filter(Boolean).length >= 2);
    const isExplicitPivot = Boolean(this.query?.pivots || this.pivots || this.pivotBy || hasTwoExplicitDims);
    const hasRepeatedX = rows.length > 1 && new Set(rows.map(r => String(r[xKey] ?? ''))).size < rows.length;
    const isTwoDimPivot = !isPie && !isTreemap && !isGauge && !isFunnel && keys.length === 3 && (
      isExplicitPivot || typeof firstRow[keys[1]] === 'string' || hasRepeatedX
    );

    const labelColor = rc(isDark ? 'var(--app-muted, #94a3b8)' : 'var(--app-muted, #5f6368)');

    if (isTreemap) {
      const valKey = keys[1] || keys[0];
      const cleanValKey = valKey.split('.').pop().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const hasColorsArray = Boolean(this.options?.colors || Array.isArray(this.color));
      const isSingleColor = Boolean(typeof this.color === 'string' && this.color.trim());
      const activeTreemapLabelColor = rc(
        this.options?.plotOptions?.treemap?.dataLabels?.style?.color ||
        this.options?.plotOptions?.series?.dataLabels?.style?.color ||
        '#ffffff'
      );
      const unselectedTreemapLabelColor = isDark ? '#cbd5e1' : '#52565a';
      seriesList = [{
        type: 'treemap',
        name: cleanValKey,
        layoutAlgorithm: 'squarified',
        data: rows.map((r, i) => {
          const nameStr = String(r[xKey] ?? '');
          const rawColor = catColors[nameStr] || (!hasColorsArray && isSingleColor ? primaryColor : defaultColors[i % defaultColors.length]);
          const isSel = isCategorySelected(nameStr, r[xKey]);
          return {
            name: nameStr,
            rawValue: r[xKey],
            value: parsePointValue(r[valKey], false),
            color: hasSelection ? (isSel ? rawColor : unselectedGray) : rawColor,
            originalColor: rawColor,
            opacity: 1.0,
            dataLabels: {
              style: {
                color: (hasSelection && !isSel) ? unselectedTreemapLabelColor : activeTreemapLabelColor,
              },
            },
          };
        }),
      }];
    } else if (isGauge) {
      const valKey = keys[1] || keys[0];
      const rawVal = parsePointValue(rows[0]?.[valKey], false);
      seriesList = [{
        type: this.type === 'gauge' ? 'gauge' : 'solidgauge',
        name: this.title || 'Value',
        data: [rawVal],
      }];
    } else if (isFunnel) {
      const valKey = keys[1] || keys[0];
      const hasColorsArray = Boolean((this.options && this.options.colors) || Array.isArray(this.color));
      const isSingleColor = Boolean(typeof this.color === 'string' && this.color.trim());
      const funnelPalette = isDark ? FUNNEL_SEQUENTIAL_DARK : FUNNEL_SEQUENTIAL_LIGHT;
      seriesList = [{
        type: this.type,
        name: this.title || 'Funnel',
        data: rows.map((r, i) => {
          const nameStr = String(r[xKey] ?? '');
          const ptColor = catColors[nameStr] || (hasColorsArray
            ? defaultColors[i % defaultColors.length]
            : (isSingleColor
              ? primaryColor
              : funnelPalette[i % funnelPalette.length]));
          const isSel = isCategorySelected(nameStr, r[xKey]);
          return {
            name: nameStr,
            rawValue: r[xKey],
            y: parsePointValue(r[valKey], false),
            color: hasSelection ? (isSel ? ptColor : unselectedGray) : ptColor,
            originalColor: ptColor,
            opacity: 1.0,
          };
        }),
      }];
    } else if (isPie) {
      categories = rows.map(r => String(r[xKey] ?? ''));
      const yKey = keys[1] || keys[0];
      const cleanYKey = yKey.split('.').pop().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const pieData = rows.map((r, i) => {
        const val = parsePointValue(r[yKey], false);
        const nameStr = String(r[xKey] ?? '');
        const ptColor = catColors[nameStr] || defaultColors[i % defaultColors.length];
        const isSel = isCategorySelected(nameStr, r[xKey]);
        return {
          name: nameStr,
          rawValue: r[xKey],
          y: val,
          color: hasSelection ? (isSel ? ptColor : unselectedGray) : ptColor,
          originalColor: ptColor,
          opacity: 1.0,
          sliced: false,
        };
      });
      seriesList = [{
        name: cleanYKey,
        data: pieData,
      }];
    } else if (isTwoDimPivot) {
      // 2-dimension auto-pivoting: keys[0] = X dimension, keys[1] = Pivot category, keys[2] = Measure
      const rawPivot = this.pivotBy
        || (Array.isArray(this.pivots) ? this.pivots[0] : (typeof this.pivots === 'string' ? this.pivots.split(',')[0].trim() : null))
        || (Array.isArray(this.query?.pivots) ? this.query.pivots[0] : (typeof this.query?.pivots === 'string' ? this.query.pivots.split(',')[0].trim() : null));
      const pivotKey = (rawPivot && keys.includes(rawPivot)) ? rawPivot : keys[1];
      const pivotXKey = pivotKey === keys[0] ? keys[1] : xKey;
      const valKey = keys.find(k => k !== pivotXKey && k !== pivotKey);
      const uniqueX = [...new Set(rows.map(r => String(r[pivotXKey] ?? '')))];
      const uniquePivots = [...new Set(rows.map(r => String(r[pivotKey] ?? '')))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      
      const matrix = {};
      uniquePivots.forEach(p => { matrix[p] = {}; });
      const rawXByStr = new Map();
      const rawPivotByStr = new Map();
      rows.forEach(r => {
        const x = String(r[pivotXKey] ?? '');
        const p = String(r[pivotKey] ?? '');
        if (!rawXByStr.has(x)) rawXByStr.set(x, r[pivotXKey]);
        if (!rawPivotByStr.has(p)) rawPivotByStr.set(p, r[pivotKey]);
        if (matrix[p]) matrix[p][x] = r[valKey];
      });

      const activeFilterField = this._crossFilterField(dimField) || dimField;
      const dimByPivot = activeFilterField === pivotKey;
      categories = uniqueX;
      seriesList = uniquePivots.map((pVal, idx) => {
        const sColor = catColors[pVal] || defaultColors[idx % defaultColors.length];
        const rawP = rawPivotByStr.get(pVal);
        const isSeriesSel = dimByPivot ? isCategorySelected(pVal, rawP) : true;
        const s = {
          name: pVal,
          data: uniqueX.map(x => {
            const yVal = parsePointValue(matrix[pVal]?.[x], true);
            const rawVal = dimByPivot ? rawP : rawXByStr.get(x);
            const isSel = dimByPivot ? isSeriesSel : isCategorySelected(x, rawVal);
            const ptColor = hasSelection ? (isSel ? sColor : unselectedGray) : sColor;
            const ptObj = {
              name: x,
              rawValue: rawVal,
              y: yVal,
              color: ptColor,
              originalColor: sColor,
              opacity: 1.0,
            };
            if (isScatter) {
              ptObj.marker = { enabled: true, radius: 6, symbol: 'circle', fillColor: colorWithAlpha(sColor, 0.2), lineColor: sColor, lineWidth: 2, ...customScatterMarker };
            }
            return ptObj;
          }),
          color: (hasSelection && dimByPivot) ? (isSeriesSel ? sColor : unselectedGray) : sColor,
          opacity: 1.0,
        };
        if (isArea && !this.options?.plotOptions?.[this.type]?.fillColor && !this.options?.plotOptions?.series?.fillColor) {
          s.fillColor = buildAreaGradient(sColor, 0.3, 0.1);
        }
        if (isScatter) {
          s.marker = { enabled: true, radius: 6, symbol: 'circle', fillColor: colorWithAlpha(s.color, 0.2), lineColor: s.color, lineWidth: 2, ...customScatterMarker };
        }
        return s;
      });
    } else if (keys.length > 2) {
      categories = rows.map(r => String(r[xKey] ?? ''));
      // Multi-measure multi-series
      const measureKeys = keys.slice(1);
      seriesList = measureKeys.map((mKey, idx) => {
        const cleanName = mKey.split('.').pop().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const sColor = (primaryColor && idx === 0) ? primaryColor : (catColors[cleanName] || defaultColors[idx % defaultColors.length]);
        const s = {
          name: cleanName,
          data: rows.map((r, i) => {
            const val = parsePointValue(r[mKey], true);
            const catName = String(r[xKey] ?? '');
            const isSel = isCategorySelected(catName, r[xKey]);
            const ptColor = hasSelection ? (isSel ? sColor : unselectedGray) : sColor;
            const ptObj = {
              name: catName,
              rawValue: r[xKey],
              y: val,
              color: ptColor,
              originalColor: sColor,
              opacity: 1.0,
            };
            if (isScatter) {
              ptObj.marker = { enabled: true, radius: 6, symbol: 'circle', fillColor: colorWithAlpha(sColor, 0.2), lineColor: sColor, lineWidth: 2, ...customScatterMarker };
            }
            return ptObj;
          }),
          color: sColor,
          opacity: 1.0,
        };
        if (isArea && !this.options?.plotOptions?.[this.type]?.fillColor && !this.options?.plotOptions?.series?.fillColor) {
          s.fillColor = buildAreaGradient(sColor, 0.3, 0.1);
        }
        if (isScatter) {
          s.marker = { enabled: true, radius: 6, symbol: 'circle', fillColor: colorWithAlpha(sColor, 0.2), lineColor: sColor, lineWidth: 2, ...customScatterMarker };
        }
        return s;
      });
    } else {
      categories = rows.map(r => String(r[xKey] ?? ''));
      // Single series
      const yKey = keys[1] || keys[0];
      const cleanYKey = yKey.split('.').pop().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const isColOrBar = this.type === 'column' || this.type === 'bar';
      const hasExplicitSingleColor = Boolean(this.color && !Array.isArray(this.color));
      const useCustomPalette = isColOrBar && Array.isArray(customColors) && !hasExplicitSingleColor;
      const isColorByPoint = isColOrBar && !hasExplicitSingleColor && Boolean(
        this.options?.plotOptions?.column?.colorByPoint ||
        this.options?.plotOptions?.bar?.colorByPoint ||
        this.options?.plotOptions?.series?.colorByPoint
      );
      const parsedVals = rows.map(r => parsePointValue(r[yKey], true));
      const hasMixedSign = isColOrBar && parsedVals.some(v => typeof v === 'number' && v > 0) && parsedVals.some(v => typeof v === 'number' && v < 0);
      const downColor = rc('var(--app-chart-down, #ed984d)');
      const s = {
        name: cleanYKey,
        data: rows.map((r, i) => {
          const val = parsedVals[i];
          const catName = String(r[xKey] ?? '');
          const defaultBarColor = (isColOrBar && !hasExplicitSingleColor && hasMixedSign && typeof val === 'number' && val < 0)
            ? downColor
            : baseColor;
          const rawColor = catColors[catName] || (
            useCustomPalette
              ? customColors[i % customColors.length]
              : (isColorByPoint ? rc(defaultColors[i % defaultColors.length]) : defaultBarColor)
          );
          const isSel = isCategorySelected(catName, r[xKey]);
          const ptColor = hasSelection ? (isSel ? rawColor : unselectedGray) : rawColor;
          const ptObj = {
            name: catName,
            rawValue: r[xKey],
            y: val,
            color: ptColor,
            originalColor: rawColor,
            opacity: 1.0,
          };
          if (isScatter) {
            ptObj.marker = { enabled: true, radius: 6, symbol: 'circle', fillColor: colorWithAlpha(rawColor, 0.2), lineColor: rawColor, lineWidth: 2, ...customScatterMarker };
          }
          return ptObj;
        }),
        color: baseColor,
        opacity: 1.0,
      };
      if (isArea && !this.options?.plotOptions?.[this.type]?.fillColor && !this.options?.plotOptions?.series?.fillColor) {
        s.fillColor = buildAreaGradient(baseColor, 0.3, 0.1);
      }
      if (isScatter) {
        s.marker = { enabled: true, radius: 6, symbol: 'circle', fillColor: colorWithAlpha(baseColor, 0.2), lineColor: baseColor, lineWidth: 2, ...customScatterMarker };
      }
      seriesList = [s];
    }

    const allSeriesVals = Array.isArray(seriesList)
      ? seriesList.flatMap(s => (s?.data || []).map(pt => (pt && typeof pt === 'object') ? (pt.y ?? pt.value) : pt)).filter(Number.isFinite)
      : [];
    const format = resolvePercentFormat(this.valueFormat, allSeriesVals);
    this._resolvedFormat = format;
    const fmtRaw = (v) => format ? formatValue(v, format) : (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toFixed(2)) : v);

    const gridLineColor = rc(isDark ? 'var(--app-chart-grid, rgba(255, 255, 255, 0.05))' : 'var(--app-chart-grid, #e0e0e0)');
    const axisLineColor = isDark ? 'rgba(255, 255, 255, 0.12)' : '#bdc1c6';
    const self = this;
    const isPercent = format && format.startsWith('percent');
    const isLowerBetter = this.polarity === 'lower-better';
    const gaugeStops = isLowerBetter ? [
      [0.1, '#10b981'],
      [0.5, '#f59e0b'],
      [0.8, '#ef4444'],
    ] : [
      [0.1, '#ef4444'],
      [0.5, '#f59e0b'],
      [0.8, '#10b981'],
    ];

    const authorSeriesPointClick =
      this.options?.plotOptions?.[this.type]?.point?.events?.click ||
      this.options?.plotOptions?.series?.point?.events?.click;
    const authorPiePointClick =
      this.options?.plotOptions?.pie?.point?.events?.click ||
      this.options?.plotOptions?.donut?.point?.events?.click ||
      authorSeriesPointClick;
    const createPointClickHandler = (userPointClick) => function(e) {
      const pt = this || e?.point;
      if (!pt) return;
      let userRes;
      if (typeof userPointClick === 'function') {
        try {
          userRes = userPointClick.call(this, e);
        } catch (err) {
          const tag = self.tagName ? self.tagName.toLowerCase() : 'app-chart';
          reportRuntimeError(`<${tag}> point click callback failed`, err, { tag, label: self.title || '' });
          return;
        }
      }
      const rawValue = (pt.options && 'rawValue' in pt.options)
        ? pt.options.rawValue
        : ('rawValue' in pt
          ? pt.rawValue
          : (pt.name !== undefined ? pt.name : (pt.category !== undefined ? pt.category : pt.x)));
      const filterField = self._crossFilterField(dimField);
      const activeField = filterField || dimField;
      const detail = {
        field: activeField,
        value: rawValue,
        y: pt.y ?? pt.value,
        mouseEvent: e,
        chartComponent: self,
      };
      const clickEvent = new CustomEvent('app-chart-click', {
        detail,
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      if (userRes === false || e?.defaultPrevented) {
        clickEvent.preventDefault();
      }
      self.dispatchEvent(clickEvent);
      if (clickEvent.defaultPrevented || e?.defaultPrevented || userRes === false) {
        return;
      }
      const host = self._hostApp();
      if (filterField) {
        if (host && typeof host.toggleCrossFilter === 'function') {
          host.toggleCrossFilter(filterField, detail.value, self);
        } else {
          noteCrossFilterOrigin(filterField, self);
        }
      }
    };

    const allPointY = (!isPie && !isTreemap && !isGauge && !isFunnel && Array.isArray(seriesList))
      ? seriesList.flatMap(s => (s?.data || []).map(pt => (pt && typeof pt === 'object') ? pt.y : pt)).filter(Number.isFinite)
      : [];
    const hasMixedSignAxis = allPointY.some(y => y > 0) && allPointY.some(y => y < 0);

    const defaultOptions = {
      chart: {
        type: this.type === 'donut' ? 'pie' : (this.type || 'column'),
        backgroundColor: 'transparent',
        style: { fontFamily: 'inherit' },
        animation: false,
        spacingTop: 10,
        spacingRight: 10,
        spacingBottom: 15,
        spacingLeft: 20,
      },
      subtitle: undefined,
      accessibility: { enabled: false },
      colors: defaultColors,
      pane: isGauge ? {
        center: ['50%', '80%'],
        size: '110%',
        startAngle: -90,
        endAngle: 90,
        background: {
          backgroundColor: isDark ? '#334155' : '#e2e8f0',
          innerRadius: '60%',
          outerRadius: '100%',
          shape: 'arc',
          borderWidth: 0,
        }
      } : undefined,
      plotOptions: {
        series: {
          cursor: 'pointer',
          animation: false,
          stacking: this.stacked ? 'normal' : undefined,
          threshold: (isLine || isArea) ? null : 0,
          borderRadius: (this.type === 'column' || this.type === 'bar') ? 2 : 0,
          marker: {
            radius: 4,
            symbol: 'circle',
          },
          states: {
            hover: {
              halo: { size: 0 },
            },
            inactive: {
              opacity: 0.5,
            },
          },
          point: {
            events: {
              click: createPointClickHandler(authorSeriesPointClick),
            }
          },
        },
        column: {
          borderRadius: 2,
          pointPadding: 0,
          groupPadding: 0.2,
          borderWidth: isStacked ? 1 : 0,
          borderColor: isDark ? '#111827' : '#ffffff',
        },
        bar: {
          borderRadius: 2,
          pointPadding: 0,
          groupPadding: 0.2,
          borderWidth: isStacked ? 1 : 0,
          borderColor: isDark ? '#111827' : '#ffffff',
        },
        line: {
          lineWidth: 2.5,
          marker: { enabled: false },
        },
        spline: {
          lineWidth: 2.5,
          marker: { enabled: false },
        },
        treemap: {
          layoutAlgorithm: 'squarified',
          borderColor: isDark ? '#1e293b' : '#ffffff',
          borderWidth: 2,
          dataLabels: {
            enabled: true,
            style: { fontSize: '12px', color: '#ffffff', textOutline: 'none', fontWeight: '600' }
          }
        },
        solidgauge: {
          dataLabels: {
            y: 5,
            borderWidth: 0,
            useHTML: true,
            formatter: function() {
              const formatted = this.y != null ? fmtRaw(this.y) : '';
              return `<div style="text-align:center"><span style="font-size:22px;font-weight:700;color:${isDark ? '#f8fafc' : '#0f172a'}">${escapeHtml(String(formatted))}</span></div>`;
            }
          }
        },
        funnel: {
          neckWidth: '0%',
          neckHeight: '0%',
          width: '80%',
          borderWidth: 2,
          borderColor: isDark ? '#111827' : '#ffffff',
          animation: false,
          dataLabels: {
            enabled: true,
            formatter: function() {
              const name = escapeHtml(this.point?.name ?? this.key ?? '');
              const v = fmtRaw(this.y);
              return `<b>${name}</b>: ${escapeHtml(String(v))}`;
            },
            style: { fontSize: '11px', color: labelColor, textOutline: 'none', fontWeight: '500', width: '140px', textOverflow: 'ellipsis' }
          }
        },
        pyramid: {
          width: '65%',
          borderWidth: 2,
          borderColor: isDark ? '#111827' : '#ffffff',
          animation: false,
          dataLabels: {
            enabled: true,
            formatter: function() {
              const name = escapeHtml(this.point?.name ?? this.key ?? '');
              const v = fmtRaw(this.y);
              return `<b>${name}</b>: ${escapeHtml(String(v))}`;
            },
            style: { fontSize: '11px', color: labelColor, textOutline: 'none', fontWeight: '500', width: '140px', textOverflow: 'ellipsis' }
          }
        },
        pie: {
          allowPointSelect: false,
          slicedOffset: 0,
          cursor: 'pointer',
          size: '72%',
          center: ['50%', '50%'],
          innerSize: '70%',
          borderWidth: 2,
          borderColor: isDark ? '#111827' : '#ffffff',
          borderRadius: 4,
          states: {
            hover: {
              halo: { size: 15, opacity: 0.5 },
              brightness: 0,
            },
            inactive: { opacity: 0.5 },
          },
          point: {
            events: {
              click: createPointClickHandler(authorPiePointClick),
            }
          },
          dataLabels: {
            enabled: true,
            distance: 10,
            connectorPadding: 4,
            formatter: function() {
              const name = escapeHtml(this.point?.name || this.key || '');
              const pct = this.percentage != null ? ` (${this.percentage.toFixed(1)}%)` : '';
              return `<b>${name}</b>${pct}`;
            },
            style: { fontSize: '11px', color: labelColor, textOutline: 'none', fontWeight: '500' }
          },
          showInLegend: false,
        },
        area: {
          fillColor: buildAreaGradient(defaultColors[0] || '#4285f4', 0.3, 0.1),
          fillOpacity: 0.25,
          lineWidth: 2,
          marker: { enabled: false, radius: 3, symbol: 'circle' },
        },
        areaspline: {
          fillColor: buildAreaGradient(defaultColors[0] || '#4285f4', 0.3, 0.1),
          fillOpacity: 0.25,
          lineWidth: 2,
          marker: { enabled: false, radius: 3, symbol: 'circle' },
        },
        scatter: {
          marker: { enabled: true, radius: 6, symbol: 'circle', lineWidth: 2 },
        },
      },
      title: { text: null },
      xAxis: (isPie || isTreemap || isGauge || isFunnel) ? undefined : {
        categories: categories,
        title: {
          text: null,
          margin: 8,
          style: { color: isDark ? '#cbd5e1' : '#3c4043', fontSize: '14px', fontWeight: '500' }
        },
        labels: { style: { color: labelColor, fontSize: '12px' } },
        lineColor: gridLineColor,
        lineWidth: 1,
        tickColor: axisLineColor,
        tickLength: 0,
      },
      yAxis: isGauge ? {
        min: 0,
        max: (format === 'percent1' ? 1 : 100),
        stops: gaugeStops,
        lineWidth: 0,
        tickWidth: 0,
        minorTickInterval: null,
        tickAmount: 2,
        title: { text: null },
        labels: {
          distance: -20,
          style: { fontSize: '10px', color: labelColor },
          formatter: function() {
            if (this.axis && (this.axis.categories || this.axis.dateTime)) {
              return this.axis.defaultLabelFormatter.call(this);
            }
            return formatAxisValue(this.value, format);
          }
        }
      } : ((isPie || isTreemap || isFunnel) ? undefined : {
        min: undefined,
        max: undefined,
        softMin: isPercent ? 0 : undefined,
        softMax: undefined,
        plotLines: hasMixedSignAxis ? [{
          id: 'da-zero-line',
          value: 0,
          color: isDark ? 'rgba(255, 255, 255, 0.35)' : '#80868b',
          width: 1.5,
          zIndex: 3,
        }] : undefined,
        title: {
          text: null,
          margin: 18,
          style: { color: isDark ? '#cbd5e1' : '#3c4043', fontSize: '14px', fontWeight: '500' }
        },
        labels: {
          style: { color: labelColor, fontSize: '12px' },
          formatter: function() {
            if (this.axis && (this.axis.categories || this.axis.dateTime)) {
              return this.axis.defaultLabelFormatter.call(this);
            }
            return formatAxisValue(this.value, format);
          }
        },
        gridLineColor: gridLineColor,
      }),
      tooltip: {
        animation: false,
        followPointer: !(isLine || isArea || this.type === 'scatter'),
        hideDelay: 0,
        stickOnContact: false,
        backgroundColor: isDark ? '#1e293b' : '#ffffff',
        borderColor: isDark ? '#334155' : 'transparent',
        borderWidth: isDark ? 1 : 0,
        borderRadius: 4,
        padding: 10,
        shadow: {
          color: isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.15)',
          offsetX: 0,
          offsetY: 4,
          opacity: 1,
          width: 12,
        },
        style: { color: isDark ? '#f8fafc' : '#3c4043', fontSize: '12px', zIndex: 50 },
        shared: !isPie && !isScatter && !isFunnel && !isTreemap,
        useHTML: true,
        formatter: function() {
          const label = escapeHtml(this.point?.name || this.key || this.x || '');
          const headerTextColor = isDark ? '#94a3b8' : '#707781';
          const seriesTextColor = isDark ? '#cbd5e1' : '#3c4043';
          const valTextColor = isDark ? '#f8fafc' : '#1f2937';
          if (isPie) {
            const val = fmtRaw(this.y);
            const pct = this.percentage ? ` (${this.percentage.toFixed(1)}%)` : '';
            const c = this.point?.originalColor || this.color || this.point?.color || '';
            return `<div style="line-height:1.4;"><span style="color:${escapeHtml(c)}">●</span> <b style="color:${valTextColor};">${label}</b><br/><span style="color:${seriesTextColor};">${escapeHtml(this.series.name)}:</span> <b style="color:${valTextColor};">${escapeHtml(String(val))}</b>${pct}</div>`;
          }
          if (this.points && this.points.length > 1) {
            let s = `<div style="line-height:1.4;"><div style="color:${headerTextColor};font-weight:400;margin-bottom:4px;">${label}</div>`;
            this.points.forEach(p => {
              const val = fmtRaw(p.y);
              const c = p.point?.originalColor || p.color || p.point?.color || '';
              s += `<div><span style="color:${escapeHtml(c)}">●</span> <span style="color:${seriesTextColor};">${escapeHtml(p.series.name)}:</span> <b style="color:${valTextColor};">${escapeHtml(String(val))}</b></div>`;
            });
            s += `</div>`;
            return s;
          }
          const val = fmtRaw(this.y ?? this.point?.value);
          const pt = this.point || {};
          const c = pt.originalColor || pt.color || this.color || '';
          return `<div style="line-height:1.4;"><div style="color:${headerTextColor};font-weight:400;margin-bottom:4px;">${label}</div><div><span style="color:${escapeHtml(c)}">●</span> <span style="color:${seriesTextColor};">${escapeHtml(this.series.name)}:</span> <b style="color:${valTextColor};">${escapeHtml(String(val))}</b></div></div>`;
        }
      },
      legend: {
        enabled: !isPie && seriesList.length > 1,
        itemDistance: 24,
        margin: 8,
        symbolWidth: 18,
        symbolHeight: 16,
        symbolRadius: 4,
        squareSymbol: false,
        itemStyle: { color: isDark ? '#cbd5e1' : '#3c4043', fontSize: '12px', fontWeight: '400' },
        itemHoverStyle: { color: isDark ? '#f8fafc' : '#111827' },
        itemHiddenStyle: { color: isDark ? '#475569' : '#cccccc' },
      },
      credits: { enabled: false },
      series: seriesList,
    };

    // Merge an author-supplied `options.series` array index-wise onto the
    // generated `seriesList`, preserving the fetched data and defaults on each
    // series while allowing author overrides (e.g. `yAxis: 1`, `dashStyle`, `lineWidth`).
    let mergeOptions = this.options || {};
    if (Array.isArray(mergeOptions.series)) {
      const authorSeries = mergeOptions.series;
      const mergedSeries = seriesList.map((base, idx) => {
        return authorSeries[idx] ? Highcharts.merge(base, authorSeries[idx]) : base;
      });
      if (authorSeries.length > seriesList.length) {
        for (let i = seriesList.length; i < authorSeries.length; i++) {
          mergedSeries.push(authorSeries[i]);
        }
      }
      seriesList = mergedSeries;
      mergeOptions = { ...mergeOptions };
      delete mergeOptions.series;
    }

    defaultOptions.series = seriesList;

    if (isPie && !mergeOptions.subtitle && this.options?.plotOptions?.pie?.innerSize !== '0%' && this.options?.plotOptions?.pie?.innerSize !== 0) {
      const pieTotal = (seriesList[0]?.data || []).reduce((acc, pt) => acc + (Number(pt.y) || 0), 0);
      const formattedPieTotal = formatAxisValue(pieTotal, format);
      const pieSeriesName = String(seriesList[0]?.name || '');
      const pieMeasureLabel = pieSeriesName.trim().toLowerCase() === 'count' ? '' : pieSeriesName;
      const totalSpan = `<span style="font-size:24px;font-weight:400;color:${isDark ? '#f8fafc' : '#3c4043'};fill:${isDark ? '#f8fafc' : '#3c4043'};">${escapeHtml(String(formattedPieTotal))}</span>`;
      defaultOptions.subtitle = {
        text: `${totalSpan}${pieMeasureLabel ? `<br/><span style="font-size:12px;font-weight:400;color:${labelColor};fill:${labelColor};">${escapeHtml(String(pieMeasureLabel))}</span>` : ''}`,
        align: 'center',
        verticalAlign: 'middle',
        floating: true,
        useHTML: false,
        zIndex: 1,
        y: 26,
      };
      defaultOptions.responsive = {
        rules: [
          { condition: { maxHeight: 180 }, chartOptions: { subtitle: { text: '' } } },
          ...(pieMeasureLabel ? [{ condition: { minHeight: 181, maxHeight: 249 }, chartOptions: { subtitle: { text: totalSpan, y: 18 } } }] : []),
        ],
      };
    }

    const mergeAxisWithBase = (baseAxis, authorAxis, isSecondary = false) => {
      if (!baseAxis || !authorAxis || typeof authorAxis !== 'object') return authorAxis;
      const baseCopy = {
        ...baseAxis,
        title: baseAxis.title ? { ...baseAxis.title, style: { ...(baseAxis.title.style || {}) } } : undefined,
        labels: baseAxis.labels ? { ...baseAxis.labels, style: { ...(baseAxis.labels.style || {}) } } : undefined,
      };
      if (isSecondary) {
        delete baseCopy.min;
        delete baseCopy.max;
        delete baseCopy.softMin;
        delete baseCopy.softMax;
        delete baseCopy.plotLines;
        if (baseCopy.labels) {
          delete baseCopy.labels.formatter;
        }
        if (authorAxis.gridLineWidth === undefined) {
          baseCopy.gridLineWidth = 0;
        }
      } else if (authorAxis.labels?.format && !authorAxis.labels?.formatter && baseCopy.labels) {
        delete baseCopy.labels.formatter;
      }
      const merged = Highcharts.merge(baseCopy, authorAxis);
      if (baseCopy.title && authorAxis.title) {
        merged.title = {
          ...baseCopy.title,
          ...authorAxis.title,
          style: { ...(baseCopy.title.style || {}), ...(authorAxis.title.style || {}) },
        };
      }
      if (baseCopy.labels && authorAxis.labels) {
        merged.labels = {
          ...baseCopy.labels,
          ...authorAxis.labels,
          style: { ...(baseCopy.labels.style || {}), ...(authorAxis.labels.style || {}) },
        };
      }
      if (typeof merged.gridLineColor === 'string' && merged.gridLineColor.includes('var(--')) {
        merged.gridLineColor = rc(merged.gridLineColor);
      }
      if (typeof merged.lineColor === 'string' && merged.lineColor.includes('var(--')) {
        merged.lineColor = rc(merged.lineColor);
      }
      if (typeof merged.tickColor === 'string' && merged.tickColor.includes('var(--')) {
        merged.tickColor = rc(merged.tickColor);
      }
      if (typeof merged.labels?.style?.color === 'string' && merged.labels.style.color.includes('var(--')) {
        merged.labels = {
          ...merged.labels,
          style: { ...merged.labels.style, color: rc(merged.labels.style.color) },
        };
      }
      if (typeof merged.title?.style?.color === 'string' && merged.title.style.color.includes('var(--')) {
        merged.title = {
          ...merged.title,
          style: { ...merged.title.style, color: rc(merged.title.style.color) },
        };
      }
      return merged;
    };

    if (Array.isArray(mergeOptions.yAxis) && defaultOptions.yAxis) {
      defaultOptions.yAxis = mergeOptions.yAxis.map((ax, idx) =>
        mergeAxisWithBase(defaultOptions.yAxis, ax, idx > 0)
      );
      mergeOptions = { ...mergeOptions };
      delete mergeOptions.yAxis;
    } else if (mergeOptions.yAxis && typeof mergeOptions.yAxis === 'object' && defaultOptions.yAxis) {
      defaultOptions.yAxis = mergeAxisWithBase(defaultOptions.yAxis, mergeOptions.yAxis, false);
      mergeOptions = { ...mergeOptions };
      delete mergeOptions.yAxis;
    }

    if (Array.isArray(mergeOptions.xAxis) && defaultOptions.xAxis) {
      defaultOptions.xAxis = mergeOptions.xAxis.map((ax, idx) =>
        mergeAxisWithBase(defaultOptions.xAxis, ax, idx > 0)
      );
      mergeOptions = { ...mergeOptions };
      delete mergeOptions.xAxis;
    } else if (mergeOptions.xAxis && typeof mergeOptions.xAxis === 'object' && defaultOptions.xAxis) {
      defaultOptions.xAxis = mergeAxisWithBase(defaultOptions.xAxis, mergeOptions.xAxis, false);
      mergeOptions = { ...mergeOptions };
      delete mergeOptions.xAxis;
    }

    // Resolve any `var()` colours in the author's `options.colors` before the
    // merge, so a palette-driven `.options=${{ colors: ['var(--brand-red)'] }}`
    // reaches Highcharts as concrete colours rather than raw `var()` strings.
    if (Array.isArray(mergeOptions.colors)) {
      mergeOptions = { ...mergeOptions, colors: mergeOptions.colors.map(rc) };
    }
    mergeOptions = stripAuthorPointClickOptions(mergeOptions);
    const finalOptions = Highcharts.merge(defaultOptions, mergeOptions);
    if (isLineLike && Array.isArray(finalOptions.series)) {
      finalOptions.series.forEach((s, idx) => {
        if (!s || s.marker || this._hasAuthorMarker(idx)) return;
        const pts = Array.isArray(s.data) ? s.data : [];
        const finiteCount = pts.filter(pt => Number.isFinite(typeof pt === 'number' ? pt : (Array.isArray(pt) ? pt[1] : pt?.y))).length;
        if (finiteCount <= 1) s.marker = { enabled: true, radius: 4 };
      });
    }
    return _isRendering ? withoutChartAnimation(finalOptions) : finalOptions;
  }

  render() {
    const displayRows = this.data || this._fetchedRows;
    const isEmpty = !this.loading && !this.error && ((displayRows && displayRows.length === 0) || Boolean(this._noPoints));
    const heightStyle = this.height
      ? (typeof this.height === 'number' || /^\d+$/.test(this.height) ? `${this.height}px` : this.height)
      : null;

    return html`
      <div class="da-chart-card ${this.loading ? 'loading' : ''}" style="position: relative; ${heightStyle ? `height: ${heightStyle}; min-height: ${heightStyle};` : ''}">
        ${this.renderWidgetActions()}
        ${this.title ? html`<div class="chart-header" title=${this.title}>${this.title}</div>` : nothing}
        <div class="chart-container" style="width: 100%; ${heightStyle ? 'min-height: 0; ' : ''}flex: 1; ${isEmpty || this.error ? 'display: none;' : ''}"></div>
        ${this.loading ? renderLoadingSkeleton() : nothing}
        ${isEmpty ? renderEmptyCard('No data returned') : nothing}
        ${this.error ? renderErrorCard({
          error: this.error,
          onRetry: () => this.refresh(),
        }) : nothing}
      </div>
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._trailingResizeTimer) {
      clearTimeout(this._trailingResizeTimer);
      this._trailingResizeTimer = null;
    }
    if (this.yScaleGroup && _yScaleGroups.has(this.yScaleGroup)) {
      const group = _yScaleGroups.get(this.yScaleGroup);
      group.delete(this);
      if (group.size === 0) {
        _yScaleGroups.delete(this.yScaleGroup);
      } else {
        this._syncYScaleGroup();
      }
    }
    if (this._reflowRafId) {
      cancelAnimationFrame(this._reflowRafId);
      this._reflowRafId = null;
    }
    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch {}
      this._resizeObserver = null;
    }
    if (this.chartInstance) {
      try { this.chartInstance.destroy(); } catch {}
      this.chartInstance = null;
    }
  }
}
if (!customElements.get('app-chart')) {
  customElements.define('app-chart', AppChart);
}

/**
 * <app-grid> — Reactive AG-Grid tabular component.
 * 
 * Self-contained table card with sorting, filtering, pagination, LookML dotted key auto-normalization,
 * and custom columnDef pass-through (`cellStyle`, `valueGetter`, `comparator`, `cellRenderer`).
 * 
 * @example
 * ```html
 * <app-grid
 *   explore="orders"
 *   .query=${{
 *     fields: ['orders.id', 'orders.category', 'orders.total_revenue'],
 *     filters: this.getEffectiveFilters(),
 *     sorts: ['orders.total_revenue desc'],
 *     limit: '100'
 *   }}
 *   .columnDefs=${[
 *     { field: 'orders.id', headerName: 'Order ID', width: 120 },
 *     { field: 'orders.category', headerName: 'Category', flex: 1 },
 *     { field: 'orders.total_revenue', headerName: 'Revenue', valueFormat: 'usd', width: 150 }
 *   ]}
 * ></app-grid>
 * ```
 */
export const CUSTOM_COL_DEF_KEYS = ['format', 'colorScale', 'warningThreshold', 'goodThreshold', 'badgeClassMap'];

export function stripCustomColDefProps(colDefs) {
  if (!Array.isArray(colDefs)) return colDefs;
  return colDefs.map(col => {
    if (!col || typeof col !== 'object') return col;
    const clean = { ...col };
    for (const k of CUSTOM_COL_DEF_KEYS) {
      delete clean[k];
    }
    if (Array.isArray(clean.children)) {
      clean.children = stripCustomColDefProps(clean.children);
    }
    return clean;
  });
}

export class AppGrid extends AppWidget {
  static properties = {
    /** Header title string rendered above the table (same contract as `<app-chart>`). */
    title: { type: String },
    /** LookML model name (inherited from parent container if omitted). */
    lookerModel: { type: String, attribute: 'looker-model', reflect: true },
    /** LookML explore name (e.g. `'orders'`). */
    explore: { type: String, reflect: true },
    /** Explicit grid height (e.g. `'440px'`). */
    height: { type: String, reflect: true },
    /** Looker query object `{ fields: [...], filters: {...}, sorts: [...], limit: '100' }`. */
    query: { type: Object },
    /** Comma-separated list of field names. */
    fields: { type: String },
    /** Dynamic filter dictionary passed to Looker query runner. */
    filters: { type: Object },
    /** Sort directives (e.g. `['orders.total_revenue desc']`). */
    sorts: { type: Array },
    /** Row limit (default `'100'`). */
    limit: { type: String },
    /** Array of AG Grid column definitions (supports `cellStyle`, `valueGetter`, `comparator`, `cellRenderer`). */
    columnDefs: { type: Array },
    /** AG Grid options pass-through override object `{ paginationPageSize: 20, rowHeight: 34 }`. */
    gridOptions: { type: Object },
    /** Grid theme mode: `'auto'` | `'quartz'` | `'quartz-dark'`. */
    theme: { type: String },
    /** Pre-computed array of data rows to render directly (bypasses Looker network query). */
    data: { type: Array },
    /** Sample preview rows displayed before first live query completes. */
    sampleData: { type: Array },
    /** Drop the built-in card chrome (background, border, radius, shadow, padding). */
    bare: { type: Boolean, reflect: true },
    /** Opt in to a row count footer beneath the grid. */
    showRowCount: { type: Boolean, attribute: 'show-row-count', reflect: true },
    /** In-flight fetch loading indicator. */
    loading: { type: Boolean },
    /** Query error state. */
    error: { type: Object },
  };

  constructor() {
    super();
    this.theme = 'auto';
    this.gridOptions = null;
    this.loading = false;
    this.error = null;
    this.gridApi = null;
    this.filters = {};
    this.bare = false;
    this.showRowCount = false;
    this._ignoreWhenDataSet = true;
    this._abortController = null;
    this._prevRows = null;
    this._prevColDefs = null;
  }

  connectedCallback() {
    super.connectedCallback();
    if (this._hasRenderedOnce && !this.gridApi && (this.data?.length > 0 || this._fetchedRows?.length > 0)) {
      this._container = this.querySelector('.grid-container');
      this._renderGrid(this.data || this._fetchedRows);
    }
  }

  async firstUpdated() {
    this._hasRenderedOnce = true;
    this._container = this.querySelector('.grid-container');
    if (this.data && this.data.length > 0) {
      this.loading = false;
      this.error = null;
      this._hasRenderError = false;
      this._renderGrid(this.data);
      return;
    }
    this._awaitingFilterGate = true;
    try {
      await whenDashboardFiltersReady();
    } finally {
      this._awaitingFilterGate = false;
    }
    if (this.isConnected === false) return;
    if (this.data && this.data.length > 0) {
      this.loading = false;
      this.error = null;
      this._hasRenderError = false;
      this._renderGrid(this.data);
    } else if (this.explore || this.query?.explore || this.query?.view || resolveParentExplore(this)) {
      this.fetchData();
    }
  }

  updated(changedProps) {
    if (changedProps.has('data')) {
      const prevData = changedProps.get('data');
      const dataChanged = !areDataRowsEqual(prevData, this.data);
      if (Array.isArray(this.data)) {
        if (dataChanged) {
          this._activeFetchId = (this._activeFetchId || 0) + 1;
          this.loading = false;
          this.error = null;
          this._hasRenderError = false;
          this._renderGrid(this.data);
        }
      } else if (this.data == null && (this.explore || this.query?.explore || this.query?.view || resolveParentExplore(this))) {
        if (this.gridApi) {
          this.gridApi.destroy();
          this.gridApi = null;
        }
        this._prevColDefs = null;
        this._prevRows = null;
        this.fetchData();
      }
      return;
    }

    let needsFetch = false;
    if (this._queryInputsChanged(changedProps)) {
      needsFetch = true;
    }
    if (changedProps.has('filters')) {
      const prev = changedProps.get('filters');
      if (!areQueriesEqual(prev, this.filters)) needsFetch = true;
    }
    if (changedProps.has('query')) {
      const prev = changedProps.get('query');
      if (!areQueriesEqual(prev, this.query)) needsFetch = true;
    }

    if (needsFetch) {
      if (!this._awaitingFilterGate) {
        if ((this.explore || this.query?.explore || this.query?.view || resolveParentExplore(this)) && (!this.data || this._forceLive) && !this._usingSample) {
          this.fetchData();
          return;
        }
      }
    }

    const displayRows = this.data || this._fetchedRows;
    if (changedProps.has('columnDefs') || changedProps.has('gridOptions')) {
      if (displayRows && displayRows.length > 0) {
        this._renderGrid(displayRows);
      }
    }
  }

  _skipFetch() {
    return Boolean(this.data && this.data.length > 0 && !this._forceLive);
  }

  // AG Grid can paint rows after createGrid() returns. It signals the first
  // paint with firstDataRendered, dispatched from a requestAnimationFrame that
  // a browser may hold back for an offscreen cross-origin frame such as a tile,
  // so rows already in the DOM count as drawn too.
  _isDrawSettled() {
    if (this.error) return true;
    const rows = this.data || this._fetchedRows;
    if (!Array.isArray(rows)) {
      if (this._skipFetch()) return true;
      const q = this._buildQuery();
      return !q || !q.view;
    }
    if (rows.length === 0) return true;
    if (!this.gridApi) return false;
    return this._gridDataRendered === true
      || Boolean(this._container?.querySelector?.('.ag-row'));
  }

  _buildQuery() {
    const q = this.query || {};
    const fields = this._resolveFields(q, 'fields');
    if (fields.length === 0) return null;
    const query = {
      ...this._resolveTarget(q),
      fields,
      filters: q.filters || this.filters || {},
      limit: q.limit || this.limit || WIDGET_QUERY_DEFAULTS.gridLimit,
    };
    if (q.sorts || this.sorts) query.sorts = q.sorts || this.sorts;
    return query;
  }

  _receiveRows(rows) {
    this._fetchedRows = rows;
    this._renderGrid(rows);
  }

  onThemeChange(isDark) {
    const dark = typeof isDark === 'boolean' ? isDark : isDarkContext(this);
    if (this._container?.classList) {
      this._container.classList.toggle('ag-theme-quartz-dark', dark);
      this._container.classList.toggle('ag-theme-quartz', !dark);
    }
    const card = this.querySelector ? this.querySelector('.da-grid-card') : null;
    if (card?.classList) {
      card.classList.toggle('ag-theme-quartz-dark', dark);
      card.classList.toggle('ag-theme-quartz', !dark);
    }
    this.requestUpdate();
  }

  _buildColDefs(rows) {
    if (!rows || rows.length === 0) return [];
    const normalizedCols = (this.columnDefs || Object.keys(rows[0]).map(k => {
      const sampleRow = rows.find(r => r && r[k] != null && r[k] !== '');
      const isNum = sampleRow ? typeof sampleRow[k] === 'number' : false;
      const isPrice = k.includes('price') || k.includes('revenue') || k.includes('amount');
      const def = {
        field: k,
        filter: true,
        resizable: true,
        flex: 1,
        valueGetter: (params) => params.data ? params.data[k] : '',
        valueFormatter: (params) => {
          if (params.value == null || params.value === '') return '—';
          if (isPrice && typeof params.value === 'number') {
            return '$' + params.value.toFixed(2);
          }
          if (typeof params.value === 'number' && Number.isFinite(params.value) && !Number.isInteger(params.value)) {
            return Number(params.value.toFixed(2));
          }
          return params.value;
        }
      };
      if (isNum) {
        def.type = 'rightAligned';
      }
      return def;
    })).map(col => {
      const normalized = { ...col };
      const fieldKey = normalized.field || normalized.colId;
      if (fieldKey && fieldKey.includes('.') && !normalized.valueGetter) {
        normalized.valueGetter = (params) => params.data ? params.data[fieldKey] : '';
      }
      const sampleRow = fieldKey ? rows.find(r => r && r[fieldKey] != null && r[fieldKey] !== '') : null;
      const isNumericCol = Boolean(
        (normalized.valueFormat && NUMERIC_FORMATS.has(normalized.valueFormat)) ||
        (sampleRow && typeof sampleRow[fieldKey] === 'number')
      );
      if (isNumericCol && normalized.type == null) {
        normalized.type = 'rightAligned';
      }
      if (normalized.valueFormat && !normalized.valueFormatter) {
        const colVals = fieldKey ? rows.map(r => parsePointValue(r?.[fieldKey], true)) : [];
        const fmt = resolvePercentFormat(normalized.valueFormat, colVals);
        normalized.format = fmt;
        normalized.valueFormatter = (params) => formatValue(params.value, fmt);
      } else if (normalized.format === 'percent' && fieldKey && (String(normalized.valueFormatter) === 'params => formatValue(params.value, format)' || String(normalized.valueFormatter).includes('formatValue(params.value, format)'))) {
        const colVals = rows.map(r => parsePointValue(r?.[fieldKey], true));
        const fmt = resolvePercentFormat('percent', colVals);
        normalized.format = fmt;
        normalized.valueFormatter = (params) => formatValue(params.value, fmt);
        if (normalized.colorScale && typeof normalized.cellStyle === 'function' && String(normalized.cellStyle).includes('warningThreshold')) {
          normalized.cellStyle = createPercentageCol({ ...normalized, format: fmt, cellStyle: undefined }).cellStyle;
        }
      } else if (!normalized.valueFormatter) {
        normalized.valueFormatter = (params) => {
          if (params.value == null || params.value === '') return '';
          if (typeof params.value === 'number' && Number.isFinite(params.value) && !Number.isInteger(params.value)) {
            return Number(params.value.toFixed(2));
          }
          return params.value;
        };
      }
      delete normalized.valueFormat;
      if (normalized.flex == null && normalized.width == null) {
        normalized.flex = 1;
      }
      return normalized;
    });

    return normalizedCols;
  }

  _renderGrid(rows) {
    if (!this._container) return;
    if (!window.agGrid) {
      this._handleVendorUnavailable('AG Grid', () => {
        this._renderGrid(this.data || this._fetchedRows);
      }, { tag: this.tagName ? this.tagName.toLowerCase() : 'app-grid', label: this.title || '', gridOptions: this.gridOptions || {} });
      return;
    }

    if (!this._container) {
      this._container = this.querySelector('.grid-container');
    }
    if (!this._container) return;

    if (!rows || rows.length === 0) {
      if (this.gridApi) {
        this.gridApi.destroy();
        this.gridApi = null;
      }
      this._prevColDefs = null;
      this._prevRows = null;
      this._container.innerHTML = '';
      if (this._hasRenderError) {
        this._hasRenderError = false;
        this.error = null;
        this.requestUpdate();
      }
      return;
    }

    let gridOptions;
    try {
      const colDefs = this._buildColDefs(rows);

      if (this.gridApi) {
        const sameRows = rows === this._prevRows;
        const sameCols = areColumnDefsEqual(colDefs, this._prevColDefs);
        if (typeof this.gridApi.setGridOption === 'function') {
          if (!sameCols) {
            const cleanColDefs = stripCustomColDefProps(colDefs);
            this.gridApi.setGridOption('columnDefs', cleanColDefs);
          }
          if (!sameRows) this.gridApi.setGridOption('rowData', rows);
        } else {
          if (!sameCols && typeof this.gridApi.setColumnDefs === 'function') {
            const cleanColDefs = stripCustomColDefProps(colDefs);
            this.gridApi.setColumnDefs(cleanColDefs);
          }
          if (!sameRows && typeof this.gridApi.setRowData === 'function') this.gridApi.setRowData(rows);
        }
        this._prevRows = rows;
        this._prevColDefs = colDefs;
        // Clear any prior render/vendor error on successful in-place grid update
        if (this._hasRenderError) {
          this._hasRenderError = false;
          this.error = null;
          this.requestUpdate();
        }
        return;
      }

      this._prevRows = rows;
      this._prevColDefs = colDefs;
      const cleanColDefs = stripCustomColDefProps(colDefs);
      const userOnRowClicked = this.gridOptions?.onRowClicked;
      const userOnFirstDataRendered = this.gridOptions?.onFirstDataRendered;
      gridOptions = {
        columnDefs: cleanColDefs,
        rowData: rows,
        // Looker's compact rows. Keep in step with --ag-row-height and
        // --ag-header-height in data-app.css: AG Grid measures those in a probe
        // attached to document.body, outside `app-grid`, so it never sees ours.
        rowHeight: 26,
        headerHeight: 26,
        // The card always has a definite height (`height=`, else 440px) and clips
        // its overflow, so the grid must fill that box and scroll inside it.
        // `domLayout: 'autoHeight'` grows to fit its rows instead, which pushed
        // the last rows out under `overflow: hidden` — a table that looked
        // truncated with no way to scroll. Authors who want the card to grow can
        // still pass `.gridOptions=${{ domLayout: 'autoHeight' }}`; the spread below wins.
        domLayout: 'normal',
        pagination: false,
        paginationPageSize: 10,
        paginationPageSizeSelector: [10, 20, 50, 100],
        ...(this.gridOptions || {}),
        // After the author's options, so a PDF never captures rows mid-slide.
        ...(_isRendering ? { animateRows: false } : {}),
        onRowClicked: (e) => {
          if (typeof userOnRowClicked === 'function') {
            try {
              userOnRowClicked(e);
            } catch (err) {
              const tag = this.tagName ? this.tagName.toLowerCase() : 'app-grid';
              reportRuntimeError(`<${tag}> onRowClicked failed`, err, { tag, label: this.title || '' });
            }
          }
          if (e?.data) {
            this.dispatchEvent(new CustomEvent('app-grid-row-click', {
              detail: { row: e.data, rowIndex: e.rowIndex, mouseEvent: e.event },
              bubbles: true,
              composed: true,
            }));
          }
        },
        onFirstDataRendered: (e) => {
          this._gridDataRendered = true;
          if (typeof userOnFirstDataRendered === 'function') {
            userOnFirstDataRendered(e);
          }
        },
      };

      if (typeof agGrid === 'undefined' || !agGrid || typeof agGrid.createGrid !== 'function') {
        throw new Error('AG Grid vendor bundle is not available');
      }
      if (this._hasRenderError && this._container?.style) {
        this._container.style.display = '';
      }
      this._gridDataRendered = false;
      this.gridApi = agGrid.createGrid(this._container, gridOptions);
      // Clear any prior render/vendor error on successful grid instantiation
      if (this._hasRenderError) {
        this._hasRenderError = false;
        this.error = null;
        this.requestUpdate();
      }
    } catch (err) {
      if (this.gridApi) {
        try { this.gridApi.destroy(); } catch {}
        this.gridApi = null;
      }
      this._prevRows = null;
      this._prevColDefs = null;
      this.error = err;
      this._hasRenderError = true;
      const tag = this.tagName ? this.tagName.toLowerCase() : 'app-grid';
      reportRuntimeError(`<${tag}> AG Grid render failed`, err,
        { tag, label: this.title || '', gridOptions });
      this.requestUpdate();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.gridApi) {
      try { this.gridApi.destroy(); } catch {}
      this.gridApi = null;
    }
    this._prevColDefs = null;
    this._prevRows = null;
  }

  _getFooterText(displayRows) {
    if (!displayRows || displayRows.length === 0) return null;
    const count = displayRows.length;
    if (!this.data && this._fetchedRows) {
      const limitVal = this._lastFetchedQuery?.limit ?? this.query?.limit ?? this.limit;
      if (limitVal != null) {
        const limitNum = Number(limitVal);
        if (!isNaN(limitNum) && limitNum > 0 && count === limitNum) {
          return `Showing first ${count.toLocaleString()} rows`;
        }
      }
    }
    return `${count.toLocaleString()} ${count === 1 ? 'row' : 'rows'}`;
  }

  render() {
    const displayRows = this.data || this._fetchedRows;
    const isEmpty = !this.loading && !this.error && displayRows && displayRows.length === 0;

    const isDark = isDarkContext(this);

    const heightVal = this.height
      ? (typeof this.height === 'number' || /^\d+$/.test(this.height) ? `${this.height}px` : this.height)
      : '440px';

    const hasPagination = Boolean(this.gridOptions?.pagination);
    const showFooter = Boolean(this.showRowCount) && !hasPagination && !this.loading && !this.error && displayRows && displayRows.length > 0;
    const footerText = showFooter ? this._getFooterText(displayRows) : null;

    // With a header or footer the table can no longer be `heightVal` tall inside a
    // `heightVal` card — it would overflow. Let it flex-fill instead.
    // Untitled/unfootered grids keep the original geometry exactly.
    const containerBox = (this.title || showFooter)
      ? 'min-height: 0; flex: 1;'
      : `min-height: ${heightVal}; height: 100%;`;

    return html`
      <div class="da-grid-card ${isDark ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'} ${this.loading ? 'loading' : ''}" style="position: relative; width: 100%; min-height: ${heightVal}; height: ${heightVal};">
        ${this.renderWidgetActions()}
        ${this.title ? html`<div class="chart-header" title=${this.title}>${this.title}</div>` : nothing}
        <div class="grid-container ${isDark ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'}" style="position: relative; width: 100%; ${containerBox} ${isEmpty || this.error ? 'display: none;' : ''}"></div>
        ${showFooter ? html`<div class="da-grid-footer">${footerText}</div>` : nothing}
        ${this.loading ? renderGridLoadingSkeleton() : nothing}
        ${isEmpty ? renderEmptyCard('No rows found') : nothing}
        ${this.error ? renderErrorCard({
          error: this.error,
          onRetry: () => this.refresh(),
        }) : nothing}
      </div>
    `;
  }
}
if (!customElements.get('app-grid')) {
  customElements.define('app-grid', AppGrid);
}

/**
 * <app-select> - Standardized reactive filter dropdown
 */
export class AppSelect extends LitElement {
  static properties = {
    label: { type: String },
    value: { type: String },
    options: { type: Array },
    placeholder: { type: String },
    disabled: { type: Boolean },
    theme: { type: String },
  };

  constructor() {
    super();
    this.label = '';
    this.value = '';
    this.options = [];
    this.placeholder = '';
    this.disabled = false;
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    _watchTheme(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    _unwatchTheme(this);
  }

  onThemeChange() {
    this.requestUpdate();
  }

  _handleChange(e) {
    const newVal = e.target.value;
    this.value = newVal;
    // We render into Light DOM, so the inner <select>'s own `change` would
    // bubble to this host too — an author's `@change` would fire twice, the
    // second time with no `detail` (a TypeError on `e.detail.value`). Stop the
    // native event here so the host emits exactly one `change`, always with
    // `detail`.
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('change', {
      detail: { value: newVal },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    const rawOpts = this.options || [];
    const hasExplicitPlaceholder = Boolean(this.placeholder && this.placeholder.trim() !== '');
    const fallbackEmptyLabel = hasExplicitPlaceholder ? this.placeholder : 'any value';
    const isUnfilteredVal = (v) => {
      const s = String(v ?? '').trim().toLowerCase();
      return s === '' || s === 'all' || s === 'any value' || s === 'any' || (hasExplicitPlaceholder && s === this.placeholder.trim().toLowerCase());
    };

    const normalized = rawOpts.map(opt => {
      if (typeof opt === 'object' && opt !== null) {
        const val = String(opt.value ?? '');
        const rawLabel = opt.label != null && opt.label !== '' ? String(opt.label) : (val === '' ? fallbackEmptyLabel : val);
        return { label: rawLabel, value: val };
      }
      const val = String(opt);
      const label = val === '' ? fallbackEmptyLabel : val;
      return { label, value: val };
    });

    if (hasExplicitPlaceholder && normalized.length > 0 && !normalized.some(o => isUnfilteredVal(o.value))) {
      normalized.unshift({ label: this.placeholder, value: '' });
    }

    const currentVal = String(this.value ?? '');
    const isActive = !isUnfilteredVal(currentVal);

    return html`
      <div class="da-select-wrap ${this.theme === 'dark' ? 'dark-theme' : ''}">
        ${this.label ? html`<label class="da-select-label">${this.label}</label>` : nothing}
        <select
          class="da-select"
          aria-label=${this.label || nothing}
          data-active=${isActive ? 'true' : 'false'}
          .value=${currentVal}
          ?disabled=${this.disabled}
          @change=${this._handleChange}
        >
          ${normalized.map(opt => html`
            <option value=${opt.value} ?selected=${opt.value === currentVal || (isUnfilteredVal(opt.value) && isUnfilteredVal(currentVal))}>
              ${opt.label}
            </option>
          `)}
        </select>
      </div>
    `;
  }
}
if (!customElements.get('app-select')) {
  customElements.define('app-select', AppSelect);
}

/**
 * Convenience Column Definition Factory Helpers for <app-grid>
 */
export function createPercentageCol(options = {}) {
  const opts = options || {};
  const { field, headerName, cellStyle, ...rest } = opts;
  const format = opts.format || 'percent';
  const colorScale = Boolean(opts.colorScale);
  const warningThreshold = opts.warningThreshold ?? 0.60;
  const goodThreshold = opts.goodThreshold ?? 0.80;
  const widthProps = opts.width != null
    ? { width: opts.width }
    : { flex: opts.flex ?? 1, minWidth: opts.minWidth ?? 140 };
  return {
    headerName,
    field,
    ...widthProps,
    type: opts.type ?? 'rightAligned',
    sortable: opts.sortable ?? true,
    filter: opts.filter ?? true,
    format,
    colorScale,
    warningThreshold,
    goodThreshold,
    valueFormatter: params => formatValue(params.value, format),
    cellStyle: cellStyle !== undefined ? cellStyle : (params => {
      if (colorScale && params.value != null) {
        const rawVal = parsePointValue(params.value, true);
        if (rawVal === null) return null;
        const isPct100 = warningThreshold <= 1 && goodThreshold <= 1 && (format === 'percent-100' || format === 'percent100' || (format === 'percent' && Math.abs(rawVal) > 1));
        const val = isPct100 ? rawVal / 100 : rawVal;
        if (val < warningThreshold) return { color: '#ef4444', fontWeight: '600' };
        if (val < goodThreshold) return { color: '#f59e0b', fontWeight: '600' };
        return { color: '#10b981', fontWeight: '600' };
      }
      return null;
    }),
    ...rest,
  };
}

export function createNumericCol(options = {}) {
  const opts = options || {};
  const { field, headerName, ...rest } = opts;
  const format = opts.format || 'int';
  const widthProps = opts.width != null
    ? { width: opts.width }
    : { flex: opts.flex ?? 1, minWidth: opts.minWidth ?? 120 };
  return {
    headerName,
    field,
    ...widthProps,
    type: opts.type ?? 'rightAligned',
    sortable: opts.sortable ?? true,
    filter: opts.filter ?? true,
    format,
    valueFormatter: params => formatValue(params.value, format),
    ...rest,
  };
}

export function createCurrencyCol(options = {}) {
  const opts = options || {};
  const { field, headerName, ...rest } = opts;
  const format = opts.format || 'usd';
  const widthProps = opts.width != null
    ? { width: opts.width }
    : { flex: opts.flex ?? 1, minWidth: opts.minWidth ?? 130 };
  return {
    headerName,
    field,
    ...widthProps,
    type: opts.type ?? 'rightAligned',
    sortable: opts.sortable ?? true,
    filter: opts.filter ?? true,
    format,
    valueFormatter: params => formatValue(params.value, format),
    ...rest,
  };
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createBadgeCol(options = {}) {
  const opts = options || {};
  const { field, headerName, ...rest } = opts;
  const badgeClassMap = opts.badgeClassMap;
  const widthProps = opts.width != null
    ? { width: opts.width }
    : { flex: opts.flex ?? 1, minWidth: opts.minWidth ?? 140 };
  return {
    headerName,
    field,
    ...widthProps,
    sortable: opts.sortable ?? true,
    filter: opts.filter ?? true,
    badgeClassMap,
    cellRenderer: params => {
      if (params.value == null || params.value === '') return '';
      const rawStr = String(params.value);
      const safeVal = escapeHtml(rawStr);
      const rawClass = badgeClassMap?.[rawStr] || 'badge-neutral';
      const safeClass = escapeHtml(rawClass);
      return `<span class="da-grid-badge ${safeClass}">${safeVal}</span>`;
    },
    ...rest,
  };
}
