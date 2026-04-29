/**
 * Admin Runtime Tests
 *
 * Tests for Admin class — runtime wrapper around AdminState.
 */

import { describe, expect, it } from "bun:test";

import { Admin } from "#questpie/admin/client/builder/admin";
import type { AdminState } from "#questpie/admin/client/builder/admin-types";

import {
	createDashboardPage,
	createEmailField,
	createFormView,
	createStatsWidget,
	createTableView,
	createTestModuleState,
	createTextField,
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

describe("Admin.normalize()", () => {
	it("should create Admin from plain state", () => {
		const state = createEmptyState();
		const admin = Admin.normalize(state);

		expect(admin).toBeInstanceOf(Admin);
	});

	it("should wrap state directly", () => {
		const state: AdminState = {
			...createEmptyState(),
			fields: { text: createTextField() },
		};

		const admin = Admin.normalize(state);

		expect(admin.state).toBe(state);
	});

	it("should return Admin instance as-is", () => {
		const original = new Admin(createEmptyState());
		const result = Admin.normalize(original);

		expect(result).toBe(original);
	});
});

describe("Admin constructor", () => {
	it("should accept state directly", () => {
		const state: AdminState = {
			...createEmptyState(),
			fields: { text: createTextField() },
		};

		const admin = new Admin(state);

		expect(admin.state).toBe(state);
	});
});

describe("Admin.getPages()", () => {
	it("should return all page configurations", () => {
		const state: AdminState = {
			...createEmptyState(),
			pages: {
				dashboard: createDashboardPage(),
				analytics: createDashboardPage(),
			},
		};

		const admin = Admin.normalize(state);
		const pages = admin.getPages();

		expect(pages.dashboard).toBeDefined();
		expect(pages.analytics).toBeDefined();
	});

	it("should return page with path from factory", () => {
		const state: AdminState = {
			...createEmptyState(),
			pages: {
				dashboard: createDashboardPage(),
			},
		};

		const admin = Admin.normalize(state);
		const pages = admin.getPages();

		expect(pages.dashboard.name).toBe("dashboard");
		expect(pages.dashboard.path).toBe("/");
	});
});

describe("Admin.getPageConfig()", () => {
	it("should return specific page config", () => {
		const state: AdminState = {
			...createEmptyState(),
			pages: {
				dashboard: createDashboardPage(),
			},
		};

		const admin = Admin.normalize(state);
		const config = admin.getPageConfig("dashboard");

		expect(config?.name).toBe("dashboard");
	});

	it("should return undefined for non-existent page", () => {
		const admin = Admin.normalize(createEmptyState());
		const config = admin.getPageConfig("nonexistent");

		expect(config).toBeUndefined();
	});
});

describe("Admin.getViews()", () => {
	it("should return all view definitions (flat map)", () => {
		const state: AdminState = {
			...createEmptyState(),
			views: {
				table: createTableView(),
				form: createFormView(),
			},
		};

		const admin = Admin.normalize(state);
		const views = admin.getViews();

		expect(views.table).toBeDefined();
		expect(views.form).toBeDefined();
	});

	it("should return empty object when no views", () => {
		const admin = Admin.normalize(createEmptyState());
		const views = admin.getViews();

		expect(views).toEqual({});
	});
});

describe("Admin.getView()", () => {
	it("should return specific view by name", () => {
		const state: AdminState = {
			...createEmptyState(),
			views: {
				table: createTableView(),
			},
		};

		const admin = Admin.normalize(state);
		const view = admin.getView("table");

		expect(view).toBeDefined();
		expect(view?.name).toBe("table");
	});

	it("should return undefined for non-existent view", () => {
		const admin = Admin.normalize(createEmptyState());

		expect(admin.getView("nonexistent")).toBeUndefined();
	});
});

describe("Admin.getViewsByKind()", () => {
	it("should filter list views", () => {
		const state: AdminState = {
			...createEmptyState(),
			views: {
				table: createTableView(),
				form: createFormView(),
			},
		};

		const admin = Admin.normalize(state);
		const listViews = admin.getViewsByKind("list");

		expect(listViews.table).toBeDefined();
		expect(listViews.form).toBeUndefined();
	});

	it("should filter form views", () => {
		const state: AdminState = {
			...createEmptyState(),
			views: {
				table: createTableView(),
				form: createFormView(),
			},
		};

		const admin = Admin.normalize(state);
		const formViews = admin.getViewsByKind("form");

		expect(formViews.form).toBeDefined();
		expect(formViews.table).toBeUndefined();
	});
});

describe("Admin.getLocale()", () => {
	it("should return locale config from state", () => {
		const admin = new Admin({
			...createEmptyState(),
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
		const admin = Admin.normalize(createEmptyState());
		const locale = admin.getLocale();

		expect(locale.default).toBe("en");
		expect(locale.supported).toEqual(["en"]);
	});
});

describe("Admin.getAvailableLocales()", () => {
	it("should return supported locales array", () => {
		const admin = new Admin({
			...createEmptyState(),
			locale: {
				default: "en",
				supported: ["en", "sk", "cs", "de"],
			},
		});

		expect(admin.getAvailableLocales()).toEqual(["en", "sk", "cs", "de"]);
	});

	it("should return default ['en'] when not configured", () => {
		const admin = Admin.normalize(createEmptyState());

		expect(admin.getAvailableLocales()).toEqual(["en"]);
	});
});

describe("Admin.getDefaultLocale()", () => {
	it("should return default locale", () => {
		const admin = new Admin({
			...createEmptyState(),
			locale: {
				default: "sk",
				supported: ["en", "sk"],
			},
		});

		expect(admin.getDefaultLocale()).toBe("sk");
	});

	it("should return 'en' when not configured", () => {
		const admin = Admin.normalize(createEmptyState());

		expect(admin.getDefaultLocale()).toBe("en");
	});
});

describe("Admin.getLocaleLabel()", () => {
	it("should return human-readable label for known locales", () => {
		const admin = Admin.normalize(createEmptyState());

		expect(admin.getLocaleLabel("en")).toBe("English");
		expect(admin.getLocaleLabel("sk")).toBe("Slovencina");
		expect(admin.getLocaleLabel("cs")).toBe("Cestina");
		expect(admin.getLocaleLabel("de")).toBe("Deutsch");
		expect(admin.getLocaleLabel("fr")).toBe("Francais");
	});

	it("should return uppercase code for unknown locales", () => {
		const admin = Admin.normalize(createEmptyState());

		expect(admin.getLocaleLabel("xyz")).toBe("XYZ");
		expect(admin.getLocaleLabel("unknown")).toBe("UNKNOWN");
	});
});

describe("Admin.getFields()", () => {
	it("should return all field definitions", () => {
		const state: AdminState = {
			...createEmptyState(),
			fields: {
				text: createTextField(),
				email: createEmailField(),
			},
		};

		const admin = Admin.normalize(state);
		const fields = admin.getFields();

		expect(fields.text).toBeDefined();
		expect(fields.email).toBeDefined();
	});

	it("should return empty object when no fields", () => {
		const admin = Admin.normalize(createEmptyState());
		const fields = admin.getFields();

		expect(fields).toEqual({});
	});
});

describe("Admin.getField()", () => {
	it("should return specific field definition", () => {
		const textField = createTextField();
		const state: AdminState = {
			...createEmptyState(),
			fields: { text: textField },
		};

		const admin = Admin.normalize(state);
		const field = admin.getField("text");

		expect(field).toBe(textField);
	});

	it("should return undefined for non-existent field", () => {
		const admin = Admin.normalize(createEmptyState());
		const field = admin.getField("nonexistent");

		expect(field).toBeUndefined();
	});
});

describe("Admin.getWidgets()", () => {
	it("should return all widget definitions", () => {
		const state: AdminState = {
			...createEmptyState(),
			widgets: { stats: createStatsWidget() },
		};

		const admin = Admin.normalize(state);
		const widgets = admin.getWidgets();

		expect(widgets.stats).toBeDefined();
	});

	it("should return empty object when no widgets", () => {
		const admin = Admin.normalize(createEmptyState());
		const widgets = admin.getWidgets();

		expect(widgets).toEqual({});
	});
});

describe("Admin - Complete State", () => {
	it("should work with complete admin configuration", () => {
		const state = createTestModuleState();

		const admin = Admin.normalize(state);

		expect(Object.keys(admin.getFields())).toHaveLength(6);
		expect(Object.keys(admin.getViews())).toHaveLength(2);
		expect(Object.keys(admin.getViewsByKind("list"))).toHaveLength(1);
		expect(Object.keys(admin.getViewsByKind("form"))).toHaveLength(1);
		expect(Object.keys(admin.getWidgets())).toHaveLength(1);
		expect(Object.keys(admin.getPages())).toHaveLength(1);
		expect(admin.getDefaultLocale()).toBe("en");
		expect(admin.getAvailableLocales()).toEqual(["en"]);
	});
});
