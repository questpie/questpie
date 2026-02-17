import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import coldarkCold from "react-syntax-highlighter/dist/esm/styles/prism/coldark-cold";
import coldarkDark from "react-syntax-highlighter/dist/esm/styles/prism/coldark-dark";
import { cn } from "@/lib/utils";

SyntaxHighlighter.registerLanguage("typescript", typescript);

type TabId = "dashboard" | "table" | "form" | "sidebar";

const tabs: { id: TabId; label: string; description: string }[] = [
	{
		id: "dashboard",
		label: "Dashboard",
		description: "Server-defined stats",
	},
	{
		id: "table",
		label: "Table View",
		description: "List projection with filters",
	},
	{
		id: "form",
		label: "Form View",
		description: "Schema-driven form projection",
	},
	{
		id: "sidebar",
		label: "Sidebar",
		description: "Config-generated navigation",
	},
];

const snippets: Record<TabId, { code: string; filename: string }> = {
	dashboard: {
		code: `.dashboard(({ d }) => d.dashboard({
  items: [
    d.stats({ collection: "posts" }),
    d.stats({ collection: "users" }),
    d.chart({ collection: "posts", chartType: "line" }),
    d.recentItems({ collection: "posts" }),
  ],
}))`,
		filename: "server/collections/posts.ts",
	},
	table: {
		code: `.list(({ v, f }) => v.table({
  columns: [f.title, f.author, f.status],
}))`,
		filename: "server/collections/posts.ts",
	},
	form: {
		code: `.form(({ v, f }) => v.form({
  fields: [f.title, f.content],
  sidebar: {
    fields: [f.author, f.status],
  },
}))`,
		filename: "server/collections/posts.ts",
	},
	sidebar: {
		code: `.sidebar(({ s, c }) => s.sidebar({
  sections: [
    s.section({
      id: "content",
      title: { en: "Content" },
      items: [
        { type: "collection", collection: "posts" },
        { type: "collection", collection: "pages" },
      ],
    }),
    s.section({
      id: "system",
      title: { en: "System" },
      items: [
        { type: "global", global: "settings" },
      ],
    }),
  ],
}))`,
		filename: "server/admin.ts",
	},
};

const AUTO_INTERVAL = 5000;
const PAUSE_AFTER_CLICK = 10000;

// Subtle floating particles component
function ParticlesBackground() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let animationId: number;
		let particles: Array<{
			x: number;
			y: number;
			vx: number;
			vy: number;
			size: number;
			opacity: number;
		}> = [];

		const resize = () => {
			const rect = canvas.getBoundingClientRect();
			canvas.width = rect.width * window.devicePixelRatio;
			canvas.height = rect.height * window.devicePixelRatio;
			ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
		};

		const initParticles = () => {
			particles = [];
			const count = 25;
			const rect = canvas.getBoundingClientRect();
			for (let i = 0; i < count; i++) {
				particles.push({
					x: Math.random() * rect.width,
					y: Math.random() * rect.height,
					vx: (Math.random() - 0.5) * 0.3,
					vy: (Math.random() - 0.5) * 0.3,
					size: Math.random() * 2 + 1,
					opacity: Math.random() * 0.25 + 0.1,
				});
			}
		};

		const draw = () => {
			const rect = canvas.getBoundingClientRect();
			ctx.clearRect(0, 0, rect.width, rect.height);

			// Draw connections
			ctx.strokeStyle = "hsl(var(--primary) / 0.08)";
			ctx.lineWidth = 0.5;
			for (let i = 0; i < particles.length; i++) {
				for (let j = i + 1; j < particles.length; j++) {
					const dx = particles[i].x - particles[j].x;
					const dy = particles[i].y - particles[j].y;
					const dist = Math.sqrt(dx * dx + dy * dy);
					if (dist < 100) {
						ctx.beginPath();
						ctx.moveTo(particles[i].x, particles[i].y);
						ctx.lineTo(particles[j].x, particles[j].y);
						ctx.globalAlpha = (1 - dist / 100) * 0.3;
						ctx.stroke();
					}
				}
			}

			// Draw particles
			for (const p of particles) {
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
				ctx.fillStyle = `hsl(var(--primary) / ${p.opacity})`;
				ctx.globalAlpha = 1;
				ctx.fill();

				// Update position
				p.x += p.vx;
				p.y += p.vy;

				// Bounce off edges
				if (p.x < 0 || p.x > rect.width) p.vx *= -1;
				if (p.y < 0 || p.y > rect.height) p.vy *= -1;
			}

			animationId = requestAnimationFrame(draw);
		};

		resize();
		initParticles();
		draw();

		window.addEventListener("resize", () => {
			resize();
			initParticles();
		});

		return () => {
			cancelAnimationFrame(animationId);
			window.removeEventListener("resize", resize);
		};
	}, []);

	return (
		<canvas
			ref={canvasRef}
			className="absolute inset-0 pointer-events-none opacity-60"
		/>
	);
}

