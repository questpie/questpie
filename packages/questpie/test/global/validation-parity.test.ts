/**
 * A field must publish the same validation whether it is mounted on a
 * collection or on a global.
 *
 * It did not. `createCollectionValidationSchemas` overlays each field's own
 * `toZodSchema()` on top of the column-derived base — that is where email
 * format, select enums and `.zod()` refinements come from.
 * `createGlobalValidationSchema` had no `fieldDefinitions` parameter at all, so
 * a global's schema was column-derived only: `f.email()` published as a plain
 * `string` with a maxLength and no format, while the identical field on a
 * collection published the format and pattern.
 *
 * That schema is not decorative. It is what `@questpie/openapi` publishes as
 * the PATCH request body, and what `@questpie/mcp`'s `createGlobalDataSchema`
 * hands to MCP tools — so a global was advertising a looser contract than the
 * same field on a collection, in two places.
 *
 * Asserting parity rather than exact shapes on purpose: the point is that the
 * two paths cannot drift again, not that either one produces a particular
 * JSON Schema today.
 */
import { describe, expect, it } from "bun:test";

import { z } from "zod";

import { collection, global } from "../../src/exports/index.js";

const FIELDS = ({ f }: any) => ({
	contact: f.email(),
	theme: f.select([
		{ value: "light", label: "Light" },
		{ value: "dark", label: "Dark" },
	]),
	headline: f.text(120),
});

// build() runs the constructor, which is where state.validation is populated.
const asCollection = collection("parity_coll").fields(FIELDS).build();
const asGlobal = global("parity_glob").fields(FIELDS).build();

const jsonSchemaOf = (entity: any) => {
	const schema = entity.state.validation?.updateSchema;
	expect(schema).toBeDefined();
	return z.toJSONSchema(schema, { unrepresentable: "any" }) as any;
};

/**
 * Optional fields land as `anyOf: [<constraints>, { type: "null" }]`, so the
 * constraints a client reads are one level down. Unwrap to the non-null member.
 */
const constraintsOf = (entity: any, field: string) => {
	const prop = jsonSchemaOf(entity).properties[field];
	if (!Array.isArray(prop?.anyOf)) return prop;
	return prop.anyOf.find((m: any) => m?.type !== "null") ?? prop;
};

describe("global and collection publish the same field validation", () => {
	it("email keeps its format and pattern on a global", () => {
		const g = constraintsOf(asGlobal, "contact");
		const c = constraintsOf(asCollection, "contact");

		// Absolute, not just relative — parity to a schema that lost everything
		// would also be "parity".
		expect(g.format).toBe("email");
		expect(g.pattern).toBeDefined();
		expect(g.format).toBe(c.format);
		expect(g.pattern).toBe(c.pattern);
	});

	it("select keeps its enum on a global", () => {
		const g = constraintsOf(asGlobal, "theme");
		const c = constraintsOf(asCollection, "theme");

		expect(g.enum).toEqual(["light", "dark"]);
		expect(g.enum).toEqual(c.enum);
	});

	it("every shared field agrees on the constraints a client would rely on", () => {
		for (const key of ["contact", "theme", "headline"]) {
			const g = constraintsOf(asGlobal, key);
			const c = constraintsOf(asCollection, key);

			for (const constraint of ["format", "pattern", "enum", "maxLength"]) {
				expect({ key, constraint, value: g?.[constraint] }).toEqual({
					key,
					constraint,
					value: c?.[constraint],
				});
			}
		}
	});
});
