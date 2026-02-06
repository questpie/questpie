/**
 * QA Factory/Namespace Tests
 *
 * Tests for the qa namespace - the main entry point for admin builder API.
 */

import { describe, it, expect } from "bun:test";
import { qa } from "#questpie/admin/client/builder/qa";
import { AdminBuilder } from "#questpie/admin/client/builder/admin-builder";
import { FieldBuilder } from "#questpie/admin/client/builder/field/field";
import {
  ListViewBuilder,
  EditViewBuilder,
} from "#questpie/admin/client/builder/view/view";
import { WidgetBuilder } from "#questpie/admin/client/builder/widget/widget";
import { PageBuilder } from "#questpie/admin/client/builder/page/page";
import { CollectionBuilder } from "#questpie/admin/client/builder/collection/collection-builder";
import { GlobalBuilder } from "#questpie/admin/client/builder/global/global-builder";
import {
  createTextField,
  createEmailField,
  createTableView,
  createFormView,
  MockTextField,
  MockTextCell,
  MockTableView,
  MockFormView,
  MockStatsWidget,
  MockDashboardPage,
} from "../utils/helpers";

describe("qa() factory", () => {
  it("should return empty AdminBuilder", () => {
    const admin = qa();

    expect(admin).toBeInstanceOf(AdminBuilder);
  });

  it("should create builder with empty initial state", () => {
    const admin = qa();

    expect(admin.state.fields).toEqual({});
    expect(admin.state.listViews).toEqual({});
    expect(admin.state.editViews).toEqual({});
  });

  it("should accept TApp generic parameter", () => {
    type MockCMS = { collections: { posts: any } };
    const admin = qa<MockCMS>();

    expect(admin).toBeInstanceOf(AdminBuilder);
    // Type-level: ~app should be MockCMS
  });

  it("should be callable multiple times for independent builders", () => {
    const admin1 = qa();
    const admin2 = qa();

    expect(admin1).not.toBe(admin2);
  });
});

describe("qa.field()", () => {
  it("should create FieldBuilder", () => {
    const textField = qa.field("text", { component: MockTextField });

    expect(textField).toBeInstanceOf(FieldBuilder);
  });

  it("should set field name", () => {
    const textField = qa.field("text", { component: MockTextField });

    expect(textField.name).toBe("text");
  });

  it("should set field component", () => {
    const textField = qa.field("text", { component: MockTextField });

    expect(textField.field.component).toBe(MockTextField);
  });

  it("should accept cell component", () => {
    const textField = qa.field("text", {
      component: MockTextField,
      cell: MockTextCell,
    });

    expect(textField.cell?.component).toBe(MockTextCell);
  });

  it("should accept config type", () => {
    type TextConfig = { maxLength?: number };
    const textField = qa.field("text", {
      component: MockTextField,
      config: {} as TextConfig,
    });

    expect(textField.name).toBe("text");
  });
});

describe("qa.listView()", () => {
  it("should create ListViewBuilder", () => {
    const tableView = qa.listView("table", { component: MockTableView });

    expect(tableView).toBeInstanceOf(ListViewBuilder);
  });

  it("should set view name and kind", () => {
    const tableView = qa.listView("table", { component: MockTableView });

    expect(tableView.name).toBe("table");
    expect(tableView.kind).toBe("list");
  });

  it("should set view component", () => {
    const tableView = qa.listView("table", { component: MockTableView });

    expect(tableView.component).toBe(MockTableView);
  });
});

describe("qa.editView()", () => {
  it("should create EditViewBuilder", () => {
    const formView = qa.editView("form", { component: MockFormView });

    expect(formView).toBeInstanceOf(EditViewBuilder);
  });

  it("should set view name and kind", () => {
    const formView = qa.editView("form", { component: MockFormView });

    expect(formView.name).toBe("form");
    expect(formView.kind).toBe("edit");
  });

  it("should set view component", () => {
    const formView = qa.editView("form", { component: MockFormView });

    expect(formView.component).toBe(MockFormView);
  });
});

describe("qa.widget()", () => {
  it("should create WidgetBuilder", () => {
    const statsWidget = qa.widget("stats", { component: MockStatsWidget });

    expect(statsWidget).toBeInstanceOf(WidgetBuilder);
  });

  it("should set widget name", () => {
    const statsWidget = qa.widget("stats", { component: MockStatsWidget });

    expect(statsWidget.state.name).toBe("stats");
  });

  it("should set widget component", () => {
    const statsWidget = qa.widget("stats", { component: MockStatsWidget });

    expect(statsWidget.state.component).toBe(MockStatsWidget);
  });
});