export function AdminShowcase() {
	const [active, setActive] = useState<TabId>("dashboard");
	const pauseUntilRef = useRef(0);

	const handleClick = useCallback((id: TabId) => {
		pauseUntilRef.current = Date.now() + PAUSE_AFTER_CLICK;
		setActive(id);
	}, []);

	useEffect(() => {
		const interval = setInterval(() => {
			if (Date.now() < pauseUntilRef.current) return;
			setActive((prev) => {
				const idx = tabs.findIndex((t) => t.id === prev);
				return tabs[(idx + 1) % tabs.length].id;
			});
		}, AUTO_INTERVAL);
		return () => clearInterval(interval);
	}, []);

	return (
		<section className="relative border-t border-border/40 py-20 overflow-hidden">
			{/* Dark mode glow */}
			<div className="hidden dark:block absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[800px] pointer-events-none bg-[radial-gradient(ellipse,_oklch(0.5984_0.3015_310.74_/_0.05)_0%,_transparent_70%)]" />

			<div className="relative z-10 mx-auto w-full max-w-7xl px-4">
				{/* Header */}
				<motion.div
					className="mx-auto mb-12 max-w-2xl space-y-3 text-center"
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.6 }}
				>
					<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary">
						Admin Interface
					</h2>
					<h3 className="text-3xl font-bold tracking-[-0.02em] text-balance md:text-4xl">
						One interface generated from your server model
					</h3>
					<p className="text-muted-foreground text-balance">
						Admin reads the same introspection contract as your APIs and
						clients. Override UI through registries when needed.
					</p>
				</motion.div>

				{/* Desktop: 3-column layout - Code | Admin | Tabs */}
				<div className="hidden lg:grid lg:grid-cols-[280px_1fr_200px] gap-4">
					{/* Column 1: Code Panel */}
					<div className="border border-border bg-card/30 backdrop-blur-sm flex flex-col">
						<div className="flex items-center justify-between border-b border-border px-3 py-2 bg-background/50">
							<span className="font-mono text-[10px] text-primary truncate max-w-[200px]">
								{snippets[active].filename}
							</span>
							<div className="flex gap-1">
								<div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
								<div className="h-1.5 w-1.5 rounded-full bg-primary/20" />
							</div>
						</div>
						<div className="flex-1 p-3 overflow-hidden">
							<AnimatePresence mode="wait">
								<motion.div
									key={active}
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.2 }}
									className="break-all"
								>
									<div className="dark:hidden">
										<SyntaxHighlighter
											language="typescript"
											style={coldarkCold}
											wrapLines={true}
											wrapLongLines={true}
											customStyle={{
												background: "transparent",
												padding: 0,
												margin: 0,
												fontSize: "0.65rem",
												lineHeight: "1.4",
											}}
										>
											{snippets[active].code}
										</SyntaxHighlighter>
									</div>
									<div className="hidden dark:block">
										<SyntaxHighlighter
											language="typescript"
											style={coldarkDark}
											wrapLines={true}
											wrapLongLines={true}
											customStyle={{
												background: "transparent",
												padding: 0,
												margin: 0,
												fontSize: "0.65rem",
												lineHeight: "1.4",
											}}
										>
											{snippets[active].code}
										</SyntaxHighlighter>
									</div>
								</motion.div>
							</AnimatePresence>
						</div>
					</div>

					{/* Column 2: Admin Preview */}
					<div className="relative border border-border bg-card/20 backdrop-blur-sm overflow-hidden">
						<ParticlesBackground />

						{/* Browser chrome */}
						<div className="relative flex items-center gap-2 border-b border-border px-4 py-2.5 bg-background/50">
							<div className="flex gap-1.5">
								<div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
								<div className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
								<div className="h-2.5 w-2.5 rounded-full bg-green-400/80" />
							</div>
							<div className="ml-2 flex-1 border border-border/50 bg-background/60 rounded px-3 py-1">
								<span className="font-mono text-[10px] text-muted-foreground">
									localhost:3000/admin
								</span>
							</div>
						</div>

						{/* Crossfading mockup panels */}
						<div className="relative min-h-[380px] p-4">
							<AnimatePresence mode="wait">
								<motion.div
									key={active}
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -10 }}
									transition={{ duration: 0.3 }}
								>
									{active === "dashboard" && <DashboardMock />}
									{active === "table" && <TableMock />}
									{active === "form" && <FormMock />}
									{active === "sidebar" && <SidebarMock />}
								</motion.div>
							</AnimatePresence>
						</div>
					</div>

					{/* Column 3: Tab Switcher - wider */}
					<div className="flex flex-col gap-3">
						{tabs.map((tab, index) => (
							<motion.button
								key={tab.id}
								type="button"
								onClick={() => handleClick(tab.id)}
								initial={{ opacity: 0, x: 20 }}
								animate={{ opacity: 1, x: 0 }}
								transition={{ delay: index * 0.1 }}
								className={cn(
									"text-left border p-4 transition-all cursor-pointer group min-h-[80px]",
									active === tab.id
										? "border-primary bg-primary/[0.08] border-l-[3px] border-l-primary shadow-[0_0_20px_rgba(var(--primary)/0.1)]"
										: "border-border bg-card/20 backdrop-blur-sm hover:border-primary/30 hover:bg-card/40",
								)}
							>
								<div className="flex items-center gap-2">
									<div
										className={cn(
											"h-2 w-2 rounded-full transition-colors",
											active === tab.id
												? "bg-primary"
												: "bg-muted-foreground/30",
										)}
									/>
									<h4
										className={cn(
											"text-sm font-semibold transition-colors",
											active === tab.id ? "text-primary" : "text-foreground",
										)}
									>
										{tab.label}
									</h4>
								</div>
								<p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
									{tab.description}
								</p>
								{active === tab.id && (
									<motion.div
										layoutId="activeIndicator"
										className="mt-3 h-0.5 bg-gradient-to-r from-primary to-transparent"
									/>
								)}
							</motion.button>
						))}
					</div>
				</div>

				{/* Mobile: Stacked layout */}
				<div className="lg:hidden space-y-4">
					{/* Tab switcher - horizontal */}
					<div className="flex gap-2 overflow-x-auto pb-2">
						{tabs.map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => handleClick(tab.id)}
								className={cn(
									"flex-shrink-0 border px-4 py-2 transition-all cursor-pointer",
									active === tab.id
										? "border-primary bg-primary/[0.06] border-b-2 border-b-primary"
										: "border-border bg-card/20",
								)}
							>
								<span
									className={cn(
										"text-sm font-medium",
										active === tab.id ? "text-primary" : "text-foreground",
									)}
								>
									{tab.label}
								</span>
							</button>
						))}
					</div>

					{/* Admin preview */}
					<div className="border border-border bg-card/20 backdrop-blur-sm overflow-hidden">
						<div className="flex items-center gap-2 border-b border-border px-3 py-2 bg-background/50">
							<div className="flex gap-1.5">
								<div className="h-2 w-2 border border-border bg-muted" />
								<div className="h-2 w-2 border border-border bg-muted" />
								<div className="h-2 w-2 border border-border bg-muted" />
							</div>
							<div className="ml-1 flex-1 border border-border bg-background/60 px-2 py-0.5">
								<span className="font-mono text-[9px] text-muted-foreground">
									localhost:3000/admin
								</span>
							</div>
						</div>
						<div className="min-h-[280px] p-3">
							<AnimatePresence mode="wait">
								<motion.div
									key={active}
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.2 }}
								>
									{active === "dashboard" && <DashboardMock />}
									{active === "table" && <TableMock />}
									{active === "form" && <FormMock />}
									{active === "sidebar" && <SidebarMock />}
								</motion.div>
							</AnimatePresence>
						</div>
					</div>

					{/* Code panel - below on mobile */}
					<div className="border border-border bg-card/30 backdrop-blur-sm overflow-hidden">
						<div className="border-b border-border px-3 py-2 bg-background/50">
							<span className="font-mono text-[10px] text-primary truncate max-w-[200px]">
								{snippets[active].filename}
							</span>
						</div>
						<div className="p-3 overflow-hidden">
							<div className="dark:hidden break-all">
								<SyntaxHighlighter
									language="typescript"
									style={coldarkCold}
									wrapLines={true}
									wrapLongLines={true}
									customStyle={{
										background: "transparent",
										padding: 0,
										margin: 0,
										fontSize: "0.7rem",
										lineHeight: "1.5",
									}}
								>
									{snippets[active].code}
								</SyntaxHighlighter>
							</div>
							<div className="hidden dark:block break-all">
								<SyntaxHighlighter
									language="typescript"
									style={coldarkDark}
									wrapLines={true}
									wrapLongLines={true}
									customStyle={{
										background: "transparent",
										padding: 0,
										margin: 0,
										fontSize: "0.7rem",
										lineHeight: "1.5",
									}}
								>
									{snippets[active].code}
								</SyntaxHighlighter>
							</div>
						</div>
					</div>
				</div>

				{/* Link */}
				<motion.div
					className="mt-10 text-center"
					initial={{ opacity: 0 }}
					whileInView={{ opacity: 1 }}
					viewport={{ once: true }}
					transition={{ delay: 0.3 }}
				>
					<Link
						to="/docs/$"
						params={{ _splat: "admin" }}
						className="inline-flex items-center gap-2 font-mono text-xs text-primary transition-colors hover:text-primary/80 group"
					>
						Explore the admin module
						<span className="transition-transform group-hover:translate-x-1">
							→
						</span>
					</Link>
				</motion.div>
			</div>
		</section>
	);
}

