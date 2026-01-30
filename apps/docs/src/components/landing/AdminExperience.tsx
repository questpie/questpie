import { Link } from "@tanstack/react-router";
import { ArrowRight, Blocks, Columns3, Layers, Palette } from "lucide-react";

const features = [
	{
		icon: Layers,
		title: "22+ Field Types",
		description:
			"Text, rich text, relations, uploads, selects, blocks, and more. All with built-in validation.",
	},
	{
		icon: Blocks,
		title: "Block Editor",
		description:
			"Visual page builder with custom blocks. Create marketing pages, landing pages, rich content.",
	},
	{
		icon: Columns3,
		title: "Table & Form Views",
		description:
			"Configure list views with sorting, filtering, search. Form layouts adapt to your fields.",
	},
	{
		icon: Palette,
		title: "Themeable",
		description:
			"Light and dark mode. Integrates with your app's theme. Matches your brand.",
	},
];

export function AdminExperience() {
	return (
		<section className="py-24 border-t border-border/50 relative overflow-hidden">
			{/* Subtle background glow */}
			<div className="absolute top-1/2 left-1/2 w-[600px] h-[600px] bg-primary/3 rounded-full blur-[180px] -translate-x-1/2 -translate-y-1/2" />

			<div className="w-full max-w-7xl mx-auto px-4 relative z-10">
				{/* Header */}
				<div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
					<div className="inline-flex items-center gap-2 border border-primary/20 bg-primary/5 px-3 py-1 text-[10px] uppercase tracking-widest text-primary font-mono">
						<span className="w-1.5 h-1.5 bg-primary animate-pulse" />
						@questpie/admin
					</div>
					<h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight">
						Config-Driven Admin UI
					</h2>
					<p className="text-lg text-muted-foreground">
						Define your admin interface with the{" "}
						<code className="text-primary font-mono text-sm bg-primary/10 px-1.5 py-0.5 rounded">
							qa()
						</code>{" "}
						builder. No React components to write. Types flow from your backend
						schema.
					</p>
				</div>

				{/* Main content grid */}
				<div className="grid lg:grid-cols-2 gap-12 items-center">
					{/* Left: Admin preview mockup */}
					<div className="relative">
						{/* Glow effect */}
						<div className="absolute -inset-4 bg-gradient-to-r from-primary/20 via-purple-500/20 to-primary/20 blur-3xl opacity-30" />

						{/* Mock admin panel */}
						<div className="relative border border-border bg-card shadow-2xl overflow-hidden">
							{/* Title bar */}
							<div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/50">
								<div className="flex gap-1.5">
									<div className="w-3 h-3 rounded-full bg-red-500/80" />
									<div className="w-3 h-3 rounded-full bg-yellow-500/80" />
									<div className="w-3 h-3 rounded-full bg-green-500/80" />
								</div>
								<span className="text-xs text-muted-foreground font-mono ml-2">
									/admin/posts
								</span>
							</div>

							{/* Mock content */}
							<div className="flex">
								{/* Sidebar */}
								<div className="w-48 border-r border-border p-3 bg-muted/30 hidden sm:block">
									<div className="space-y-1">
										<div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
											<div className="w-4 h-4 bg-muted rounded" />
											Dashboard
										</div>
										<div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium bg-primary/10 text-primary rounded">
											<div className="w-4 h-4 bg-primary/20 rounded" />
											Posts
										</div>
										<div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
											<div className="w-4 h-4 bg-muted rounded" />
											Authors
										</div>
										<div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
											<div className="w-4 h-4 bg-muted rounded" />
											Categories
										</div>
										<div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
											<div className="w-4 h-4 bg-muted rounded" />
											Settings
										</div>
									</div>
								</div>

								{/* Main area */}
								<div className="flex-1 p-4">
									{/* Header */}
									<div className="flex items-center justify-between mb-4">
										<h3 className="font-semibold text-sm">Posts</h3>
										<div className="px-2 py-1 bg-primary text-primary-foreground text-xs font-medium">
											+ New Post
										</div>
									</div>

									{/* Search */}
									<div className="flex gap-2 mb-4">
										<div className="flex-1 h-8 bg-muted/50 border border-border px-2 flex items-center">
											<span className="text-xs text-muted-foreground">
												Search posts...
											</span>
										</div>
										<div className="h-8 px-3 bg-muted/50 border border-border flex items-center">
											<span className="text-xs text-muted-foreground">
												Filter
											</span>
										</div>
									</div>

									{/* Table */}
									<div className="border border-border overflow-hidden">
										<div className="grid grid-cols-4 gap-2 px-3 py-2 bg-muted/50 text-[10px] font-medium text-muted-foreground border-b border-border uppercase tracking-wider">
											<div>Cover</div>
											<div>Title</div>
											<div>Status</div>
											<div>Date</div>
										</div>
										{[
											{
												title: "Getting Started Guide",
												status: "Published",
												statusColor: "bg-green-500",
											},
											{
												title: "Advanced Features",
												status: "Draft",
												statusColor: "bg-yellow-500",
											},
											{
												title: "API Reference",
												status: "Published",
												statusColor: "bg-green-500",
											},
										].map((row, i) => (
											<div
												// biome-ignore lint/suspicious/noArrayIndexKey: stable list
												key={i}
												className="grid grid-cols-4 gap-2 px-3 py-2 text-xs border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
											>
												<div className="w-8 h-6 bg-muted" />
												<div className="truncate">{row.title}</div>
												<div className="flex items-center gap-1">
													<div className={`w-1.5 h-1.5 ${row.statusColor}`} />
													<span className="text-muted-foreground">
														{row.status}
													</span>
												</div>
												<div className="text-muted-foreground">Jan 2026</div>
											</div>
										))}
									</div>
								</div>
							</div>
						</div>
					</div>

					{/* Right: Features list */}
					<div className="space-y-8">
						<div className="space-y-4">
							<h3 className="text-xl font-bold">
								Beautiful Admin. Zero Frontend Code.
							</h3>
							<p className="text-muted-foreground leading-relaxed">
								The admin UI is entirely driven by configuration. Define field
								types, table columns, and form layouts using the builder
								pattern. Types from your backend schema ensure everything stays
								in sync.
							</p>
						</div>

						<div className="grid sm:grid-cols-2 gap-6">
							{features.map((feature) => (
								<div key={feature.title} className="space-y-2">
									<div className="flex items-center gap-2">
										<div className="p-1.5 bg-primary/10 border border-primary/20">
											<feature.icon className="w-4 h-4 text-primary" />
										</div>
										<h4 className="font-medium text-sm">{feature.title}</h4>
									</div>
									<p className="text-sm text-muted-foreground leading-relaxed">
										{feature.description}
									</p>
								</div>
							))}
						</div>

						<Link
							to="/docs/$"
							params={{ _splat: "admin" }}
							className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
						>
							Learn more about Admin UI
							<ArrowRight className="w-4 h-4" />
						</Link>
					</div>
				</div>
			</div>
		</section>
	);
}
