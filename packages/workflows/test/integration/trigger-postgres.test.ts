import { describe, expect, test } from "bun:test";

import { withTransaction } from "questpie";
import { sql } from "questpie/drizzle";
import { z } from "zod";

import { createWorkflowClient } from "../../src/server/client.js";
import triggerWorkflow from "../../src/server/modules/workflows/routes/trigger-workflow.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";
import {
	createPostgresWorkflowHarness,
	databaseUrl,
	systemContext,
} from "./postgres-helpers.js";

describe.skipIf(!databaseUrl)(
	"idempotent workflow trigger on PostgreSQL",
	() => {
		for (const surface of ["client", "route"] as const) {
			for (const ambient of [false, true]) {
				test(`${surface} (ambient=${ambient}): 12 simultaneous triggers return one instance`, async () => {
					const definition: WorkflowDefinition = {
						name: "duplicate",
						schema: z.object({}),
						handler: async () => {},
					};
					const harness = await createPostgresWorkflowHarness({
						duplicate: definition,
					});
					let publications = 0;
					const publish = harness.queue["questpie-wf-execute"].publish;
					harness.queue["questpie-wf-execute"].publish = (payload, options) => {
						publications++;
						return publish(payload, options);
					};
					const client = createWorkflowClient(
						{ duplicate: definition },
						{
							instances: harness.collections.wf_instance,
							steps: harness.collections.wf_step,
							events: harness.collections.wf_event,
							publishExecute: harness.queue["questpie-wf-execute"],
						},
					);
					try {
						let reads = 0;
						let release!: () => void;
						const allRead = new Promise<void>((resolve) => {
							release = resolve;
						});
						const findOne = harness.collections.wf_instance.findOne.bind(
							harness.collections.wf_instance,
						);
						harness.collections.wf_instance.findOne = async (
							...args: Parameters<typeof findOne>
						) => {
							const row = await findOne(...args);
							if (!row && args[0]?.where?.idempotencyKey === "same-key") {
								if (++reads === 12) release();
								await allRead;
							}
							return row;
						};
						await harness.db.execute(
							sql`CREATE TABLE trigger_markers (id integer PRIMARY KEY)`,
						);
						const invoke = () =>
							surface === "client"
								? client.trigger(
										"duplicate",
										{},
										{ idempotencyKey: "same-key" },
									)
								: triggerWorkflow.handler({
										...harness,
										input: {
											name: "duplicate",
											input: {},
											idempotencyKey: "same-key",
										},
									});
						const results = await Promise.allSettled(
							Array.from({ length: 12 }, (_, index) =>
								ambient
									? withTransaction(harness.db, async (tx) => {
											await tx.execute(
												sql`INSERT INTO trigger_markers (id) VALUES (${index})`,
											);
											const result = await invoke();
											await tx.execute(sql`SELECT 1`);
											return result;
										})
									: invoke(),
							),
						);
						expect(reads).toBe(12);
						expect(
							results.filter((result) => result.status === "rejected"),
						).toHaveLength(0);
						const handles = results.flatMap((result) =>
							result.status === "fulfilled" ? [result.value] : [],
						);
						expect(
							new Set(handles.map((handle) => handle.instanceId)).size,
						).toBe(1);
						expect(handles.filter((handle) => !handle.existing)).toHaveLength(
							1,
						);
						expect(publications).toBe(1);
						const rows = await harness.collections.wf_instance.find(
							{ where: { idempotencyKey: "same-key" } },
							systemContext,
						);
						expect(rows.docs).toHaveLength(1);
						if (ambient) {
							const markers = await harness.db.execute(
								sql`SELECT count(*)::integer AS count FROM trigger_markers`,
							);
							expect(markers[0].count).toBe(12);
						}
						await harness.drain();
						expect(
							(await client.getInstance(handles[0].instanceId))?.status,
						).toBe("completed");
					} finally {
						await harness.cleanup();
					}
				}, 20_000);
			}
		}
	},
);
