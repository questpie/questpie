import { createFileRoute } from "@tanstack/react-router";

import { MarketingChrome } from "@/components/marketing/chrome";
import { FrameworkPage } from "@/components/marketing/framework";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

const TITLE = "Framework — one schema, everything else derived";
const DESCRIPTION =
	"QUESTPIE derives the typed API, the admin, the jobs and the client from one definition — in your codebase, on your servers.";

export const Route = createFileRoute("/framework")({
	component: Framework,
	head: () => ({
		links: generateLinks({
			url: `${siteConfig.url}/framework`,
			includeIcons: false,
			includePreconnect: false,
		}),
		meta: generateMeta({
			title: TITLE,
			description: DESCRIPTION,
			url: `${siteConfig.url}/framework`,
		}),
	}),
	headers: () => ({
		"Cache-Control":
			"public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
	}),
	staleTime: 60 * 60_000,
	gcTime: 2 * 60 * 60_000,
});

function Framework() {
	return (
		<MarketingChrome page="framework">
			<FrameworkPage />
		</MarketingChrome>
	);
}
