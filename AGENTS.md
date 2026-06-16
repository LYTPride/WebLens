# WebLens Agent Guide

This file is the long-lived product and engineering memory for WebLens. Keep it in the repository root and also use it as a ChatGPT project data source when turning plain-language requests into implementation prompts.

The goal is simple: new work should feel like the existing WebLens product, not like a one-off feature bolted onto a Kubernetes API proxy.

## Product Shape

WebLens is a Kubernetes operations console.

- Backend: Go + Gin + client-go. It acts as a Kubernetes API proxy and also serves the built frontend from `web/dist`.
- Frontend: React + TypeScript + Vite. The main app orchestration lives in `web/src/pages/App.tsx`.
- Core UX: multi-cluster scope selection, resource lists, right-side Describe drawer, bottom workspace tabs, YAML editing, logs, shell, and file manager.
- Deployment model: same-origin HTTP API + static frontend, avoiding CORS complexity.

Root `README.md` only records major core capabilities and startup information. Detailed behavior, interaction rules, implementation notes, and iteration history belong in `doc/guide/` and `doc/dev/`.

## Non-Negotiable UX Rules

### Describe Entry Point

For resource list pages with a resource `Name` column, **Describe opens by clicking the resource name**.

Do not add `Describe` to the row-end three-dot menu.

The three-dot menu is for operational actions such as:

- `Edit`
- `Delete`
- `Scale`
- `Restart`
- `Logs`
- `Shell`
- resource-specific actions

The name cell should carry the inspect/open behavior. The row menu should not duplicate it.

Events are the practical exception: Events rows represent event records, so row click may open Event Describe.

### Name, Copy, and Jump Are Separate

Use the existing pattern consistently:

- Resource name text is the main identity and may open Describe when it is the primary resource in the current list.
- Copy is a small adjacent icon button beside the resource name, usually using `CopyIcon` and the `wl-table-hover-copy*` classes.
- The copy button is hidden until hovering or focusing the name area, matching Pods, Deployments, StatefulSets, Services, PVCs, Nodes, and the generic resource table.
- Do **not** add `Copy name`, `Copy namespace/name`, or equivalent copy actions to the row-end three-dot menu.
- Cross-resource navigation is a separate `ResourceJumpChip`, not a clickable resource name.
- Do not make entire long names clickable when a distinct jump chip or copy control is expected.

For long resource names, prefer wrapping/truncation patterns already used by `ResourceNameWithCopy`, `ResourceJumpChip`, and table hover-copy styles.

### Right-Side Describe Drawer

Describe panels use the shared right-side drawer shell in `App.tsx`:

- Semi-transparent overlay.
- Draggable drawer width.
- Header with resource identity, copy, refresh, and close.
- Structured content, not raw `kubectl describe` text.
- Events section via `DescribeEventsSection` when applicable.
- Manual refresh is allowed; Describe does not need to live-update on every Watch event.

Describe is a **main-page right-side drawer**, not a bottom workspace tab and not a separate in-table panel. Do not put Describe content in `BottomPanel`, `PodYamlEditTab`, or any bottom tab. Existing resource Describe panels for Pods, Deployments, StatefulSets, Ingresses, Services, PVCs, Nodes, and Events all follow the right-side drawer pattern.

When adding a new resource Describe:

- Add a backend structured describe endpoint if the data is more than a raw YAML dump.
- Add a `web/src/components/describe/*DescribeContent.tsx` component.
- Wire it through `describeTarget`, `refreshDescribe`, and drawer rendering in `App.tsx`.
- Open it from the resource name, not from the row menu.

### Visible Resource Page Completion Standard

A visible first-class resource page is not complete just because backend list/watch exists.

Before exposing a resource in the sidebar, it should have the product surface users expect for that resource class:

- Sidebar entry and `V1_HIDDEN_VIEWS` policy updated intentionally.
- Resource-specific table component, not only the generic `ResourceTable`, unless the product decision explicitly says a generic read-only page is acceptable.
- Name filter, table width model, and sortable columns where relevant.
- List + Watch lifecycle using the resource-list architecture.
- Age based on `serverTimeMs` where age is displayed.
- Describe opened from Name if the resource supports Describe.
- YAML Edit in the bottom panel if editing is in scope.
- Delete or other mutations only when RBAC and product expectations make sense.
- Empty, loading, error, and permission-denied states considered.
- User docs in `doc/guide/` and implementation notes or changelog in `doc/dev/`.

