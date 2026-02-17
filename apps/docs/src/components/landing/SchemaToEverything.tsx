import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";

const schemaFields = [
	{ name: "title", type: "Text", icon: "T" },
	{ name: "author", type: "Relation", icon: "→" },
	{ name: "content", type: "Rich Text", icon: "¶" },
	{ name: "status", type: "Select", icon: "◇" },
];

const outputs = [
	{
		id: "introspection",
		label: "Platform Contract",
		sublabel: "Generated from your schema",
		items: [
			"Collection and field schema",
			"Access and hook metadata",
			"View and component references",
		],
	},
	{
		id: "projections",
		label: "Runtime Projections",
		sublabel: "APIs and clients out of the box",
		items: ["REST + RPC endpoints", "Realtime streams", "Typed client helpers"],
	},
	{
		id: "admin",
		label: "Admin UI",
		sublabel: "Optional internal surface",
		items: [
			"List and form projections",
			"Sidebar and dashboard from config",
			"Registry overrides",
		],
	},
];

export function SchemaToEverything() {
	return (
		<section className="border-t border-border/40 py-20">
			<div className="mx-auto w-full max-w-7xl px-4">
				{/* Header */}
				<motion.div
					className="mx-auto mb-16 max-w-2xl space-y-3 text-center"
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.6 }}
				>
					<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary">
						From Schema to Shipping
					</h2>
					<h3 className="text-3xl font-bold tracking-[-0.02em] text-balance md:text-4xl">
						Define the backend once. Get the rest for free.
					</h3>
					<p className="text-muted-foreground text-balance">
						No duplicate wiring across API, clients, and admin. One backend
						model drives all runtime outputs.
					</p>
				</motion.div>

				<div className="mx-auto max-w-6xl">
					{/* Schema card — centered */}
					<motion.div
						className="mx-auto max-w-sm border border-border bg-card/20 backdrop-blur-sm p-5"
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.5 }}
					>
						<div className="mb-3 flex items-center gap-2">
							<div className="h-3 w-3 bg-primary" />
							<span className="font-mono text-xs font-semibold text-primary">
								Schema: Posts
							</span>
						</div>
						<div className="space-y-1.5">
							{schemaFields.map((field, i) => (
								<motion.div
									key={field.name}
									className="flex items-center gap-2 border border-border/50 bg-background/60 backdrop-blur-sm px-3 py-1.5"
									initial={{ opacity: 0, x: -10 }}
									whileInView={{ opacity: 1, x: 0 }}
									viewport={{ once: true }}
									transition={{
										duration: 0.4,
										delay: 0.2 + i * 0.08,
									}}
								>
									<span className="inline-flex h-5 w-5 items-center justify-center border border-primary/20 bg-primary/10 text-[10px] font-mono text-primary">
										{field.icon}
									</span>
									<span className="text-sm text-foreground">{field.name}</span>
									<span className="ml-auto text-xs text-muted-foreground">
										{field.type}
									</span>
								</motion.div>
							))}
						</div>
					</motion.div>

					{/* Connector */}
					<div className="flex justify-center py-6">
						<motion.div
							className="h-10 w-px bg-gradient-to-b from-primary to-primary/20"
							initial={{ scaleY: 0 }}
							whileInView={{ scaleY: 1 }}
							viewport={{ once: true }}
							transition={{ duration: 0.4, delay: 0.4 }}
							style={{ transformOrigin: "top" }}
						/>
					</div>

					{/* Output cards */}
					<div className="grid gap-4 md:grid-cols-3">
						{outputs.map((output, i) => (
							<motion.div
								key={output.id}
								className="border border-border bg-card/20 backdrop-blur-sm p-4"
								initial={{ opacity: 0, y: 20 }}
								whileInView={{ opacity: 1, y: 0 }}
								viewport={{ once: true }}
								transition={{
									duration: 0.5,
									delay: 0.5 + i * 0.12,
								}}
							>
								<div className="mb-2 flex items-center justify-between">
									<span className="text-sm font-semibold">{output.label}</span>
									<span className="font-mono text-[10px] text-muted-foreground">
										{output.sublabel}
									</span>
								</div>
								<div className="space-y-1">
									{output.items.map((item) => (
										<div
											key={item}
											className="font-mono text-[11px] text-muted-foreground"
										>
											{item}
										</div>
									))}
								</div>
							</motion.div>
						))}
					</div>
				</div>

				{/* Link */}
				<div className="mt-10 text-center">
					<Link
						to="/docs/$"
						params={{ _splat: "server/collections" }}
						className="inline-flex items-center gap-2 font-mono text-xs text-primary transition-colors hover:text-primary/80"
					>
						Learn about collections →
					</Link>
				</div>
			</div>
		</section>
	);
}
