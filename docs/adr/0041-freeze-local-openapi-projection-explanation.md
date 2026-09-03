# ADR-0041: Freeze local OpenAPI projection explanation

- Status: Proposed
- Date: 2026-09-03
- Owners: Product architecture, compiler, CLI

## Context

ADR-0019 reserves `questpie explain projection <openapi|mcp|skills>` for
projection provenance. ADR-0040 requires explain output to consume the one
compiler-owned Operation Documentation artifact, retain Origins for included
and omitted Operations, and disclose no protected values. The executable
Definition contract and public guide instead describe a broad
`questpie explain --json` Resource and Runtime Build join. The shipped CLI has
no `explain` command.

Those statements leave the first useful invocation, its output owner, and its
failure boundary ambiguous. A CLI-built summary would create another truth
beside the compiler artifact. Running compilation or Runtime code while
explaining an existing build would also make inspection capable of changing
the facts it reports.

## Proposed decision

QUESTPIE adds exactly one local projection explanation command:

```bash
questpie explain projection openapi --json
```

The command runs at the Application Root and reads the last complete generated
directory. It does not accept a Resource Identity, URL, alternate projection,
output format, input path, or rebuild flag. Argument order and spelling are
exact. Broader Resource, execution, transaction, subscription, Durable Run,
MCP, skill, remote, and human-form explanations remain deferred.

The compiler remains the only owner of explanation semantics. When OpenAPI is
selected, the compiler joins the canonical Operation HTTP Contract, Operation
Documentation artifact, and Origin Map and emits
`operation-projection-explain.json`. The CLI verifies that complete generated
artifact set and writes the explanation artifact's existing canonical bytes to
standard output unchanged. It does not parse and reserialize successful output,
filter Operations, add a wrapper, or reconstruct an explanation.

## Exact JSON envelope

The successful bytes retain format `questpie.operation-projection-explain`,
version `1`, and exactly this closed shape:

```ts
type SourceSpan = Readonly<{
	start: Readonly<{ line: number; column: number }>;
	end: Readonly<{ line: number; column: number }>;
}>;

type Origin =
	| Readonly<{
			kind: "export";
			packageId: string | null;
			path: string;
			exportName: string;
			span: SourceSpan | null;
			declaredAt: null;
	  }>
	| Readonly<{
			kind: "collectionOperationSetMember";
			packageId: string | null;
			path: string;
			exportName: string;
			member: "list" | "get" | "create" | "update" | "delete";
			span: SourceSpan | null;
			declaredAt: null;
	  }>;

type OpenApiProjectionExplanationV1 = Readonly<{
	format: "questpie.operation-projection-explain";
	version: 1;
	documentationDigest: string;
	httpContractDigest: string;
	operations: readonly (
		| Readonly<{
				identity: string;
				disposition: "included";
				origin: Origin;
		  }>
		| Readonly<{
				identity: string;
				disposition: "omitted";
				reason: "directOnly" | "rawRouteUnsupported";
				origin: Origin;
		  }>
	)[];
}>;
```

`Origin` is the existing compiler-owned `establishedAt` value from the Origin
Map. Operations stay in ASCII Resource Identity order. Included network
Operations and omitted direct-only Operations carry their establishing Origin.
Raw Routes carry an omitted `rawRouteUnsupported` record and their Origin.

The artifact contains no summary, description, example, input, output, error
payload, handler source, source-file contents, Context, Principal, credential,
Policy evidence, SQL, PostgreSQL fact, request value, response value, secret,
or Runtime event. `documentationDigest` proves which semantic documentation
bytes the projection used without copying those values into explanation.

The JSON object above is the public envelope. The CLI has no second success
schema. Future projection kinds must receive their own accepted compiler-owned
artifact before the `projection` grammar admits them; they do not extend this
closed v1 envelope through CLI-owned optional members.

## Verification and cross-pins

Before it writes any standard output, the command verifies all of these facts:

1. `.questpie/generated/internal/checksums.json` is the supported generated
   checksum manifest and every listed generated file has its recorded content
   digest.
