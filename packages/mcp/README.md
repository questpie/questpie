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
			posts: { expose: true, read: true, write: true },
		},
	},
});
```

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

Every workload-visible tool opts into named capability facts:

```ts
import { mcpTool } from "@questpie/mcp";
import { z } from "zod";

export default mcpTool("messages.reply", {
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

## Exports

| Entry Point                 | Purpose                              |
| --------------------------- | ------------------------------------ |
| `@questpie/mcp`             | Config, plugin, server, tool factory |
| `@questpie/mcp/modules/mcp` | `mcpModule` for `modules.ts`         |
| `@questpie/mcp/plugin`      | Codegen plugin export                |
| `@questpie/mcp/stdio`       | Stdio server entry                   |

## License

MIT
