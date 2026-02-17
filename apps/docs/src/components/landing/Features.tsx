import { Link } from "@tanstack/react-router";
import {
	Blocks,
	Building2,
	FileText,
	KeyRound,
	Languages,
	ListTodo,
	Search,
	Shield,
} from "lucide-react";
import { motion } from "motion/react";

const features = [
	{
		icon: Blocks,
		title: "Blocks System",
		description:
			"Define reusable blocks on the server and render them in admin or custom UIs.",
		link: "admin/blocks-system",
	},
	{
		icon: Search,
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
		icon: Languages,
		title: "i18n / Localization",
		description:
			"Field-level localization with typed locales and admin locale switching.",
		link: "server/localization",
	},
	{
		icon: ListTodo,
		title: "Jobs & Queues",
		description:
			"pg-boss jobs with cron schedules, retries, and priority queues.",
		link: "infrastructure/queue-and-jobs",
	},
	{
		icon: Shield,
		title: "Access Control",
		description:
			"Collection and field-level rules evaluated with full user/session context.",
		link: "server/access-control",
	},
	{
		icon: Building2,
		title: "Multitenancy & Scopes",
		description:
			"Scopes, tenant isolation, row-level filters, and admin scope picker.",
		link: "server/access-control",
	},
	{
		icon: KeyRound,
		title: "Auth (Better Auth)",
		description:
			"Better Auth integration: email/password, OAuth, 2FA, sessions, and API keys.",
		link: "infrastructure/authentication",
	},
];

export function Features() {
	return (
		<section id="features" className="border-t border-border/40 py-20">
			<div className="mx-auto w-full max-w-7xl px-4">
				<motion.div
					className="mx-auto mb-12 max-w-2xl space-y-3 text-center"
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.6 }}
				>
					<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary">
						Platform Capabilities
					</h2>
					<h3 className="text-3xl font-bold tracking-[-0.02em] text-balance md:text-4xl">
						Built-in platform capabilities
					</h3>
					<p className="text-muted-foreground text-balance">
						Search, i18n, jobs, auth, multitenancy, and blocks are all built in.
						Configure once in backend, use everywhere.
					</p>
				</motion.div>

				<div className="mx-auto max-w-6xl grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{features.map((feature, i) => (
						<motion.div
							key={feature.title}
							className="group border border-border bg-card/20 backdrop-blur-sm p-4 transition-colors hover:border-primary/30"
							initial={{ opacity: 0, y: 16 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true }}
							transition={{
								duration: 0.4,
								delay: i * 0.06,
							}}
						>
							<div className="mb-3 flex h-9 w-9 items-center justify-center border border-primary/20 bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
								<feature.icon className="h-4 w-4" />
							</div>
							<h4 className="text-sm font-semibold mb-1">{feature.title}</h4>
							<p className="text-xs text-muted-foreground leading-relaxed">
								{feature.description}
							</p>
						</motion.div>
					))}
				</div>

				<div className="mt-8 text-center">
					<Link
						to="/docs/$"
						params={{ _splat: "infrastructure" }}
						className="inline-flex items-center gap-2 font-mono text-xs text-primary transition-colors hover:text-primary/80"
					>
						Explore platform infrastructure →
					</Link>
				</div>
			</div>
		</section>
	);
}
