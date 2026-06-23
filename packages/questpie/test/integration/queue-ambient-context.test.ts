import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { collection, job } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * B1 backward-compat: with the queue now wrapping each job handler in
 * `runWithContext`, a job → CRUD → hook → nested-CRUD chain must still run
 * cleanly. `runWithContext` only inherits `_hookDepth` from an existing parent
 * scope; a top-level job has none, so the wrap adds no depth and cannot
 * double-count toward `MAX_HOOK_RECURSION`. This test exercises that chain end
 * to end through the real queue + PGlite app.
 */
const trace: {
	jobRan: boolean;
	jobAccessMode?: string;
	noteHookOp?: string;
	nestedAuditCreated: boolean;
} = { jobRan: false, nestedAuditCreated: false };

const audits = collection("audits").fields(({ f }) => ({
	message: f.text().required(),
}));

const notes = collection("notes")
	.fields(({ f }) => ({
		body: f.text().required(),
	}))
	.hooks({
		afterChange: async ({ operation, collections }) => {
			trace.noteHookOp = operation;
			if (operation !== "create") return;
			// Nested CRUD inside a hook, itself inside the job: this is the
			// job → CRUD → hook → CRUD chain the recursion guard governs.
			await collections.audits.create({
				id: crypto.randomUUID(),
				message: "note created",
			});
			trace.nestedAuditCreated = true;
		},
	});

const seedNoteJob = job({
	name: "seed-note",
	schema: z.object({ body: z.string() }),
	handler: async ({ collections, payload }: any) => {
		const { tryGetContext } = await import(
			"../../src/server/config/context.js"
		);
		trace.jobRan = true;
		trace.jobAccessMode = tryGetContext()?.accessMode;
		// ctx-less create from inside the job — resolves session/locale/accessMode
		// from the ambient ALS the queue now establishes (B1).
		await collections.notes.create({
			id: crypto.randomUUID(),
			body: payload.body,
		});
	},
});

describe("queue job ambient context — backward-compat (B1)", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		trace.jobRan = false;
		trace.jobAccessMode = undefined;
		trace.noteHookOp = undefined;
		trace.nestedAuditCreated = false;

		setup = await buildMockApp({
			collections: { notes, audits },
			jobs: { seedNote: seedNoteJob },
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("runs job → ctx-less CRUD → nested-hook CRUD without tripping MAX_HOOK_RECURSION", async () => {
		await (setup.app as any).queue.seedNote.publish({ body: "hello" });

		// Must not throw: the whole chain runs inside the single ambient context
		// the queue establishes. A double-counted hook depth would surface here.
		await (setup.app as any).queue.runOnce();

		expect(trace.jobRan).toBe(true);
		// Ambient context was established for the job (system scope).
		expect(trace.jobAccessMode).toBe("system");
		// The job's CRUD fired its afterChange, whose nested CRUD also completed.
		expect(trace.noteHookOp).toBe("create");
		expect(trace.nestedAuditCreated).toBe(true);

		// Both rows are actually persisted.
		const ctx = createTestContext({ accessMode: "system" });
		const noteCount = await setup.app.collections.notes.count({}, ctx);
		const auditCount = await setup.app.collections.audits.count({}, ctx);
		expect(noteCount).toBe(1);
		expect(auditCount).toBe(1);
	});
});
