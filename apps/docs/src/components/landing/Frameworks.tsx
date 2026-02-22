import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { AnimOrbitArcs } from "@/components/landing/BrandVisuals";

const frameworks = [
	{
		name: "TanStack Start",
		tagline: "Full-stack, type-safe",
		description:
			"Full-stack React framework with type-safe routing and server functions.",
		logo: (
			<img src="/logos/tanstack.png" alt="TanStack" className="h-8 w-auto" />
		),
		highlighted: true,
	},
	{
		name: "Hono",
		tagline: "Bun-native, edge-ready",
		description:
			"Ultra-fast, runs on Bun, Deno, Cloudflare Workers, and Node.js.",
		logo: <img src="/logos/hono.png" alt="Hono" className="h-8 w-8" />,
	},
	{
		name: "Elysia",
		tagline: "Bun-native, type-safe",
		description: "End-to-end type safety with excellent Bun performance.",
		logo: <img src="/logos/elysia.svg" alt="Elysia" className="h-8 w-8" />,
	},
	{
		name: "Next.js",
		tagline: "App Router & Pages Router",
		description:
			"Works with both App Router and Pages Router via catch-all routes.",
		logo: <img src="/logos/nextjs.png" alt="Next.js" className="h-8 w-8" />,
	},
];

export function Frameworks() {
	return (
		<section id="adapters" className="relative border-t border-border/40 py-20 overflow-hidden">
			<div className="mx-auto w-full max-w-7xl px-4 relative z-10">
				{/* L-R layout: heading LEFT, orbit visualization RIGHT */}
				<div className="grid gap-12 lg:grid-cols-[1fr_1fr] items-center mb-12">
					{/* Left — heading + description + link */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.6 }}
					>
						<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary text-balance">
							Adapters
						</h2>
						<h3 className="mt-3 font-mono text-3xl font-bold tracking-[-0.02em] text-balance md:text-4xl">
							Bring your own framework
						</h3>
						<p className="mt-3 text-muted-foreground text-balance max-w-lg">
							If it handles HTTP, it runs QUESTPIE. Write your own adapter in
							under 50 lines.
						</p>
						<div className="mt-6">
							<Link
								to="/docs/$"
								params={{ _splat: "client/adapters-overview" }}
								className="inline-flex items-center gap-2 font-mono text-xs text-primary transition-colors hover:text-primary/80"
							>
								Read the adapter docs →
							</Link>
						</div>
					</motion.div>

					{/* Right — Orbit arcs visualization */}
					<motion.div
						className="flex items-center justify-center lg:justify-end order-last lg:order-none"
						initial={{ opacity: 0, x: 20 }}
						whileInView={{ opacity: 1, x: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.6, delay: 0.15 }}
					>
						<AnimOrbitArcs className="w-full max-w-[400px] h-auto pointer-events-none opacity-90" />
					</motion.div>
				</div>

				{/* Framework cards — aligned with heading */}
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{frameworks.map((fw, i) => (
						<motion.div
							key={fw.name}
							className="group border border-border bg-card/20 backdrop-blur-sm p-6 text-center transition-colors hover:border-primary/30"
							initial={{ opacity: 0, y: 20 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true }}
							transition={{
								duration: 0.5,
								delay: i * 0.1,
							}}
						>
							<div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center">
								{fw.logo}
							</div>
							<h4 className="text-lg font-semibold">{fw.name}</h4>
							<p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
								{fw.tagline}
							</p>
							<p className="mt-2 text-xs text-muted-foreground">
								{fw.description}
							</p>
						</motion.div>
					))}
				</div>
			</div>
		</section>
	);
}
