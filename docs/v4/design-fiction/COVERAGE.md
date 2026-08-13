# `SPEC.md` to developer-guide coverage

- Status: documentation workbench; not reader-facing product documentation
- Purpose: make every architectural promise teachable and testable through the
  design-fiction developer guide

An architectural statement is not fully designed when it has only a glossary
term or internal ownership sentence. It is ready for implementation only when
the developer guide can show the authored API, generated surface, Runtime
behavior, failure behavior and operational evidence that apply to it.

| `SPEC.md` section                 | Developer-facing destination                                     | Required reader evidence                                                                                                             | Current state                                                                                            |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1. Product statement              | `index.md`                                                       | one request from Definition through compiler, PostgreSQL, Runtime, client and Studio                                                 | drafted                                                                                                  |
| 2. Product boundary               | `index.md`, `run-and-deploy.md`                                  | standalone Runtime, low-level Fetch, framework-neutral client, Studio versus Operator App                                            | drafted; proof-blocked                                                                                   |
| 3. Why v4                         | `index.md`, `limits-and-guarantees.md`                           | guarantees kept from v3 and mechanisms removed, explained through developer consequences                                             | drafted; proof-blocked                                                                                   |
| 4. Sources of truth               | `getting-started.md`, `model-data.md`, `run-and-deploy.md`       | Manifest, migration chain and fingerprint shown separately; plan/create/apply/drift/retry journey                                    | drafted; runtime proof absent                                                                            |
| 5. Static composition             | `getting-started.md`, `model-data.md`, later Package guide       | direct exports, identity versus file Origin, one Owner, Package activation/Augmentation, collision diagnostics                       | local Definitions drafted; Packages remain                                                               |
| 6. TypeScript contract            | every API chapter, `limits-and-guarantees.md`                    | exact callback type source, generated server/client declaration, negative member test and type budget                                | guide drafted; proofs absent                                                                             |
| 7. Runtime and Operations         | `queries-and-mutations.md`, `routes-actions-and-integrations.md` | generated `ctx`; Query/Mutation/Action/Route differences; direct/Fetch parity; cancellation/deadline                                 | all four Operations drafted                                                                              |
| 8. Data and authorization         | `model-data.md`, `authorize-with-policy.md`                      | accepted data grammar; Principal/Tenant/Authority; relational and Field Policy; cursor/sentinel equivalence; no post-filter fallback | data and Policy drafted                                                                                  |
| 8. Realtime                       | `realtime.md`                                                    | watch same Query; actual-read dependencies; membership revocation; ledger/wake/reconcile/reconnect; consistency and bounds           | accepted by ADR-0012                                                                                     |
| 9. Durable execution              | `durable-work.md`                                                | atomic dispatch, lease/attempt, retry/backoff, idempotency, cancellation, terminal failure, Workflow on the same spine               | Reaction accepted by ADR-0013; Job/shared Workflow seam accepted by ADR-0016; complete Workflow deferred |
| 10. Execution Envelope and Studio | `studio-and-debugging.md`                                        | correlate compile, request, transaction, change, subscription, dispatch and attempt without a mutable mega-record                    | drafted; proof-blocked                                                                                   |
| 11. Auth                          | `authorize-with-policy.md`, `routes-actions-and-integrations.md` | credentials become Principal; native Auth integration remains usable; Auth tables use normal schema lifecycle                        | candidate guide drafted                                                                                  |
| 11. Files and external systems    | `routes-actions-and-integrations.md`                             | File record versus blob bytes; external Action; Search indexing and Policy recheck                                                   | candidate guide drafted                                                                                  |
| 12. Hosting and Cloud             | `run-and-deploy.md`                                              | local plus managed PostgreSQL; artifact matching; readiness/drain/restart; open Runtime versus future Cloud                          | drafted; conformance proof absent                                                                        |
| 13. First tracer                  | connected examples in all pages                                  | all twenty proof obligations retain one traceable application scenario                                                               | fixture drafted, evidence absent                                                                         |
| 14. V3 port policy                | all authoring pages, `limits-and-guarantees.md`                  | familiar jobs preserved; no runtime merge, public ORM types, host/provider matrices or recursive types                               | drafted; proofs absent                                                                                   |
| 15. Non-goals                     | `limits-and-guarantees.md`                                       | clear supported alternative for each absent job, not a bare roadmap list                                                             | drafted; release cut open                                                                                |
| 16. Decision state                | not reader-facing                                                | authority/research separation remains in staging metadata and promotion gate                                                         | covered by `README.md`                                                                                   |
| 17. Grilling order                | not reader-facing                                                | one focused proof/review per promoted chapter                                                                                        | covered by atlas and `README.md`                                                                         |

## Page-level completion evidence

Each reader page eventually owns one testable evidence bundle:

```text
developer page
  -> verbatim TypeScript fixture
  -> expected generated declarations
  -> canonical artifact golden
  -> PostgreSQL/runtime integration where applicable
  -> hostile failure matrix
  -> measured type/editor/runtime budgets
  -> focused Opus-medium PASS
  -> public-doc projection
```

The staging guide can be broad enough to reveal product inconsistencies. The
acceptance bundle remains narrow: one focused contract passes before its page
becomes public authority.

## Questions the guide must make impossible to hide

- Can a new developer tell which file they write and which file QUESTPIE
  generates?
- Can they see why a callback autocompletes exact Fields instead of trusting an
  illustrative implicit `any`?
- Can they execute the same capability directly and through the generated
  client without a different Policy path?
- Can they predict transaction, snapshot, retry and external-effect ownership?
- Can they explain what happens after response loss, process death, membership
  revocation, reconnect and deployment change?
- Can they find the exact Resource, Policy decision, transaction, dependency or
  worker attempt in `questpie explain` and Studio?
- Can they see a supported replacement when a v3 mechanism is removed?
- Can an implementation agent derive one bounded module contract and proof from
  the page without inventing public behavior?
