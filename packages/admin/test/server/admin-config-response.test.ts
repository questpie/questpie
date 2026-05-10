import { describe, expect, it } from "bun:test";

import { stripUndefinedDeep } from "#questpie/admin/server/modules/admin/routes/admin-config";

function containsUndefined(value: unknown): boolean {
	if (value === undefined) return true;
	if (value === null || typeof value !== "object") return false;
	if (Array.isArray(value)) return value.some(containsUndefined);
	return Object.values(value).some(containsUndefined);
}

describe("admin config response serialization", () => {
	it("strips undefined values recursively before SuperJSON serialization", () => {
		const input = {
			dashboard: {
				title: { en: "QUESTPIE Cloud" },
				rowHeight: undefined,
				gap: undefined,
				realtime: undefined,
				items: [
					undefined,
					{
						type: "value",
						id: "deployments",
						description: undefined,
						props: {
							label: { en: "Deployments" },
							formatter: undefined,
						},
					},
				],
			},
			sidebar: {
				sections: [
					{
						id: "overview",
						title: { en: "Overview" },
						icon: undefined,
						collapsible: undefined,
						items: [
							{
								type: "link",
								href: "/admin",
								label: { en: "Dashboard" },
								icon: undefined,
							},
						],
					},
				],
			},
			collections: {
				plans: {
					label: { en: "Plans" },
					description: undefined,
					hidden: undefined,
					order: undefined,
				},
			},
		};

		const result = stripUndefinedDeep(input) as any;

		expect(containsUndefined(result)).toBe(false);
		expect("rowHeight" in result.dashboard).toBe(false);
		expect("gap" in result.dashboard).toBe(false);
		expect("realtime" in result.dashboard).toBe(false);
		expect(result.dashboard.items).toHaveLength(1);
		expect("description" in result.dashboard.items[0]).toBe(false);
		expect("formatter" in result.dashboard.items[0].props).toBe(false);
		expect("icon" in result.sidebar.sections[0]).toBe(false);
		expect("collapsible" in result.sidebar.sections[0]).toBe(false);
		expect("description" in result.collections.plans).toBe(false);
	});

	it("preserves null values because they are explicit wire data", () => {
		const result = stripUndefinedDeep({
			branding: {
				logo: null,
				favicon: undefined,
			},
		}) as any;

		expect(result).toEqual({ branding: { logo: null } });
	});
});
