/**
 * Context Resolver — multi-tenant context extraction.
 * Extracts cityId from request header.
 */
import { context } from "#questpie";

export default context(async ({ request }) => {
	const cityId = request.headers.get("x-selected-city");
	return {
		cityId: cityId || null,
	};
});
