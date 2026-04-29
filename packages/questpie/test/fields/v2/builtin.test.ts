/**
 * Field V2 — Builtin Field Factory Tests
 *
 * Tests each factory function: column generation, schema validation,
 * operator resolution, and chain methods.
 */

import { describe, expect, it } from "bun:test";

import { z } from "zod";

// Import all factories — side effects patch Field.prototype
import {
	text,
	textarea,
	email,
	url,
	number,
	boolean,
	date,
	datetime,
	time,
	select,
	json,
	object,
	from,
} from "#questpie/server/modules/core/fields/index.js";
import { Field } from "#questpie/server/fields/field-class.js";

// ============================================================================
// Text
// ============================================================================

describe("text()", () => {
	it("creates a text field with default maxLength 255", () => {
		const f = text();
		expect(f).toBeInstanceOf(Field);
		expect(f._state.type).toBe("text");
		expect(f._state.maxLength).toBe(255);
	});

	it("accepts custom maxLength", () => {
		const f = text(100);
		expect(f._state.maxLength).toBe(100);
	});

	it("supports text mode (unlimited)", () => {
		const f = text({ mode: "text" });
		expect(f._state.maxLength).toBeUndefined();
	});

	it("generates valid column", () => {
		const col = text(255).toColumn("name") as any;
		expect(col).toBeDefined();
	});

	it("generates valid schema", () => {
		const schema = text(10).toZodSchema();
		expect(schema.safeParse("short").success).toBe(true);
		expect(schema.safeParse("this-is-way-too-long").success).toBe(false);
	});

	it(".pattern() applies regex", () => {
		const f = text().pattern(/^[a-z]+$/);
		expect(f._state.pattern?.source).toBe("^[a-z]+$");

		const schema = f.toZodSchema();
		expect(schema.safeParse("abc").success).toBe(true);
		expect(schema.safeParse("ABC123").success).toBe(false);
	});

	it(".trim() sets trim flag", () => {
		const f = text().trim();
		expect(f._state.trim).toBe(true);
	});

	it(".lowercase() sets lowercase flag", () => {
		const f = text().lowercase();
		expect(f._state.lowercase).toBe(true);
	});

	it(".uppercase() sets uppercase flag", () => {
		const f = text().uppercase();
		expect(f._state.uppercase).toBe(true);
	});
});

// ============================================================================
// Textarea
// ============================================================================

describe("textarea()", () => {
	it("creates a textarea field", () => {
		const f = textarea();
		expect(f._state.type).toBe("textarea");
	});

	it("generates valid schema (accepts any string)", () => {
		const schema = textarea().toZodSchema();
		expect(schema.safeParse("long text here...").success).toBe(true);
		expect(schema.safeParse(null).success).toBe(true); // nullable by default
	});
});

// ============================================================================
// Email
// ============================================================================

describe("email()", () => {
	it("creates an email field with default maxLength 255", () => {
		const f = email();
		expect(f._state.type).toBe("email");
		expect(f._state.maxLength).toBe(255);
	});

	it("generates schema that validates email format", () => {
		const schema = email().required().toZodSchema();
		expect(schema.safeParse("user@example.com").success).toBe(true);
		expect(schema.safeParse("not-an-email").success).toBe(false);
	});

	it("has email-specific operators (domain)", () => {
		const ops = email().getOperators();
		expect(ops.column.domain).toBeDefined();
		expect(ops.column.domainIn).toBeDefined();
	});
});

// ============================================================================
// URL
// ============================================================================

describe("url()", () => {
	it("creates a url field with default maxLength 2048", () => {
		const f = url();
		expect(f._state.type).toBe("url");
		expect(f._state.maxLength).toBe(2048);
	});

	it("generates schema that validates URL format", () => {
		const schema = url().required().toZodSchema();
		expect(schema.safeParse("https://example.com").success).toBe(true);
		expect(schema.safeParse("not-a-url").success).toBe(false);
	});

	it("has url-specific operators (host, protocol)", () => {
		const ops = url().getOperators();
		expect(ops.column.host).toBeDefined();
		expect(ops.column.hostIn).toBeDefined();
		expect(ops.column.protocol).toBeDefined();
	});
});

