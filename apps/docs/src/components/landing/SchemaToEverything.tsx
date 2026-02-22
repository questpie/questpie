import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { AnimFloatingPies } from "@/components/landing/BrandVisuals";

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
		<section className="relative border-t border-border/40 py-20 overflow-hidden">
			{/* Ambient floating brand elements */}
			<AnimFloatingPies className="absolute inset-0 w-full h-full pointer-events-none opacity-70" />
			<div className="mx-auto w-full max-w-7xl px-4 relative z-10">
				{/* Centered heading */}
				<motion.div
					className="mx-auto mb-12 max-w-2xl space-y-3 text-center"
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.6 }}
				>
					<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary text-balance">
						From Schema to Shipping
					</h2>
					<h3 className="font-mono text-3xl font-bold tracking-[-0.02em] text-balance md:text-4xl">
						Define once, get the rest for free
					</h3>
					<p className="text-muted-foreground text-balance">
						No duplicate wiring across API, clients, and admin. One backend
						model drives all runtime outputs.
					</p>
				</motion.div>

				{/* Schema card — centered */}
				<motion.div
					className="mx-auto max-w-sm border border-border bg-card/20 backdrop-blur-sm p-5 mb-4"
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.5, delay: 0.15 }}
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
									delay: 0.3 + i * 0.08,
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

				{/* Branching connector — schema fans out to three outputs */}
				<motion.div
					className="my-4 mx-auto"
					initial={{ opacity: 0 }}
					whileInView={{ opacity: 1 }}
					viewport={{ once: true }}
					transition={{ duration: 0.5, delay: 0.3 }}
				>
					<SchemaConnector />
				</motion.div>

				{/* Output cards — aligned with heading above */}
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
								delay: 0.4 + i * 0.12,
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

const P = "#B700FF";

/**
 * SVG connector: vertical stem from center top, splits into 3 curved branches
 * that land at left/center/right (matching the 3-col output grid).
 * Travelling dots ride each branch path.
 */
function SchemaConnector() {
	const paths = [
		"M 300 0 L 300 30 Q 300 50 200 55 L 100 60 L 100 80",
		"M 300 0 L 300 80",
		"M 300 0 L 300 30 Q 300 50 400 55 L 500 60 L 500 80",
	];

	return (
		<svg
			viewBox="0 0 600 80"
			fill="none"
			className="w-full max-w-3xl mx-auto pointer-events-none"
			aria-hidden="true"
		>
			{paths.map((d, i) => (
				<g key={`branch-${d.slice(0, 20)}`}>
					<path d={d} stroke={P} strokeWidth={1} opacity={0.12} />
					<circle r={2.5} fill={P} opacity={0.3}>
						<animateMotion
							dur={`${3 + i * 0.5}s`}
							repeatCount="indefinite"
							begin={`${i * 0.6}s`}
							path={d}
						/>
					</circle>
					<circle r={1.5} fill={P} opacity={0.15}>
						<animateMotion
							dur={`${3 + i * 0.5}s`}
							repeatCount="indefinite"
							begin={`${i * 0.6 + 0.8}s`}
							path={d}
						/>
					</circle>
				</g>
			))}
			<circle cx={300} cy={0} r={3} fill={P} opacity={0.2} />
			<circle cx={100} cy={80} r={2} fill={P} opacity={0.15} />
			<circle cx={300} cy={80} r={2} fill={P} opacity={0.15} />
			<circle cx={500} cy={80} r={2} fill={P} opacity={0.15} />
		</svg>
	);
}
