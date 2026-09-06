---
name: questpie
description: Builds and changes QUESTPIE applications through generated contracts, Policy-aware data operations, Jobs, typed clients, and supported projections. Use when authoring, reviewing, migrating, or debugging an application on QUESTPIE 4.0.0-beta.2.
compatibility: Requires a QUESTPIE 4.0.0-beta.2 application and Bun.
metadata:
  version: "4.0.0-beta.2"
---

# QUESTPIE application authoring

Start from the application's installed `questpie` version, `questpie.json`,
source Definitions, and generated `#questpie/app` and `#questpie/client`
contracts. Treat those generated contracts as the application's exact type
authority. Preserve the existing domain model and make the smallest coherent
change.

Load only the reference that matches the work:

- Application root, Collections, composition, migrations, Seeds, or Routes:
  read [application authoring](references/application-authoring.md).
- Context, Policy, Collection operations, validation, or lifecycle:
  read [data, Policy, and lifecycle](references/data-policy-and-lifecycle.md).
- Query, Mutation, Action, generated clients, canonical HTTP, OpenAPI, or MCP:
  read [operations and projections](references/operations-http-openapi-and-mcp.md).
- Relations, inverse selection, Query Resources, React, or discriminated
  unions: read [reactive queries and Relations](references/query-resources-react-and-relations.md).
- Reaction, Job, retry-safe effects, Runtime observation, or OpenTelemetry:
  read [durable work and observability](references/jobs-and-observability.md).

## Shared workflow

1. Confirm the installed package version is `4.0.0-beta.2`. If it differs,
   use that version's documentation instead of applying this skill blindly.
2. Find the current Resource owner and inspect generated types before writing
   inputs, outputs, HTTP paths, MCP names, or client wrappers.
3. Add one tracer through the public surface being changed. Keep Policy and
   transaction ownership on the existing QUESTPIE kernel.
4. Run the application's Bun typecheck and focused tests. Run
   `bunx questpie check` for compiler diagnostics. Run `bunx questpie build`
   only when the change should refresh generated output, then review every
   generated change.

Schema application, credential changes, publishing, and deployment require
the application's own reviewed procedure and explicit authority. Keep
credentials out of source, commands, logs, and generated examples.

## Beta.2 boundary

Use the installed version's generated contracts instead of parallel wrappers or copied
schemas. Beta.2 has no Workflow Resource, polymorphic Relation or codec,
application-generated skill, Files, Search, Studio, split Runtime roles,
compatibility endpoint, or fallback execution path. Durable checkpointed work
belongs to Job; heterogeneous domain values use ordinary TypeScript helpers.
