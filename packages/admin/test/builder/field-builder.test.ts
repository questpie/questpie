/**
 * Field Factory Tests
 *
 * Tests for field(), configureField(), FieldDefinition, and FieldInstance.
 */

import { describe, expect, it } from "bun:test";

import {
	configureField,
	type FieldDefinition,
	type FieldInstance,
	field,
} from "#questpie/admin/client/builder/field/field";

import {
	createTextField,
	MockTextareaField,
	MockTextCell,
	MockTextField,
} from "../utils/helpers";

describe("field() factory", () => {
	it("should create a plain frozen object", () => {
		const textField = field("text", { component: MockTextField });

		expect(Object.isFrozen(textField)).toBe(true);
	});

	it("should set name correctly", () => {
		const textField = field("text", { component: MockTextField });

		expect(textField.name).toBe("text");
	});

	it("should set the component correctly", () => {
		const textField = field("text", { component: MockTextField });

		expect(textField.component).toBe(MockTextField);
	});

	it("should handle cell component when provided", () => {
		const textField = field("text", {
			component: MockTextField,
			cell: MockTextCell,
		});

		expect(textField.cell).toBe(MockTextCell);
	});

	it("should return undefined cell when not provided", () => {
		const textField = field("text", { component: MockTextField });

		expect(textField.cell).toBeUndefined();
	});

	it("should satisfy FieldDefinition interface", () => {
		const def: FieldDefinition = field("text", { component: MockTextField });

		expect(def.name).toBe("text");
		expect(def.component).toBeDefined();
	});

	it("should work with textarea field", () => {
		const textareaField = field("textarea", {
			component: MockTextareaField,
		});

		expect(textareaField.name).toBe("textarea");
	});

	it("should handle lazy components", () => {
		const LazyComponent = () => Promise.resolve({ default: MockTextField });
		const textField = field("text", {
			component: LazyComponent as any,
		});

		expect(textField.name).toBe("text");
	});

	it("should be usable as FieldDefinition in registry", () => {
		const fields: Record<string, FieldDefinition> = {
			text: createTextField(),
		};

		expect(fields.text.name).toBe("text");
	});
});

describe("configureField()", () => {
	it("should create a FieldInstance with options", () => {
		const base = field("text", { component: MockTextField });
		const instance = configureField(base, { maxLength: 100 });

		expect(instance.name).toBe("text");
		expect(instance.component).toBe(MockTextField);
		expect(instance["~options"]).toEqual({ maxLength: 100 });
	});

	it("should return a frozen object", () => {
		const base = field("text", { component: MockTextField });
		const instance = configureField(base, {});

		expect(Object.isFrozen(instance)).toBe(true);
	});

	it("should preserve cell from base field", () => {
		const base = field("text", {
			component: MockTextField,
			cell: MockTextCell,
		});
		const instance = configureField(base, { maxLength: 200 });

		expect(instance.cell).toBe(MockTextCell);
	});

	it("should not mutate the base field definition", () => {
		const base = field("text", { component: MockTextField });
		configureField(base, { maxLength: 100 });

		// Base should still be a plain FieldDefinition without ~options
		expect((base as any)["~options"]).toBeUndefined();
	});

	it("should create independent instances", () => {
		const base = field("text", { component: MockTextField });
		const instance1 = configureField(base, { maxLength: 50 });
		const instance2 = configureField(base, { maxLength: 100 });

		expect(instance1["~options"]).toEqual({ maxLength: 50 });
		expect(instance2["~options"]).toEqual({ maxLength: 100 });
		expect(instance1).not.toBe(instance2);
	});

	it("should satisfy FieldInstance interface", () => {
		const base = field("text", { component: MockTextField });
		const instance: FieldInstance = configureField(base, { required: true });

		expect(instance.name).toBe("text");
		expect(instance["~options"]).toEqual({ required: true });
	});
});
