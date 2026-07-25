# @questpie/sandbox

Hardened isolated-script execution for QUESTPIE. The package ships the HTTP
adapter used by a QUESTPIE app and the Deno supervisor source that executes each
untrusted script in a fresh, capability-scoped subprocess.

## Features

- HTTP `ExecutorAdapter` for `ctx.executor.run()`
- fresh Deno subprocess with bounded wall time and memory
- capability-scoped collections, stores, files, and network bindings
- explicitly released custom MCP tools through a separate guest namespace
- SSRF, redirect, private-address, and metadata-address protection
- optional Linux network namespace/firewall defense in depth
- generic, consumer-supplied workload authorization

## Installation

```bash
bun add @questpie/sandbox
```

## Trusted framework execution

```ts
import { httpSandboxAdapter } from "@questpie/sandbox/adapter";
import { appConfig } from "questpie";

export default appConfig({
	executor: {
		sandboxed: httpSandboxAdapter({
			url: process.env.SANDBOX_URL,
			hostAdmissionSecret: process.env.SANDBOX_HOST_ADMISSION_SECRET,
		}),
	},
});
```

The adapter and supervisor must share the same random
`SANDBOX_HOST_ADMISSION_SECRET` of at least 32 bytes. Omitting the credential
fails closed. `SANDBOX_URL` must be a canonical HTTP(S) origin with no userinfo,
fragment, query, or path prefix. The adapter never follows `/run` redirects, so
the host admission credential cannot cross origins. Broker coordinates are still minted by QUESTPIE's core executor
and remain capability-scoped. Any execution with bindings also requires the
supervisor's canonical `SANDBOX_BROKER_URL`; missing, malformed, or non-matching
protocol, host, effective port, path, or query is denied before spawn. Userinfo
and fragments are forbidden; only one trailing path slash is treated as
equivalent. The supervisor fetches the validated canonical URL, never the raw
request spelling.

Bindings guests always run with `--allow-net=[]`. Their declared `net`
allowlist remains host-side and is used only by the resolve/validate/pin HTTP
broker. The backwards-compatible compute-only path may still receive a direct
Deno network grant.

## Generic workload authorization

A remote consumer supplies its own opaque envelope and authorizer. QUESTPIE does
not prescribe, inspect, or persist the envelope. The authorizer returns the
complete sandbox policy for one execution; no source, input, process capability,
secret, or broker binding can be supplied beside the envelope.

```ts
import { httpSandboxAdapter } from "@questpie/sandbox";

const adapter = httpSandboxAdapter({
	url: process.env.SANDBOX_URL,
	workload: {
		admission: {
			keyId: process.env.SANDBOX_WORKLOAD_ADMISSION_KEY_ID!,
			secret: new TextEncoder().encode(
				process.env.SANDBOX_WORKLOAD_ADMISSION_SECRET!,
			),
			instanceId: process.env.SANDBOX_INSTANCE_ID!,
		},
		authorize: async (opaqueEnvelope, { phase, signal }) => {
			const authorization = await consumerAuthority.authorize(opaqueEnvelope, {
				phase,
				signal,
			});
			if (!authorization) return null;

			return {
				source: authorization.source,
				input: authorization.input,
				capabilities: {
					net: authorization.networkHosts,
					import: authorization.importHosts,
					timeoutMs: 5_000,
					memoryMb: 128,
				},
				secrets: {},
				validUntil: authorization.validUntil,
			};
		},
		audit: writeRedactedSandboxDecision,
	},
});

const result = await adapter.runWorkload({ envelope: consumerEnvelope });
```

The authorizer is called at preparation and immediately before dispatch. Both
normalized policies must be identical. Authorization and audit callbacks have
hard deadlines, caller cancellation is propagated, and malformed/missing
authorization fails closed. Policy input, secrets, bindings, source, combined
egress hosts, wall time, memory, and the final request body all have hard bounds.
Cancellation after dispatch aborts broker relays and terminates the guest with a
bounded `SIGTERM`/`SIGKILL` sequence.

The subprocess boundary uses one 5 MiB decoded HTTP body budget. Its
method-aware request, response, frame, and cumulative-output limits are derived
from the exact base64 expansion plus bounded JSON-envelope headroom. Native
binding results and custom-tool results remain capped at 768 KiB. Stderr is
independently capped at 256 KiB, binding calls at 256 per run, and concurrent
broker relays at 16. Crossing a limit kills the guest and aborts outstanding
relays. Broker and supervisor HTTP responses are streamed through byte caps and
parsed against exact schemas; broker-provided error text is replaced by
supervisor-owned stable messages before it can enter the guest. Broker and
`/run` redirects are rejected. Any broker denial or malformed response latches
a terminal run failure; guest `catch` code cannot turn it back into success. A
valid result frame is terminal immediately, and a result racing an in-flight
RPC is rejected.

