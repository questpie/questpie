import { createFileRoute } from "@tanstack/react-router";

import {
	BuilderSection,
	IntegrationsSection,
	OpenSourceSection,
	PacksSection,
	QapCockpit,
	RuntimeMCPSection,
} from "@/components/landing/autopilot-extras";
import {
	APFaq,
	APFinalCta,
	APHero,
	APPillars,
	IssuesSection,
	KnowledgeProjectsSection,
	SchedulesSection,
	WorkflowsSection,
} from "@/components/landing/autopilot-sections";
import { StarBanner, useRevealOnScroll } from "@/components/landing/primitives";
import { SharedFooter } from "@/components/landing/shared-footer";
import { SharedNav } from "@/components/landing/shared-nav";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

export const Route = createFileRoute("/autopilot")({
	component: AutopilotPage,
	head: () => ({
		links: generateLinks({
			url: `${siteConfig.url}/autopilot`,
			includeIcons: false,
			includePreconnect: false,
		}),
		meta: generateMeta({
			title:
				"QUESTPIE Autopilot — Run your company. Build your apps. Automate the rest.",
			description:
				"AI-native operating layer for QUESTPIE. Linear-style issues, durable workflows, schedules, knowledge, agents and an AI builder. MIT. Q4 2026 early access.",
			url: `${siteConfig.url}/autopilot`,
		}),
	}),
	headers: () => ({
		"Cache-Control":
			"public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
	}),
});

function AutopilotPage() {
	useRevealOnScroll();
	return (
		<div style={{ minHeight: "100vh", background: "var(--background)" }}>
			<SharedNav activeKey="autopilot" />
			<main>
				<APHero />
				<StarBanner accent="var(--pillar-autopilot)" />
				<APPillars />
				<IssuesSection />
				<WorkflowsSection />
				<SchedulesSection />
				<KnowledgeProjectsSection />
				<BuilderSection />
				<IntegrationsSection />
				<PacksSection />
				<RuntimeMCPSection />
				<QapCockpit />
				<OpenSourceSection />
				<APFaq />
				<APFinalCta />
			</main>
			<SharedFooter />
		</div>
	);
}
