import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

/* ─── Helpers ─── */

function TerminalBlock({
	label,
	children,
	className,
}: {
	label?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"border-border bg-background relative h-full border",
				className,
			)}
		>
			{label && (
				<div className="text-muted-foreground/40 border-border absolute top-0 left-0 border-r border-b px-2 py-1 font-mono text-[10px] tracking-[0.2em] uppercase">
					{label}
				</div>
			)}
			<div className="text-muted-foreground overflow-x-auto p-4 pt-10 font-mono text-[13px] leading-[1.6] whitespace-pre">
				{children}
			</div>
		</div>
	);
}

function Badge({ children }: { children: ReactNode }) {
	return (
		<span className="bg-secondary text-primary px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.04em] uppercase">
			{children}
		</span>
	);
}

function BrutalistGrid({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"bg-border border-border grid grid-cols-1 gap-[1px] border md:grid-cols-2",
				className,
			)}
		>
			{children}
		</div>
	);
}

function FeatureCell({
	num,
	title,
	desc,
}: {
	num: string;
	title: string;
	desc: string;
}) {
	return (
		<div className="bg-background hover:outline-primary flex h-full flex-col p-6 transition-colors hover:outline hover:outline-1 hover:-outline-offset-1">
			<div className="text-primary mb-4 font-mono text-[10px] tracking-[3px]">
				{num}
			</div>
			<h3 className="text-foreground mb-2 font-mono text-[14px] font-bold">
				{title}
			</h3>
			<p className="text-muted-foreground text-[13px] leading-[1.5]">{desc}</p>
		</div>
	);
}

function SectionHeader({
	num,
	title,
	subtitle,
}: {
	num: string;
	title: string;
	subtitle: string;
}) {
	return (
		<div className="mb-12">
			<div className="text-primary mb-4 font-mono text-sm tracking-[3px]">
				{num}
			</div>
			<h2 className="text-foreground mb-4 font-mono text-3xl font-bold md:text-4xl">
				{title}
			</h2>
			<p className="text-muted-foreground max-w-2xl text-lg">{subtitle}</p>
		</div>
	);
}

function Reveal({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			data-reveal
			className={cn(
				"translate-y-3 opacity-0 transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] data-[visible]:translate-y-0 data-[visible]:opacity-100",
				className,
			)}
		>
			{children}
		</div>
	);
}

/* ─── Swap Anything Section (interactive config builder) ─── */

type AdapterOption = {
	label: string;
	fn: string;
	code: string;
	soon?: boolean;
};

type AdapterCategory = {
	key: string;
	label: string;
	options: AdapterOption[];
};

const ADAPTER_CATEGORIES: AdapterCategory[] = [
	{
		key: "kv",
		label: "KV / Cache",
		options: [
			{
				label: "IORedis",
				fn: "ioredisAdapter",
				code: "kv: { adapter: ioredisAdapter() }",
			},
			{
				label: "Memory",
				fn: "memoryAdapter",
				code: "kv: { adapter: memoryAdapter() }",
			},
			{
				label: "CF KV",
				fn: "cfKvAdapter",
				code: "kv: { adapter: cfKvAdapter() }",
				soon: true,
			},
		],
	},
	{
		key: "queue",
		label: "Queue",
		options: [
			{
				label: "pg-boss",
				fn: "pgBossAdapter",
				code: "queue: { adapter: pgBossAdapter() }",
			},
			{
				label: "CF Queues",
				fn: "cfQueuesAdapter",
				code: "queue: { adapter: cfQueuesAdapter() }",
			},
			{
				label: "BullMQ",
				fn: "bullmqAdapter",
				code: "queue: { adapter: bullmqAdapter() }",
				soon: true,
			},
		],
	},
	{
		key: "search",
		label: "Search",
		options: [
			{
				label: "Postgres FTS",
				fn: "postgresSearchAdapter",
				code: "search: postgresSearchAdapter()",
			},
			{
				label: "pgvector",
				fn: "pgvectorAdapter",
				code: "search: pgvectorAdapter()",
				soon: true,
			},
			{
				label: "Meilisearch",
				fn: "meilisearchAdapter",
				code: "search: meilisearchAdapter()",
				soon: true,
			},
		],
	},
	{
		key: "realtime",
		label: "Realtime",
		options: [
			{
				label: "PG NOTIFY",
				fn: "pgNotifyAdapter",
				code: "realtime: { adapter: pgNotifyAdapter() }",
			},
			{
				label: "Redis Streams",
				fn: "redisStreamsAdapter",
				code: "realtime: { adapter: redisStreamsAdapter() }",
			},
		],
	},
	{
		key: "storage",
		label: "Storage",
		options: [
			{
				label: "S3",
				fn: "s3Driver",
				code: 'storage: { driver: s3Driver({ bucket: "assets" }) }',
			},
			{
				label: "R2",
				fn: "r2Driver",
				code: 'storage: { driver: r2Driver({ bucket: "assets" }) }',
			},
			{
				label: "GCS",
				fn: "gcsDriver",
				code: 'storage: { driver: gcsDriver({ bucket: "assets" }) }',
			},
			{
				label: "Local",
				fn: "localDriver",
				code: 'storage: { driver: localDriver({ dir: "./uploads" }) }',
			},
		],
	},
	{
		key: "email",
		label: "Email",
		options: [
			{
				label: "SMTP",
				fn: "smtpAdapter",
				code: "email: { adapter: smtpAdapter() }",
			},
			{
				label: "Console",
				fn: "consoleAdapter",
				code: "email: { adapter: consoleAdapter() }",
			},
			{
				label: "Resend",
				fn: "resendAdapter",
				code: "email: { adapter: resendAdapter() }",
				soon: true,
			},
		],
	},
];

