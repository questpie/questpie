/**
 * City Portal Builder
 *
 * Extended with context for multi-tenant city scoping.
 */

import { adminModule } from "@questpie/admin/server";
import { q } from "questpie";

/**
 * Questpie builder with city context extension.
 *
 * The context resolver extracts cityId from the x-selected-city header.
 * Access validation is handled in collection hooks where we have full access to the schema.
 */
export const qb = q.use(adminModule).context(async ({ request }) => {
	const cityId = request.headers.get("x-selected-city");

	return {
		cityId: cityId || null,
	};
});

export type CityContext = {
	cityId: string | null;
};