The adapter then signs a minimal, product-neutral transport admission. It is
bound to the exact request body and one supervisor instance, expires within five
seconds, and is consumed once. The supervisor rejects missing, forged, expired,
replayed, wrong-instance, and body-mismatched admissions before spawning a
subprocess. Consumer audit events distinguish authorization decisions from the
terminal transport outcome and include only decision plus phase/reason. The
supervisor's transport log additionally includes its own instance id. Neither
surface contains the opaque envelope, source, inputs, secrets, or broker token.

`SANDBOX_INSTANCE_ID` is a process incarnation, not a deployment or replica id.
It must be newly generated for every supervisor process and restart. The
adapter's `SANDBOX_URL` must route directly to the one process named by its
configured instance id; do not put this admission path behind an unpinned
round-robin load balancer. Reusing one instance id across replicas is forbidden.
Replay state is deliberately process-local because the admission is
cryptographically bound to that unique process incarnation.

## Custom tools

Custom `mcpTool(...)` definitions can be exposed to a sandbox without turning
MCP CRUD into the sandbox data API. Collections, files, and stores keep using
their native broker primitives; only explicitly released custom tools enter the
separate `questpie.tools` namespace.

Configure the host-side consumer authorization port in `questpie.config.ts`:

```ts
import { sandboxCustomTools } from "@questpie/sandbox";
import { runtimeConfig } from "questpie/app";

export default runtimeConfig({
	// db, executor, …
	sandboxCustomTools: sandboxCustomTools({
		authorizer: consumerToolAuthority,
		contextBinder: consumerQuestpieContextBinder,
		evidence: async (event) => {
			// Product-neutral: phase, tool name, result, reason, duration only.
			await evidenceSink.write(event);
		},
	}),
});
```

The tool itself must be in the released MCP custom-tool catalog and declare an
explicit workload requirement. Omitted exposure or workload policy remains
invisible and uncallable. Every call repeats consumer authorization, binds a
fresh user-mode QUESTPIE context, rechecks the tool access/scope policy, parses
the original input schema, and invokes the original handler.

The host supplies only an opaque envelope for the run:

```ts
const result = await ctx.executor.run({
	isolation: "sandboxed",
	source: `
		export default async () => {
			const { tools } = await globalThis.questpie.tools.list();
			return globalThis.questpie.tools.call("reports.generate", {
				period: "week",
			});
		}
	`,
	brokerUrl: "https://app.internal/api/sandbox/rpc",
	sandboxTools: { envelope: consumerEnvelope },
	capabilities: {
		net: [],
		import: [],
		timeoutMs: 5_000,
		memoryMb: 128,
	},
});
```

The adapter keeps the envelope in the app host. The broker endpoint and token
are sent only to the trusted supervisor through the existing bindings
coordinate; none of them is exposed to guest code or `globalThis.questpie`.
Discovery, arguments, results, operation count, wall time, and concurrency are
bounded. Evidence callbacks receive no envelope, arguments, result body,
bearer credential, app instance, database handle, or request context.

Defaults/hard maxima are: 64/256 discovered tools, 256 KiB/768 KiB discovery
payload, 32 KiB/63 KiB arguments, 256 KiB/768 KiB result, 64/256 operations,
5 s/30 s per operation, 4/16 concurrent operations, and 250 ms/1 s for
observational evidence. Overrides must be positive safe integers at or below
the hard maximum; `sandboxCustomTools(...)` rejects invalid configuration.
Denied operations consume the call budget. A timed-out handler keeps its
concurrency slot until the underlying MCP call settles, even if it ignores
cancellation.

## Run the supervisor

```bash
export SANDBOX_WORKLOAD_ADMISSION_KEY_ID=sandbox-workload-v1
export SANDBOX_WORKLOAD_ADMISSION_SECRET='replace-with-at-least-32-random-bytes'
export SANDBOX_HOST_ADMISSION_SECRET='replace-with-another-32-byte-secret'
# Generate a new value for every supervisor process/restart.
export SANDBOX_INSTANCE_ID=sandbox_instance_01HXYZ
# Required whenever a policy can receive QUESTPIE broker bindings.
export SANDBOX_BROKER_URL='https://app.internal/api/sandbox/rpc'

deno run --allow-net --allow-env --allow-run --allow-read \
	--allow-write=$TMPDIR \
	node_modules/@questpie/sandbox/src/sandbox-server.ts
```

Set `SANDBOX_URL` in the app to the directly addressed URL of that supervisor
instance.

## Exports

| Entry point                         | Purpose                                       |
| ----------------------------------- | --------------------------------------------- |
| `@questpie/sandbox`                 | Adapter, authorization, validation, bindings  |
| `@questpie/sandbox/adapter`         | HTTP adapter and workload authorization types |
| `@questpie/sandbox/modules/sandbox` | Generated broker route module                 |

## License

MIT
