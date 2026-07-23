# @questpie/sandbox

Hardened sandboxed code execution for QUESTPIE executor workloads. The package ships the HTTP adapter used by a QUESTPIE app and the Deno supervisor source that executes untrusted code in a separate process with capability-scoped network, import, file, and app bindings.

## Features

- **HTTP executor adapter** - connect `ctx.executor.run()` to a standalone sandbox service.
- **Deno supervisor** - run guest code outside the main Bun/Node app process.
- **Capability-scoped bindings** - expose only declared collections, stores, files, and fetch access.
- **SSRF protection** - validate literal IPs, DNS rebinding, redirects, and private/metadata ranges.
- **Network isolation support** - Linux network namespace/firewall planning for defense in depth.
- **Structured failures** - timeouts, non-JSON responses, and network failures return predictable results.
- **Authenticated Agent path** - revalidate workload authority and bind the admitted request to its principal-derived policy and work root.

## Installation

```bash
bun add @questpie/sandbox
```

## Configure The Adapter

```ts
// config/app.ts
import { httpSandboxAdapter } from "@questpie/sandbox/adapter";
import { appConfig } from "questpie";

export default appConfig({
	executor: {
		sandboxed: httpSandboxAdapter({
			url: process.env.SANDBOX_URL,
			nonAgentAdmissionSecret: process.env.SANDBOX_NON_AGENT_ADMISSION_SECRET,
		}),
	},
});
```

Guest bindings require a host-side broker route in the app or control-plane layer. Every explicit non-Agent `run()` also needs the same minimum-32-byte `SANDBOX_NON_AGENT_ADMISSION_SECRET` on the trusted adapter and supervisor. An omitted execution mode never falls back to this path.

## Agent Workload Boundary

Agent execution uses the separate `createAgentWorkloadSandboxBoundary()` seam. It accepts only an opaque `AuthenticatedAgentWorkloadEnvelope` from `@questpie/ai`, calls the injected sandbox-audience `resolver.validate()` when the boundary opens, before trusted request preparation, immediately before sandbox creation, and before every privileged binding or effect.

The boundary policy is trusted server configuration loaded from the Run's pinned policy revisions. It is never accepted from guest input. It pins the exact Company, anchor Space, Skill, execution policy, executable source SHA-256, named input projection, disclosure boundary, filesystem paths, network/import hosts, named secret bindings, tools, and effects. Wildcard allow-all entries, real `HOME`, the process cwd, root, and relative work-root fallbacks are rejected.

```ts
import { createAgentWorkloadSandboxBoundary } from "@questpie/sandbox";

const boundary = createAgentWorkloadSandboxBoundary({
	resolver: sandboxAudienceResolver,
	workRootBase: "/var/lib/questpie/workloads",
	policy: pinnedSandboxPolicy,
	audit: writeRedactedWorkloadAudit,
});

const adapter = httpSandboxAdapter({
	url: process.env.SANDBOX_URL,
	agentWorkload: {
		boundary,
		admission: {
			keyId: process.env.SANDBOX_AGENT_ADMISSION_KEY_ID!,
			secret: new TextEncoder().encode(
				process.env.SANDBOX_AGENT_ADMISSION_SECRET!,
			),
			// Issued by the control plane for this supervisor process only.
			instanceId: sandboxLease.instanceId,
		},
		execution: {
			// Resolve source and projector from the revisions pinned by `policy`.
			source: pinnedSkillSource,
			timeoutMs: 8_000,
			memoryMb: 128,
			inputProjections: pinnedInputProjectionRegistry,
		},
	},
});

const result = await adapter.runAgentWorkload({
	authority: authenticatedEnvelope,
});
```

`runAgentWorkload()` accepts only the authenticated envelope. The trusted registry resolves a projector by the complete pinned reference `{ id, skillRevisionId, executionPolicyRevisionId, sourceSha256 }`; a projector cannot travel beside a self-declared id in adapter configuration. The resolved projector derives guest input from only the fresh principal and disclosure boundary. Source, arbitrary input, network/import capabilities, limits, secrets, and bindings cannot be supplied per run: source and limits come from trusted runtime configuration, network/import hosts come from the pinned policy, and the initial Agent guest receives no raw secret values or broker binding.

The adapter validates the pinned source digest and projector before revalidating once more, signing the exact request body, and sending it to one supervisor instance. Admissions expire within five seconds, are bound to that instance, and are consumed once. The control plane must generate a new `SANDBOX_INSTANCE_ID` for every supervisor process/restart and distribute the matching value to authorized adapters; an admission for a sibling replica or previous process is rejected.

The Deno supervisor rejects missing, forged, expired, replayed, wrong-instance, or body-mismatched admissions before spawn. It creates the physical work root beneath `Company/WorkRequest/Attempt/Admission`, but the child process runs from stable `/` and guest-visible Deno and Node path surfaces report only `/work`, `questpie://sandbox/guest-entry.ts`, and `/runtime/deno`. The trusted entry and bindings are bundled into a self-contained local `data:` module before spawn, so bootstrap needs no host source path or supervisor socket and remains available inside a Linux network namespace.

Denied operations use one existence-safe response. The supervisor emits structured `questpie.sandbox.agent_admission` events; valid signed claims preserve Run, attempt, Agent, Company, Space, Worker, lease, and supervisor attribution even for a denial. Events never include request or source hashes, hidden policy targets, arguments, credential values, or host paths. The legacy `run()` method remains the explicitly host-authenticated non-Agent executor path; Agent integrations use `runAgentWorkload()`.

## Run The Supervisor

The Deno supervisor source is published with the package:

```bash
export SANDBOX_AGENT_ADMISSION_KEY_ID=sandbox-agent-v1
export SANDBOX_AGENT_ADMISSION_SECRET='replace-with-at-least-32-random-bytes'
export SANDBOX_NON_AGENT_ADMISSION_SECRET='replace-with-another-32-byte-secret'
# Unique per supervisor process. The control plane must rotate it on restart.
export SANDBOX_INSTANCE_ID=sandbox_instance_01HXYZ
export SANDBOX_AGENT_WORK_ROOT=/var/lib/questpie/workloads

deno run --allow-net --allow-env --allow-run --allow-read \
	--allow-write=/var/lib/questpie/workloads,$TMPDIR \
	node_modules/@questpie/sandbox/src/sandbox-server.ts
```

Set `SANDBOX_URL` in the app to the supervisor URL.

## Exports

| Entry Point                 | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `@questpie/sandbox`         | Adapter, validation, and binding utilities |
| `@questpie/sandbox/adapter` | `httpSandboxAdapter()` only                |

## License

MIT
