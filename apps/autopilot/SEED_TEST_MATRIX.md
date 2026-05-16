# Autopilot Seed Test Matrix

This document describes the local demo data used to test Autopilot as a product
surface instead of a runtime admin.

## Commands

From `apps/autopilot`:

```bash
bun run db:setup
bun run db:seed
bun run db:seed:status
```

Local admin login:

- Email: `info@questpie.com`
- Password: `admin123`

## Seeds

| Seed ID                    | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `autopilotDemoProductData` | Base product demo: one project, workflow, schedule, knowledge note, issues |
| `autopilotDemoCoverageData` | Expanded coverage for lists, outlines, relations, schedules, and statuses  |

Both seeds are dev seeds and should be safe to run repeatedly. The coverage
seed is separate so existing local databases do not need to reset the first
seed record.

## Coverage Matrix

| Surface   | Seeded coverage                                                                                         | What to inspect                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Issues    | All user-facing statuses, priorities, projects, workflows, scheduled issues, done/cancelled issues       | Quick filters, default open filter, relation cells, status labels, priority badges, row actions     |
| Workflows | Enabled and disabled procedures, multiple projects, default skills, varying step counts                  | List density, procedure language, steps JSON rendering, default project/skill relation rendering    |
| Schedules | Create-issue schedules and direct workflow schedule, enabled/disabled, next/last run dates               | Product action labels, schedule/action/template tabs, next run sort, advanced direct-run visibility |
| Knowledge | Company/project/task scope, nested slash paths, synthetic folders, relation expansion, markdown content  | Nested outline rows, group headers, folder expansion, task/project relation cells, blank-row issues  |
| Projects  | GitHub/generic providers, repo paths, branches, provider config JSON, metadata                           | Table view loading, git connection fields, future custom project actions                           |
| Skills    | Enabled and disabled capabilities, different projects, tool/context refs                                 | Settings-only visibility, relation rendering in workflows                                          |

## Expected Product Path

Normal user testing should stay in:

- `/admin/collections/tasks`
- `/admin/collections/workflow_configs`
- `/admin/collections/schedules`
- `/admin/collections/knowledge`
- `/admin/collections/projects`

Runtime tables such as runs, workers, leases, events, models, providers,
secrets, scripts, and chat internals are not part of the primary seed test path.

## Current Verification State

- `Issues` renders 14 seeded rows in the list view, including coverage issues.
- `Knowledge` renders outline root groups from seeded company/project/task
  knowledge fixtures.
- `Workflows` renders 3 seeded workflows.
- `Schedules` renders 4 seeded schedules.
- `Projects` renders 3 seeded projects in `collectionTable`.
- The header still exposes raw sort fields such as `createdAt`, `path`, and
  `nextRunAt`; that is documented in `ADMIN_UI_GAPS.md` as framework work.
- Typecheck still fails on existing generated/codegen issues unrelated to the
  seed data.
