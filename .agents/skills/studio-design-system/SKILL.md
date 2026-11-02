---
name: studio-design-system
description: Design system tokens (--dab-*), React UI primitives (StudioDesignSystem.tsx & StudioSelect.tsx), layout/overflow invariants, Dark/Light theme rules, and cropped visual snapshot standards for Looker Data App Studio.
---

# Looker Data App Studio — Design System & UI Architecture

Use this skill whenever creating, modifying, styling, or testing UI components in the Looker Data App Studio React extension (`src/components/*`, `src/lookmlTool.tsx`, `src/styles/index.css`, and `src/__tests__/miniApps.visual.test.js`).

---

## 1. Lessons Learned from Issues #38–#65 (Why Each Invariant Exists)

| Issue(s) | Failure Mode Observed | Mandatory Design System Rule |
| --- | --- | --- |
| **#38, #63** | Fixed `height: 28px` and missing `white-space: nowrap` caused toolbar buttons and badges to wrap text vertically or clip descenders (`scrollHeight > clientHeight`). | Always use `min-height: 28px; height: auto; display: inline-flex; align-items: center; white-space: nowrap` via `<StudioButton>` (`.dab-btn`) and `<StudioToolbar>` (`.dab-preview-toolbar`). |
| **#41, #49** | CSS Grid `1fr` columns and Flex children defaulted to `min-width: auto`, allowing wide code blocks, URLs, or tables to blow out the split-pane viewport horizontally. | Every Grid track, split pane, toolbar title block, and flex container that holds dynamic text MUST set `min-width: 0`. |
| **#58, #62** | Asynchronous Looker folder & model hydration caused topbar controls to pop in after initial render, shifting horizontal layout (`CLS`). | Render `<StudioSkeleton width={...} height={28} />` (`.dab-skeleton`) while metadata is loading so control dimensions remain stable. |
| **#50, #60** | Hardcoded light-only hex colors (`#ecfdf5`, `#047857`, `#fef3c7`, `#92400e`, `#fee2e2`, `#991b1b`, `#fff`) produced unreadable contrast or blinding white boxes in Dark Mode (`data-theme="dark"`). | Never hardcode status or surface hex colors in JSX `style={{ ... }}`. Use `<StudioBadge tone="neutral\|accent\|success\|warning\|danger">`, `<StudioCard>`, and `--dab-*` CSS variables. |
| **#64** | Embedding live React buttons/dropdowns inside Use-Case documentation Markdown allowed users or tests to accidentally trigger actions or tab-focus hidden controls inside docs. | Wrap all embedded documentation UI previews in `<StudioDocPreview component="...">`, which enforces `pointer-events: none; user-select: none`, `aria-hidden="true"`, and `tabIndex={-1}`. |
| **#65** | `extensionSDK.oauth2Authenticate()` popups that failed (`redirect_uri_mismatch`) or were closed by the user never settled their Promise, permanently locking the Sign-In UI. | Pair OAuth popup flows with a `window` `focus`-return timeout and an `AbortController` cancel button so users can always retry or switch to API Key auth. |
| **#60** | Native `<select>` menus render with OS-specific chrome that ignores dark mode, custom icons, and optgroup badges, while breaking existing DOM tests if removed outright. | Always use `<StudioSelect>`, which renders a custom accessible `role="listbox"` popover alongside a synchronized hidden `select.dab-studio-select-native[aria-hidden="true"]` for backwards-compatible `.value` inspection. |

---

## 2. Semantic CSS Token Reference (`src/styles/index.css`)

All theme tokens automatically adapt between `:root, :root[data-theme="light"]` and `:root[data-theme="dark"]`:

### Surface, Text & Border Tokens
- `--dab-bg`: App canvas background (`#f8fafc` light / `#0b0f19` dark)
- `--dab-surface`: Primary card, toolbar, and modal surface (`#ffffff` light / `#111827` dark)
- `--dab-surface-2`: Secondary subtle fill for pills, code blocks, and headers (`#f1f5f9` light / `#1e293b` dark)
- `--dab-surface-hover`: Interactive hover fill (`#f1f5f9` light / `#334155` dark)
- `--dab-border`: Standard 1px hairline border (`#e2e8f0` light / `#1f2937` dark)
- `--dab-border-strong`: Emphasized control border (`#cbd5e1` light / `#374151` dark)
- `--dab-text`: Primary body & heading text (`#0f172a` light / `#f8fafc` dark)
- `--dab-text-secondary`: Secondary labels & metadata (`#475569` light / `#cbd5e1` dark)
- `--dab-text-muted`: Muted hints & placeholders (`#64748b` light / `#94a3b8` dark)

