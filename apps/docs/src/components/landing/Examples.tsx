import { ArrowRight, Github, FolderOpen } from "lucide-react";
import { Link } from "@tanstack/react-router";

const examples = [
	{
		title: "Portfolio Site",
		stack: "Hono",
		description:
			"Agency backend with projects, categories, team members, contact forms, email notifications, and file uploads.",
		features: [
			"Collections + relations",
			"Background jobs",
			"Email templates",
			"File storage",
		],
		githubLink:
			"https://github.com/questpie/questpie-cms/tree/main/examples/portfolio-hono",
		ready: true,
	},
	{
		title: "Barbershop",
		stack: "Elysia",
		description:
			"Booking system with appointments, services, barbers. Shows custom functions, access control, and hooks.",
		features: [
			"Custom RPC functions",
			"Access control",
			"Lifecycle hooks",
			"Validation",
		],
		githubLink:
			"https://github.com/questpie/questpie-cms/tree/main/examples/elysia-barbershop",
		ready: true,
	},
	{
		title: "Fullstack Barbershop",
		stack: "TanStack Start",
		description:
			"Same barbershop but fullstack with TanStack Start. SSR, TanStack Query, type-safe client.",
		features: [
			"TanStack Query",
			"SSR data fetching",
			"Type-safe client",
			"Fullstack app",
		],
		githubLink:
			"https://github.com/questpie/questpie-cms/tree/main/examples/tanstack-barbershop",
		ready: true,
	},
];

export function Examples() {
	return (
		<section id="examples" className="py-24 border-t border-border">
			<div className="w-full max-w-7xl mx-auto px-4">
				<div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
					<div className="space-y-4">
						<h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">
							Real-World Examples
						</h2>
						<h3 className="text-3xl font-bold">Start with a Template</h3>
						<p className="text-muted-foreground max-w-xl">
							Don't start from scratch. Clone a production-ready example to see
							best practices in action. All examples use native libraries you
							already know.
						</p>
					</div>
					<a
						href="https://github.com/questpie/questpie-cms/tree/main/examples"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
					>
						View all on GitHub <ArrowRight className="h-4 w-4" />
					</a>
				</div>

				<div className="grid md:grid-cols-3 gap-6">
					{examples.map((ex, i) => (
						<div
							key={i}
							className="group flex flex-col p-6 border border-border bg-card/30 hover:border-primary/50 hover:bg-card/50 transition-all"
						>
							<div className="flex justify-between items-start mb-4">
								<div className="px-2 py-1 bg-primary/10 text-primary text-[10px] font-mono uppercase tracking-wider border border-primary/20">
									{ex.stack}
								</div>
								<a
									href={ex.githubLink}
									target="_blank"
									rel="noopener noreferrer"
									className="text-muted-foreground hover:text-foreground transition-colors"
								>
									<Github className="h-5 w-5" />
								</a>
							</div>

							<h4 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors">
								{ex.title}
							</h4>

							<p className="text-sm text-muted-foreground leading-relaxed mb-4">
								{ex.description}
							</p>

							<ul className="text-xs text-muted-foreground space-y-1 mb-6">
								{ex.features.map((feature, j) => (
									<li key={j} className="flex items-center gap-2">
										<div className="w-1 h-1 bg-primary" />
										{feature}
									</li>
								))}
							</ul>

							<div className="mt-auto flex gap-3">
								<a
									href={ex.githubLink}
									target="_blank"
									rel="noopener noreferrer"
									className="flex-1 inline-flex items-center justify-center h-9 px-4 text-xs font-medium border border-border hover:border-primary/50 hover:bg-primary/5 transition-all"
								>
									<FolderOpen className="h-3.5 w-3.5 mr-2" />
									Clone
								</a>
								<Link
									to="/docs/$"
									className="flex-1 inline-flex items-center justify-center h-9 px-4 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-all"
								>
									Docs
									<ArrowRight className="h-3.5 w-3.5 ml-2" />
								</Link>
							</div>
						</div>
					))}
				</div>

				{/* Quick Start CTA */}
				<div className="mt-16 p-8 border border-primary/20 bg-primary/5 text-center">
					<h4 className="text-xl font-bold mb-3">Ready to Build?</h4>
					<p className="text-muted-foreground mb-6 max-w-lg mx-auto">
						Get started in minutes with Bun and PostgreSQL. Full type safety
						from database to client.
					</p>
					<div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
						<code className="px-4 py-2 bg-background border border-border font-mono text-sm">
							bun add @questpie/cms drizzle-orm@beta
						</code>
						<Link
							to="/docs/$"
							className="inline-flex items-center h-10 px-6 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
						>
							Read the Docs
							<ArrowRight className="ml-2 h-4 w-4" />
						</Link>
					</div>
				</div>
			</div>
		</section>
	);
}
