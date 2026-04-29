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
import { describe, expect, it } from "bun:test";

import {
	coreCodegenPlugin,
	resolveTargetGraph,
} from "../../src/cli/codegen/index.js";
import type {
	CodegenPlugin,
	ScaffoldConfig,
} from "../../src/cli/codegen/types.js";
import {
	toCamelCase,
	toKebabCase,
	toPascalCase,
	toTitleCase,
} from "../../src/cli/commands/add.js";

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
		expect(toKebabCase("MY BLOCK")).toBe("my-block");
		expect(toKebabCase("simple")).toBe("simple");
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
});
