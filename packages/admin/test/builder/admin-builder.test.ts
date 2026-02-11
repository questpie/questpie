/**
 * Admin Builder Tests
 *
 * Tests for AdminBuilder class - the main orchestrator for admin configuration.
 */

import { describe, expect, it } from "bun:test";
import { AdminBuilder } from "#questpie/admin/client/builder/admin-builder";
import {
	createDashboardPage,
	createEmailField,
	createFormView,
	createStatsWidget,
	createTableView,
	createTextField,
	MockIcon,
} from "../utils/helpers";

describe("AdminBuilder.empty()", () => {
	it("should create an empty builder with correct initial state", () => {
		const admin = AdminBuilder.empty();

		expect(admin.state.fields).toEqual({});
		expect(admin.state.listViews).toEqual({});
		expect(admin.state.editViews).toEqual({});
		expect(admin.state.widgets).toEqual({});
		expect(admin.state.pages).toEqual({});
	});

	it("should have default locale config", () => {
		const admin = AdminBuilder.empty();

		expect(admin.state.locale).toEqual({
			default: "en",
			supported: ["en"],
		});
	});

	it("should accept TApp generic parameter", () => {
		type MockCMS = { collections: { posts: any } };
		const admin = AdminBuilder.empty<MockCMS>();

		expect(admin.state["~app"]).toBeUndefined();
		// Type-level: ~app should be MockCMS
	});
});

describe("AdminBuilder.fields()", () => {
	it("should add field definitions to registry", () => {
		const admin = AdminBuilder.empty().fields({
			text: createTextField(),
		});

		expect(admin.state.fields.text).toBeDefined();
		expect(admin.state.fields.text.name).toBe("text");
	});

	it("should merge with existing fields", () => {
		const admin = AdminBuilder.empty()
			.fields({ text: createTextField() })
			.fields({ email: createEmailField() });

		expect(admin.state.fields.text).toBeDefined();
		expect(admin.state.fields.email).toBeDefined();
	});

	it("should not mutate original builder", () => {
		const original = AdminBuilder.empty();
		const withFields = original.fields({ text: createTextField() });

		expect(original.state.fields).toEqual({});
		expect(withFields.state.fields.text).toBeDefined();
	});

	it("should allow overwriting fields with same key", () => {
		const field1 = createTextField().$options({ maxLength: 100 });
		const field2 = createTextField().$options({ maxLength: 200 });

		const admin = AdminBuilder.empty()
			.fields({ text: field1 })
			.fields({ text: field2 });

		expect(admin.state.fields.text["~options"]).toEqual({ maxLength: 200 });
	});
});

describe("AdminBuilder.views()", () => {
	it("should automatically separate list and edit views", () => {
		const admin = AdminBuilder.empty().views({
			table: createTableView(),
			form: createFormView(),
		});

		expect(admin.state.listViews.table).toBeDefined();
		expect(admin.state.editViews.form).toBeDefined();
	});

	it("should place list views only in listViews", () => {
		const admin = AdminBuilder.empty().views({
			table: createTableView(),
		});

		expect(admin.state.listViews.table).toBeDefined();
		expect((admin.state.editViews as any).table).toBeUndefined();
	});

	it("should place edit views only in editViews", () => {
		const admin = AdminBuilder.empty().views({
			form: createFormView(),
		});

		expect(admin.state.editViews.form).toBeDefined();
		expect((admin.state.listViews as any).form).toBeUndefined();
	});

	it("should merge with existing views", () => {
		const admin = AdminBuilder.empty()
			.views({ table: createTableView() })
			.views({ form: createFormView() });

		expect(admin.state.listViews.table).toBeDefined();
		expect(admin.state.editViews.form).toBeDefined();
	});

	it("should not mutate original builder", () => {
		const original = AdminBuilder.empty();
		const withViews = original.views({ table: createTableView() });

		expect(original.state.listViews).toEqual({});
		expect(withViews.state.listViews.table).toBeDefined();
	});
});

describe("AdminBuilder.widgets()", () => {
	it("should add widget definitions", () => {
		const admin = AdminBuilder.empty().widgets({
			stats: createStatsWidget(),
		});

		expect(admin.state.widgets.stats).toBeDefined();
	});

	it("should merge with existing widgets", () => {
		const admin = AdminBuilder.empty()
			.widgets({ stats: createStatsWidget() })
			.widgets({ chart: createStatsWidget() });

		expect(admin.state.widgets.stats).toBeDefined();
		expect(admin.state.widgets.chart).toBeDefined();
	});

	it("should not mutate original builder", () => {
		const original = AdminBuilder.empty();
		const withWidgets = original.widgets({ stats: createStatsWidget() });

		expect(original.state.widgets).toEqual({});
		expect(withWidgets.state.widgets.stats).toBeDefined();
	});
});

describe("AdminBuilder.pages()", () => {
	it("should add page definitions", () => {
		const admin = AdminBuilder.empty().pages({
			dashboard: createDashboardPage(),
		});

		expect(admin.state.pages.dashboard).toBeDefined();
	});

	it("should merge with existing pages", () => {
		const admin = AdminBuilder.empty()
			.pages({ dashboard: createDashboardPage() })
			.pages({ settings: createDashboardPage() });

		expect(admin.state.pages.dashboard).toBeDefined();
		expect(admin.state.pages.settings).toBeDefined();
	});

	it("should not mutate original builder", () => {
		const original = AdminBuilder.empty();
		const withPages = original.pages({ dashboard: createDashboardPage() });

		expect(original.state.pages).toEqual({});
		expect(withPages.state.pages.dashboard).toBeDefined();
	});
});

describe("AdminBuilder.defaultViews()", () => {
	it("should set default views config", () => {
		const admin = AdminBuilder.empty().defaultViews({
			list: "table",
			edit: "form",
		});

		expect(admin.state.defaultViews).toEqual({
			list: "table",
			edit: "form",
		});
	});

	it("should merge with existing default views", () => {
		const admin = AdminBuilder.empty()
			.defaultViews({ list: "table" })
			.defaultViews({ edit: "form" });

		expect(admin.state.defaultViews.list).toBe("table");
		expect(admin.state.defaultViews.edit).toBe("form");
	});

	it("should not mutate original builder", () => {
		const original = AdminBuilder.empty();
		const withDefaultViews = original.defaultViews({ list: "table" });

		expect(original.state.defaultViews).toEqual({});
		expect(withDefaultViews.state.defaultViews.list).toBe("table");
	});
});

describe("AdminBuilder state immutability", () => {
	it("should create new instance on every mutation", () => {
		const a = AdminBuilder.empty();
		const b = a.fields({ text: createTextField() });
		const c = b.views({ table: createTableView() });

		expect(a).not.toBe(b);
		expect(b).not.toBe(c);
		expect(a).not.toBe(c);
	});

	it("should allow long method chains", () => {
		const admin = AdminBuilder.empty()
			.fields({ text: createTextField() })
			.views({ table: createTableView(), form: createFormView() })
			.widgets({ stats: createStatsWidget() })
			.pages({ dashboard: createDashboardPage() })
			.defaultViews({ list: "table" });

		expect(admin.state.fields.text).toBeDefined();
		expect(admin.state.listViews.table).toBeDefined();
		expect(admin.state.editViews.form).toBeDefined();
		expect(admin.state.widgets.stats).toBeDefined();
		expect(admin.state.pages.dashboard).toBeDefined();
	});
});
