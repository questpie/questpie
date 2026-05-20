import { createFileRoute } from "@tanstack/react-router";

import {
	CloudAudience,
	CloudFAQ,
	CloudFinalCta,
	CloudHero,
	CloudJourney,
	CloudPricing,
	DeployConsole,
	HostedAutopilotSection,
	ManagedInfra,
	MigrationSection,
	TemplatesSection,
} from "@/components/landing/cloud-sections";
import {
	StarBanner,
	useRevealOnScroll,
} from "@/components/landing/primitives";
import { SharedFooter } from "@/components/landing/shared-footer";
import { SharedNav } from "@/components/landing/shared-nav";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

export const Route = createFileRoute("/cloud")({
	component: CloudPage,
	head: () => ({
		links: generateLinks({
			url: `${siteConfig.url}/cloud`,
			includeIcons: false,
			includePreconnect: false,
		}),
		meta: generateMeta({
			title:
				"QUESTPIE Cloud — Your runtime, managed. Your data, yours.",
			description:
				"The runtime control plane for QUESTPIE: managed Postgres, health-checked deploys, custom domains, hosted Autopilot. Q3 2026 waitlist open.",
			url: `${siteConfig.url}/cloud`,
		}),
	}),
	headers: () => ({
		"Cache-Control":
			"public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
	}),
});

function CloudPage() {
	useRevealOnScroll();
	return (
		<div style={{ minHeight: "100vh", background: "var(--background)" }}>
			<SharedNav activeKey="cloud" />
			<main>
				<CloudHero />
				<StarBanner accent="var(--pillar-cloud)" />
				<CloudAudience />
				<CloudJourney />
				<DeployConsole />
				<TemplatesSection />
				<ManagedInfra />
				<HostedAutopilotSection />
				<CloudPricing />
				<MigrationSection />
				<CloudFAQ />
				<CloudFinalCta />
			</main>
			<SharedFooter />
		</div>
	);
}
