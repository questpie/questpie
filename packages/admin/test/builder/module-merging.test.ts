/**
 * Module Merging Tests
 *
 * Tests for plain state spread merging (AdminState composition).
 * AdminBuilder is gone — modules are just plain AdminState objects merged via spread.
 */

import { describe, expect, it } from "bun:test";

import type { AdminState } from "#questpie/admin/client/builder/admin-types";
import { view } from "#questpie/admin/client/builder/view/view";

import {
	createDashboardPage,
	createEmailField,
	createFormView,
	createNumberField,
	createStatsWidget,
	createTableView,
	createTextField,
	MockFormView,
	MockTableView,
} from "../utils/helpers";

/**
 * Create a minimal empty AdminState for testing.
 */
function createEmptyState(): AdminState {
	return {
		"~app": undefined as any,
		fields: {},
		components: {},
		views: {},
		pages: {},
		widgets: {},
		blocks: {} as Record<string, never>,
		translations: {},
		locale: { default: "en", supported: ["en"] },
	};
}

/**
 * Merge two AdminState objects using spread (like module composition).
 */
function mergeStates(base: AdminState, extension: AdminState): AdminState {
	return {
		...base,
		fields: { ...base.fields, ...extension.fields },
		components: { ...base.components, ...extension.components },
		views: { ...base.views, ...extension.views },
		pages: { ...base.pages, ...extension.pages },
		widgets: { ...base.widgets, ...extension.widgets },
		blocks: { ...base.blocks, ...extension.blocks } as Record<string, never>,
		translations: { ...base.translations, ...extension.translations },
	};
}

describe("Field Merging", () => {
	it("should merge fields from multiple modules (flat spread)", () => {
		const module1: AdminState = {
			...createEmptyState(),
			fields: { text: createTextField() },
		};

		const module2: AdminState = {
			...createEmptyState(),
			fields: { email: createEmailField() },
		};

		const combined = mergeStates(
			mergeStates(createEmptyState(), module1),
			module2,
		);

		expect(combined.fields.text).toBeDefined();
		expect(combined.fields.email).toBeDefined();
	});

	it("should overwrite fields with same key (last-wins)", () => {
		const field1 = createTextField();
		const field2 = createTextField();

		const module1: AdminState = {
			...createEmptyState(),
			fields: { text: field1 },
		};
		const module2: AdminState = {
			...createEmptyState(),
			fields: { text: field2 },
		};

		const combined = mergeStates(
			mergeStates(createEmptyState(), module1),
			module2,
		);

		expect(combined.fields.text).toBe(field2);
	});

	it("should preserve existing fields when merging empty module", () => {
		const base: AdminState = {
			...createEmptyState(),
			fields: {
				text: createTextField(),
				email: createEmailField(),
			},
		};

		const combined = mergeStates(base, createEmptyState());

		expect(combined.fields.text).toBeDefined();
		expect(combined.fields.email).toBeDefined();
	});
});

describe("View Merging", () => {
	it("should merge list views in flat views map", () => {
		const module1: AdminState = {
			...createEmptyState(),
			views: { table: createTableView() },
		};

		const module2: AdminState = {
			...createEmptyState(),
			views: { grid: view("grid", { kind: "list", component: MockTableView }) },
		};

		const combined = mergeStates(
			mergeStates(createEmptyState(), module1),
			module2,
		);

		expect(combined.views.table).toBeDefined();
		expect(combined.views.grid).toBeDefined();
	});

	it("should merge form views in flat views map", () => {
		const module1: AdminState = {
			...createEmptyState(),
			views: { form: createFormView() },
		};

		const module2: AdminState = {
			...createEmptyState(),
			views: {
				wizard: view("wizard", { kind: "form", component: MockFormView }),
			},
		};

		const combined = mergeStates(
			mergeStates(createEmptyState(), module1),
			module2,
		);

		expect(combined.views.form).toBeDefined();
		expect(combined.views.wizard).toBeDefined();
	});

	it("should keep views of different kinds in same map", () => {
		const module1: AdminState = {
			...createEmptyState(),
			views: {
				table: createTableView(),
				form: createFormView(),
			},
		};

		const combined = mergeStates(createEmptyState(), module1);

		expect(combined.views.table).toBeDefined();
		expect(combined.views.form).toBeDefined();
		expect(combined.views.table.kind).toBe("list");
		expect(combined.views.form.kind).toBe("form");
	});
});

describe("Widget Merging", () => {
	it("should merge widgets correctly", () => {
		const module1: AdminState = {
			...createEmptyState(),
			widgets: { stats: createStatsWidget() },
		};

		const module2: AdminState = {
			...createEmptyState(),
			widgets: { chart: createStatsWidget() },
		};

		const combined = mergeStates(
			mergeStates(createEmptyState(), module1),
			module2,
		);

		expect(combined.widgets.stats).toBeDefined();
		expect(combined.widgets.chart).toBeDefined();
	});

	it("should overwrite widget with same key (last-wins)", () => {
		const widget1 = createStatsWidget();
		const widget2 = createStatsWidget();

		const module1: AdminState = {
			...createEmptyState(),
			widgets: { stats: widget1 },
		};
		const module2: AdminState = {
			...createEmptyState(),
			widgets: { stats: widget2 },
		};

		const combined = mergeStates(
			mergeStates(createEmptyState(), module1),
			module2,
		);

		expect(combined.widgets.stats).toBe(widget2);
	});
});

