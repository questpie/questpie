import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

/* ─── Helpers ─── */

function SectionBar({
	num,
	label,
	title,
}: {
	num: string;
	label: string;
	title: string;
}) {
	return (
		<div className="border-border grid grid-cols-[auto_1fr] border-b">
			<div className="bg-card text-primary border-border flex min-w-[100px] items-center justify-center border-r px-5 py-4 text-center font-mono text-5xl leading-none font-extrabold max-sm:min-w-[72px] max-sm:px-4 max-sm:text-3xl">
				{num}
			</div>
			<div className="flex flex-col justify-center px-5 py-4">
				<div className="text-primary font-mono text-[10px] tracking-[3px] uppercase">
					{label}
				</div>
				<div className="text-foreground mt-0.5 font-mono text-[clamp(18px,2.5vw,24px)] font-bold">
					{title}
				</div>
			</div>
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

function Lmw({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"border-border relative z-[1] mx-auto max-w-[1200px] border-x",
				className,
			)}
		>
			{children}
		</div>
	);
}

function TwoCol({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("grid grid-cols-2 max-[900px]:grid-cols-1", className)}>
			{children}
		</div>
	);
}

function TwoColLeft({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"border-border border-border border-r border-b p-6 max-[900px]:border-r-0",
				className,
			)}
		>
			{children}
		</div>
	);
}

function TwoColRight({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("border-border border-b p-6", className)}>
			{children}
		</div>
	);
}

/* ─── File Conventions Section (with toggle) ─── */

function FileConventionsSection() {
	const [layout, setLayout] = useState<"by-type" | "by-feature">("by-type");

	const byTypeTree = (
		<pre className="px-5 py-4" style={{ fontSize: 12 }}>
			<span className="text-muted-foreground/60">src/questpie/server/</span>
			{`
├── collections/
│   ├── `}
			<span className="text-primary font-semibold">posts.ts</span>
			{`
│   └── `}
			<span className="text-primary font-semibold">users.ts</span>
			{`
├── routes/
│   └── `}
			<span className="text-primary font-semibold">admin/stats.ts</span>
			{`
├── blocks/
│   └── `}
			<span className="text-primary font-semibold">hero.ts</span>
			{`
├── jobs/
│   └── `}
			<span className="text-primary font-semibold">send-newsletter.ts</span>
			{`
├── services/
│   └── `}
			<span className="text-primary font-semibold">stripe.ts</span>
			{`
├── seeds/
│   └── `}
			<span className="text-primary font-semibold">demo-data.ts</span>
			{`
└── `}
			<span className="text-primary font-semibold">auth.ts</span>
		</pre>
	);

	const byFeatureTree = (
		<pre className="px-5 py-4" style={{ fontSize: 12 }}>
			<span className="text-muted-foreground/60">src/questpie/server/</span>
			{`
├── blog/
│   ├── collections/
│   │   └── `}
			<span className="text-primary font-semibold">posts.ts</span>
			{`
│   ├── blocks/
│   │   └── `}
			<span className="text-primary font-semibold">hero.ts</span>
			{`
│   └── jobs/
│       └── `}
			<span className="text-primary font-semibold">newsletter.ts</span>
			{`
├── shop/
│   ├── collections/
│   │   ├── `}
			<span className="text-primary font-semibold">products.ts</span>
			{`
│   │   └── `}
			<span className="text-primary font-semibold">orders.ts</span>
			{`
│   └── services/
│       └── `}
			<span className="text-primary font-semibold">stripe.ts</span>
			{`
├── shared/
│   ├── collections/
│   │   └── `}
			<span className="text-primary font-semibold">users.ts</span>
			{`
│   └── routes/
│       └── `}
			<span className="text-primary font-semibold">stats.ts</span>
			{`
└── `}
			<span className="text-primary font-semibold">auth.ts</span>
		</pre>
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
		<section>
			<Lmw>
				<SectionBar
					num="02"
					label="File system = source of truth"
					title="Drop a file. Get a feature."
				/>
				<div className="border-border flex border-b">
					{(["by-type", "by-feature"] as const).map((mode) => (
						<button
							key={mode}
							type="button"
							onClick={() => setLayout(mode)}
							className={cn(
								"border-border flex-1 border-r py-2 font-mono text-[10px] font-semibold tracking-[2px] uppercase transition-colors last:border-r-0",
								layout === mode
									? "bg-card text-primary"
									: "bg-background text-muted-foreground hover:text-foreground",
							)}
						>
							{mode === "by-type" ? "By type" : "By feature"}
						</button>
					))}
				</div>
				<TwoCol>
					<TwoColLeft className="bg-background text-muted-foreground p-0! font-mono text-xs leading-relaxed">
						{layout === "by-type" ? byTypeTree : byFeatureTree}
					</TwoColLeft>
					<TwoColRight className="p-0!">
						<div
							className="bg-border grid gap-px"
							style={{ gridTemplateColumns: "1fr" }}
						>
							{badges.map(([name, badge, color], i) => (
								<div
									key={`${layout}-${name}`}
									className="bg-background flex items-center justify-between px-5 py-2.5 text-[13px] motion-safe:animate-[stagger-fade-in_300ms_ease-out_both]"
									style={{
										animationDelay: `${i * 50}ms`,
									}}
								>
									<span className="text-foreground font-mono">{name}</span>
									<span
										className={cn("font-mono text-[10px] tracking-wide", color)}
									>
										{badge}
									</span>
								</div>
							))}
						</div>
						<div className="text-muted-foreground border-border border-t px-5 py-3 text-[11px]">
							{layout === "by-type"
								? "Grouped by type. Codegen discovers everything. No manual registration."
								: "Grouped by domain. Same conventions — codegen handles both layouts."}
						</div>
					</TwoColRight>
				</TwoCol>
			</Lmw>
		</section>
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
				"fixed inset-x-0 top-0 z-50 h-14 border-b transition-colors duration-200",
				isScrolled
					? "bg-background/95 border-border backdrop-blur-sm"
					: "bg-background border-border",
			)}
		>
			<div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-6 max-sm:px-3">
				<Link to="/" className="flex items-center gap-2">
					<img
						src="/symbol/Q-symbol-dark-pink.svg"
						alt="QUESTPIE"
						className="block h-6 w-auto sm:hidden dark:hidden"
					/>
					<img
						src="/symbol/Q-symbol-white-pink.svg"
						alt="QUESTPIE"
						className="hidden h-6 w-auto dark:block dark:sm:hidden"
					/>
					<img
						src="/logo/Questpie-dark-pink.svg"
						alt="QUESTPIE"
						className="hidden h-5 w-auto sm:block dark:hidden"
					/>
					<img
						src="/logo/Questpie-white-pink.svg"
						alt="QUESTPIE"
						className="hidden h-5 w-auto dark:sm:block"
					/>
				</Link>

				<div className="hidden items-center gap-6 md:flex">
					{navItems.map((item) =>
						item.type === "internal" ? (
							<Link
								key={item.label}
								to={item.href}
								params={item.params as never}
								className="text-muted-foreground hover:text-foreground font-mono text-[11px] font-medium tracking-wider uppercase transition-colors"
							>
								{item.label}
							</Link>
						) : (
							<a
								key={item.label}
								href={item.href}
								target="_blank"
								rel="noreferrer"
								className="text-muted-foreground hover:text-foreground font-mono text-[11px] font-medium tracking-wider uppercase transition-colors"
							>
								{item.label}
							</a>
						),
					)}
					<ThemeToggle />
					<Link
						to="/docs/$"
						params={{ _splat: "start-here/first-app" }}
						className="border-primary/40 bg-primary/10 text-primary hover:bg-primary inline-flex h-7 items-center justify-center border px-4 font-mono text-[10px] font-semibold tracking-wider uppercase transition-all hover:text-primary-foreground"
					>
						Get started
					</Link>
				</div>

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
								className="border-primary/40 bg-primary/10 text-primary inline-flex h-7 items-center border px-3 font-mono text-[10px] tracking-wider uppercase"
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
		<footer>
			<div className="mx-auto max-w-[1200px]">
				<div className="bg-border grid grid-cols-4 gap-px max-sm:grid-cols-2">
					<div className="bg-background p-5">
						<div className="text-muted-foreground/60 mb-2 font-mono text-[9px] tracking-[2px] uppercase">
							Product
						</div>
						<Link
							to="/docs/$"
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							Docs
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "examples" }}
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							Examples
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "start-here" }}
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							Getting Started
						</Link>
						<a
							href="https://github.com/questpie/questpie/releases"
							target="_blank"
							rel="noreferrer"
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							Releases
						</a>
					</div>
					<div className="bg-background p-5">
						<div className="text-muted-foreground/60 mb-2 font-mono text-[9px] tracking-[2px] uppercase">
							Ecosystem
						</div>
						<Link
							to="/docs/$"
							params={{ _splat: "frontend/adapters/hono" }}
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							Hono
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "frontend/adapters/elysia" }}
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							Elysia
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "frontend/adapters/nextjs" }}
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							Next.js
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "frontend/tanstack-query" }}
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							TanStack
						</Link>
					</div>
					<div className="bg-background p-5">
						<div className="text-muted-foreground/60 mb-2 font-mono text-[9px] tracking-[2px] uppercase">
							Community
						</div>
						<a
							href="https://github.com/questpie/questpie"
							target="_blank"
							rel="noreferrer"
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							GitHub
						</a>
						<a
							href="https://github.com/questpie/questpie/issues"
							target="_blank"
							rel="noreferrer"
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							Issues
						</a>
						<a
							href="https://github.com/questpie/questpie/pulls"
							target="_blank"
							rel="noreferrer"
							className="text-muted-foreground hover:text-primary block py-0.5 text-xs transition-colors"
						>
							Pull Requests
						</a>
					</div>
					<div className="bg-background p-5">
						<div className="text-muted-foreground/60 mb-2 font-mono text-[9px] tracking-[2px] uppercase">
							Install
						</div>
						<div className="text-primary mt-1 font-mono text-xs">
							npx create-questpie
						</div>
						<div className="text-muted-foreground mt-3 text-[10px] leading-relaxed">
							MIT License
							<br />
							TypeScript &middot; Drizzle &middot; Zod
							<br />
							Better Auth &middot; Hono
						</div>
					</div>
				</div>
				<div className="text-muted-foreground/60 flex flex-wrap items-center justify-between gap-2 px-6 py-4 text-[11px]">
					<Link to="/" className="flex items-center">
						<img
							src="/logo/Questpie-dark-pink.svg"
							alt="QUESTPIE"
							className="block h-4 w-auto dark:hidden"
						/>
						<img
							src="/logo/Questpie-white-pink.svg"
							alt="QUESTPIE"
							className="hidden h-4 w-auto dark:block"
						/>
					</Link>
					<span>Open source &middot; Server-first TypeScript framework</span>
				</div>
			</div>
		</footer>
	);
}