// ============================================================================
// Number
// ============================================================================

describe("number()", () => {
	it("creates an integer field by default", () => {
		const f = number();
		expect(f._state.type).toBe("number");
		expect(f._state.int).toBe(true);
	});

	it("supports different modes", () => {
		const sm = number("smallint");
		expect(sm._state.type).toBe("number");

		const dec = number({ mode: "decimal", precision: 10, scale: 2 });
		expect(dec._state.type).toBe("number");
	});

	it("generates valid column", () => {
		const col = number().toColumn("count") as any;
		expect(col).toBeDefined();
	});

	it(".min() and .max() set constraints", () => {
		const f = number().min(0).max(100);
		expect(f._state.min).toBe(0);
		expect(f._state.max).toBe(100);
	});

	it(".positive() sets positive constraint", () => {
		const f = number().positive();
		expect(f._state.positive).toBe(true);
	});

	it(".int() sets integer constraint", () => {
		const f = number("real").int();
		expect(f._state.int).toBe(true);
	});

	it(".step() sets step constraint", () => {
		const f = number().step(5);
		expect(f._state.step).toBe(5);
	});

	it("min/max work for text fields too (minLength/maxLength)", () => {
		const f = text().min(3).max(50);
		expect(f._state.minLength).toBe(3);
		expect(f._state.maxLength).toBe(50);
	});

	it("generates schema with int constraint", () => {
		const schema = number().required().toZodSchema();
		expect(schema.safeParse(42).success).toBe(true);
		expect(schema.safeParse(3.14).success).toBe(false); // integer by default
	});
});

// ============================================================================
// Boolean
// ============================================================================

describe("boolean()", () => {
	it("creates a boolean field", () => {
		const f = boolean();
		expect(f._state.type).toBe("boolean");
	});

	it("generates valid column", () => {
		const col = boolean().toColumn("active") as any;
		expect(col).toBeDefined();
	});

	it("generates schema that accepts true/false", () => {
		const schema = boolean().required().toZodSchema();
		expect(schema.safeParse(true).success).toBe(true);
		expect(schema.safeParse(false).success).toBe(true);
		expect(schema.safeParse("yes").success).toBe(false);
	});
});

// ============================================================================
// Date
// ============================================================================

describe("date()", () => {
	it("creates a date field", () => {
		const f = date();
		expect(f._state.type).toBe("date");
	});

	it("generates valid column", () => {
		const col = date().toColumn("birthday") as any;
		expect(col).toBeDefined();
	});

	it(".autoNow() sets default and hasDefault", () => {
		const f = date().autoNow();
		expect(f._state.hasDefault).toBe(true);
		expect(f._state.defaultValue).toBeTypeOf("function");
	});

	it(".autoNowUpdate() sets hooks", () => {
		const f = date().autoNowUpdate();
		expect(f._state.hooks?.beforeChange).toBeDefined();
	});
});

// ============================================================================
// Datetime
// ============================================================================

describe("datetime()", () => {
	it("creates a datetime field", () => {
		const f = datetime();
		expect(f._state.type).toBe("datetime");
	});

	it("accepts precision and timezone config", () => {
		const f = datetime({ precision: 6, withTimezone: false });
		expect(f._state.type).toBe("datetime");
	});

	it("generates valid column", () => {
		const col = datetime().toColumn("createdAt") as any;
		expect(col).toBeDefined();
	});

	it("generates schema that coerces dates", () => {
		const schema = datetime().required().toZodSchema();
		expect(schema.safeParse(new Date()).success).toBe(true);
		expect(schema.safeParse("2024-01-01T00:00:00Z").success).toBe(true);
	});
});

