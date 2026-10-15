import { describe, expect, test } from "bun:test";

import { sql } from "questpie/drizzle";
import { z } from "zod";

import { createFetchHandler } from "../../../questpie/src/server/adapters/http.js";
import { createWorkflowClient } from "../../src/server/client.js";
import { computeMatchHash } from "../../src/server/engine/match-hash.js";
import { wfExecuteJob } from "../../src/server/modules/workflows/jobs/wf-execute.js";
import sendWorkflowEvent from "../../src/server/modules/workflows/routes/send-workflow-event.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";
import {
	createPostgresWorkflowHarness,
	databaseUrl,
	systemContext,
} from "./postgres-helpers.js";

describe.skipIf(!databaseUrl)("indexed event matching on PostgreSQL", () => {
	for (const surface of ["client", "route", "workflow"] as const) {
		test(`${surface}: containment uses the match index beyond 1,000 unrelated waiters`, async () => {
			const match = { order: { id: "wanted", region: "eu" }, extra: true };
			const sender: WorkflowDefinition = {
				name: "sender",
				schema: z.object({}),
				handler: async ({ step }) => {
					await step.sendEvent("send", {
						event: "ready",
						data: "delivered",
						match,
					});
				},
			};
			const harness = await createPostgresWorkflowHarness(
				{ sender },
				{
					routes: { sendWorkflowEvent },
					config: { access: () => true },
				},
			);
			const client = createWorkflowClient(
				{ sender },
				{
					instances: harness.collections.wf_instance,
					steps: harness.collections.wf_step,
					events: harness.collections.wf_event,
					publishExecute: harness.queue["questpie-wf-execute"],
					publishResume: harness.queue["questpie-wf-resume"],
				},
			);
			try {
				await harness.db.execute(sql`INSERT INTO wf_step
					(id, "instanceId", name, type, status, "eventName", "matchCriteria", "matchHash")
					SELECT 'noise-' || n, 'noise-' || n, 'wait', 'waitForEvent', 'waiting', 'ready',
					jsonb_build_object('order', jsonb_build_object('id', 'other-' || n)), 'unrelated-' || n
					FROM generate_series(1, 5000) n`);
				const criteria = [
					null,
					{},
					{ order: { id: "wanted" } },
					{ order: {} },
					match,
				];
				for (const [index, criterion] of criteria.entries()) {
					await harness.collections.wf_step.create(
						{
							id: `target-${index}`,
							instanceId: `target-${index}`,
							name: "wait",
							type: "waitForEvent",
							status: "waiting",
							eventName: "ready",
							matchCriteria: criterion,
							matchHash: computeMatchHash(criterion),
						},
						systemContext,
					);
				}
				await harness.collections.wf_step.create(
					{
						id: "legacy",
						instanceId: "legacy",
						name: "wait",
						type: "waitForEvent",
						status: "waiting",
						eventName: "ready",
						matchCriteria: { extra: true },
					},
					systemContext,
				);
				// Hash collisions must remain candidates, never false deliveries.
				await harness.collections.wf_step.create(
					{
						instanceId: "collision",
						name: "wait",
						type: "waitForEvent",
						status: "waiting",
						eventName: "ready",
						matchCriteria: { extra: false },
						matchHash: computeMatchHash(match),
					},
					systemContext,
				);
				await harness.db.execute(sql`ANALYZE wf_step`);
				const queries: Array<{ query: string; params: unknown[] }> = [];
				const session = (
					harness.db as unknown as {
						session: {
							logger: { logQuery(query: string, params: unknown[]): void };
						};
					}
				).session;
				session.logger = {
					logQuery: (query, params) => {
						queries.push({ query, params });
					},
				};
				const delivered: string[] = [];
				const publish = harness.queue["questpie-wf-resume"].publish;
				harness.queue["questpie-wf-resume"].publish = async (
					payload,
					options,
				) => {
					delivered.push(String(payload.instanceId));
					return publish(payload, options);
				};
				if (surface === "client") {
					await client.sendEvent("ready", "delivered", match);
				} else if (surface === "route") {
					harness.runtimeApp.queue["questpie-wf-resume"] =
						harness.queue["questpie-wf-resume"];
					const handler = createFetchHandler(harness.runtimeApp, {
						basePath: "/api",
					});
					const response = await handler(
						new Request("http://localhost/api/send-workflow-event", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								event: "ready",
								data: "delivered",
								match,
							}),
						}),
					);
					expect(response.status).toBe(200);
					expect(await response.json()).toEqual({ matchedCount: 6 });
				} else {
					const instance = await client.trigger("sender", {});
					await wfExecuteJob.handler({
						...harness,
						payload: {
							instanceId: instance.instanceId,
							workflowName: "sender",
						},
					});
				}
				expect(delivered.sort()).toEqual([
					"legacy",
					...criteria.map((_, i) => `target-${i}`),
				]);
				const lookup = queries.find(
					({ query }) =>
						query.startsWith("select") &&
						query.includes('"wf_step"') &&
						query.includes('"matchHash" in'),
				);
				expect(lookup).toBeDefined();
				// Explain the exact SQL and bound values emitted by collection CRUD.
				const { Pool } = await import("pg");
				const pool = new Pool({
					connectionString: harness.runtimeApp.config.db.url,
				});
				try {
					const plan = await pool.query(
						`EXPLAIN (ANALYZE, FORMAT JSON) ${lookup!.query}`,
						lookup!.params,
					);
					const text = JSON.stringify(plan.rows);
					expect(text).toContain("idx_wfs_match_hash");
					expect(text).not.toContain('"Node Type":"Seq Scan"');
				} finally {
					await pool.end();
				}
			} finally {
				await harness.cleanup();
			}
		}, 30_000);
	}
	test("all matching pages are delivered; wide/deep events retain containment", async () => {
		const harness = await createPostgresWorkflowHarness({});
		let deliveries = 0;
		const client = createWorkflowClient(
			{},
			{
				instances: harness.collections.wf_instance,
				steps: harness.collections.wf_step,
				events: harness.collections.wf_event,
				publishExecute: harness.queue["questpie-wf-execute"],
				publishResume: {
					publish: async () => {
						deliveries++;
					},
				},
			},
		);
		try {
			await harness.db.execute(sql`INSERT INTO wf_step
				(id, "instanceId", name, type, status, "eventName", "matchCriteria", "matchHash")
				SELECT 'wildcard-' || n, 'wildcard-' || n, 'wait', 'waitForEvent', 'waiting', 'ready',
				NULL, '*' FROM generate_series(1, 1101) n`);
			await client.sendEvent("ready", null);
			expect(deliveries).toBe(1101);
			await harness.collections.wf_step.create(
				{
					instanceId: "partial",
					name: "wait",
					type: "waitForEvent",
					status: "waiting",
					eventName: "ready",
					matchCriteria: { key0: true },
					matchHash: computeMatchHash({ key0: true }),
				},
				systemContext,
			);
			const wide = Object.fromEntries(
				Array.from({ length: 12 }, (_, i) => [`key${i}`, true]),
			);
			deliveries = 0;
			await client.sendEvent("ready", null, wide);
			expect(deliveries).toBe(1102);
			let deep: Record<string, unknown> = { id: 1 };
			for (let i = 0; i < 20; i++) deep = { nested: deep };
			await harness.collections.wf_step.create(
				{
					instanceId: "deep",
					name: "wait",
					type: "waitForEvent",
					status: "waiting",
					eventName: "deep",
					matchCriteria: deep,
					matchHash: computeMatchHash(deep),
				},
				systemContext,
			);
			deliveries = 0;
			await client.sendEvent("deep", null, deep);
			expect(deliveries).toBe(1);
		} finally {
			await harness.cleanup();
		}
	}, 30_000);
});
