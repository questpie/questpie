# Relational authorization: primary-source evidence

- Status: research evidence; no v4 acceptance authority
- Date: 2026-08-12
- Scope: Cedar, OpenFGA/Zanzibar-style relationship checks, PostgreSQL row
  security, and their concrete implications for QUESTPIE v4 Policy
- QUESTPIE authority: `SPEC.md`, `CONTEXT.md`, Accepted ADRs, and the accepted
  foundational Data/structural Query contract continue to outrank this report

## Result

The external systems agree on one useful shape but do not supply a QUESTPIE
architecture to copy:

1. Real application authorization is a decision over a Principal, an action,
   a resource or candidate row, trusted request facts, and a bounded graph of
   relationship evidence.
2. Relationship evidence and disclosed application data are different jobs.
   An authorization engine can inspect a membership edge and return one
   decision without making that membership record readable to the caller.
3. Every relationship hop has consistency, cost, dependency, and cycle
   consequences. It cannot be hidden in an arbitrary async callback or in a
   stale token claim.
4. Revocation correctness needs a shared snapshot or an explicit freshness
   boundary. A previous `allow` is not durable authority for a later realtime
   delivery, Job attempt, Workflow step, or search result.
5. PostgreSQL RLS can be a valuable generated enforcement layer for the subset
   of Policy that has a proven SQL-equivalent lowering. It cannot be the
   product Policy model: it does not cover the full QUESTPIE operation,
   Field-output, realtime-dependency, error, or durable-execution contract.

The strongest candidate for QUESTPIE is therefore a closed, typed relational
Policy program lowered with the target query in one PostgreSQL snapshot. The
program should expose bounded authorization-only `exists`/Relation evidence,
record every evidence dependency, and keep ordinary Collection disclosure
behind the target Collection's normal Policy. RLS may later be derived from the
same normalized program; it must never become a second independently authored
authorization system.

## The representative application question

The report tests the common communication-app rule, not only
`row.tenantId = tenant.id`:

```text
company
  -> space
    -> channel
      -> message

principal -> company membership (active role)
principal -> optional private-channel membership
```

A Principal may read a message when all of the following hold:

- the message's channel belongs to a space in a company where the Principal has
  active membership;
- the channel is company-visible, or the Principal has active membership in
  that private channel;
- a block/ban or another explicit restrictive rule does not deny access.

Create, update, and delete add different questions: whether the Principal may
invoke the operation, whether the existing message is a valid target, whether
the resulting candidate may retain or change its company/space/channel/author,
and whether sensitive output Fields may be disclosed. A design that answers
only the read-row question is not an access replacement.

## Cedar: typed decision inputs, caller-supplied evidence

### Primary-source facts

