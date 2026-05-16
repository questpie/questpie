# Autopilot Product Plan

This document is the working plan for turning Autopilot from an admin surface
over runtime tables into a focused product.

## Vision

Autopilot is a Linear-like issue tracker with workflow automation.

Users should think in these terms:

- I have an issue that needs work.
- I can attach or run a workflow that describes how Autopilot should handle it.
- I can schedule recurring work that creates issues or runs workflows.
- Autopilot keeps execution details, workers, leases, and events internally.

Autopilot is not a top-level admin UI for agent runtime internals.

## Product Model

| Product concept | Internal collection today | Product meaning                                          |
| --------------- | ------------------------- | -------------------------------------------------------- |
| Issues          | `tasks`                   | User-facing work items, Linear-style.                    |
| Workflows       | `workflow_configs`        | Reusable procedures for handling issues.                 |
| Schedules       | `schedules`               | Time-based triggers that create issues or run workflows. |
| Knowledge       | `knowledge`               | Context, docs, rules, references.                        |
| Projects        | `projects`                | Workspaces/repos/scopes where issues apply.              |

The internal names can stay for compatibility. The product labels should move
to the product model above.

## Top-Level Navigation

Target sidebar:

```txt
Home
Issues
Workflows
Schedules
Knowledge
Projects
Settings
```

Do not expose these as top-level product areas:

- Agent runs
- Run events
- Workers
- Worker leases
- Schedule executions
- Task relations
- Models
- Providers
- Environments
- Secrets
- Scripts

These can appear inside issue activity, advanced settings, or developer/debug
surfaces when needed.

## Package Boundaries

### `apps/autopilot`

Owns product decisions:

- Product naming and labels.
- Sidebar and dashboard composition.
- Collection form/list config for issues, workflows, schedules, knowledge, and
  projects.
- App-specific configuration of reusable custom admin views.
- Product-specific custom pages only when a generic collection surface cannot
  express the workflow.
- Issue detail experience and activity timeline.
- Which runtime internals are hidden or shown as advanced/debug.

### `packages/admin`

Owns reusable admin capabilities:

- Collection list polish, filters, quick filters, saved views, density, row
  actions.
- Collection form tabs, sections, sidebar, field descriptions, empty states.
- Reusable custom views for product-grade collection surfaces.
- Dashboard widgets and action cards.
- Generic shell/rail extension points.

It must not hardcode Autopilot concepts such as issues, workflows, schedules,
workers, or models.

### `packages/workflows`

Owns durable workflow engine behavior:

- Workflow definitions, steps, events, retries, cron primitives, retention.
- Generic workflow services and routes.
- Optional generic admin/debug views.

The workflow package should not force workflow engine tables into product
sidebars. Product apps decide whether workflow runtime UI is visible.

### `packages/mcp`

Owns generic MCP server/tool registration infrastructure.

Autopilot owns Autopilot-specific MCP tools and labels.

### `packages/questpie`

Owns framework foundations:

- Codegen.
- Module merge semantics.
- Context system.
- Route/service typing.
- Collection CRUD and introspection.

Framework fixes should be generic and should not solve Autopilot by name.

## Product Rules

- Top-level navigation only contains concepts a non-technical user understands.
- Runtime state belongs in activity/debug surfaces, not primary navigation.
- Issues are the main object. Schedules and workflows should usually produce or
  act on issues.
- Use `collectionForm` tabs/sections before adding custom view types.
- No wizard for now. Existing forms are strong enough.
- Prefer generic admin improvements over one-off Autopilot pages.
- A custom page is justified only for multi-resource command surfaces such as
  project inspection.

## Interface Quality Bar

Custom views must feel crisp, simple, primitive-based, and easy to maintain.

Rules:

- Build from existing admin primitives first: buttons, badges, tabs, tables,
  cards, form fields, menus, drawers/dialogs, and Iconify Phosphor icons.
- Do not create a local mini design system inside Autopilot views.
- Do not duplicate primitive behavior. If multiple views need the same control,
  extract it into `packages/admin` or reuse an existing primitive.
- Do not make decorative dashboards or marketing-like screens. These are
  operational product surfaces.
- Keep information dense but calm: fewer concepts, clear hierarchy, predictable
  layout.
- Use product-specific composition, not product-specific primitives.
- Prefer configuration of reusable `packages/admin` views over one-off
  Autopilot JSX.
- If a custom view needs new UI behavior, extract the behavior into a reusable
  admin primitive or view capability.
- Keep view code shallow: data loading, formatting, actions, and presentational
  primitives should be separated when the file starts mixing concerns.
- Avoid clever abstractions. Add abstractions only when they remove real
  duplication across views.
- Keep server-emitted view config serializable and small. Do not smuggle runtime
  behavior into config objects.
