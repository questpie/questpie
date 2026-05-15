# Autopilot Migration Status

Canonical plan: `/Users/drepkovsky/questpie/repos/questpie-autopilot/MIGRATION_PLAN.md`.
The old `questpie-autopilot` repo is read-only reference material.
Canonical admin-view decisions for this app live in `ADMIN_VIEW.md`.

## Current State

### Done

- Phase 0 scaffold is in place under `apps/autopilot`.
- Phase 1 collections are implemented: 21 QuestPie collections, hidden join/lease
  collections, admin labels/icons/forms/list config, and generated migration.
- Phase 2 service/route surface exists: provider runtime, worker manager, git
  adapters, Knowledge resource service, command routes, worker routes, legacy
  aliases, run events, completion, run artifacts, enrollment, stream/events, and
  workspace inspection routes.
- Phase 3 workflows/jobs exist: task pipeline, chat query, multi-step task,
  schedule tick, task escalation, worker timeout, cleanup.
- Framework admin has reusable `list-view` and outline row model support. Tasks
  and Knowledge use collection views, not custom app pages.
- Task and Knowledge details are collection form views.
- Chat operations live in the persistent admin shell rail. There is no separate
  `/admin/chat` operator page; the rail owns chat history, thread, composer,
  run stream, context attachments, and global drop handling.
- MCP is a first-class QuestPie module through `@questpie/mcp`, `config/mcp.ts`,
  and app-local MCP tools.
- Worker auth accepts `X-Worker-Secret`, `Authorization: Bearer`, and loopback
  local-dev calls outside production.
- Legacy worker aliases exist for register, heartbeat, claim, deregister,
  enrollment, run events, completion, and run artifacts.
- Legacy worker cleanup read alias exists at `GET /api/runs/:runId`, returning
  `task_id`, `project_id`, and `worker_id` compatibility fields.
- Mock worker HTTP contract E2E covers join token creation, enrollment,
  register, heartbeat, claim, run status read, progress event, artifact upload,
  completion, lease release, workflow events, task status update, and Knowledge
  provenance.
- Chat realtime/workflow contract smoke covers `POST /api/chat`,
  `/api/run-stream`, worker claim/event/complete notifications, run event
  deduplication, and `chat-query` assistant message finalization with mocked
  durable events.

### Verified

- `bun run generate` in `apps/autopilot` discovers 21 collections, 4 jobs,
  24 routes, 4 services, 3 workflows, and 23 MCP tools.
- Focused worker/MCP tests pass:
  - `worker-auth.test.ts`
  - `legacy-worker-contract.test.ts`
  - `legacy-run-artifacts.test.ts`
  - `mock-worker-e2e.test.ts`
  - `autopilot-mcp-smoke.test.ts`
- Focused chat realtime/workflow test passes:
  - `chat-realtime-workflow.test.ts`
- Workflow/route/service unit tests pass:
  - `intake-route.test.ts` (5 tests: task+activity creation, start=false, project scoping, 404, validation)
  - `provider-runtime.test.ts` (7 tests: default fallback, explicit model, capability, project scope, runtime override, 404s)
  - `task-pipeline-workflow.test.ts` (7 tests: success→review, failure, retry on infra error, dependency blocking/unblocking, dependent release, 404)
  - `schedule-execution.test.ts` (5 tests: task-mode, chat-mode, skip concurrency, not-yet-due, nextRunAt advance)
- `packages/mcp/test/mcp-server.test.ts` passes.
- `packages/mcp` typecheck passes.
- Targeted Autopilot typecheck grep for newly touched worker/MCP files is clean.
- Collection indexes added to 9 collections (schedules, activity, providers,
  capabilities, join_tokens, workflow_configs, environments, scripts, secrets)
  covering hot query paths (schedule tick, activity lookup, provider resolution,
  project-scoped queries).

## Decisions

- No app-specific task board or Knowledge page for CRUD/list surfaces. Use
  collection views and improve framework views. See `ADMIN_VIEW.md`.
- The generic collection list alternative is `outline`, not a one-off `nested`
  option.
- Project inspection can remain a custom page because it is a multi-resource
  runtime command surface. Chat is not a page; it is a persistent shell rail.
- Worker daemon stays standalone for now.
- Worker execution remains generic: the worker receives a run payload and uses
  the daemon's `spawn-agent` runtime adapter. The app owns orchestration,
  durable state, events, artifacts, and workflow resumption.
- MCP stays standalone but is now exposed through a reusable QuestPie MCP module.

## Open Work

### Worker Package

- Audit old `packages/worker` API client against new QuestPie routes and aliases.
  First pass covered enroll/register/heartbeat/claim/event/complete/deregister
  and added the missing run status read alias.
- Mocked worker E2E against the new app route contract exists.
- Replace old endpoint paths with new custom route URLs where aliases are not
  sufficient.
- Keep workspace setup, structured output parsing, secret handling, runtime
  config, and `spawn-agent` adapter behavior.

### MCP

- MCP smoke covers task create/read and run artifact create/list/content.
- Task mutation tools added: `task_update`, `task_cancel`, `task_retry`.
- Task graph tools added: `task_dependencies`, `task_dependents`.
- Schedule tools added: `schedule_list`, `schedule_get`, `schedule_trigger`.
- Remaining parity: config tools, search behavior, destructive confirm guards,
  and old MCP package compatibility audit.

### Admin Framework

- Harden `outline` semantics and tests for field grouping, relation-field
  grouping, edge repeat, path repeat, cycles, orphans, duplicate edges, and
  preserve-matching-branches.
- Continue moving app-specific operator UI needs into reusable admin shell,
  side-rail, list, and form view capabilities.

### Workflows And Routes

- Task pipeline, schedule tick, intake route, and provider runtime resolution
  are now unit-tested (24 assertions across 4 test files).
- Remaining: multi-step task orchestration tests, worker poll route tests,
  run event/completion route tests, workspace inspection route tests.
- Realtime stream behavior for chat/run events is smoke-covered; continue with
  browser/admin integration once the old operator UI parity pass starts.

### End-To-End Acceptance

- Worker enrolls, heartbeats, claims a run, executes mocked `spawn-agent`,
  emits progress, completes the run, resumes workflow, and creates Knowledge
  artifacts with task/run provenance.
- Chat message triggers a workflow and streams assistant/run events without
  losing realtime output. Server-side smoke is covered; UI-level acceptance
  remains.
- Schedule triggers task/chat.
- Project inspection shows run output/diff using real loaders.
