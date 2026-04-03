/**
 * QUE-263: fieldType(), wrapFieldComplete(), derive() tests
 */
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { varchar } from "drizzle-orm/pg-core";

import { Field, field } from "../../src/server/fields/field-class.js";
import {
	fieldType,
	wrapFieldComplete,
} from "../../src/server/fields/field-type.js";
import { stringOps } from "../../src/server/fields/operators/builtin.js";

// ============================================================================
// derive()
// ============================================================================

describe("Field.derive()", () => {
	it("creates a new field with extra state", () => {
		const f = field({ type: "text", columnFactory: null, schemaFactory: null, operatorSet: stringOps, notNull: false, hasDefault: false, localized: false, virtual: false, input: true, output: true, isArray: false });
		const derived = f.derive({ pattern: /^[A-Z]/ });

		expect(derived).not.toBe(f);
		expect(derived._state.pattern?.source).toBe("^[A-Z]");
		expect(derived._state.type).toBe("text"); // identity preserved
	});

	it("cannot change identity properties", () => {
		const f = field({ type: "text", columnFactory: null, schemaFactory: null, operatorSet: stringOps, notNull: false, hasDefault: false, localized: false, virtual: false, input: true, output: true, isArray: false });

		// @ts-expect-error — type is omitted from derive patch
		f.derive({ type: "number" });

		// @ts-expect-error — columnFactory is omitted
		f.derive({ columnFactory: () => null });
	});
});

// ============================================================================
// fieldType()
// ============================================================================

describe("fieldType()", () => {
	const textType = fieldType("text", {
		create: (maxLength = 255) => ({
			type: "text",
			columnFactory: (name: string) => varchar(name, { length: maxLength }),
			schemaFactory: () => z.string().max(maxLength),
			operatorSet: stringOps,
			notNull: false,
			hasDefault: false,
			localized: false,
			virtual: false,
			input: true,
			output: true,
			isArray: false,
		}),
		methods: {
			pattern: (f: Field<any>, re: RegExp) => f.derive({ pattern: re }),
			trim: (f: Field<any>) => f.derive({ trim: true }),
			lowercase: (f: Field<any>) => f.derive({ lowercase: true }),
		},
	});

	it("creates a field with correct type", () => {
		const f = textType.factory(100);
		expect(f).toBeInstanceOf(Field);
		expect(f.getType()).toBe("text");
	});

	it("type-specific methods work", () => {
		const f = textType.factory(100);
		const patterned = (f as any).pattern(/^[A-Z]/);
		expect(patterned._state.pattern?.source).toBe("^[A-Z]");
	});

	it("common methods preserve type-specific methods", () => {
		const f = textType.factory(100);
		const required = f.required();

		// required() should return a Proxy-wrapped Field with .pattern()
		expect(typeof (required as any).pattern).toBe("function");

		const patterned = (required as any).pattern(/test/);
		expect(patterned._state.pattern?.source).toBe("test");
		expect(patterned._state.notNull).toBe(true);
	});

	it("long chain preserves all methods", () => {
		const f = textType.factory(255);
		const result = (f as any)
			.required()
			.label({ en: "Name" })
			.pattern(/^[A-Z]/)
			.trim();

		expect(result._state.notNull).toBe(true);
		expect(result._state.label).toEqual({ en: "Name" });
		expect(result._state.pattern?.source).toBe("^[A-Z]");
		expect(result._state.trim).toBe(true);

		// Should still have pattern method
		expect(typeof (result as any).pattern).toBe("function");
	});

	it("instanceof Field works through Proxy", () => {
		const f = textType.factory();
		expect(f instanceof Field).toBe(true);
		expect(f.required() instanceof Field).toBe(true);
	});
});

// ============================================================================
// wrapFieldComplete with extensions
// ============================================================================

describe("wrapFieldComplete() with extensions", () => {
	it("extension methods work alongside type methods", () => {
		const base = field({ type: "text", columnFactory: null, schemaFactory: null, operatorSet: stringOps, notNull: false, hasDefault: false, localized: false, virtual: false, input: true, output: true, isArray: false });

		const typeMethods = {
			pattern: (f: Field<any>, re: RegExp) => f.derive({ pattern: re }),
		};

		const extensions = {
			admin: {
				stateKey: "admin",
				resolve: (config: any) => config,
			},
		};

		const wrapped = wrapFieldComplete(base, typeMethods, extensions);

		// Type method
		const patterned = (wrapped as any).pattern(/test/);
		expect(patterned._state.pattern?.source).toBe("test");

		// Extension method
		const admined = (wrapped as any).admin({ hidden: true });
		expect(admined._state.extensions?.admin).toEqual({ hidden: true });

		// Both should still have all methods
		expect(typeof (admined as any).pattern).toBe("function");
		expect(typeof (admined as any).admin).toBe("function");
	});
});

// ============================================================================
// fieldType without methods
// ============================================================================

describe("fieldType() without methods", () => {
	const boolType = fieldType("boolean", {
		create: () => ({
			type: "boolean",
			columnFactory: null,
			schemaFactory: () => z.boolean(),
			operatorSet: stringOps,
			notNull: false,
			hasDefault: false,
			localized: false,
			virtual: false,
			input: true,
			output: true,
			isArray: false,
		}),
	});

	it("works without type-specific methods", () => {
		const f = boolType.factory();
		expect(f.getType()).toBe("boolean");
		// Common methods still work
		const required = f.required();
		expect(required._state.notNull).toBe(true);
	});
});
