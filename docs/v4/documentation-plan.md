# QUESTPIE v4 documentation plan

- Status: Active
- Date: 2026-08-10
- Public root: `apps/docs/content/docs/v4/`
- Canonical architecture: `SPEC.md`

The repository is documentation-first. Documentation describes the product we
intend to prove. It does not reverse-engineer an unfinished implementation.

## Sources of truth

1. `SPEC.md` defines product scope and architecture.
2. `CONTEXT.md` defines canonical terms only.
3. `docs/adr/` records accepted decisions and their consequences.
4. `docs/v4/implementation-gates.md` defines proof gates.
5. Public docs project accepted behavior for users.
6. Research notes preserve evidence and rejected directions. They are not
   normative.

Do not copy the full specification into another workbench document.

## Projection workflow

For each product area:

1. Research current evidence and competing systems.
2. Grill the product boundary and the complete public behavior.
3. Run an overengineering audit.
4. Update canonical terms and ADRs.
5. Update `SPEC.md` and the implementation gates.
6. Project the accepted result into public documentation in Simplified
   Technical English.
7. Add executable examples only when their API is accepted.

Public documentation speaks as a finished product, but it must not claim that
an unimplemented guarantee is available in a release.

## Writing order

The documentation slices are:

1. schema, migrations, Seeds, drift, and idempotency — accepted and projected;
2. compiler inputs, identity, ownership, origin, and augmentation — next;
3. collections, fields, relations, policy, and PostgreSQL escape hatches;
4. Query, Mutation, Action, Route, transaction, and dispatch semantics;
5. Change Ledger, Live Query, recovery, and generated client;
6. Jobs, queues, workflow durability, and execution history;
7. Execution Envelope, telemetry, CLI, and Studio.

Auth, files, search, KV, OpenAPI, MCP, and Cloud follow only after the first
tracer proves the shared runtime contracts. Transient connected-client events
are application/provider integration, not a later QUESTPIE capability.

## Review gates

Each published slice must pass three independent reviews:

- fact review against `SPEC.md`, current ADRs, and primary research;
- prose review for ASD-STE100-style clarity and consistent naming;
- example review for type correctness and consistency with accepted semantics.

An example cannot introduce a new framework primitive while documenting a
different primitive.
