import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { Client } from "pg";

import { compileApplication } from "@questpie/compiler";

test("compiles deterministic application bundles after loading the PostgreSQL driver", async () => {
	expect(typeof Client).toBe("function");
	const compilation = await compileApplication({
		applicationRoot: resolve(import.meta.dir, "../../fixtures/collaboration"),
	});
	expect(compilation.generatedFiles["internal/application.js"]).toContain(
		"createRuntimePostgres",
	);
	expect(compilation.generatedFiles["runtime-build.json"]).toBeDefined();
}, 15_000);
