import pg from "pg";

import { PgBossAdapter } from "../../../questpie/src/server/modules/core/integrated/queue/adapters/pg-boss.js";
import { buildMockApp } from "../../../questpie/test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../../../questpie/test/utils/test-db.js";
import { createDisposablePostgres } from "../../../testing/src/disposable-postgres.js";
import type { QueuePublishOptions } from "../../src/server/client.js";
import { wfEventCollection } from "../../src/server/modules/workflows/collections/wf-event.js";
import { wfInstanceCollection } from "../../src/server/modules/workflows/collections/wf-instance.js";
import { wfLogCollection } from "../../src/server/modules/workflows/collections/wf-log.js";
import { wfStepCollection } from "../../src/server/modules/workflows/collections/wf-step.js";
import { wfExecuteJob } from "../../src/server/modules/workflows/jobs/wf-execute.js";
import { wfResumeJob } from "../../src/server/modules/workflows/jobs/wf-resume.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";

export const databaseUrl = process.env.QUESTPIE_WORKFLOWS_POSTGRES_URL;
export const systemContext = { accessMode: "system" } as const;

export async function createPostgresWorkflowHarness(
	workflows: Record<string, WorkflowDefinition>,
) {
	const database = await createDisposablePostgres({ adminUrl: databaseUrl! });
	const pool = new pg.Pool({ connectionString: database.url });
	await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
	await pool.end();
	const setup = await buildMockApp(
		{
			collections: {
				wf_instance: wfInstanceCollection,
				wf_step: wfStepCollection,
				wf_event: wfEventCollection,
				wf_log: wfLogCollection,
			},
		},
		{ db: { url: database.url } },
	);
	await runTestDbMigrations(setup.app);
	const adapter = new PgBossAdapter({
		connectionString: database.url,
		useApplicationTransaction: false,
	});
	const publisher = (name: string) => ({
		publish: (
			payload: Record<string, unknown>,
			options?: QueuePublishOptions,
		) => adapter.publish(name, payload, options),
	});
	const context = {
		app: { state: { workflows } },
		db: setup.app.db,
		collections: setup.app.collections,
		queue: {
			"questpie-wf-execute": publisher("questpie-wf-execute"),
			"questpie-wf-resume": publisher("questpie-wf-resume"),
		},
	};
	const handlers = {
		"questpie-wf-execute": async ({ data }: { data: unknown }) =>
			wfExecuteJob.handler({
				...context,
				payload: wfExecuteJob.schema.parse(data),
			}),
		"questpie-wf-resume": async ({ data }: { data: unknown }) =>
			wfResumeJob.handler({
				...context,
				payload: wfResumeJob.schema.parse(data),
			}),
	};
	await adapter.start();
	await adapter.ensureQueue("questpie-wf-execute");
	await adapter.ensureQueue("questpie-wf-resume");
	return {
		...context,
		adapter,
		async drain() {
			return adapter.runOnce(handlers, { batchSize: 20 });
		},
		async cleanup() {
			try {
				await adapter.stop();
			} finally {
				try {
					await setup.cleanup();
				} finally {
					await database.dispose();
				}
			}
		},
	};
}

export async function waitFor(
	predicate: () => Promise<boolean>,
	timeout = 5_000,
) {
	const deadline = Date.now() + timeout;
	while (!(await predicate())) {
		if (Date.now() >= deadline) throw new Error("Workflow condition timed out");
		await Bun.sleep(25);
	}
}
