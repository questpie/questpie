import { describe, expect, it } from "bun:test";

import {
	isAuthoritativeSidebar,
	mergeAdminConfig,
	mergeAdminSidebar,
	shouldAutoAppendUnlistedSidebar,
} from "../../src/server/config/admin-sidebar-merge.js";

describe("admin sidebar merge", () => {
	it("detects authoritative app sidebars with nested section items", () => {
		expect(
			isAuthoritativeSidebar({
				sections: [{ id: "product", items: [{ type: "link", href: "/admin" }] }],
			}),
		).toBe(true);
		expect(
			isAuthoritativeSidebar({
				sections: [{ id: "overview" }],
				items: [{ sectionId: "overview", type: "link", href: "/admin" }],
			}),
		).toBe(false);
	});

	it("replaces module sidebar contributions when app sidebar is authoritative", () => {
		const moduleSidebar = {
			sections: [{ id: "administration" }],
			items: [
				{
					sectionId: "administration",
					type: "collection",
					collection: "user",
				},
			],
		};
		const appSidebar = {
			sections: [
				{
					id: "product",
					items: [{ type: "collection", collection: "tasks" }],
				},
			],
		};

		expect(mergeAdminSidebar(moduleSidebar, appSidebar)).toEqual(appSidebar);
	});

	it("appends contribution sidebars for barbershop-style configs", () => {
		const moduleSidebar = {
			sections: [{ id: "administration" }],
			items: [
				{
					sectionId: "administration",
					type: "collection",
					collection: "user",
				},
			],
		};
		const appSidebar = {
			sections: [{ id: "overview" }],
			items: [
				{
					sectionId: "overview",
					type: "collection",
					collection: "appointments",
				},
			],
		};

		expect(mergeAdminSidebar(moduleSidebar, appSidebar)).toEqual({
			sections: [{ id: "administration" }, { id: "overview" }],
			items: [
				{
					sectionId: "administration",
					type: "collection",
					collection: "user",
				},
				{
					sectionId: "overview",
					type: "collection",
					collection: "appointments",
				},
			],
		});
	});

	it("honors sidebarMode replace on admin config merge", () => {
		const merged = mergeAdminConfig(
			{
				sidebar: {
					sections: [{ id: "administration" }],
					items: [
						{
							sectionId: "administration",
							type: "collection",
							collection: "assets",
						},
					],
				},
			},
			{
				sidebarMode: "replace",
				sidebar: {
					sections: [{ id: "product", items: [{ type: "link", href: "/admin" }] }],
				},
			},
		);

		expect(merged.sidebar).toEqual({
			sections: [{ id: "product", items: [{ type: "link", href: "/admin" }] }],
		});
	});

	it("suppresses auto-append when sidebar is authoritative or replace mode", () => {
		const authoritative = {
			sections: [{ id: "product", items: [{ type: "link", href: "/admin" }] }],
		};

		expect(
			shouldAutoAppendUnlistedSidebar({ sidebarMode: "append" }, authoritative),
		).toBe(false);
		expect(
			shouldAutoAppendUnlistedSidebar({ sidebarMode: "replace" }, {
				sections: [{ id: "overview" }],
				items: [],
			}),
		).toBe(false);
		expect(
			shouldAutoAppendUnlistedSidebar(undefined, {
				sections: [{ id: "overview" }],
				items: [{ sectionId: "overview", type: "link", href: "/admin" }],
			}),
		).toBe(true);
	});
});
