import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mcpPlugin } from "../../../mcp/src/server/plugin.js";
import {
	discoverFiles,
	type DiscoverFilesOptions,
} from "../../src/cli/codegen/discover.js";
import {
	coreCodegenPlugin,
	resolveTargetGraph,
} from "../../src/cli/codegen/index.js";

describe("mcp codegen plugin", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "questpie-mcp-codegen-"));
		await mkdir(join(root, "config"), { recursive: true });
		await mkdir(join(root, "mcp-tools"), { recursive: true });
		await writeFile(
			join(root, "modules.ts"),
			`import mcpModule from "@questpie/mcp";\n\nexport default [mcpModule] as const;\n`,
		);
		await writeFile(
			join(root, "config", "mcp.ts"),
			`import { mcpConfig } from "@questpie/mcp";\n\nexport default mcpConfig({ crud: { collections: { posts: { read: true } } } });\n`,
		);
		await writeFile(
			join(root, "mcp-tools", "report.ts"),
			`import { mcpTool } from "@questpie/mcp";\nimport { z } from "zod";\n\nexport default mcpTool("generate-report", { inputSchema: z.object({}) }).handler(async () => ({ content: [{ type: "text", text: "ok" }] }));\n`,
		);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("discovers config/mcp.ts and mcp-tools", async () => {
		const graph = resolveTargetGraph([coreCodegenPlugin(), mcpPlugin()]);
		const target = graph.get("server")!;
		const options: DiscoverFilesOptions = {
			categories: target.categories,
			discover: target.discover,
		};

		const discovered = await discoverFiles(root, root, options);

		expect(discovered.singles.get("mcpConfig")?.configKey).toBe("mcp");
		expect(discovered.categories.get("mcpTools")?.has("generateReport")).toBe(
			true,
		);
	});
});
