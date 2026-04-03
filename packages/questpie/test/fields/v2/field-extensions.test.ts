/**
 * Field Extension System Tests
 *
 * Tests the generic .set() method, extension proxy wrapping,
 * and metadata passthrough for plugin-contributed extensions.
 */

import { describe, expect, it } from "bun:test";

import { z } from "zod";
import { varchar } from "drizzle-orm/pg-core";

import type { DefaultFieldState } from "#questpie/server/fields/field-class-types.js";
import { Field, field } from "#questpie/server/fields/field-class.js";
import { stringOps } from "#questpie/server/fields/operators/builtin.js";
import { wrapBuilderWithExtensions } from "#questpie/server/utils/builder-extensions.js";
import { text } from "#questpie/server/modules/core/fields/text.js";
import { object } from "#questpie/server/modules/core/fields/object.js";
import { select } from "#questpie/server/modules/core/fields/select.js";
import { relation } from "#questpie/server/modules/core/fields/relation.js";
import { upload } from "#questpie/server/modules/core/fields/upload.js";

// ============================================================================
// Helpers
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

/** Simulate the codegen-generated field extension registry */
const fieldExtRegistry: Record<
	string,
	{ stateKey: string; resolve: (v: any) => any }
> = {
	admin: { stateKey: "admin", resolve: (v: any) => v },
	form: {
		stateKey: "form",
		resolve: (configOrFn: any) =>
			typeof configOrFn === "function" ? configOrFn({ f: new Proxy({}, { get: (_, p) => String(p) }) }) : configOrFn,
	},
};

/** Wrap a field factory to add extension methods (same as codegen does) */
function wrapFieldFactory<T extends (...args: any[]) => any>(fn: T): T {
	return ((...args: any[]) =>
		wrapBuilderWithExtensions(fn(...args), fieldExtRegistry, Field)) as any;
}

// ============================================================================
// Field.set() — core mechanism
// ============================================================================

describe("Field.set() — generic extension setter", () => {
	it("stores value in extensions bucket", () => {
		const f = createTestTextField();
		const extended = f.set("admin", { placeholder: "test" });

		expect(extended._state.extensions).toEqual({
			admin: { placeholder: "test" },
		});
	});

	it("preserves existing extensions when adding new ones", () => {
		const f = createTestTextField();
		const ext1 = f.set("admin", { placeholder: "test" });
		const ext2 = ext1.set("form", { fields: ["name"] });

		expect(ext2._state.extensions).toEqual({
			admin: { placeholder: "test" },
			form: { fields: ["name"] },
		});
	});

	it("overwrites same key on repeated .set()", () => {
		const f = createTestTextField();
		const ext1 = f.set("admin", { placeholder: "v1" });
		const ext2 = ext1.set("admin", { placeholder: "v2" });

		expect(ext2._state.extensions?.admin).toEqual({ placeholder: "v2" });
	});

	it("returns a new Field instance (immutability)", () => {
		const f = createTestTextField();
		const extended = f.set("admin", {});

		expect(f).not.toBe(extended);
		expect(f._state.extensions).toBeUndefined();
	});

	it("preserves all other state", () => {
		const f = createTestTextField()
			.required()
			.label({ en: "Name" })
			.description({ en: "desc" })
			.localized();

		const extended = f.set("admin", { placeholder: "test" });

		expect(extended._state.notNull).toBe(true);
		expect(extended._state.label).toEqual({ en: "Name" });
		expect(extended._state.description).toEqual({ en: "desc" });
		expect(extended._state.localized).toBe(true);
		expect(extended._state.type).toBe("text");
	});
});

// ============================================================================
// Extension proxy wrapping (simulating codegen output)
// ============================================================================

