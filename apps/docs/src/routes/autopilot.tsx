import { createFileRoute } from "@tanstack/react-router";

import { AutopilotPageContent } from "@/components/marketing/autopilot";
import { MarketingChrome } from "@/components/marketing/chrome";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

const TITLE = "Autopilot: give agents real work, keep the last word";
const DESCRIPTION =
	"Autopilot keeps goals, tasks, messages and agent work in one place, with named roles, visible progress and human approval where it matters.";

export const Route = createFileRoute("/autopilot")({
	component: AutopilotPage,
	head: () => ({
		links: generateLinks({
			url: `${siteConfig.url}/autopilot`,
			includeIcons: false,
			includePreconnect: false,
		}),
		meta: generateMeta({
			title: TITLE,
			description: DESCRIPTION,
			url: `${siteConfig.url}/autopilot`,
		}),
	}),
	headers: () => ({
		"Cache-Control":
			"public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
	}),
	staleTime: 60 * 60_000,
	gcTime: 2 * 60 * 60_000,
});

function AutopilotPage() {
	return (
		<MarketingChrome page="autopilot">
			<AutopilotPageContent />
		</MarketingChrome>
	);
}
