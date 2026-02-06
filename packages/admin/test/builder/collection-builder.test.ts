/**
 * Collection Builder Tests
 *
 * Tests for CollectionBuilder class and collection() factory.
 */

import { describe, expect, it } from "bun:test";
import { AdminBuilder } from "#questpie/admin/client/builder/admin-builder";
import { collection } from "#questpie/admin/client/builder/collection/collection";
import { CollectionBuilder } from "#questpie/admin/client/builder/collection/collection-builder";
import { editView, listView } from "#questpie/admin/client/builder/view/view";
import { createEmailField, createTextField, MockIcon } from "../utils/helpers";

describe("collection() factory", () => {
  it("should create a CollectionBuilder with the given name", () => {
    const posts = collection("posts");

    expect(posts).toBeInstanceOf(CollectionBuilder);
    expect(posts.state.name).toBe("posts");
  });

  it("should initialize with undefined ~adminApp", () => {
    const posts = collection("posts");

    expect(posts.state["~adminApp"]).toBeUndefined();
  });

  it("should allow any string as collection name", () => {
    const camelCase = collection("myCollection");
    const kebabCase = collection("my-collection");
    const snakeCase = collection("my_collection");

    expect(camelCase.state.name).toBe("myCollection");
    expect(kebabCase.state.name).toBe("my-collection");
    expect(snakeCase.state.name).toBe("my_collection");
  });
});

describe("CollectionBuilder.use()", () => {
  it("should bind admin module to collection", () => {
    const adminModule = AdminBuilder.empty().fields({
      text: createTextField(),
    });

    const posts = collection("posts").use(adminModule);

    expect(posts.state["~adminApp"]).toBe(adminModule);
  });

  it("should return new builder instance", () => {
    const adminModule = AdminBuilder.empty();
    const original = collection("posts");
    const withModule = original.use(adminModule);

    expect(original).not.toBe(withModule);
  });

  it("should not mutate original builder", () => {
    const adminModule = AdminBuilder.empty();
    const original = collection("posts");

    original.use(adminModule);

    expect(original.state["~adminApp"]).toBeUndefined();
  });

  it("should allow replacing admin module", () => {
    const module1 = AdminBuilder.empty().fields({ text: createTextField() });
    const module2 = AdminBuilder.empty().fields({ email: createEmailField() });

    const posts = collection("posts").use(module1).use(module2);

    expect(posts.state["~adminApp"]).toBe(module2);
  });
});

describe("CollectionBuilder.meta()", () => {
  it("should set label", () => {
    const posts = collection("posts").meta({ label: "Blog Posts" });

    expect(posts.state.label).toBe("Blog Posts");
  });

  it("should set icon", () => {
    const posts = collection("posts").meta({ icon: MockIcon });

    expect(posts.state.icon).toBe(MockIcon);
  });

  it("should set description", () => {
    const posts = collection("posts").meta({
      description: "Manage blog posts",
    });

    expect(posts.state.description).toBe("Manage blog posts");
  });

  it("should set multiple metadata at once", () => {
    const posts = collection("posts").meta({
      label: "Blog Posts",
      icon: MockIcon,
      description: "Manage blog posts",
    });

    expect(posts.state.label).toBe("Blog Posts");
    expect(posts.state.icon).toBe(MockIcon);
    expect(posts.state.description).toBe("Manage blog posts");
  });

  it("should return new builder instance", () => {
    const original = collection("posts");
    const withMeta = original.meta({ label: "Posts" });

    expect(original).not.toBe(withMeta);
  });

  it("should not mutate original builder", () => {
    const original = collection("posts");

    original.meta({ label: "Posts" });

    expect(original.state.label).toBeUndefined();
  });

  it("should preserve existing state", () => {
    const posts = collection("posts")
      .meta({ label: "Posts" })
      .meta({ description: "Blog posts" });

    expect(posts.state.label).toBe("Posts");
    expect(posts.state.description).toBe("Blog posts");
  });
});

describe("CollectionBuilder.state", () => {
  it("should expose readonly state", () => {
    const posts = collection("posts").meta({ label: "Blog Posts" });

    expect(posts.state).toBeDefined();
    expect(posts.state.name).toBe("posts");
    expect(posts.state.label).toBe("Blog Posts");
  });
});

describe("CollectionBuilder immutability", () => {
  it("should create new instance on every method call", () => {
    const adminModule = AdminBuilder.empty().fields({
      text: createTextField(),
    });

    const a = collection("posts");
    const b = a.use(adminModule);
    const c = b.meta({ label: "Posts" });

    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });
});

describe("Custom view extensibility", () => {
  // Simulating a custom Kanban view
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

  it("should allow registering custom list views", () => {
    // 1. Create the custom view definition
    const kanbanView = listView("kanban", { component: KanbanView });

    // 2. Register it in a module
    const adminModule = AdminBuilder.empty()
      .fields({ text: createTextField() })
      .views({ kanban: kanbanView });

    expect(adminModule.state.listViews.kanban).toBeDefined();
    expect(adminModule.state.listViews.kanban.name).toBe("kanban");
    expect(adminModule.state.listViews.kanban.kind).toBe("list");
  });

  it("should allow multiple custom views", () => {
    // Multiple custom views
    const kanbanView = listView("kanban", { component: KanbanView });

    interface CalendarViewConfig {
      dateField: string;
      titleField: string;
    }
    const CalendarView: React.FC<{ viewConfig?: CalendarViewConfig }> = () =>
      null;
    const calendarView = listView("calendar", { component: CalendarView });

    interface WizardFormConfig {
      steps: { id: string; fields: string[] }[];
    }
    const WizardForm: React.FC<{ viewConfig?: WizardFormConfig }> = () => null;
    const wizardView = editView("wizard", { component: WizardForm });

    const adminModule = AdminBuilder.empty()
      .fields({ text: createTextField() })
      .views({
        kanban: kanbanView,
        calendar: calendarView,
        wizard: wizardView,
      });

    // Verify all views are registered
    expect(Object.keys(adminModule.state.listViews)).toContain("kanban");
    expect(Object.keys(adminModule.state.listViews)).toContain("calendar");
    expect(Object.keys(adminModule.state.editViews)).toContain("wizard");
  });
});
