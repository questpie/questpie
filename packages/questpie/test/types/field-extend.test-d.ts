/**
 * Field Extension Type Tests — .$type<T>() and typed .zod()
 *
 * Compile-time only - run with: tsc --noEmit
 * If any Expect<> fails, TypeScript compilation fails.
 */

import { z } from "zod";

import { json } from "#questpie/server/modules/core/fields/json.js";
import { text } from "#questpie/server/modules/core/fields/text.js";

import type { Equal, Expect } from "./type-test-utils.js";

// ============================================================================
// .$type<T>() — explicit value type (json fields)
// ============================================================================

type Layout = { rows: { id: string; span: number }[] };

const layoutField = json().$type<Layout>();
type LayoutValue = (typeof layoutField)["$types"]["value"];
type _layoutTyped = Expect<Equal<LayoutValue, Layout>>;

// .$type composes with .required() in either order
const layoutRequired = json().$type<Layout>().required();
type LayoutRequiredValue = (typeof layoutRequired)["$types"]["value"];
type _layoutRequiredTyped = Expect<Equal<LayoutRequiredValue, Layout>>;

const layoutRequiredFirst = json().required().$type<Layout>();
type LayoutRequiredFirstValue = (typeof layoutRequiredFirst)["$types"]["value"];
type _layoutRequiredFirstTyped = Expect<
	Equal<LayoutRequiredFirstValue, Layout>
>;

// ============================================================================
// typed .zod() — returned schema output narrows data
// ============================================================================

const settingsField = json().zod(() =>
	z.object({ theme: z.enum(["light", "dark"]) }),
);
type SettingsValue = (typeof settingsField)["$types"]["value"];
type _settingsNarrowed = Expect<
	Equal<SettingsValue, { theme: "light" | "dark" }>
>;

// ============================================================================
// .zod() backward compatibility — plain ZodType return keeps prior data
// ============================================================================

const refinedText = text().zod((s) => s.refine(() => true, "always"));
type RefinedTextValue = (typeof refinedText)["$types"]["value"];
type _refinedKeepsString = Expect<Equal<RefinedTextValue, string>>;
