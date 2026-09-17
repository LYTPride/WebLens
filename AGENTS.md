# WebLens Agent Guide

Keep this file focused on durable product decisions and non-obvious engineering constraints. Use the references below only when relevant to the task; implementation details and history belong in `doc/`.

## Product and code map

WebLens is a Kubernetes operations console with cluster/namespace scoping, resource lists, a right-side Describe drawer, and bottom workspace tabs for operational sessions.

- Go + Gin + client-go backend: `server/internal/httpapi/`; serves the API and built frontend from `web/dist` on the same origin.
- React + TypeScript + Vite frontend: orchestration in `web/src/pages/App.tsx`, API client in `web/src/api.ts`, shared UI in `web/src/components/`.
- When extending a feature, inspect the closest existing implementation and reuse its components and interaction patterns. Treat current code as the source for component APIs and resource visibility; avoid copying historical inventories from docs.

## Product lines (trial)

| Line | Canonical host | Purpose |
| --- | --- | --- |
| Personal / 个人线 | GitHub `LYTPride/WebLens` | Personal ideas, experiments, and general features |
| Enterprise / 企业线 | Company GitLab (planned name: `WebLens-Enterprise`) | Company-specific requirements and releases |

- Use separate local clones, each with its own canonical `origin` and `main`. No enterprise GitHub mirror, automatic cross-repository synchronization, or whole-main merges.
- Develop on short-lived branches from the target repository's current `main`, then merge through GitHub PRs or GitLab MRs. Use `feat/`, `fix/`, `hotfix/`, `chore/`, or `sync/` as appropriate; tool-required prefixes such as `codex/` are also valid.
- Protect both main branches against direct and forced pushes. This is the intended policy, not a claim that remote protections or the enterprise repository have already been configured.
- Preserve shared Git history when initializing the enterprise repository. The agreed starting commit is `efe527e129948585271a9bba29689dd626060781`; later development is independent.
- Shared feature: implement the common part once, create a branch from the other repository's `main`, cherry-pick selected commits or manually port, and validate and review separately. Keep enterprise adaptations separate. Both branches may be tested before either is merged; do not push a single development branch to both hosts.
- Record source commits and relevant PR/MR links plus intentional differences. Keep internal references in GitLab; public GitHub descriptions must not expose private metadata.
- Enterprise-only code, configuration, and documentation stay in GitLab. Only reviewed, authorized, sanitized general changes may return to GitHub; inspect both the diff and commit metadata. Reimplement the generic part if it cannot be safely separated.
- Version and release independently. Identify artifacts by product line, version, and commit; enterprise packages use `weblens-enterprise-<version>.tar.gz`. Revisit the trial after the first enterprise release or demonstrated porting friction; defer shared-library/repository infrastructure until needed.

## Working boundaries

- Carry the requested change through implementation and relevant verification. Make routine implementation decisions from the task and existing code; ask when a missing decision materially affects scope, product behavior, or destination.
- Preserve unrelated user edits and keep changes scoped. Do not add adjacent refactors or speculative features.
- Verify the repository, branch, and destination before cross-repository transfers or pushes. Push or publish only when authorized by the user; existing authorization remains valid for that scope.

## Resource UI contract

