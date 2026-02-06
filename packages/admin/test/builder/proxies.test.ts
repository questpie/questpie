/**
 * Proxy Pattern Tests
 *
 * Tests for createFieldProxy, createFieldRegistryProxy, and createViewRegistryProxy.
 */

import { describe, it, expect } from "bun:test";
import {
  createFieldProxy,
  createFieldRegistryProxy,
  createViewRegistryProxy,
  type FieldProxy,
  type FieldRegistryProxy,
  type ViewRegistryProxy,
} from "#questpie/admin/client/builder/proxies";
import {
  createTextField,
  createTableView,
  createFormView,
} from "../utils/helpers";
import type { FieldDefinition } from "#questpie/admin/client/builder/field/field";
import type {
  ListViewDefinition,
  EditViewDefinition,
} from "#questpie/admin/client/builder/view/view";

describe("createFieldProxy", () => {
  it("should map field names to themselves", () => {
    const fields = {
      name: { name: "text" },
      email: { name: "email" },
      age: { name: "number" },
    };

    const proxy = createFieldProxy(fields);

    expect(proxy.name).toBe("name");
    expect(proxy.email).toBe("email");
    expect(proxy.age).toBe("age");
  });

  it("should return empty object for empty fields", () => {
    const proxy = createFieldProxy({});
    expect(Object.keys(proxy)).toHaveLength(0);
  });

  it("should only include keys from the input fields", () => {
    const fields = { title: {}, body: {} };
    const proxy = createFieldProxy(fields);

    expect(Object.keys(proxy)).toEqual(["title", "body"]);
    expect((proxy as any).nonexistent).toBeUndefined();
  });

  it("should preserve field key order", () => {
    const fields = {
      z: {},
      a: {},
      m: {},
    };

    const proxy = createFieldProxy(fields);
    expect(Object.keys(proxy)).toEqual(["z", "a", "m"]);
  });
});

describe("createFieldProxy - Type Safety", () => {});

describe("createFieldRegistryProxy", () => {
  it("should create callable methods for each field type", () => {
    const fields = {
      text: createTextField(),
    };

    const proxy = createFieldRegistryProxy(fields);

    expect(typeof proxy.text).toBe("function");
  });

  it("should return FieldDefinition when called without options", () => {
    const fields = {
      text: createTextField(),
    };

    const proxy = createFieldRegistryProxy(fields);
    const result = proxy.text();

    expect(result).toHaveProperty("name", "text");
    expect(result).toHaveProperty("field");
    expect(result).toHaveProperty("~options");
  });

  it("should merge options when called with options", () => {
    const fields = {
      text: createTextField(),
    };

    const proxy = createFieldRegistryProxy(fields);
    const result = proxy.text({ maxLength: 100 } as any);

    expect(result["~options"]).toEqual({ maxLength: 100 });
  });

  it("should preserve original field name (type)", () => {
    const fields = {
      text: createTextField(),
    };

    const proxy = createFieldRegistryProxy(fields);
    const result = proxy.text();

    expect(result.name).toBe("text");
  });

  it("should preserve field component", () => {
    const textField = createTextField();
    const fields = { text: textField };

    const proxy = createFieldRegistryProxy(fields);
    const result = proxy.text();

    expect(result.field).toBeDefined();
    expect(result.field.component).toBe(textField.field.component);
  });

  it("should preserve cell component if present", () => {
    const textField = createTextField();
    const fields = { text: textField };

    const proxy = createFieldRegistryProxy(fields);
    const result = proxy.text();

    expect(result.cell).toBeDefined();
    expect(result.cell?.component).toBe(textField.cell?.component);
  });

  it("should handle multiple field types", () => {
    const fields = {
      text: createTextField(),
      number: {
        name: "number",
        "~options": {},
        field: { component: () => null },
      },
    };

    const proxy = createFieldRegistryProxy(fields);

    const textResult = proxy.text();
    const numberResult = proxy.number();

    expect(textResult.name).toBe("text");
    expect(numberResult.name).toBe("number");
  });

  it("should create new object each call (no mutation)", () => {
    const fields = {
      text: createTextField(),
    };

    const proxy = createFieldRegistryProxy(fields);
    const result1 = proxy.text({ maxLength: 50 } as any);
    const result2 = proxy.text({ maxLength: 100 } as any);

    expect(result1["~options"]).toEqual({ maxLength: 50 });
    expect(result2["~options"]).toEqual({ maxLength: 100 });
    expect(result1).not.toBe(result2);
  });
});

describe("createViewRegistryProxy", () => {
  it("should create callable methods for each view type", () => {
    const views = {
      table: createTableView(),
      form: createFormView(),
    };

    const proxy = createViewRegistryProxy(views);

    expect(typeof proxy.table).toBe("function");
    expect(typeof proxy.form).toBe("function");
  });

  it("should return view definition when called with config", () => {
    const views = {
      table: createTableView(),
    };

    const proxy = createViewRegistryProxy(views);
    const result = proxy.table({ columns: ["name"] });

    // The proxy spreads the view builder, so it includes state property
    // and merges ~config
    expect(result["~config"]).toEqual({ columns: ["name"] });
    expect(result.state).toBeDefined();
  });

  it("should preserve view kind via state property", () => {
    const views = {
      table: createTableView(),
      form: createFormView(),
    };

    const proxy = createViewRegistryProxy(views);

    const tableResult = proxy.table({});
    const formResult = proxy.form({});

    // Access kind through the state (since getters aren't spread)
    expect(tableResult.state.kind).toBe("list");
    expect(formResult.state.kind).toBe("edit");
  });

  it("should merge config with existing ~config", () => {
    const tableView = createTableView().$config({ defaultSort: "asc" });
    const views = { table: tableView };

    const proxy = createViewRegistryProxy(views);
    const result = proxy.table({ columns: ["name"] });

    expect(result["~config"]).toEqual({
      defaultSort: "asc",
      columns: ["name"],
    });
  });

  it("should preserve view state", () => {
    const tableView = createTableView();
    const views = { table: tableView };

    const proxy = createViewRegistryProxy(views);
    const result = proxy.table({});

    // The component is in state
    expect(result.state.component).toBe(tableView.component);
  });
});

describe("Proxy Integration", () => {
  it("should work together in a realistic scenario", () => {
    // Simulate how proxies are used in CollectionBuilder
    const fields = {
      text: createTextField(),
    };

    const views = {
      table: createTableView(),
      form: createFormView(),
    };

    // 1. Define collection fields using registry proxy
    const registryProxy = createFieldRegistryProxy(fields);
    const collectionFields = {
      name: registryProxy.text({ maxLength: 200 } as any),
      email: registryProxy.text({ maxLength: 100 } as any),
    };

    // 2. Create field proxy for use in list/form config
    const fieldProxy = createFieldProxy(collectionFields);

    // 3. Use field proxy in list config
    const listConfig = {
      columns: [fieldProxy.name, fieldProxy.email],
    };

    // Verify the chain works
    expect(collectionFields.name.name).toBe("text");
    expect(collectionFields.name["~options"]).toEqual({ maxLength: 200 });
    expect(listConfig.columns).toEqual(["name", "email"]);
  });
});