Cedar models one authorization request as Principal, Action, Resource, and a
request Context record. Evaluation receives policies plus the entity data
needed for the request and returns `Allow` or `Deny` with diagnostics. The
application, not Cedar, is responsible for assembling the relevant entity
slice. See Cedar's
[authorization algorithm](https://docs.cedarpolicy.com/auth/authorization.html)
and
[entity/context input format](https://docs.cedarpolicy.com/auth/entities-syntax.html).

Cedar schemas type the applicable Principal and Resource entity kinds and the
Context shape per Action. Policy validation is separate from request
evaluation; the application must still ensure that runtime requests and entity
data conform to the schema. See
[policy validation and request expectations](https://docs.cedarpolicy.com/policies/validation.html)
and the
[schema reference](https://docs.cedarpolicy.com/schema/schema.html).

Entities can carry attributes and parent links. The `in` operator checks
hierarchy membership, so groups and resource containment can participate in a
decision. Attribute presence must be guarded when the schema permits an absent
attribute because missing access can become an evaluation error. See Cedar's
[entity semantics](https://docs.cedarpolicy.com/policies/syntax-entity.html)
and
[operator reference](https://docs.cedarpolicy.com/policies/syntax-operators.html).

Cedar's level validation can reject policies whose entity dereference chains
exceed a chosen level. Level-based slicing can then collect only entities
reachable within that bound while preserving the result that evaluation over
all entity data would produce. Hierarchy membership itself counts as an entity
data access. See
[policy level validation](https://docs.cedarpolicy.com/policies/level-validation.html).

The combining algorithm is deny-overrides: any matching `forbid` causes
`Deny`; without a matching `permit`, the result is also `Deny`. Evaluation
errors do not create authority. See Cedar's
[authorization algorithm](https://docs.cedarpolicy.com/auth/authorization.html).

### QUESTPIE implications

These are framework inferences, not Cedar requirements:

- `Principal`, operation identity, target/candidate, and trusted execution
  facts should have compiler-known types. An untyped `context: Record<string,
unknown>` would discard one of Cedar's most valuable safety properties.
- A Policy callback must get its exact row/Field types from the attached
  Collection, while every nested relationship scope must get its types from the
  explicitly referenced Collection or Relation.
- The compiler must know the complete evidence slice. In QUESTPIE that points
  to a closed relational expression lowered into SQL, not to Cedar's external
  entity-loading protocol and not to arbitrary Policy-time `ctx.data` calls.
- A bounded dereference/evidence budget should be visible in the Manifest and
  explanation output. Static dependencies should include membership,
  containment, block/ban, and any other Collection read by the Policy.
- Deny-overrides is useful for explicit emergency restrictions, but QUESTPIE
  should normalize one unambiguous Policy program rather than copy Cedar's
  authored-policy-set model wholesale.

Cedar also exposes a critical Context Resolution warning: the authorization
engine can only decide over facts the application supplied. If a database role
is copied into Context before a transaction, Cedar itself does not make that
fact fresh or observable. QUESTPIE must own provenance, snapshot timing, and
refresh for every resolved fact.

## OpenFGA and Zanzibar: relationship graphs and freshness

### Primary-source facts

OpenFGA represents direct relationships as user/relation/object tuples and
uses an authorization model to derive implied relationships. Usersets support
union, intersection, exclusion, same-object implication such as
`editor -> viewer`, and relationships inherited from another object. See the
[configuration language](https://openfga.dev/docs/configuration-language),
[usersets](https://openfga.dev/docs/modeling/building-blocks/usersets), and
[parent-child model](https://openfga.dev/docs/modeling/parent-child).

This naturally represents fixed company/space/channel/message containment: a
message can inherit a viewer relation from its channel, a channel from its
space, and a space from its company, while a private channel can additionally
require channel membership. OpenFGA's own design guidance prefers specific
types and flatter, explicit hierarchies over a generic recursive resource
graph; recursion is recommended only when depth is genuinely dynamic. See
[authorization-model design principles](https://openfga.dev/docs/best-practices/modeling-design-principles).

Relationship resolution is operationally bounded. OpenFGA exposes a maximum
resolution depth, breadth controls, dispatch throttling, and deadlines; its
documented default resolution-node limit is 25. See the official
[configuration reference](https://openfga.dev/docs/getting-started/setup-openfga/configuration).

Contextual tuples are ephemeral relationship evidence supplied for one check.
They are validated like stored tuples, but can override the same stored tuple.
The official warning notes that a membership copied from a token continues to
grant access until token expiry even if the underlying membership changes.
Contextual tuples are also difficult to incorporate into a permission-aware
search index because they are absent from the tuple changelog. See
[contextual tuples](https://openfga.dev/docs/interacting/contextual-tuples) and
[token claims as contextual tuples](https://openfga.dev/docs/modeling/token-claims-contextual-tuples).

When query caching is enabled, OpenFGA's default lower-latency consistency mode
may not observe an immediately preceding tuple write. The higher-consistency
mode bypasses that cache at a performance cost. See
[query consistency modes](https://openfga.dev/docs/interacting/consistency).

The original Google Zanzibar paper makes the underlying security issue
explicit. Applying an old ACL after membership revocation to newer content can
produce the "new enemy" problem. Zanzibar evaluates a check at one snapshot and
uses opaque freshness tokens stored with content versions so later checks are
not older than the content's authorization boundary. Its Watch API emits tuple
changes in timestamp order and supports resumption from a checkpoint. See the
primary
[Zanzibar paper](https://www.usenix.org/system/files/atc19-pang.pdf), especially
sections 2.2 and 2.4.

OpenFGA's permission-aware search guidance treats a search index as a derived,
possibly stale view: one documented strategy rechecks candidate resources and
filters permissions revoked before the index catches up. See
[Search With Permissions](https://openfga.dev/docs/interacting/search-with-permissions).
The Read Changes API returns ordered tuple additions/removals with a durable
continuation token, but does not expand implied usersets. See
[Read Changes](https://openfga.dev/docs/interacting/read-tuple-changes).

### QUESTPIE implications

These are framework inferences:

- The fixed company -> space -> channel -> message chain should be expressed
  with explicit typed Collections/Relations and bounded correlated evidence,
  not a hidden generic ACL graph or synthesized mini-Collections.
- A Policy evidence read is not an ordinary disclosure read. It may answer
  only a closed boolean question such as "does an active matching membership
  exist?" and must not return the membership row to the handler or client.
- Automatically applying the membership Collection's ordinary read Policy
  inside that boolean check can create a Policy bootstrap cycle. The compiler
  needs a distinct authorization-evidence semantic: statically named,
  non-disclosing, SQL-lowerable, dependency-recorded, and unavailable to
  ordinary handler code. This is not a general System read.
- If the same membership is returned as application data, normal target
  Collection Policy and Field authority apply. Authorization evidence must
  never become a back door for Relation selection.
- Fixed relation chains should be compile-time finite. Recursive application
  hierarchies, if supported later, need explicit depth/breadth/cost limits,
  deterministic cycle handling, and hostile proofs. They should not enter the
  first relational Policy contract accidentally through unrestricted nesting.
- Membership and parent-link writes are authorization changes. They must enter
  the same dependency/Change Ledger model as message writes so a watched Query
  is recomputed when access changes, not only when returned rows change.
- Realtime delivery, search results, resumed subscriptions, Job attempts, and
  Workflow steps must not reuse a historic `allow`. Each execution/recompute
  needs a current Policy evaluation at its promised database checkpoint.
- Token claims are suitable for immutable identity facts only within their
  declared credential lifetime. Revocation-sensitive application membership or
  roles should normally remain transactional database evidence. If an Auth
  integration puts them into Principal, the staleness and refresh contract must
  be explicit and visible to realtime authorization.

Zanzibar's separate global ACL store, tuple language, and consistency-token
protocol solve a different scale and storage split. QUESTPIE already owns the
business rows, authorization evidence, transactions, and Change Ledger in one
PostgreSQL application runtime. The lesson is snapshot/freshness discipline,
not a requirement to build or adopt a second authorization datastore.

## PostgreSQL RLS: useful enforcement with sharp boundaries

### Primary-source facts

When RLS is enabled, normal row access must pass a policy; if no applicable
policy exists PostgreSQL uses default deny. A policy's boolean expression is
evaluated per row and rows not producing `true` are suppressed. Table owners
normally bypass RLS, while superusers and roles with `BYPASSRLS` always bypass
it; `FORCE ROW LEVEL SECURITY` can subject the owner. `TRUNCATE` and
`REFERENCES` are outside RLS. See PostgreSQL 16
[Row Security Policies](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

`USING` determines which existing rows are visible or targetable.
`WITH CHECK` validates proposed rows for insert/update, and a false or null
result aborts the write. PostgreSQL applies `WITH CHECK` after `BEFORE ROW`
triggers have had an opportunity to modify the candidate and before other
constraints. Multiple permissive policies combine with `OR`; restrictive
policies combine with `AND`, but at least one permissive policy is needed to
grant rows. See PostgreSQL 16
[`CREATE POLICY`](https://www.postgresql.org/docs/16/sql-createpolicy.html).

RLS expressions normally run with the invoking user's privileges. PostgreSQL
allows subqueries or functions to consult other tables, and a
`SECURITY DEFINER` function can use its owner's privileges for evidence that is
not readable by the caller. PostgreSQL explicitly warns that cross-table
policy reads can create concurrency races and demonstrates a `READ COMMITTED`
case where the target row is updated after waiting while the policy subquery
still uses an older snapshot. Locking the evidence row, stronger coordination,
or another deliberate concurrency design is required. See the cross-table
discussion in
[Row Security Policies](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

`SECURITY DEFINER` is privileged code. PostgreSQL requires a safe
`search_path` excluding untrusted writable schemas, recommends putting
`pg_temp` last, and notes that new functions grant execute to `PUBLIC` by
default unless that privilege is revoked. See
[Writing `SECURITY DEFINER` Functions Safely](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

PostgreSQL's `set_config(name, value, true)` scopes a setting to the current
transaction, while `false` keeps it for the session. `current_setting` reads the
value and can return null for a missing setting when requested. See the
[configuration-setting functions](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADMIN-SET).

Primary/unique and foreign-key checks bypass RLS to preserve integrity, and
the PostgreSQL documentation warns that such checks can form covert channels.
See
[Row Security Policies](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

### QUESTPIE implications

RLS should be considered a **derived enforcement projection**, with these
conditions:

1. The typed QUESTPIE Policy program remains the only authored semantic source.
   The compiler may emit RLS only for a normalized subset whose SQL behavior is
   proven equivalent. Unsupported Policy must fail the RLS projection; it must
   not silently weaken or fork semantics.
2. The runtime database role used for enforcement must not own protected tables
   and must not have `BYPASSRLS`. If owner access is unavoidable in a proof,
   tables need `FORCE ROW LEVEL SECURITY`. Migrations and controlled System
   maintenance require separate explicit authority.
3. Principal/Tenant/Authority identifiers installed for RLS must be set after
   `BEGIN` with transaction-local settings and validated fail-closed when
   absent or malformed. Session-scoped settings are unsafe with a connection
   pool because a later borrower could inherit the previous Execution's facts.
4. Existing-target and candidate-state Policy phases must lower distinctly to
   `USING` and `WITH CHECK`. QUESTPIE's later Mutation/hook replacement must
   deliberately specify whether server-owned transforms occur before the
   candidate check; PostgreSQL's `BEFORE ROW` ordering cannot choose the public
   framework semantics by accident.
5. Relational evidence in RLS needs the same transaction/concurrency proof as
   runtime SQL pushdown. A generated `SECURITY DEFINER` helper, if ever needed,
   must be compiler-owned, boolean-only, schema-qualified, have a fixed secure
   `search_path`, expose no arbitrary SQL, and revoke default `PUBLIC` execute.
6. RLS does not replace operation admission, Field input/output authority,
   response shaping, nondisclosure/error mapping, Live Query dependency
   capture, Action/Route authorization, durable-attempt authority, or the
   generated client contract. Those remain Runtime/Policy responsibilities.
7. Unique/FK error normalization still needs nondisclosure review because the
   database integrity subsystem can reveal that an inaccessible value exists.

RLS is therefore worthwhile after the normal SQL Policy lowering works: it can
protect supported table access from a missed framework predicate and constrain
declared raw SQL. It is not a shortcut for defining Policy and should not be a
beta claim until executable equivalence, role, pooling, cross-table race, and
error-channel proofs pass.

## Evidence reads versus disclosure reads

This distinction is the central design implication.

| Job                       | Allowed result                                                | Authority                                                                | Required dependencies                                                                                              |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Authorization evidence    | Closed boolean/structural Policy expression                   | Compiler-owned Policy evaluator, never handler-selected System authority | Every referenced Collection/Relation, Principal/Tenant/Authority fact, target/candidate phase, snapshot/checkpoint |
| Application disclosure    | Selected typed rows/Fields                                    | Normal target Collection Policy and Field authority                      | Target and nested Relation Policies, selected Fields, pagination/order, runtime observed reads                     |
| Context Resolution        | Typed trusted execution fact or generated application service | Trusted Runtime/Auth boundary with explicit provenance                   | Credential/session source; any mutable DB source plus freshness and recompute contract                             |
| Search/realtime candidate | Identifier or wake signal, not authority                      | Derived index/ledger machinery                                           | Durable checkpoint plus final Policy recheck before disclosure                                                     |

For the representative message rule, an evidence program can semantically be:

```text
exists active company membership correlated through
  message.channel -> channel.space -> space.company
AND
(channel is company-visible OR exists active channel membership)
AND
NOT exists applicable block/ban
```

It may reveal only the final decision and an internal sanitized explanation.
Returning the membership, company, space, channel, or block record is a
separate data Query and must pass its own disclosure surface.

## Dependency and cycle rules to prove

The external evidence supports explicit limits, but QUESTPIE must choose its
own exact contract. The proof agenda should distinguish three graphs:

1. **Static Policy dependency graph.** A Policy program references exact
   Collections/Relations. A cycle caused by recursively applying disclosure
   Policy during an authorization-evidence read should be a compile-time error,
   not a runtime recursion.
2. **Bounded relational expression tree.** Fixed typed `exists`/Relation hops
   lower to correlated SQL. The compiler records maximum depth, fan-out shape,
   indexes needed by the plan, and a deterministic cost/explain summary.
3. **Application data graph.** Stored parent data may contain a cycle even when
   the Policy definition is finite. If recursive closure is ever supported,
   evaluation needs visited-node semantics and hard depth/breadth/deadline
   limits. Fixed company/space/channel/message relations should instead use
   foreign-key structure that makes the intended containment explicit.

At minimum, hostile fixtures should cover:

- active and revoked company membership;
- public and private channel branches;
- company membership present but channel membership absent;
- blocked Principal overriding a positive membership;
- cross-company parent mismatch and forged Tenant input;
- existing row allowed but resulting candidate forbidden;
- membership or parent-link change between target selection and Mutation
  recheck;
- relation/Policy dependency cycle diagnostics with exact Origins;
- maximum-depth and excessive-branch diagnostics;
- inaccessible versus missing target nondisclosure;
- membership revocation while a Live Query is connected, while a search index
  is stale, and between durable attempts;
- direct, Fetch/client, Studio, Route, Job, Reaction, and Workflow parity;
- RLS disabled, missing, owner-bypassed, and transaction-context-missing
  failures;
- pooled-connection reuse after success, rollback, timeout, and cancellation;
- unique/FK error paths that could reveal inaccessible rows.

## Concrete design constraints for the Policy grill

This report does not accept syntax, but the next interface design should satisfy
all of these constraints:

- One attached Collection is the contextual type source for current row,
  candidate row, and Field names. Each relational evidence operator explicitly
  identifies the target Collection/Relation that types its inner scope.
- Policy expressions are closed structural programs. Ordinary Policy contains
  no raw SQL, network access, arbitrary async reads, handler callback, or
  authority constructor.
- The common fixed hierarchy is concise. A developer should express the message
  rule near the message Collection without defining a second ACL datastore,
  duplicating IDs into a capability map, or creating one file per relationship
  hop.
- Execution Context contains trusted immutable facts, not a cache of arbitrary
  mutable database rows. Tenant selection never proves Tenant membership.
- Authorization evidence is non-disclosing and statically auditable. Ordinary
  Relation selection still applies target read/Field Policy.
- Policy dependencies become Live Query and search/recheck dependencies.
  Revocation changes must force recomputation or delivery fencing.
- Every Mutation evaluates target and candidate authority in its owned
  transaction with a documented lock/recheck strategy for mutable evidence.
- System Authority is explicit and does not imply a universal Policy or RLS
  bypass. Durable work re-resolves current authority for each attempt instead
  of serializing a live `ctx` or historic `allow`.
- Recursive relationship evaluation is not implied by nested syntax. It is a
  separately bounded capability if the product later proves a need.
- RLS, grants, raw-SQL restrictions, and runtime predicate pushdown are
  projections/enforcement of one normalized Policy, never independently
  authored alternatives.

## What not to import wholesale

- Do not make Cedar's external entity bundle or policy-store assembly an app
  authoring requirement. QUESTPIE's compiler and PostgreSQL Runtime already own
  typed schema and data access.
- Do not introduce an OpenFGA/Zanzibar tuple store beside normalized
  Collections merely to model ordinary company/channel membership. It would
  add dual writes and a distributed freshness problem that the single-runtime
  architecture does not currently have.
- Do not place revocation-sensitive membership into long-lived token/context
  facts merely because contextual tuples permit it.
- Do not make PostgreSQL roles or RLS policy names the public Policy vocabulary.
  They are deployment-level enforcement details and do not span every
  QUESTPIE operation surface.
- Do not use `SECURITY DEFINER` as a generic escape hatch or let application
  handlers invoke authorization evidence helpers directly.
- Do not promise unbounded graph recursion. Even a dedicated graph
  authorization service exposes depth, breadth, cache, and timeout controls.

## Primary sources

### Cedar

- [How Cedar authorization works](https://docs.cedarpolicy.com/auth/authorization.html)
- [Entities and Context syntax](https://docs.cedarpolicy.com/auth/entities-syntax.html)
- [Policy validation](https://docs.cedarpolicy.com/policies/validation.html)
- [Policy level validation and entity slicing](https://docs.cedarpolicy.com/policies/level-validation.html)
- [Entity semantics](https://docs.cedarpolicy.com/policies/syntax-entity.html)
- [Cedar schema](https://docs.cedarpolicy.com/schema/schema.html)

### OpenFGA and Zanzibar

- [OpenFGA configuration language](https://openfga.dev/docs/configuration-language)
- [Parent-child objects](https://openfga.dev/docs/modeling/parent-child)
- [Authorization-model design principles](https://openfga.dev/docs/best-practices/modeling-design-principles)
- [Contextual tuples](https://openfga.dev/docs/interacting/contextual-tuples)
- [Query consistency modes](https://openfga.dev/docs/interacting/consistency)
- [Read Changes](https://openfga.dev/docs/interacting/read-tuple-changes)
- [Search With Permissions](https://openfga.dev/docs/interacting/search-with-permissions)
- [OpenFGA configuration limits](https://openfga.dev/docs/getting-started/setup-openfga/configuration)
- [Zanzibar: Google's Consistent, Global Authorization System](https://www.usenix.org/system/files/atc19-pang.pdf)

### PostgreSQL 16

- [Row Security Policies](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)
- [`CREATE POLICY`](https://www.postgresql.org/docs/16/sql-createpolicy.html)
- [Writing `SECURITY DEFINER` Functions Safely](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)
- [Configuration-setting functions](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADMIN-SET)
