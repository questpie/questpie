# MCP Integration

Use `@questpie/mcp` when a QUESTPIE app should expose collections, globals, annotated JSON routes, schemas, or custom tools to Model Context Protocol clients.

## Static Module Pattern

MCP is codegen-aware. Keep `modules.ts` static and put options in `config/mcp.ts`.

```ts title="modules.ts"
import mcpModule from "@questpie/mcp";

export default [mcpModule] as const;
```

```ts title="config/mcp.ts"
import { mcpConfig } from "@questpie/mcp";

export default mcpConfig({
	crud: {
		defaults: {
			collections: { read: true, write: false, delete: false },
			globals: { read: true, write: false },
		},
		collections: {
			posts: { read: true, write: true },
			users: false,
		},
		globals: {
			siteSettings: { read: true, write: true },
		},
	},
	routes: {
		exposeAnnotated: true,
	},
});
```

Do not use `mcpModule(options)`. Runtime options belong in the plugin-discovered config file.

`mcpModule` carries its codegen plugin. Do not also add `mcpPlugin()` to `questpie.config.ts` unless you are doing a custom setup that deliberately omits `mcpModule` — double registration duplicates the plugin.

## CRUD Policy

Generated collection tools:

- `collections.{name}.list`
- `collections.{name}.count`
- `collections.{name}.get`
- `collections.{name}.create`
- `collections.{name}.update`
- `collections.{name}.delete`

Generated global tools:

- `globals.{name}.get`
- `globals.{name}.update`

Policy order:

1. Transport defaults.
2. CRUD defaults.
3. Per-entity override.
4. QUESTPIE access rules execute last and can still deny.

HTTP is user mode and read-oriented by default. HTTP cannot be made system mode with config or options. Stdio defaults to trusted system mode unless explicitly lowered to user mode.

Use `fields.include` / `fields.exclude` for top-level filtering. It applies to create/update input, CRUD outputs, list docs, global results, and schema resources. Nested relation projection is out of scope for v1.

## Route Tools

Only simple JSON routes are auto-converted:

- Route has `.schema(...)`.
- Route is not `.raw()`.
- Route has `meta.mcp.expose === true`.
- `routes.exposeAnnotated` is not `false`.

```ts
route()
	.post()
	.schema(inputSchema)
	.outputSchema(outputSchema)
	.meta({
		title: "Generate report",
		mcp: {
			expose: true,
			name: "reports.generate",
			annotations: { readOnlyHint: true },
		},
	})
	.handler(async ({ input }) => ({ ok: true }));
```

Routes without path params use the route input schema directly. Routes with params use `{ params, input }`. Route policy keys use the route key, not the overridden tool name.

## Resources

Built-in resources:

- `questpie://schema/collections`
- `questpie://schema/collections/{name}`
- `questpie://schema/globals`
- `questpie://schema/globals/{name}`
- `questpie://schema/routes`
- `questpie://schema/routes/{key}`

Resources honor MCP policy and QUESTPIE access visibility. Route resources include input/output JSON Schema when the route has Zod schemas.

## Custom Tools

Custom tools live in `mcp-tools/` and are discovered by codegen.

```ts
import { mcpTool } from "@questpie/mcp";
import { z } from "zod";

export default mcpTool("generate-report", {
	description: "Generate a report.",
	inputSchema: z.object({ period: z.string() }),
	access: ({ session }) => !!session,
}).handler(async ({ input, ctx }) => ({
	structuredContent: await ctx.services.reports.generate(input),
}));
```

Custom tool access is checked during `tools/list` and again during `tools/call`.

## Programmatic Servers

Use `createMcpServer(app, { transport: "http", request })` for programmatic HTTP setup. If no `ctx` is passed, the request is preserved through `app.createContext()`.

Use `startStdioServer(app)` for trusted stdio integrations:

```ts
import { app } from "#questpie";
import { startStdioServer } from "@questpie/mcp/stdio";

await startStdioServer(app);
```

## Gotchas

- Add `mcpModule` to static `modules.ts`, then run codegen.
- HTTP system mode is intentionally impossible until a future trusted-token design exists.
- Field filtering is top-level only.
- Raw routes and unannotated routes are not tools.
- Custom tool results should use `structuredContent` for machine-readable output.
