/**
 * Module Merging Tests
 *
 * Tests for the .use() method across all builders and module composition.
 */

import { describe, it, expect } from "bun:test";
import { AdminBuilder } from "#questpie/admin/client/builder/admin-builder";
import {
  createTextField,
  createEmailField,
  createNumberField,
  createTableView,
  createFormView,
  createStatsWidget,
  createDashboardPage,
} from "../utils/helpers";
import { listView, editView } from "#questpie/admin/client/builder/view/view";
import { MockTableView, MockFormView } from "../utils/helpers";

describe("AdminBuilder.use() - Field Merging", () => {
  it("should merge fields from multiple modules (flat spread)", () => {
    const module1 = AdminBuilder.empty().fields({
      text: createTextField(),
    });

    const module2 = AdminBuilder.empty().fields({
      email: createEmailField(),
    });

    const combined = AdminBuilder.empty().use(module1).use(module2);

    expect(combined.state.fields.text).toBeDefined();
    expect(combined.state.fields.email).toBeDefined();
  });

  it("should overwrite fields with same key (last-wins)", () => {
    const field1 = createTextField().$options({ maxLength: 100 });
    const field2 = createTextField().$options({ maxLength: 200 });

    const module1 = AdminBuilder.empty().fields({ text: field1 });
    const module2 = AdminBuilder.empty().fields({ text: field2 });

    const combined = AdminBuilder.empty().use(module1).use(module2);

    expect(combined.state.fields.text["~options"]).toEqual({ maxLength: 200 });
  });

  it("should preserve existing fields when using empty module", () => {
    const base = AdminBuilder.empty().fields({
      text: createTextField(),
      email: createEmailField(),
    });

    const empty = AdminBuilder.empty();

    const combined = base.use(empty);

    expect(combined.state.fields.text).toBeDefined();
    expect(combined.state.fields.email).toBeDefined();
  });
});

describe("AdminBuilder.use() - View Merging", () => {
  it("should merge list views without overwriting", () => {
    const module1 = AdminBuilder.empty().views({
      table: createTableView(),
    });

    const module2 = AdminBuilder.empty().views({
      grid: listView("grid", { component: MockTableView }),
    });

    const combined = AdminBuilder.empty().use(module1).use(module2);

    expect(combined.state.listViews.table).toBeDefined();
    expect(combined.state.listViews.grid).toBeDefined();
  });

  it("should merge edit views without overwriting", () => {
    const module1 = AdminBuilder.empty().views({
      form: createFormView(),
    });

    const module2 = AdminBuilder.empty().views({
      wizard: editView("wizard", { component: MockFormView }),
    });

    const combined = AdminBuilder.empty().use(module1).use(module2);

    expect(combined.state.editViews.form).toBeDefined();
    expect(combined.state.editViews.wizard).toBeDefined();
  });

  it("should keep list and edit views separate during merge", () => {
    const module1 = AdminBuilder.empty().views({
      table: createTableView(),
      form: createFormView(),
    });

    const combined = AdminBuilder.empty().use(module1);

    expect(combined.state.listViews.table).toBeDefined();
    expect(combined.state.editViews.form).toBeDefined();
    expect((combined.state.listViews as any).form).toBeUndefined();
    expect((combined.state.editViews as any).table).toBeUndefined();
  });
});

describe("AdminBuilder.use() - Widget Merging", () => {
  it("should merge widgets correctly", () => {
    const module1 = AdminBuilder.empty().widgets({
      stats: createStatsWidget(),
    });

    const module2 = AdminBuilder.empty().widgets({
      chart: createStatsWidget(),
    });

    const combined = AdminBuilder.empty().use(module1).use(module2);

    expect(combined.state.widgets.stats).toBeDefined();
    expect(combined.state.widgets.chart).toBeDefined();
  });

  it("should overwrite widget with same key (last-wins)", () => {
    const widget1 = createStatsWidget().$config({ title: "Stats 1" });
    const widget2 = createStatsWidget().$config({ title: "Stats 2" });

    const module1 = AdminBuilder.empty().widgets({ stats: widget1 });
    const module2 = AdminBuilder.empty().widgets({ stats: widget2 });

    const combined = AdminBuilder.empty().use(module1).use(module2);

    // Widget builder stores config in state["~config"]
    expect(combined.state.widgets.stats.state["~config"]).toEqual({
      title: "Stats 2",
    });
  });
});

describe("AdminBuilder.use() - Page Merging", () => {
  it("should merge pages correctly", () => {
    const module1 = AdminBuilder.empty().pages({
      dashboard: createDashboardPage(),
    });

    const module2 = AdminBuilder.empty().pages({
      settings: createDashboardPage(),
    });

    const combined = AdminBuilder.empty().use(module1).use(module2);

    expect(combined.state.pages.dashboard).toBeDefined();
    expect(combined.state.pages.settings).toBeDefined();
  });
});

