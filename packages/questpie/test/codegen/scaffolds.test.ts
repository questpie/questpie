/**
 * Tests: scaffold system
 *
 * Covers:
 * 1. resolveTargetGraph merges scaffolds from core plugin
 * 2. resolveTargetGraph merges scaffolds from multiple plugins
 * 3. Same scaffold name on different targets → both present
 * 4. Name casing helpers (kebab, camel, pascal, title)
 * 5. Scaffold template output produces valid content
 * 6. Scaffold registry building collects across targets
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	coreCodegenPlugin,
	resolveTargetGraph,
} from "../../src/cli/codegen/index.js";
import type {
	CodegenPlugin,
	ScaffoldConfig,
} from "../../src/cli/codegen/types.js";
import {
	addCommand,
	stripScaffoldTypeSuffix,
	toCamelCase,
	toKebabCase,
	toPascalCase,
	toTitleCase,
} from "../../src/cli/commands/add.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal admin-like plugin that contributes scaffolds to two targets. */
function testAdminPlugin(): CodegenPlugin {
	return {
		name: "test-admin",
		targets: {
			server: {
				root: ".",
				outputFile: "index.ts",
				scaffolds: {
					block: {
						dir: "blocks",
						description: "Server-side block",
						template: ({ kebab, camel }) =>
							`export const ${camel}Block = block("${kebab}");`,
					},
					view: {
						dir: "views",
						description: "Server-side view",
						template: ({ kebab, camel }) =>
							`export const ${camel}View = view("${kebab}");`,
					},
				},
			},
			"admin-client": {
				root: "../admin",
				outputFile: "client.ts",
				scaffolds: {
					block: {
						dir: "blocks",
						extension: ".tsx",
						description: "Client-side block",
						template: ({ kebab, pascal }) =>
							`export default defineBlock("${kebab}", () => <${pascal}Block />);`,
					},
					field: {
						dir: "fields",
						extension: ".tsx",
						description: "Client-side field",
						template: ({ kebab, pascal }) =>
							`export default field({ name: "${kebab}", component: ${pascal}Field });`,
					},
				},
			},
		},
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("scaffold types on resolved targets", () => {
	it("core plugin declares server scaffolds", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin()]);
		const server = graph.get("server")!;
		expect(server.scaffolds).toBeDefined();

		// Core scaffolds
		const names = Object.keys(server.scaffolds);
		expect(names).toContain("collection");
		expect(names).toContain("channel");
		expect(names).toContain("global");
		expect(names).toContain("job");
		expect(names).toContain("service");
		expect(names).toContain("email");
		expect(names).toContain("route");
		expect(names).toContain("seed");
		expect(names).toContain("migration");
	});

	it("merges scaffolds from multiple plugins on the same target", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin(), testAdminPlugin()]);
		const server = graph.get("server")!;

		// Core scaffolds still present
		expect(server.scaffolds.collection).toBeDefined();
		expect(server.scaffolds.route).toBeDefined();

		// Admin plugin added block + view to server
		expect(server.scaffolds.block).toBeDefined();
		expect(server.scaffolds.block.description).toBe("Server-side block");
		expect(server.scaffolds.view).toBeDefined();
	});

	it("same scaffold name on different targets → both present", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin(), testAdminPlugin()]);

		const serverBlock = graph.get("server")!.scaffolds.block;
		const clientBlock = graph.get("admin-client")!.scaffolds.block;

		expect(serverBlock).toBeDefined();
		expect(clientBlock).toBeDefined();

		// They should be different scaffolds (different descriptions, extensions)
		expect(serverBlock.description).toBe("Server-side block");
		expect(clientBlock.description).toBe("Client-side block");
		expect(clientBlock.extension).toBe(".tsx");
	});

	it("admin-client target has field scaffold but server does not", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin(), testAdminPlugin()]);

		expect(graph.get("server")!.scaffolds.field).toBeUndefined();
		expect(graph.get("admin-client")!.scaffolds.field).toBeDefined();
	});
});

describe("name casing helpers", () => {
	it("toKebabCase", () => {
		expect(toKebabCase("myBlock")).toBe("my-block");
		expect(toKebabCase("MyBlock")).toBe("my-block");
		expect(toKebabCase("my-block")).toBe("my-block");
		expect(toKebabCase("my_block")).toBe("my-block");
		expect(toKebabCase("my.block")).toBe("my-block");
		expect(toKebabCase("MY BLOCK")).toBe("my-block");
		expect(toKebabCase("simple")).toBe("simple");
	});

	it("stripScaffoldTypeSuffix removes old entity filename suffix habits", () => {
		expect(stripScaffoldTypeSuffix("posts.collection", "collection")).toBe(
			"posts",
		);
		expect(stripScaffoldTypeSuffix("site-settings.global", "global")).toBe(
			"site-settings",
		);
		expect(stripScaffoldTypeSuffix("send-welcome.job", "job")).toBe(
			"send-welcome",
		);
		expect(stripScaffoldTypeSuffix("posts", "collection")).toBe("posts");
		expect(stripScaffoldTypeSuffix("collection", "collection")).toBe(
			"collection",
		);
	});

	it("toCamelCase", () => {
		expect(toCamelCase("my-block")).toBe("myBlock");
		expect(toCamelCase("simple")).toBe("simple");
		expect(toCamelCase("a-b-c")).toBe("aBC");
	});

	it("toPascalCase", () => {
		expect(toPascalCase("my-block")).toBe("MyBlock");
		expect(toPascalCase("simple")).toBe("Simple");
	});

	it("toTitleCase", () => {
		expect(toTitleCase("my-block")).toBe("My Block");
		expect(toTitleCase("simple")).toBe("Simple");
		expect(toTitleCase("a-b-c")).toBe("A B C");
	});
});

