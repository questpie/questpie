/**
 * View Builder Tests
 *
 * Tests for listView(), editView(), ListViewBuilder, and EditViewBuilder.
 */

import { describe, expect, it } from "bun:test";
import {
  EditViewBuilder,
  type EditViewDefinition,
  editView,
  ListViewBuilder,
  type ListViewDefinition,
  listView,
} from "#questpie/admin/client/builder/view/view";
import {
  createFormView,
  createTableView,
  MockFormView,
  MockTableView,
} from "../utils/helpers";

describe("listView() factory", () => {
  it("should create a ListViewBuilder with the given name", () => {
    const tableView = listView("table", { component: MockTableView });

    expect(tableView).toBeInstanceOf(ListViewBuilder);
    expect(tableView.name).toBe("table");
  });

  it("should set kind to 'list'", () => {
    const tableView = listView("table", { component: MockTableView });

    expect(tableView.kind).toBe("list");
  });

  it("should set the component correctly", () => {
    const tableView = listView("table", { component: MockTableView });

    expect(tableView.component).toBe(MockTableView);
  });

  it("should initialize with empty config", () => {
    const tableView = listView("table", { component: MockTableView });

    expect(tableView["~config"]).toEqual({});
  });
});

describe("editView() factory", () => {
  it("should create an EditViewBuilder with the given name", () => {
    const formView = editView("form", { component: MockFormView });

    expect(formView).toBeInstanceOf(EditViewBuilder);
    expect(formView.name).toBe("form");
  });

  it("should set kind to 'edit'", () => {
    const formView = editView("form", { component: MockFormView });

    expect(formView.kind).toBe("edit");
  });

  it("should set the component correctly", () => {
    const formView = editView("form", { component: MockFormView });

    expect(formView.component).toBe(MockFormView);
  });

  it("should initialize with empty config", () => {
    const formView = editView("form", { component: MockFormView });

    expect(formView["~config"]).toEqual({});
  });
});

describe("ListViewBuilder", () => {
  describe("getters (ListViewDefinition interface)", () => {
    it("should expose name via getter", () => {
      const builder = new ListViewBuilder({
        name: "table",
        kind: "list",
        "~config": {},
        component: MockTableView,
      });

      expect(builder.name).toBe("table");
    });

    it("should expose kind as 'list' via getter", () => {
      const builder = new ListViewBuilder({
        name: "table",
        kind: "list",
        "~config": {},
        component: MockTableView,
      });

      expect(builder.kind).toBe("list");
    });

    it("should expose ~config via getter", () => {
      const builder = new ListViewBuilder({
        name: "table",
        kind: "list",
        "~config": { columns: ["name"] },
        component: MockTableView,
      });

      expect(builder["~config"]).toEqual({ columns: ["name"] });
    });

    it("should expose component via getter", () => {
      const builder = new ListViewBuilder({
        name: "table",
        kind: "list",
        "~config": {},
        component: MockTableView,
      });

      expect(builder.component).toBe(MockTableView);
    });
  });

  describe(".$config()", () => {
    it("should return new builder with updated config", () => {
      const original = listView("table", { component: MockTableView });
      const updated = original.$config({ columns: ["name", "email"] });

      expect(updated["~config"]).toEqual({ columns: ["name", "email"] });
    });

    it("should not mutate original builder", () => {
      const original = listView("table", { component: MockTableView });
      const originalConfig = original["~config"];

      original.$config({ columns: ["name"] });

      expect(original["~config"]).toEqual(originalConfig);
    });

    it("should preserve other state properties", () => {
      const original = listView("table", { component: MockTableView });
      const updated = original.$config({ columns: ["name"] });

      expect(updated.name).toBe("table");
      expect(updated.kind).toBe("list");
      expect(updated.component).toBe(MockTableView);
    });

    it("should completely replace config", () => {
      const original = listView("table", { component: MockTableView }).$config({
        columns: ["name"],
      });
      const updated = original.$config({ searchable: true });

      expect(updated["~config"]).toEqual({ searchable: true });
      expect((updated["~config"] as any).columns).toBeUndefined();
    });
  });

  describe("state property", () => {
    it("should expose readonly state", () => {
      const builder = listView("table", { component: MockTableView });

      expect(builder.state).toBeDefined();
      expect(builder.state.name).toBe("table");
      expect(builder.state.kind).toBe("list");
    });
  });
});

describe("EditViewBuilder", () => {
  describe("getters (EditViewDefinition interface)", () => {
    it("should expose name via getter", () => {
      const builder = new EditViewBuilder({
        name: "form",
        kind: "edit",
        "~config": {},
        component: MockFormView,
      });

      expect(builder.name).toBe("form");
    });

    it("should expose kind as 'edit' via getter", () => {
      const builder = new EditViewBuilder({
        name: "form",
        kind: "edit",
        "~config": {},
        component: MockFormView,
      });

      expect(builder.kind).toBe("edit");
    });

    it("should expose ~config via getter", () => {
      const builder = new EditViewBuilder({
        name: "form",
        kind: "edit",
        "~config": { sections: [] },
        component: MockFormView,
      });

      expect(builder["~config"]).toEqual({ sections: [] });
    });

    it("should expose component via getter", () => {
      const builder = new EditViewBuilder({
        name: "form",
        kind: "edit",
        "~config": {},
        component: MockFormView,
      });

      expect(builder.component).toBe(MockFormView);
    });
  });

  describe(".$config()", () => {
    it("should return new builder with updated config", () => {
      const original = editView("form", { component: MockFormView });
      const updated = original.$config({ sections: [{ title: "Main" }] });

      expect(updated["~config"]).toEqual({ sections: [{ title: "Main" }] });
    });

    it("should not mutate original builder", () => {
      const original = editView("form", { component: MockFormView });
      const originalConfig = original["~config"];

      original.$config({ sections: [] });

      expect(original["~config"]).toEqual(originalConfig);
    });

    it("should preserve other state properties", () => {
      const original = editView("form", { component: MockFormView });
      const updated = original.$config({ sections: [] });

      expect(updated.name).toBe("form");
      expect(updated.kind).toBe("edit");
      expect(updated.component).toBe(MockFormView);
    });
  });

  describe("state property", () => {
    it("should expose readonly state", () => {
      const builder = editView("form", { component: MockFormView });

      expect(builder.state).toBeDefined();
      expect(builder.state.name).toBe("form");
      expect(builder.state.kind).toBe("edit");
    });
  });
});

