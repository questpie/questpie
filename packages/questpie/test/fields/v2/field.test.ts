/**
 * Field V2 — Core Field Builder Tests
 *
 * Tests the immutable builder pattern and runtime behavior.
 */

import { describe, expect, it } from "bun:test";

import {
	integer,
	boolean as pgBoolean,
	text as pgText,
	varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import type {
	DefaultFieldState,
	FieldRuntimeState,
} from "#questpie/server/fields/field-class-types.js";
import { Field, field } from "#questpie/server/fields/field-class.js";
import {
	booleanOps,
	numberOps,
	stringOps,
} from "#questpie/server/fields/operators/builtin.js";
import { resolveContextualOperators } from "#questpie/server/fields/operators/resolve.js";
import { json } from "#questpie/server/modules/core/fields/json.js";

// ============================================================================
// Helper: Create a text field for testing
// ============================================================================

function createTestTextField(maxLength = 255) {
	return field<DefaultFieldState & { type: "text"; data: string }>({
		type: "text",
		columnFactory: (name) => varchar(name, { length: maxLength }),
		schemaFactory: () => z.string().max(maxLength),
		operatorSet: stringOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
		maxLength,
	});
}

function createTestNumberField() {
	return field<DefaultFieldState & { type: "number"; data: number }>({
		type: "number",
		columnFactory: (name) => integer(name),
		schemaFactory: () => z.number(),
		operatorSet: numberOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	});
}

// ============================================================================
// Tests
// ============================================================================

describe("Field V2 — Immutable Builder", () => {
	it("creates a basic field", () => {
		const f = createTestTextField();
		expect(f).toBeInstanceOf(Field);
		expect(f._state.type).toBe("text");
		expect(f._state.notNull).toBe(false);
		expect(f._state.hasDefault).toBe(false);
	});

	it("required() returns a new field with notNull: true", () => {
		const f = createTestTextField();
		const required = f.required();

		// Original unchanged
		expect(f._state.notNull).toBe(false);
		// New field is required
		expect(required._state.notNull).toBe(true);
		// Different instances
		expect(f).not.toBe(required);
	});

	it("default() returns a new field with hasDefault: true", () => {
		const f = createTestTextField();
		const withDefault = f.default("hello");

		expect(f._state.hasDefault).toBe(false);
		expect(withDefault._state.hasDefault).toBe(true);
		expect(withDefault._state.defaultValue).toBe("hello");
	});

	it("default() accepts factory functions", () => {
		const f = createTestTextField();
		const factory = () => "computed";
		const withDefault = f.default(factory);

		expect(withDefault._state.defaultValue).toBe(factory);
	});

	it("label() sets the label", () => {
		const f = createTestTextField();
		const labeled = f.label({ en: "Name" });

		expect(f._state.label).toBeUndefined();
		expect(labeled._state.label).toEqual({ en: "Name" });
	});

	it("description() sets the description", () => {
		const f = createTestTextField();
		const described = f.description({ en: "Enter your name" });

		expect(described._state.description).toEqual({ en: "Enter your name" });
	});

	it("localized() sets localized flag", () => {
		const f = createTestTextField();
		const loc = f.localized();

		expect(f._state.localized).toBe(false);
		expect(loc._state.localized).toBe(true);
	});

	it("inputFalse() excludes from input", () => {
		const f = createTestTextField();
		const noInput = f.inputFalse();

		expect(noInput._state.input).toBe(false);
	});

	it("inputOptional() makes input always optional", () => {
		const f = createTestTextField();
		const opt = f.inputOptional();

		expect(opt._state.input).toBe("optional");
	});

	it("outputFalse() excludes from output", () => {
		const f = createTestTextField();
		const noOutput = f.outputFalse();

		expect(noOutput._state.output).toBe(false);
	});

	it("virtual() marks field as virtual with no column", () => {
		const f = createTestTextField();
		const virt = f.virtual();

		expect(virt._state.virtual).toBe(true);
		expect(virt.toColumn("test")).toBeNull();
	});

	it("chaining works — each step returns a new immutable field", () => {
		const f = createTestTextField();
		const chained = f
			.required()
			.default("hello")
			.label({ en: "Name" })
			.localized();

		// Original unchanged
		expect(f._state.notNull).toBe(false);
		expect(f._state.hasDefault).toBe(false);

		// Chained has all properties
		expect(chained._state.notNull).toBe(true);
		expect(chained._state.hasDefault).toBe(true);
		expect(chained._state.label).toEqual({ en: "Name" });
		expect(chained._state.localized).toBe(true);
	});

	it("array() wraps field in array", () => {
		const f = createTestTextField();
		const arr = f.array();

		expect(arr._state.isArray).toBe(true);
		expect(arr._state.innerField).toBe(f);
	});

	it("minItems() and maxItems() set array constraints", () => {
		const f = createTestTextField();
		const arr = f.array().minItems(1).maxItems(10);

		expect(arr._state.minItems).toBe(1);
		expect(arr._state.maxItems).toBe(10);
	});

	it("hooks() sets field hooks", () => {
		const beforeChange = (value: any) => value;
		const f = createTestTextField().hooks({ beforeChange });

		expect(f._state.hooks?.beforeChange).toBe(beforeChange);
	});

	it("access() sets access control", () => {
		const f = createTestTextField().access({ read: true, create: true });

		expect(f._state.access).toEqual({ read: true, create: true });
	});

	it("zod() stores transform for schema modification", () => {
		const f = createTestTextField();
		const transform = (s: any) => s.regex(/^[a-z]+$/);
		const customized = f.zod(transform);

		expect(customized._state.zodTransform).toBe(transform);
	});

	it("fromDb/toDb store transforms", () => {
		const fromDb = (v: any) => String(v);
		const toDb = (v: any) => Number(v);

		const f = createTestTextField().fromDb(fromDb).toDb(toDb);

		expect(f._state.fromDbFn).toBe(fromDb);
		expect(f._state.toDbFn).toBe(toDb);
	});
});

describe("Field V2 — toColumn()", () => {
	it("generates a varchar column for text field", () => {
		const f = createTestTextField(255);
		const col = f.toColumn("title") as any;

		expect(col).toBeDefined();
		// Drizzle column builders store name in config
		expect(col.config?.name ?? col.name).toBeDefined();
	});

	it("applies notNull to column", () => {
		const f = createTestTextField().required();
		const col = f.toColumn("title") as any;

		// After .notNull() is called on the builder, the config has notNull
		expect(col.config?.notNull ?? col.isNotNull).toBe(true);
	});

	it("returns null for virtual fields", () => {
		const f = createTestTextField().virtual();
		expect(f.toColumn("title")).toBeNull();
	});
});

describe("Field V2 — toZodSchema()", () => {
	it("generates string schema for text field", () => {
		const f = createTestTextField();
		const schema = f.toZodSchema();

		// Should accept strings
		const result = schema.safeParse("hello");
		expect(result.success).toBe(true);

		// Should accept null (nullable by default)
		const nullResult = schema.safeParse(null);
		expect(nullResult.success).toBe(true);
	});

	it("required field schema rejects null", () => {
		const f = createTestTextField().required();
		const schema = f.toZodSchema();

		const result = schema.safeParse(null);
		expect(result.success).toBe(false);
	});

	it("array wraps schema in z.array()", () => {
		const f = createTestTextField().array();
		const schema = f.toZodSchema();

		const result = schema.safeParse(["a", "b"]);
		expect(result.success).toBe(true);

		const badResult = schema.safeParse("not-array");
		expect(badResult.success).toBe(false);
	});

	it("zod() transform is applied", () => {
		const f = createTestTextField().zod((s) => (s as any).regex(/^[a-z]+$/));
		const schema = f.toZodSchema();

		const good = schema.safeParse("abc");
		expect(good.success).toBe(true);

		const bad = schema.safeParse("ABC123");
		expect(bad.success).toBe(false);
	});
});

describe("Field V2 — getOperators()", () => {
	it("returns resolved contextual operators", () => {
		const f = createTestTextField();
		const ops = f.getOperators();

		expect(ops.column).toBeDefined();
		expect(ops.jsonb).toBeDefined();
		expect(typeof ops.column.eq).toBe("function");
		expect(typeof ops.jsonb.eq).toBe("function");
	});

	it("exposes ordered text comparisons in column and JSONB contexts", () => {
		const ops = createTestTextField().getOperators();

		for (const name of ["gt", "gte", "lt", "lte"] as const) {
			expect(typeof ops.column[name]).toBe("function");
			expect(typeof ops.jsonb[name]).toBe("function");
		}
	});

	it("tolerates field types without column operators", () => {
		const ops = resolveContextualOperators({
			column: undefined as any,
			jsonbCast: "text",
		});

		expect(ops.column).toEqual({});
		expect(ops.jsonb).toEqual({});
	});
});

describe("Field V2 — getMetadata()", () => {
	it("returns base metadata", () => {
		const f = createTestTextField()
			.required()
			.label({ en: "Name" })
			.description({ en: "The name" });

		const meta = f.getMetadata();
		expect(meta.type).toBe("text");
		expect(meta.required).toBe(true);
		expect(meta.label).toEqual({ en: "Name" });
		expect(meta.description).toEqual({ en: "The name" });
	});

	it("includes validation constraints", () => {
		const f = createTestTextField(100);
		const meta = f.getMetadata();

		expect(meta.validation?.maxLength).toBe(100);
	});
});

describe("Field — runtime accessors", () => {
	it("getType() and getLocation() return correct values", () => {
		const f = createTestTextField().required().localized();

		expect(f.getType()).toBe("text");
		expect(f.getLocation()).toBe("i18n"); // localized
		expect(f._state.notNull).toBe(true);
		expect(f._state.localized).toBe(true);
	});

	it("virtual fields have location 'virtual'", () => {
		const f = createTestTextField().virtual();
		expect(f.getLocation()).toBe("virtual");
	});
});

describe("Field V2 — $type() and typed zod()", () => {
	it("$type() is a runtime no-op (column and schema unchanged)", () => {
		const plain = json();
		const typed = json().$type<{ rows: number[] }>();

		// Column generation identical
		const plainCol = plain.toColumn("layout") as any;
		const typedCol = typed.toColumn("layout") as any;
		expect(typedCol.config?.dataType ?? typedCol.dataType).toEqual(
			plainCol.config?.dataType ?? plainCol.dataType,
		);

		// Schema behavior identical
		expect(typed.toZodSchema().safeParse({ rows: [1] }).success).toBe(true);
		expect(plain.toZodSchema().safeParse({ rows: [1] }).success).toBe(true);
	});

	it("zod() schema replacement applies at runtime", () => {
		const settings = json().zod(() =>
			z.object({ theme: z.enum(["light", "dark"]) }),
		);
		const schema = settings.toZodSchema();

		expect(schema.safeParse({ theme: "dark" }).success).toBe(true);
		expect(schema.safeParse({ theme: "blue" }).success).toBe(false);
		expect(schema.safeParse("nonsense").success).toBe(false);
	});

	it("$type() preserves builder chaining", () => {
		const f = createTestTextField().$type<"a" | "b">().required();
		expect(f._state.notNull).toBe(true);
		expect(f.toColumn("kind")).toBeDefined();
	});
});
