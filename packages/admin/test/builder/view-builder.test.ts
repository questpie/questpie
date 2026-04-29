/**
 * View Factory Tests
 *
 * Tests for view(), ViewDefinition, ListViewDefinition, FormViewDefinition.
 */

import { describe, expect, it } from "bun:test";

import {
	type FormViewDefinition,
	type ListViewDefinition,
	view,
	type ViewDefinition,
} from "#questpie/admin/client/builder/view/view";

import {
	createFormView,
	createTableView,
	MockFormView,
	MockTableView,
} from "../utils/helpers";

describe("view() factory", () => {
	it("should create a plain frozen object", () => {
		const v = view("table", {
			kind: "list",
			component: MockTableView,
		});

		expect(Object.isFrozen(v)).toBe(true);
	});

	it("should set name correctly", () => {
		const v = view("table", {
			kind: "list",
			component: MockTableView,
		});

		expect(v.name).toBe("table");
	});

	it("should set kind correctly", () => {
		const listV = view("table", { kind: "list", component: MockTableView });
		const formV = view("form", { kind: "form", component: MockFormView });

		expect(listV.kind).toBe("list");
		expect(formV.kind).toBe("form");
	});

	it("should set component correctly", () => {
		const v = view("form", {
			kind: "form",
			component: MockFormView,
		});

		expect(v.component).toBe(MockFormView);
	});

	it("should satisfy ViewDefinition interface", () => {
		const v = view("table", {
			kind: "list",
			component: MockTableView,
		});

		const def: ViewDefinition = v;
		expect(def.name).toBe("table");
		expect(def.kind).toBe("list");
	});

	it("should handle lazy components", () => {
		const LazyComponent = () => Promise.resolve({ default: MockTableView });
		const v = view("lazy-table", {
			kind: "list",
			component: LazyComponent as any,
		});

		expect(v.name).toBe("lazy-table");
		expect(v.kind).toBe("list");
	});
});

describe("ListViewDefinition type alias", () => {
	it("should accept view with kind 'list'", () => {
		const v = createTableView();
		const listView: ListViewDefinition = v;

		expect(listView.name).toBe("table");
		expect(listView.kind).toBe("list");
	});
});

describe("FormViewDefinition type alias", () => {
	it("should accept view with kind 'form'", () => {
		const v = createFormView();
		const formView: FormViewDefinition = v;

		expect(formView.name).toBe("form");
		expect(formView.kind).toBe("form");
	});
});

describe("View kind discrimination", () => {
	it("should correctly identify list views by kind", () => {
		const table = createTableView();
		const form = createFormView();

		expect(table.kind).toBe("list");
		expect(form.kind).not.toBe("list");
	});

	it("should correctly identify form views by kind", () => {
		const table = createTableView();
		const form = createFormView();

		expect(form.kind).toBe("form");
		expect(table.kind).not.toBe("form");
	});

	it("should filter list views by kind property", () => {
		const views = {
			table: createTableView(),
			form: createFormView(),
			grid: view("grid", { kind: "list", component: MockTableView }),
		};

		const listViews = Object.entries(views)
			.filter(([_, v]) => v.kind === "list")
			.map(([name]) => name);

		expect(listViews).toEqual(["table", "grid"]);
	});

	it("should filter form views by kind property", () => {
		const views = {
			table: createTableView(),
			form: createFormView(),
			wizard: view("wizard", { kind: "form", component: MockFormView }),
		};

		const formViews = Object.entries(views)
			.filter(([_, v]) => v.kind === "form")
			.map(([name]) => name);

		expect(formViews).toEqual(["form", "wizard"]);
	});
});

describe("View immutability", () => {
	it("should return frozen objects", () => {
		const v = view("table", { kind: "list", component: MockTableView });
		expect(Object.isFrozen(v)).toBe(true);
	});

	it("should not allow property mutation", () => {
		const v = view("table", { kind: "list", component: MockTableView });
		expect(() => {
			(v as any).name = "changed";
		}).toThrow();
	});
});