function AdapterDropdown({
	category,
	selected,
	onSelect,
}: {
	category: AdapterCategory;
	selected: number;
	onSelect: (index: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const current = category.options[selected];

	return (
		<span className="relative inline-block">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="cursor-pointer border-b border-dashed border-[var(--syntax-function)]/40 text-[var(--syntax-function)] transition-colors hover:border-[var(--syntax-function)]"
			>
				{current.fn}
				<Icon
					icon="ph:caret-down"
					width={10}
					height={10}
					className="ml-0.5 inline-block opacity-50"
				/>
			</button>
			{open && (
				<>
					<div
						className="fixed inset-0 z-40"
						onClick={() => setOpen(false)}
						onKeyDown={() => {}}
						role="presentation"
					/>
					<div className="bg-card border-border absolute bottom-full left-0 z-[100] mb-1 min-w-[200px] border py-1">
						{category.options.map((opt, i) => (
							<button
								key={opt.label}
								type="button"
								disabled={opt.soon}
								onClick={() => {
									if (!opt.soon) {
										onSelect(i);
										setOpen(false);
									}
								}}
								className={cn(
									"flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] transition-colors",
									opt.soon
										? "text-muted-foreground/40 cursor-default"
										: i === selected
											? "text-primary bg-primary/10"
											: "text-foreground hover:bg-secondary",
								)}
							>
								<span
									className={
										opt.soon
											? "text-muted-foreground/40"
											: "text-[var(--syntax-function)]"
									}
								>
									{opt.fn}
								</span>
								{opt.soon && (
									<span className="bg-border text-muted-foreground ml-auto px-1.5 py-0.5 text-[9px] tracking-wider uppercase">
										soon
									</span>
								)}
							</button>
						))}
						<Link
							to="/docs/$"
							params={{ _splat: "extend/custom-adapters" }}
							className="text-primary hover:bg-secondary border-border mt-1 flex w-full items-center gap-2 border-t px-3 py-1.5 text-left font-mono text-[11px] transition-colors"
							onClick={() => setOpen(false)}
						>
							<Icon ssr icon="ph:code" width={12} height={12} />
							Write your own
						</Link>
					</div>
				</>
			)}
		</span>
	);
}

function SwapAnythingSection() {
	const [selections, setSelections] = useState<Record<string, number>>({
		kv: 0,
		queue: 0,
		search: 0,
		realtime: 0,
		storage: 0,
		email: 0,
	});

	const handleSelect = (key: string, index: number) => {
		setSelections((prev) => ({ ...prev, [key]: index }));
	};

	return (
		<>
			<SectionHeader
				num="03"
				title="Swap anything"
				subtitle="Your infrastructure. Your choice. Click any adapter in the config to swap it."
			/>

			<div className="bg-border border-border grid grid-cols-1 gap-[1px] border lg:grid-cols-[1fr_1.2fr]">
				{/* Left: adapter grid */}
				<div className="bg-border grid grid-cols-2 gap-[1px]">
					{ADAPTER_CATEGORIES.map((cat) => (
						<div key={cat.key} className="bg-background p-5">
							<div className="text-muted-foreground mb-2 font-mono text-[10px] tracking-[0.15em] uppercase">
								{cat.label}
							</div>
							<div className="flex flex-wrap gap-1">
								{cat.options.map((opt, i) => (
									<button
										key={opt.label}
										type="button"
										disabled={opt.soon}
										onClick={() => !opt.soon && handleSelect(cat.key, i)}
										className={cn(
											"border px-2 py-0.5 font-mono text-[11px] transition-all",
											opt.soon
												? "border-border/50 text-muted-foreground/30 cursor-default"
												: selections[cat.key] === i
													? "border-primary bg-primary/10 text-primary"
													: "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
										)}
									>
										{opt.label}
										{opt.soon && (
											<span className="text-muted-foreground/30 ml-1 text-[8px] uppercase">
												soon
											</span>
										)}
									</button>
								))}
							</div>
						</div>
					))}
					<Link
						to="/docs/$"
						params={{ _splat: "extend/custom-adapters" }}
						className="bg-background text-muted-foreground hover:text-primary col-span-2 flex flex-col justify-center p-5 transition-colors"
					>
						<div className="text-primary mb-2 font-mono text-[10px] tracking-[0.15em] uppercase">
							Custom
						</div>
						<div className="flex items-center gap-1.5 font-mono text-[12px]">
							<Icon ssr icon="ph:code" width={14} height={14} />
							Write your own adapter
							<Icon
								icon="ph:arrow-right"
								width={12}
								height={12}
								className="ml-auto"
							/>
						</div>
					</Link>
				</div>

				{/* Right: live config with inline dropdowns */}
				<div className="bg-background border-border relative overflow-visible border-l-0 lg:border-l">
					<div className="text-muted-foreground/40 border-border absolute top-0 left-0 z-10 border-r border-b px-2 py-1 font-mono text-[10px] tracking-[0.2em] uppercase">
						questpie.config.ts
					</div>
					<div className="text-muted-foreground p-4 pt-10 font-mono text-[13px] leading-[1.8] whitespace-pre">
						<span className="text-[var(--syntax-function)]">runtimeConfig</span>
						{"({\n"}
						{ADAPTER_CATEGORIES.map((cat) => {
							const opt = cat.options[selections[cat.key]];
							const fnIdx = opt.code.indexOf(opt.fn);
							const before = opt.code.slice(0, fnIdx);
							const after = opt.code.slice(fnIdx + opt.fn.length);

							return (
								<span key={cat.key}>
									{"  "}
									{before}
									<AdapterDropdown
										category={cat}
										selected={selections[cat.key]}
										onSelect={(idx) => handleSelect(cat.key, idx)}
									/>
									{after}
									{",\n"}
								</span>
							);
						})}
						{"})"}
					</div>
					<div className="text-muted-foreground border-border mx-4 border-t px-1 py-3 text-[11px]">
						Click the{" "}
						<span className="text-[var(--syntax-function)]">
							highlighted adapters
						</span>{" "}
						to swap. Under 50 lines to{" "}
						<Link
							to="/docs/$"
							params={{ _splat: "extend/custom-adapters" }}
							className="text-primary hover:underline"
						>
							write your own
						</Link>
						.
					</div>
				</div>
			</div>
		</>
	);
}

/* ─── File Conventions Section (with toggle) ─── */

function FileConventionsSection() {
	const [layout, setLayout] = useState<"by-type" | "by-feature">("by-type");

	const byTypeTree = (
		<>
			<span className="text-primary">src/questpie/server/</span>
			{`
├── collections/
│   ├── `}
			<span className="text-foreground font-bold">posts.ts</span>
			{`
│   └── `}
			<span className="text-foreground font-bold">users.ts</span>
			{`
├── routes/
│   └── `}
			<span className="text-foreground font-bold">admin/stats.ts</span>
			{`
├── blocks/
│   └── `}
			<span className="text-foreground font-bold">hero.ts</span>
			{`
├── jobs/
│   └── `}
			<span className="text-foreground font-bold">send-newsletter.ts</span>
			{`
├── services/
│   └── `}
			<span className="text-foreground font-bold">stripe.ts</span>
			{`
├── seeds/
│   └── `}
			<span className="text-foreground font-bold">demo-data.ts</span>
			{`
└── `}
			<span className="text-foreground font-bold">auth.ts</span>
		</>
	);

	const byFeatureTree = (
		<>
			<span className="text-primary">src/questpie/server/</span>
			{`
├── blog/
│   ├── collections/
│   │   └── `}
			<span className="text-foreground font-bold">posts.ts</span>
			{`
│   ├── blocks/
│   │   └── `}
			<span className="text-foreground font-bold">hero.ts</span>
			{`
│   └── jobs/
│       └── `}
			<span className="text-foreground font-bold">newsletter.ts</span>
			{`
├── shop/
│   ├── collections/
│   │   ├── `}
			<span className="text-foreground font-bold">products.ts</span>
			{`
│   │   └── `}
			<span className="text-foreground font-bold">orders.ts</span>
			{`
│   └── services/
│       └── `}
			<span className="text-foreground font-bold">stripe.ts</span>
			{`
├── shared/
│   ├── collections/
│   │   └── `}
			<span className="text-foreground font-bold">users.ts</span>
			{`
│   └── routes/
│       └── `}
			<span className="text-foreground font-bold">stats.ts</span>
			{`
└── `}
			<span className="text-foreground font-bold">auth.ts</span>
		</>
	);

	const byTypeBadges = [
		["posts.ts", "CRUD + API + ADMIN", "text-[var(--syntax-string)]"],
		["users.ts", "AUTH-CONNECTED ENTITY", "text-[var(--syntax-string)]"],
		["admin/stats.ts", "TYPE-SAFE ROUTE", "text-primary"],
		["hero.ts", "VISUAL BLOCK", "text-[var(--syntax-number)]"],
		["send-newsletter.ts", "BACKGROUND JOB", "text-[var(--syntax-type)]"],
		["stripe.ts", "SINGLETON SERVICE", "text-muted-foreground"],
		["demo-data.ts", "DB SEED", "text-muted-foreground"],
		["auth.ts", "BETTER AUTH", "text-muted-foreground"],
	];

	const byFeatureBadges = [
		["blog/collections/posts.ts", "COLLECTION", "text-[var(--syntax-string)]"],
		["blog/blocks/hero.ts", "BLOCK", "text-[var(--syntax-number)]"],
		["blog/jobs/newsletter.ts", "JOB", "text-[var(--syntax-type)]"],
		[
			"shop/collections/products.ts",
			"COLLECTION",
			"text-[var(--syntax-string)]",
		],
		["shop/collections/orders.ts", "COLLECTION", "text-[var(--syntax-string)]"],
		["shop/services/stripe.ts", "SERVICE", "text-muted-foreground"],
		[
			"shared/collections/users.ts",
			"COLLECTION",
			"text-[var(--syntax-string)]",
		],
		["shared/routes/stats.ts", "ROUTE", "text-primary"],
	];

	const badges = layout === "by-type" ? byTypeBadges : byFeatureBadges;

	return (
		<>
			<SectionHeader
				num="02"
				title="File system = source of truth"
				subtitle="Drop a file. Get a feature. Codegen discovers everything. No manual registration."
			/>

			<div className="bg-border border-border grid grid-cols-1 gap-[1px] border md:grid-cols-2">
				<div className="bg-background p-8 font-mono text-[13px] leading-[1.8]">
					<div className="border-border mb-6 flex gap-6 border-b pb-2">
						{(["by-type", "by-feature"] as const).map((mode) => (
							<button
								key={mode}
								type="button"
								onClick={() => setLayout(mode)}
								className={cn(
									"-mb-[9px] pb-2 font-mono text-[13px] transition-colors",
									layout === mode
										? "text-foreground border-primary border-b-2 font-bold"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{mode === "by-type" ? "By type" : "By feature"}
							</button>
						))}
					</div>
					<pre className="text-muted-foreground text-[13px] leading-[1.8]">
						{layout === "by-type" ? byTypeTree : byFeatureTree}
					</pre>
				</div>
				<div className="bg-background flex flex-col justify-center gap-6 p-8">
					{badges.map(([name, badge, color]) => (
						<div key={name}>
							<div className="text-foreground mb-1 font-mono text-[12px] font-bold">
								{name}
							</div>
							<div
								className={cn(
									"font-mono text-[10px] tracking-[0.1em] uppercase",
									color,
								)}
							>
								{badge}
							</div>
						</div>
					))}
				</div>
			</div>
		</>
	);
}

/* ─── Nav ─── */

const navItems = [
	{ label: "Docs", href: "/docs/$", type: "internal" as const },
	{
		label: "Examples",
		href: "/docs/$",
		type: "internal" as const,
		params: { _splat: "examples" },
	},
	{
		label: "GitHub",
		href: "https://github.com/questpie/questpie",
		type: "external" as const,
	},
];

function Nav() {
	const [isScrolled, setIsScrolled] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);

	useEffect(() => {
		const handleScroll = () => setIsScrolled(window.scrollY > 8);
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	return (
		<header
			className={cn(
				"bg-background fixed inset-x-0 top-0 z-50 h-14 border-b transition-colors duration-200",
				isScrolled ? "border-border" : "border-border",
			)}
		>
			<div className="border-border bg-background mx-auto flex h-full max-w-[1200px] items-center justify-between border-x px-4 md:px-8">
				<div className="flex items-center gap-8">
					<Link to="/" className="flex items-center gap-2">
						<img
							src="/symbol/symbol-light.svg"
							alt="QUESTPIE"
							className="block h-6 w-auto sm:hidden dark:hidden"
						/>
						<img
							src="/symbol/symbol-dark.svg"
							alt="QUESTPIE"
							className="hidden h-6 w-auto dark:block dark:sm:hidden"
						/>
						<img
							src="/logo/horizontal-lockup-light.svg"
							alt="QUESTPIE"
							className="hidden h-5 w-auto sm:block dark:hidden"
						/>
						<img
							src="/logo/horizontal-lockup-dark.svg"
							alt="QUESTPIE"
							className="hidden h-5 w-auto dark:sm:block"
						/>
					</Link>

					<div className="text-muted-foreground hidden items-center gap-6 font-mono text-[12px] font-medium md:flex">
						{navItems.map((item) =>
							item.type === "internal" ? (
								<Link
									key={item.label}
									to={item.href}
									params={item.params as never}
									className="hover:text-foreground transition-colors"
								>
									{item.label}
								</Link>
							) : (
								<a
									key={item.label}
									href={item.href}
									target="_blank"
									rel="noreferrer"
									className="hover:text-foreground transition-colors"
								>
									{item.label}
								</a>
							),
						)}
					</div>
				</div>

				<div className="flex items-center gap-4">
					<ThemeToggle />
					<Link
						to="/docs/$"
						params={{ _splat: "start-here/first-app" }}
						className="bg-primary text-primary-foreground hover:bg-primary/80 hidden items-center px-4 py-2 font-mono text-[13px] font-semibold tracking-[0.04em] uppercase transition-colors sm:inline-flex"
					>
						Get started
					</Link>
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground p-1.5 transition-colors md:hidden"
						onClick={() => setMobileOpen((v) => !v)}
						aria-label="Toggle navigation"
					>
						<svg
							className="h-5 w-5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
						>
							{mobileOpen ? (
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M6 18L18 6M6 6l12 12"
								/>
							) : (
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M4 6h16M4 12h16M4 18h16"
								/>
							)}
						</svg>
					</button>
				</div>
			</div>

			{mobileOpen && (
				<div className="border-border bg-background absolute inset-x-0 top-full border-b p-4 md:hidden">
					<div className="mx-auto flex max-w-[1200px] flex-col gap-3">
						<Link
							to="/docs/$"
							className="text-muted-foreground font-mono text-sm"
							onClick={() => setMobileOpen(false)}
						>
							Docs
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "examples" }}
							className="text-muted-foreground font-mono text-sm"
							onClick={() => setMobileOpen(false)}
						>
							Examples
						</Link>
						<a
							href="https://github.com/questpie/questpie"
							target="_blank"
							rel="noreferrer"
							className="text-muted-foreground font-mono text-sm"
							onClick={() => setMobileOpen(false)}
						>
							GitHub
						</a>
						<div className="bg-border my-1 h-px" />
						<div className="flex items-center justify-between">
							<ThemeToggle />
							<Link
								to="/docs/$"
								params={{ _splat: "start-here/first-app" }}
								className="bg-primary text-primary-foreground inline-flex h-7 items-center px-3 font-mono text-[10px] tracking-wider uppercase"
								onClick={() => setMobileOpen(false)}
							>
								Get started
							</Link>
						</div>
					</div>
				</div>
			)}
		</header>
	);
}

/* ─── Footer ─── */

function LandingFooter() {
	return (
		<footer className="border-border border-t">
			<div className="border-border mx-auto max-w-[1200px] border-x px-4 py-12 md:px-8">
				<div className="grid grid-cols-1 gap-12 md:grid-cols-4">
					<div className="md:col-span-1">
						<Link to="/" className="mb-4 flex items-center">
							<img
								src="/logo/horizontal-lockup-light.svg"
								alt="QUESTPIE"
								className="block h-4 w-auto dark:hidden"
							/>
							<img
								src="/logo/horizontal-lockup-dark.svg"
								alt="QUESTPIE"
								className="hidden h-4 w-auto dark:block"
							/>
						</Link>
						<p className="text-muted-foreground mb-4 text-[13px]">
							Open source &middot; Server-first TypeScript framework
						</p>
						<div className="text-muted-foreground font-mono text-[11px]">
							MIT License
						</div>
					</div>
					<div>
						<div className="mb-4 font-mono text-[12px] font-bold tracking-[0.04em] uppercase">
							Product
						</div>
						<ul className="text-muted-foreground space-y-2 text-[13px]">
							<li>
								<Link
									to="/docs/$"
									className="hover:text-foreground transition-colors"
								>
									Docs
								</Link>
							</li>
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "examples" }}
									className="hover:text-foreground transition-colors"
								>
									Examples
								</Link>
							</li>
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "start-here" }}
									className="hover:text-foreground transition-colors"
								>
									Getting Started
								</Link>
							</li>
							<li>
								<a
									href="https://github.com/questpie/questpie/releases"
									target="_blank"
									rel="noreferrer"
									className="hover:text-foreground transition-colors"
								>
									Releases
								</a>
							</li>
						</ul>
					</div>
					<div>
						<div className="mb-4 font-mono text-[12px] font-bold tracking-[0.04em] uppercase">
							Ecosystem
						</div>
						<ul className="text-muted-foreground space-y-2 text-[13px]">
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "frontend/adapters/hono" }}
									className="hover:text-foreground transition-colors"
								>
									Hono
								</Link>
							</li>
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "frontend/adapters/elysia" }}
									className="hover:text-foreground transition-colors"
								>
									Elysia
								</Link>
							</li>
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "frontend/adapters/nextjs" }}
									className="hover:text-foreground transition-colors"
								>
									Next.js
								</Link>
							</li>
							<li>
								<Link
									to="/docs/$"
									params={{ _splat: "frontend/tanstack-query" }}
									className="hover:text-foreground transition-colors"
								>
									TanStack
								</Link>
							</li>
						</ul>
					</div>
					<div>
						<div className="mb-4 font-mono text-[12px] font-bold tracking-[0.04em] uppercase">
							Community
						</div>
						<ul className="text-muted-foreground space-y-2 text-[13px]">
							<li>
								<a
									href="https://github.com/questpie/questpie"
									target="_blank"
									rel="noreferrer"
									className="hover:text-foreground transition-colors"
								>
									GitHub
								</a>
							</li>
							<li>
								<a
									href="https://github.com/questpie/questpie/issues"
									target="_blank"
									rel="noreferrer"
									className="hover:text-foreground transition-colors"
								>
									Issues
								</a>
							</li>
							<li>
								<a
									href="https://github.com/questpie/questpie/pulls"
									target="_blank"
									rel="noreferrer"
									className="hover:text-foreground transition-colors"
								>
									Pull Requests
								</a>
							</li>
						</ul>
					</div>
				</div>
				<div className="text-muted-foreground border-border mt-12 flex flex-col items-center justify-between gap-4 border-t pt-8 md:flex-row">
					<div className="text-[12px]">
						TypeScript &middot; Drizzle &middot; Zod &middot; Better Auth
						&middot; Hono
					</div>
				</div>
			</div>
		</footer>
	);
}

