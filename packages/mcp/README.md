# @questpie/mcp

Model Context Protocol integration for QUESTPIE apps. The package exposes selected QUESTPIE collections, globals, annotated routes, custom MCP tools, and schema resources to AI clients through the same access rules and request context as the rest of the app.

## Features

- **HTTP MCP endpoint** - register `mcpModule` and serve MCP over the app route layer.
- **Stdio server** - start a local MCP server for desktop/IDE agents.
- **Policy-first tools** - expose read/write/delete operations explicitly per entity.
- **Route tools** - opt annotated JSON routes into MCP with path-param support.
- **Schema resources** - let agents inspect allowed collections, globals, routes, and fields.
- **Request context preservation** - HTTP tools run under the connecting request/session.
- **Agent workload boundary** - independent Agent Actors use a validated, Run-bound `@questpie/ai` workload envelope instead of Human OAuth, cookies, requester identity, or stdio system authority.

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

## Agent Workloads

Agent execution is a separate public factory. `createAgentWorkloadMcpServer` accepts only an opaque authenticated workload envelope, its audience-bound resolver, optional redacted audit sink, and the typed command/effect handoff. It deliberately has no request, cookie, requester context, or access-mode option.

Every Agent-visible tool opts into a fail-closed workload requirement:

```ts
import { mcpTool } from "@questpie/mcp";
import { z } from "zod";

export default mcpTool("messages.reply", {
	inputSchema: z.object({ body: z.string() }),
	workload: {
		scope: "anchor_space",
		grant: "messages.create",
		effect: "message.create",
	},
}).handler(async ({ input }) => ({
	content: [{ type: "text", text: input.body }],
}));
```

Discovery and every call revalidate persisted Run/attempt, audience, epochs, lease, Skill/tool/effect capabilities, and exact Company or anchor-Space grants through `@questpie/ai`. Mutating calls also require the `AGENT_WORKLOAD_MCP_META` command fields and execute through `effectHandoff`; MCP does not implement a competing effect or idempotency store. Tools without an explicit workload requirement are hidden. Human OAuth and explicitly trusted maintenance-system servers continue to use `createMcpServer`/`startStdioServer` and never become Agent authority.

## Exports

| Entry Point                 | Purpose                              |
| --------------------------- | ------------------------------------ |
| `@questpie/mcp`             | Config, plugin, server, tool factory |
| `@questpie/mcp/modules/mcp` | `mcpModule` for `modules.ts`         |
| `@questpie/mcp/plugin`      | Codegen plugin export                |
| `@questpie/mcp/stdio`       | Stdio server entry                   |

## License

MIT
