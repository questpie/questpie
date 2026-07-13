import { describe, expect, it } from "bun:test";

import { evaluateRouteAccess } from "questpie";

import triggerWorkflow from "../../src/server/modules/workflows/routes/trigger-workflow.js";

describe("workflow route access", () => {
	it("defaults to admin session access", async () => {
		await expect(
			evaluateRouteAccess(triggerWorkflow.access, {
				session: { user: { role: "admin" } },
				app: { state: {} },
			}),
		).resolves.toBe(true);

		await expect(
			evaluateRouteAccess(triggerWorkflow.access, {
				session: { user: { role: "user" } },
				app: { state: {} },
			}),
		).resolves.toBe(false);
	});

	it("allows config/workflows.ts overrides per operation", async () => {
		await expect(
			evaluateRouteAccess(triggerWorkflow.access, {
				session: null,
				app: {
					state: {
						config: {
							workflows: {
								access: {
									default: false,
									trigger: true,
								},
							},
						},
					},
				},
			}),
		).resolves.toBe(true);
	});

	it("prefers runtimeConfig workflow settings over legacy codegen config", async () => {
		await expect(
			evaluateRouteAccess(triggerWorkflow.access, {
				session: null,
				app: {
					state: {
						workflowsRuntime: { access: true },
						config: { workflows: { access: false } },
					},
				},
			}),
		).resolves.toBe(true);
	});
});