describe("View builders implement definitions", () => {
  it("ListViewBuilder should satisfy ListViewDefinition interface", () => {
    const builder = createTableView();

    // Builder should have all ListViewDefinition properties
    const def: ListViewDefinition = builder;

    expect(def.name).toBe("table");
    expect(def.kind).toBe("list");
    expect(def["~config"]).toBeDefined();
    expect(def.component).toBeDefined();
  });

  it("EditViewBuilder should satisfy EditViewDefinition interface", () => {
    const builder = createFormView();

    // Builder should have all EditViewDefinition properties
    const def: EditViewDefinition = builder;

    expect(def.name).toBe("form");
    expect(def.kind).toBe("edit");
    expect(def["~config"]).toBeDefined();
    expect(def.component).toBeDefined();
  });
});

describe("View kind discrimination", () => {
  it("should correctly identify list views by kind", () => {
    const table = createTableView();
    const form = createFormView();

    expect(table.kind).toBe("list");
    expect(form.kind).not.toBe("list");
  });

  it("should correctly identify edit views by kind", () => {
    const table = createTableView();
    const form = createFormView();

    expect(form.kind).toBe("edit");
    expect(table.kind).not.toBe("edit");
  });

  it("should filter list views by kind property", () => {
    const views = {
      table: createTableView(),
      form: createFormView(),
      grid: listView("grid", { component: MockTableView }),
    };

    const listViews = Object.entries(views)
      .filter(([_, v]) => v.kind === "list")
      .map(([name]) => name);

    expect(listViews).toEqual(["table", "grid"]);
  });

  it("should filter edit views by kind property", () => {
    const views = {
      table: createTableView(),
      form: createFormView(),
      wizard: editView("wizard", { component: MockFormView }),
    };

    const editViews = Object.entries(views)
      .filter(([_, v]) => v.kind === "edit")
      .map(([name]) => name);

    expect(editViews).toEqual(["form", "wizard"]);
  });
});

describe("View builder immutability", () => {
  it("should create new instances on list view mutations", () => {
    const original = listView("table", { component: MockTableView });
    const withConfig = original.$config({ columns: ["name"] });

    expect(original).not.toBe(withConfig);
  });

  it("should create new instances on edit view mutations", () => {
    const original = editView("form", { component: MockFormView });
    const withConfig = original.$config({ sections: [] });

    expect(original).not.toBe(withConfig);
  });

  it("should allow method chaining on list view", () => {
    const final = listView("table", { component: MockTableView })
      .$config({ columns: ["name"] })
      .$config({ searchable: true });

    expect(final.name).toBe("table");
    expect(final["~config"]).toEqual({ searchable: true });
  });

  it("should allow method chaining on edit view", () => {
    const final = editView("form", { component: MockFormView })
      .$config({ sections: [] })
      .$config({ tabs: [] });

    expect(final.name).toBe("form");
    expect(final["~config"]).toEqual({ tabs: [] });
  });
});

describe("View builder with lazy components", () => {
  it("should handle lazy components for list views", () => {
    const LazyComponent = () => Promise.resolve({ default: MockTableView });
    const view = listView("lazy-table", { component: LazyComponent as any });

    expect(view.name).toBe("lazy-table");
    expect(view.kind).toBe("list");
  });

  it("should handle lazy components for edit views", () => {
    const LazyComponent = () => Promise.resolve({ default: MockFormView });
    const view = editView("lazy-form", { component: LazyComponent as any });

    expect(view.name).toBe("lazy-form");
    expect(view.kind).toBe("edit");
  });
});

describe("Custom view type extraction", () => {
  // Simulate a custom Kanban view component
  interface KanbanViewConfig {
    groupByField: string;
    cardTitle?: string;
    columns?: string[];
  }

  interface KanbanViewProps {
    collection: string;
    viewConfig?: KanbanViewConfig;
    navigate: (path: string) => void;
  }

  const KanbanView: React.FC<KanbanViewProps> = () => null;

  it("should extract viewConfig type from component props", () => {
    const kanbanView = listView("kanban", { component: KanbanView });

    expect(kanbanView.name).toBe("kanban");
    expect(kanbanView.kind).toBe("list");

    // Type test: config should be typed as KanbanViewConfig
  });

  it("should allow setting typed config via $config", () => {
    const kanbanView = listView("kanban", {
      component: KanbanView,
    }).$config<KanbanViewConfig>({ groupByField: "status" });

    expect(kanbanView["~config"]).toEqual({ groupByField: "status" });

    // Type should be preserved
  });

  it("should work with components without viewConfig prop", () => {
    // Component without viewConfig
    const SimpleView: React.FC<{ collection: string }> = () => null;
    const simpleView = listView("simple", { component: SimpleView });

    expect(simpleView.name).toBe("simple");
    // Config type should be unknown when not extractable
  });
});