Hidden resources live in `web/src/utils/v1HiddenViews.ts`. If a resource is hidden:

- It should not appear in the sidebar.
- Session restore should fall back to Pods.
- Event involved-object jump should not show a jump chip to hidden views.
- Backend and internal list/watch code may remain present.

ConfigMaps are a good example of the distinction: backend list/watch and generic frontend plumbing may exist, but that alone does not make a completed visible ConfigMap page.

## Existing Resource Pages Are the Contract

When adding or changing a resource page, compare against the completed pages first. The contract is not only in docs; it is also encoded in the existing implementations for Pods, Deployments, StatefulSets, Ingresses, Services, PVCs, Events, and the hidden-but-implemented Nodes view.

### Sidebar and Entry Policy

The sidebar is grouped and filtered by `Sidebar.tsx` plus `V1_HIDDEN_VIEWS`:

- `集群`: Events; Nodes logic exists but is hidden in v1.
- `工作负载`: Pods, Deployments, Stateful Sets.
- `网络`: Services, Ingresses.
- `存储`: Persistent Volume Claims.
- Hidden v1 views must stay hidden from the sidebar, session restore, and Event jump chips until the product decision changes.
- To expose a hidden resource, update the sidebar policy and implement the first-class page surface; do not expose it only because generic list/watch works.

### Resource Page Shell

Completed resource pages share this shell:

- The applied cluster/namespace scope is shown in the top scope area.
- The main title follows `Resource Type · namespace / count`; cluster IDs and kubeconfig details are not repeated in the title.
- The Name search box filters only the current table rows.
- `刷新列表` refreshes only the current resource type and follows that page's established sort-reset behavior.
- Loading, empty, warning/risk hints, clock-skew hints, and access-denied states appear inside the resource area, not as browser dialogs or full-page crashes.
- Table horizontal overflow stays inside the table region; `html`, `body`, and `#root` must not get viewport-level horizontal scroll.

### Completed Page Behavior Matrix

Use this as the baseline before inventing a new interaction:

| Resource | Primary Name Behavior | Row Behavior | Row Menu Actions | Extra Surface |
| --- | --- | --- | --- | --- |
| Pods | Name opens Describe; copy icon beside Name | no row-wide Describe | Shell, Logs, Edit, Delete | multi-select delete; bottom Logs/Shell/YAML |
| Deployments | Name opens Describe; copy icon beside Name | no row-wide Describe | Scale, Restart, Edit, Delete | multi-select delete/restart; bottom YAML |
| StatefulSets | Name opens Describe; copy icon beside Name | row/small chevron expands child Pods | Scale, Restart, Edit, Delete | secondary child-Pod table; bottom YAML |
| Ingresses | Name opens Describe; copy icon beside Name | row/small chevron expands rule diagnostics | Edit, Delete | secondary rules table; Services/Pods jump chips |
| Services | Name opens Describe; copy icon beside Name | row/small chevron expands ports/endpoints | Edit, Delete | secondary ports/endpoints tables; Pods/Ingress jump chips |
| PVCs | Name opens Describe; copy icon beside Name | no row-wide Describe | Edit, Delete | related Pods in Describe |
| Events | row opens Event Describe | row click is the Describe exception | no row menu | Involved Object jump chips only for visible views |
| Nodes | Name opens Describe; copy icon beside Name | no row-wide Describe | Edit | cluster-scoped; access-denied state; hidden in v1 |

If a proposed prompt adds `Describe` or `Copy name` to the row menu for a normal resource list, reject that part and use the table's Name cell pattern instead.

### Name Cell Contract

The Name cell is a compound control:

- For normal resource rows, the resource name button opens Describe.
- The copy button sits directly after the name, uses `CopyIcon`, and is hidden until hover/focus via `wl-table-hover-copy*` or `ResourceNameWithCopy`.
- Copy handlers stop row-click propagation when the row also expands.
- For expandable resources, the small chevron toggles expansion; the name still opens Describe; clicking the row background may toggle expansion when that is the established page behavior.
- Cross-resource navigation never hijacks the full resource name. Use `ResourceJumpChip` as a separate short action.

