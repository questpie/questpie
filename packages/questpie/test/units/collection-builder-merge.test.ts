import { describe, expect, test } from "bun:test";

import { collection } from "../../src/exports/index.js";

describe("CollectionBuilder.merge()", () => {
	test("preserves fields from both builders", () => {
		const a = collection("posts").fields(({ f }) => ({
			title: f.text(255),
		}));

		const b = collection("posts").fields(({ f }) => ({
			body: f.textarea(),
		}));

		const merged: any = a.merge(b);
		expect(merged.state.fields.title).toBeDefined();
		expect(merged.state.fields.body).toBeDefined();
	});

	test("preserves extension-set keys (admin/adminList/adminForm/adminActions/adminPreview)", () => {
		const otherAdminConfig = { label: { en: "Posts" }, icon: "ph:article" };
		const otherAdminList = { view: "collection-table", columns: [] };
		const otherAdminForm = { view: "collection-form", fields: [] };
		const otherAdminActions = {
			builtin: ["save"],
			custom: [{ id: "publish", label: "Publish" }],
		};
		const otherAdminPreview = { enabled: true };

		const a: any = collection("posts").fields(({ f }) => ({
			title: f.text(255),
		}));

		const b: any = collection("posts")
			.fields(({ f }) => ({ body: f.textarea() }))
			.set("admin", otherAdminConfig)
			.set("adminList", otherAdminList)
			.set("adminForm", otherAdminForm)
			.set("adminActions", otherAdminActions)
			.set("adminPreview", otherAdminPreview);

		const merged: any = a.merge(b);

		expect(merged.state.admin).toEqual(otherAdminConfig);
		expect(merged.state.adminList).toEqual(otherAdminList);
		expect(merged.state.adminForm).toEqual(otherAdminForm);
		expect(merged.state.adminActions).toEqual(otherAdminActions);
		expect(merged.state.adminPreview).toEqual(otherAdminPreview);
	});

	test("preserves this's extension-set keys when other doesn't have them", () => {
		const a: any = collection("posts")
			.fields(({ f }) => ({ title: f.text(255) }))
			.set("admin", { label: { en: "Mine" } })
			.set("adminActions", { builtin: ["save"], custom: [] });

		const b: any = collection("posts").fields(({ f }) => ({
			body: f.textarea(),
		}));

		const merged: any = a.merge(b);

		expect(merged.state.admin).toEqual({ label: { en: "Mine" } });
		expect(merged.state.adminActions).toEqual({
			builtin: ["save"],
			custom: [],
		});
	});

	test("other state takes precedence on conflicting extension keys", () => {
		const a: any = collection("posts")
			.fields(({ f }) => ({ title: f.text(255) }))
			.set("admin", { label: { en: "Mine" } });

		const b: any = collection("posts")
			.fields(({ f }) => ({ body: f.textarea() }))
			.set("admin", { label: { en: "Other" } });

		const merged: any = a.merge(b);

		expect(merged.state.admin).toEqual({ label: { en: "Other" } });
	});
});
