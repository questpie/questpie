# Whole-product journeys and adversarial conformance application

- Status: research fixture; no acceptance authority
- Atlas tickets: #1 and #2
- Purpose: force every later API decision through one complete developer and
  operator experience before release slicing

## The application

Use a compact collaboration and publishing application as the primary atlas
fixture. A Company contains Spaces and Channels. Principals join a Company and
may additionally join private Channels. Members create Messages, attach Files,
watch a Channel feed, submit a Message for approval, and publish it through a
durable Workflow. Publishing calls an external delivery provider and updates a
search index. One inbound webhook uses a custom Route.

This model is intentionally more adversarial than `workspaceId = tenantId`:

- Company membership and Channel membership are different authorization facts;
- a Message belongs to a Channel through a Space and Company;
- role changes must invalidate watched results and future durable attempts;
- one Mutation changes several Collections and atomically dispatches work;
- the external delivery call cannot run inside the business transaction;
- Search and Files must reuse Policy rather than invent parallel access APIs;
- restart, retry, response loss, cancellation and deployment version changes
  are observable in Studio.

The fixture is evidence, not a public starter template or required domain
ontology. A materially different second fixture must later catch accidental
tenant, collaboration, or CRUD assumptions.

`SPEC.md` section 13 remains the behavioral lower bound for the first real
implementation tracer. Replacing Barbershop as the disposable domain fixture
does not remove any of its twenty Policy, realtime, durable, crash, parity,
managed-PostgreSQL, retry or budget obligations. The noun may change only in a
focused accepted SPEC projection; the proof strength may not.

## Authoring locality budget

The happy path must not require one file per compiler phase or one manifest of
services per Operation. The target application can be understood from roughly
this authored layout:

```text
src/
  app.ts                         application root and runtime choices
  model/collaboration.ts         Collections, Constraints and Relations
  features/messages.ts           Policy, Query, Mutation and Reaction
  features/publishing.ts         Workflow and external Action
  integrations/auth.ts           credentials -> Principal
  integrations/delivery-route.ts inbound webhook Route
```

Authors may split these files for normal TypeScript organization, but a
compiler contract must not force the split. Direct exported Definitions are the
discovery roots. Generated artifacts, handler wrappers, codecs, registries,
Policy programs and runtime dispatch tables do not become authored files.

## Current-wave end-application surface

`SPEC.md` requires one contract to be grilled at a time. This first wave may
show exact candidate syntax only for Execution/Context and Policy. Later Query,
Mutation, Reaction, Workflow, Action, Route, realtime, Search and Studio
sections below are behavioral journeys, not proposed APIs.

### One local Policy module

```ts
import { definePolicy, policy, query } from "questpie";
import {
	channelMemberships,
	companyMemberships,
	messages,
} from "../model/collaboration";

export const messagePolicy = definePolicy(messages, {
	name: "messages.default",

	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal, exists }) =>
			query.and(
				exists(companyMemberships, ({ row: membership }) =>
					query.and(
						membership.companyId.equal(row.companyId),
						membership.principalId.equal(principal.id),
						membership.status.equal("active"),
					),
				),
				query.or(
					row.visibility.equal("company"),
					exists(channelMemberships, ({ row: membership }) =>
						query.and(
							membership.channelId.equal(row.channelId),
							membership.principalId.equal(principal.id),
							membership.status.equal("active"),
						),
					),
				),
			),
	},
});
```

The imported `policy` and `query` values provide only closed combinators. They
do not somehow know Message Fields. `definePolicy(messages, ...)` contextually
types the outer `row`; each `exists(companyMemberships, ...)` call contextually
types its inner `membership` from that exact Collection argument.

### Contextual TypeScript sources

Every callback in the candidate must be explainable without `any` or a manual
generic that exists only to rescue inference:

| Surface                                      | Exact contextual type source                                       |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `definePolicy(messages, ...)` `row`          | the `messages` Collection argument                                 |
| nested `exists(companyMemberships, ...)` row | the nested Collection argument                                     |
| Policy `principal`, `tenant`, `authority`    | the closed core Execution operand contract                         |
| later operation `input` inside a handler     | its local closed input declaration                                 |
| later handler `ctx`                          | the generated application context narrowed by Operation mode       |
| later generated client member                | exact exposed Resource identity and inferred or pinned wire output |

