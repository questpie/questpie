/**
 * Codegen smoke test
 *
 * Verifies that the full codegen pipeline (discover + template) produces
 * syntactically valid TypeScript output containing expected keys.
 *
 * Uses a temporary fixture directory with a minimal modules.ts,
 * one collection, one service, and one route.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodegen } from "../../src/cli/codegen/index.js";

let rootDir: string;
let outDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "questpie-smoke-"));
	outDir = join(rootDir, ".generated");

	// modules.ts — required by codegen
	await writeFile(
		join(rootDir, "modules.ts"),
		'export default [];\n',
		"utf-8",
	);

	// A minimal collection
	await mkdir(join(rootDir, "collections"), { recursive: true });
	await writeFile(
		join(rootDir, "collections", "posts.ts"),
		[
			'import { collection } from "questpie";',
			"",
			'export default collection("posts")',
			'  .fields(({ f }) => ({ title: f.text("Title") }))',
			"  .title(({ f }) => f.title);",
			"",
		].join("\n"),
		"utf-8",
	);

	// A minimal service
	await mkdir(join(rootDir, "services"), { recursive: true });
	await writeFile(
		join(rootDir, "services", "analytics.ts"),
		[
			'import { service } from "questpie";',
			"",
			"export default service()",
			'  .lifecycle("singleton")',
			"  .create(() => ({ track() {} }));",
			"",
		].join("\n"),
		"utf-8",
	);

	// A minimal route
	await mkdir(join(rootDir, "routes"), { recursive: true });
	await writeFile(
		join(rootDir, "routes", "hello.ts"),
		[
			'import { route } from "questpie";',
			"",
			"export default route()",
			"  .get()",
			'  .handler(async () => ({ message: "hello" }));',
			"",
		].join("\n"),
		"utf-8",
	);

	// Minimal config file
	await writeFile(
		join(rootDir, "questpie.config.ts"),
		[
			'import { config } from "questpie/cli";',
			"export default config({});",
			"",
		].join("\n"),
		"utf-8",
	);
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("codegen smoke", () => {
	it("generates valid TypeScript with expected collection, service, and route keys", async () => {
		const result = await runCodegen({
			rootDir,
			configPath: join(rootDir, "questpie.config.ts"),
			outDir,
			dryRun: true,
		});

		const { code } = result;

		// Basic syntax check — Bun transpiler already validated inside runCodegen,
		// but double-check the code is non-empty
		expect(code.length).toBeGreaterThan(100);

		// Should contain the collection key
		expect(code).toContain("posts");

		// Should contain the service key
		expect(code).toContain("analytics");

		// Should contain the route key
		expect(code).toContain("hello");

		// Should contain createApp call
		expect(code).toContain("createApp");

		// Should import modules
		expect(code).toContain("modules");
	});

	it("dry run does not write files to disk", async () => {
		await runCodegen({
			rootDir,
			configPath: join(rootDir, "questpie.config.ts"),
			outDir,
			dryRun: true,
		});

		const { existsSync } = await import("node:fs");
		expect(existsSync(outDir)).toBe(false);
	});

	it("non-dry run writes output file", async () => {
		const result = await runCodegen({
			rootDir,
			configPath: join(rootDir, "questpie.config.ts"),
			outDir,
			dryRun: false,
		});

		const { readFile } = await import("node:fs/promises");
		const written = await readFile(result.outputPath, "utf-8");
		expect(written).toBe(result.code);

		// Also check factories.ts was written
		const { existsSync } = await import("node:fs");
		expect(existsSync(join(outDir, "factories.ts"))).toBe(true);
	});
});