describe("Field extension proxy", () => {
	it("adds .admin() method via proxy", () => {
		const wrappedText = wrapFieldFactory(text);
		const f = wrappedText(255) as Field & { admin: (opts: any) => Field };

		expect(typeof f.admin).toBe("function");
	});

	it(".admin() stores in extensions.admin", () => {
		const wrappedText = wrapFieldFactory(text);
		const f = (wrappedText(255) as any).admin({ placeholder: "Enter..." });

		expect(f._state.extensions?.admin).toEqual({ placeholder: "Enter..." });
	});

	it("chaining preserves proxy — .required().admin() works", () => {
		const wrappedText = wrapFieldFactory(text);
		const f = (wrappedText(255) as any).required().admin({ placeholder: "x" });

		expect(f._state.notNull).toBe(true);
		expect(f._state.extensions?.admin).toEqual({ placeholder: "x" });
	});

	it(".admin() after .label() and .description() preserves all state", () => {
		const wrappedText = wrapFieldFactory(text);
		const f = (wrappedText(255) as any)
			.label({ en: "Name" })
			.description({ en: "desc" })
			.required()
			.admin({ placeholder: "test" });

		expect(f._state.label).toEqual({ en: "Name" });
		expect(f._state.description).toEqual({ en: "desc" });
		expect(f._state.notNull).toBe(true);
		expect(f._state.extensions?.admin).toEqual({ placeholder: "test" });
	});

	it(".form() resolves callback and stores result", () => {
		const wrappedText = wrapFieldFactory(text);
		const wrappedObj = wrapFieldFactory(object);

		const obj = (wrappedObj({
			street: wrappedText(255),
			city: wrappedText(255),
		}) as any).form(({ f }: any) => ({
			fields: [f.street, f.city],
		}));

		expect(obj._state.extensions?.form).toEqual({
			fields: ["street", "city"],
		});
	});

	it("multiple extensions can be chained", () => {
		const wrappedText = wrapFieldFactory(text);
		const wrappedObj = wrapFieldFactory(object);

		const obj = (wrappedObj({
			name: wrappedText(255),
		}) as any)
			.admin({ wrapper: "flat" })
			.form(({ f }: any) => ({ fields: [f.name] }));

		expect(obj._state.extensions?.admin).toEqual({ wrapper: "flat" });
		expect(obj._state.extensions?.form).toEqual({ fields: ["name"] });
	});
});

// ============================================================================
// getMetadata() — extensions.admin → meta
// ============================================================================

describe("getMetadata() with extensions", () => {
	it("maps extensions.admin to meta on base fields", () => {
		const f = createTestTextField().set("admin", { placeholder: "hello" });
		const meta = f.getMetadata();

		expect(meta.meta).toEqual({ placeholder: "hello" });
	});

	it("meta is undefined when no admin extension set", () => {
		const f = createTestTextField();
		const meta = f.getMetadata();

		expect(meta.meta).toBeUndefined();
	});

	it("works through proxy chain", () => {
		const wrappedText = wrapFieldFactory(text);
		const f = (wrappedText(255) as any)
			.required()
			.label({ en: "Title" })
			.admin({ placeholder: "Enter title..." });

		const meta = f.getMetadata();

		expect(meta.type).toBe("text");
		expect(meta.required).toBe(true);
		expect(meta.label).toEqual({ en: "Title" });
		expect(meta.meta).toEqual({ placeholder: "Enter title..." });
	});
});

// ============================================================================
// Builtin factories with custom metadataFactory — extensions.admin → meta
// ============================================================================

describe("builtin fields — metadataFactory reads extensions.admin", () => {
	it("select field passes admin meta through", () => {
		const f = select([
			{ value: "a", label: "A" },
			{ value: "b", label: "B" },
		]).set("admin", { allowCreate: true });

		const meta = f.getMetadata() as any;
		expect(meta.meta).toEqual({ allowCreate: true });
	});

	it("object field passes admin meta through", () => {
		const f = object({ name: text(100) }).set("admin", { wrapper: "flat" });
		const meta = f.getMetadata() as any;

		expect(meta.meta).toEqual({ wrapper: "flat" });
		expect(meta.nestedFields).toBeDefined();
	});

	it("object field passes form through to metadata", () => {
		const formConfig = { fields: ["name"] };
		const f = object({ name: text(100) }).set("form", formConfig);
		const meta = f.getMetadata() as any;

		expect(meta.form).toEqual(formConfig);
	});

	it("relation field passes admin meta through", () => {
		const f = relation("users").set("admin", { displayField: "name" });
		const meta = f.getMetadata() as any;

		expect(meta.meta).toEqual({ displayField: "name" });
	});

	it("upload field passes admin meta through", () => {
		const f = upload().set("admin", { accept: "image/*" });
		const meta = f.getMetadata() as any;

		expect(meta.meta).toEqual({ accept: "image/*" });
	});
});