The final proof must compile the documented module verbatim, test unknown
Fields and illegal mode capabilities negatively, inspect emitted declarations,
and report type instantiations and check time.

### Runtime and Studio journey

1. Fetch resolves credentials into a trusted Principal and normalizes an
   application-selected Tenant, creates one immutable Execution, and calls the
   same compiled engine as a direct invocation. Tenant selection is not proof
   of membership; relational Policy supplies that proof.
2. `messages.channelFeed` runs in a bounded read snapshot. Policy row scope is
   part of the SQL plan. The Runtime observes the actual Collection, Relation,
   Policy, pagination and context dependencies.
3. Watching the Query persists or resumes a subscription checkpoint. A change
   to a Message or relevant membership wakes recomputation; a durable Change
   Ledger closes lossy-wake gaps.
4. `messages.submit` owns one transaction. Business rows, Change Ledger records
   and Transactional Dispatch intent commit atomically. The response is encoded
   only after commit.
5. A Reaction attempt is leased after commit. It starts or signals the durable
   publishing Workflow. Each attempt creates a new Execution and re-evaluates
   current authority rather than deserializing a stale mutable context.
6. The Workflow records waits, approval, retries and external delivery Action
   attempts. Search indexing follows committed state through the same durable
   change spine.
7. Studio joins compile Origin, Policy explain, transaction, change,
   subscription, dispatch, Workflow and logs through one Execution Envelope.
   It consumes canonical artifacts and runtime events; it is not a second
   backend or authority model.

## Acceptance journeys

The full atlas must eventually prove all of these journeys:

1. **Compile and inspect:** compile the six authored modules, inspect exact
   Resources, Origins, generated context/client, Policy program and runtime
   artifact digests, then explain any generated member back to source.
2. **Migrate and restart:** plan, review and apply schema changes; detect drift;
   restart without losing committed data, dispatch, Workflow history or Live
   Query reconciliation position.
3. **Relational authorization:** active Company member reads company-visible
   Messages; private Channel membership is additionally required; role and
   membership revocation affect direct, Fetch, realtime and future worker
   executions without an existence oracle.
4. **Typed read:** execute and watch the same closed Query, preserve cursor
   scope, enforce bounds and show exact generated result types.
5. **Transactional write:** validate caller-owned Fields, assign server-owned
   identity/timestamps, lock and recheck current state, write several rows and
   dispatch once in one transaction.
6. **Response loss and retry:** a lost response after commit does not duplicate
   the state transition or durable intent; declared and framework errors remain
   stable.
7. **External effect:** delivery runs only through an Action outside the
   business transaction with an explicit idempotency/retry story.
8. **Durable recovery:** kill a worker between lease, effect and acknowledgement;
   restart and demonstrate bounded retry, deduplication and inspectable terminal
   failure.
9. **Workflow evolution:** deploy a changed publishing Workflow without
   corrupting in-flight histories; document the exact compatibility rule.
10. **Custom protocol:** authenticate and verify an inbound webhook Route, then
    call the same semantic Operations without gaining ambient System Authority.
11. **Files and Search:** authorize File metadata and download separately from
    storage bytes; index committed state durably; recheck search results through
    the one Policy model.
12. **Operational truth:** correlate one user request through transaction,
    Change Ledger, realtime recompute, dispatch, Reaction, Workflow, Action and
    logs in Studio without a mutable mega-record.

## Decisions this fixture does not make

- whether application Context Resolution may add immutable trusted facts beyond
  Principal/Tenant/Authority or must expose memoized generated services instead;
- exact Policy correlated-`EXISTS`, Relation traversal and Field-authority syntax;
- whether Query handlers call inline structural plans or a generated closed
  Collection operation surface;
- exact inferred-output wire algebra and when `output` must be pinned;
- exact Live Query transport/checkpoint, dispatch, retry, Workflow, Action,
  Route, File, Search or Studio syntax;
- beta.1 scope.

Those remain separate atlas tickets. This document supplies the use cases that
must justify their concepts and catches proposals that optimize only for a
single-table CRUD demo.
