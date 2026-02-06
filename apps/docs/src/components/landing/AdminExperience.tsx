import { Link } from "@tanstack/react-router";
import { ArrowRight, Blocks, Columns3, Layers, Palette } from "lucide-react";

const features = [
	{
		icon: Layers,
		title: "22+ Field Types",
		description:
			"Text, rich text, relations, uploads, selects, blocks, arrays, objects — all with built-in validation.",
	},
	{
		icon: Blocks,
		title: "Visual Block Editor",
		description:
			"Drag-and-drop page builder with custom blocks for marketing pages and rich content.",
	},
	{
		icon: Columns3,
		title: "Auto-Generated Views",
		description:
			"Table columns, search, filters, form sections — all derived from your .list() and .form() config.",
	},
	{
		icon: Palette,
		title: "Dashboard Widgets",
		description:
			"9 widget types with server-side fetchFn. Stats, charts, tables, timelines — powered by real data.",
	},
];

export function AdminExperience() {
	return (
		<section className="py-24 border-t border-border/50 relative overflow-hidden">
			{/* Background glow */}
			<div className="absolute top-1/2 left-1/2 w-[600px] h-[600px] bg-primary/3 rounded-full blur-[180px] -translate-x-1/2 -translate-y-1/2" />

			<div className="w-full max-w-7xl mx-auto px-4 relative z-10">
				{/* Header */}
				<div className="text-center max-w-3xl mx-auto space-y-4 mb-12">
					<div className="inline-flex items-center gap-2 border border-primary/20 bg-primary/5 px-3 py-1 text-[10px] uppercase tracking-widest text-primary font-mono">
						<span className="w-1.5 h-1.5 bg-primary animate-pulse" />
						@questpie/admin
					</div>
					<h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight">
						A Complete Admin Panel From Your Config
					</h2>
					<p className="text-lg text-muted-foreground">
						Every collection with{" "}
						<code className="text-primary font-mono text-sm bg-primary/10 px-1.5 py-0.5">
							.admin()
						</code>{" "}
						gets a full CRUD interface — table views, form editors, search, filters, navigation. No frontend code needed.
					</p>
				</div>

				{/* Full-width Admin Mockup */}
				<div className="relative mb-16">
					{/* Glow effect */}
					<div className="absolute -inset-4 bg-gradient-to-r from-primary/20 via-purple-500/20 to-primary/20 blur-3xl opacity-20" />

					{/* Mock admin panel */}
					<div className="relative border border-border bg-card shadow-2xl overflow-hidden max-w-5xl mx-auto">
						{/* Title bar */}
						<div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/50">
							<div className="flex gap-1.5">
								<div className="w-3 h-3 rounded-full bg-red-500/80" />
								<div className="w-3 h-3 rounded-full bg-yellow-500/80" />
								<div className="w-3 h-3 rounded-full bg-green-500/80" />
							</div>
							<span className="text-xs text-muted-foreground font-mono ml-2">
								localhost:3000/admin/posts
							</span>
						</div>

						{/* Mock content */}
						<div className="flex min-h-[320px]">
							{/* Sidebar */}
							<div className="w-52 border-r border-border p-3 bg-muted/20 hidden md:block">
								<div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider px-2 py-2">
									Content
								</div>
								<div className="space-y-0.5">
									<div className="flex items-center gap-2 px-2 py-2 text-xs font-medium bg-primary/10 text-primary rounded">
										<div className="w-4 h-4 bg-primary/20 rounded" />
										Posts
									</div>
									<div className="flex items-center gap-2 px-2 py-2 text-xs font-medium text-muted-foreground">
										<div className="w-4 h-4 bg-muted rounded" />
										Pages
									</div>
									<div className="flex items-center gap-2 px-2 py-2 text-xs font-medium text-muted-foreground">
										<div className="w-4 h-4 bg-muted rounded" />
										Authors
									</div>
								</div>
								<div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider px-2 py-2 mt-4">
									Settings
								</div>
								<div className="space-y-0.5">
									<div className="flex items-center gap-2 px-2 py-2 text-xs font-medium text-muted-foreground">
										<div className="w-4 h-4 bg-muted rounded" />
										Site Settings
									</div>
								</div>
							</div>

							{/* Main area */}
							<div className="flex-1 p-5">
								{/* Header */}
								<div className="flex items-center justify-between mb-5">
									<div>
										<h3 className="font-semibold text-base">Posts</h3>
										<p className="text-xs text-muted-foreground mt-0.5">
											3 items
										</p>
									</div>
									<div className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium">
										+ New Post
									</div>
								</div>

								{/* Search + Filter */}
								<div className="flex gap-2 mb-4">
									<div className="flex-1 h-9 bg-muted/50 border border-border px-3 flex items-center">
										<span className="text-xs text-muted-foreground">
											Search posts...
										</span>
									</div>
									<div className="h-9 px-4 bg-muted/50 border border-border flex items-center">
										<span className="text-xs text-muted-foreground">
											Filter
										</span>
									</div>
									<div className="h-9 px-4 bg-muted/50 border border-border flex items-center">
										<span className="text-xs text-muted-foreground">
											Sort
										</span>
									</div>
								</div>

								{/* Table */}
								<div className="border border-border overflow-hidden">
									<div className="grid grid-cols-[40px_1fr_100px_100px_80px] gap-2 px-3 py-2 bg-muted/50 text-[10px] font-medium text-muted-foreground border-b border-border uppercase tracking-wider">
										<div />
										<div>Title</div>
										<div>Author</div>
										<div>Status</div>
										<div>Updated</div>
									</div>
									{[
										{
											title: "Getting Started Guide",
											author: "Jane D.",
											status: "Published",
											color: "bg-green-500",
											time: "2h ago",
										},
										{
											title: "Advanced Features",
											author: "John S.",
											status: "Draft",
											color: "bg-yellow-500",
											time: "5h ago",
										},
										{
											title: "API Reference",
											author: "Jane D.",
											status: "Published",
											color: "bg-green-500",
											time: "1d ago",
										},
									].map((row, i) => (
										<div
											// biome-ignore lint/suspicious/noArrayIndexKey: stable list
											key={i}
											className="grid grid-cols-[40px_1fr_100px_100px_80px] gap-2 px-3 py-2.5 text-xs border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
										>
											<div className="flex items-center">
												<div className="w-4 h-4 border border-border rounded-sm bg-background" />
											</div>
											<div className="truncate font-medium">{row.title}</div>
											<div className="text-muted-foreground">{row.author}</div>
											<div className="flex items-center gap-1.5">
												<div className={`w-1.5 h-1.5 rounded-full ${row.color}`} />
												<span className="text-muted-foreground">
													{row.status}
												</span>
											</div>
											<div className="text-muted-foreground">{row.time}</div>
										</div>
									))}
								</div>

								{/* Pagination */}
								<div className="flex items-center justify-between mt-3">
									<span className="text-[10px] text-muted-foreground">
										Showing 1-3 of 3
									</span>
									<div className="flex gap-1">
										<div className="w-7 h-7 border border-border flex items-center justify-center text-[10px] text-muted-foreground">
											&lt;
										</div>
										<div className="w-7 h-7 border border-primary bg-primary/10 flex items-center justify-center text-[10px] text-primary font-medium">
											1
										</div>
										<div className="w-7 h-7 border border-border flex items-center justify-center text-[10px] text-muted-foreground">
											&gt;
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Feature cards - horizontal row */}
				<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
					{features.map((feature) => (
						<div key={feature.title} className="space-y-3">
							<div className="flex items-center gap-2.5">
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

				{/* CTA */}
				<div className="text-center mt-12">
					<Link
						to="/docs/$"
						params={{ _splat: "admin" }}
						className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
					>
						Explore Admin UI docs
						<ArrowRight className="w-4 h-4" />
					</Link>
				</div>
			</div>
		</section>
	);
}
