# Autopilot Admin View

This is the source of truth for the Autopilot admin information architecture.
Keep framework-level wizard/list/form ideas out of this file unless Autopilot
actually uses them.

## Shape

Autopilot is an admin shell with:

- Home dashboard for queue health and recent activity.
- Collection-first CRUD surfaces for data-backed resources.
- Persistent chat/work rail for operator interaction.
- One custom project-inspection page for workspace diff/file inspection.

Do not add app-specific CRUD pages when a collection list/detail view is enough.

## Current Surfaces

| Surface | Route | Source | Notes |
| --- | --- | --- | --- |
| Home | `/admin` | `src/questpie/server/config/admin.ts` | Dashboard widgets and quick actions. |
| Tasks | `/admin/collections/tasks` | `src/questpie/server/collections/tasks.ts` | Product label is currently `Work`. Collection name stays `tasks`. |
| Runs | `/admin/collections/runs` | `src/questpie/server/collections/runs.ts` | Agent execution history. |
| Knowledge | `/admin/collections/knowledge` | `src/questpie/server/collections/knowledge.ts` | Folder-like collection list via `outline`. |
| Schedules | `/admin/collections/schedules` | `src/questpie/server/collections/schedules.ts` | Product label is currently `Scheduled Work`. Collection name stays `schedules`. |
| Workflow configs | `/admin/collections/workflow_configs` | `src/questpie/server/collections/workflow-configs.ts` | Product label is currently `Automation Plans`. Collection name stays `workflow_configs`. |
| Project inspection | `/admin/project-inspection` | `src/questpie/admin/pages/project-inspection.tsx` | Custom page is justified because it is a multi-resource command surface. |
| Chat rail | admin shell rail | `src/questpie/admin/components/autopilot-work-rail.tsx` | Persistent operator rail, not a separate page. |

## Naming

Use two layers deliberately:

- Database/framework names: `tasks`, `runs`, `knowledge`, `schedules`,
  `workflow_configs`.
- Product labels: short labels shown in the sidebar and dashboard.

Current product labels:

| Collection | Product label |
| --- | --- |
| `tasks` | `Work` |
| `runs` | `Agent Runs` |
| `knowledge` | `Knowledge Base` |
| `schedules` | `Scheduled Work` |
| `workflow_configs` | `Automation Plans` |

If these labels feel too abstract, change them in collection `.admin()` config,
not in framework docs or wizard prototypes.

## View Rules

Autopilot should use reusable admin capabilities:

- Lists: `v.listView(...)` with columns, search, filters, dense row layout,
  and optional `outline`.
- Forms: `v.collectionForm(...)` or thin custom form views that reuse the
  collection form component.
- Detail-specific extras should become reusable form capabilities before they
  become one-off Autopilot views.

Current custom form views:

- `task-detail`
- `knowledge-detail`

They are currently thin aliases over the built-in `collection-form` client
component. Treat their extra config fields as product intent, not as complete
custom UI yet.

## What Belongs In Framework Work

Framework work should generalize capabilities:

- Better `list-view` outline behavior.
- Better detail/form composition.
- First-class wizard form view.
- Shell rail extension points.
- Dashboard widgets and quick actions.

Framework work must not hardcode Autopilot collection names or labels.

## What Belongs In Autopilot

Autopilot should own:

- Product labels and sidebar grouping.
- Dashboard widget composition.
- Which collections appear in Work, Knowledge, Automations, and Settings.
- Project inspection page.
- Chat/work rail behavior.
- Collection form/list configuration for its own resources.

## Wizard Prototype

The local prototype at:

```txt
docs/prototypes/admin-wizard-prototype.html
```

is intentionally generic. It is only for the framework wizard pattern. Do not
use it as the Autopilot IA source of truth.

If Autopilot later adopts wizard create flows, configure them per collection and
keep edit flows boring unless a specific operator workflow needs otherwise.

## Related Docs

- `MIGRATION_STATUS.md` tracks migration progress.
- `MIGRATION_NOTES.md` keeps historical migration notes.
- This file owns admin-view decisions going forward.
