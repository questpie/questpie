/**
 * QUE-253: Guardrail test — CRUD generators must NOT import search/realtime/workflow
 *
 * Phase 3 extracted all side effects into core module global hooks.
 * This test ensures the CRUD layer stays clean and never re-introduces
 * direct imports of search, realtime, or workflow modules.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CRUD_DIR = resolve(
	import.meta.dir,
	"../../src/server/collection/crud",
);
const GLOBAL_CRUD_DIR = resolve(
	import.meta.dir,
	"../../src/server/global/crud",
);

function readFile(dir: string, file: string): string {
	return readFileSync(resolve(dir, file), "utf8");
}

describe("CRUD no-side-effects guardrail (QUE-253)", () => {
	it("collection crud-generator does not import search integration", () => {
		const code = readFile(CRUD_DIR, "crud-generator.ts");
		expect(code).not.toContain("integrations/search");
		expect(code).not.toContain("indexToSearch");
		expect(code).not.toContain("removeFromSearch");
	});

	it("collection crud-generator does not import realtime utilities", () => {
		const code = readFile(CRUD_DIR, "crud-generator.ts");
		expect(code).not.toContain("appendRealtimeChange");
		expect(code).not.toContain("notifyRealtimeChange");
	});

	it("collection crud-generator does not hardcode scheduled-transition", () => {
		const code = readFile(CRUD_DIR, "crud-generator.ts");
		expect(code).not.toContain('"scheduled-transition"');
		expect(code).not.toContain("'scheduled-transition'");
	});

	it("global crud-generator does not import realtime utilities", () => {
		const code = readFile(GLOBAL_CRUD_DIR, "global-crud-generator.ts");
		expect(code).not.toContain("appendRealtimeChange");
		expect(code).not.toContain("notifyRealtimeChange");
	});

	it("global crud-generator does not hardcode scheduled-transition", () => {
		const code = readFile(GLOBAL_CRUD_DIR, "global-crud-generator.ts");
		expect(code).not.toContain('"scheduled-transition"');
		expect(code).not.toContain("'scheduled-transition'");
		expect(code).not.toContain("scheduleCollectionTransition");
	});
});
