import { createFileRoute } from "@tanstack/react-router";

import { MarketingChrome } from "@/components/marketing/chrome";
import { WorksPage } from "@/components/marketing/works";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

const TITLE = "White-label engineering, from the team that builds QUESTPIE";
const DESCRIPTION =
	"Contract engineering in your repo, your stack and under your name. Headless CMS builds, operator tools, full stack and infrastructure. EU hours, English, invoiced from an EU company.";

export const Route = createFileRoute("/works")({
	component: Works,
	head: () => ({
		links: generateLinks({
			url: `${siteConfig.url}/works`,
			includeIcons: false,
			includePreconnect: false,
		}),
		meta: generateMeta({
			title: TITLE,
			description: DESCRIPTION,
			url: `${siteConfig.url}/works`,
		}),
	}),
	headers: () => ({
		"Cache-Control":
			"public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
	}),
	staleTime: 60 * 60_000,
	gcTime: 2 * 60 * 60_000,
});

function Works() {
	return (
		<MarketingChrome page="works">
			<WorksPage />
		</MarketingChrome>
	);
}
