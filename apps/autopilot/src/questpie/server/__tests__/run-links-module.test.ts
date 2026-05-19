import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import { activity } from "../collections/activity";
import { chatMessages } from "../collections/chat-messages";
import { knowledge } from "../collections/knowledge";
import { runLinks } from "../collections/run-links";
import { taskRelations } from "../collections/task-relations";
import backfillLegacyRunsMigration from "../migrations/20260519T142100_backfill_legacy_runs_into_run_links";
import modules from "../modules";

const runLinkMigration = readFileSync(
	new URL(
		"../migrations/20260519T135407_add_run_links_and_ai_module.ts",
		import.meta.url,
	),
	"utf8",
);

const backfillLegacyRunsMigrationSource = readFileSync(
	new URL(
		"../migrations/20260519T142100_backfill_legacy_runs_into_run_links.ts",
		import.meta.url,
	),
	"utf8",
);

const runProjectSource = readFileSync(
	new URL("../lib/run-project.ts", import.meta.url),
	"utf8",
);

const knowledgeResourceSource = readFileSync(
	new URL("../services/knowledge-resource.ts", import.meta.url),
	"utf8",
);

const runStreamSource = readFileSync(
	new URL("../routes/run-stream.ts", import.meta.url),
	"utf8",
);

function relationTarget(field: unknown): unknown {
	return (field as { _state?: { to?: unknown } })["_state"]?.to;
}