/* ─── §01 One Schema — hover highlight ─── */

const oneSchemaFeatures = [
	{ title: "REST API", desc: "/api/collections/posts", highlight: "fields" },
	{ title: "Typed routes", desc: "typed, namespaced", highlight: "fields" },
	{
		title: "Realtime via SSE",
		desc: "subscribe to changes",
		highlight: "fields",
	},
	{
		title: "Typed client SDK",
		desc: "auto-generated types",
		highlight: "fields",
	},
	{
		title: "Admin panel",
		desc: "table, form, block editor",
		highlight: "fields",
	},
	{
		title: "Zod validation",
		desc: "from field definitions",
		highlight: "fields",
	},
	{
		title: "Access control",
		desc: "row-level, field-level",
		highlight: "access",
	},
	{
		title: "i18n",
		desc: "two-table strategy, per-field localization",
		highlight: "fields",
	},
	{
		title: "Versioning",
		desc: "workflow stages, drafts \u2192 published",
		highlight: "versioning",
	},
] as const;

function OneSchemaSection() {
	const [hovered, setHovered] = useState<string | null>(null);

	return (
		<section>
			<Lmw>
				<SectionBar
					num="01"
					label="One schema, everything generated"
					title="Define once. Get the rest for free."
				/>
				<TwoCol>
					<TwoColLeft className="bg-background text-muted-foreground p-0! font-mono text-xs leading-relaxed">
						<pre className="px-5 py-4">
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
							<span className="text-primary font-semibold">collection</span>(
							<span className="text-[var(--syntax-string)]">"posts"</span>)
							{"\n"}
							<span
								data-highlight="fields"
								className={cn(
									"inline-block w-full border-l-2 pl-1 transition-all duration-300",
									hovered === "fields"
										? "border-primary bg-primary/5"
										: "border-transparent",
								)}
							>
								{"  ."}
								<span className="text-[var(--syntax-function)]">fields</span>
								{`(({ f }) => ({
    title:   f.`}
								<span className="text-[var(--syntax-function)]">text</span>(
								<span className="text-[#FFB300]">255</span>).
								<span className="text-[var(--syntax-function)]">required</span>
								{`(),
    content: f.`}
								<span className="text-[var(--syntax-function)]">richText</span>
								().
								<span className="text-[var(--syntax-function)]">localized</span>
								{`(),
    status:  f.`}
								<span className="text-[var(--syntax-function)]">select</span>
								{`([...]).`}
								<span className="text-[var(--syntax-function)]">required</span>
								{`(),
    author:  f.`}
								<span className="text-[var(--syntax-function)]">relation</span>(
								<span className="text-[var(--syntax-string)]">"users"</span>)
								{`,
  }))`}
							</span>
							{"\n"}
							<span
								data-highlight="access"
								className={cn(
									"inline-block w-full border-l-2 pl-1 transition-all duration-300",
									hovered === "access"
										? "border-primary bg-primary/5"
										: "border-transparent",
								)}
							>
								{"  ."}
								<span className="text-[var(--syntax-function)]">access</span>
								{"({...})"}
							</span>
							{"\n"}
							<span
								data-highlight="versioning"
								className={cn(
									"inline-block w-full border-l-2 pl-1 transition-all duration-300",
									hovered === "versioning"
										? "border-primary bg-primary/5"
										: "border-transparent",
								)}
							>
								{"  ."}
								<span className="text-[var(--syntax-function)]">
									versioning
								</span>
								{"({ enabled: "}
								<span className="text-primary font-semibold">true</span>
								{" })"}
							</span>
						</pre>
					</TwoColLeft>
					<TwoColRight>
						<ul className="m-0 list-none p-0 font-mono text-xs">
							{oneSchemaFeatures.map(({ title, desc, highlight }) => (
								<li
									key={title}
									className={cn(
										"border-border flex cursor-default gap-2.5 border-b py-1 transition-colors duration-200",
										hovered === highlight && "bg-primary/5",
									)}
									onMouseEnter={() => setHovered(highlight)}
									onMouseLeave={() => setHovered(null)}
								>
									<span className="text-[#00E676]">&#10003;</span>
									<span className="text-foreground">{title}</span>
									<span className="text-muted-foreground ml-1">
										&mdash;{" "}
										{desc.includes("\u2192")
											? desc.split("\u2192").map((part, i) => (
													<span key={i}>
														{i > 0 && (
															<span className="text-[#00E676]">
																{" "}
																&rarr;{" "}
															</span>
														)}
														{part.trim()}
													</span>
												))
											: desc}
									</span>
								</li>
							))}
						</ul>
					</TwoColRight>
				</TwoCol>
			</Lmw>
		</section>
	);
}

