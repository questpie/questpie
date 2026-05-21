/**
 * Dynamic select/relation options — handler + deps + introspection (S5-4)
 */
import { describe, expect, it } from "bun:test";

import { collection } from "#questpie/server/collection/builder/index.js";
import {
	extractFieldReactiveConfig,
	introspectCollection,
} from "#questpie/server/collection/introspection.js";
import { select } from "#questpie/server/modules/core/fields/select.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../utils/test-context.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const postsWithDynamicCity = collection("posts_dynamic_options").fields(
	({ f }) => ({
		country: f
			.select([
				{ value: "us", label: { en: "United States" } },
				{ value: "uk", label: { en: "United Kingdom" } },
			])
			.required(),
		city: f
			.select({
				handler: async (ctx) => {
					const country = String(ctx.data.country ?? "");
					const cities =
						country === "us"
							? [
									{ value: "nyc", label: { en: "New York" } },
									{ value: "la", label: { en: "Los Angeles" } },
								]
							: country === "uk"
								? [{ value: "london", label: { en: "London" } }]
								: [];
					return { options: cities };
				},
				deps: (ctx) => [ctx.data.country],
			})
			.label({ en: "City" }),
	}),
);

describe("dynamic field options introspection", () => {
	it("extractFieldReactiveConfig serializes options watch deps from handler config", () => {
		const cityField = postsWithDynamicCity.state.fieldDefinitions?.city;
		expect(cityField).toBeDefined();

		const reactive = extractFieldReactiveConfig(cityField!);
		expect(reactive?.options).toBeDefined();
		expect(reactive?.options?.watch).toEqual(["country"]);
		expect(reactive?.options?.searchable).toBe(true);
		expect(reactive?.options?.paginated).toBe(true);
	});

	it("introspectCollection emits empty static options and reactive options config", async () => {
		const setup = await buildMockApp({
			collections: { posts_dynamic_options: postsWithDynamicCity },
		});
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();

		const schema = await introspectCollection(
			postsWithDynamicCity,
			ctx,
			setup.app,
		);

		const city = schema.fields.city;
		expect(city.metadata.type).toBe("select");
		expect((city.metadata as { options?: unknown[] }).options).toEqual([]);
		expect(city.reactive?.options?.watch).toEqual(["country"]);

		const country = schema.fields.country;
		expect((country.metadata as { options?: { value: string }[] }).options).toHaveLength(
			2,
		);
		expect(country.reactive).toBeUndefined();
	});

	it("extractFieldReactiveConfig tracks nested deps paths", () => {
		const field = select({
			handler: async () => ({ options: [] }),
			deps: (ctx) => [ctx.data.address.country, ctx.sibling.region],
		});

		const reactive = extractFieldReactiveConfig(field);
		expect(reactive?.options?.watch).toEqual(
			expect.arrayContaining(["address", "address.country", "$sibling.region"]),
		);
		expect(reactive?.options?.watch).toHaveLength(3);
	});
});
