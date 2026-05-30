import { describe, expect, it } from "bun:test";

import { tryGetContext } from "questpie";

import { widgetDataFunctions } from "#questpie/admin/server/modules/admin/routes/widget-data";

describe("admin widget data route", () => {
	it("runs widget loaders inside a user-mode request context", async () => {
		const session = { user: { id: "user-1" } };
		const contexts: unknown[] = [];
		const app = {
			state: {
				config: {
					admin: {
						dashboard: {
							items: [
								{
									id: "secure-widget",
									type: "value",
									loader: async () => {
										contexts.push(tryGetContext());
										return { value: 42 };
									},
								},
							],
						},
					},
				},
			},
		};

		const result = await widgetDataFunctions.fetchWidgetData.handler({
			app,
			db: { marker: "db" },
			session,
			locale: "en",
			input: { widgetId: "secure-widget" },
		} as any);

		expect(result).toEqual({ value: 42 });
		expect(contexts).toHaveLength(1);
		expect((contexts[0] as any)?.accessMode).toBe("user");
		expect((contexts[0] as any)?.session).toBe(session);
	});
});
