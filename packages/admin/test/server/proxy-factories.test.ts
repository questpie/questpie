import { describe, expect, it } from "bun:test";

import adminUserCollection from "../../src/server/modules/admin/collections/user";
import { createActionCallbackProxy } from "../../src/server/proxy-factories";

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
