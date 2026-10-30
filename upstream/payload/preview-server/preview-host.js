import { LitElement, html, nothing } from '../vendor/lit/3.3.1/lit.mjs';

export const FEEDBACK_FORM_URL = 'https://forms.gle/eQPBo8biwdkG2HiVA';

export const GALLERY_VIEW_STORAGE_KEY = 'dataAppsGalleryView';

/* ==========================================================================
   Preview Host Styles
   ========================================================================== */

const PREVIEW_HOST_STYLES = `
  body {
    margin: 0;
    padding: 0;
    font-family: 'Google Sans Text', 'Noto Sans', 'Noto Sans JP', 'Noto Sans CJK KR', 'Noto Sans Arabic UI', 'Noto Sans Devanagari UI', 'Noto Sans Hebrew', 'Noto Sans Thai UI', Helvetica, Arial, sans-serif;
    background: var(--app-bg, #ffffff);
    color: #0f172a;
    min-height: 100vh;
  }

  /* Floating Preview Dock at bottom-right (avoids colliding with dashboard header/tabs) */
  .gallery-nav-bar {
    position: fixed;
    bottom: 16px;
    right: 18px;
    z-index: 99999;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .gallery-back-pill {
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(8px);
    color: #f8fafc;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 14px;
    border-radius: 20px;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.12);
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .gallery-back-pill:hover {
    background: #4f46e5;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(79, 70, 229, 0.4);
  }

  /* Device Viewport Presets in Floating Dock */
  .gallery-vp-group {
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 20px;
    padding: 3px 4px;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  }

  .gallery-vp-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 11.5px;
    font-weight: 600;
    padding: 4px 9px;
    border-radius: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.15s ease;
    text-decoration: none;
    font-family: inherit;
  }
  .gallery-vp-btn:hover {
    color: #f8fafc;
    background: rgba(255, 255, 255, 0.08);
  }
  .gallery-vp-btn.active {
    background: #6366f1;
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
  }

  #app-root.vp-device-mode {
    box-shadow: 0 0 32px rgba(0, 0, 0, 0.15);
    border-left: 1px solid #cbd5e1;
    border-right: 1px solid #cbd5e1;
    min-height: 100vh;
    background: var(--app-bg, #ffffff);
    overflow-x: hidden;
    box-sizing: border-box;
    width: 100%;
    transition: max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease;
  }
  #app-root.vp-device-mode .da-container {
    max-width: 100%;
    box-sizing: border-box;
    overflow-x: hidden;
  }
  #canvas-sandbox-frame {
    box-sizing: border-box;
  }
  body.dark-theme #app-root.vp-device-mode {
    box-shadow: 0 0 32px rgba(0, 0, 0, 0.4);
    border-left-color: #334155;
    border-right-color: #334155;
  }

  /* Sandbox Status Badge */
  .sandbox-badge {
    position: fixed;
    bottom: 16px;
    left: 18px;
    z-index: 9999;
    background: #0f172a;
    color: #f8fafc;
    font: 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 6px 14px;
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid #334155;
  }
  .sandbox-badge-title {
    color: #34d399;
    font-weight: bold;
  }
  .sandbox-badge-desc {
    color: #94a3b8;
  }

  /* Sandbox Error Banner Box */
  #sandbox-error-box {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 64px;
    z-index: 99998;
    background: #7f1d1d;
    color: #fee2e2;
    font: 12px/1.5 ui-monospace, Menlo, monospace;
    padding: 12px 14px;
    border-radius: 10px;
    max-height: 38vh;
    overflow: auto;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .sandbox-err-line {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 0;
  }
  .sandbox-err-msg {
    flex: 1;
    word-break: break-word;
  }
  .sandbox-err-close {
    background: none;
    border: none;
    color: #fee2e2;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 4px;
    opacity: 0.75;
    flex-shrink: 0;
    user-select: none;
    transition: opacity 0.15s ease;
  }
  .sandbox-err-close:hover,
  .sandbox-err-close:focus-visible {
    opacity: 1;
  }

  /* Preview App Load Error Card */
  .preview-load-error {
    max-width: 600px;
    margin: 60px auto;
    padding: 24px;
    background: #fee2e2;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #991b1b;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }
  .preview-load-error h3 {
    margin-top: 0;
  }
  .preview-load-error pre {
    background: rgba(0, 0, 0, 0.05);
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
  }
  .preview-load-error-actions {
    margin-top: 16px;
  }
  .preview-load-error-actions a {
    color: #4f46e5;
    font-weight: 600;
    text-decoration: none;
  }
  .preview-load-error-actions a:hover {
    text-decoration: underline;
  }

  /* Gallery Hub Layout */
  .gallery-container {
    max-width: 1160px;
    margin: 0 auto;
    padding: 40px 24px 80px 24px;
    box-sizing: border-box;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .gallery-header {
    margin-bottom: 36px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 20px;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 24px;
  }

  .gallery-title-wrap h1 {
    font-size: 28px;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 6px 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .gallery-title-wrap p {
    font-size: 14.5px;
    color: #64748b;
    margin: 0;
  }

  .gallery-header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .gallery-view-toggle {
    display: inline-flex;
    align-items: center;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    padding: 3px;
    gap: 2px;
  }

  .gallery-view-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 11px;
    border-radius: 7px;
    border: none;
    background: transparent;
    color: #64748b;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .gallery-view-btn:hover {
    color: #0f172a;
  }
  .gallery-view-btn.active {
    background: #ffffff;
    color: #4f46e5;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
  }

  .gallery-feedback-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 15px;
    border-radius: 10px;
    background: #4f46e5;
    color: #ffffff;
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.2;
    text-decoration: none;
    border: 1px solid #4338ca;
    box-shadow: 0 2px 6px rgba(79, 70, 229, 0.25);
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .gallery-feedback-btn:hover {
    background: #4338ca;
    border-color: #3730a3;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
  }

  .gallery-search-wrap {
    position: relative;
    width: 280px;
  }

  .gallery-search-input {
    width: 100%;
    padding: 10px 14px 10px 36px;
    border-radius: 10px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    font-size: 13.5px;
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .gallery-search-input:focus {
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
  }
  .gallery-search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 14px;
    color: #94a3b8;
    pointer-events: none;
  }

  /* Section Styling */
  .gallery-section {
    margin-bottom: 40px;
  }

  .gallery-section-title {
    font-size: 17px;
    font-weight: 700;
    color: #1e293b;
    margin: 0 0 16px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .gallery-section-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 12px;
    background: #e2e8f0;
    color: #475569;
  }

  /* Card Grid */
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 20px;
  }

  .gallery-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 20px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    text-decoration: none;
    color: inherit;
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }

  .gallery-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 24px -4px rgba(0, 0, 0, 0.08);
    border-color: #cbd5e1;
  }

  .gallery-card-top {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    margin-bottom: 12px;
  }

  .gallery-card-icon {
    width: 44px;
    height: 44px;
    min-width: 44px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    flex: 0 0 auto;
  }

  .gallery-card-meta {
    flex: 1;
    min-width: 0;
  }

  .gallery-card-title {
    font-size: 16px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 3px 0;
    line-height: 1.3;
  }

  .gallery-card-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11.5px;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gallery-card-time {
    font-size: 11px;
    font-weight: 500;
    color: #94a3b8;
    margin-top: 4px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .gallery-card-desc {
    font-size: 13px;
    color: #475569;
    line-height: 1.5;
    margin: 0 0 18px 0;
    flex: 1;
  }

  .gallery-card-link {
    text-decoration: none;
    color: inherit;
    display: block;
  }

  .gallery-card-action {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    padding-top: 14px;
    border-top: 1px solid #f1f5f9;
    font-size: 12.5px;
    font-weight: 600;
    color: #6366f1;
  }

  .gallery-card:hover .gallery-card-action {
    color: #4f46e5;
  }

  .gallery-card-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  /* List View Variant */
  .gallery-grid.list-view {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .gallery-grid.list-view .gallery-card {
    flex-direction: row;
    align-items: center;
    padding: 14px 18px;
    gap: 16px;
  }

  .gallery-grid.list-view .gallery-card-link {
    display: flex;
    align-items: center;
    gap: 20px;
    flex: 1;
    min-width: 0;
  }

  .gallery-grid.list-view .gallery-card-top {
    margin-bottom: 0;
    align-items: center;
    flex: 0 1 320px;
    min-width: 0;
  }

  .gallery-grid.list-view .gallery-card-title {
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gallery-grid.list-view .gallery-card-desc {
    margin: 0;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .gallery-grid.list-view .gallery-card-action {
    padding-top: 0;
    border-top: none;
    flex-shrink: 0;
  }

  @media (max-width: 680px) {
    .gallery-grid.list-view .gallery-card-link {
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .gallery-grid.list-view .gallery-card-top {
      flex: 1 1 auto;
      width: 100%;
    }
  }

  .empty-state {
    padding: 32px;
    text-align: center;
    background: #ffffff;
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
    color: #64748b;
    font-size: 13.5px;
    grid-column: 1 / -1;
  }

  .preview-loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .preview-loading-halo {
    position: relative;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview-loading-halo::before {
    content: "";
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(99, 102, 241, 0.35) 0%, rgba(99, 102, 241, 0) 72%);
    animation: halo-pulse 2s ease-in-out infinite alternate;
  }

  .preview-loading-halo::after {
    content: "";
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid rgba(99, 102, 241, 0.18);
    border-top-color: #6366f1;
    border-right-color: #818cf8;
    animation: halo-spin 0.85s cubic-bezier(0.4, 0.1, 0.2, 1) infinite;
    box-shadow: 0 0 14px rgba(99, 102, 241, 0.4);
  }

  @keyframes halo-pulse {
    0% { transform: scale(0.88); opacity: 0.4; }
    100% { transform: scale(1.3); opacity: 0.95; }
  }

  @keyframes halo-spin {
    to { transform: rotate(360deg); }
  }

  .preview-loading-text {
    font-size: 13.5px;
    font-weight: 500;
    letter-spacing: 0.01em;
    color: #64748b;
    animation: halo-fade 2s ease-in-out infinite alternate;
  }

  .dark-theme .preview-loading-text {
    color: #94a3b8;
  }

  @keyframes halo-fade {
    0% { opacity: 0.75; }
    100% { opacity: 1; }
  }
  preview-host {
    display: block;
    min-height: 100vh;
  }
`;

