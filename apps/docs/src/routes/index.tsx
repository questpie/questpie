import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { AdminShowcase } from "@/components/landing/AdminShowcase";
import { AnimArcDivider } from "@/components/landing/BrandVisuals";
import { CallToAction } from "@/components/landing/CallToAction";
import { Composability } from "@/components/landing/Composability";
import { Features } from "@/components/landing/Features";
import { Footer } from "@/components/landing/Footer";
import { Frameworks } from "@/components/landing/Frameworks";
import { Hero } from "@/components/landing/Hero";
import { Navbar } from "@/components/landing/Navbar";
import { NumbersStrip } from "@/components/landing/NumbersStrip";
import { RealtimeDemo } from "@/components/landing/RealtimeDemo";
import { SchemaToEverything } from "@/components/landing/SchemaToEverything";
import { baseOptions } from "@/lib/layout.shared";
import {
	generateJsonLd,
	generateLinks,
	generateMeta,
	siteConfig,
} from "@/lib/seo";

export const Route = createFileRoute("/")({
	component: Home,
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

function Home() {
	return (
		<HomeLayout {...baseOptions()} nav={{ component: <Navbar /> }}>
			<div className="flex flex-col min-h-screen bg-background text-foreground font-sans selection:bg-primary/20 selection:text-primary relative overflow-hidden">
				{/* Global grid pattern — brand 40px purple */}
				<div
					className="fixed inset-0 pointer-events-none"
					style={{
						opacity: 0.04,
						backgroundImage:
							"repeating-linear-gradient(0deg, transparent, transparent 39px, #B700FF 39px, #B700FF 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, #B700FF 39px, #B700FF 40px)",
					}}
				/>

				{/* Global ambient glow — top */}
				<div className="hidden dark:block fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] pointer-events-none bg-[radial-gradient(ellipse,_oklch(0.5984_0.3015_310.74_/_0.08)_0%,_transparent_70%)]" />

				{/* Global ambient glow — bottom */}
				<div className="hidden dark:block fixed bottom-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] pointer-events-none bg-[radial-gradient(ellipse,_oklch(0.5984_0.3015_310.74_/_0.06)_0%,_transparent_70%)]" />

				<main className="flex-1 relative">
					{/* Hero + NumbersStrip fill the viewport together on desktop */}
					<div className="flex flex-col lg:min-h-screen">
						<Hero />
						<NumbersStrip />
					</div>
					<SchemaToEverything />
					<AnimArcDivider className="w-full" />
					<Features />
					<AdminShowcase />
					<RealtimeDemo />
					<AnimArcDivider className="w-full" />
					<Composability />
					<Frameworks />
					<AnimArcDivider className="w-full" />
					<CallToAction />
				</main>

				<Footer />
			</div>
		</HomeLayout>
	);
}
