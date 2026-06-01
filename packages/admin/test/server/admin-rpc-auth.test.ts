import { describe, expect, it } from "bun:test";

import { adminConfigFunctions } from "#questpie/admin/server/modules/admin/routes/admin-config";
import { actionFunctions } from "#questpie/admin/server/modules/admin/routes/execute-action";
import { reactiveFunctions } from "#questpie/admin/server/modules/admin/routes/reactive";
import { widgetDataFunctions } from "#questpie/admin/server/modules/admin/routes/widget-data";

const guardedRoutes = {
	getAdminConfig: adminConfigFunctions.getAdminConfig,
	fetchWidgetData: widgetDataFunctions.fetchWidgetData,
	batchReactive: reactiveFunctions.batchReactive,
	fieldOptions: reactiveFunctions.fieldOptions,
	executeAction: actionFunctions.executeAction,
	getActionsConfig: actionFunctions.getActionsConfig,
};

describe("admin RPC auth guards", () => {
	it("requires an admin session for admin RPC routes that expose server callbacks or config", async () => {
		for (const route of Object.values(guardedRoutes)) {
			expect(typeof (route as any).access).toBe("function");
			expect(await (route as any).access({ session: null })).toBe(false);
			expect(
				await (route as any).access({
					session: { user: { id: "u1", role: "user" } },
				}),
			).toBe(false);
			expect(
				await (route as any).access({
					session: { user: { id: "u1", role: "admin" } },
				}),
			).toBe(true);
		}
	});
});