describe("Page Merging", () => {
	it("should merge pages correctly", () => {
		const module1: AdminState = {
			...createEmptyState(),
			pages: { dashboard: createDashboardPage() },
		};

		const module2: AdminState = {
			...createEmptyState(),
			pages: { settings: createDashboardPage() },
		};

		const combined = mergeStates(
			mergeStates(createEmptyState(), module1),
			module2,
		);

		expect(combined.pages.dashboard).toBeDefined();
		expect(combined.pages.settings).toBeDefined();
	});
});

describe("State Immutability", () => {
	it("should not mutate original state objects after merge", () => {
		const module1: AdminState = {
			...createEmptyState(),
			fields: { text: createTextField() },
		};

		const module2: AdminState = {
			...createEmptyState(),
			fields: { email: createEmailField() },
		};

		const original1Fields = { ...module1.fields };
		const original2Fields = { ...module2.fields };

		mergeStates(mergeStates(createEmptyState(), module1), module2);

		expect(module1.fields).toEqual(original1Fields);
		expect(module2.fields).toEqual(original2Fields);
	});

	it("should create new state object after merge", () => {
		const base = createEmptyState();
		const module1: AdminState = {
			...createEmptyState(),
			fields: { text: createTextField() },
		};

		const combined = mergeStates(base, module1);

		expect(combined).not.toBe(base);
		expect(combined).not.toBe(module1);
	});
});

describe("Chained Merges", () => {
	it("should preserve order in chained merges (last-wins)", () => {
		const field1 = createTextField();
		const field2 = createTextField();
		const field3 = createTextField();

		const module1: AdminState = {
			...createEmptyState(),
			fields: { text: field1 },
		};
		const module2: AdminState = {
			...createEmptyState(),
			fields: { text: field2 },
		};
		const module3: AdminState = {
			...createEmptyState(),
			fields: { text: field3 },
		};

		const combined = mergeStates(
			mergeStates(mergeStates(createEmptyState(), module1), module2),
			module3,
		);

		expect(combined.fields.text).toBe(field3);
	});

	it("should allow mixing field and view merges", () => {
		const coreModule: AdminState = {
			...createEmptyState(),
			fields: { text: createTextField() },
			views: { table: createTableView() },
		};

		const combined = mergeStates(createEmptyState(), coreModule);
		const withNumber: AdminState = {
			...combined,
			fields: { ...combined.fields, number: createNumberField() },
		};

		expect(withNumber.fields.text).toBeDefined();
		expect(withNumber.fields.number).toBeDefined();
		expect(withNumber.views.table).toBeDefined();
	});
});

describe("Module Composition Patterns", () => {
	it("should support creating a core module with all basics", () => {
		const coreModule: AdminState = {
			...createEmptyState(),
			fields: {
				text: createTextField(),
				email: createEmailField(),
				number: createNumberField(),
			},
			views: {
				table: createTableView(),
				form: createFormView(),
			},
			widgets: {
				stats: createStatsWidget(),
			},
		};

		const combined = mergeStates(createEmptyState(), coreModule);

		expect(Object.keys(combined.fields)).toHaveLength(3);
		expect(Object.keys(combined.views)).toHaveLength(2);
		expect(Object.keys(combined.widgets)).toHaveLength(1);
	});

	it("should support creating extension modules", () => {
		const coreModule: AdminState = {
			...createEmptyState(),
			fields: { text: createTextField() },
		};

		const blogExtension: AdminState = {
			...createEmptyState(),
			fields: { richText: createTextField() },
		};

		const combined = mergeStates(
			mergeStates(createEmptyState(), coreModule),
			blogExtension,
		);

		expect(combined.fields.text).toBeDefined();
		expect(combined.fields.richText).toBeDefined();
	});

	it("should support feature flag pattern with conditional modules", () => {
		const coreModule: AdminState = {
			...createEmptyState(),
			fields: { text: createTextField() },
		};

		const analyticsModule: AdminState = {
			...createEmptyState(),
			widgets: { analytics: createStatsWidget() },
		};

		const enableAnalytics = true;

		let state = mergeStates(createEmptyState(), coreModule);
		if (enableAnalytics) {
			state = mergeStates(state, analyticsModule);
		}

		expect(state.widgets.analytics).toBeDefined();
	});
});

describe("Complex Merge Scenarios", () => {
	it("should handle deeply nested module composition", () => {
		const fieldsModule: AdminState = {
			...createEmptyState(),
			fields: { text: createTextField() },
		};

		const viewsModule: AdminState = {
			...createEmptyState(),
			views: { table: createTableView() },
		};

		const combinedCore = mergeStates(
			mergeStates(createEmptyState(), fieldsModule),
			viewsModule,
		);

		const widgetsModule: AdminState = {
			...createEmptyState(),
			widgets: { stats: createStatsWidget() },
		};

		const final = mergeStates(
			mergeStates(createEmptyState(), combinedCore),
			widgetsModule,
		);

		expect(final.fields.text).toBeDefined();
		expect(final.views.table).toBeDefined();
		expect(final.widgets.stats).toBeDefined();
	});

	it("should handle empty modules in chain", () => {
		const fieldsModule: AdminState = {
			...createEmptyState(),
			fields: { text: createTextField() },
		};

		const combined = mergeStates(
			mergeStates(
				mergeStates(
					mergeStates(createEmptyState(), createEmptyState()),
					createEmptyState(),
				),
				fieldsModule,
			),
			createEmptyState(),
		);

		expect(combined.fields.text).toBeDefined();
	});
});
