# @questpie/mcp

Model Context Protocol integration for QUESTPIE apps. The package exposes selected QUESTPIE collections, globals, annotated routes, custom MCP tools, and schema resources to AI clients through the same access rules and request context as the rest of the app.

## Features

- **HTTP MCP endpoint** - register `mcpModule` and serve MCP over the app route layer.
- **Stdio server** - start a local MCP server for desktop/IDE agents.
- **Policy-first tools** - expose read/write/delete operations explicitly per entity.
- **Route tools** - opt annotated JSON routes into MCP with path-param support.
- **Schema resources** - let agents inspect allowed collections, globals, routes, and fields.
- **Request context preservation** - HTTP tools run under the connecting request/session.

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

## Exports

| Entry Point                 | Purpose                             |
| --------------------------- | ----------------------------------- |
| `@questpie/mcp`             | Config, plugin, server, tool factory |
| `@questpie/mcp/modules/mcp` | `mcpModule` for `modules.ts`        |
| `@questpie/mcp/plugin`      | Codegen plugin export               |
| `@questpie/mcp/stdio`       | Stdio server entry                  |

## License

MIT
