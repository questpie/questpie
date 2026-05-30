import { describe, expect, it } from "bun:test";

import {
	cloneFilters,
	filtersEqual,
} from "../../src/client/lib/view-filter-utils";
import { mapListSchemaToConfig } from "../../src/client/views/collection/table-view";

describe("mapListSchemaToConfig — quickFilters", () => {
	it("maps schema quickFilters with FilterRule[] format into config", () => {
		const config = mapListSchemaToConfig({
			columns: ["name", "status"],
			quickFilters: [
				{
					id: "active",
					label: { en: "Active" },
					filters: [
						{
							id: "status-active",
							field: "status",
							operator: "not_in",
							value: ["done", "cancelled"],
						},
					],
				},
			],
		});

		expect(config?.quickFilters).toHaveLength(1);
		expect(config!.quickFilters![0].id).toBe("active");
		expect(config!.quickFilters![0].filters).toEqual([
			{
				id: "status-active",
				field: "status",
				operator: "not_in",
				value: ["done", "cancelled"],
			},
		]);
	});

	it("omits quickFilters when absent or empty", () => {
		expect(mapListSchemaToConfig({ columns: ["name"] })?.quickFilters).toBe(
			undefined,
		);
		expect(
			mapListSchemaToConfig({ columns: ["name"], quickFilters: [] })
				?.quickFilters,
		).toBe(undefined);
	});

	it("preserves icon and description on quick filter config", () => {
		const config = mapListSchemaToConfig({
			quickFilters: [
				{
					id: "overdue",
					label: { en: "Overdue" },
					description: { en: "Issues past their due date" },
					icon: { type: "icon", props: { name: "ph:warning" } },
					filters: [
						{
							id: "overdue-filter",
							field: "dueAt",
							operator: "less_than",
							value: "now",
						},
					],
				},
			],
		});

		const qf = config!.quickFilters![0];
		expect(qf.description).toEqual({ en: "Issues past their due date" });
		expect(qf.icon).toEqual({ type: "icon", props: { name: "ph:warning" } });
	});

	it("maps defaultFilters alongside quickFilters", () => {
		const config = mapListSchemaToConfig({
			defaultFilters: [
				{
					id: "default-status",
					field: "status",
					operator: "not_in",
					value: ["done", "cancelled"],
				},
			],
			quickFilters: [
				{
					id: "backlog",
					label: { en: "Backlog" },
					filters: [
						{
							id: "backlog-filter",
							field: "status",
							operator: "equals",
							value: "backlog",
						},
					],
				},
			],
		});

		expect(config?.defaultFilters).toHaveLength(1);
		expect(config?.quickFilters).toHaveLength(1);
	});
});

describe("filtersEqual — quick filter matching", () => {
	const activeFilters = [
		{
			id: "status-active",
			field: "status",
			operator: "not_in" as const,
			value: ["done", "cancelled"] as (string | number | boolean)[],
		},
	];

	it("returns true for identical filter arrays", () => {
		const clone = cloneFilters(activeFilters);
		expect(filtersEqual(activeFilters, clone)).toBe(true);
	});

	it("returns false when operator differs", () => {
		expect(
			filtersEqual(activeFilters, [
				{ ...activeFilters[0], operator: "in" as const },
			]),
		).toBe(false);
	});

	it("returns false when array values differ in order", () => {
		expect(
			filtersEqual(activeFilters, [
				{
					...activeFilters[0],
					value: ["cancelled", "done"],
				},
			]),
		).toBe(false);
	});

	it("returns false for different lengths", () => {
		expect(filtersEqual(activeFilters, [])).toBe(false);
	});

	it("returns true for two empty arrays", () => {
		expect(filtersEqual([], [])).toBe(true);
	});

	it("handles boolean filter values", () => {
		const a = [
			{
				id: "enabled-true",
				field: "enabled",
				operator: "equals" as const,
				value: true as boolean,
			},
		];
		const b = cloneFilters(a);
		expect(filtersEqual(a, b)).toBe(true);
	});
});

describe("cloneFilters — immutability", () => {
	it("returns a new array with new objects", () => {
		const original = [
			{
				id: "f1",
				field: "status",
				operator: "not_in" as const,
				value: ["done", "cancelled"] as (string | number | boolean)[],
			},
		];
		const cloned = cloneFilters(original);

		expect(cloned).not.toBe(original);
		expect(cloned[0]).not.toBe(original[0]);
		expect(cloned[0].value).not.toBe(original[0].value);
		expect(cloned).toEqual(original);
	});

	it("clones scalar values without wrapping in array", () => {
		const original = [
			{
				id: "f1",
				field: "enabled",
				operator: "equals" as const,
				value: true as boolean,
			},
		];
		const cloned = cloneFilters(original);
		expect(cloned[0].value).toBe(true);
	});
});
