import { describe, expect, test } from "bun:test";

import { createFetchHandler } from "../../../questpie/src/server/adapters/http.js";
import type { WorkflowsConfigInput } from "../../src/server/config.js";
import cancelWorkflowInstance from "../../src/server/modules/workflows/routes/cancel-workflow-instance.js";
import getWorkflowInstance from "../../src/server/modules/workflows/routes/get-workflow-instance.js";
import {
	createPostgresWorkflowHarness,
	databaseUrl,
	systemContext,
} from "./postgres-helpers.js";

describe.skipIf(!databaseUrl)(
	"workflow route authorization on PostgreSQL",
	() => {
		const scenarios: Array<{ label: string; config?: WorkflowsConfigInput }> = [
			{ label: "default" },
			{
				label: "app function",
				config: {
					access: async ({ session }) => session?.user?.id === "allowed",
				},
			},
			{
				label: "per-operation",
				config: {
					access: {
						read: async ({ session }) => session?.user?.id === "allowed",
					},
				},
			},
		];
		for (const scenario of scenarios) {
			test(`${scenario.label}: authorization guards database reads and mutations`, async () => {
				const harness = await createPostgresWorkflowHarness(
					{},
					{
						routes: { getWorkflowInstance, cancelWorkflowInstance },
						config: scenario.config,
					},
				);
				try {
					const instance = await harness.collections.wf_instance.create(
						{
							name: "private",
							status: "pending",
							input: { confidential: true },
						},
						systemContext,
					);
					const handler = createFetchHandler(harness.runtimeApp, {
						basePath: "/api",
						getSession: async (request) => {
							const id = request.headers.get("x-test-user");
							return id
								? {
										user: { id, role: id === "admin" ? "admin" : "member" },
										session: { id: "test-session", userId: id },
									}
								: null;
						},
					});
					const request = (route: string, user: string) =>
						handler(
							new Request(`http://localhost/api/${route}`, {
								method: "POST",
								headers: {
									"content-type": "application/json",
									"x-test-user": user,
								},
								body: JSON.stringify({ id: instance.id }),
							}),
						);
					for (const user of ["admin", "denied", ""]) {
						const read = await request("get-workflow-instance", user);
						expect(read.status).toBe(403);
						expect(await read.text()).not.toContain("confidential");
						expect(
							(await request("cancel-workflow-instance", user)).status,
						).toBe(403);
					}
					expect(
						(
							await harness.collections.wf_instance.findOne(
								{ where: { id: instance.id } },
								systemContext,
							)
						).status,
					).toBe("pending");
					const allowedRead = await request("get-workflow-instance", "allowed");
					expect(allowedRead.status).toBe(scenario.config ? 200 : 403);
					if (scenario.config)
						expect((await allowedRead.json()).instance.input).toEqual({
							confidential: true,
						});
					const cancel = await request("cancel-workflow-instance", "allowed");
					const canCancel = scenario.label === "app function";
					expect(cancel.status).toBe(canCancel ? 200 : 403);
					expect(
						(
							await harness.collections.wf_instance.findOne(
								{ where: { id: instance.id } },
								systemContext,
							)
						).status,
					).toBe(canCancel ? "cancelled" : "pending");
				} finally {
					await harness.cleanup();
				}
			}, 15_000);
		}
	},
);
