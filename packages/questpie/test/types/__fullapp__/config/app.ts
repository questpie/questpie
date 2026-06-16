/**
 * Full-app gate fixture — `appConfig({ context })` carrier.
 *
 * The `context` resolver's RETURN shape drives `~contextExtensions` — this is
 * the Invariant-1 cityId trip-wire (`getContext<App>().cityId` must stay
 * `string | null | undefined`, finite, not-`any`). Mirrors city-portal's real
 * `config/app.ts`.
 */
import { appConfig } from "#questpie/server/config/factories.js";

export default appConfig({
	locale: {
		locales: [{ code: "en", label: "English", fallback: true }],
		defaultLocale: "en",
	},
	context: async ({ request }) => {
		const cityId = request.headers.get("x-selected-city");
		return { cityId: cityId || null };
	},
});
