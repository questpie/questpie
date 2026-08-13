# Field authority and Mutation value lifecycle designs

- Status: design evidence; no v4 acceptance authority
- Scope: separate Field authorization from server-owned value changes without
  restoring the v3 access/hooks architecture

## Jobs that must remain distinct

One Field may participate in several independent decisions:

1. an Operation statically includes it in its maximum input or output surface;
2. Policy permits or denies the current Execution from using that Field;
3. a Mutation supplies or changes the stored value;
4. validation accepts or rejects the complete proposed row;
5. the returned result includes or redacts the Field.

Collapsing these jobs into one callback hides whether a value was authorized,
supplied by the caller, assigned by the server, transformed, persisted, or only
removed from a response.

## Design A: strict Policy and Mutation separation

Policy owns only operation admission, row scope, caller-input Field authority,
and output Field authority. It returns decisions and predicates, never values.
Canonical artifacts use segment-array paths. The Operation's exact maximum
input/output surface is the first gate; Policy Field rules name only conditional
narrowing within it. An omitted Policy rule therefore leaves the explicit
Operation maximum unchanged, while adding a Collection Field exposes nothing.
No wildcard grants future Fields.

A separate Mutation Value Program owns closed value operations:

- `setIfMissing` supplies a value only when no caller value or earlier source
  supplied it;
- `overwrite` always supplies the authoritative value and excludes that Field
  from the generated client input;
- a future bounded `derive` computes a target from declared inputs and
  dependencies.

The compiler rejects target overlap, undeclared dependencies, cycles, and any
value program that requires ambient I/O, clock, random, database, or external
services. Transaction time, Principal, Tenant, typed literals, decoded input,
and accepted schema defaults are explicit operands rather than ambient facts.

This design has the strongest auditability. Its cost is repetition between
Operation input/output surfaces, Policy Field rules, and value targets.

## Design B: one local authoring declaration, two normalized programs

One adjacent Collection declaration can group `authorize` and `values`
namespaces for author locality. The compiler still emits separate Policy and
Mutation Value programs, separate semantic digests, and separate explanation
ledgers.

This reduces files and repeated Collection references. Its main risk is that
the declaration grows into a v3-style rules/access/hooks bag. The grammar must
therefore stay closed, declarative, and limited to the two independently
normalized contracts.

## Design C: static surfaces only

Each Query or Mutation declares one exact input and output. Policy controls only
operation admission and row scope. A different Field surface requires a
different named Resource, such as ordinary and payroll employee views.

This produces the simplest generated types and runtime. It works well for
capabilities that naturally have separate names, but it cannot represent a
heterogeneous result where one selected Field is visible only on some rows or
to some Principals. It also does not preserve the full Field-level authorization
job the user expects from read/create/update.

## Recommended synthesis

Use two cumulative gates:

1. Every Resource declares the exact maximum input and output Field paths.
   Adding a Collection Field changes neither surface.
2. Policy may only narrow that maximum for the current Execution, current row,
   proposed input, or returned row.

Prefer a separate named Resource when the audience represents a distinct
business capability. Allow conditional Field authority when one capability
genuinely returns heterogeneous authorized rows or accepts role-dependent
patches.

Policy remains the sole authorization model:

- output denial omits the property; it never substitutes `null`, because null
  is application data;
- a conditionally visible output path is optional in the generated result;
- an always-visible path is required;
- an always-denied path is absent;
- input Policy checks only caller-supplied canonical paths, so an untouched
  restricted Field does not block a partial update;
- a conditionally writable Field remains in the generated maximum input type
  and is authorized at runtime;
- a server-authoritative Field is absent from generated input and is written by
  the Mutation Value Program, not by Policy.

Manual response redaction is not a replacement for Policy. A named Query may
define a custom output, but every underlying Collection read still uses the
caller's immutable Execution and Policy. Application code cannot request
System Authority from ordinary input.

## Candidate lifecycle ordering

The exact error precedence remains a contract decision, but the ownership
order should be explicit:

### Read

1. resolve the named Resource and immutable Execution;
2. enforce operation admission;
3. execute the authored predicate intersected with Policy row scope;
4. fetch only the Resource's maximum selected Fields;
5. apply Policy output decisions per returned row;
6. validate and encode the declared result.

### Create

1. bound and decode the declared public input;
2. open the Mutation-owned transaction and freeze its operation time;
3. enforce admission and caller-supplied Field authority;
4. build the candidate and apply `setIfMissing`, then `overwrite`;
5. validate the complete proposed row;
6. enforce the post-image Policy predicate;
7. insert and let PostgreSQL Constraints remain authoritative;
8. apply output Field authority to the returned image;
9. commit before reporting success.

### Update

1. bound and decode key plus declared patch;
2. open the Mutation-owned transaction and freeze its operation time;
3. enforce admission;
4. find and lock the target through Policy row scope, then recheck after wait;
5. authorize only caller-supplied patch paths;
6. build the proposed post-image and apply `setIfMissing`, then `overwrite`;
7. validate the complete proposed row and post-image Policy;
8. update once and map database failures to declared errors;
9. apply output Field authority to the returned image;
10. commit before reporting success.

Missing and Policy-invisible keyed targets share one nondisclosing outcome.

## Beta.1 recommendation

Ship the minimum closed lifecycle needed for safe Collection operations and
named Mutations:

- runtime input/output codecs;
- operation admission, row scope, and read/create/update Field authority;
- static maximum input/output surfaces;
- `setIfMissing` and `overwrite` with closed operands;
- full candidate validation and post-image Policy;
- one Mutation-owned transaction, lock/recheck, nested write joining, database
  error mapping, output enforcement, and committed result;
- a stable internal transaction/change identity seam.

Decide the complete later ownership model now, but defer arbitrary JavaScript
Field hooks, general `derive`, output rewriting, post-commit Reactions, external
Actions, automatic retries, durable dispatch, Live Query, and the full v3 hook
catalogue. A named Mutation handler remains the place for application business
logic; it does not create a second authorization or transaction path.

## Explainability requirement

The Compiled Manifest, Origin Map, generated App Contract, and structured
`questpie explain` output must answer separately:

- which Resource can ever accept or return this Field;
- which Policy condition authorized or redacted it;
- whether the caller, a schema default, `setIfMissing`, or `overwrite` supplied
  its value;
- which validation and post-image rule ran;
- which Mutation and transaction committed it.

No answer may require interpreting arbitrary callbacks or generated runtime
implementation code.
