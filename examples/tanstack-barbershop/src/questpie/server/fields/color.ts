/**
 * `f.color()` — a hex color-swatch field.
 *
 * App-land custom field type: this file lives in `server/fields/`, so codegen
 * discovers it (`fieldType()` factory) and wires it into the generated `f.*`
 * surface. The admin renders it with the matching client definition in
 * `../../admin/fields/color.tsx` (same `"color"` name = registry match).
 *
 * Stored as a plain `#RRGGBB` string (varchar), so it needs no special column
 * support and round-trips through the Drizzle adapter like any short text.
 */

import { fieldType, selectSingleOps } from "questpie/builders";
import { varchar } from "questpie/drizzle-pg-core";
import { z } from "zod";

/** `#` + 6 hex digits (what `<input type="color">` emits). */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const colorFieldType = fieldType("color", {
	create: () => ({
		type: "color",
		columnFactory: (name: string) => varchar(name, { length: 9 }),
		schemaFactory: () =>
			z.string().regex(HEX_COLOR, {
				message: "Invalid color. Expected #RRGGBB",
			}),
		operatorSet: selectSingleOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}),
});
