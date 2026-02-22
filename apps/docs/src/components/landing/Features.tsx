import {
	Buildings,
	Cube,
	FileText,
	Key,
	ListChecks,
	MagnifyingGlass,
	ShieldCheck,
	Translate,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
	AnimModuleGrid,
	CornerPie,
	CornerSquare,
} from "@/components/landing/BrandVisuals";

const features = [
	{
		icon: Cube,
		title: "Blocks System",
		description:
			"Define reusable blocks on the server and render them in admin or custom UIs.",
		link: "admin/blocks-system",
	},
	{
		icon: MagnifyingGlass,
		title: "Search & Semantic",
		description:
			"Built-in PostgreSQL FTS, pgVector semantic search, and faceted filters.",
		link: "infrastructure/search",
	},
	{
		icon: FileText,
		title: "OpenAPI & Scalar",
		description:
			"Generate OpenAPI from collections, globals, and RPC with built-in Scalar docs.",
		link: "client/openapi",
	},
	{
		icon: Translate,
		title: "i18n / Localization",
		description:
			"Field-level localization with typed locales and admin locale switching.",
		link: "server/localization",
	},
	{
		icon: ListChecks,
		title: "Jobs & Queues",
		description:
			"pg-boss jobs with cron schedules, retries, and priority queues.",
		link: "infrastructure/queue-and-jobs",
	},
	{
		icon: ShieldCheck,
		title: "Access Control",
		description:
			"Collection and field-level rules evaluated with full user/session context.",
		link: "server/access-control",
	},
	{
		icon: Buildings,
		title: "Multitenancy & Scopes",
		description:
			"Scopes, tenant isolation, row-level filters, and admin scope picker.",
		link: "server/access-control",
	},
	{
		icon: Key,
		title: "Auth (Better Auth)",
		description:
			"Better Auth integration: email/password, OAuth, 2FA, sessions, and API keys.",
		link: "infrastructure/authentication",
	},
];

export function Features() {
	return (
		<section
			id="features"
			className="relative border-border/40 py-20 overflow-hidden"
		>
			<div className="mx-auto w-full max-w-7xl px-4 relative z-10">
				{/* L-R layout: heading LEFT, module grid viz RIGHT */}
				<div className="grid gap-12 lg:grid-cols-[1fr_1fr] items-center mb-12">
					{/* Left — heading + description + link */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.6 }}
					>
						<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary text-balance">
							Platform Capabilities
						</h2>
						<h3 className="mt-3 font-mono text-3xl font-bold tracking-[-0.02em] text-balance md:text-4xl">
							Built-in platform capabilities
						</h3>
						<p className="mt-3 text-muted-foreground text-balance max-w-lg">
							Search, i18n, jobs, auth, multitenancy, and blocks are all built
							in. Configure once in backend, use everywhere.
						</p>
						<div className="mt-6">
							<Link
								to="/docs/$"
								params={{ _splat: "infrastructure" }}
								className="inline-flex items-center gap-2 font-mono text-xs text-primary transition-colors hover:text-primary/80"
							>
								Explore platform infrastructure →
							</Link>
						</div>
					</motion.div>

					{/* Right — Module grid visualization */}
					<motion.div
						className="flex items-center justify-center lg:justify-end order-last lg:order-none"
						initial={{ opacity: 0, x: 20 }}
						whileInView={{ opacity: 1, x: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.6, delay: 0.15 }}
					>
						<AnimModuleGrid className="w-full max-w-[320px] h-auto pointer-events-none opacity-80" />
					</motion.div>
				</div>

				{/* Feature cards — aligned with heading */}
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{features.map((feature, i) => (
						<motion.div
							key={feature.title}
							className="group relative border border-border bg-card/20 backdrop-blur-sm p-4 transition-colors hover:border-primary/30"
							initial={{ opacity: 0, y: 16 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true }}
							transition={{
								duration: 0.4,
								delay: i * 0.06,
							}}
						>
							<CardDecoration index={i} />
							<div className="mb-3 flex h-9 w-9 items-center justify-center border border-primary/20 bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
								<feature.icon className="h-4 w-4" aria-hidden="true" />
							</div>
							<h4 className="font-mono text-sm font-semibold mb-1">
								{feature.title}
							</h4>
							<p className="text-xs text-muted-foreground leading-relaxed">
								{feature.description}
							</p>
						</motion.div>
					))}
				</div>
			</div>
		</section>
	);
}

/**
 * Alternating corner decorations so cards don't all look identical.
 * Pattern: square top-right, pie bottom-left, nothing, square bottom-right,
 *          pie top-left, nothing, square top-left, pie top-right
 */
function CardDecoration({ index }: { index: number }) {
	const variant = index % 6;
	switch (variant) {
		case 0:
			return <CornerSquare size={24} className="absolute top-0 right-0" />;
		case 1:
			return (
				<CornerPie size={20} className="absolute bottom-0 left-0 rotate-180" />
			);
		case 2:
			return null;
		case 3:
			return (
				<CornerSquare
					size={20}
					className="absolute bottom-0 right-0 rotate-90"
				/>
			);
		case 4:
			return (
				<CornerPie size={24} className="absolute top-0 left-0 -rotate-90" />
			);
		case 5:
			return null;
		default:
			return null;
	}
}
