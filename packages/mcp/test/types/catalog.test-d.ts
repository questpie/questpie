import { mcpTool } from "../../src/exports/index.js";

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