// ============================================================================
// Time
// ============================================================================

describe("time()", () => {
	it("creates a time field", () => {
		const f = time();
		expect(f._state.type).toBe("time");
	});

	it("generates valid column", () => {
		const col = time().toColumn("startTime") as any;
		expect(col).toBeDefined();
	});

	it("generates schema that validates time format", () => {
		const schema = time().required().toZodSchema();
		expect(schema.safeParse("14:30:00").success).toBe(true);
		expect(schema.safeParse("not-a-time").success).toBe(false);
	});

	it("without seconds mode validates HH:MM", () => {
		const schema = time({ withSeconds: false }).required().toZodSchema();
		expect(schema.safeParse("14:30").success).toBe(true);
		expect(schema.safeParse("14:30:00").success).toBe(false);
	});
});

// ============================================================================
// Select
// ============================================================================

describe("select()", () => {
	const options = [
		{ value: "draft", label: { en: "Draft" } },
		{ value: "published", label: { en: "Published" } },
		{ value: "archived", label: { en: "Archived" } },
	] as const;

	it("creates a select field", () => {
		const f = select(options);
		expect(f._state.type).toBe("select");
		expect(f._state.options).toBe(options);
	});

	it("generates valid column", () => {
		const col = select(options).toColumn("status") as any;
		expect(col).toBeDefined();
	});

	it("generates schema that validates against options", () => {
		const schema = select(options).required().toZodSchema();
		expect(schema.safeParse("draft").success).toBe(true);
		expect(schema.safeParse("invalid").success).toBe(false);
	});

	it(".array() creates multi-select", () => {
		const f = select(options).array();
		expect(f._state.isArray).toBe(true);

		const schema = f.toZodSchema();
		expect(schema.safeParse(["draft", "published"]).success).toBe(true);
	});

	it(".enum() sets enum config", () => {
		const f = select(options).enum("status_enum");
		expect(f._state.enumType).toBe(true);
		expect(f._state.enumName).toBe("status_enum");
	});

	it("getMetadata() returns select-specific metadata", () => {
		const meta = select(options).getMetadata() as any;
		expect(meta.type).toBe("select");
		expect(meta.options).toHaveLength(3);
		expect(meta.options[0].value).toBe("draft");
	});
});

// ============================================================================
// JSON
// ============================================================================

describe("json()", () => {
	it("creates a json field", () => {
		const f = json();
		expect(f._state.type).toBe("json");
	});

	it("generates valid column", () => {
		const col = json().toColumn("metadata") as any;
		expect(col).toBeDefined();
	});

	it("generates schema that accepts any JSON", () => {
		const schema = json().toZodSchema();
		expect(schema.safeParse({ foo: "bar" }).success).toBe(true);
		expect(schema.safeParse([1, 2, 3]).success).toBe(true);
		expect(schema.safeParse("string").success).toBe(true);
		expect(schema.safeParse(42).success).toBe(true);
	});
});

// ============================================================================
// Object
// ============================================================================

describe("object()", () => {
	it("creates an object field with nested fields", () => {
		const f = object({
			street: text().required(),
			city: text().required(),
		});
		expect(f._state.type).toBe("object");
		expect(f._state.nestedFields).toBeDefined();
	});

	it("generates valid column (jsonb)", () => {
		const f = object({ name: text() });
		const col = f.toColumn("address") as any;
		expect(col).toBeDefined();
	});

	it("generates composite schema from nested fields", () => {
		const f = object({
			street: text().required(),
			zip: text(10),
		});
		const schema = f.required().toZodSchema();

		expect(
			schema.safeParse({ street: "123 Main St", zip: "12345" }).success,
		).toBe(true);
		expect(schema.safeParse({ zip: "12345" }).success).toBe(false); // street required
	});

	it("getMetadata() includes nested field metadata", () => {
		const f = object({
			name: text().required().label({ en: "Name" }),
		});
		const meta = f.getMetadata() as any;
		expect(meta.type).toBe("object");
		expect(meta.nestedFields).toBeDefined();
		expect(meta.nestedFields.name.type).toBe("text");
		expect(meta.nestedFields.name.label).toEqual({ en: "Name" });
	});
});