describe("scaffold template output", () => {
	it("core collection template produces valid content", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin()]);
		const scaffold = graph.get("server")!.scaffolds.collection;
		const output = scaffold.template({
			kebab: "blog-posts",
			camel: "blogPosts",
			pascal: "BlogPosts",
			title: "Blog Posts",
			targetId: "server",
		});

		expect(output).toContain(
			'import { collection } from "#questpie/factories"',
		);
		expect(output).toContain('collection("blog-posts")');
		expect(output).toContain("blogPosts");
		expect(output).toContain('f.text(255).label("Title").required()');
	});

	it("core channel template keeps the filename key separate from its wire pattern", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin()]);
		const scaffold = graph.get("server")!.scaffolds.channel;
		const output = scaffold.template({
			kebab: "chat-room",
			camel: "chatRoom",
			pascal: "ChatRoom",
			title: "Chat Room",
			targetId: "server",
		});

		expect(scaffold.dir).toBe("channels");
		expect(output).toContain('import { channel } from "questpie/channels"');
		expect(output).toContain('channel("chat-room")');
		expect(output).toContain("export default");
		expect(output).toContain(".events({})");
	});

	it("core email template has .tsx extension", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin()]);
		const scaffold = graph.get("server")!.scaffolds.email;
		expect(scaffold.extension).toBe(".tsx");
	});

	it("core route template uses an executable JSON route shape", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin()]);
		const output = graph.get("server")!.scaffolds.route.template({
			kebab: "sync-orders",
			camel: "syncOrders",
			pascal: "SyncOrders",
			title: "Sync Orders",
			targetId: "server",
		});

		expect(output).toContain(".post()");
		expect(output).toContain(".schema(z.object({}))");
		expect(output).not.toContain("ctx");
	});

	it("core seed template uses the standard seed context", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin()]);
		const output = graph.get("server")!.scaffolds.seed.template({
			kebab: "demo-content",
			camel: "demoContent",
			pascal: "DemoContent",
			title: "Demo Content",
			targetId: "server",
		});

		expect(output).toContain("async run({ collections, globals, log })");
		expect(output).not.toContain("createContext");
	});

	it("multi-target scaffold produces different content per target", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin(), testAdminPlugin()]);

		const serverBlock = graph.get("server")!.scaffolds.block;
		const clientBlock = graph.get("admin-client")!.scaffolds.block;

		const ctx = {
			kebab: "hero",
			camel: "hero",
			pascal: "Hero",
			title: "Hero",
			targetId: "server",
		};

		const serverOutput = serverBlock.template(ctx);
		const clientOutput = clientBlock.template({
			...ctx,
			targetId: "admin-client",
		});

		// Server uses block()
		expect(serverOutput).toContain('block("hero")');
		// Client uses defineBlock()
		expect(clientOutput).toContain('defineBlock("hero"');
	});
});

describe("scaffold registry building", () => {
	it("collects scaffolds across targets", () => {
		const graph = resolveTargetGraph([coreCodegenPlugin(), testAdminPlugin()]);

		// Build registry (same logic as addCommand)
		const registry = new Map<
			string,
			Array<{ targetId: string; scaffold: ScaffoldConfig }>
		>();
		for (const [targetId, target] of graph) {
			for (const [name, scaffold] of Object.entries(target.scaffolds)) {
				let entries = registry.get(name);
				if (!entries) {
					entries = [];
					registry.set(name, entries);
				}
				entries.push({ targetId, scaffold });
			}
		}

		// "block" should appear in both targets
		const blockEntries = registry.get("block")!;
		expect(blockEntries.length).toBe(2);
		const blockTargets = blockEntries.map((e) => e.targetId).sort();
		expect(blockTargets).toEqual(["admin-client", "server"]);

		// "collection" should be server-only
		const collEntries = registry.get("collection")!;
		expect(collEntries.length).toBe(1);
		expect(collEntries[0].targetId).toBe("server");

		// "field" should be admin-client-only
		const fieldEntries = registry.get("field")!;
		expect(fieldEntries.length).toBe(1);
		expect(fieldEntries[0].targetId).toBe("admin-client");
	});

	it("questpie add lists scaffolds contributed by modules.ts plugins", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "questpie-add-scaffolds-"));
		const configPath = join(tempDir, "questpie.config.ts");
		await writeFile(configPath, "export default {};\n", "utf-8");
		await writeFile(
			join(tempDir, "modules.ts"),
			[
				"export default [{",
				'	name: "test-module",',
				"	plugin: {",
				'		name: "test-module-plugin",',
				"		targets: {",
				"			server: {",
				'				root: ".",',
				'				outputFile: "index.ts",',
				"				scaffolds: {",
				"					workflow: {",
				'						dir: "workflows",',
				'						description: "Durable workflow",',
				'						template: ({ kebab }) => `export default ${JSON.stringify("${kebab}")};`,',
				"					},",
				"				},",
				"			},",
				"		},",
				"	},",
				"}] as const;\n",
			].join("\n"),
			"utf-8",
		);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		try {
			await addCommand({ configPath, list: true });
		} finally {
			console.log = originalLog;
		}

		expect(logs.join("\n")).toContain("workflow");
		expect(logs.join("\n")).toContain("Durable workflow");
	});
});