### Row Menu Contract

The row-end `⋮` menu is for operations only:

- Use the 28px circular `wl-table-menu-trigger`.
- Render `DropdownMenuPortal` only while open, aligned to the right trigger edge.
- Keep the owning row highlighted with `wl-table-row--menu-open`.
- Use `wl-menu-item` for normal actions and `wl-menu-item-danger` for destructive actions.
- Disable only the busy row, close the menu before opening a dialog or bottom tab, and keep async failure visible to the user.
- Pods may use a two-column submenu for Shell/Logs container selection with `repositionKey`; do not use that pattern for unrelated simple menus.

Do not put inspection, copying, or cross-resource jump actions in the row menu unless the user explicitly changes the product rule.

### Expand Row Contract

Expandable resource rows are currently used for StatefulSets, Ingresses, and Services.

- Expansion is an inline table row directly below the parent row, not a drawer or bottom tab.
- The parent row can toggle expansion, but the name button opens Describe and stops propagation.
- Expanded content uses `SecondaryExpandTable` when it has tabular data.
- Secondary tables have their own column keys, resize hook, `colgroup`, and horizontal scroll area.
- Long text wraps inside the cell; expanded content must not stretch the whole page.
- Use row semantic tokens such as `--wl-row-danger-tint`, `--wl-row-warning-tint`, and `--wl-row-attention-tint` for diagnostic rows.

### Describe Drawer Contract

All first-class resource Describe surfaces use the shared right-side drawer in `App.tsx`:

- A fixed full-viewport overlay with a semi-transparent backdrop.
- A right-anchored panel with draggable width, `var(--wl-bg-table)` background, and `var(--wl-border-sidebar)` left border.
- A sticky header containing resource kind, `namespace/name` or cluster-scoped name, copy, refresh when applicable, and close.
- Event Describe does not refresh through the drawer button because the event row itself is the snapshot.
- Content scrolls inside the drawer body.
- Resource content is structured sections/tables, not a pasted raw `kubectl describe` block.
- Kubernetes Events are rendered with `DescribeEventsSection` when relevant.

### Bottom Workspace Contract

The bottom workspace is for long-running or editable operational sessions:

- Logs, Shell, YAML Edit, and future similar task panels belong here.
- Describe never belongs here.
- Opening the same task again should reuse the existing tab id when that resource/container already has a tab.
- YAML Edit uses `PodYamlEditTab` and `YamlMonacoEditor`; new resource YAML edit should reuse this model unless there is a clear product reason not to.
- Bottom tabs use `wl-bottom-panel-tab`; tab-strip horizontal scroll must not create page-level horizontal scroll.

### Cross-Resource Link Contract

Cross-resource links are explicit lightweight actions:

- Use `ResourceJumpChip` for labels such as `Pods`, `Services`, `Ingress`, `PVC`, `Deploy`, or `STS`.
- The chip switches to the target visible view and applies a Name filter.
- `resolveInvolvedKindToListView` is the gate for Event Involved Object jumps.
- Hidden views return `null`; do not show disabled or misleading jump chips for hidden ConfigMaps, Secrets, Jobs, CronJobs, DaemonSets, or hidden Nodes.
- When RBAC blocks a visible target such as Nodes, the chip may render disabled with a clear title.

### Component Usage Map

Prefer these existing components and classes:

- `ResizableTh` + `useResourceListColumnResize`: main and secondary table column resizing.
- `ResourceSortArrows` + `resourceListSort.ts`: sortable table headers.
- `ClearableSearchInput`: Name filters and text search with a clear button.
- `DropdownMenuPortal`: row menus, header menus, and lightweight dropdowns.
- `SearchableDropdownPanelPortal`: searchable platform/config selectors.
- `ConfirmDialog`, `InputDialog`, and `setActionConfirm`: confirmations and one-line input.
- `ResourceAccessDeniedState`: RBAC/forbidden resource states.
- `ResourceNameWithCopy`: resource names in tables or Describe content where the name itself is not the primary Describe opener.
- `ResourceJumpChip`: cross-resource navigation.
- `SecondaryExpandTable`: row expansion sub-tables.
- `DescribeEventsSection`: Events inside resource Describe panels.
- `PodYamlEditTab` + `YamlMonacoEditor`: YAML editing in the bottom workspace.