### Accent & Semantic Status Tokens
- **Accent**: `--dab-accent` (`#2563eb` / `#3b82f6`), `--dab-accent-hover`, `--dab-accent-soft`, `--dab-accent-border`
- **Success**: `--dab-success-bg`, `--dab-success-text`, `--dab-success-border` (`.dab-badge-success`)
- **Warning**: `--dab-warning-bg`, `--dab-warning-text`, `--dab-warning-border` (`.dab-badge-warning`)
- **Danger**: `--dab-danger-bg`, `--dab-danger-text`, `--dab-danger-border` (`.dab-badge-danger`)

---

## 3. Primitive Component Catalog (`src/components/StudioDesignSystem.tsx`)

Import all primitives from `./StudioDesignSystem` (or `./StudioHeader`, which re-exports them):

```tsx
import {
  StudioButton,
  StudioBadge,
  StudioModal,
  StudioToolbar,
  StudioCard,
  StudioSkeleton,
  StudioDocPreview,
  StudioSelect,
} from './StudioDesignSystem'
```

### `<StudioButton>`
Standardized action button (`type="button"` by default) with automatic `.dab-btn` sizing (`min-height: 28px`, `inline-flex`, `white-space: nowrap`).
- **Props**: `variant?: 'primary' | 'secondary' | 'gemini' | 'danger'`, `testId?: string`, plus standard `<button>` props.

### `<StudioBadge>`
Theme-aware status badge or message pill.
- **Props**: `tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'`, `pill?: boolean` (uses `.dab-msg-pill` instead of `.dab-badge`), `testId?: string`.

### `<StudioModal>`
Accessible modal dialog shell with backdrop click dismissal, `Escape` key handler, and header/footer slots.
- **Props**: `open: boolean`, `onClose: () => void`, `title: React.ReactNode`, `subtitle?: React.ReactNode`, `testId?: string`, `backdropTestId?: string`, `closeTestId?: string`, `closeLabel?: React.ReactNode`, `maxWidth?: number | string`, `footer?: React.ReactNode`.
- **Canonical Modal `testId`s**:
  - `folder-advanced-search-modal` (`closeTestId="folder-search-modal-close"`)
  - `use-case-info-modal` (`closeTestId="use-case-info-close-btn"`)
  - `delete-conv-modal`
  - `tile-schedule-modal`

### `<StudioToolbar>`
Right-pane preview toolbar with a responsive wrapping title/badge group (`.dab-ds-toolbar-title-block`) and right-aligned action cluster (`.dab-preview-actions`).
- **Props**: `title?: React.ReactNode`, `badges?: React.ReactNode`, `actions?: React.ReactNode`, `testId?: string`, `titleBlockTestId?: string`.

### `<StudioCard>` & `<StudioSkeleton>`
- `<StudioCard testId="...">`: Theme-aware surface container (`.dab-ds-card`) replacing ad-hoc inline card styles.
- `<StudioSkeleton width={190} height={28} testId="..." />`: Shimmer placeholder (`.dab-skeleton`) preventing layout shift during async loads.

### `<StudioDocPreview>`
Non-interactive wrapper for live UI components embedded inside documentation Markdown (`renderUseCaseGuideMarkdown`).
- **Props**: `component?: string`, `testId?: string` (defaults to `'doc-ui-preview'`), `children: React.ReactNode`.

---

## 4. Visual Regression Testing Protocol (`src/__tests__/miniApps.visual.test.js`)

When adding or updating visual snapshot tests in `src/__tests__/miniApps.visual.test.js`:
1. **Always Crop to the Target Component**: Never capture full-viewport (`1440x900`) screenshots when testing a specific toolbar, modal, dropdown, or card.
2. **Use `clipSelector` + `clipMargin = 24`**: Pass `clipSelector` (single CSS selector or comma-separated union of selectors) to `computeElementUnionClipRect(chrome, clipSelector, 24)` or compute the bounding rect union with a `14px–24px` padding margin before calling `Page.captureScreenshot({ format: 'png', clip })`.
3. **Assert Both Light & Dark Computed Styles**: Verify `getComputedStyle(el)` for background, text color, and `scrollHeight <= clientHeight + 2` so regressions are caught deterministically alongside pixel diffs.
