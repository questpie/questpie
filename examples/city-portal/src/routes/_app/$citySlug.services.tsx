/**
 * Services alias route.
 *
 * The Services entry is a `pages` document with slug="services".
 * Site-settings navigation historically pointed at `/services`, so this
 * route keeps that URL working by redirecting to the canonical page URL.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$citySlug/services")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/$citySlug/pages/$slug",
			params: { citySlug: params.citySlug, slug: "services" },
		});
	},
});
