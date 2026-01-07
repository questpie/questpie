import { Navbar } from "@/components/landing/Navbar";
import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";
import { Hero } from "@/components/landing/Hero";
import { Features } from "@/components/landing/Features";
import { Comparison } from "@/components/landing/Comparison";
import { Examples } from "@/components/landing/Examples";
import { Frameworks } from "@/components/landing/Frameworks";
import { Footer } from "@/components/landing/Footer";
import { generateMeta, generateJsonLd, siteConfig } from "@/lib/seo";
import { getRandomHeadlineIndex } from "@/components/landing/headlines";

export const Route = createFileRoute("/")({
	component: Home,
	head: () => ({
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
	loader: () => {
		return {
			headlineIndex: getRandomHeadlineIndex(),
		};
	},
	// ISR: Cache landing page for 24 hours, allow stale for 7 days
	headers: () => ({
		"Cache-Control":
			"public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
	}),
	// Client-side: Consider data fresh for 1 hour
	staleTime: 60 * 60_000,
	gcTime: 2 * 60 * 60_000,
});

function Home() {
	const { headlineIndex } = Route.useLoaderData();

	return (
		<HomeLayout {...baseOptions()} nav={{ component: <Navbar /> }}>
			<div className="flex flex-col min-h-screen text-foreground bg-grid-quest font-sans selection:bg-primary/20 selection:text-primary">
				{/* Background Grid */}
				<div className="fixed inset-0 bg-grid-quest opacity-[0.03] pointer-events-none z-0" />

				{/* Layout Guide Lines */}
				<div className="fixed inset-0 pointer-events-none z-[1] flex justify-center px-4">
					<div className="w-full max-w-7xl h-full border-x border-border/30 relative">
						<div className="absolute top-0 bottom-0 left-1/4 w-px bg-border/10 hidden md:block" />
						<div className="absolute top-0 bottom-0 left-2/4 w-px bg-border/10 hidden md:block" />
						<div className="absolute top-0 bottom-0 left-3/4 w-px bg-border/10 hidden md:block" />

						{/* Crosshairs */}
						<div className="absolute top-24 -left-1.5 w-3 h-3 text-border/40 font-mono text-[10px] flex items-center justify-center">
							+
						</div>
						<div className="absolute top-24 -right-1.5 w-3 h-3 text-border/40 font-mono text-[10px] flex items-center justify-center">
							+
						</div>
						<div className="absolute bottom-24 -left-1.5 w-3 h-3 text-border/40 font-mono text-[10px] flex items-center justify-center">
							+
						</div>
						<div className="absolute bottom-24 -right-1.5 w-3 h-3 text-border/40 font-mono text-[10px] flex items-center justify-center">
							+
						</div>
					</div>
				</div>

				{/* Main Content */}
				<main className="flex-1 relative z-10">
					<Hero headlineIndex={headlineIndex} />
					<Comparison />
					<Features />
					<Frameworks />
					<Examples />
				</main>

				<Footer />
			</div>
		</HomeLayout>
	);
}
