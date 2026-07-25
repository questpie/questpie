# @questpie/mcp

Model Context Protocol integration for QUESTPIE apps. The package exposes selected QUESTPIE collections, globals, annotated routes, custom MCP tools, and schema resources to AI clients through the same access rules and request context as the rest of the app.

## Features

- **HTTP MCP endpoint** - register `mcpModule` and serve MCP over the app route layer.
- **Stdio server** - start a local MCP server for desktop/IDE agents.
- **Policy-first tools** - expose read/write/delete operations explicitly per entity.
- **Route tools** - opt annotated JSON routes into MCP with path-param support.
- **Schema resources** - let agents inspect allowed collections, globals, routes, and fields.
- **Request context preservation** - HTTP tools run under the connecting request/session.
- **Workload boundary** - remote workloads use a consumer-supplied, fail-closed authorizer instead of OAuth, cookies, requester identity, or stdio system authority.

## Installation

```bash
bun add @questpie/mcp
```

## Register The Module

```ts
// modules.ts
import { mcpModule } from "@questpie/mcp/modules/mcp";

export default [mcpModule] as const;
```

Configure the reachable surface in `config/mcp.ts`:

```ts
import { mcpConfig } from "@questpie/mcp";

export default mcpConfig({
	crud: {
		collections: {
			posts: {
				operations: {
					list: true,
					get: true,
					create: true,
				},
			},
		},
	},
	routes: {
		routes: {
			"reports/generate": { operations: { execute: true } },
		},
	},
	resources: {
		collections: { posts: true },
		routes: { "reports/generate": true },
	},
});
```

Omission exposes nothing. Entity names, operations, annotated routes, and
schema resources must each be present in this catalog. Unknown names are
ignored. The resolved catalog also supplies the OAuth scope catalog, so OAuth
never advertises an app entity or operation that MCP does not release.

## Stdio Authority

Stdio has no ambient system authority. Bind it to an exact user-mode `ctx`, or
explicitly opt a local maintenance process into the system bypass:

```ts
await startStdioServer(app, {
	config: {
		stdio: { trustedMaintenance: true },
	},
});
```

Do not enable `trustedMaintenance` for remote or requester-controlled
processes. It intentionally bypasses ordinary user RBAC and OAuth scope checks.

## Custom Tools

```ts
// mcp-tools/publish-summary.ts
import { mcpTool } from "@questpie/mcp";
import { z } from "zod";

export default mcpTool("publish-summary", {
	access: ({ session }) => !!session,
	scopes: false,
	inputSchema: z.object({ postId: z.string() }),
}).handler(async ({ input, ctx }) => {
	const post = await ctx.collections.posts.findById(input.postId);
	return { structuredContent: { title: post.title } };
});
```

## Remote Workloads

Remote workload execution uses a separate public factory.
`createWorkloadMcpServer` accepts only an opaque envelope, a consumer-supplied
authorizer, a required consumer-supplied context binder, an optional audit sink,
and an optional opaque execution handoff. The binder turns the opaque authorized
context into the exact QUESTPIE request context used for discovery access checks,
call-time access checks, and handler execution. The bound context must use
`accessMode: "user"`; remote workloads cannot acquire the system bypass. The
factory deliberately has no request, cookie, requester context, OAuth, or
access-mode option.

Set `concurrencyKey` to a stable, non-secret consumer or tenant identifier when
multiple workload servers or ports should share one per-principal concurrency
bucket. Different keys are isolated; omitting the key creates an instance-local
bucket.

Every workload-visible tool opts into named capability facts:

```ts
import { mcpTool } from "@questpie/mcp";
import { z } from "zod";

export default mcpTool("messages.reply", {
	access: true,
	scopes: false,
	inputSchema: z.object({ body: z.string() }),
	workload: {
		capabilities: ["messages.write"],
		handoff: "messages.commit",
	},
}).handler(async ({ input }) => ({
	content: [{ type: "text", text: input.body }],
}));
```

MCP passes only the opaque envelope, phase, and bounded tool facts (`kind`,
`name`, `operation`, `intent`, `transport`, `capabilities`, and optional
`handoff`) to the authorizer. Discovery and every call are authorized and bound
independently. MCP does not interpret the returned opaque context or attribution.
Calls with a `handoff` capability execute through the consumer's handoff; MCP
does not add a durable effect or idempotency store. Missing or malformed
authorization or context binding fails closed, and tools without an explicit
workload requirement stay hidden.

When a trusted in-process subsystem needs only workload-enabled custom tools,
use the programmatic port instead of creating an MCP client/server loop:

```ts
import { createWorkloadMcpToolPort, mcpPublicErrorCode } from "@questpie/mcp";

const tools = createWorkloadMcpToolPort(app, workloadOptions);
const released = await tools.listCustomTools({ signal });
const result = await tools.callCustomTool({
	name: "messages.reply",
	input: { body: "Hello" },
	signal,
	requestId: runId,
});
```

The port excludes generated CRUD tools, routes, and resources by construction.
It uses the same immutable release catalog, per-call workload authorization,
context binding, MCP access rule, Zod input/output validation, execution
budgets, cancellation, and public error contract as transport calls. A failed
call returns `isError: true` with a stable code and correlation ID under
`_meta["questpie/error"]`. `mcpPublicErrorCode(error)` safely reads the code
from errors thrown by list/cancellation paths.

## Execution Budgets And Errors

All tool calls and schema resource reads share bounded execution state for an
app, including across HTTP requests and independently created workload ports.
Defaults can be narrowed with `execution`:

```ts
export default mcpConfig({
	execution: {
		maxInputBytes: 64 * 1024,
		maxInputDepth: 16,
		maxOutputDepth: 64,
		maxValueNodes: 10_000,
		maxOutputBytes: 1024 * 1024,
		timeoutMs: 30_000,
		maxConcurrency: 64,
		maxConcurrencyPerPrincipal: 8,
		maxTools: 512,
		maxResources: 512,
		onDiagnostic(event) {
			// Trusted, bounded server-side telemetry only.
		},
	},
});
```

Saturation rejects immediately; it does not create an unbounded queue. Timed
out or cancelled work keeps its concurrency permit until the underlying
operation actually settles, so code that ignores `signal` cannot bypass the
limit. Custom tool handlers and workload handoffs receive `signal`,
`requestId`, and `correlationId`. Public errors use stable codes:
`access_denied`, `invalid_input`, `input_too_large`, `output_too_large`,
`timeout`, `cancelled`, `busy`, and `internal`. Protocol responses and
diagnostics never include raw handler/database error messages, request input,
output, credentials, authorization envelopes, or workload attribution.

## Exports

| Entry Point                 | Purpose                              |
| --------------------------- | ------------------------------------ |
| `@questpie/mcp`             | Config, plugin, server, tool factory |
| `@questpie/mcp/modules/mcp` | `mcpModule` for `modules.ts`         |
| `@questpie/mcp/plugin`      | Codegen plugin export                |
| `@questpie/mcp/stdio`       | Stdio server entry                   |

## License

MIT