function injectStyles() {
  if (typeof document === "undefined" || document.getElementById("preview-host-styles")) return;
  const style = document.createElement("style");
  style.id = "preview-host-styles";
  style.textContent = PREVIEW_HOST_STYLES;
  document.head.appendChild(style);
}

if (typeof document !== "undefined") {
  injectStyles();
}

function formatTimeAgo(epochSec, action = 'Updated') {
  if (!epochSec) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - epochSec);
  if (diff < 60) return `${action} just now`;
  if (diff < 3600) return `${action} ${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${action} ${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return `${action} yesterday`;
  if (days < 30) return `${action} ${days}d ago`;
  const d = new Date(epochSec * 1000);
  return `${action} ${d.toLocaleDateString()}`;
}

export class PreviewHost extends LitElement {
  createRenderRoot() {
    return this; // Light DOM by contract so head styles cascade in
  }

  static properties = {
    appsData: { state: true },
    searchQuery: { state: true },
    viewMode: { state: true },
    currentViewport: { state: true },
    sandboxErrors: { state: true },
    rawApp: { state: true },
    isSandboxed: { state: true },
    galleryError: { state: true },
  };

  constructor() {
    super();
    this.appsData = null;
    this.searchQuery = '';
    this.viewMode = 'grid';
    try {
      if (globalThis.localStorage?.getItem(GALLERY_VIEW_STORAGE_KEY) === 'list') this.viewMode = 'list';
    } catch (_) {}
    this.currentViewport = '100%';
    this.sandboxErrors = [];
    this.rawApp = null;
    this.isSandboxed = false;
    this.galleryError = null;
    this._errSeq = 0;
    this._mountId = 0;
    this._activeApp = null;
    this._sandboxBridge = null;
    this._sandboxErrorListener = null;
    this._sandboxMounted = false;
    this._resizeObserver = null;
  }

  setViewMode(mode) {
    this.viewMode = mode === 'list' ? 'list' : 'grid';
    try { globalThis.localStorage?.setItem(GALLERY_VIEW_STORAGE_KEY, this.viewMode); } catch (_) {}
  }

  // verify-app.py reads data-content-height to size its full-page screenshot.
  _updateContentHeight() {
    this.writeDiagnosticsNode();
  }

  connectedCallback() {
    injectStyles();
    super.connectedCallback();
    this._onPopState = () => this.handleRoute();
    window.addEventListener('popstate', this._onPopState);

    this._onMessage = (e) => {
      if (e.data && e.data.type === 'canvas-theme') {
        const isDark = e.data.theme === 'dark-theme';
        document.documentElement.classList.toggle('dark-theme', isDark);
        document.body.classList.toggle('dark-theme', isDark);
        document.body.style.background = isDark ? 'var(--app-bg, #0b0f19)' : '';
      }
    };
    window.addEventListener('message', this._onMessage);

    this._onLinkClick = (e) => {
      const link = e.target.closest('a[href^="?"], a.gallery-back-pill, a[href="' + window.location.pathname + '"]');
      if (link && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const targetHref = link.getAttribute('href');
        history.pushState({}, '', targetHref);
        this.handleRoute();
      }
    };
    document.addEventListener('click', this._onLinkClick);

    if (typeof ResizeObserver !== 'undefined' && document.body) {
      this._resizeObserver = new ResizeObserver(() => {
        this._updateContentHeight();
      });
      this._resizeObserver.observe(document.body);
    }

    this.handleRoute();
  }

  teardownSandboxBridge() {
    if (this._sandboxPendingQueries) {
      for (const controller of this._sandboxPendingQueries.values()) {
        try { controller.abort(); } catch (_) {}
      }
      this._sandboxPendingQueries.clear();
      this._sandboxPendingQueries = null;
    }
    if (this._sandboxBridge) {
      window.removeEventListener('message', this._sandboxBridge);
      this._sandboxBridge = null;
    }
    if (this._sandboxErrorListener) {
      window.removeEventListener('message', this._sandboxErrorListener);
      this._sandboxErrorListener = null;
    }
    if (this._diagnosticsMessageListener) {
      window.removeEventListener('message', this._diagnosticsMessageListener);
      this._diagnosticsMessageListener = null;
    }
    if (this._inspectWindowErrorListener) {
      window.removeEventListener('error', this._inspectWindowErrorListener);
      this._inspectWindowErrorListener = null;
    }
    if (this._inspectUnhandledRejectionListener) {
      window.removeEventListener('unhandledrejection', this._inspectUnhandledRejectionListener);
      this._inspectUnhandledRejectionListener = null;
    }
  }

  disconnectedCallback() {
    this._mountId++;
    super.disconnectedCallback();
    window.removeEventListener('popstate', this._onPopState);
    window.removeEventListener('message', this._onMessage);
    document.removeEventListener('click', this._onLinkClick);
    this.teardownSandboxBridge();
    if (this._themeObserver) {
      this._themeObserver.disconnect();
      this._themeObserver = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  dismissError(id) {
    this.sandboxErrors = this.sandboxErrors.filter(e => e.id !== id);
    this.writeDiagnosticsNode();
  }

  writeDiagnosticsNode() {
    let node = document.getElementById('preview-diagnostics');
    if (!node) {
      node = document.createElement('div');
      node.id = 'preview-diagnostics';
      node.style.display = 'none';
      document.body.appendChild(node);
    }
    node.setAttribute('data-error-count', String(this.sandboxErrors.length));
    const height = Math.ceil(document.documentElement.scrollHeight);
    node.setAttribute('data-content-height', String(height));
    // verify-app.py reads these attributes to know whether the sandboxed app finished loading.
    if (this.isSandboxed && this.rawApp) {
      node.setAttribute('data-sandbox-mounted', this._sandboxMounted ? '1' : '0');
      node.setAttribute('data-sandbox-pending', String(this._sandboxPendingQueries ? this._sandboxPendingQueries.size : 0));
    } else {
      node.removeAttribute('data-sandbox-mounted');
      node.removeAttribute('data-sandbox-pending');
    }
    node.textContent = JSON.stringify(this.sandboxErrors);
  }

  addSandboxError(kind, message) {
    this.sandboxErrors = [...this.sandboxErrors, { id: ++this._errSeq, kind, message }];
    this.writeDiagnosticsNode();
  }

  applyViewport(width) {
    this.currentViewport = width;
    const isFull = width === '100%';
    const iframe = this.querySelector('#canvas-sandbox-frame');
    const appRoot = this.querySelector('#app-root');

    if (iframe) {
      iframe.style.maxWidth = isFull ? '100%' : width;
      iframe.style.marginLeft = 'auto';
      iframe.style.marginRight = 'auto';
      iframe.style.boxShadow = isFull ? 'none' : '0 0 32px rgba(0, 0, 0, 0.15)';
      iframe.style.borderLeft = isFull ? 'none' : '1px solid rgba(148, 163, 184, 0.3)';
      iframe.style.borderRight = isFull ? 'none' : '1px solid rgba(148, 163, 184, 0.3)';
      iframe.style.boxSizing = 'border-box';
      if (iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ __canvasViewport: true, isDeviceMode: !isFull }, '*');
        } catch (e) {}
      }
    }

    if (appRoot) {
      if (isFull) {
        appRoot.style.maxWidth = '';
        appRoot.style.marginLeft = '';
        appRoot.style.marginRight = '';
        appRoot.style.overflowX = '';
        appRoot.classList.remove('vp-device-mode');
      } else {
        appRoot.style.maxWidth = width;
        appRoot.style.marginLeft = 'auto';
        appRoot.style.marginRight = 'auto';
        appRoot.style.overflowX = 'hidden';
        appRoot.classList.add('vp-device-mode');
      }
    }

    window.dispatchEvent(new Event('resize'));
  }

  async loadAppsData() {
    if (this.appsData) return;
    try {
      const res = await fetch('/api/apps');
      if (res.ok) {
        const data = await res.json();
        data.my_apps = data.my_apps || [];
        data.examples = data.examples || [];
        data.evals = data.evals || [];
        if (data.my_apps) data.my_apps.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
        if (data.evals) data.evals.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
        if (data.examples) data.examples.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
        this.appsData = data;
      } else {
        this.galleryError = `The preview server returned ${res.status} for /api/apps.`;
      }
    } catch (e) {
      this.galleryError = e && e.message ? e.message : 'The preview server is not reachable.';
    }
  }

  async handleRoute() {
    const params = new URLSearchParams(window.location.search);
    const rawApp = params.get('app') || params.get('path');
    const isInspectable = params.get('inspect') === '1' || params.get('inspect') === 'true';
    const isSandboxed = !isInspectable;

    if (this._themeObserver) {
      this._themeObserver.disconnect();
      this._themeObserver = null;
    }

    this.rawApp = rawApp;
    this.isSandboxed = isSandboxed;
    this.sandboxErrors = [];
    this.galleryError = null;

    if (!rawApp) {
      this._activeApp = null;
      this.teardownSandboxBridge();
      document.body.classList.remove('dark-theme');
      document.documentElement.classList.remove('dark-theme');
      document.body.style.background = '';
      document.title = 'Data Apps Gallery';
      this.currentViewport = '100%';
      this.applyViewport('100%');
      const topCssLink = document.head.querySelector('link[href*="data-app.css"]');
      if (topCssLink) topCssLink.href = '/runtime/data-app.css';

      await this.loadAppsData();
      return;
    }

    await this.updateComplete;
    this.mountApp();
  }

  async mountApp() {
    const mountId = ++this._mountId;
    const appRoot = this.querySelector('#app-root');
    if (!appRoot) return;

    this.sandboxErrors = [];
    this._sandboxMounted = false;
    this.writeDiagnosticsNode();

    if (this._activeApp !== this.rawApp) {
      this._activeApp = this.rawApp;
      this.applyViewport('100%');
    } else {
      this.applyViewport(this.currentViewport);
    }
    appRoot.innerHTML = '';

    let appPath = this.rawApp;
    if (!appPath.startsWith('/') && !appPath.startsWith('http')) {
      appPath = '/' + appPath;
    }
    const cleanPath = appPath + `?t=${Date.now()}`;

    let appMeta = {};
    try {
      const srcRes = await fetch(cleanPath);
      if (srcRes.ok) {
        const srcText = await srcRes.text();
        const headerMatch = srcText.match(/^\s*\/\*\*([\s\S]*?)\*\//);
        if (headerMatch) {
          const jsdoc = headerMatch[1];
          const titleMatch = jsdoc.match(/@title\s+([^\r\n*]+)/i);
          if (titleMatch) appMeta.title = titleMatch[1].trim();
          const updMatch = jsdoc.match(/@updated-at\s+([^\r\n*]+)/i);
          const crtMatch = jsdoc.match(/@created-at\s+([^\r\n*]+)/i);
          const pubMatch = jsdoc.match(/@published-at\s+([^\r\n*]+)/i);
          const activeDate = updMatch ? updMatch[1].trim() : (crtMatch ? crtMatch[1].trim() : (pubMatch ? pubMatch[1].trim() : ''));
          if (activeDate) appMeta.publishedAt = activeDate;
        }
      }
    } catch (_) {}
    window.__lookerDataAppMeta = appMeta;
    document.title = appMeta.title ? `${appMeta.title} - Data Apps Gallery` : 'Data Apps Gallery';

    const backupMatch = appPath.match(/^\/?(backups\/apps\/[^/]+)\//);
    let runtimeCssPath = backupMatch
      ? `/${backupMatch[1]}/.runtime/data-app.css`
      : '/runtime/data-app.css';

    if (backupMatch) {
      try {
        const tkRes = await fetch('/' + backupMatch[1] + '/.toolkit-backup');
        if (tkRes.ok) {
          const tkName = (await tkRes.text()).trim();
          if (tkName) {
            runtimeCssPath = '/backups/toolkit/' + tkName + '/runtime/data-app.css';
          }
        }
      } catch (_) {}
    }

    if (this.isSandboxed) {
      this.teardownSandboxBridge();
      const nonce = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).replace(/-/g, '');
      const ORIGIN = window.location.origin;

      const iframe = document.createElement('iframe');
      iframe.id = 'canvas-sandbox-frame';
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.style.cssText = 'width: 100%; height: 100vh; border: none; display: block; background: transparent; transition: max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s;';

      this._diagnosticsMessageListener = (e) => {
        if (e.source !== iframe.contentWindow) return;
        const msg = e.data;
        // Guard against duplicate recording: _sandboxErrorListener already handles messages with __canvasSandboxError
        if (msg && msg.__canvasSandboxError === true) return;
        if (!msg || (msg.type !== 'LOOKER_DATA_APP_ERROR' && msg.type !== 'LOOKER_DATA_APP_CRITICAL_ERROR')) return;
        this.addSandboxError(msg.type, msg.message || msg.stack || 'Runtime error');
        this.writeDiagnosticsNode();
      };
      window.addEventListener('message', this._diagnosticsMessageListener);

      const pending = new Map();
      this._sandboxPendingQueries = pending;
      const bridge = (e) => {
        if (e.source !== iframe.contentWindow) return;
        const msg = e.data;
        if (msg && msg.__canvasSandboxMounted === true) {
          this._sandboxMounted = true;
          this.writeDiagnosticsNode();
          return;
        }
        if (msg && msg.__canvasQueryAbort === true) {
          const ctrl = pending.get(msg.id);
          if (ctrl) ctrl.abort();
          return;
        }
        if (!msg || msg.__canvasQuery !== true) return;
        const reply = (payload) => {
          if (!iframe || !iframe.contentWindow) return;
          iframe.contentWindow.postMessage({ __canvasQueryResult: true, id: msg.id, ...payload }, '*');
        };
        const controller = new AbortController();
        pending.set(msg.id, controller);
        this.writeDiagnosticsNode();
        fetch('/api/query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Looker-Preview-Client': '1',
          },
          body: JSON.stringify(msg.query),
          signal: controller.signal,
        })
          .then(async (r) => {
            const body = await r.json().catch(() => ({}));
            if (!r.ok) {
              reply({ error: { message: body.message || body.detail || body.error || r.statusText, status: r.status, raw: body } });
            } else {
              reply({ rows: body });
            }
          })
          .catch((err) => {
            if (err && err.name === 'AbortError') return;
            reply({ error: { message: String(err && err.message || err) } });
          })
          .finally(() => { pending.delete(msg.id); this.writeDiagnosticsNode(); });
      };
      this._sandboxBridge = bridge;
      window.addEventListener('message', this._sandboxBridge);

      this._sandboxErrorListener = (e) => {
        if (e.source !== iframe.contentWindow) return;
        const m = e.data;
        if (!m || m.__canvasSandboxError !== true) return;
        console.error('[sandbox] ' + m.kind + ': ' + m.message + (m.stack ? '\n' + m.stack : ''));
        this.addSandboxError(m.kind, m.message);
      };
      window.addEventListener('message', this._sandboxErrorListener);

      const iframeDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${ORIGIN}; style-src 'unsafe-inline' ${ORIGIN}; font-src ${ORIGIN} data:; img-src data: blob: ${ORIGIN}; connect-src 'none';">
  <title>Looker Data App (Sandboxed)</title>
  <link rel="stylesheet" href="${ORIGIN}${runtimeCssPath}">
  <link rel="stylesheet" href="${ORIGIN}/vendor/ag-grid/31.3.4/ag-grid.css">
  <link rel="stylesheet" href="${ORIGIN}/vendor/ag-grid/31.3.4/ag-theme-quartz.css">
  <script nonce="${nonce}" src="${ORIGIN}/vendor/ag-grid/31.3.4/ag-grid-community.min.js"><\/script>
  <script nonce="${nonce}" src="${ORIGIN}/vendor/highcharts/11.4.8/highcharts.js"><\/script>
  <script nonce="${nonce}" src="${ORIGIN}/vendor/highcharts/11.4.8/highcharts-more.js"><\/script>
  <script nonce="${nonce}" src="${ORIGIN}/vendor/highcharts/11.4.8/highcharts-solid-gauge.js"><\/script>
  <script nonce="${nonce}" src="${ORIGIN}/vendor/highcharts/11.4.8/highcharts-funnel.js"><\/script>
  <script nonce="${nonce}" src="${ORIGIN}/vendor/highcharts/11.4.8/highcharts-treemap.js"><\/script>
  <style>
    body.vp-device-mode, body.vp-device-mode #sandboxed-app-root, body.vp-device-mode .da-container {
      overflow-x: hidden;
    }
  </style>
</head>
<body class="${this.currentViewport !== '100%' ? 'vp-device-mode' : ''}" style="margin: 0; padding: 0; background: var(--app-bg, #ffffff); box-sizing: border-box;">
  <div id="sandboxed-app-root" style="box-sizing: border-box; width: 100%;"></div>
  <script nonce="${nonce}">
    (function () {
      var relay = function (kind, msg, stack) {
        try { parent.postMessage({ __canvasSandboxError: true, kind: kind, message: String(msg), stack: String(stack || '') }, '*'); } catch (e) {}
      };
      window.addEventListener('error', function (e) {
        var msg = (e && e.message) || (e && e.error && e.error.message) || 'Script error';
        if (typeof msg === 'string' && msg.indexOf('ResizeObserver loop') !== -1) return;
        relay('error', msg, e && e.error && e.error.stack);
      });
      window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        var msg = (r && r.message) || String(r || 'Unhandled promise rejection');
        relay('unhandledrejection', msg, r && r.stack);
      });
      window.addEventListener('securitypolicyviolation', function (e) {
        relay('csp', 'Blocked by CSP: ' + e.violatedDirective + ' -> ' + e.blockedURI, '');
      });
    })();
  <\/script>
  <script type="module" nonce="${nonce}">
    window.__lookerDataAppMeta = ${JSON.stringify(appMeta)};
    const inflight = new Map();
    let seq = 0;
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent) return;
      const m = e.data;
      if (m && m.__canvasViewport === true) {
        document.body.classList.toggle('vp-device-mode', Boolean(m.isDeviceMode));
        return;
      }
      if (!m || m.__canvasQueryResult !== true) return;
      const entry = inflight.get(m.id);
      if (!entry) return;
      inflight.delete(m.id);
      if (m.error) {
        const err = new Error(m.error.message || 'Query failed');
        err.status = m.error.status;
        err.raw = m.error.raw;
        entry.reject(err);
      } else {
        entry.resolve(m.rows);
      }
    });

    window.DataApps = window.DataApps || {};
    window.DataApps.queryRunner = (rawQuery, signal) => {
      const query = { ...rawQuery, view: rawQuery.view || rawQuery.explore };
      const id = ++seq;
      return new Promise((resolve, reject) => {
        inflight.set(id, { resolve, reject });
        if (signal) {
          const onAbort = () => {
            if (!inflight.has(id)) return;
            inflight.delete(id);
            parent.postMessage({ __canvasQueryAbort: true, id }, '*');
            const e = new Error('Aborted'); e.name = 'AbortError';
            reject(e);
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }
        parent.postMessage({ __canvasQuery: true, id, query }, '*');
      });
    };

    try {
      const module = await import('${ORIGIN}${cleanPath}');
      const root = document.getElementById('sandboxed-app-root');

      let CustomClass = module.default;
      if (!CustomClass || typeof CustomClass !== 'function' || !(CustomClass.prototype instanceof HTMLElement)) {
        CustomClass = Object.values(module).find(v => typeof v === 'function' && v.prototype instanceof HTMLElement);
      }

      const tag = module.elementName || (CustomClass && CustomClass.elementName) || 'looker-data-app';
      if (CustomClass && !customElements.get(tag)) {
        try { customElements.define(tag, CustomClass); } catch (_) {}
      }

      let renderedEl;
      if (customElements.get(tag)) {
        renderedEl = document.createElement(tag);
      } else if (CustomClass) {
        renderedEl = new CustomClass();
      }
      if (renderedEl) {
        if (module.layout) renderedEl.appLayout = module.layout;
        root.appendChild(renderedEl);
        try {
          // nosemgrep: looker-internal.javascript.browser.security.wildcard-postmessage-configuration
          parent.postMessage({ __canvasSandboxMounted: true }, '*');
        } catch (_) {}
      }

      const syncTheme = () => {
        const isDark = renderedEl?.isDark !== undefined
          ? Boolean(renderedEl.isDark)
          : Boolean(
              renderedEl?.classList?.contains('dark-theme') ||
              root.querySelector('.da-container.dark-theme')
            );
        document.documentElement.classList.toggle('dark-theme', isDark);
        document.body.classList.toggle('dark-theme', isDark);
        document.body.style.background = isDark ? 'var(--app-bg, #0b0f19)' : '';
        // Wildcard target origin is deliberate: this frame is a sandboxed
        // srcdoc iframe with an opaque origin, so it cannot name the host's
        // origin, and the payload is a theme string with nothing sensitive.
        try {
          // nosemgrep: looker-internal.javascript.browser.security.wildcard-postmessage-configuration
          parent.postMessage({ type: 'canvas-theme', theme: isDark ? 'dark-theme' : 'light' }, '*');
        } catch (_) {}
      };
      syncTheme();
      setTimeout(syncTheme, 50);
      new MutationObserver(syncTheme).observe(root, {
        attributes: true, attributeFilter: ['class'], subtree: true,
      });
    } catch (err) {
      console.error('Sandboxed Lit App Load Error:', err);
      try {
        // nosemgrep: looker-internal.javascript.browser.security.wildcard-postmessage-configuration
        parent.postMessage({
          __canvasSandboxError: true,
          type: 'LOOKER_DATA_APP_CRITICAL_ERROR',
          kind: 'Sandbox Load Error',
          scope: 'sandbox-bootstrap',
          message: err && err.message ? err.message : String(err),
          stack: err && err.stack ? err.stack : '',
        }, '*');
      } catch (_) {}
      const pre = document.createElement('pre');
      pre.textContent = err.stack || err.message;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'padding:24px;color:#ef4444;font-family:sans-serif';
      const h = document.createElement('h3');
      h.textContent = 'Sandbox Load Error';
      wrap.appendChild(h); wrap.appendChild(pre);
      document.body.appendChild(wrap);
    }
  <\/script>
</body>
</html>`;
      iframe.srcdoc = iframeDoc;
      appRoot.appendChild(iframe);
      this.applyViewport(this.currentViewport);
      return;
    }

    // Same-origin Inspect mode
    this.teardownSandboxBridge();

    const topCssLink = document.head.querySelector('link[href*="data-app.css"]');
    if (topCssLink) {
      topCssLink.href = runtimeCssPath;
    }

    this._diagnosticsMessageListener = (e) => {
      if (e.source !== window) return;
      const msg = e.data;
      if (!msg || (msg.type !== 'LOOKER_DATA_APP_ERROR' && msg.type !== 'LOOKER_DATA_APP_CRITICAL_ERROR')) return;
      this.addSandboxError(msg.type, msg.message || msg.stack || 'Runtime error');
    };
    window.addEventListener('message', this._diagnosticsMessageListener);

    this._inspectWindowErrorListener = (e) => {
      const msg = (e && e.message) || (e && e.error && e.error.message) || 'Script error';
      if (typeof msg === 'string' && msg.includes('ResizeObserver loop')) return;
      this.addSandboxError('error', msg);
    };
    this._inspectUnhandledRejectionListener = (e) => {
      const r = e && e.reason;
      const msg = (r && r.message) || String(r || 'Unhandled promise rejection');
      this.addSandboxError('unhandledrejection', msg);
    };
    window.addEventListener('error', this._inspectWindowErrorListener);
    window.addEventListener('unhandledrejection', this._inspectUnhandledRejectionListener);

    appRoot.innerHTML = `
      <div class="preview-loading-container">
        <div class="preview-loading-halo"></div>
        <div class="preview-loading-text">Loading data app…</div>
      </div>
    `;

    try {
      let module;
      try {
        module = await import(cleanPath);
      } catch (importErr) {
        if (cleanPath.startsWith('/examples/')) {
          module = await import('/dist' + cleanPath);
        } else {
          throw importErr;
        }
      }
      if (mountId !== this._mountId) return;
      appRoot.innerHTML = '';

      let CustomClass = module.default;
      if (!CustomClass || typeof CustomClass !== 'function' || !(CustomClass.prototype instanceof HTMLElement)) {
        CustomClass = Object.values(module).find(v => typeof v === 'function' && v.prototype instanceof HTMLElement);
      }

      const tag = module.elementName || (CustomClass && CustomClass.elementName) || 'looker-data-app';
      if (CustomClass && !customElements.get(tag)) {
        try { customElements.define(tag, CustomClass); } catch (_) {}
      }

      let el;
      if (customElements.get(tag)) {
        el = document.createElement(tag);
      } else if (CustomClass) {
        el = new CustomClass();
      }
      if (el) {
        if (module.layout) el.appLayout = module.layout;
        appRoot.appendChild(el);
      }

      const syncHostTheme = () => {
        const isDark = el?.isDark !== undefined
          ? Boolean(el.isDark)
          : Boolean(
              el?.classList?.contains('dark-theme') ||
              appRoot.querySelector('.da-container.dark-theme')
            );
        document.documentElement.classList.toggle('dark-theme', isDark);
        document.body.classList.toggle('dark-theme', isDark);
        document.body.style.background = isDark ? 'var(--app-bg, #0b0f19)' : '';
      };
      syncHostTheme();
      this._themeObserver = new MutationObserver(syncHostTheme);
      this._themeObserver.observe(appRoot, {
        attributes: true, attributeFilter: ['class'], subtree: true, childList: true,
      });

      if (mountId !== this._mountId) return;
      this.applyViewport(this.currentViewport);
      this._updateContentHeight();
    } catch (err) {
      if (mountId !== this._mountId) return;
      console.error('Failed to load Data App:', err);
      this.addSandboxError('Preview Load Error', err && err.message ? err.message : String(err));
      this.writeDiagnosticsNode();
      appRoot.innerHTML = `
        <div class="preview-load-error">
          <h3>Error Loading Data App</h3>
          <p>Failed to import module: <code>${cleanPath}</code></p>
          <pre>${err.stack || err.message}</pre>
          <div class="preview-load-error-actions">
            <a href="${window.location.pathname}">← Return to App Gallery</a>
          </div>
        </div>
      `;
    }
  }

  renderCard(app) {
    const icon = app.icon || '📊';
    const iconBg = app.iconBg || 'rgba(99, 102, 241, 0.12)';
    const updatedStr = app.mtime ? formatTimeAgo(app.mtime, 'Updated') : '';
    const publishedStr = app.published_at ? formatTimeAgo(app.published_at, 'Published') : '';
    const timeLabel = (updatedStr && publishedStr)
      ? `${updatedStr} · ${publishedStr}`
      : (updatedStr || publishedStr);
    return html`
      <div class="gallery-card" data-name="${app.name}">
        <a href="?app=${encodeURIComponent(app.path)}" class="gallery-card-link">
          <div class="gallery-card-top">
            <div class="gallery-card-icon" style="background: ${iconBg};">${icon}</div>
            <div class="gallery-card-meta">
              <h3 class="gallery-card-title">${app.title}</h3>
              <div class="gallery-card-path">${app.path}</div>
              ${timeLabel ? html`<div class="gallery-card-time">⏱️ ${timeLabel}</div>` : ''}
            </div>
          </div>
          <p class="gallery-card-desc">${app.desc}</p>
        </a>
        <div class="gallery-card-action">
          <a href="?app=${encodeURIComponent(app.path)}" class="gallery-card-btn" title="View: the app exactly as the published Looker tile runs it (sandbox iframe — opaque origin, nonce CSP, brokered queries)">View →</a>
        </div>
      </div>
    `;
  }

  renderFeedbackButton() {
    return html`<a class="gallery-feedback-btn" href=${FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer" title="Share feedback via Google Form (opens in a new tab)">💬 Feedback ↗</a>`;
  }

  renderGalleryError(detail) {
    return html`
      <div class="gallery-container">
        <header class="gallery-header">
          <div class="gallery-title-wrap">
            <h1>⚡ Looker Data Apps Gallery</h1>
            <p>Could not read the app catalogue from disk.</p>
          </div>
          <div class="gallery-header-actions">
            ${this.renderFeedbackButton()}
          </div>
        </header>
        <div class="empty-state">${detail}</div>
      </div>
    `;
  }

  renderGallery() {
    const appsData = this.appsData || { my_apps: [], examples: [], evals: [] };
    const q = (this.searchQuery || '').toLowerCase().trim();
    const isList = this.viewMode === 'list';
    const gridClass = isList ? 'gallery-grid list-view' : 'gallery-grid';

    const matchesQuery = (app) => {
      if (!q) return true;
      const haystack = `${app.title || ''} ${app.path || ''} ${app.desc || ''} ${app.name || ''}`.toLowerCase();
      return haystack.includes(q);
    };

    const filteredMyApps = (appsData.my_apps || []).filter(matchesQuery);
    const filteredEvals = (appsData.evals || []).filter(matchesQuery);
    const totalMatches = filteredMyApps.length + filteredEvals.length;

    return html`
      <div class="gallery-container">
        <header class="gallery-header">
          <div class="gallery-title-wrap">
            <h1>⚡ Looker Data Apps Gallery</h1>
            <p>Select a reactive Lit Web Component dashboard to preview in your browser</p>
          </div>
          <div class="gallery-header-actions">
            <div class="gallery-search-wrap">
              <span class="gallery-search-icon">🔍</span>
              <input type="text" id="gallery-search" class="gallery-search-input" placeholder="Filter applications…" autocomplete="off"
                .value=${this.searchQuery}
                @input=${(e) => { this.searchQuery = e.target.value; }} />
            </div>
            <div class="gallery-view-toggle" role="group" aria-label="Gallery view mode">
              <button type="button" class="gallery-view-btn ${!isList ? 'active' : ''}" data-view="grid" aria-pressed=${!isList} title="Grid view" @click=${() => this.setViewMode('grid')}>⊞ Grid</button>
              <button type="button" class="gallery-view-btn ${isList ? 'active' : ''}" data-view="list" aria-pressed=${isList} title="List view" @click=${() => this.setViewMode('list')}>☰ List</button>
            </div>
            ${this.renderFeedbackButton()}
          </div>
        </header>

        <!-- Section 1: My Apps -->
        ${!q || filteredMyApps.length > 0 ? html`
          <section class="gallery-section" data-section="my-apps">
            <div class="gallery-section-title">
              <span>🚀 My Apps</span>
              <span class="gallery-section-badge">${filteredMyApps.length}</span>
            </div>
            <div class=${gridClass} id="grid-my-apps">
              ${filteredMyApps.length > 0
                ? filteredMyApps.map((a) => this.renderCard(a))
                : html`<div class="empty-state">${q ? 'No matching apps found in apps/' : 'No custom apps found in apps/'}</div>`}
            </div>
          </section>
        ` : nothing}

        <!-- Section 2: Evals -->
        ${appsData.evals && appsData.evals.length > 0 && (!q || filteredEvals.length > 0) ? html`
          <section class="gallery-section" data-section="evals">
            <div class="gallery-section-title">
              <span>🧪 Evals</span>
              <span class="gallery-section-badge">${filteredEvals.length}</span>
            </div>
            <div class=${gridClass} id="grid-evals">
              ${filteredEvals.map((a) => this.renderCard(a))}
            </div>
          </section>
        ` : nothing}

        ${q && totalMatches === 0 ? html`
          <div class="empty-state" style="margin-top: 32px; padding: 48px 24px; text-align: center; color: #64748b;">
            No matching apps found for "${this.searchQuery}".
          </div>
        ` : nothing}
      </div>
    `;
  }

  // Inspect mode (`&inspect=1`) is deliberately not offered here: it exists
  // for agents, tests, and devtools, and is reached by URL only.
  renderDock() {
    return html`
      <div class="gallery-nav-bar">
        <a class="gallery-back-pill" href="${window.location.pathname}">← App Gallery</a>
        <div class="gallery-vp-group">
          <button type="button" class="gallery-vp-btn ${this.currentViewport === '100%' ? 'active' : ''}" data-width="100%" title="Desktop (100% Full Width)" @click=${(e) => { e.preventDefault(); this.applyViewport('100%'); }}>🖥️ <span>Desktop</span></button>
          <button type="button" class="gallery-vp-btn ${this.currentViewport === '768px' ? 'active' : ''}" data-width="768px" title="Tablet (768px - 2-Column Responsive Tier)" @click=${(e) => { e.preventDefault(); this.applyViewport('768px'); }}>📱 <span>Tablet</span></button>
          <button type="button" class="gallery-vp-btn ${this.currentViewport === '375px' ? 'active' : ''}" data-width="375px" title="Mobile (375px - Single-Column Responsive Tier)" @click=${(e) => { e.preventDefault(); this.applyViewport('375px'); }}>📲 <span>Mobile</span></button>
        </div>
      </div>
    `;
  }

  renderBadge() {
    if (!this.isSandboxed) return nothing;
    return html`
      <div class="sandbox-badge">
        <span class="sandbox-badge-title">🔒 Tile Parity</span>
        <span class="sandbox-badge-desc">· opaque origin · no storage · no network except Looker queries</span>
      </div>
    `;
  }

  renderSandboxErrors() {
    if (!this.sandboxErrors.length) return nothing;
    return html`
      <div id="sandbox-error-box">
        ${this.sandboxErrors.map(err => html`
          <div class="sandbox-err-line">
            <span class="sandbox-err-msg">${err.kind}: ${err.message}</span>
            <button type="button" class="sandbox-err-close" aria-label="Dismiss error" title="Dismiss error" @click=${() => this.dismissError(err.id)}>×</button>
          </div>
        `)}
      </div>
    `;
  }

  render() {
    if (!this.rawApp) {
      return html`
        <div id="app-root">
          ${this.galleryError ? this.renderGalleryError(this.galleryError) : this.renderGallery()}
        </div>
      `;
    }

    return html`
      ${this.renderDock()}
      ${this.renderBadge()}
      ${this.renderSandboxErrors()}
      <div id="app-root"></div>
    `;
  }
}

if (!customElements.get('preview-host')) {
  customElements.define('preview-host', PreviewHost);
}
