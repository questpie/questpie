import { describe, expect, it } from "bun:test";

import { adminConfigFunctions } from "#questpie/admin/server/modules/admin/routes/admin-config";
import { actionFunctions } from "#questpie/admin/server/modules/admin/routes/execute-action";
import { localeFunctions } from "#questpie/admin/server/modules/admin/routes/locales";
import { previewFunctions } from "#questpie/admin/server/modules/admin/routes/preview";
import { reactiveFunctions } from "#questpie/admin/server/modules/admin/routes/reactive";
import { widgetDataFunctions } from "#questpie/admin/server/modules/admin/routes/widget-data";

const guardedRoutes = {
	getAdminConfig: adminConfigFunctions.getAdminConfig,
	mintPreviewToken: previewFunctions.mintPreviewToken,
	getPreviewUrl: previewFunctions.getPreviewUrl,
	fetchWidgetData: widgetDataFunctions.fetchWidgetData,
	batchReactive: reactiveFunctions.batchReactive,
	fieldOptions: reactiveFunctions.fieldOptions,
	executeAction: actionFunctions.executeAction,
	getActionsConfig: actionFunctions.getActionsConfig,
};

const publicBootstrapRoutes = {
	getPublicAdminConfig: adminConfigFunctions.getPublicAdminConfig,
	getContentLocales: localeFunctions.getContentLocales,
};

async function evaluateAccess(route: unknown, ctx: unknown): Promise<unknown> {
	const access = (route as any).access;
	return typeof access === "function" ? access(ctx) : access;
}

describe("admin RPC auth guards", () => {
	it("requires an admin session for admin RPC routes that expose server callbacks or config", async () => {
		for (const route of Object.values(guardedRoutes)) {
			expect(typeof (route as any).access).toBe("function");
			expect(await evaluateAccess(route, { session: null })).toBe(false);
			expect(
				await evaluateAccess(route, {
					session: { user: { id: "u1", role: "user" } },
				}),
			).toBe(false);
			expect(
				await evaluateAccess(route, {
					session: { user: { id: "u1", role: "admin" } },
				}),
			).toBe(true);
		}
	});

	it("allows unauthenticated access only for public admin bootstrap routes", async () => {
		for (const route of Object.values(publicBootstrapRoutes)) {
			expect(await evaluateAccess(route, { session: null })).toBe(true);
			expect(
				await evaluateAccess(route, {
					session: { user: { id: "u1", role: "user" } },
				}),
			).toBe(true);
		}
	});
});