## Resource List Architecture

Use the established list/watch model.

```text
HTTP list -> scoped raw state
Watch stream -> reducer -> same raw state
raw state -> derived columns/status/sort keys -> filter -> sort -> selection -> UI
```

Rules:

- HTTP List handles first load, scope changes, manual refresh, and Watch gap fill.
- Watch is the live update path. Do not replace Watch with polling.
- Store raw apiserver-shaped objects in state. Do not store formatted display rows as the only source of truth.
- Derive status, health, sort keys, labels, and display text in `useMemo` or resource utility files.
- Track list freshness by `cluster + namespace + resource type + refresh nonce` where the resource has first-class state.
- Watch events should merge immediately through `applyPodWatchEvent` or `applyK8sNamespacedWatchEvent` unless a resource needs a custom identity rule.
- Do not share one watch cancel ref across unrelated concurrent watches.
- Watch gap fill may use throttled list merging; it is not the main live-update path.

Relevant files:

- `web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md`
- `web/src/resourceList/watchEventReducer.ts`
- `web/src/resourceList/mergeListSnapshot.ts`
- `web/src/pages/App.tsx`
- `web/src/api.ts`
- `server/internal/httpapi/resources.go`

## Table and List UI Standards

Use the existing operational-console style: dense, scannable, restrained.

- Main list title format: `Resource Type · namespace / count`.
- Full cluster and scope context belongs in the small scope line above the list, not repeated in the title.
- Name filter only filters the current table. It does not change the applied cluster/namespace scope.
- Refresh list refreshes the current resource type and clears that page's sort state when that is the established behavior.
- Tables should use stable column widths, `table-layout: fixed` when appropriate, and avoid layout shift.
- Use `ResizableTh` and `useResourceListColumnResize` for draggable columns.
- Use `ResourceSortArrows` for sortable columns.
- When sorting is active, Watch updates may reorder rows and should keep the current sort.
- Row menu open state should keep the associated row highlighted with `wl-table-row--menu-open`.
- Bulk action bars should use `wl-bulk-*` classes and tokens.
- Multi-select should clarify when selected items are currently hidden by filters or data changes.

For secondary expanded tables:

- Use `SecondaryExpandTable` and `secondaryExpandTableConfig.ts`.
- Use separate column keys and resize hook instances from the main table.
- Use fixed layout with `colgroup` width matching headers.
- Long cell text wraps inside its cell.
- Horizontal overflow stays inside the child table container.

## Dropdown, Portal, and Menu Standards

All dropdowns, menus, and searchable panels should use the body Portal pattern.

- Use `DropdownMenuPortal` for lightweight menus.
- Use `SearchableDropdownPanelPortal` for searchable panels.
- Do not keep hidden portals mounted for every row. Render only when open.
- Do not pass an `open` prop to `DropdownMenuPortal`; opening is represented by conditional rendering.
- Use `repositionKey` when menu content height changes after opening.
- Use `Z_INDEX` constants from `web/src/constants/zLayers.ts`.
- Menus close via Escape, backdrop click, trigger toggle, or menu item action.
- Scrollable dropdown content must scroll internally and must not trigger outer page remeasure loops.

## Theme and Visual Standards

WebLens supports dark and light themes. Light theme was added later, so every visual change must be checked in both themes.

Use semantic CSS variables from `web/src/theme/tokens.css`.

Do not hardcode dark-theme-only colors inside components, especially:

- pale red text such as `#fecaca` on light backgrounds
- pale slate/gray text on light panels
- transparent red/orange backgrounds without theme-specific text colors
- fixed dark panel backgrounds in Describe or Events content

Common token families:

- `--wl-text-*`
- `--wl-bg-*`
- `--wl-border-*`
- `--wl-pill-*`
- `--wl-event-*`
- `--wl-row-*`
- `--wl-terminal-*`
- `--wl-bulk-*`
- `--wl-access-denied-*`

For warning/error/info/success states, prefer existing semantic token families or add paired light/dark tokens in `tokens.css`. Do not solve a light-theme problem with local one-off hex colors.

