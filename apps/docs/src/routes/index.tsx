import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/LandingPage";
import {
	generateJsonLd,
	generateLinks,
	generateMeta,
	siteConfig,
} from "@/lib/seo";

export const Route = createFileRoute("/")({
	component: LandingPage,
	head: () => ({
		links: generateLinks({
			url: siteConfig.url,
			includeIcons: false,
			includePreconnect: false,
		}),
		meta: generateMeta({
			title: siteConfig.title,
			description: siteConfig.description,
			url: siteConfig.url,
		}),
		scripts: [
			{
				type: "application/ld+json",
				children: JSON.stringify(generateJsonLd()),
			},
		],
	}),
	headers: () => ({
		"Cache-Control":
			"public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
	}),
	staleTime: 60 * 60_000,
	gcTime: 2 * 60 * 60_000,
});
