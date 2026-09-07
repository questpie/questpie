import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { Client } from "pg";

import { compileApplication } from "@questpie/compiler";

test.each(["collaboration", "team-support-desk"])(
	"compiles %s after loading the PostgreSQL driver",
	async (fixture) => {
		expect(typeof Client).toBe("function");
		const compilation = await compileApplication({
			applicationRoot: resolve(import.meta.dir, "../../fixtures", fixture),
		});
		expect(compilation.generatedFiles["internal/application.js"]).toContain(
			"createRuntimePostgres",
		);
		expect(compilation.generatedFiles["runtime-build.json"]).toBeDefined();
	},
	15_000,
);