- Name opens Describe; an adjacent hover/focus copy icon copies the name. Row-end menus contain operations, never Describe or name-copy actions. Cross-resource navigation uses a separate `ResourceJumpChip`.
- Events are the row-click Describe exception. For expandable resource rows, Name/copy controls stop propagation; the chevron or row background retains expansion behavior.
- Describe uses the shared resizable right-side drawer in `App.tsx`, with structured content under `components/describe/` and `DescribeEventsSection` where relevant. Manual refresh is sufficient; Event Describe displays its snapshot.
- Logs, Shell, YAML and configuration editing belong in bottom workspace tabs. Reopening the same task reuses its tab. Reuse `PodYamlEditTab` / `YamlMonacoEditor` for YAML; retain local Monaco loading through `monacoInit.ts` for offline deployment.
- A new visible resource needs a resource-specific table, scoped List + Watch, Name filtering, relevant sorting/resizing, and loading/empty/error/permission states. Include Describe, editing and mutations according to the agreed scope; generic list plumbing alone is not a completed page.
- Visibility is controlled by `web/src/utils/v1HiddenViews.ts` and `Sidebar.tsx`. Keep sidebar, session restore and Event jumps consistent: hidden views fall back to Pods on restore and have no jump chip. Consult the current set rather than maintaining a second resource list here.
- Titles use `Resource Type · namespace / count`; cluster context stays above the list. Name filtering affects current rows only, and refresh affects the current resource type with its established sort-reset behavior.
- Reuse `ResizableTh`, `useResourceListColumnResize`, `ResourceSortArrows`, `SelectionHeaderCell`, and `SecondaryExpandTable`. Selection headers use header tokens, and child tables have independent column sizing. Horizontal overflow stays inside tables or tab strips, never on the whole page.
- Use body portals (`DropdownMenuPortal` / `SearchableDropdownPanelPortal`) and shared `Z_INDEX` values. Mount menus only while open, retain owning-row highlighting, and follow existing close/reposition behavior.
- Use `ConfirmDialog`, `InputDialog`, and `setActionConfirm` instead of browser-native dialogs. If an async destructive action fails, display the error and keep its dialog open; propagate failure to the dialog.
- Theme-aware UI uses semantic tokens from `web/src/theme/tokens.css`, including event, row, bulk-action, log-match, and terminal states. Preserve light/dark contrast and avoid whole-card opacity that dims text. The fixed-dark authentication entry is a documented exception in `doc/dev/theme-ui.md`.

## Data and backend contract

- HTTP List handles initial load, scope changes, manual refresh, and Watch gap fill. Watch is the live update path, not polling. Both merge into raw apiserver-shaped state; derive display rows, filter, sort and selection from that state.
- Keep freshness scoped by cluster, namespace, resource type and refresh nonce. Apply Watch events immediately through the shared reducers, retain active sorting, and use independent cancellation for concurrent watches.
- List responses and Watch event lines include `serverTimeMs`; use the shared server clock for Age. Short soft caching applies only to List, never Watch; mutations invalidate the relevant cache.
- Follow existing `/api/clusters/:id/<resource>` routes and resource-specific operations. Preserve meaningful errors (including missing clusters and RBAC denial) and structured Describe responses.
- File management uses Pod exec in the Shell context. Shell output parsed by Go uses `printf`, TAB-separated fields, explicit newlines, and stderr/exit-code handling; do not rely on `echo` escape behavior.

## Task-specific references

Read the entries relevant to the change, not the whole table.

| Task | Reference |
| --- | --- |
| List/Watch, scope freshness, Age, gap fill | [Resource list architecture](web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md) |
| Resource-page behavior | [Resource lists](doc/guide/resource-lists.md), then the relevant resource guide in `doc/guide/` |
| Menus, dropdowns, expanded tables | [Portal and secondary table conventions](doc/dev/portal-dropdown-and-secondary-tables.md) |
| Themes, warnings, Shell/Monaco appearance | [Theme UI](doc/dev/theme-ui.md) and `web/src/theme/tokens.css` |
| Authentication and authorization | [Authentication](doc/guide/authentication.md), [Permissions V2](doc/dev/permissions-v2.md) |
| Shell sessions or file transfers | [Shell implementation](doc/dev/shell-implementation.md), [File manager design](doc/dev/file-manager-design.md) |
| Pod health derivation | [Health label model](doc/dev/health-label-model.md) |
| Deployment or broader architecture | [README](README.md), [Architecture](doc/dev/architecture.md) |
| Other documentation | [Documentation index](doc/README.md) |

## Validation and documentation

- Match verification to the change. For documentation-only edits, check the diff and referenced paths; no application build is needed.
- For frontend code, use `npm run build` from `web/` where feasible. This runs Vite, not TypeScript checking; use `npx --no-install tsc --noEmit` when type validation is needed. Distinguish pre-existing errors from regressions.
- For backend behavior, run focused Go tests from `server/` (for example, `go test ./internal/httpapi`). Broaden testing for cross-cutting changes or unresolved failures, not automatically for every edit.
- For visual changes, check affected states in light and dark themes, preferably in the browser when available; report any verification limitation.
- Run `git diff --check` and exclude generated output (`web/dist/`, `web/node_modules/`, `server/bin/`, `release/`, `logs/`) from commits.
- Put user workflows in `doc/guide/`, engineering details in `doc/dev/`, and meaningful product changes in `doc/dev/changelog.md`. Reserve root `README.md` changes for major capabilities and startup/configuration.
- Add guidance here only for durable, project-specific decisions or recurring non-obvious failures. Keep each rule in one place and link to task-specific details instead of copying checklists or change history.