- Prefer typed helpers and existing collection/client APIs over ad hoc string
  manipulation.
- Add focused tests or browser checks for reusable view behavior, not snapshots
  of incidental markup.
- Dynamic numbers must use tabular numerals.
- Interactive controls need at least a 40 by 40 px hit area.
- Buttons and clickable rows should use subtle press feedback, not heavy motion.
- Use specific transitions, never `transition: all`.
- Headings should wrap cleanly; body text should avoid awkward orphans.
- Icon buttons must be optically centered and use tooltips when meaning is not
  obvious.

## Roadmap

### Phase A - Consolidate Language And Navigation

Goal: remove the current mixed admin/runtime vocabulary.

Tasks:

- [x] Rename product label `Tasks` / `Work` to `Issues`.
- [x] Rename product label `Workflow Configs` / `Automation Plans` to
      `Workflows`.
- [x] Keep internal collection names unchanged unless a migration is explicitly
      planned.
- [x] Replace sidebar with Home, Issues, Workflows, Schedules, Knowledge,
      Projects, Settings.
- [x] Hide agent runs, run events, workers, leases, schedule executions, task
      relations, models, providers, environments, secrets, and scripts from
      normal navigation.
- [x] Add an Advanced/Developer settings grouping for infrastructure-only
      collections if we still need admin access.

Acceptance:

- A non-technical user can describe every top-level sidebar item.
- No runtime execution table appears as a primary product area.
- `ADMIN_VIEW.md` matches the actual target IA.

### Phase B - Make Issues Linear-Like

Goal: make issues the core product surface.

Tasks:

- [ ] Configure Issues list with Linear-like columns: title, status, priority,
      project, workflow, updated date.
- [ ] Add quick filters: Open, Needs review, Needs attention, Done, Scheduled.
- [ ] Set default Issues view to open/non-done work.
- [ ] Rename status labels into user language:

| Internal status | Product label   |
| --------------- | --------------- |
| `backlog`       | Backlog         |
| `pending`       | Todo            |
| `running`       | In progress     |
| `waiting`       | Waiting         |
| `review`        | In review       |
| `failed`        | Needs attention |
| `done`          | Done            |
| `cancelled`     | Cancelled       |

- [ ] Rework issue create/edit form using `collectionForm` tabs:

| Tab        | Fields / intent                               |
| ---------- | --------------------------------------------- |
| Issue      | Title, description, priority.                 |
| Context    | Project, scope, knowledge/context references. |
| Automation | Workflow, scheduled/start options, defaults.  |
| Advanced   | Raw metadata and internal fields.             |

- [ ] Move execution history into issue detail as activity/debug, not its own
      top-level screen.
- [ ] Add issue activity timeline: created, workflow started, run completed,
      failed, review requested, schedule-created.

Acceptance:

- The Issues page feels like an issue tracker, not a table of task runtime rows.
- Users can create an issue without understanding workers, runs, providers, or
  models.
- A failed execution is visible as issue state/activity.

### Phase C - Make Workflows Procedures

Goal: workflows read as reusable procedures, not low-level workflow config.

Tasks:

- [ ] Product label is `Workflows`.
- [ ] List columns: name, purpose, steps count, default project/skill,
      last used/updated.
- [ ] Rework form tabs:

| Tab      | Fields / intent                                |
| -------- | ---------------------------------------------- |
| Overview | Name, description, purpose.                    |
| Steps    | Ordered steps/procedure.                       |
| Defaults | Project, issue defaults, skill/model defaults. |
| Advanced | Raw config and runtime details.                |

- [ ] Rename fields away from engine language where possible.
- [ ] Ensure workflow steps have human-readable names and descriptions.
- [ ] Decide whether workflow detail needs a custom step-builder later; defer
      until `collectionForm` is exhausted.

Acceptance:

- A user can understand what a workflow does from its list row and overview.
- Editing workflow steps does not require reading raw JSON unless in Advanced.

### Phase D - Make Schedules Triggers

Goal: schedules are recurring triggers that create issues or run workflows.

Tasks:

- [ ] Keep top-level label `Schedules`.
- [ ] List columns: name, enabled, action, project, next run, last run.
- [ ] Rework form tabs:

| Tab      | Fields / intent                                            |
| -------- | ---------------------------------------------------------- |
| Schedule | Enabled, frequency, next run.                              |
| Action   | Create issue, run workflow, or create issue with workflow. |
| Template | Issue title, description, project, default workflow.       |
| Advanced | Raw cron, concurrency, metadata.                           |

- [ ] Prefer user-facing schedule presets over raw cron in primary fields.
- [ ] Make schedule output visible through created issues or issue activity.
- [ ] Hide `schedule_executions` from product navigation.

Acceptance:

