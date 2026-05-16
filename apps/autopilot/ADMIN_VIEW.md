# Autopilot Admin View

This is the source of truth for the target Autopilot admin information
architecture. The product roadmap and task breakdown live in `PRODUCT_PLAN.md`.

## Product Direction

Autopilot is a Linear-like issue tracker with workflow automation.

It is not a productized admin UI for agent runtime internals. Runtime tables and
debug state should be available only through issue activity, advanced settings,
or developer/debug surfaces.

## Target Navigation

```txt
Home
Issues
Workflows
Schedules
Knowledge
Projects
Settings
```

Every top-level item must be understandable to a non-technical user.

## Product Labels

Use two layers deliberately:

- Internal names preserve current collection/API compatibility.
- Product labels shape the user-facing experience.

| Internal collection | Product label | Notes                                                     |
| ------------------- | ------------- | --------------------------------------------------------- |
| `tasks`             | Issues        | Main Linear-like work item.                               |
| `workflow_configs`  | Workflows     | Reusable procedure for handling issues.                   |
| `schedules`         | Schedules     | Time-based trigger that creates issues or runs workflows. |
| `knowledge`         | Knowledge     | Context, docs, rules, references.                         |
| `projects`          | Projects      | Workspaces/repos/scopes.                                  |
| `runs`              | Executions    | Internal/debug only, not top-level.                       |

Do not use `Agent Runs` as a primary product surface. If execution details are
needed, show them inside issue detail activity or advanced/debug areas.

## Target Surfaces

| Surface            | Route shape                           | Source                                                | Product purpose                                                    |
| ------------------ | ------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Home               | `/admin`                              | `src/questpie/server/config/admin.ts`                 | Product dashboard for issue and schedule health.                   |
| Issues             | `/admin/collections/tasks`            | `src/questpie/server/collections/tasks.ts`            | Main issue tracker surface.                                        |
| Workflows          | `/admin/collections/workflow_configs` | `src/questpie/server/collections/workflow-configs.ts` | Reusable work procedures.                                          |
| Schedules          | `/admin/collections/schedules`        | `src/questpie/server/collections/schedules.ts`        | Recurring triggers/actions.                                        |
| Knowledge          | `/admin/collections/knowledge`        | `src/questpie/server/collections/knowledge.ts`        | Product context and references.                                    |
| Projects           | `/admin/collections/projects`         | `src/questpie/server/collections/projects.ts`         | Workspaces/repos/scopes.                                           |
| Project inspection | `/admin/project-inspection`           | `src/questpie/admin/pages/project-inspection.tsx`     | Multi-resource command surface for workspace diff/file inspection. |

## Hidden From Normal Navigation

These should not be top-level product areas:

- `runs`
- `run_events`
- `workers`
- `worker_leases`
- `schedule_executions`
- `task_relations`
- `models`
- `providers`
- `environments`
- `secrets`
- `scripts`
- chat internals
- audit log

If needed, expose them through Advanced settings or developer/debug surfaces.

## View Rules

Use reusable admin capabilities before adding app-specific pages:

- Lists: `v.listView(...)` with columns, search, quick filters, saved views,
  dense rows, and optional outline behavior.
- Forms: `v.collectionForm(...)` with tabs, sections, sidebar, descriptions,
  and advanced sections.
- Detail-specific extras should become reusable form/list capabilities before
  they become one-off Autopilot views.

No wizard for now. `collectionForm` is the default create/edit surface.

Current justified custom page:

- `project-inspection`, because it is a multi-resource runtime command surface.

Potential future custom surface:

- Issue detail, only if activity/actions cannot be expressed cleanly through
  collection form/detail composition.

Reusable custom views we may add to `packages/admin`:

- Issue list/board view if configured `v.listView(...)` cannot reach a
  Linear-like feel.
- Issue detail composition with header, properties sidebar, activity timeline,
  latest result, and internal execution debug.
- Activity/timeline section that can be reused by issues, workflows, schedules,
  and other apps.
- Workflow steps editor if the current object/blocks form UI is not enough for
  editing procedures.
- Schedule action/template sections if plain form sections cannot clearly model
  create-issue/run-workflow behavior.

Do not add a wizard view for the current Autopilot plan.

## Custom View Quality Bar

Custom views must be crisp, simple, built on admin primitives, and maintainable.

Rules:

- Start from existing primitives: `Button`, `Badge`, `Tabs`, table/list
  primitives, form fields, menus, dialogs/drawers, cards where appropriate, and
  Iconify Phosphor icons.
- Avoid app-local primitives unless a reusable `packages/admin` primitive is
  genuinely missing.
- Do not duplicate primitive behavior. Reuse or extract shared controls into
  `packages/admin`.
- Keep views operational and dense. Do not introduce decorative hero sections,
  marketing layouts, or one-off visual systems.
- Compose product-specific layouts from generic primitives and server-emitted
  config.
- Keep code layered: view composition, data/action helpers, formatting helpers,
  and primitives should stay separable.
- Avoid giant one-file custom views that mix querying, mutation logic, layout,
  formatting, and low-level controls.
- Keep server-emitted view config serializable and small.
- Prefer typed helpers and existing collection/client APIs over ad hoc string
  manipulation.
- Add focused tests or browser checks when a reusable primitive or view
  capability is added.
- Do not put cards inside cards or create nested decorative panels.
- Use icon buttons with clear tooltips for compact actions.
- Keep hit areas at least 40 by 40 px.
- Use tabular numerals for counts, timers, and changing metrics.
- Use subtle press feedback and specific transitions. Never use
  `transition: all`.
- Use balanced headings and readable body wrapping.

## What Belongs In Framework Work

Framework work should generalize capabilities:

- Better list-view filters, quick filters, and default saved views.
- Better form/detail composition.
- Reusable activity/timeline sections.
- Reusable issue-like list/detail views without Autopilot-specific names.
- Dashboard widgets and linked metric cards.
- Shell/advanced settings organization.

Framework work must not hardcode Autopilot collection names or labels.

## What Belongs In Autopilot

Autopilot owns:

- Product labels and sidebar grouping.
- Dashboard widget composition.
- Which collections appear in product navigation.
- Issues, Workflows, Schedules, Knowledge, and Projects form/list config.
- Project inspection page.
- Whether runtime internals are shown in issue detail, Advanced settings, or not
  at all.

## Related Docs

- `PRODUCT_PLAN.md` owns the consolidated product vision, package boundaries,
  roadmap, and task breakdown.
- `MIGRATION_STATUS.md` tracks migration progress and technical parity.
- `MIGRATION_NOTES.md` keeps historical migration notes.
- `docs/prototypes/admin-wizard-prototype.html` is generic framework research
  only. It is not part of the current Autopilot product plan.