Never lower readability by applying `opacity` to a whole card containing text. If something needs softer emphasis, tune background, border, or muted text separately.

When changing UI, check at least:

- text on background contrast
- disabled vs normal state
- hover vs normal state
- selected/active visibility
- icon button visibility
- input border and caret visibility
- scrollbar visibility
- dropdown/menu contrast
- status pill contrast
- Shell and Monaco theme behavior

## Events and Warning Styling

Events are important for operations and must remain readable.

- Resource Describe panels should use `DescribeEventsSection`.
- Warning / Failed events use `--wl-event-warning-*` tokens.
- Normal events use `--wl-event-normal-*` tokens.
- Event card hierarchy should distinguish background, border/accent, title, body, and metadata text.
- Do not use a single light red text color for both title and body.
- Keep dark theme readable and not overly bright.

Events page behavior:

- Events list is namespaced and uses list/watch.
- Default unsorted order is triage-oriented: Warning/count/recent events first.
- Event Describe may open from row click.
- Involved Object jump chips only target visible supported views; hidden v1 views do not get jump chips.

## Bottom Workspace, YAML, Logs, Shell

Bottom workspace tabs are for operational work surfaces:

- Logs
- Shell
- YAML Edit
- future similarly scoped task panels

Do not use the bottom workspace for Describe. The bottom workspace is for long-running or editable operational sessions, while Describe is transient inspection in the right-side drawer.

Standards:

- The bottom panel content area is vertical flex with `minWidth: 0` so content fills horizontally.
- The tab strip scrolls horizontally without creating page-level horizontal scroll.
- YAML editing uses `PodYamlEditTab` and `YamlMonacoEditor`.
- Monaco must load from the local npm package through `monacoInit.ts`; do not rely on CDN.
- Preserve Sticky Scroll, minimap, folding, search, Save, Save & Close, and Cancel behavior.
- Shell uses xterm, follows theme via `--wl-terminal-*`, supports reconnect, and preserves history on reconnect.
- Logs search match colors must use log match tokens and work in both themes.

## Confirmation, Input, and Dangerous Actions

Do not use browser-native dialogs:

- no `window.confirm`
- no `window.prompt`
- no `alert`

Use:

- `ConfirmDialog` for destructive or meaningful confirmation flows.
- `InputDialog` for single-line user input.
- Existing `setActionConfirm` pattern in `App.tsx` for resource actions.

Dangerous actions should keep the dialog open if the async operation fails. Re-throw after setting the user-visible error so the dialog does not close prematurely.

## File Manager Standards

The file manager is tied to the Shell context and uses Pod exec, not SFTP.

- UI lives in `FileManagerPanel.tsx` beside Shell.
- Upload/download tasks use `FileTransferTasksPanel`.
- Delete, rename, and mkdir use WebLens dialogs, not native browser dialogs.
- Backend shell output parsed by Go must use `printf`, TAB-separated fields, explicit newlines, and clear stderr/exit-code handling.
- Do not depend on `echo` escape semantics across container images.
- Surface user-readable errors; do not silently swallow parser failures.

## Backend API Standards

Backend handlers live under `server/internal/httpapi`.

Resource APIs should follow established routes:

- `GET /api/clusters/:id/<resource>` for list.
- `GET /api/clusters/:id/<resource>/watch` for watch.
- resource-specific `describe`, `yaml`, `scale`, `restart`, `delete`, or related routes only when needed.

Rules:

- Include `serverTimeMs` in list responses.
- Include `serverTimeMs` in watch event lines.
- Keep HTTP list soft cache short and only for list, never for watch.
- Handle cluster-not-found as 404.
- Treat RBAC/forbidden intentionally; use graceful empty/limited states where existing patterns do so.
- Invalidate list cache after mutations.
- Prefer structured describe responses over raw text.
- Add focused Go tests when changing parsing, kubeconfig scanning, health derivation, or resource-specific backend behavior.

## Frontend Resource Page Checklist

When implementing a new first-class resource page, use this checklist.

### Product and Navigation

- Decide if it is visible now or hidden in `V1_HIDDEN_VIEWS`.
- If visible, add a sidebar entry in the appropriate group.
- If hidden, make sure session restore and Event jumps do not expose it.
- Do not claim the page is complete if it only uses the generic fallback table.