/* ─── §04 Admin — multi-tab showcase ─── */

type AdminTab = "collection" | "dashboard" | "globals" | "sidebar";

const STEP_DURATION = 3500;

function AdminCollectionCode({ step }: { step: number }) {
	return (
		<pre className="px-5 py-4">
			<span className="text-primary font-semibold">collection</span>(
			<span className="text-[var(--syntax-string)]">"posts"</span>)
			{"\n  ."}
			<span className="text-[var(--syntax-function)]">admin</span>
			{"(({ c }) => ({"}
			{'\n    label: { en: '}
			<span className="text-[var(--syntax-string)]">"Posts"</span>
			{" },"}
			{"\n  }))"}
			{"\n  ."}
			<span className="text-[var(--syntax-function)]">list</span>
			{"(({ v }) => v."}
			<span className="text-[var(--syntax-function)]">table</span>
			{"({"}
			{step >= 1 ? (
				<>
					{"\n    columns: ["}
					<span className="text-[var(--syntax-string)]">"title"</span>
					{", "}
					<span className="text-[var(--syntax-string)]">"status"</span>
					{step >= 2 && (
						<>
							{", "}
							<span className="text-[var(--syntax-string)]">"author"</span>
							{", "}
							<span className="text-[var(--syntax-string)]">"date"</span>
						</>
					)}
					{"],"}
				</>
			) : (
				<>
					{"\n    columns: ["}
					<span className="text-[var(--syntax-string)]">"title"</span>
					{", "}
					<span className="text-[var(--syntax-string)]">"status"</span>
					{"],"}
				</>
			)}
			{"\n  }))"}
			{step >= 3 && (
				<>
					{"\n  ."}
					<span className="text-[var(--syntax-function)]">access</span>
					{"({ "}
					<span className="text-primary font-semibold">create</span>
					{": "}
					<span className="text-primary font-semibold">false</span>
					{" })"}
				</>
			)}
		</pre>
	);
}

