/**
 * Type Tests for TState-based Field Inference
 *
 * Compile-time type tests - verify that TypeScript correctly infers
 * field types from configuration using the TState pattern.
 *
 * Run: bun test test/fields/tstate-types.test.ts
 */

import { describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import { createFieldBuilder } from "#questpie/server/fields/builder.js";
import type {
	ExtractInputType,
	ExtractSelectType,
} from "#questpie/server/fields/field-class-types.js";
import { builtinFields } from "#questpie/server/modules/core/fields/index.js";

// Create callable proxy from plain field defs
const f = createFieldBuilder(builtinFields);

describe("TState Type Inference (compile-time only)", () => {
	test("field TState is correctly typed", () => {
		// Create field definitions
		const titleField = f.text(255).required();
		const contentField = f.text().localized();
		const excerptField = f.text().virtual();
		const countField = f.number().virtual(sql<number>`(SELECT COUNT(*))`);

		// Type tests via _ phantom property
		type TitleState = typeof titleField._;
		type ContentState = typeof contentField._;
		type ExcerptState = typeof excerptField._;
		type CountState = typeof countField._;

		// Verify notNull/localized/virtual at type level
		const _titleNotNull: TitleState["notNull"] = true;
		const _contentLocalized: ContentState["localized"] = true;
		const _excerptVirtual: ExcerptState["virtual"] = true;
		const _countVirtual: CountState["virtual"] = true;

		// Input type extraction
		type _TitleInput = ExtractInputType<TitleState>; // string (required, no default)
		type _ContentInput = ExtractInputType<ContentState>; // string | null | undefined (nullable)
		type _ExcerptInput = ExtractInputType<ExcerptState>; // never (virtual, no input)
		type _CountInput = ExtractInputType<CountState>; // never (virtual, no input)

		// Output type extraction
		type _TitleOutput = ExtractSelectType<TitleState>; // string (notNull)
		type _ContentOutput = ExtractSelectType<ContentState>; // string | null
		type _ExcerptOutput = ExtractSelectType<ExcerptState>; // string | null
		type _CountOutput = ExtractSelectType<CountState>; // number | null

		// Column types
		type _TitleColumn = TitleState["column"]; // PgVarchar (not null)
		type _ExcerptColumn = ExcerptState["column"]; // null (virtual)

		// Runtime assertions (just to have something to execute)
		expect(titleField.getLocation()).toBe("main");
		expect(contentField.getLocation()).toBe("i18n");
		expect(excerptField.getLocation()).toBe("virtual");
		expect(countField.getLocation()).toBe("virtual");
	});

	test("input variations are correctly inferred", () => {
		// required: true
		const requiredField = f.text().required();
		type _RequiredInput = (typeof requiredField._)["input"];
		// RequiredInput narrows to true (notNull means input is required)

		// default value
		const defaultField = f.text().default("untitled");
		type _DefaultHasDefault = (typeof defaultField._)["hasDefault"];
		// DefaultHasDefault narrows to true

		// input: false
		const noInputField = f.text().inputFalse();
		type _NoInputFlag = (typeof noInputField._)["input"];
		// NoInputFlag narrows to false

		// input: "optional"
		const optionalField = f.text().inputOptional();
		type _OptionalInputFlag = (typeof optionalField._)["input"];
		// OptionalInputFlag narrows to "optional"

		// virtual + input: true
		const virtualWithInput = f.text().virtual().inputTrue();
		type _VirtualWithInputFlag = (typeof virtualWithInput._)["input"];
		// VirtualWithInputFlag narrows to true

		expect(requiredField._state.notNull).toBe(true);
		expect(defaultField._state.hasDefault).toBe(true);
		expect(noInputField._state.input).toBe(false);
		expect(optionalField._state.input).toBe("optional");
		expect(virtualWithInput._state.input).toBe(true);
	});

	test("output variations are correctly inferred", () => {
		// default
		const normalField = f.text();
		type _NormalOutput = (typeof normalField._)["output"];
		// NormalOutput is true (default)

		// output: false
		const hiddenField = f.text().outputFalse();
		type _HiddenOutput = (typeof hiddenField._)["output"];
		// HiddenOutput is false

		// access.read function
		const restrictedField = f
			.text()
			.access({ read: (ctx: any) => (ctx.user as any)?.role === "admin" });
		type _RestrictedOutput = (typeof restrictedField._)["output"];
		// RestrictedOutput is still true (access doesn't change type-level output)

		expect(normalField._state.output).toBe(true);
		expect(hiddenField._state.output).toBe(false);
		expect(restrictedField._state.output).toBe(true);
	});

	test("toColumn returns correct values", () => {
		const textCol = f.text().required();
		const virtualCol = f.text().virtual();

		// Non-virtual field returns column
		const column = textCol.toColumn("title");
		expect(column).not.toBeNull();

		// Virtual field returns null
		const virtualColumn = virtualCol.toColumn("excerpt");
		expect(virtualColumn).toBeNull();
	});
});