### API and Types

- Add or verify `ResourceKind` and `resourcePath` support in `api.ts`.
- Add list/watch backend routes if absent.
- Add resource-specific operation APIs only as product scope requires.
- Define explicit TypeScript types for derived rows when useful.

### State and Data Flow

- Add resource-specific state if the page is visible or behavior is non-trivial.
- Implement scoped list skip and refresh nonce if it should behave like other first-class pages.
- Use watch reducer into raw state.
- Add watch gap fill if the resource needs the same robustness as existing first-class lists.
- Keep derived table rows separate from raw state.

### Table

- Build a resource-specific table component for visible pages.
- Include Name, Namespace where relevant, Status/summary columns, Age when useful, and Actions when operations exist.
- Make Name open Describe if Describe exists.
- Add copy icon next to Name.
- Add sorting using `resourceListSort.ts` when columns are sortable.
- Add column resize with `ResizableTh`.
- Add loading and empty states.

### Actions

- Row menu should contain operations, not Describe and not resource-name copy actions.
- Use Portal dropdowns.
- Use WebLens confirmation/input dialogs.
- Mutations should update local state or trigger a scoped refresh.
- Mutations should report errors without closing dialogs prematurely.

### Describe

- Add structured backend describe endpoint when appropriate.
- Add describe content component under `web/src/components/describe/`.
- Use shared section/table/tag/event styles.
- Include Events if Kubernetes events are relevant.
- Use ResourceNameWithCopy and ResourceJumpChip appropriately.
- Open from Name, not from row menu.

### YAML Edit

- Use bottom workspace tab pattern.
- Reuse `PodYamlEditTab` / `YamlMonacoEditor` where possible.
- Keep Save, Save & Close, Cancel behavior consistent.
- Merge saved result into the relevant list state when backend returns the updated object.

### Docs

- User-visible behavior goes in `doc/guide/`.
- Architecture, protocol, tokens, and implementation notes go in `doc/dev/`.
- Add a `doc/dev/changelog.md` entry for meaningful changes.
- Root `README.md` changes only for major core capabilities or startup/config changes.

## Documentation Policy

Use this hierarchy:

- `README.md`: major features, startup, tech stack, important configuration.
- `doc/README.md`: documentation index.
- `doc/guide/`: user-visible workflows and behavior.
- `doc/dev/`: architecture, protocols, data flow, UI/token implementation, changelog.
- `web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md`: resource list technical contract.

Do not document every small style tweak in README. Do document user-visible behavior and non-obvious engineering contracts in `doc/`.

## Validation Expectations

Before finishing implementation:

- Run `git diff --check`.
- Run targeted frontend build or type check when feasible.
- Be aware the repository may have pre-existing TypeScript errors; identify whether new errors are caused by the current change.
- For frontend UI work, verify light and dark themes conceptually at minimum; use browser screenshots when a local browser/test stack is available.
- Verify no generated build output, logs, dependency directories, or local release artifacts are accidentally staged.

Known generated/ignored paths include:

- `web/node_modules/`
- `web/dist/`
- `server/bin/`
- `release/`
- `logs/`

## Git and Change Scope

- Do not revert user changes unless explicitly asked.
- Keep changes scoped to the requested product behavior.
- Avoid broad refactors while implementing a resource page.
- Do not push unless the user asks.
- When asked to clean or reset, distinguish between commits, tracked working-tree edits, and untracked files.

## Prompting ChatGPT / Product Manager Memory

When using ChatGPT to convert plain-language requests into coding prompts for this project, include or rely on this file and ask it to preserve these constraints:

- First compare new resource-page requests against the completed-page behavior matrix in this file.
- Describe opens from resource name, not the three-dot menu.
- Copy name is a hover/focus icon beside the resource name, not a three-dot menu item.
- Row menus are for operations only.
- New visible resource pages need first-class table/Describe/action/docs treatment, not only generic list plumbing.
- Use list/watch architecture and raw-state derivation.
- Use theme tokens for light/dark; no dark-theme hardcoded colors in components.
- Use Portal menus and WebLens dialogs.
- Update docs in the right layer; README only for major core capability changes.

If a generated prompt conflicts with this file, this file wins unless the user explicitly changes the product rule.
