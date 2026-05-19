import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runLinks } from "../collections/run-links";
import modules from "../modules";

const runLinkMigration = readFileSync(
	new URL(
		"../migrations/20260519T135407_add_run_links_and_ai_module.ts",
		import.meta.url,
	),
	"utf8",
);

function relationTarget(field: unknown): unknown {
	return (field as { _state?: { to?: unknown } })["_state"]?.to;
}

describe("Autopilot AI run links", () => {
	it("loads the AI module without normal navigation exposure", () => {
		const aiModule = modules.find((mod) => mod.name === "questpie-ai");

		expect(aiModule).toBeTruthy();
		expect(aiModule?.config?.admin?.sidebar?.items).toEqual([]);
		expect(Object.keys(aiModule?.collections ?? {}).sort()).toEqual([
			"ai_run_events",
			"ai_runs",
			"ai_worker_leases",
			"ai_workers",
		]);

		for (const collection of Object.values(aiModule?.collections ?? {})) {
			expect(collection.state.admin?.hidden).toBe(true);
			expect(collection.state.admin?.audit).toBe(false);
		}
	});

	it("defines the hidden app-owned run link bridge", () => {
		const fields = runLinks.state.fieldDefinitions;

		expect(runLinks.state.admin?.hidden).toBe(true);
		expect(runLinks.state.admin?.audit).toBe(false);
		expect(relationTarget(fields.aiRun)).toBe("ai_runs");
		expect(relationTarget(fields.resumedFromRun)).toBe("run_links");

		for (const field of [
			"legacyRunId",
			"task",
			"project",
			"workflowConfig",
			"workflowStep",
			"workflowInstanceId",
			"schedule",
			"scheduleExecution",
			"chatSession",
			"chatMessage",
			"initiatedBy",
			"provider",
			"model",
			"capability",
			"runtime",
			"status",
			"instructions",
			"summary",
			"error",
			"tokensInput",
			"tokensOutput",
			"cost",
			"startedAt",
			"endedAt",
			"runtimeSessionRef",
			"resumable",
			"metadata",
		]) {
			expect(fields[field], field).toBeDefined();
		}
	});

	it("keeps run_links ids insertable for legacy run id preservation", () => {
		expect(runLinkMigration).toContain('CREATE TABLE "run_links"');
		expect(runLinkMigration).toContain(
			'"id" text PRIMARY KEY DEFAULT gen_random_uuid()',
		);
		expect(runLinkMigration).toContain('"legacyRunId" varchar(255)');
	});
});