function AdminCollectionMockup({ step }: { step: number }) {
	return (
		<div className="flex flex-col font-mono text-[11px]">
			<div className="border-border flex items-center justify-between border-b px-3 py-2">
				<span className="text-foreground font-bold">Posts</span>
				{step < 3 && (
					<span className="bg-primary px-2 py-0.5 text-[9px] text-white">
						+ Create
					</span>
				)}
			</div>
			<table className="w-full border-collapse text-[11px]">
				<thead>
					<tr>
						<th className="bg-card text-muted-foreground border-border border-b px-2.5 py-1.5 text-left text-[9px] font-medium tracking-[1.5px] uppercase">
							Title
						</th>
						<th className="bg-card text-muted-foreground border-border border-b px-2.5 py-1.5 text-left text-[9px] font-medium tracking-[1.5px] uppercase">
							Status
						</th>
						{step >= 2 && (
							<>
								<th className="bg-card text-muted-foreground border-border border-b px-2.5 py-1.5 text-left text-[9px] font-medium tracking-[1.5px] uppercase">
									Author
								</th>
								<th className="bg-card text-muted-foreground border-border border-b px-2.5 py-1.5 text-left text-[9px] font-medium tracking-[1.5px] uppercase">
									Date
								</th>
							</>
						)}
					</tr>
				</thead>
				<tbody>
					{[
						["Getting Started Guide", "PUBLISHED", "#00E676", "admin", "Mar 6"],
						["Adapter Architecture", "DRAFT", "#FFB300", "admin", "Mar 5"],
						["File Conventions Deep Dive", "PUBLISHED", "#00E676", "admin", "Mar 3"],
					].map(([title, status, color, author, date]) => (
						<tr key={title}>
							<td className="border-border text-foreground border-b px-2.5 py-1.5">
								{title}
							</td>
							<td
								className="border-border border-b px-2.5 py-1.5 text-[9px] tracking-wide"
								style={{ color }}
							>
								{status}
							</td>
							{step >= 2 && (
								<>
									<td className="border-border text-muted-foreground border-b px-2.5 py-1.5">
										{author}
									</td>
									<td className="border-border text-muted-foreground border-b px-2.5 py-1.5">
										{date}
									</td>
								</>
							)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function AdminDashboardCode({ step }: { step: number }) {
	return (
		<pre className="px-5 py-4">
			<span className="text-primary font-semibold">dashboard</span>(
			<span className="text-[var(--syntax-string)]">"main"</span>)
			{step >= 1 && (
				<>
					{"\n  ."}
					<span className="text-[var(--syntax-function)]">actions</span>
					{"((a) => ["}
					{'\n    a.'}
					<span className="text-[var(--syntax-function)]">create</span>
					{'('}
					<span className="text-[var(--syntax-string)]">"posts"</span>
					{'),'}
					{step >= 2 && (
						<>
							{'\n    a.'}
							<span className="text-[var(--syntax-function)]">duplicate</span>
							{'(),'}
							{'\n    a.'}
							<span className="text-[var(--syntax-function)]">export</span>
							{'(),'}
						</>
					)}
					{'\n  ])'}
				</>
			)}
			{step >= 3 && (
				<>
					{"\n  ."}
					<span className="text-[var(--syntax-function)]">widgets</span>
					{"((w) => ["}
					{'\n    w.'}
					<span className="text-[var(--syntax-function)]">stats</span>
					{'({ collections: ['}
					<span className="text-[var(--syntax-string)]">"posts"</span>
					{'] }),'}
					{'\n    w.'}
					<span className="text-[var(--syntax-function)]">recentActivity</span>
					{'(),'}
					{'\n  ])'}
				</>
			)}
		</pre>
	);
}

function AdminDashboardMockup({ step }: { step: number }) {
	return (
		<div className="flex flex-col font-mono text-[11px]">
			<div className="border-border flex items-center justify-between border-b px-3 py-2">
				<span className="text-foreground font-bold">Dashboard</span>
			</div>
			{step >= 1 && (
				<div className="border-border flex flex-wrap gap-1.5 border-b px-3 py-2">
					<span className="bg-primary px-2 py-0.5 text-[9px] text-white">
						+ Create Post
					</span>
					{step >= 2 && (
						<>
							<span className="border-border text-muted-foreground border px-2 py-0.5 text-[9px]">
								Duplicate
							</span>
							<span className="border-border text-muted-foreground border px-2 py-0.5 text-[9px]">
								Export
							</span>
						</>
					)}
				</div>
			)}
			{step >= 3 && (
				<div className="grid grid-cols-2 gap-px p-3">
					<div className="border-border border p-2.5">
						<div className="text-muted-foreground text-[9px] tracking-[1.5px] uppercase">
							Total Posts
						</div>
						<div className="text-foreground mt-1 text-lg font-bold">128</div>
					</div>
					<div className="border-border border p-2.5">
						<div className="text-muted-foreground text-[9px] tracking-[1.5px] uppercase">
							Published
						</div>
						<div className="text-foreground mt-1 text-lg font-bold">94</div>
					</div>
					<div className="border-border col-span-2 border p-2.5">
						<div className="text-muted-foreground text-[9px] tracking-[1.5px] uppercase">
							Recent Activity
						</div>
						<div className="text-muted-foreground mt-1.5 space-y-1 text-[10px]">
							<div>
								<span className="text-[#00E676]">+</span> "Getting Started"
								published
							</div>
							<div>
								<span className="text-[#FFB300]">~</span> "Adapters" updated
							</div>
						</div>
					</div>
				</div>
			)}
			{step < 1 && (
				<div className="text-muted-foreground/40 flex items-center justify-center py-8 text-[10px]">
					Empty dashboard
				</div>
			)}
		</div>
	);
}

function AdminGlobalsCode({ step }: { step: number }) {
	return (
		<pre className="px-5 py-4">
			<span className="text-primary font-semibold">global</span>(
			<span className="text-[var(--syntax-string)]">"siteSettings"</span>)
			{step >= 1 && (
				<>
					{"\n  ."}
					<span className="text-[var(--syntax-function)]">fields</span>
					{"(({ f }) => ({"}
					{'\n    siteName: f.'}
					<span className="text-[var(--syntax-function)]">text</span>
					{'(255),'}
					{'\n    logo:     f.'}
					<span className="text-[var(--syntax-function)]">upload</span>
					{'(),'}
					{'\n    footer:   f.'}
					<span className="text-[var(--syntax-function)]">richText</span>
					{'(),'}
					{'\n  }))'}
				</>
			)}
			{step >= 2 && (
				<>
					{"\n  ."}
					<span className="text-[var(--syntax-function)]">versioning</span>
					{"({ enabled: "}
					<span className="text-primary font-semibold">true</span>
					{" })"}
				</>
			)}
		</pre>
	);
}

function AdminGlobalsMockup({ step }: { step: number }) {
	const [showHistory, setShowHistory] = useState(false);

	useEffect(() => {
		setShowHistory(false);
	}, [step]);

	return (
		<div className="relative flex flex-col overflow-hidden font-mono text-[11px]">
			<div className="border-border flex items-center justify-between border-b px-3 py-2">
				<span className="text-foreground font-bold">Site Settings</span>
				{step >= 2 && (
					<button
						type="button"
						className="border-border text-muted-foreground hover:text-primary border px-2 py-0.5 text-[9px] transition-colors"
						onClick={() => setShowHistory((v) => !v)}
					>
						History
					</button>
				)}
			</div>
			{step >= 1 ? (
				<div className="space-y-2.5 p-3">
					{[
						["Site Name", "My Website"],
						["Logo", "logo.svg"],
						["Footer", "© 2026 My Website"],
					].map(([label, val]) => (
						<div key={label}>
							<div className="text-muted-foreground mb-0.5 text-[9px] tracking-[1.5px] uppercase">
								{label}
							</div>
							<div className="border-border text-foreground border px-2.5 py-1.5">
								{val}
							</div>
						</div>
					))}
				</div>
			) : (
				<div className="text-muted-foreground/40 flex items-center justify-center py-8 text-[10px]">
					Empty form
				</div>
			)}
			{/* History sidebar */}
			<div
				className={cn(
					"bg-card border-border absolute inset-y-0 right-0 w-[45%] border-l transition-transform duration-300",
					showHistory ? "translate-x-0" : "translate-x-full",
				)}
			>
				<div className="border-border border-b px-3 py-2">
					<span className="text-foreground text-[10px] font-bold">
						Versions
					</span>
				</div>
				<div className="space-y-1.5 p-2.5">
					{["v3 — now", "v2 — 2h ago", "v1 — yesterday"].map((v) => (
						<div
							key={v}
							className="text-muted-foreground border-border border-l-2 px-2 py-0.5 text-[9px]"
						>
							{v}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function AdminSidebarCode({ step }: { step: number }) {
	return (
		<pre className="px-5 py-4">
			<span className="text-primary font-semibold">sidebar</span>
			{"((s) => ["}
			{'\n  s.'}
			<span className="text-[var(--syntax-function)]">nav</span>
			{'({ href: '}
			<span className="text-[var(--syntax-string)]">"/posts"</span>
			{', label: '}
			<span className="text-[var(--syntax-string)]">"Posts"</span>
			{' }),'}
			{'\n  s.'}
			<span className="text-[var(--syntax-function)]">nav</span>
			{'({ href: '}
			<span className="text-[var(--syntax-string)]">"/users"</span>
			{', label: '}
			<span className="text-[var(--syntax-string)]">"Users"</span>
			{' }),'}
			{'\n  s.'}
			<span className="text-[var(--syntax-function)]">nav</span>
			{'({ href: '}
			<span className="text-[var(--syntax-string)]">"/settings"</span>
			{', label: '}
			<span className="text-[var(--syntax-string)]">"Settings"</span>
			{' }),'}
			{step >= 2 && (
				<>
					{'\n  s.'}
					<span className="text-[var(--syntax-function)]">group</span>
					{'('}
					<span className="text-[var(--syntax-string)]">"Content"</span>
					{'),'}
				</>
			)}
			{step >= 3 && (
				<>
					{'\n  s.'}
					<span className="text-[var(--syntax-function)]">nav</span>
					{'({ href: '}
					<span className="text-[var(--syntax-string)]">"/analytics"</span>
					{' }),'}
				</>
			)}
			{step >= 4 && (
				<>
					{'\n  s.'}
					<span className="text-[var(--syntax-function)]">locale</span>
					{'({ locales: ['}
					<span className="text-[var(--syntax-string)]">"en"</span>
					{', '}
					<span className="text-[var(--syntax-string)]">"sk"</span>
					{'] }),'}
				</>
			)}
			{'\n])'}
		</pre>
	);
}

function AdminSidebarMockup({ step }: { step: number }) {
	const items =
		step >= 2
			? [
					{ label: "Content", isGroup: true },
					{ label: "Posts" },
					{ label: "Users" },
					{ label: "Settings" },
				]
			: [{ label: "Posts" }, { label: "Users" }, { label: "Settings" }];

	return (
		<div className="flex flex-col font-mono text-[11px]">
			<div className="border-border flex items-center justify-between border-b px-3 py-2">
				<span className="text-foreground font-bold">Sidebar</span>
				{step >= 4 && (
					<div className="flex gap-0.5">
						<span className="bg-primary px-1.5 py-0.5 text-[9px] text-white">
							EN
						</span>
						<span className="border-border text-muted-foreground border px-1.5 py-0.5 text-[9px]">
							SK
						</span>
					</div>
				)}
			</div>
			<div className="p-2">
				{items.map((item) =>
					item.isGroup ? (
						<div
							key={item.label}
							className="text-muted-foreground/60 mt-2 mb-0.5 px-3 py-0.5 text-[9px] tracking-[2px] uppercase"
						>
							{item.label}
						</div>
					) : (
						<div
							key={item.label}
							className="text-foreground hover:bg-card px-3 py-1.5 transition-colors"
						>
							{item.label}
						</div>
					),
				)}
				{step >= 3 && (
					<div className="text-primary border-border mt-1 border-t px-3 py-1.5">
						Analytics
					</div>
				)}
			</div>
		</div>
	);
}

const adminTabs: { key: AdminTab; label: string; stepCount: number }[] = [
	{ key: "collection", label: "Collection", stepCount: 3 },
	{ key: "dashboard", label: "Dashboard", stepCount: 3 },
	{ key: "globals", label: "Globals", stepCount: 3 },
	{ key: "sidebar", label: "Sidebar", stepCount: 4 },
];

function AdminShowcaseSection() {
	const [activeTab, setActiveTab] = useState<AdminTab>("collection");
	const [activeStep, setActiveStep] = useState(1);
	const [paused, setPaused] = useState(false);
	const progressRef = useRef<HTMLDivElement>(null);

	const currentTabDef = adminTabs.find((t) => t.key === activeTab)!;

	const handleTabClick = useCallback((tab: AdminTab) => {
		setActiveTab(tab);
		setActiveStep(1);
	}, []);

	// Auto-advance steps
	useEffect(() => {
		if (paused) return;

		const timer = setTimeout(() => {
			if (activeStep < currentTabDef.stepCount) {
				setActiveStep((s) => s + 1);
			} else {
				// Move to next tab
				const idx = adminTabs.findIndex((t) => t.key === activeTab);
				const nextIdx = (idx + 1) % adminTabs.length;
				setActiveTab(adminTabs[nextIdx].key);
				setActiveStep(1);
			}
		}, STEP_DURATION);

		return () => clearTimeout(timer);
	}, [activeTab, activeStep, paused, currentTabDef.stepCount]);

	const renderCode = () => {
		switch (activeTab) {
			case "collection":
				return <AdminCollectionCode step={activeStep} />;
			case "dashboard":
				return <AdminDashboardCode step={activeStep} />;
			case "globals":
				return <AdminGlobalsCode step={activeStep} />;
			case "sidebar":
				return <AdminSidebarCode step={activeStep} />;
		}
	};

	const renderMockup = () => {
		switch (activeTab) {
			case "collection":
				return <AdminCollectionMockup step={activeStep} />;
			case "dashboard":
				return <AdminDashboardMockup step={activeStep} />;
			case "globals":
				return <AdminGlobalsMockup step={activeStep} />;
			case "sidebar":
				return <AdminSidebarMockup step={activeStep} />;
		}
	};

	return (
		<section>
			<Lmw>
				<SectionBar
					num="04"
					label="Optional admin"
					title="Ship the admin panel only when you need it."
				/>
				{/* Tab bar with progress */}
				<div className="border-border flex border-b">
					{adminTabs.map((tab) => (
						<button
							key={tab.key}
							type="button"
							onClick={() => handleTabClick(tab.key)}
							className={cn(
								"border-border relative flex-1 border-r py-2 font-mono text-[10px] font-semibold tracking-[2px] uppercase transition-colors last:border-r-0",
								activeTab === tab.key
									? "bg-card text-primary"
									: "bg-background text-muted-foreground hover:text-foreground",
							)}
						>
							{tab.label}
							{activeTab === tab.key && (
								<div
									ref={progressRef}
									key={`${tab.key}-${activeStep}`}
									className="bg-primary absolute bottom-0 left-0 h-[2px] motion-safe:animate-[admin-progress_3.5s_linear]"
									style={{
										animationFillMode: "forwards",
										animationPlayState: paused ? "paused" : "running",
									}}
								/>
							)}
						</button>
					))}
				</div>
				{/* Content */}
				<div
					onMouseEnter={() => setPaused(true)}
					onMouseLeave={() => setPaused(false)}
				>
					<TwoCol>
						<TwoColLeft className="bg-background text-muted-foreground p-0! font-mono text-xs leading-relaxed">
							<div className="transition-opacity duration-300">
								{renderCode()}
							</div>
							<div className="border-border text-muted-foreground mx-6 mt-4 border-t pt-3 pb-4 text-[11px]">
								Swappable package. Web, React Native, or build your own.
							</div>
						</TwoColLeft>
						<TwoColRight className="p-0!">
							<div className="transition-opacity duration-300">
								{renderMockup()}
							</div>
						</TwoColRight>
					</TwoCol>
				</div>
			</Lmw>
		</section>
	);
}

/* ─── §05 End-to-End Types — clickable steps ─── */

const typeSteps = [
	{
		label: "schema.ts",
		code: (
			<pre className="px-5 py-4">
				<span className="text-primary font-semibold">collection</span>(
				<span className="text-[var(--syntax-string)]">"posts"</span>)
				{"\n  ."}
				<span className="text-[var(--syntax-function)]">fields</span>
				{"(({ f }) => ({"}
				{'\n    title:   f.'}
				<span className="text-[var(--syntax-function)]">text</span>(
				<span className="text-[#FFB300]">255</span>).
				<span className="text-[var(--syntax-function)]">required</span>
				{"(),"}
				{'\n    content: f.'}
				<span className="text-[var(--syntax-function)]">richText</span>
				{"(),"}
				{'\n    status:  f.'}
				<span className="text-[var(--syntax-function)]">select</span>
				{"(["}
				{'\n      { value: '}
				<span className="text-[var(--syntax-string)]">"draft"</span>
				{' },'}
				{'\n      { value: '}
				<span className="text-[var(--syntax-string)]">"published"</span>
				{' },'}
				{"\n    ]),"}
				{"\n  }))"}
			</pre>
		),
	},
	{
		label: "codegen output",
		code: (
			<pre className="px-5 py-4">
				<span className="text-muted-foreground/60">
					{"// Auto-generated by questpie codegen"}
				</span>
				{"\n\n"}
				<span className="text-primary font-semibold">export const</span>
				{" postsTable = "}
				<span className="text-[var(--syntax-function)]">pgTable</span>
				{"(...)"}
				{"\n"}
				<span className="text-primary font-semibold">export const</span>
				{" postsSchema = z."}
				<span className="text-[var(--syntax-function)]">object</span>
				{"(...)"}
				{"\n"}
				<span className="text-primary font-semibold">export type</span>
				{" Post = z."}
				<span className="text-[var(--syntax-function)]">infer</span>
				{"<"}
				<span className="text-primary">typeof</span>
				{" postsSchema>"}
			</pre>
		),
	},
	{
		label: "posts.table.ts",
		code: (
			<pre className="px-5 py-4">
				<span className="text-primary font-semibold">const</span>
				{" postsTable = "}
				<span className="text-[var(--syntax-function)]">pgTable</span>
				{'('}
				<span className="text-[var(--syntax-string)]">"posts"</span>
				{", {"}
				{'\n  title: '}
				<span className="text-[var(--syntax-function)]">varchar</span>
				{'('}
				<span className="text-[var(--syntax-string)]">"title"</span>
				{", { length: "}
				<span className="text-[#FFB300]">255</span>
				{" })"}
				{"\n    ."}
				<span className="text-[var(--syntax-function)]">notNull</span>
				{"(),"}
				{'\n  content: '}
				<span className="text-[var(--syntax-function)]">text</span>
				{'('}
				<span className="text-[var(--syntax-string)]">"content"</span>
				{"),"}
				{'\n  status: '}
				<span className="text-[var(--syntax-function)]">pgEnum</span>
				{'('}
				<span className="text-[var(--syntax-string)]">"status"</span>
				{","}
				{'\n    ['}
				<span className="text-[var(--syntax-string)]">"draft"</span>
				{', '}
				<span className="text-[var(--syntax-string)]">"published"</span>
				{"]),"}
				{"\n})"}
			</pre>
		),
	},
	{
		label: "posts.schema.ts",
		code: (
			<pre className="px-5 py-4">
				<span className="text-primary font-semibold">export const</span>
				{" postsSchema = z."}
				<span className="text-[var(--syntax-function)]">object</span>
				{"({"}
				{'\n  title: z.'}
				<span className="text-[var(--syntax-function)]">string</span>
				{"()."}
				<span className="text-[var(--syntax-function)]">max</span>
				{"("}
				<span className="text-[#FFB300]">255</span>
				{"),"}
				{'\n  content: z.'}
				<span className="text-[var(--syntax-function)]">string</span>
				{"(),"}
				{'\n  status: z.'}
				<span className="text-[var(--syntax-function)]">enum</span>
				{"(["}
				{'\n    '}
				<span className="text-[var(--syntax-string)]">"draft"</span>
				{","}
				{'\n    '}
				<span className="text-[var(--syntax-string)]">"published"</span>
				{","}
				{"\n  ]),"}
				{"\n})"}
			</pre>
		),
	},
	{
		label: "client.ts",
		code: (
			<pre className="px-5 py-4">
				<span className="text-primary font-semibold">const</span>
				{" { docs } = "}
				<span className="text-primary font-semibold">await</span>
				{" client.collections.posts."}
				<span className="text-[var(--syntax-function)]">find</span>
				{"({"}
				{"\n  where: { status: { eq: "}
				<span className="text-[var(--syntax-string)]">"published"</span>
				{" } },"}
				{'\n  orderBy: { createdAt: '}
				<span className="text-[var(--syntax-string)]">"desc"</span>
				{" },"}
				{"\n  with: { author: "}
				<span className="text-primary font-semibold">true</span>
				{", tags: "}
				<span className="text-primary font-semibold">true</span>
				{" },"}
				{"\n});"}
				{"\n"}
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
			</pre>
		),
	},
];

function EndToEndTypesSection() {
	const [activeStep, setActiveStep] = useState(4);

	return (
		<section>
			<Lmw>
				<SectionBar
					num="05"
					label="End-to-end types"
					title="Schema to screen. Zero disconnect."
				/>
				<div className="border-border flex flex-wrap items-center gap-0 overflow-x-auto border-b p-6 max-sm:p-4">
					{[
						"Field def",
						"Codegen",
						"Drizzle table",
						"Zod schema",
						"Client SDK",
					].map((step, i) => (
						<span key={step} className="inline-flex items-center">
							{i > 0 && (
								<span className="text-primary px-0.5 text-base">
									&rarr;
								</span>
							)}
							<button
								type="button"
								onClick={() => setActiveStep(i)}
								className={cn(
									"border px-3.5 py-2 font-mono text-[11px] transition-colors max-sm:px-2.5 max-sm:py-1.5 max-sm:text-[10px]",
									activeStep === i
										? "bg-primary border-primary text-white"
										: "bg-card border-border text-foreground hover:border-primary cursor-pointer",
								)}
							>
								{step}
							</button>
						</span>
					))}
				</div>
				<div className="bg-background text-muted-foreground border-border border-b font-mono text-xs leading-relaxed">
					<div className="border-border border-b px-5 py-1.5">
						<span className="text-primary font-mono text-[10px] tracking-[2px] uppercase">
							{typeSteps[activeStep].label}
						</span>
					</div>
					<div className="transition-opacity duration-300">
						{typeSteps[activeStep].code}
					</div>
				</div>
			</Lmw>
		</section>
	);
}

/* ─── §07 DX — staggered terminal reveal ─── */

function DxSection() {
	const sectionRef = useRef<HTMLDivElement>(null);
	const [revealed, setRevealed] = useState(false);

	useEffect(() => {
		const el = sectionRef.current;
		if (!el) return;

		const obs = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						setRevealed(true);
						obs.disconnect();
					}
				}
			},
			{ threshold: 0.1 },
		);
		obs.observe(el);
		return () => obs.disconnect();
	}, []);

	return (
		<section ref={sectionRef}>
			<Lmw>
				<SectionBar
					num="07"
					label="Developer experience"
					title="The details matter."
				/>
				<div className="bg-border grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-px">
					{/* WATCH */}
					<div className="bg-background hover:outline-primary p-5 transition-[outline-color] hover:relative hover:z-[2] hover:outline hover:outline-1 hover:-outline-offset-1">
						<div className="text-primary mb-1.5 font-mono text-[10px] tracking-[3px]">
							WATCH
						</div>
						<div className="bg-background text-muted-foreground my-2 px-4 py-3 font-mono text-[11px] leading-[1.8] whitespace-pre">
							{[
								<>
									<span className="text-primary">$</span> questpie dev
								</>,
								<>
									<span className="text-[var(--syntax-string)]">&#10003;</span>{" "}
									Watching...
								</>,
								<>
									<span className="text-[var(--syntax-string)]">&#10003;</span>{" "}
									server (23 collections)
								</>,
								<>
									<span className="text-[var(--syntax-string)]">&#10003;</span>{" "}
									admin-client (15 blocks)
								</>,
							].map((line, i) => (
								<span
									key={i}
									className={cn(
										"block motion-safe:transition-all motion-safe:duration-500",
										revealed
											? "translate-y-0 opacity-100"
											: "motion-safe:translate-y-1 motion-safe:opacity-0",
									)}
									style={{
										transitionDelay: revealed ? `${i * 300}ms` : "0ms",
									}}
								>
									{line}
								</span>
							))}
						</div>
						<div className="text-muted-foreground text-xs leading-normal">
							Instant regeneration on file changes.
						</div>
					</div>

					{/* SCAFFOLD */}
					<div className="bg-background hover:outline-primary p-5 transition-[outline-color] hover:relative hover:z-[2] hover:outline hover:outline-1 hover:-outline-offset-1">
						<div className="text-primary mb-1.5 font-mono text-[10px] tracking-[3px]">
							SCAFFOLD
						</div>
						<div className="bg-background text-muted-foreground my-2 px-4 py-3 font-mono text-[11px] leading-[1.8] whitespace-pre">
							{[
								<>
									<span className="text-primary">$</span> questpie add
									collection products
								</>,
								<>
									<span className="text-[var(--syntax-string)]">&#10003;</span>{" "}
									Created collections/products.ts
								</>,
								<>
									<span className="text-[var(--syntax-string)]">&#10003;</span>{" "}
									Regenerated types
								</>,
							].map((line, i) => (
								<span
									key={i}
									className={cn(
										"block motion-safe:transition-all motion-safe:duration-500",
										revealed
											? "translate-y-0 opacity-100"
											: "motion-safe:translate-y-1 motion-safe:opacity-0",
									)}
									style={{
										transitionDelay: revealed ? `${i * 300}ms` : "0ms",
									}}
								>
									{line}
								</span>
							))}
						</div>
						<div className="text-muted-foreground text-xs leading-normal">
							One command. Typed immediately.
						</div>
					</div>

					{/* VALIDATE */}
					<div className="bg-background hover:outline-primary p-5 transition-[outline-color] hover:relative hover:z-[2] hover:outline hover:outline-1 hover:-outline-offset-1">
						<div className="text-primary mb-1.5 font-mono text-[10px] tracking-[3px]">
							VALIDATE
						</div>
						<div className="bg-background text-muted-foreground my-2 px-4 py-3 font-mono text-[11px] leading-[1.8] whitespace-pre">
							{[
								{
									node: (
										<span className="text-destructive">
											&#10007; Server defines blocks/hero
										</span>
									),
									isError: true,
								},
								{
									node: (
										<span className="text-destructive">
											&nbsp; but no renderer found
										</span>
									),
									isError: true,
								},
								{
									node: (
										<span
											className={cn(
												"text-primary",
												revealed && "motion-safe:animate-[dx-suggestion-blink_1.5s_ease-in-out_infinite_1.4s]",
											)}
										>
											&rarr; Create admin/blocks/hero.tsx
										</span>
									),
									isSuggestion: true,
								},
							].map((item, i) => (
								<span
									key={i}
									className={cn(
										"block motion-safe:transition-all motion-safe:duration-500",
										revealed
											? "translate-y-0 opacity-100"
											: "motion-safe:translate-y-1 motion-safe:opacity-0",
									)}
									style={{
										transitionDelay: revealed ? `${i * 300}ms` : "0ms",
									}}
								>
									{item.node}
								</span>
							))}
						</div>
						<div className="text-muted-foreground text-xs leading-normal">
							Mismatch = build error. Not runtime surprise.
						</div>
					</div>

					{/* REALTIME */}
					<div className="bg-background hover:outline-primary p-5 transition-[outline-color] hover:relative hover:z-[2] hover:outline hover:outline-1 hover:-outline-offset-1">
						<div className="text-primary mb-1.5 font-mono text-[10px] tracking-[3px]">
							REALTIME
						</div>
						<div
							className="bg-background text-muted-foreground my-2 font-mono text-xs leading-relaxed"
							style={{ padding: "10px 14px", fontSize: 11 }}
						>
							<pre>
								{[
									<>
										{"client.realtime."}
										<span className="text-[var(--syntax-function)]">
											subscribe
										</span>
										{"("}
									</>,
									<>
										{"  { resource: "}
										<span className="text-[var(--syntax-string)]">
											"posts"
										</span>
										{" },"}
									</>,
									<>
										{"  (event) => "}
										<span className="text-[var(--syntax-function)]">
											updateUI
										</span>
										{"(event)"}
									</>,
									<>
										{");"}
										<span
											className={cn(
												"text-primary inline-block",
												revealed && "motion-safe:animate-[cursor-blink_1s_step-end_infinite]",
											)}
										>
											&#9608;
										</span>
									</>,
								].map((line, i) => (
									<span
										key={i}
										className={cn(
											"block motion-safe:transition-all motion-safe:duration-500",
											revealed
												? "translate-y-0 opacity-100"
												: "motion-safe:translate-y-1 motion-safe:opacity-0",
										)}
										style={{
											transitionDelay: revealed ? `${i * 300}ms` : "0ms",
										}}
									>
										{line}
									</span>
								))}
							</pre>
						</div>
						<div className="text-muted-foreground text-xs leading-normal">
							SSE multiplexer. PG NOTIFY. Auto-reconnect.
						</div>
					</div>
				</div>
			</Lmw>
		</section>
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
		<div className="landing bg-background bg-grid-quest text-foreground">
			<Nav />

			{/* ─── §1 HERO ─── */}
			<section className="border-border mt-14 border-b">
				<div className="border-border mx-auto grid min-h-[calc(100vh-56px)] max-w-[1200px] grid-cols-2 border-x max-[900px]:grid-cols-1">
					<div className="border-border max-[900px]:border-border flex flex-col justify-center border-r px-6 py-16 max-[900px]:border-r-0 max-[900px]:border-b sm:py-20">
						<div className="text-primary mb-6 font-mono text-[10px] tracking-[3px] uppercase">
							Open source framework
						</div>
						<h1 className="text-foreground font-mono text-[clamp(28px,5vw,52px)] leading-[1.05] font-extrabold tracking-tight">
							One backend.
							<br />
							Ship everywhere.
						</h1>
						<p className="text-muted-foreground mt-5 max-w-[440px] text-sm leading-relaxed">
							Define your schema once. Get REST, typed routes, realtime, typed
							client SDK, and optional admin UI. Server-first TypeScript. Built
							on Drizzle, Zod, Better Auth.
						</p>
						<div className="mt-8 flex gap-px">
							<Link
								to="/docs/$"
								params={{ _splat: "start-here/first-app" }}
								className="bg-primary border-primary hover:bg-primary/80 border px-5 py-2.5 font-mono text-[11px] font-semibold tracking-wider text-primary-foreground uppercase transition-colors"
							>
								Get started &rarr;
							</Link>
							<a
								href="https://github.com/questpie/questpie"
								target="_blank"
								rel="noreferrer"
								className="bg-background border-border text-foreground hover:border-primary hover:text-primary border px-5 py-2.5 font-mono text-[11px] font-semibold tracking-wider uppercase transition-colors"
							>
								GitHub &#9733;
							</a>
						</div>
						<div className="mt-6 flex flex-wrap gap-px">
							{[
								"TypeScript",
								"Server-first",
								"Zero lock-in",
								"MIT license",
							].map((t) => (
								<span
									key={t}
									className="bg-card text-muted-foreground px-2.5 py-1 font-mono text-[10px] tracking-wide"
								>
									{t}
								</span>
							))}
						</div>
					</div>
					<div className="flex flex-col">
						<div className="bg-background text-muted-foreground border-border flex-1 border-b font-mono text-xs leading-relaxed">
							<pre className="p-6">
								<span className="text-primary font-semibold">collection</span>(
								<span className="text-[var(--syntax-string)]">"posts"</span>)
								{`
  .`}
								<span className="text-[var(--syntax-function)]">fields</span>
								{`(({ f }) => ({
    title:   f.`}
								<span className="text-[var(--syntax-function)]">text</span>(
								<span className="text-[var(--syntax-number)]">255</span>
								).
								<span className="text-[var(--syntax-function)]">required</span>
								{`(),
    content: f.`}
								<span className="text-[var(--syntax-function)]">richText</span>
								().
								<span className="text-[var(--syntax-function)]">localized</span>
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
								<span className="text-[var(--syntax-string)]">"published"</span>
								{`, label: `}
								<span className="text-[var(--syntax-string)]">"Published"</span>
								{` },
    ]),
    author:  f.`}
								<span className="text-[var(--syntax-function)]">relation</span>(
								<span className="text-[var(--syntax-string)]">"users"</span>).
								<span className="text-[var(--syntax-function)]">required</span>
								{`(),
    tags:    f.`}
								<span className="text-[var(--syntax-function)]">relation</span>(
								<span className="text-[var(--syntax-string)]">"tags"</span>).
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
    read: `}
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
							</pre>
						</div>
						<div className="bg-border grid grid-cols-4 gap-px">
							{[
								"REST API",
								"Typed client SDK",
								"Admin panel",
								"Zod validation",
							].map((label) => (
								<div
									key={label}
									className="bg-background px-3 py-2.5 font-mono text-[10px] tracking-wide text-[var(--status-success)]"
								>
									<span className="text-muted-foreground/40">→ </span>
									{label}
								</div>
							))}
						</div>
					</div>
				</div>
			</section>

			{/* ─── §2 ONE SCHEMA ─── */}
			<Reveal>
				<OneSchemaSection />
			</Reveal>

			{/* ─── §3 FILE CONVENTIONS ─── */}
			<Reveal>
				<FileConventionsSection />
			</Reveal>

			{/* ─── §4 ADAPTERS ─── */}
			<Reveal>
				<section>
					<Lmw>
						<SectionBar
							num="03"
							label="Swap anything"
							title="Your infrastructure. Your choice."
						/>
						<TwoCol>
							<TwoColLeft className="border-b-0! p-0!">
								<div
									className="bg-border grid gap-px"
									style={{ gridTemplateColumns: "100px 1fr" }}
								>
									{[
										["Runtime", "Node.js · Bun · Cloudflare Workers · Deno"],
										["Database", "PostgreSQL · PGlite · Neon · PlanetScale"],
										["Queue", "pg-boss · Cloudflare Queues"],
										["Search", "Postgres FTS · pgvector"],
										["Realtime", "PG NOTIFY · Redis Streams"],
										["Storage", "Local · S3 · R2 · GCS (FlyDrive)"],
										["HTTP", "Hono · Elysia · Next.js · TanStack Start"],
									].map(([cat, val]) => (
										<>
											<div
												key={`c-${cat}`}
												className="text-primary bg-card flex items-center px-4 py-2 font-mono text-[10px] tracking-[2px] uppercase"
											>
												{cat}
											</div>
											<div
												key={`v-${cat}`}
												className="text-foreground bg-background px-4 py-2 text-[13px]"
											>
												{val}
											</div>
										</>
									))}
								</div>
							</TwoColLeft>
							<TwoColRight className="bg-background text-muted-foreground border-b-0! p-0! font-mono text-xs leading-relaxed">
								<pre className="px-5 py-4">
									{`runtimeConfig({
  db: { url: `}
									<span className="text-[var(--syntax-string)]">
										DATABASE_URL
									</span>
									{` },
  queue: { adapter: `}
									<span className="text-[var(--syntax-function)]">
										pgBossAdapter
									</span>
									{`() },
  search: `}
									<span className="text-[var(--syntax-function)]">
										postgresSearchAdapter
									</span>
									{`(),
  realtime: { adapter: `}
									<span className="text-[var(--syntax-function)]">
										pgNotifyAdapter
									</span>
									{`() },
  storage: { driver: `}
									<span className="text-[var(--syntax-function)]">
										s3Driver
									</span>
									{`({
    bucket: `}
									<span className="text-[var(--syntax-string)]">"assets"</span>
									{`
  }) },
  email: { adapter: `}
									<span className="text-[var(--syntax-function)]">
										smtpAdapter
									</span>
									{`() },
})`}
								</pre>
								<div className="border-border text-muted-foreground mx-6 mt-4 border-t pt-3 pb-4 text-[11px]">
									Write your own adapter in under 50 lines.
								</div>
							</TwoColRight>
						</TwoCol>
					</Lmw>
				</section>
			</Reveal>

			{/* ─── §5 ADMIN ─── */}
			<Reveal>
				<AdminShowcaseSection />
			</Reveal>

			{/* ─── §6 TYPE SAFETY ─── */}
			<Reveal>
				<EndToEndTypesSection />
			</Reveal>

			{/* ─── §7 MODULES ─── */}
			<Reveal>
				<section>
					<Lmw>
						<SectionBar
							num="06"
							label="Composable"
							title="Core parts = user code."
						/>
						<div className="bg-border grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-px">
							{(
								[
									["01", "questpie-starter", "Auth, users, sessions, API keys, assets. Better Auth integration. Default access. i18n messages.", "ph:package"],
									["02", "questpie-admin", "Admin UI. 18 field renderers, 3 view types, sidebar, dashboard widgets. Table, form, block editor.", "ph:layout"],
									["03", "questpie-audit", "Change logging via global hooks. Every create, update, delete tracked. Zero config required.", "ph:clipboard-text"],
									["04", "Your module", "Same file conventions, same patterns. Build your own module. Publish to npm. No special APIs.", "ph:puzzle-piece"],
								] as const
							).map(([idx, title, desc, icon]) => (
								<div
									key={idx}
									className="bg-background hover:outline-primary p-5 transition-[outline-color] hover:relative hover:z-[2] hover:outline hover:outline-1 hover:-outline-offset-1"
								>
									<div className="text-primary mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[3px]">
										<Icon icon={icon} className="h-3.5 w-3.5" />
										{idx}
									</div>
									<div className="text-foreground mb-1 font-mono text-[13px] font-bold">
										{title}
									</div>
									<div className="text-muted-foreground text-xs leading-normal">
										{desc}
									</div>
								</div>
							))}
						</div>
						<div className="text-muted-foreground border-border border-b px-5 py-3 text-[11px]">
							Modules compose depth-first with deduplication. Every module uses
							the exact same conventions as user code.
						</div>
					</Lmw>
				</section>
			</Reveal>

			{/* ─── §8 DX ─── */}
			<Reveal>
				<DxSection />
			</Reveal>

			{/* ─── §9 CTA ─── */}
			<section className="border-border border-y">
				<div className="border-border mx-auto grid max-w-[1200px] grid-cols-[1fr_auto] border-x max-[900px]:grid-cols-1">
					<div className="border-border max-[900px]:border-border border-r px-6 py-10 max-[900px]:border-r-0 max-[900px]:border-b">
						<h2 className="text-foreground font-mono text-[clamp(20px,3vw,28px)] font-extrabold tracking-tight">
							One backend. Ship everywhere.
						</h2>
						<div className="text-primary mt-3 font-mono text-sm">
							npx create-questpie
						</div>
					</div>
					<div className="flex flex-col justify-center gap-px p-6">
						<Link
							to="/docs/$"
							params={{ _splat: "start-here/first-app" }}
							className="bg-primary border-primary hover:bg-primary/80 block border px-5 py-2.5 text-center font-mono text-[11px] tracking-wider text-primary-foreground uppercase transition-colors"
						>
							Read the docs &rarr;
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "examples" }}
							className="bg-background border-border text-foreground hover:border-primary hover:text-primary block border px-5 py-2.5 text-center font-mono text-[11px] tracking-wider uppercase transition-colors"
						>
							Browse examples &rarr;
						</Link>
						<a
							href="https://github.com/questpie/questpie"
							target="_blank"
							rel="noreferrer"
							className="bg-background border-border text-foreground hover:border-primary hover:text-primary block border px-5 py-2.5 text-center font-mono text-[11px] tracking-wider uppercase transition-colors"
						>
							Star on GitHub &#9733;
						</a>
					</div>
				</div>
			</section>

			<LandingFooter />
		</div>
	);
}