describe("AdminBuilder.use() - State Immutability", () => {
  it("should not mutate original builders after merge", () => {
    const module1 = AdminBuilder.empty().fields({
      text: createTextField(),
    });

    const module2 = AdminBuilder.empty().fields({
      email: createEmailField(),
    });

    const original1State = { ...module1.state.fields };
    const original2State = { ...module2.state.fields };

    AdminBuilder.empty().use(module1).use(module2);

    // Original modules should be unchanged
    expect(module1.state.fields).toEqual(original1State);
    expect(module2.state.fields).toEqual(original2State);
  });

  it("should create new builder instance after use", () => {
    const base = AdminBuilder.empty();
    const module = AdminBuilder.empty().fields({ text: createTextField() });

    const combined = base.use(module);

    expect(combined).not.toBe(base);
    expect(combined).not.toBe(module);
  });
});

describe("AdminBuilder.use() - Chained Calls", () => {
  it("should preserve order in chained .use() calls", () => {
    const module1 = AdminBuilder.empty().fields({
      text: createTextField().$options({ v: 1 }),
    });

    const module2 = AdminBuilder.empty().fields({
      text: createTextField().$options({ v: 2 }),
    });

    const module3 = AdminBuilder.empty().fields({
      text: createTextField().$options({ v: 3 }),
    });

    const combined = AdminBuilder.empty()
      .use(module1)
      .use(module2)
      .use(module3);

    // Fields: last-wins
    expect(combined.state.fields.text["~options"]).toEqual({ v: 3 });
  });

  it("should allow mixing .use() with other methods", () => {
    const coreModule = AdminBuilder.empty()
      .fields({ text: createTextField() })
      .views({ table: createTableView() });

    const admin = AdminBuilder.empty()
      .use(coreModule)
      .fields({ number: createNumberField() });

    expect(admin.state.fields.text).toBeDefined();
    expect(admin.state.fields.number).toBeDefined();
    expect(admin.state.listViews.table).toBeDefined();
  });
});

describe("Module Composition Patterns", () => {
  it("should support creating a core module with all basics", () => {
    const coreModule = AdminBuilder.empty()
      .fields({
        text: createTextField(),
        email: createEmailField(),
        number: createNumberField(),
      })
      .views({
        table: createTableView(),
        form: createFormView(),
      })
      .widgets({
        stats: createStatsWidget(),
      });

    const admin = AdminBuilder.empty().use(coreModule);

    expect(Object.keys(admin.state.fields)).toHaveLength(3);
    expect(Object.keys(admin.state.listViews)).toHaveLength(1);
    expect(Object.keys(admin.state.editViews)).toHaveLength(1);
    expect(Object.keys(admin.state.widgets)).toHaveLength(1);
  });

  it("should support creating extension modules", () => {
    const coreModule = AdminBuilder.empty().fields({
      text: createTextField(),
    });

    const blogExtension = AdminBuilder.empty().fields({
      richText: createTextField(),
    });

    const admin = AdminBuilder.empty().use(coreModule).use(blogExtension);

    expect(admin.state.fields.text).toBeDefined();
    expect(admin.state.fields.richText).toBeDefined();
  });

  it("should support feature flag pattern with conditional modules", () => {
    const coreModule = AdminBuilder.empty().fields({
      text: createTextField(),
    });

    const analyticsModule = AdminBuilder.empty().widgets({
      analytics: createStatsWidget(),
    });

    const enableAnalytics = true;

    let admin = AdminBuilder.empty().use(coreModule);
    if (enableAnalytics) {
      admin = admin.use(analyticsModule);
    }

    expect(admin.state.widgets.analytics).toBeDefined();
  });
});

describe("Complex Merge Scenarios", () => {
  it("should handle deeply nested module composition", () => {
    const fieldsModule = AdminBuilder.empty().fields({
      text: createTextField(),
    });

    const viewsModule = AdminBuilder.empty().views({
      table: createTableView(),
    });

    const combinedCore = AdminBuilder.empty()
      .use(fieldsModule)
      .use(viewsModule);

    const widgetsModule = AdminBuilder.empty().widgets({
      stats: createStatsWidget(),
    });

    const final = AdminBuilder.empty().use(combinedCore).use(widgetsModule);

    expect(final.state.fields.text).toBeDefined();
    expect(final.state.listViews.table).toBeDefined();
    expect(final.state.widgets.stats).toBeDefined();
  });

  it("should handle empty modules in chain", () => {
    const empty1 = AdminBuilder.empty();
    const empty2 = AdminBuilder.empty();
    const fieldsModule = AdminBuilder.empty().fields({
      text: createTextField(),
    });
    const empty3 = AdminBuilder.empty();

    const combined = AdminBuilder.empty()
      .use(empty1)
      .use(empty2)
      .use(fieldsModule)
      .use(empty3);

    expect(combined.state.fields.text).toBeDefined();
  });
});
