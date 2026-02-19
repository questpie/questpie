import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Code, LayoutDashboard, Workflow } from "lucide-react";

const highlights = [
	{
		icon: LayoutDashboard,
		title: "Server-defined dashboard + sidebar",
	},
	{
		icon: Workflow,
		title: "Reactive forms and typed RPC workflows",
	},
	{
		icon: Code,
		title: "Custom blocks and registry-based rendering",
	},
];

export function Examples() {
	return (
		<section
			id="examples"
			className="relative overflow-hidden border-t border-border/40 py-24"
		>
			<div className="mx-auto w-full max-w-7xl px-4">
				<div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-start">
					<div className="space-y-4">
						<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary">
							Example spotlight
						</h2>
						<h3 className="text-3xl font-bold tracking-tight md:text-4xl">
							See the architecture in a real app.
						</h3>
						<p className="text-muted-foreground">
							TanStack Barbershop shows server-defined collections, globals,
							dashboard/sidebar, reactive fields, typed RPC, and custom block
							rendering in one coherent project.
						</p>

						<div className="space-y-2.5">
							{highlights.map((item) => (
								<div
									key={item.title}
									className="inline-flex w-full items-center gap-2 border border-border bg-card/30 px-3 py-2 text-sm text-muted-foreground"
								>
									<item.icon className="h-3.5 w-3.5 text-primary" />
									{item.title}
								</div>
							))}
						</div>

						<a
							href="https://github.com/questpie/questpie/tree/main/examples/tanstack-barbershop"
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-primary/80"
						>
							Explore the Barbershop codebase
							<ArrowUpRight className="h-4 w-4" />
						</a>
					</div>

					<div className="grid gap-4 sm:grid-cols-[1.3fr_1fr]">
						<article className="border border-border bg-card/40 p-5 sm:row-span-2">
							<p className="mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
								Dashboard
							</p>
							<div className="space-y-3">
								<div className="h-16 border border-border bg-background/60" />
								<div className="grid grid-cols-3 gap-3">
									<div className="h-20 border border-border bg-background/60" />
									<div className="h-20 border border-border bg-background/60" />
									<div className="h-20 border border-border bg-background/60" />
								</div>
								<div className="h-28 border border-border bg-background/60" />
							</div>
						</article>

						<article className="border border-border bg-card/40 p-4">
							<p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
								Reactive Form
							</p>
							<div className="space-y-2">
								<div className="h-8 border border-border bg-background/60" />
								<div className="h-8 border border-border bg-background/60" />
								<div className="h-20 border border-border bg-background/60" />
							</div>
						</article>

						<article className="border border-border bg-card/40 p-4">
							<p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
								Typed RPC
							</p>
							<div className="h-[124px] border border-border bg-background/60 p-3 font-mono text-[11px] text-muted-foreground">
								<p>client.rpc.getAvailableSlots( )</p>
								<p className="mt-2">-&gt; slots: string[]</p>
								<p className="mt-2">-&gt; nextWindow: string</p>
							</div>
						</article>
					</div>
				</div>

				<div className="mt-10 flex justify-center">
					<Link
						to="/docs/$"
						params={{
							_splat: "examples/tanstack-barbershop-architecture-tour",
						}}
						className="inline-flex items-center gap-2 border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-card/60"
					>
						Read Architecture Tour
						<ArrowUpRight className="h-4 w-4" />
					</Link>
				</div>
			</div>
		</section>
	);
}
