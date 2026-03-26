/**
 * Guardrail test: Global CRUD must use executeHooksWithGlobal / executeTransitionHooksWithGlobal
 * for beforeChange/afterChange/beforeTransition/afterTransition hooks.
 *
 * This ensures global global hooks (cross-cutting concerns like audit, search indexing)
 * fire correctly alongside entity-specific hooks.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GLOBAL_CRUD_PATH = join(
	import.meta.dir,
	"../../src/server/global/crud/global-crud-generator.ts",
);

describe("Global CRUD hook execution guardrail", () => {
	const source = readFileSync(GLOBAL_CRUD_PATH, "utf-8");

	it("imports executeGlobalGlobalHooks from shared global-hooks", () => {
		expect(source).toContain("executeGlobalGlobalHooks");
	});

	it("imports executeGlobalGlobalTransitionHooks from shared global-hooks", () => {
		expect(source).toContain("executeGlobalGlobalTransitionHooks");
	});

	it("calls executeHooksWithGlobal for change hooks", () => {
		// Must use the WithGlobal variants, not plain executeHooks for change hooks
		const withGlobalCalls = (
			source.match(/executeHooksWithGlobal/g) || []
		).length;
		expect(withGlobalCalls).toBeGreaterThanOrEqual(4); // 2x beforeChange + 2x afterChange
	});

	it("calls executeTransitionHooksWithGlobal for transition hooks", () => {
		const withGlobalCalls = (
			source.match(/executeTransitionHooksWithGlobal/g) || []
		).length;
		expect(withGlobalCalls).toBeGreaterThanOrEqual(2); // beforeTransition + afterTransition
	});

	it("injectGlobalHooks is a no-op (globals handled by CRUD generator)", () => {
		const questpiePath = join(
			import.meta.dir,
			"../../src/server/config/questpie.ts",
		);
		const questpieSource = readFileSync(questpiePath, "utf-8");
		// The injectGlobalHooks method should be a no-op
		expect(questpieSource).toContain(
			"private injectGlobalHooks(): void {",
		);
		expect(questpieSource).toContain("No-op");
	});
});