function DashboardMock() {
	return (
		<div className="space-y-4">
			<div className="grid grid-cols-3 gap-3">
				{[
					{ label: "Total Posts", value: "248", change: "+12%" },
					{ label: "Published", value: "186", change: "+8%" },
					{ label: "Draft", value: "62", change: "-3%" },
				].map((stat) => (
					<div
						key={stat.label}
						className="border border-border bg-background/60 backdrop-blur-sm p-3 hover:border-primary/20 transition-colors"
					>
						<p className="text-[10px] uppercase tracking-wider text-muted-foreground">
							{stat.label}
						</p>
						<p className="mt-1 text-xl font-bold">{stat.value}</p>
						<p className="mt-0.5 text-[10px] text-primary">{stat.change}</p>
					</div>
				))}
			</div>
			<div className="grid gap-3 md:grid-cols-[1.5fr_1fr]">
				<div className="border border-border bg-background/60 backdrop-blur-sm p-3 hover:border-primary/20 transition-colors">
					<p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
						Content over time
					</p>
					<div className="flex items-end gap-1 h-20">
						{[40, 55, 35, 65, 80, 60, 75, 90, 70, 85, 95, 88].map((h, i) => (
							<motion.div
								key={`bar-${i}-${h}`}
								initial={{ height: 0 }}
								animate={{ height: `${h}%` }}
								transition={{ delay: i * 0.05, duration: 0.3 }}
								className="flex-1 bg-primary/20 hover:bg-primary/40 transition-colors"
							/>
						))}
					</div>
				</div>
				<div className="border border-border bg-background/60 backdrop-blur-sm p-3 hover:border-primary/20 transition-colors">
					<p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
						Recent items
					</p>
					<div className="space-y-1.5">
						{[
							"Getting Started Guide",
							"API Reference",
							"Migration Notes",
							"v1 Changelog",
						].map((item, i) => (
							<motion.div
								key={item}
								initial={{ opacity: 0, x: -10 }}
								animate={{ opacity: 1, x: 0 }}
								transition={{ delay: 0.2 + i * 0.1 }}
								className="flex items-center gap-2 text-xs"
							>
								<div className="h-1.5 w-1.5 bg-primary/40" />
								<span className="text-foreground truncate">{item}</span>
							</motion.div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

function TableMock() {
	const rows = [
		{
			title: "Getting Started with QUESTPIE",
			author: "Alex K.",
			status: "published",
			updated: "2h ago",
		},
		{
			title: "Advanced Field Patterns",
			author: "Mila J.",
			status: "draft",
			updated: "5h ago",
		},
		{
			title: "Building with Blocks",
			author: "Jaro T.",
			status: "published",
			updated: "1d ago",
		},
		{
			title: "Reactive Form Guide",
			author: "Alex K.",
			status: "draft",
			updated: "2d ago",
		},
	];

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<div className="flex-1 border border-border bg-background/60 backdrop-blur-sm px-3 py-1.5 rounded-sm">
					<span className="text-xs text-muted-foreground">Search posts...</span>
				</div>
				<div className="flex gap-1.5">
					{["Status: All", "Author: All"].map((filter) => (
						<span
							key={filter}
							className="border border-border bg-background/60 backdrop-blur-sm px-2 py-1 text-[10px] text-muted-foreground hover:border-primary/20 transition-colors cursor-pointer"
						>
							{filter}
						</span>
					))}
				</div>
			</div>
			<div className="border border-border overflow-hidden">
				<div className="grid grid-cols-[1fr_0.5fr_0.4fr_0.3fr] gap-2 border-b border-border px-3 py-2 bg-muted/30">
					{["Title", "Author", "Status", "Updated"].map((h) => (
						<span
							key={h}
							className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
						>
							{h}
						</span>
					))}
				</div>
				{rows.map((row, i) => (
					<motion.div
						key={row.title}
						initial={{ opacity: 0, y: 5 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: i * 0.05 }}
						className="grid grid-cols-[1fr_0.5fr_0.4fr_0.3fr] gap-2 border-b border-border/50 px-3 py-2 hover:bg-background/40 transition-colors"
					>
						<span className="text-xs text-foreground truncate">
							{row.title}
						</span>
						<span className="text-xs text-muted-foreground">{row.author}</span>
						<span
							className={cn(
								"inline-flex w-fit items-center px-1.5 py-0.5 text-[9px] font-medium rounded-sm",
								row.status === "published"
									? "bg-primary/10 text-primary border border-primary/20"
									: "bg-muted text-muted-foreground border border-border",
							)}
						>
							{row.status}
						</span>
						<span className="text-[10px] text-muted-foreground">
							{row.updated}
						</span>
					</motion.div>
				))}
			</div>
			<div className="flex items-center justify-between text-[10px] text-muted-foreground">
				<span>Showing 1-4 of 248</span>
				<div className="flex gap-1">
					{["1", "2", "3"].map((p) => (
						<span
							key={p}
							className={cn(
								"inline-flex h-5 w-5 items-center justify-center border transition-colors cursor-pointer",
								p === "1"
									? "border-primary text-primary"
									: "border-border hover:border-primary/30",
							)}
						>
							{p}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

function FormMock() {
	return (
		<div className="grid gap-4 md:grid-cols-[1.5fr_0.8fr]">
			<div className="space-y-3">
				<div className="space-y-1.5">
					<div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Title
					</div>
					<div className="border border-border bg-background/60 backdrop-blur-sm px-3 py-2 hover:border-primary/20 transition-colors">
						<span className="text-sm text-foreground">
							Getting Started with QUESTPIE
						</span>
					</div>
				</div>
				<div className="space-y-1.5">
					<div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Content
					</div>
					<div className="border border-border bg-background/60 backdrop-blur-sm p-3 min-h-[120px]">
						<div className="flex gap-1 border-b border-border/50 pb-2 mb-2">
							{["B", "I", "U", "H1", "H2"].map((btn) => (
								<span
									key={btn}
									className="inline-flex h-5 w-5 items-center justify-center border border-border/50 text-[9px] text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors cursor-pointer"
								>
									{btn}
								</span>
							))}
						</div>
						<div className="space-y-1.5">
							<div className="h-2 w-full bg-muted/40" />
							<div className="h-2 w-4/5 bg-muted/40" />
							<div className="h-2 w-full bg-muted/40" />
							<div className="h-2 w-3/5 bg-muted/40" />
						</div>
					</div>
				</div>
			</div>
			<div className="space-y-3">
				<div className="space-y-1.5">
					<div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Author
					</div>
					<div className="flex items-center gap-2 border border-border bg-background/60 backdrop-blur-sm px-3 py-2 hover:border-primary/20 transition-colors">
						<div className="h-4 w-4 bg-primary/20 rounded-full" />
						<span className="text-xs text-foreground">Alex K.</span>
					</div>
				</div>
				<div className="space-y-1.5">
					<div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						Status
					</div>
					<div className="border border-border bg-background/60 backdrop-blur-sm px-3 py-2 hover:border-primary/20 transition-colors">
						<span className="inline-flex items-center gap-1 text-xs">
							<span className="h-1.5 w-1.5 bg-primary rounded-full" />
							Published
						</span>
					</div>
				</div>
				<button
					type="button"
					className="w-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
				>
					Save Changes
				</button>
			</div>
		</div>
	);
}

function SidebarMock() {
	const sections = [
		{
			title: "Overview",
			items: [{ name: "Dashboard", active: true }],
		},
		{
			title: "Content",
			items: [
				{ name: "Posts", count: 248 },
				{ name: "Pages", count: 12 },
				{ name: "Media", count: 1240 },
				{ name: "Categories", count: 8 },
			],
		},
		{
			title: "System",
			items: [{ name: "Settings" }],
		},
	];

	return (
		<div className="grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
			<div className="border border-border bg-background/60 backdrop-blur-sm p-3 hover:border-primary/20 transition-colors">
				<div className="mb-3 flex items-center gap-2">
					<div className="h-4 w-4 bg-primary rounded-sm" />
					<span className="text-xs font-bold">My App</span>
				</div>
				<div className="space-y-3">
					{sections.map((section, si) => (
						<div key={section.title}>
							<p className="mb-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
								{section.title}
							</p>
							<div className="space-y-0.5">
								{section.items.map((item, ii) => (
									<motion.div
										key={item.name}
										initial={{ opacity: 0, x: -5 }}
										animate={{ opacity: 1, x: 0 }}
										transition={{ delay: si * 0.1 + ii * 0.05 }}
										className={cn(
											"flex items-center justify-between px-2 py-1.5 cursor-pointer transition-colors",
											"active" in item && item.active
												? "border-l-2 border-primary bg-primary/[0.06]"
												: "border-l-2 border-transparent hover:bg-background/40",
										)}
									>
										<span
											className={cn(
												"text-xs",
												"active" in item && item.active
													? "font-medium text-primary"
													: "text-foreground",
											)}
										>
											{item.name}
										</span>
										{"count" in item && (
											<span className="text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
												{item.count}
											</span>
										)}
									</motion.div>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
			<div className="space-y-3">
				<div className="border border-border bg-background/60 backdrop-blur-sm p-4 hover:border-primary/20 transition-colors">
					<p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
						Server-defined
					</p>
					<p className="text-sm text-muted-foreground">
						Sidebar sections, grouping, and item counts — all from{" "}
						<code className="text-xs text-foreground bg-muted/50 px-1 py-0.5 rounded">
							.sidebar()
						</code>{" "}
						in your builder config.
					</p>
				</div>
				<div className="border border-border bg-background/60 backdrop-blur-sm p-4 hover:border-primary/20 transition-colors">
					<p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
						Client-rendered
					</p>
					<p className="text-sm text-muted-foreground">
						Swap the sidebar component via the client registry to match your
						product&apos;s design system.
					</p>
				</div>
			</div>
		</div>
	);
}