describe("qa.page()", () => {
  it("should create PageBuilder", () => {
    const dashboardPage = qa.page("dashboard", {
      component: MockDashboardPage,
    });

    expect(dashboardPage).toBeInstanceOf(PageBuilder);
  });

  it("should set page name", () => {
    const dashboardPage = qa.page("dashboard", {
      component: MockDashboardPage,
    });

    expect(dashboardPage.state.name).toBe("dashboard");
  });

  it("should allow setting path", () => {
    const dashboardPage = qa
      .page("dashboard", { component: MockDashboardPage })
      .path("/dashboard");

    expect(dashboardPage.state.path).toBe("/dashboard");
  });
});

describe("qa.collection()", () => {
  it("should create CollectionBuilder", () => {
    const posts = qa.collection("posts");

    expect(posts).toBeInstanceOf(CollectionBuilder);
  });

  it("should set collection name", () => {
    const posts = qa.collection("posts");

    expect(posts.state.name).toBe("posts");
  });

  it("should initialize without admin module", () => {
    const posts = qa.collection("posts");

    expect(posts.state["~adminApp"]).toBeUndefined();
  });
});

describe("qa.global()", () => {
  it("should create GlobalBuilder", () => {
    const settings = qa.global("settings");

    expect(settings).toBeInstanceOf(GlobalBuilder);
  });

  it("should set global name", () => {
    const settings = qa.global("settings");

    expect(settings.state.name).toBe("settings");
  });

  it("should initialize without admin module", () => {
    const settings = qa.global("settings");

    expect(settings.state["~adminApp"]).toBeUndefined();
  });
});

describe("AdminBuilder.collection() / AdminBuilder.global()", () => {
  it("should create collection builder pre-bound to module", () => {
    const adminModule = qa().fields({ text: createTextField() });

    const posts = adminModule.collection("posts");

    expect(posts).toBeInstanceOf(CollectionBuilder);
    expect(posts.state.name).toBe("posts");
    expect(posts.state["~adminApp"]).toBe(adminModule);
  });

  it("should create global builder pre-bound to module", () => {
    const adminModule = qa().fields({ text: createTextField() });

    const settings = adminModule.global("settings");

    expect(settings).toBeInstanceOf(GlobalBuilder);
    expect(settings.state.name).toBe("settings");
    expect(settings.state["~adminApp"]).toBe(adminModule);
  });

  it("should allow chaining use() and meta() on collection", () => {
    const adminModule = qa().fields({
      text: createTextField(),
      email: createEmailField(),
    });

    const posts = adminModule.collection("posts").meta({ label: "Blog Posts" });

    expect(posts.state.name).toBe("posts");
    expect(posts.state.label).toBe("Blog Posts");
  });

  it("should allow chaining use() and meta() on global", () => {
    const adminModule = qa().fields({
      text: createTextField(),
      email: createEmailField(),
    });

    const settings = adminModule.global("settings").meta({ label: "Settings" });

    expect(settings.state.name).toBe("settings");
    expect(settings.state.label).toBe("Settings");
  });
});

describe("qa namespace - Complete Example", () => {
  it("should support full admin configuration flow", () => {
    // 1. Create admin builder with fields and views
    const builder = qa()
      .fields({
        text: qa.field("text", { component: MockTextField }),
        email: qa.field("email", { component: MockTextField }),
      })
      .views({
        table: qa.listView("table", { component: MockTableView }),
        form: qa.editView("form", { component: MockFormView }),
      })
      .widgets({
        stats: qa.widget("stats", { component: MockStatsWidget }),
      });

    // 2. Define collections using builder directly
    const posts = builder.collection("posts").meta({ label: "Blog Posts" });

    // 3. Define globals using builder directly
    const settings = builder
      .global("settings")
      .meta({ label: "Site Settings" });

    // Verify builder has all registries
    expect(builder.state.fields.text).toBeDefined();
    expect(builder.state.fields.email).toBeDefined();
    expect(builder.state.listViews.table).toBeDefined();
    expect(builder.state.editViews.form).toBeDefined();
    expect(builder.state.widgets.stats).toBeDefined();

    // Verify entity builders work
    expect(posts.state.name).toBe("posts");
    expect(posts.state.label).toBe("Blog Posts");
    expect(settings.state.name).toBe("settings");
    expect(settings.state.label).toBe("Site Settings");
  });
});

describe("qa namespace members", () => {
  it("should export all required members", () => {
    // Factory function
    expect(typeof qa).toBe("function");

    // Builder factories
    expect(typeof qa.field).toBe("function");
    expect(typeof qa.listView).toBe("function");
    expect(typeof qa.editView).toBe("function");
    expect(typeof qa.widget).toBe("function");
    expect(typeof qa.page).toBe("function");
    expect(typeof qa.collection).toBe("function");
    expect(typeof qa.global).toBe("function");
  });
});
