import { Braces, Network, Paintbrush } from "lucide-react";

const cards = [
	{
		icon: Braces,
		title: "Server Contract",
		body: "Collections, globals, fields, access, list/form/dashboard/sidebar config, and routes live in one server-first model.",
		accent: "WHAT",
	},
	{
		icon: Network,
		title: "Introspection Layer",
		body: "Server emits serializable metadata and references: field types, view ids, and component refs like { type, props }.",
		accent: "CONTRACT",
	},
	{
		icon: Paintbrush,
		title: "Client Rendering",
		body: "Client resolves field/view/component registries and keeps full control over visuals and interaction patterns.",
		accent: "HOW",
	},
];

export function AdminExperience() {
	return (
		<section
			id="architecture"
			className="relative overflow-hidden border-t border-border/40 py-24"
		>
			<div className="pointer-events-none absolute inset-0">
				<div className="ambient-beam absolute left-1/3 top-20 h-[320px] w-[320px]" />
			</div>

			<div className="relative z-10 mx-auto w-full max-w-7xl px-4">
				<div className="mx-auto mb-14 max-w-3xl space-y-4 text-center">
					<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary">
						One system, clear responsibility split
					</h2>
					<h3 className="text-3xl font-bold tracking-tight md:text-4xl">
						Server defines WHAT. Client defines HOW.
					</h3>
					<p className="text-muted-foreground">
						This keeps contracts stable, prevents schema/admin drift, and lets
						you evolve UI independently from backend internals.
					</p>
				</div>

				<div className="grid gap-6 md:grid-cols-3">
					{cards.map((card, i) => (
						<article
							key={card.title}
							className="animate-in fade-in slide-in-from-bottom-4 border border-border bg-card/40 p-6 backdrop-blur-sm duration-700"
							style={{ animationDelay: `${120 + i * 80}ms` }}
						>
							<div className="mb-5 flex items-start justify-between gap-4">
								<div className="inline-flex border border-primary/30 bg-primary/10 p-2">
									<card.icon className="h-5 w-5 text-primary" />
								</div>
								<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
									{card.accent}
								</span>
							</div>
							<h4 className="mb-2 text-lg font-semibold">{card.title}</h4>
							<p className="text-sm leading-relaxed text-muted-foreground">
								{card.body}
							</p>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}
