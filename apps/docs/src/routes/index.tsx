import { createFileRoute } from "@tanstack/react-router";

import {
	AutopilotSection,
	CloudSection,
	FaqSection,
	FinalCta,
	FrameworkSection,
	Hero,
	PillarsSection,
	PricingSection,
	StackSection,
	UseCasesSection,
} from "@/components/landing/index-sections";
import { StarBanner, useRevealOnScroll } from "@/components/landing/primitives";
import { SharedFooter } from "@/components/landing/shared-footer";
import { SharedNav } from "@/components/landing/shared-nav";
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

function LandingPage() {
	useRevealOnScroll();
	return (
		<div style={{ minHeight: "100vh", background: "var(--background)" }}>
			<SharedNav />
			<main>
				<Hero />
				<StarBanner />
				<PillarsSection />
				<FrameworkSection />
				<CloudSection />
				<AutopilotSection />
				<UseCasesSection />
				<StackSection />
				<PricingSection />
				<FaqSection />
				<FinalCta />
			</main>
			<SharedFooter />
		</div>
	);
}