2. `operation-projection-explain.json`, `operation-documentation.json`,
   `operation-http-contract.json`, and `runtime-build.json` have their exact
   supported format and version.
3. Recomputing the domain-separated Operation Documentation digest over
   `operation-documentation.json` equals the explanation's
   `documentationDigest`.
4. Recomputing the domain-separated Operation HTTP digest over the unsigned
   Operation HTTP Contract equals both that contract's `digest` and the
   explanation's `httpContractDigest`.
5. `runtime-build.json` has a valid domain-separated Runtime Build digest and
   its `operationHttpContractDigest` equals the explanation's
   `httpContractDigest`.

The Runtime Build cross-pin proves that the local explanation belongs to the
same executable build without making projection artifacts Runtime inputs.
OpenAPI, Operation Documentation, and projection explanation remain outside the
Runtime Build inventory.

Missing, stale, malformed, unsupported, checksum-mismatched, or
cross-pin-mismatched input fails closed. The CLI never falls back to source, an
older artifact, OpenAPI parsing, bundle inspection, Runtime state, or a partial
explanation.

## Process behavior

On success, the command:

- exits with status `0`;
- writes exactly the canonical bytes from
  `operation-projection-explain.json`, including its one trailing line feed, to
  standard output; and
- writes nothing to standard error.

When the first argument is `explain` but the remaining invocation is not exact,
the command:

- exits with status `1`;
- writes nothing to standard output; and
- writes exactly
  `questpie: use explain projection openapi --json\n` to standard error.

When OpenAPI is not selected or no complete generated projection exists, the
command exits with status `1`, writes nothing to standard output, and writes
exactly
`questpie: OpenAPI projection explanation is unavailable; run questpie build with projections.openapi enabled\n`
to standard error.

For every integrity, format, version, or cross-pin failure, the command exits
with status `1`, writes nothing to standard output, and writes exactly
`questpie: generated OpenAPI projection explanation failed verification\n` to
standard error. It emits no partial JSON and does not disclose the rejected
bytes or mismatch values.

The command opens no network connection, database connection, listener, or
Runtime application. It imports no generated application module, executable
bundle, application source, compiler discovery path, or structural evaluator.
It executes no Definition, handler, example, migration, or Seed. Its lifetime
ends after bounded local artifact reads and standard-stream writes.

## Supersession ledger

If accepted, this decision:

- makes ADR-0019's projection grammar exact for the OpenAPI JSON invocation;
- narrows ADR-0014's general statement that explain uses Runtime state:
  this local projection subject uses compiled artifacts only, while future
  operational subjects may require an authenticated Runtime contract;
- replaces the executable Definition contract's broad
  `questpie explain --json` Resource/Runtime join with this one projection
  command and keeps the broader join deferred;
- resolves ADR-0040's explain obligation with the unchanged compiler-owned
  `operation-projection-explain.json` bytes; and
- changes no Operation Documentation, OpenAPI, Operation HTTP, Runtime Build,
  Origin Map, request dispatch, Policy, transaction, retry, cancellation, or
  database semantics.

It does not supersede ADR-0024's Studio deferral or accept any remote or
operational inspection protocol.

## Acceptance

Acceptance requires a manifest-bound protocol-v2 review after deterministic
evidence proves exact success bytes, all three failure families, checksum and
digest refusal, documentation and HTTP cross-pins, matched Runtime Build
refusal, included and omitted Origin preservation, nondisclosure, relocation,
packed-package execution, and absence of source, compiler, Runtime, network,
and database access. This proposal does not authorize implementation, review,
release, push, tag, publication, or deployment.

## Rejected alternatives

- `questpie explain <resource-identity> --json`: filtering would lose the full
  projection inclusion/omission inventory or make the CLI another explanation
  owner.
- Bare `questpie explain --json`: an unbounded aggregate wrapper would obscure
  its subject and become a second public envelope.
- Reading OpenAPI and inferring omissions in the CLI: projected output cannot
  recover omitted Resources or their Origins.
- Compiling before explanation or consulting a running Runtime: either can
  change or broaden the authority being inspected.
