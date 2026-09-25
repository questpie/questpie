import { mcpPrompts, mcpTool } from "../../src/exports/index.js";

mcpTool("valid.scoped", {
	access: true,
	scopes: "valid:scoped:invoke",
});

mcpTool("valid.unscoped", {
	access: true,
	scopes: false,
});

// @ts-expect-error custom tools require an explicit access policy
mcpTool("invalid.missing-access", {
	scopes: false,
});

// @ts-expect-error custom tools require an explicit OAuth scope policy
mcpTool("invalid.missing-scopes", {
	access: true,
});

mcpPrompts("valid.prompts", {
	access: true,
	scopes: "valid:prompts:read",
	list: () => [{ name: "hello" }],
	get: () => null,
});

// @ts-expect-error prompt providers require an explicit access policy
mcpPrompts("invalid.missing-access", {
	scopes: false,
	list: () => [],
	get: () => null,
});

// @ts-expect-error prompt providers require an explicit OAuth scope policy
mcpPrompts("invalid.missing-scopes", {
	access: true,
	list: () => [],
	get: () => null,
});
