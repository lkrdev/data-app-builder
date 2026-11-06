---
name: issue-authoring
description: Workflow, root-cause pre-analysis, grouping rules, canonical GitHub issue template, and pre-PR self-improvement loop for turning raw user feedback into 1-pass executable GitHub issues and PRs in data-app-builder.
---

# Looker Data App Studio — Issue Authoring & Issue-to-PR Acceleration

Load when capturing feedback, filing GitHub issues (`gh issue create`), or evaluating Issue → PR efficiency before submitting a PR.

## 1. Introspection of Issues #59–#65 & PRs #66–#73 (Intake & Grouping Rules)

| Pattern / Friction Observed Across #59–#65 → #66–#73 | Mandatory Rule |
| --- | --- |
| **Live `file:line` + Root-Cause Intake (#59–#65)** — Resolving exact `file:line` symbols and root causes (`listUserArtifacts` resurrection in **#61/#70**, `oauth2Authenticate` locking `busyStatus` in **#65/#68**, `height: 28px` button overflow in **#63/#66**) during intake eliminated exploratory search during PRs. | Log each feedback item + screenshot in `feedback_log.md` and immediately run `git grep -n` to cite exact `path/to/file.tsx#Lstart-Lend`, state hooks, callers, and root cause. Never file a symptom-only issue. |
| **Blast-Radius Grouping (#59–#65)** — Grouping 18 raw items into 7 component-scoped issues (`StudioComposer` **#59**, `<StudioSelect>` **#60**, `StudioConversationsSidebar` **#61**, Folder tree **#62**, `ScriptStudioView` **#63**, `UseCaseInfoModal` **#64**, OAuth **#65**) prevented merge conflicts across sequential PRs **#66–#72**. | Combine feedback items that touch the same component tree or state slice into one cohesive issue; keep independent subsystems separate. |
| **Missing Design System Mandates → PR #73 (`+1123/-709`)** — Issues **#61, #62, #64** did not mandate shared UI primitives, so PRs **#69–#71** hand-rolled `.dab-modal` markup, inline card styles, and custom toolbars that PR **#73** had to refactor into `StudioDesignSystem.tsx`. | Specify which primitives from `src/components/StudioDesignSystem.tsx` (`<StudioButton>`, `<StudioBadge>`, `<StudioModal>`, `<StudioToolbar>`, `<StudioCard>`, `<StudioSkeleton>`, `<StudioDocPreview>`, `<StudioSelect>`) and `--dab-*` tokens to use. |
| **Unspecified `data-testid` Contracts** — PRs **#67–#72** had to invent 20+ `data-testid` attributes mid-implementation before writing `permissions.test.ts` and `miniApps.visual.test.js`. | Name exact `data-testid` attributes in the issue body so JSX, unit tests, and headless Chrome DOM/visual tests are written in a single pass. |
| **Unlisted SDK, SWR, Manifest & Mock Touchpoints (#61/#70, #62/#71)** — Adding `folder_children`, `folder_ancestors`, `search_folders`, or `delete_dashboard` required coordinated updates across `manifest.lkml`, `src/lookerApi.ts` (`SWR_DEDUPED_METHODS`), `src/lookerArtifacts.ts` (`ArtifactService`), and `createMockCore40SDK`. | Explicitly list required `manifest.lkml` `core_api_methods`, `lookerApi.ts` SWR/deduplication methods, `ArtifactService` methods, and test mock stubs in the issue. |
| **Snapshot & Copy Collisions (#59/#67, #61/#70, #86, #94, #117)** — Removing `My Creations` (**#61**), renaming `Auto (Agent Decides)` / `Python Tile` (**#59**), stripping decorative emojis (**#86**), adding a new `StudioUseCase` (**#94**), or gating `warmTurnDirective` / `shouldRouteToIsolatedCaSubagent` (**#117**) affects existing option/tab arrays, warm-turn fixtures (`turnA2`/`turnB2` in Test 10 of `permissions.test.ts`), and Turn-1 CA routing prompts (`miniApps.visual.test.js#L2181`). | Run `git grep -n "<old copy or testid>" src/ scripts/` when drafting the issue, list exact test lines (including `DOC_UI_COMPONENTS`, `turnA2`/`turnB2` warm-turn fixtures in `permissions.test.ts`, and all 4 use-case option/tab arrays + Turn-1 CA prompt in `miniApps.visual.test.js`), and run `UPDATE_VISUAL_SNAPSHOTS=1 npx jest -u src/__tests__/miniApps.visual.test.js` so both PNG and `.snap` snapshots update together. |
| **Library-First TypeScript Types & Zero-`any` (#77)** — Hand-rolling duplicate Looker/Extension interfaces or using `: any` breaks `@typescript-eslint/no-explicit-any` (`npm run lint:check`). | Always import canonical types from `@looker/sdk`, `@looker/extension-sdk`, `@looker/extension-sdk-react`, `@looker/embed-sdk`, `swr`, and `react` first, composing with `Partial<...>` / `Pick<...>` / `unknown` instead of `any`. |
| **Non-Webpack Dynamic `require` in Node/Jest & `gh issue view` JSON (#104)** — `Function('return require')()` evaluates in global scope where CommonJS `require` is undefined in Jest (`ReferenceError: require is not defined`), and bare `gh issue view` fails on deprecated `projectCards` GraphQL fields. | Use `eval('require')('./vendor/codemode.js')` for non-webpack-bundled Node/Jest fallbacks, serve `/codemode.js` locally in `src/__tests__/miniApps.visual.test.js`, and always pass `--json title,body,comments` to `gh issue view`. |
| **Headless Chrome `localStorage` Isolation & `useCallback` Setter Dependencies (#112)** — Adding new `localStorage`-persisted state keys (`STUDIO_FOLDER_STORAGE_KEY`) or wrapping a `useState` setter in `useCallback` (`setSelectedFolderId`) can leak persisted state across sequential visual tests or trigger `react-hooks/exhaustive-deps` warnings (`--max-warnings=0`). | Clear new `dab_*` `localStorage` keys in the inline HTML bootstrap of `src/__tests__/miniApps.visual.test.js` unless `?preserve<Key>=1` is present, and grep all `useCallback`/`useEffect` blocks calling the wrapped setter to include it in their dependency arrays. |
| **Antigravity Sub-Module Layout & `lkr-dev-cli` / `CODEMODE_CDN_URL` Version Parity** — `src/antigravity.ts` is split into 5 modules (`src/antigravityTypes.ts`, `src/antigravityAuth.ts`, `src/antigravitySteps.ts`, `src/antigravityStarters.ts`, and `src/antigravity.ts`), and `.githooks/pre-commit` enforces exact version parity across `lkr-dev-cli-version.txt`, `LKR_DEV_CLI_VERSION`, and `CODEMODE_CDN_URL`. | Cite the specific sub-module in issues (`antigravityAuth.ts` for OAuth/API calls, `antigravitySteps.ts` for workspace sources/bundles/activity steps, `antigravityStarters.ts` for labeling/starters/`@`-mentions, `antigravityTypes.ts` for types/uploads, `antigravity.ts` for turn orchestration), and update `lkr-dev-cli-version.txt`, `LKR_DEV_CLI_VERSION`, and `CODEMODE_CDN_URL` (`src/lkrCliBridge.ts`) together whenever bumping `lkr-dev-cli`. |
| **Visual Test `routeMap` Registration & Fast Readiness Selectors (#126)** — Unmapped `?scenario=<name>` URLs in `src/__tests__/miniApps.visual.test.js` fall back to legacy `/app/42` (which does not hydrate `conv_app_42` chat messages), and waiting on a selector that is only mounted later via `window.__DAB_STUDIO__.setMessages(...)` burns the full 8s loop and triggers Chrome's `net::ERR_BLOCKED_BY_ADMINISTRATOR` force-installed extension timeout on subsequent navigations. | Register every new visual test scenario in `routeMap` inside `buildHtmlPage` (e.g. `'/c/conv_app_42'`), and always poll for an already-rendered readiness selector (`Boolean(window.__DAB_STUDIO__ && document.querySelector(...))`) after `Page.navigate`. |
| **`LOOKML_TURN_SKILLS` Slice & `formatFriendlyLookerActivityLabel` `toEqual` Contracts (#145)** — Appending skills to `LOOKML_SKILLS_CATALOG` (`src/lookmlSkills.ts`) changes composer chip count in `chatbar_lookml_skills` unless `LOOKML_TURN_SKILLS = LOOKML_SKILLS_CATALOG.slice(1, 6)` is preserved, and `src/__tests__/permissions.test.ts#L5090` asserts `toEqual` on `formatFriendlyLookerActivityLabel` return objects. | Keep `LOOKML_TURN_SKILLS` bounded to the 5 turn chips (`slice(1, 6)`), and scope any extra properties on `formatFriendlyLookerActivityLabel` (such as `title`) to the newly added macro branch or list `permissions.test.ts#L5090` in affected test assertions. |

## 2. Canonical GitHub Issue Template

```markdown
## Summary

<1–2 sentence overview of the problem/goal and which feedback items it covers.>

## Requirements

### 1. <Requirement Title>
- **Current (`src/path/File.tsx#L10-L30`, `src/useStudioController.ts#L100-L120`)**: <Exact current behavior and root cause.>
- **Change**: <Concrete target behavior, state/prop transitions, and edge-case handling.>
- **Design System & `data-testid` Contract**:
  - Primitives: `<StudioModal>`, `<StudioToolbar>`, `<StudioSelect>`, `<StudioButton>`, `<StudioBadge>`, `<StudioCard>`, `<StudioSkeleton>`, `<StudioDocPreview>` (`.agents/skills/studio-design-system/SKILL.md`).
  - Tokens: `--dab-*` semantic variables (verify both `light` and `dark` themes).
  - `data-testid`s: `<exact-test-ids-to-add-or-preserve>`.

## Touchpoints & Verification Plan

- **Files to Modify**: `src/...`
- **Looker SDK / Artifacts / Manifest / Mocks**:
  - `manifest.lkml` (`core_api_methods`): `<none | methods>`
  - `src/lookerApi.ts` (`SWR_DEDUPED_METHODS` / helpers): `<none | functions>`
  - `src/lookerArtifacts.ts` (`ArtifactService`): `<none | methods>`
  - Test mocks (`createMockCore40SDK` in `src/__tests__/miniApps.visual.test.js` & `src/__tests__/permissions.test.ts`): `<methods to stub>`
- **Existing Test Assertions Affected**: `<exact lines in miniApps.visual.test.js / .snap / test-bundle.mjs>`
- **Verification**:
  - `npx jest src/__tests__/permissions.test.ts && node scripts/test-bundle.mjs`
  - `UPDATE_VISUAL_SNAPSHOTS=1 npx jest src/__tests__/miniApps.visual.test.js` (cropped `clipSelector` + `24px` margin)
```

## 3. Mandatory Pre-PR Self-Evaluation Loop

Before submitting any PR, check whether implementing the issue required:
1. Searching for files, callers, CSS rules, or mock helpers not cited in the issue.
2. Fixing an unexpected test/snapshot collision, missing `createMockCore40SDK` stub, `manifest.lkml` entitlement, or dark-mode contrast failure not flagged in the issue.
3. Introducing a new shared primitive, controller hook, `ArtifactService` method, or test helper that future issues should reference by default.

If any of (1)–(3) occurred, update `.agents/skills/issue-authoring/SKILL.md` (and `.agents/skills/studio-design-system/SKILL.md` if UI-related) **in the same PR** so every subsequent Issue → PR cycle runs in fewer tool calls. Internal repository skills always live under `.agents/skills/` (never in `skills/` or `upstream/payload/AGENTS.md`, which are reserved for the customer Data Apps sandbox payload).
