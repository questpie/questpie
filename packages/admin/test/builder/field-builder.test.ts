/**
 * Field Builder Tests
 *
 * Tests for field(), FieldBuilder, and FieldDefinition.
 */

import { describe, it, expect } from "bun:test";
import {
  field,
  FieldBuilder,
  type FieldDefinition,
} from "#questpie/admin/client/builder/field/field";
import {
  MockTextField,
  MockTextareaField,
  MockTextCell,
  createTextField,
} from "../utils/helpers";

describe("field() factory", () => {
  it("should create a FieldBuilder with the given name", () => {
    const textField = field("text", { component: MockTextField });

    expect(textField).toBeInstanceOf(FieldBuilder);
    expect(textField.name).toBe("text");
  });

  it("should set the component correctly", () => {
    const textField = field("text", { component: MockTextField });

    expect(textField.field.component).toBe(MockTextField);
  });

  it("should handle cell component when provided", () => {
    const textField = field("text", {
      component: MockTextField,
      cell: MockTextCell,
    });

    expect(textField.cell).toBeDefined();
    expect(textField.cell?.component).toBe(MockTextCell);
  });

  it("should return undefined cell when not provided", () => {
    const textField = field("text", { component: MockTextField });

    expect(textField.cell).toBeUndefined();
  });

  it("should initialize with empty options", () => {
    const textField = field("text", { component: MockTextField });

    expect(textField["~options"]).toEqual({});
  });

  it("should accept explicit config type", () => {
    type TextConfig = { maxLength?: number };
    const textField = field("text", {
      component: MockTextField,
      config: {} as TextConfig,
    });

    expect(textField.name).toBe("text");
  });
});

describe("FieldBuilder", () => {
  describe("getters (FieldDefinition interface)", () => {
    it("should expose name via getter", () => {
      const builder = new FieldBuilder({
        name: "myField",
        "~options": {},
        component: MockTextField,
        cellComponent: undefined,
      });

      expect(builder.name).toBe("myField");
    });

    it("should expose ~options via getter", () => {
      const builder = new FieldBuilder({
        name: "myField",
        "~options": { maxLength: 100 },
        component: MockTextField,
        cellComponent: undefined,
      });

      expect(builder["~options"]).toEqual({ maxLength: 100 });
    });

    it("should expose field via getter", () => {
      const builder = new FieldBuilder({
        name: "myField",
        "~options": {},
        component: MockTextField,
        cellComponent: undefined,
      });

      expect(builder.field).toEqual({ component: MockTextField });
    });

    it("should expose cell via getter when cellComponent exists", () => {
      const builder = new FieldBuilder({
        name: "myField",
        "~options": {},
        component: MockTextField,
        cellComponent: MockTextCell,
      });

      expect(builder.cell).toEqual({ component: MockTextCell });
    });

    it("should return undefined cell when cellComponent is undefined", () => {
      const builder = new FieldBuilder({
        name: "myField",
        "~options": {},
        component: MockTextField,
        cellComponent: undefined,
      });

      expect(builder.cell).toBeUndefined();
    });
  });

  describe(".$options()", () => {
    it("should return new builder with updated options", () => {
      const original = field("text", { component: MockTextField });
      const updated = original.$options({ maxLength: 200 });

      expect(updated["~options"]).toEqual({ maxLength: 200 });
    });

    it("should not mutate original builder", () => {
      const original = field("text", { component: MockTextField });
      const originalOptions = original["~options"];

      original.$options({ maxLength: 200 });

      expect(original["~options"]).toEqual(originalOptions);
    });

    it("should preserve other state properties", () => {
      const original = field("text", {
        component: MockTextField,
        cell: MockTextCell,
      });
      const updated = original.$options({ maxLength: 200 });

      expect(updated.name).toBe("text");
      expect(updated.field.component).toBe(MockTextField);
      expect(updated.cell?.component).toBe(MockTextCell);
    });

    it("should completely replace options", () => {
      const original = field("text", { component: MockTextField }).$options({
        maxLength: 100,
      });
      const updated = original.$options({ placeholder: "Enter text" });

      expect(updated["~options"]).toEqual({ placeholder: "Enter text" });
      expect((updated["~options"] as any).maxLength).toBeUndefined();
    });
  });

  describe(".withCell()", () => {
    it("should return new builder with cell component", () => {
      const original = field("text", { component: MockTextField });
      const withCell = original.withCell(MockTextCell);

      expect(withCell.cell).toBeDefined();
      expect(withCell.cell?.component).toBe(MockTextCell);
    });

    it("should not mutate original builder", () => {
      const original = field("text", { component: MockTextField });

      original.withCell(MockTextCell);

      expect(original.cell).toBeUndefined();
    });

    it("should preserve other state properties", () => {
      const original = field("text", { component: MockTextField }).$options({
        maxLength: 100,
      });
      const withCell = original.withCell(MockTextCell);

      expect(withCell.name).toBe("text");
      expect(withCell["~options"]).toEqual({ maxLength: 100 });
      expect(withCell.field.component).toBe(MockTextField);
    });

    it("should replace existing cell component", () => {
      const originalCell = () => null;
      const newCell = () => "new";

      const original = field("text", {
        component: MockTextField,
        cell: originalCell as any,
      });
      const updated = original.withCell(newCell as any);

      expect(updated.cell?.component).toBe(newCell);
    });
  });

  describe("state property", () => {
    it("should expose readonly state", () => {
      const builder = field("text", { component: MockTextField });

      expect(builder.state).toBeDefined();
      expect(builder.state.name).toBe("text");
    });
  });
});

describe("FieldBuilder implements FieldDefinition", () => {
  it("should satisfy FieldDefinition interface", () => {
    const builder = createTextField();

    // Builder should have all FieldDefinition properties
    const def: FieldDefinition = builder;

    expect(def.name).toBe("text");
    expect(def.field).toBeDefined();
    expect(def["~options"]).toBeDefined();
  });

  it("should be usable as FieldDefinition in registry", () => {
    const fields: Record<string, FieldDefinition> = {
      text: createTextField(),
    };

    expect(fields.text.name).toBe("text");
  });
});

describe("field() with different field types", () => {
  it("should work with textarea field", () => {
    const textareaField = field("textarea", {
      component: MockTextareaField,
      config: {} as { rows?: number },
    });

    expect(textareaField.name).toBe("textarea");
  });

  it("should work with complex field types", () => {
    type RelationConfig = {
      targetCollection: string;
      multiple?: boolean;
    };

    const relationField = field("relation", {
      component: MockTextField, // Using mock
      config: {} as RelationConfig,
    });

    expect(relationField.name).toBe("relation");
  });

  it("should handle lazy components", () => {
    const LazyComponent = () => Promise.resolve({ default: MockTextField });
    const textField = field("text", {
      component: LazyComponent as any,
    });

    expect(textField.name).toBe("text");
  });
});

describe("FieldBuilder immutability", () => {
  it("should create new instances on all mutations", () => {
    const original = field("text", { component: MockTextField });
    const withOptions = original.$options({ maxLength: 100 });
    const withCell = original.withCell(MockTextCell);

    expect(original).not.toBe(withOptions);
    expect(original).not.toBe(withCell);
    expect(withOptions).not.toBe(withCell);
  });

  it("should allow method chaining", () => {
    const final = field("text", { component: MockTextField })
      .$options({ maxLength: 100 })
      .withCell(MockTextCell);

    expect(final.name).toBe("text");
    expect(final["~options"]).toEqual({ maxLength: 100 });
    expect(final.cell?.component).toBe(MockTextCell);
  });
});
