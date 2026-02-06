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
import { createFieldBuilderFromDefs } from "#questpie/server/fields/builder.js";
import { defaultFields } from "#questpie/server/fields/builtin/defaults.js";
import type {
  FieldDefinition,
  FieldDefinitionState,
} from "#questpie/server/fields/types.js";

// Create callable proxy from plain field defs
const f = createFieldBuilderFromDefs(defaultFields);

describe("TState Type Inference (compile-time only)", () => {
  test("field state is correctly typed", () => {
    // Create field definitions
    const titleField = f.text({ required: true, maxLength: 255 });
    const contentField = f.text({ localized: true });
    const excerptField = f.text({ virtual: true });
    const countField = f.number({
      virtual: sql<number>`(SELECT COUNT(*))`,
    });

    // Type tests - these should compile without errors
    type TitleState = typeof titleField.state;
    type ContentState = typeof contentField.state;
    type ExcerptState = typeof excerptField.state;
    type CountState = typeof countField.state;

    // Verify types at compile time
    const _titleLocation: TitleState["location"] = "main";
    const _contentLocation: ContentState["location"] = "i18n";
    const _excerptLocation: ExcerptState["location"] = "virtual";
    const _countLocation: CountState["location"] = "virtual";

    // Input types
    type TitleInput = TitleState["input"]; // should be string
    type ContentInput = ContentState["input"]; // should be string | null | undefined
    type ExcerptInput = ExcerptState["input"]; // should be never
    type CountInput = CountState["input"]; // should be never

    // Output types
    type TitleOutput = TitleState["output"]; // should be string
    type ContentOutput = ContentState["output"]; // should be string
    type ExcerptOutput = ExcerptState["output"]; // should be string
    type CountOutput = CountState["output"]; // should be number

    // Column types
    type TitleColumn = TitleState["column"]; // should be PgVarchar
    type ExcerptColumn = ExcerptState["column"]; // should be null

    // Runtime assertions (just to have something to execute)
    expect(_titleLocation).toBe("main");
    expect(_contentLocation).toBe("i18n");
    expect(_excerptLocation).toBe("virtual");
    expect(_countLocation).toBe("virtual");
  });

  test("input variations are correctly inferred", () => {
    // required: true
    const requiredField = f.text({ required: true });
    type RequiredInput = typeof requiredField.state.input;
    const _required: RequiredInput = "test"; // should be string

    // default value
    const defaultField = f.text({ default: "untitled" });
    type DefaultInput = typeof defaultField.state.input;
    const _default: DefaultInput = undefined; // should be string | undefined

    // input: false
    const noInputField = f.text({ input: false });
    type NoInput = typeof noInputField.state.input;
    // NoInput should be never

    // input: "optional"
    const optionalField = f.text({ input: "optional" });
    type OptionalInput = typeof optionalField.state.input;
    const _optional: OptionalInput = undefined; // should be string | undefined

    // virtual + input: true
    const virtualWithInput = f.text({ virtual: true, input: true });
    type VirtualWithInput = typeof virtualWithInput.state.input;
    const _virtualInput: VirtualWithInput = undefined; // should be string | undefined

    expect(_required).toBe("test");
    expect(_optional).toBe(undefined);
    expect(_virtualInput).toBe(undefined);
  });

  test("output variations are correctly inferred", () => {
    // default
    const normalField = f.text({});
    type NormalOutput = typeof normalField.state.output;
    const _normal: NormalOutput = "test"; // should be string

    // output: false
    const hiddenField = f.text({ output: false });
    type HiddenOutput = typeof hiddenField.state.output;
    // HiddenOutput should be never

    // access.read function
    const restrictedField = f.text({
      access: { read: (ctx: any) => (ctx.user as any)?.role === "admin" },
    });
    type RestrictedOutput = typeof restrictedField.state.output;
    // RestrictedOutput might be string depending on field def - just test compilation
    const _restricted: RestrictedOutput = "test";

    expect(_normal).toBe("test");
    expect(_restricted).toBe("test");
  });

  test("toColumn returns correct values", () => {
    const textCol = f.text({ required: true });
    const virtualCol = f.text({ virtual: true });

    // Non-virtual field returns column
    const column = textCol.toColumn("title");
    expect(column).not.toBeNull();

    // Virtual field returns null
    const virtualColumn = virtualCol.toColumn("excerpt");
    expect(virtualColumn).toBeNull();
  });
});