// ============================================================================
// From (custom)
// ============================================================================

describe("from()", () => {
	it("creates a custom field from column factory", () => {
		const f = from(
			(name: string) => ({ name, kind: "custom" }),
			z.object({ lat: z.number(), lng: z.number() }),
		);
		expect(f._state.type).toBe("custom");
	});

	it("generates column from factory", () => {
		const f = from((name: string) => ({ name, kind: "custom" }));
		const col = f.toColumn("location") as any;
		expect(col).toBeDefined();
	});

	it("uses provided Zod schema", () => {
		const pointSchema = z.object({ lat: z.number(), lng: z.number() });
		const f = from((name: string) => ({ name }), pointSchema).required();
		const schema = f.toZodSchema();

		expect(schema.safeParse({ lat: 1, lng: 2 }).success).toBe(true);
		expect(schema.safeParse({ lat: "wrong" }).success).toBe(false);
	});

	it(".type() sets custom type string", () => {
		const f = from((name: string) => ({ name })).type("point");
		expect(f._state.customType).toBe("point");
	});
});

// ============================================================================
// Cross-cutting: chaining and immutability
// ============================================================================

describe("Cross-cutting field behavior", () => {
	it("all fields support .required()", () => {
		expect(text().required()._state.notNull).toBe(true);
		expect(number().required()._state.notNull).toBe(true);
		expect(boolean().required()._state.notNull).toBe(true);
		expect(date().required()._state.notNull).toBe(true);
		expect(datetime().required()._state.notNull).toBe(true);
		expect(email().required()._state.notNull).toBe(true);
	});

	it("all fields support .default()", () => {
		const t = text().default("hello");
		expect(t._state.hasDefault).toBe(true);
		expect(t._state.defaultValue).toBe("hello");

		const n = number().default(42);
		expect(n._state.hasDefault).toBe(true);
		expect(n._state.defaultValue).toBe(42);
	});

	it("all fields support .label() and .description()", () => {
		const f = text().label({ en: "Name" }).description({ en: "Your name" });
		expect(f._state.label).toEqual({ en: "Name" });
		expect(f._state.description).toEqual({ en: "Your name" });
	});

	it("all fields support .localized()", () => {
		const f = text().localized();
		expect(f._state.localized).toBe(true);
	});

	it("all fields support .array()", () => {
		const f = text().array();
		expect(f._state.isArray).toBe(true);

		const schema = f.toZodSchema();
		expect(schema.safeParse(["a", "b"]).success).toBe(true);
	});

	it("all fields support .virtual()", () => {
		const f = text().virtual();
		expect(f._state.virtual).toBe(true);
		expect(f.toColumn("test")).toBeNull();
	});

	it("all fields produce operators", () => {
		expect(text().getOperators().column).toBeDefined();
		expect(number().getOperators().column).toBeDefined();
		expect(boolean().getOperators().column).toBeDefined();
		expect(date().getOperators().column).toBeDefined();
		expect(datetime().getOperators().column).toBeDefined();
		expect(email().getOperators().column).toBeDefined();
		expect(url().getOperators().column).toBeDefined();
		expect(
			select([{ value: "a", label: { en: "A" } }]).getOperators().column,
		).toBeDefined();
	});

	it("chaining is immutable — original unchanged", () => {
		const base = text();
		const required = base.required();
		const withDefault = required.default("x");

		expect(base._state.notNull).toBe(false);
		expect(base._state.hasDefault).toBe(false);
		expect(required._state.notNull).toBe(true);
		expect(required._state.hasDefault).toBe(false);
		expect(withDefault._state.notNull).toBe(true);
		expect(withDefault._state.hasDefault).toBe(true);
	});
});
