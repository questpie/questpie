/**
 * Admin Runtime Tests
 *
 * Tests for Admin class - runtime wrapper around AdminBuilder state.
 */

import { describe, expect, it } from "bun:test";
import { Admin } from "#questpie/admin/client/builder/admin";
import { AdminBuilder } from "#questpie/admin/client/builder/admin-builder";
import { page } from "#questpie/admin/client/builder/page/page";
import {
	createDashboardPage,
	createEmailField,
	createFormView,
	createStatsWidget,
	createTableView,
	createTextField,
} from "../utils/helpers";

describe("Admin.normalize()", () => {
	it("should create Admin from AdminBuilder", () => {
		const builder = AdminBuilder.empty();
		const admin = Admin.normalize(builder);

		expect(admin).toBeInstanceOf(Admin);
	});

	it("should extract state from builder", () => {
		const builder = AdminBuilder.empty().fields({
			text: createTextField(),
		});

		const admin = Admin.normalize(builder);

		expect(admin.state).toBe(builder.state);
	});
});

describe("Admin constructor", () => {
	it("should accept state directly", () => {
		const state = {
			"~app": undefined,
			fields: { text: createTextField() },
			components: {},
			listViews: {},
			editViews: {},
			widgets: {},
			pages: {},
			blocks: {},
			locale: { default: "en", supported: ["en"] },
			defaultViews: {},
			translations: {},
		};

		const admin = new Admin(state);

		expect(admin.state).toBe(state);
	});
});

describe("Admin.getPages()", () => {
	it("should return all page configurations", () => {
		const builder = AdminBuilder.empty().pages({
			dashboard: createDashboardPage(),
			analytics: createDashboardPage(),
		});

		const admin = Admin.normalize(builder);
		const pages = admin.getPages();

		expect(pages.dashboard).toBeDefined();
		expect(pages.analytics).toBeDefined();
	});

	it("should extract state from page builders", () => {
		const dashboardPage = page("dashboard", { component: () => null }).path(
			"/dashboard",
		);

		const builder = AdminBuilder.empty().pages({
			dashboard: dashboardPage,
		});

		const admin = Admin.normalize(builder);
		const pages = admin.getPages();

		expect(pages.dashboard.name).toBe("dashboard");
		expect(pages.dashboard.path).toBe("/dashboard");
	});
});

describe("Admin.getPageConfig()", () => {
	it("should return specific page config", () => {
		const dashboardPage = page("dashboard", { component: () => null });

		const builder = AdminBuilder.empty().pages({
			dashboard: dashboardPage,
		});

		const admin = Admin.normalize(builder);
		const config = admin.getPageConfig("dashboard");

		expect(config?.name).toBe("dashboard");
	});

	it("should return undefined for non-existent page", () => {
		const admin = Admin.normalize(AdminBuilder.empty());
		const config = admin.getPageConfig("nonexistent");

		expect(config).toBeUndefined();
	});
});

describe("Admin.getDefaultViews()", () => {
	it("should return default views config", () => {
		const builder = AdminBuilder.empty().defaultViews({
			list: "table",
			edit: "form",
		});

		const admin = Admin.normalize(builder);
		const defaultViews = admin.getDefaultViews();

		expect(defaultViews).toEqual({
			list: "table",
			edit: "form",
		});
	});

	it("should return empty object when not configured", () => {
		const admin = Admin.normalize(AdminBuilder.empty());
		const defaultViews = admin.getDefaultViews();

		expect(defaultViews).toEqual({});
	});
});

describe("Admin.getLocale()", () => {
	it("should return locale config from state", () => {
		const admin = new Admin({
			...AdminBuilder.empty().state,
			locale: {
				default: "sk",
				supported: ["en", "sk", "cs"],
			},
		});
		const locale = admin.getLocale();

		expect(locale.default).toBe("sk");
		expect(locale.supported).toEqual(["en", "sk", "cs"]);
	});

	it("should return default locale when not configured", () => {
		const admin = Admin.normalize(AdminBuilder.empty());
		const locale = admin.getLocale();

		expect(locale.default).toBe("en");
		expect(locale.supported).toEqual(["en"]);
	});
});

describe("Admin.getAvailableLocales()", () => {
	it("should return supported locales array", () => {
		const admin = new Admin({
			...AdminBuilder.empty().state,
			locale: {
				default: "en",
				supported: ["en", "sk", "cs", "de"],
			},
		});

		expect(admin.getAvailableLocales()).toEqual(["en", "sk", "cs", "de"]);
	});

	it("should return default ['en'] when not configured", () => {
		const admin = Admin.normalize(AdminBuilder.empty());

		expect(admin.getAvailableLocales()).toEqual(["en"]);
	});
});