/* ═══════════════════════════════════════════════
   LANDING PAGE
   ═══════════════════════════════════════════════ */

export function LandingPage() {
	useEffect(() => {
		const obs = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) e.target.setAttribute("data-visible", "");
				}
			},
			{ threshold: 0.1 },
		);
		document.querySelectorAll("[data-reveal]").forEach((el) => obs.observe(el));
		return () => obs.disconnect();
	}, []);

	return (
		<div className="landing bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
			<Nav />

			<main className="bg-grid-quest">
				<div className="border-border mx-auto max-w-[1200px] border-x">
					{/* ─── HERO ─── */}
					<section className="mt-14 px-4 py-24 md:px-8">
						<div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-24">
							<div>
								<div className="text-primary mb-6 font-mono text-[12px] font-semibold tracking-[0.04em] uppercase">
									Open source framework
								</div>
								<h1 className="text-foreground mb-6 font-mono text-4xl leading-[1.1] font-extrabold tracking-[-0.03em] text-balance md:text-5xl">
									One backend.
									<br />
									Ship everywhere.
								</h1>
								<p className="text-muted-foreground mb-8 max-w-xl text-lg leading-[1.6] md:text-xl">
									Define your schema once. Get REST, typed routes, realtime,
									typed client SDK, and optional admin UI. Server-first
									TypeScript. Built on Drizzle, Zod, Better Auth.
								</p>
								<div className="mb-12 flex flex-wrap items-center gap-4">
									<Link
										to="/docs/$"
										params={{ _splat: "start-here/first-app" }}
										className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex items-center gap-2 px-4 py-2 font-mono text-[13px] font-semibold tracking-[0.04em] uppercase transition-colors"
									>
										Get started{" "}
										<Icon ssr icon="ph:arrow-right" width={16} height={16} />
									</Link>
									<a
										href="https://github.com/questpie/questpie"
										target="_blank"
										rel="noreferrer"
										className="border-border text-foreground hover:bg-secondary inline-flex items-center gap-2 border px-4 py-2 font-mono text-[13px] font-semibold tracking-[0.04em] uppercase transition-colors"
									>
										<Icon ssr icon="ph:github-logo" width={16} height={16} />{" "}
										GitHub &#9733;
									</a>
								</div>
								<div className="flex flex-wrap gap-2">
									{[
										"TypeScript",
										"Server-first",
										"Zero lock-in",
										"MIT license",
									].map((t) => (
										<Badge key={t}>{t}</Badge>
									))}
								</div>
							</div>

							<div className="relative">
								<TerminalBlock label="src/questpie/server/collections/posts.ts">
									<span className="text-primary font-semibold">collection</span>
									(<span className="text-[var(--syntax-string)]">"posts"</span>)
									{`
  .`}
									<span className="text-[var(--syntax-function)]">fields</span>
									{`(({ f }) => ({
    title:   f.`}
									<span className="text-[var(--syntax-function)]">text</span>(
									<span className="text-[var(--syntax-number)]">255</span>).
									<span className="text-[var(--syntax-function)]">
										required
									</span>
									{`(),
    content: f.`}
									<span className="text-[var(--syntax-function)]">
										richText
									</span>
									().
									<span className="text-[var(--syntax-function)]">
										localized
									</span>
									{`(),
    status:  f.`}
									<span className="text-[var(--syntax-function)]">select</span>
									{`([
      { value: `}
									<span className="text-[var(--syntax-string)]">"draft"</span>
									{`, label: `}
									<span className="text-[var(--syntax-string)]">"Draft"</span>
									{` },
      { value: `}
									<span className="text-[var(--syntax-string)]">
										"published"
									</span>
									{`, label: `}
									<span className="text-[var(--syntax-string)]">
										"Published"
									</span>
									{` },
    ]),
    author:  f.`}
									<span className="text-[var(--syntax-function)]">
										relation
									</span>
									(<span className="text-[var(--syntax-string)]">"users"</span>
									).
									<span className="text-[var(--syntax-function)]">
										required
									</span>
									{`(),
    cover:   f.`}
									<span className="text-[var(--syntax-function)]">file</span>().
									<span className="text-[var(--syntax-function)]">image</span>
									{`(),
    tags:    f.`}
									<span className="text-[var(--syntax-function)]">
										relation
									</span>
									(<span className="text-[var(--syntax-string)]">"tags"</span>).
									<span className="text-[var(--syntax-function)]">hasMany</span>
									{`({ foreignKey: `}
									<span className="text-[var(--syntax-string)]">"postId"</span>
									{` }),
    seo:     f.`}
									<span className="text-[var(--syntax-function)]">object</span>
									{`({
      title: f.`}
									<span className="text-[var(--syntax-function)]">text</span>
									{`(),
      desc:  f.`}
									<span className="text-[var(--syntax-function)]">text</span>(
									<span className="text-[var(--syntax-number)]">160</span>)
									{`,
    }),
  }))
  .`}
									<span className="text-[var(--syntax-function)]">access</span>
									{`({
    read:   `}
									<span className="text-primary font-semibold">true</span>
									{`,
    create: ({ session }) => !!session,
    update: ({ session, doc }) =>
      doc.authorId === session?.user?.id,
  })
  .`}
									<span className="text-[var(--syntax-function)]">
										versioning
									</span>
									{`({ enabled: `}
									<span className="text-primary font-semibold">true</span>
									{`, maxVersions: `}
									<span className="text-[var(--syntax-number)]">10</span>
									{` })`}
								</TerminalBlock>
								<div className="bg-primary text-primary-foreground border-border absolute -top-6 -right-6 hidden border p-4 font-mono text-[12px] shadow-2xl md:block">
									<div className="mb-1 flex items-center gap-2">
										<Icon ssr icon="ph:check" width={12} height={12} /> REST API
									</div>
									<div className="mb-1 flex items-center gap-2">
										<Icon ssr icon="ph:check" width={12} height={12} /> Typed
										client SDK
									</div>
									<div className="mb-1 flex items-center gap-2">
										<Icon ssr icon="ph:check" width={12} height={12} /> Admin
										panel
									</div>
									<div className="flex items-center gap-2">
										<Icon ssr icon="ph:check" width={12} height={12} /> Zod
										validation
									</div>
								</div>
							</div>
						</div>
					</section>

					{/* ─── §01 ONE SCHEMA ─── */}
					<Reveal>
						<section className="border-border border-t px-4 py-16 md:px-8 md:py-24">
							<SectionHeader
								num="01"
								title="One schema, everything generated"
								subtitle="Define once. Get the rest for free."
							/>

							<div className="bg-border border-border grid grid-cols-1 gap-[1px] border lg:grid-cols-12">
								<div className="bg-background lg:col-span-5">
									<TerminalBlock label="schema.ts">
										<span className="text-muted-foreground/60">
											{"// This one definition generates:"}
										</span>
										{"\n"}
										<span className="text-muted-foreground/60">
											{"// REST, Routes, Admin, Validation,"}
										</span>
										{"\n"}
										<span className="text-muted-foreground/60">
											{"// Client SDK, Realtime, Search"}
										</span>
										{"\n\n"}
										<span className="text-primary font-semibold">
											collection
										</span>
										(
										<span className="text-[var(--syntax-string)]">"posts"</span>
										)
										{`
  .`}
										<span className="text-[var(--syntax-function)]">
											fields
										</span>
										{`(({ f }) => ({
    title:   f.`}
										<span className="text-[var(--syntax-function)]">text</span>(
										<span className="text-[var(--syntax-number)]">255</span>).
										<span className="text-[var(--syntax-function)]">
											required
										</span>
										{`(),
    content: f.`}
										<span className="text-[var(--syntax-function)]">
											richText
										</span>
										().
										<span className="text-[var(--syntax-function)]">
											localized
										</span>
										{`(),
    status:  f.`}
										<span className="text-[var(--syntax-function)]">
											select
										</span>
										{`([...]).`}
										<span className="text-[var(--syntax-function)]">
											required
										</span>
										{`(),
    author:  f.`}
										<span className="text-[var(--syntax-function)]">
											relation
										</span>
										(
										<span className="text-[var(--syntax-string)]">"users"</span>
										)
										{`,
    cover:   f.`}
										<span className="text-[var(--syntax-function)]">file</span>
										().
										<span className="text-[var(--syntax-function)]">image</span>
										{`(),
  }))`}
									</TerminalBlock>
								</div>
								<div className="bg-border grid grid-cols-1 gap-[1px] sm:grid-cols-2 lg:col-span-7">
									{[
										["ph:globe", "REST API", "/api/collections/posts"],
										["ph:file-code", "Typed routes", "typed, namespaced"],
										["ph:activity", "Realtime via SSE", "subscribe to changes"],
										["ph:cube", "Typed client SDK", "auto-generated types"],
										["ph:layout", "Admin panel", "table, form, block editor"],
										["ph:check", "Zod validation", "from field definitions"],
										["ph:lock", "Access control", "row-level, field-level"],
										[
											"ph:stack",
											"Versioning",
											"workflow stages, drafts \u2192 published",
										],
										[
											"ph:globe",
											"i18n",
											"two-table strategy, per-field localization",
										],
										[
											"ph:hard-drives",
											"File Storage",
											"auto-managed uploads & assets",
										],
									].map(([icon, title, desc]) => (
										<div key={title} className="bg-background p-6">
											<div className="text-primary mb-2 flex items-center gap-2">
												<Icon ssr icon={icon} width={16} height={16} />
												<span className="text-foreground font-mono text-[13px] font-bold">
													{title}
												</span>
											</div>
											<p className="text-muted-foreground font-mono text-[11px]">
												{desc}
											</p>
										</div>
									))}
								</div>
							</div>
						</section>
					</Reveal>

					{/* ─── §02 FILE CONVENTIONS ─── */}
					<Reveal>
						<section className="border-border border-t px-4 py-16 md:px-8 md:py-24">
							<FileConventionsSection />
						</section>
					</Reveal>

					{/* ─── §03 SWAP ANYTHING ─── */}
					<Reveal>
						<section className="border-border border-t px-4 py-16 md:px-8 md:py-24">
							<SwapAnythingSection />
						</section>
					</Reveal>

					{/* ─── §04 OPTIONAL ADMIN ─── */}
					<Reveal>
						<section className="border-border border-t px-4 py-16 md:px-8 md:py-24">
							<SectionHeader
								num="04"
								title="Optional admin"
								subtitle="Ship the admin panel only when you need it. Swappable package. Web, React Native, or build your own."
							/>

							<div className="bg-border border-border grid grid-cols-1 gap-[1px] border lg:grid-cols-2">
								<div className="bg-background">
									<TerminalBlock label="admin.ts">
										<span className="text-primary font-semibold">
											collection
										</span>
										(
										<span className="text-[var(--syntax-string)]">"posts"</span>
										)
										{`
  .`}
										<span className="text-[var(--syntax-function)]">admin</span>
										{`(({ c }) => ({
    label: { en: `}
										<span className="text-[var(--syntax-string)]">"Posts"</span>
										{`, sk: `}
										<span className="text-[var(--syntax-string)]">
											"Príspevky"
										</span>
										{` },
    icon: c.`}
										<span className="text-[var(--syntax-function)]">icon</span>(
										<span className="text-[var(--syntax-string)]">
											"ph:article"
										</span>
										)
										{`,
  }))
  .`}
										<span className="text-[var(--syntax-function)]">list</span>
										{`(({ v, f }) => v.`}
										<span className="text-[var(--syntax-function)]">table</span>
										{`({
    columns: [`}
										<span className="text-[var(--syntax-string)]">"title"</span>
										{`, `}
										<span className="text-[var(--syntax-string)]">
											"status"
										</span>
										{`, `}
										<span className="text-[var(--syntax-string)]">
											"author"
										</span>
										{`],
    defaultSort: { field: f.createdAt, direction: `}
										<span className="text-[var(--syntax-string)]">"desc"</span>
										{` },
  }))
  .`}
										<span className="text-[var(--syntax-function)]">form</span>
										{`(({ v, f }) => v.`}
										<span className="text-[var(--syntax-function)]">form</span>
										{`({
    fields: [f.title, f.content],
    sidebar: { fields: [f.status, f.author] },
  }))`}
									</TerminalBlock>
								</div>
								<div className="bg-background flex flex-col p-6">
									<div className="border-border flex flex-1 flex-col border">
										<div className="border-border bg-card flex h-10 items-center justify-between border-b px-4">
											<div className="font-mono text-[12px] font-bold">
												Admin
											</div>
											<div className="flex gap-2">
												<div className="bg-border h-2 w-2" />
												<div className="bg-border h-2 w-2" />
												<div className="bg-border h-2 w-2" />
											</div>
										</div>
										<div className="flex flex-1">
											<div className="border-border hidden w-32 border-r p-4 sm:block">
												<ul className="text-muted-foreground space-y-3 font-mono text-[11px]">
													<li className="text-primary font-bold">Posts</li>
													<li>Users</li>
													<li>Settings</li>
													<li>Assets</li>
													<li>Audit log</li>
												</ul>
											</div>
											<div className="flex-1 overflow-x-auto p-4">
												<table className="w-full border-collapse text-left">
													<thead>
														<tr>
															<th className="text-muted-foreground border-border border-b pb-2 font-mono text-[10px] font-normal uppercase">
																Title
															</th>
															<th className="text-muted-foreground border-border border-b pb-2 font-mono text-[10px] font-normal uppercase">
																Status
															</th>
															<th className="text-muted-foreground border-border border-b pb-2 font-mono text-[10px] font-normal uppercase">
																Author
															</th>
														</tr>
													</thead>
													<tbody className="text-[13px]">
														<tr>
															<td className="text-foreground border-border border-b py-3 pr-4 whitespace-nowrap">
																Getting Started Guide
															</td>
															<td className="border-border border-b py-3 pr-4">
																<Badge>PUBLISHED</Badge>
															</td>
															<td className="text-muted-foreground border-border border-b py-3 pr-4">
																admin
															</td>
														</tr>
														<tr>
															<td className="text-foreground border-border border-b py-3 pr-4 whitespace-nowrap">
																Adapter Architecture
															</td>
															<td className="border-border border-b py-3 pr-4">
																<span className="bg-border text-muted-foreground px-2 py-0.5 font-mono text-[11px] uppercase">
																	DRAFT
																</span>
															</td>
															<td className="text-muted-foreground border-border border-b py-3 pr-4">
																admin
															</td>
														</tr>
														<tr>
															<td className="text-foreground border-border border-b py-3 pr-4 whitespace-nowrap">
																File Conventions
															</td>
															<td className="border-border border-b py-3 pr-4">
																<Badge>PUBLISHED</Badge>
															</td>
															<td className="text-muted-foreground border-border border-b py-3 pr-4">
																admin
															</td>
														</tr>
													</tbody>
												</table>
											</div>
										</div>
									</div>
								</div>
							</div>
						</section>
					</Reveal>

					{/* ─── §05 END-TO-END TYPES ─── */}
					<Reveal>
						<section className="border-border border-t px-4 py-16 md:px-8 md:py-24">
							<SectionHeader
								num="05"
								title="End-to-end types"
								subtitle="Schema to screen. Zero disconnect. Change a field — TypeScript catches it everywhere."
							/>

							<div className="bg-border border-border grid grid-cols-1 gap-[1px] border lg:grid-cols-12">
								<div className="bg-background flex flex-col justify-center gap-4 p-8 lg:col-span-4">
									{[
										{ n: "1", label: "Field def", active: false },
										{ n: "2", label: "Codegen", active: false },
										{
											n: "3",
											label: "Drizzle table & Zod schema",
											active: false,
										},
										{ n: "4", label: "Client SDK", active: false },
										{ n: "5", label: "React", active: true },
									].map((step, i) => (
										<div key={step.n}>
											{i > 0 && (
												<div className="bg-border mb-4 ml-4 h-4 w-px" />
											)}
											<div className="flex items-center gap-4">
												<div
													className={cn(
														"flex h-8 w-8 items-center justify-center font-mono text-[12px]",
														step.active
															? "bg-primary text-primary-foreground"
															: "bg-secondary text-primary",
													)}
												>
													{step.n}
												</div>
												<div
													className={cn(
														"text-foreground font-mono text-[13px]",
														step.active && "font-bold",
													)}
												>
													{step.label}
												</div>
											</div>
										</div>
									))}
								</div>
								<div className="bg-background lg:col-span-8">
									<TerminalBlock label="client.ts">
										<span className="text-primary font-semibold">const</span>
										{` { docs } = `}
										<span className="text-primary font-semibold">await</span>
										{` client.collections.posts.`}
										<span className="text-[var(--syntax-function)]">find</span>
										{`({
  where: { status: { eq: `}
										<span className="text-[var(--syntax-string)]">
											"published"
										</span>
										{` } },
  orderBy: { createdAt: `}
										<span className="text-[var(--syntax-string)]">"desc"</span>
										{` },
  with: { author: `}
										<span className="text-primary font-semibold">true</span>
										{`, tags: `}
										<span className="text-primary font-semibold">true</span>
										{` },
  locale: `}
										<span className="text-[var(--syntax-string)]">"sk"</span>
										{`,
});

`}
										<span className="text-muted-foreground/60">
											{"// docs[0].title → string"}
										</span>
										{"\n"}
										<span className="text-muted-foreground/60">
											{"// docs[0].author → User"}
										</span>
										{"\n"}
										<span className="text-muted-foreground/60">
											{"// docs[0].tags → Tag[]"}
										</span>
									</TerminalBlock>
								</div>
							</div>
						</section>
					</Reveal>

					{/* ─── §06 COMPOSABLE ─── */}
					<Reveal>
						<section className="border-border border-t px-4 py-16 md:px-8 md:py-24">
							<SectionHeader
								num="06"
								title="Composable"
								subtitle="Core parts = user code. Modules compose depth-first with deduplication. Every module uses the exact same conventions as user code."
							/>

							<BrutalistGrid>
								<FeatureCell
									num="01"
									title="questpie-starter"
									desc="Auth, users, sessions, API keys, assets. Better Auth integration. Default access. i18n messages."
								/>
								<FeatureCell
									num="02"
									title="questpie-admin"
									desc="Admin UI. 18 field renderers, 3 view types, sidebar, dashboard widgets. Table, form, block editor."
								/>
								<FeatureCell
									num="03"
									title="questpie-audit"
									desc="Change logging via global hooks. Every create, update, delete tracked. Zero config required."
								/>
								<FeatureCell
									num="04"
									title="Your module"
									desc="Same file conventions, same patterns. Build your own module. Publish to npm. No special APIs."
								/>
							</BrutalistGrid>
						</section>
					</Reveal>

					{/* ─── §07 DX ─── */}
					<Reveal>
						<section className="border-border border-t px-4 py-16 md:px-8 md:py-24">
							<SectionHeader
								num="07"
								title="Developer experience"
								subtitle="The details matter. Instant regeneration, typed scaffolding, build-time validation."
							/>

							<div className="bg-border border-border grid grid-cols-1 gap-[1px] border md:grid-cols-2">
								<div className="bg-background p-8">
									<div className="text-muted-foreground mb-4 font-mono text-[11px] tracking-[0.1em] uppercase">
										WATCH
									</div>
									<div className="text-muted-foreground font-mono text-[13px] leading-[1.6]">
										<span className="text-primary">$</span> questpie dev
										{"\n"}
										<span className="text-[var(--status-success)]">
											&#10003;
										</span>{" "}
										Watching...
										{"\n"}
										<span className="text-[var(--status-success)]">
											&#10003;
										</span>{" "}
										server (23 collections)
										{"\n"}
										<span className="text-[var(--status-success)]">
											&#10003;
										</span>{" "}
										admin-client (15 blocks)
									</div>
								</div>
								<div className="bg-background p-8">
									<div className="text-muted-foreground mb-4 font-mono text-[11px] tracking-[0.1em] uppercase">
										SCAFFOLD
									</div>
									<div className="text-muted-foreground font-mono text-[13px] leading-[1.6]">
										<span className="text-primary">$</span> questpie add
										collection products
										{"\n"}
										<span className="text-[var(--status-success)]">
											&#10003;
										</span>{" "}
										Created collections/products.ts
										{"\n"}
										<span className="text-[var(--status-success)]">
											&#10003;
										</span>{" "}
										Regenerated types
									</div>
								</div>
								<div className="bg-background p-8">
									<div className="text-muted-foreground mb-4 font-mono text-[11px] tracking-[0.1em] uppercase">
										VALIDATE
									</div>
									<div className="text-muted-foreground font-mono text-[13px] leading-[1.6]">
										<span className="text-destructive">
											&#10007; Server defines blocks/hero
										</span>
										{"\n"}
										<span className="text-destructive">
											{"  "}but no renderer found
										</span>
										{"\n"}
										<span className="text-primary">
											&rarr; Create admin/blocks/hero.tsx
										</span>
									</div>
								</div>
								<div className="bg-background p-8">
									<div className="text-muted-foreground mb-4 font-mono text-[11px] tracking-[0.1em] uppercase">
										REALTIME
									</div>
									<div className="text-muted-foreground font-mono text-[13px] leading-[1.6]">
										{`client.realtime.`}
										<span className="text-[var(--syntax-function)]">
											subscribe
										</span>
										{`(
  { resource: `}
										<span className="text-[var(--syntax-string)]">"posts"</span>
										{` },
  (event) => `}
										<span className="text-[var(--syntax-function)]">
											updateUI
										</span>
										{`(event)
);`}
									</div>
								</div>
							</div>
						</section>
					</Reveal>

					{/* ─── CTA ─── */}
					<section className="border-border border-t px-4 py-24 text-center md:px-8 md:py-32">
						<div className="mb-8">
							<img
								src="/symbol/symbol-light.svg"
								alt="Q"
								className="mx-auto block h-12 w-12 dark:hidden"
							/>
							<img
								src="/symbol/symbol-dark.svg"
								alt="Q"
								className="mx-auto hidden h-12 w-12 dark:block"
							/>
						</div>
						<h2 className="text-foreground mb-6 font-mono text-4xl font-extrabold md:text-5xl">
							One backend. Ship everywhere.
						</h2>
						<div className="bg-secondary border-border mb-8 inline-flex items-center gap-4 border px-6 py-3">
							<span className="text-primary font-mono">$</span>
							<span className="font-mono text-[14px]">npx create-questpie</span>
						</div>
						<div className="flex flex-wrap items-center justify-center gap-4">
							<Link
								to="/docs/$"
								params={{ _splat: "start-here/first-app" }}
								className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex items-center gap-2 px-4 py-2 font-mono text-[13px] font-semibold tracking-[0.04em] uppercase transition-colors"
							>
								Read the docs{" "}
								<Icon ssr icon="ph:arrow-right" width={16} height={16} />
							</Link>
							<Link
								to="/docs/$"
								params={{ _splat: "examples" }}
								className="border-border text-foreground hover:bg-secondary inline-flex items-center gap-2 border px-4 py-2 font-mono text-[13px] font-semibold tracking-[0.04em] uppercase transition-colors"
							>
								Browse examples{" "}
								<Icon ssr icon="ph:arrow-right" width={16} height={16} />
							</Link>
							<a
								href="https://github.com/questpie/questpie"
								target="_blank"
								rel="noreferrer"
								className="text-primary inline-flex items-center gap-2 bg-transparent font-mono text-[13px] font-semibold tracking-[0.04em] uppercase hover:underline"
							>
								<Icon ssr icon="ph:github-logo" width={16} height={16} /> Star
								on GitHub
							</a>
						</div>
					</section>
				</div>
			</main>

			<LandingFooter />
		</div>
	);
}
