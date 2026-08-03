import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	createDisposablePostgres,
	sweepStalePostgresDatabases,
} from "../src/scenario.js";

const packageRoot = join(import.meta.dirname, "..");
const manifest = JSON.parse(
	readFileSync(join(packageRoot, "package.json"), "utf8"),
) as {
	dependencies: Record<string, string>;
	exports: Record<string, unknown>;
	peerDependencies: Record<string, string>;
	publishConfig: { exports: Record<string, unknown> };
};
const coreManifest = JSON.parse(
	readFileSync(join(packageRoot, "..", "questpie", "package.json"), "utf8"),
) as {
	dependencies: Record<string, string>;
	exports: Record<string, unknown>;
};

describe("@questpie/testing package", () => {
	it("publishes only the root, scenario, and package metadata entrypoints", () => {
		expect(Object.keys(manifest.exports).sort()).toEqual([
			".",
			"./package.json",
			"./scenario",
		]);
		expect(Object.keys(manifest.publishConfig.exports).sort()).toEqual([
			".",
			"./package.json",
			"./scenario",
		]);
	});

	it("builds runtime and declaration files for both code entrypoints", () => {
		for (const file of [
			"index.mjs",
			"index.d.mts",
			"scenario.mjs",
			"scenario.d.mts",
		]) {
			expect(existsSync(join(packageRoot, "dist", file))).toBe(true);
		}
	});

	it("exports disposable PostgreSQL only from the scenario entrypoint", () => {
		expect(createDisposablePostgres).toBeFunction();
		expect(sweepStalePostgresDatabases).toBeFunction();
	});

	it("keeps the testing package out of the production questpie surface", () => {
		expect(coreManifest.exports["./testing"]).toBeUndefined();
		expect(coreManifest.dependencies["@questpie/testing"]).toBeUndefined();
		expect(manifest.dependencies["@electric-sql/pglite"]).toBeDefined();
		expect(manifest.dependencies.pg).toBeDefined();
		expect(manifest.peerDependencies.questpie).toBe("3.21.1");
	});
});