describe("Admin.getDefaultLocale()", () => {
	it("should return default locale", () => {
		const admin = new Admin({
			...AdminBuilder.empty().state,
			locale: {
				default: "sk",
				supported: ["en", "sk"],
			},
		});

		expect(admin.getDefaultLocale()).toBe("sk");
	});

	it("should return 'en' when not configured", () => {
		const admin = Admin.normalize(AdminBuilder.empty());

		expect(admin.getDefaultLocale()).toBe("en");
	});
});

describe("Admin.getLocaleLabel()", () => {
	it("should return human-readable label for known locales", () => {
		const admin = Admin.normalize(AdminBuilder.empty());

		expect(admin.getLocaleLabel("en")).toBe("English");
		expect(admin.getLocaleLabel("sk")).toBe("Slovencina");
		expect(admin.getLocaleLabel("cs")).toBe("Cestina");
		expect(admin.getLocaleLabel("de")).toBe("Deutsch");
		expect(admin.getLocaleLabel("fr")).toBe("Francais");
	});

	it("should return uppercase code for unknown locales", () => {
		const admin = Admin.normalize(AdminBuilder.empty());

		expect(admin.getLocaleLabel("xyz")).toBe("XYZ");
		expect(admin.getLocaleLabel("unknown")).toBe("UNKNOWN");
	});
});

describe("Admin.getFields()", () => {
	it("should return all field definitions", () => {
		const builder = AdminBuilder.empty().fields({
			text: createTextField(),
			email: createEmailField(),
		});

		const admin = Admin.normalize(builder);
		const fields = admin.getFields();

		expect(fields.text).toBeDefined();
		expect(fields.email).toBeDefined();
	});

	it("should return empty object when no fields", () => {
		const admin = Admin.normalize(AdminBuilder.empty());
		const fields = admin.getFields();

		expect(fields).toEqual({});
	});
});

describe("Admin.getField()", () => {
	it("should return specific field definition", () => {
		const textField = createTextField();
		const builder = AdminBuilder.empty().fields({
			text: textField,
		});

		const admin = Admin.normalize(builder);
		const field = admin.getField("text");

		expect(field).toBe(textField);
	});

	it("should return undefined for non-existent field", () => {
		const admin = Admin.normalize(AdminBuilder.empty());
		const field = admin.getField("nonexistent");

		expect(field).toBeUndefined();
	});
});

describe("Admin.getListViews()", () => {
	it("should return all list view definitions", () => {
		const builder = AdminBuilder.empty().views({
			table: createTableView(),
			form: createFormView(), // This should NOT be in listViews
		});

		const admin = Admin.normalize(builder);
		const listViews = admin.getListViews();

		expect(listViews.table).toBeDefined();
		expect((listViews as any).form).toBeUndefined();
	});

	it("should return empty object when no list views", () => {
		const admin = Admin.normalize(AdminBuilder.empty());
		const listViews = admin.getListViews();

		expect(listViews).toEqual({});
	});
});

describe("Admin.getEditViews()", () => {
	it("should return all edit view definitions", () => {
		const builder = AdminBuilder.empty().views({
			table: createTableView(), // This should NOT be in editViews
			form: createFormView(),
		});

		const admin = Admin.normalize(builder);
		const editViews = admin.getEditViews();

		expect(editViews.form).toBeDefined();
		expect((editViews as any).table).toBeUndefined();
	});

	it("should return empty object when no edit views", () => {
		const admin = Admin.normalize(AdminBuilder.empty());
		const editViews = admin.getEditViews();

		expect(editViews).toEqual({});
	});
});

describe("Admin.getWidgets()", () => {
	it("should return all widget definitions", () => {
		const builder = AdminBuilder.empty().widgets({
			stats: createStatsWidget(),
		});

		const admin = Admin.normalize(builder);
		const widgets = admin.getWidgets();

		expect(widgets.stats).toBeDefined();
	});

	it("should return empty object when no widgets", () => {
		const admin = Admin.normalize(AdminBuilder.empty());
		const widgets = admin.getWidgets();

		expect(widgets).toEqual({});
	});
});

describe("Admin - Complete State Extraction", () => {
	it("should work with complete admin configuration", () => {
		const builder = AdminBuilder.empty()
			.fields({
				text: createTextField(),
				email: createEmailField(),
			})
			.views({
				table: createTableView(),
				form: createFormView(),
			})
			.widgets({
				stats: createStatsWidget(),
			})
			.pages({
				dashboard: createDashboardPage(),
			})
			.defaultViews({
				list: "table",
			});

		const admin = Admin.normalize(builder);

		// Verify all getters work
		expect(Object.keys(admin.getFields())).toHaveLength(2);
		expect(Object.keys(admin.getListViews())).toHaveLength(1);
		expect(Object.keys(admin.getEditViews())).toHaveLength(1);
		expect(Object.keys(admin.getWidgets())).toHaveLength(1);
		expect(Object.keys(admin.getPages())).toHaveLength(1);
		expect(admin.getDefaultLocale()).toBe("en");
		expect(admin.getAvailableLocales()).toEqual(["en"]);
		expect(admin.getDefaultViews().list).toBe("table");
	});
});