function resultRows<T>(result: unknown): T[] {
	if (Array.isArray(result)) {
		return result as T[];
	}

	const rows = (result as { rows?: T[] })?.rows;
	return Array.isArray(rows) ? rows : [];
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

	it("retargets product run references to app-owned run links", () => {
		expect(relationTarget(chatMessages.state.fieldDefinitions.run)).toBe(
			"run_links",
		);
		expect(relationTarget(knowledge.state.fieldDefinitions.run)).toBe(
			"run_links",
		);
		expect(relationTarget(activity.state.fieldDefinitions.run)).toBe(
			"run_links",
		);
		expect(relationTarget(taskRelations.state.fieldDefinitions.originRun)).toBe(
			"run_links",
		);
	});

	it("resolves product run reads through run_links", () => {
		expect(runProjectSource).toContain("collections.run_links.findOne");
		expect(knowledgeResourceSource).toContain("collections.run_links.findOne");
		expect(runStreamSource).toContain("collections.run_links.findOne");
		expect(runStreamSource).toContain('resource: "run_links"');
	});

	it("keeps run_links ids insertable for legacy run id preservation", () => {
		expect(runLinkMigration).toContain('CREATE TABLE "run_links"');
		expect(runLinkMigration).toContain(
			'"id" text PRIMARY KEY DEFAULT gen_random_uuid()',
		);
		expect(runLinkMigration).toContain('"legacyRunId" varchar(255)');
	});

	it("blocks legacy run backfill while active runs exist", async () => {
		const db = {
			execute: async () => ({
				rows: [{ id: "run-active", status: "running" }],
			}),
			transaction: async <T>(callback: (tx: unknown) => Promise<T>) =>
				callback(db),
		};

		await expect(backfillLegacyRunsMigration.up({ db })).rejects.toThrow(
			/active legacy runs exist/,
		);
	});

	it("backfills legacy runs with preserved ids and guarded duplicates", () => {
		expect(backfillLegacyRunsMigrationSource).toContain(
			"WHERE \"status\" IN ('pending', 'claimed', 'running')",
		);
		expect(backfillLegacyRunsMigrationSource).toContain(
			'INSERT INTO "run_links"',
		);
		expect(backfillLegacyRunsMigrationSource).toContain('"legacyRunId"');
		expect(backfillLegacyRunsMigrationSource).toContain('"aiRun"');
		expect(backfillLegacyRunsMigrationSource).toContain(
			'SELECT\n\t\t\t\tr."id",\n\t\t\t\tr."id",\n\t\t\t\tNULL',
		);
		expect(backfillLegacyRunsMigrationSource).toContain('r."resumedFromRun"');
		expect(backfillLegacyRunsMigrationSource).toContain('r."created_at"');
		expect(backfillLegacyRunsMigrationSource).toContain('r."updated_at"');
		expect(backfillLegacyRunsMigrationSource).toContain(
			"ON CONFLICT DO NOTHING",
		);
	});

	it("nests legacy worker targeting under metadata.legacy", () => {
		const insertColumns = backfillLegacyRunsMigrationSource.slice(
			backfillLegacyRunsMigrationSource.indexOf('INSERT INTO "run_links"'),
			backfillLegacyRunsMigrationSource.indexOf(")\n\t\t\tSELECT"),
		);

		expect(backfillLegacyRunsMigrationSource).toContain("jsonb_set");
		expect(backfillLegacyRunsMigrationSource).toContain("'{legacy}'");
		expect(backfillLegacyRunsMigrationSource).toContain("'preferredWorker'");
		expect(backfillLegacyRunsMigrationSource).toContain('r."preferredWorker"');
		expect(backfillLegacyRunsMigrationSource).toContain("'targeting'");
		expect(backfillLegacyRunsMigrationSource).toContain('r."targeting"');
		expect(insertColumns).not.toContain('"preferredWorker"');
		expect(insertColumns).not.toContain('"targeting"');
	});

	it("runs the legacy backfill against postgres-compatible SQL", async () => {
		const client = await PGlite.create();
		const db = drizzle(client);

		try {
			await db.execute(sql`
				CREATE TABLE "runs" (
					"id" varchar(255) PRIMARY KEY,
					"task" varchar(255),
					"project" varchar(255),
					"provider" varchar(255),
					"model" varchar(255),
					"capability" varchar(255),
					"initiatedBy" varchar(255),
					"runtime" varchar(255),
					"resumedFromRun" varchar(255),
					"status" varchar(255),
					"instructions" text,
					"summary" text,
					"error" text,
					"tokensInput" integer,
					"tokensOutput" integer,
					"startedAt" timestamp with time zone,
					"endedAt" timestamp with time zone,
					"runtimeSessionRef" varchar(255),
					"resumable" boolean,
					"metadata" jsonb,
					"preferredWorker" varchar(255),
					"targeting" jsonb,
					"created_at" timestamp with time zone NOT NULL,
					"updated_at" timestamp with time zone NOT NULL
				)
			`);
			await db.execute(sql`
				CREATE TABLE "run_links" (
					"id" text PRIMARY KEY,
					"legacyRunId" varchar(255),
					"aiRun" text,
					"task" varchar(255),
					"project" varchar(255),
					"provider" varchar(255),
					"model" varchar(255),
					"capability" varchar(255),
					"initiatedBy" varchar(255),
					"runtime" varchar(255),
					"resumedFromRun" text,
					"status" varchar(255),
					"instructions" text,
					"summary" text,
					"error" text,
					"tokensInput" integer,
					"tokensOutput" integer,
					"cost" numeric,
					"startedAt" timestamp with time zone,
					"endedAt" timestamp with time zone,
					"runtimeSessionRef" varchar(255),
					"resumable" boolean,
					"metadata" jsonb,
					"created_at" timestamp with time zone NOT NULL,
					"updated_at" timestamp with time zone NOT NULL
				)
			`);
			await db.execute(sql`
				INSERT INTO "runs" (
					"id",
					"task",
					"project",
					"provider",
					"model",
					"capability",
					"initiatedBy",
					"runtime",
					"resumedFromRun",
					"status",
					"instructions",
					"summary",
					"error",
					"tokensInput",
					"tokensOutput",
					"startedAt",
					"endedAt",
					"runtimeSessionRef",
					"resumable",
					"metadata",
					"preferredWorker",
					"targeting",
					"created_at",
					"updated_at"
				)
				VALUES
					(
						'run-1',
						'task-1',
						'project-1',
						'claude',
						'claude-sonnet',
						'code',
						'user-1',
						'codex',
						NULL,
						'completed',
						'Do it',
						'Done',
						NULL,
						10,
						20,
						'2026-05-19T10:00:00Z',
						'2026-05-19T10:01:00Z',
						'session-1',
						true,
						'{"keep": true}'::jsonb,
						'worker-1',
						'{"labels": ["fast"]}'::jsonb,
						'2026-05-19T09:59:00Z',
						'2026-05-19T10:01:00Z'
					),
					(
						'run-2',
						NULL,
						NULL,
						NULL,
						NULL,
						NULL,
						NULL,
						NULL,
						'run-1',
						'failed',
						NULL,
						NULL,
						'boom',
						NULL,
						NULL,
						NULL,
						NULL,
						NULL,
						false,
						NULL,
						NULL,
						NULL,
						'2026-05-19T10:02:00Z',
						'2026-05-19T10:03:00Z'
					)
			`);

			await backfillLegacyRunsMigration.up({ db });
			await backfillLegacyRunsMigration.up({ db });

			const rows = resultRows<{
				id: string;
				legacyRunId: string;
				aiRun: string | null;
				task: string | null;
				resumedFromRun: string | null;
				status: string;
				error: string | null;
				cost: string | null;
				metadata: { keep?: boolean; legacy?: Record<string, unknown> } | null;
			}>(
				await db.execute(sql`
					SELECT
						"id",
						"legacyRunId",
						"aiRun",
						"task",
						"resumedFromRun",
						"status",
						"error",
						"cost",
						"metadata"
					FROM "run_links"
					ORDER BY "id"
				`),
			);

			expect(rows).toHaveLength(2);
			expect(rows[0]).toMatchObject({
				id: "run-1",
				legacyRunId: "run-1",
				aiRun: null,
				task: "task-1",
				status: "completed",
				cost: null,
			});
			expect(rows[0]?.metadata).toEqual({
				keep: true,
				legacy: {
					preferredWorker: "worker-1",
					targeting: { labels: ["fast"] },
				},
			});
			expect(rows[1]).toMatchObject({
				id: "run-2",
				legacyRunId: "run-2",
				aiRun: null,
				resumedFromRun: "run-1",
				status: "failed",
				error: "boom",
				cost: null,
				metadata: null,
			});
		} finally {
			await client.close();
		}
	});
});