- A user can explain what will happen and when.
- Raw cron is optional/advanced.
- Schedule execution history does not become a separate product concept.

### Phase E - Rebuild Home Around Product State

Goal: Home summarizes issues and automation health.

Tasks:

- [ ] Dashboard metrics: Open issues, In review, Needs attention, Active
      schedules.
- [ ] Dashboard CTAs: New issue, New workflow, New schedule.
- [ ] Recent activity should show issue/workflow/schedule activity, not raw run
      events.
- [ ] Empty state for a fresh install: create project, create issue, add
      knowledge, create schedule.
- [ ] Make dashboard cards link to filtered product views.

Acceptance:

- Home tells a product story without runtime terminology.
- Empty data state guides setup instead of showing blank internals.

### Phase F - Settings And Advanced Surfaces

Goal: keep power-user controls available without polluting the product.

Tasks:

- [ ] Settings default section: Projects and basic product settings.
- [ ] Advanced settings section: connections/providers, models, environments,
      secrets, workers, scripts.
- [ ] Ensure advanced labels explain risk and purpose.
- [ ] Keep dangerous or technical settings out of first-run flow.

Acceptance:

- Normal users can ignore Advanced.
- Operators can still debug/configure infrastructure when needed.

### Phase G - Reusable Admin Views

Goal: add product-grade admin views only where generic lists/forms are not
enough. New views must stay crisp, primitive-based, and reusable.

Tasks:

- [ ] Add an `issue-board` or `issue-list` view if `v.listView(...)` cannot feel
      Linear-like with config alone.
- [ ] Add an issue detail composition capability: header, properties sidebar,
      activity timeline, latest result, and internal execution debug section.
- [ ] Add a reusable activity/timeline view section backed by collection data or
      a loader.
- [ ] Add a workflow steps editor only if the current `blocks`/object form UI is
      not good enough for procedure editing.
- [ ] Add schedule action/template form sections if raw `collectionForm` config
      cannot clearly express create-issue/run-workflow behavior.
- [ ] Keep Project Inspection as an app-specific page because it is a
      multi-resource command surface.
- [ ] Do not add a wizard view in this phase.
- [ ] Build new views from existing admin primitives before adding new
      components.
- [ ] Add only small, reusable primitives when existing primitives are
      insufficient.
- [ ] Keep view implementation code small and layered: reusable primitives,
      data/action helpers, and collection-specific config should not collapse
      into one large component.
- [ ] Add reusable primitive tests or browser checks for any shared behavior.
- [ ] Apply the interface quality bar: tabular numbers, 40 px hit areas,
      specific transitions, subtle press feedback, balanced headings, and
      optically centered icons.

Acceptance:

- Any new view added to `packages/admin` is reusable and does not mention
  Autopilot entities by name.
- Autopilot can configure the view through server-emitted view config.
- Existing `v.collectionForm(...)` and `v.listView(...)` behavior stays
  unchanged.
- View code reuses primitives and avoids copy-pasted one-off controls.
- The view feels like a crisp product tool, not a custom admin page or
  decorative dashboard.

### Phase H - Package Health And Type Safety

Goal: make future product iteration safe.

Tasks:

- [ ] Fix generated module type circularity.
- [ ] Fix recursive `Questpie.AppContext` typing.
- [ ] Fix route param assignability for dynamic routes.
- [ ] Add missing `virtual:iconify-preload` type declaration.
- [ ] Fix `#questpie/admin/client/*` alias type resolution.
- [ ] Add/fix Bun type resolution.
- [ ] Ensure `bun run typecheck` passes in `apps/autopilot`.

Acceptance:

- Autopilot typecheck passes.
- Product changes no longer hide behind generated/type-system failures.

### Phase I - Demo Data And Acceptance Scenario

Goal: make the product reviewable.

Tasks:

- [ ] Seed one project.
- [ ] Seed several issues in different statuses.
- [ ] Seed one workflow with readable steps.
- [ ] Seed one schedule that creates an issue.
- [ ] Seed knowledge entries used by an issue/workflow.
- [ ] Add a browser acceptance checklist for Home, Issues, Workflows, Schedules,
      Knowledge, Projects, Settings.

Acceptance:

- Fresh local run can show the intended product without manual setup.
- Browser review validates the product IA, not just API behavior.

## Open Decisions

- Should the product label be `Issues` everywhere, or `Tasks` in some contexts?
  Current direction: use `Issues`.
- Should schedules always create issues, or may they run workflows without an
  issue? Current direction: primary path creates issues; direct workflow run is
  advanced.
- Should models/providers be hidden entirely or available under Advanced
  settings? Current direction: Advanced settings.
- Should issue detail become a custom product view? Current direction: first
  exhaust `collectionForm`; custom detail only if timeline/actions cannot be
  expressed cleanly.
