# Autopilot Admin UI Gaps

This document records the current admin list/table surface after reading
`packages/admin/DESIGN.md`, `apps/autopilot/ADMIN_VIEW.md`, and the active list
and table view implementations.

## Source Files Studied

- `packages/admin/DESIGN.md`
- `packages/admin/src/client/views/collection/list-view.tsx`
- `packages/admin/src/client/views/collection/table-view.tsx`
- `packages/admin/src/client/views/collection/quick-filter-bar.tsx`
- `packages/admin/src/client/components/filter-builder/filter-builder-sheet.tsx`
- `packages/admin/src/client/hooks/use-view-state.ts`

## Current Issues Header Controls

| UI element              | Current behavior                                                                                   | Design assessment                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Search icon             | Toggles an inline `SearchInput` panel and shows a small dot when a search term exists              | Correct primitive and compact enough.                                                                 |
| Sliders icon            | Opens `FilterBuilderSheet` with realtime, soft-delete, grouping, columns, filters, and saved views | Correct direction. This should become the main place for advanced view state.                         |
| Sort controls           | Sorting now lives in `FilterBuilderSheet` view options instead of the list header                  | Correct shared primitive path. Product pages no longer expose raw field names as top-level chrome.    |
| Header actions / Create | Renders generic collection header actions and create/upload actions                                | Correct primitive path, but Autopilot needs product actions for prompt-created and manual issues.     |
| Quick filter bar        | Applies server-emitted filter presets with button primitives and optional tooltips                 | Good primitive. Needs product labels and should stay near the list body, not become a second topbar.  |
| List rows               | Render compact issue rows with checkbox, outline expander, title, badges, meta fields, row actions | Good direction. Needs stricter parity with table state and regression coverage for outline row IDs.   |
| Bulk/filter toolbar     | Floating toolbar for selection and active filters                                                  | Good primitive if it remains neutral, tabular, and does not duplicate always-visible header controls. |
| Pagination footer       | Uses the same range, page-size select, page buttons, and tabular numerals as table view            | Correct parity path. Keep pagination behavior shared or extracted if the duplication grows.           |

## Gaps

1. Raw sort field select in the header

   Resolved in the shared admin layer. The list header no longer renders the
   field selector/direction button. Sorting is configured inside
   `FilterBuilderSheet` with translated labels and reused by saved/current view
   state.

2. Sort defaults and system fields

   Autopilot Issues wants `updatedAt desc` by default. List view already accepts
   `defaultSort`, but the current header fallback and persisted view state make
   system fields visible as raw controls. The next fix should preserve default
   sort behavior without making system field names a normal product control.

3. Table/list parity

   Partially resolved. Sort configuration and pagination are now aligned.
   Remaining duplication is mostly rendering code: list and table each build
   their own pagination markup and search result footer. Extract a shared data
   view pagination primitive if a third view needs it.

4. Product sections still need table-view verification

   Browser checks showed Issues rendering seeded rows, but Projects/Workflows/
   Schedules/Knowledge still need verification because product sections can stay
   on the table skeleton. This is likely a view registry, Suspense, query, or
   generated-client issue and should be investigated before closing the seed
   task.

5. Knowledge outline needs regression coverage

   The list view needed a fallback from TanStack row IDs to original document
   IDs so outline rows did not render blank. The seed now includes nested
   Knowledge paths and task-scoped records; the framework still needs a focused
   regression test for outline row rendering.

6. Product create actions are missing

   Generic collection creation is functional, but Autopilot needs custom
   product actions:
   - prompt-driven issue creation that dispatches AI to produce structured
     issues
   - manual Linear-like issue creation with title, markdown description,
     project, priority, workflow, and schedule/start options

7. Markdown issue description primitive is missing

   Issue descriptions should not stay as a plain textarea forever. The reusable
   admin primitive should be a markdown editor field, likely Tiptap-backed live
   markdown or a similar Linear/Notion/Obsidian-like editing surface.

8. Chat rail is unresolved

   Autopilot currently has chat internals but no product chat rail. The product
   decision should determine whether chat belongs on Home, issue detail,
   workflow detail, or a persistent contextual rail.

## Next Framework Tasks

- Add a reusable sorting section to `FilterBuilderSheet` or another shared view
  options primitive.
- Remove the raw sort field select from `list-view.tsx` after the shared sorting
  primitive exists.
- Add regression coverage for list outline rows keyed by original document IDs.
- Investigate why some product sections remain on `TableViewSkeleton`.
- Design reusable admin custom actions for product create flows before adding
  Autopilot-specific UI.
