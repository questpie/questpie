import { createFileRoute } from "@tanstack/react-router";

import { AutopilotPageContent } from "@/components/marketing/autopilot";
import { MarketingChrome } from "@/components/marketing/chrome";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

const TITLE = "Autopilot — agents on the team";
/* The description this replaces promised "Q4 2026 early access". Nothing in the
 * repo dates the pilot, so the page says what it can stand behind instead. */
const DESCRIPTION =
	"Autopilot holds the work: goals, tasks, messages. An agent picks something up, asks when it is unsure, and hands back a proposal you accept in one click.";

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
