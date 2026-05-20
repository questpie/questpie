import { describe, expect, it } from "bun:test";

import adminUserCollection from "../../src/server/modules/admin/collections/user";
import {
	createActionCallbackProxy,
	createViewCallbackProxy,
} from "../../src/server/proxy-factories";

describe("createActionCallbackProxy", () => {
	it("supports list action references and server action builder calls", () => {
		const a = createActionCallbackProxy() as any;

		expect(a.delete()).toBe("delete");
		expect(JSON.parse(JSON.stringify([a.delete]))).toEqual(["delete"]);

		expect(
			a.headerAction({
				id: "createUser",
				label: "Create user",
				handler: () => ({ type: "success" }),
			}),
		).toMatchObject({ id: "createUser", scope: "header" });

		expect(
			a.action({
				id: "resetPassword",
				label: "Reset password",
				handler: () => ({ type: "success" }),
			}),
		).toMatchObject({ id: "resetPassword", scope: "single" });
	});
});

describe("createViewCallbackProxy", () => {
	it("converts camelCase to kebab-case view id", () => {
		const v = createViewCallbackProxy() as any;
		const result = v.collectionTable();
		expect(result.view).toBe("collection-table");
	});

	it("passes quickFilters through as-is", () => {
		const v = createViewCallbackProxy() as any;
		const quickFilters = [
			{
				id: "active",
				label: { en: "Active" },
				icon: { type: "icon", props: { name: "ph:check-circle" } },
				filters: [
					{
						id: "status-active",
						field: "status",
						operator: "not_in",
						value: ["done", "cancelled"],
					},
				],
			},
		];

		const result = v.collectionTable({
			columns: ["name", "status"],
			quickFilters,
		});

		expect(result.view).toBe("collection-table");
		expect(result.quickFilters).toBe(quickFilters);
		expect(result.quickFilters[0].filters[0].operator).toBe("not_in");
	});

	it("passes defaultFilters through as-is", () => {
		const v = createViewCallbackProxy() as any;
		const defaultFilters = [
			{
				id: "default-status",
				field: "status",
				operator: "not_in",
				value: ["done", "cancelled"],
			},
		];

		const result = v.collectionTable({ defaultFilters });
		expect(result.defaultFilters).toBe(defaultFilters);
	});

	it("produces empty config when called without arguments", () => {
		const v = createViewCallbackProxy() as any;
		const result = v.collectionTable();
		expect(result).toEqual({ view: "collection-table" });
	});
});

describe("admin module action factories", () => {
	it("resolves built-in and scoped custom actions on the bundled user collection", () => {
		const actions = (adminUserCollection as any).state.adminActions;

		expect(actions.builtin).toContain("save");
		expect(actions.custom[0]).toMatchObject({
			id: "createUser",
			scope: "header",
		});
		expect(actions.custom[1]).toMatchObject({
			id: "resetPassword",
			scope: "single",
		});
		expect(actions.custom[0].form.fields.name.admin.placeholder).toBeDefined();
		expect(actions.custom[0].form.fields.password.admin.type).toBe("password");
		expect(actions.custom[0].form.fields.role.default).toBe("user");
	});
});
