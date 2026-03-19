import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

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
							{badges.map(([name, badge, color]) => (
								<div
									key={name}
									className="bg-background flex items-center justify-between px-5 py-2.5 text-[13px]"
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
									{`([...]).`}
									<span className="text-[var(--syntax-function)]">
										required
									</span>
									{`(),
    author:  f.`}
									<span className="text-[var(--syntax-function)]">
										relation
									</span>
									(<span className="text-[var(--syntax-string)]">"users"</span>)
									{`,
  }))`}
								</pre>
							</TwoColLeft>
							<TwoColRight>
								<ul className="m-0 list-none p-0 font-mono text-xs">
									{[
										["REST API", "/api/collections/posts"],
										["Typed routes", "typed, namespaced"],
										["Realtime via SSE", "subscribe to changes"],
										["Typed client SDK", "auto-generated types"],
										["Admin panel", "table, form, block editor"],
										["Zod validation", "from field definitions"],
										["Access control", "row-level, field-level"],
										["i18n", "two-table strategy, per-field localization"],
										["Versioning", "workflow stages, drafts → published"],
									].map(([title, desc]) => (
										<li
											key={title}
											className="border-border flex gap-2.5 border-b py-1"
										>
											<span className="text-[var(--status-success)]">&#10003;</span>
											<span className="text-foreground">{title}</span>
											<span className="text-muted-foreground ml-1">
												&mdash;{" "}
												{desc.includes("→")
													? desc.split("→").map((part, i) => (
															<span key={i}>
																{i > 0 && (
																	<span className="text-[var(--status-success)]"> → </span>
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
				<section>
					<Lmw>
						<SectionBar
							num="04"
							label="Optional admin"
							title="Ship the admin panel only when you need it."
						/>
						<TwoCol>
							<TwoColLeft className="bg-background text-muted-foreground p-0! font-mono text-xs leading-relaxed">
								<pre className="px-5 py-4">
									<span className="text-primary font-semibold">collection</span>
									(<span className="text-[var(--syntax-string)]">"posts"</span>)
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
									<span className="text-[var(--syntax-function)]">collectionTable</span>
									{`({
    columns: [`}
									<span className="text-[var(--syntax-string)]">"title"</span>
									{`, `}
									<span className="text-[var(--syntax-string)]">"status"</span>
									{`, `}
									<span className="text-[var(--syntax-string)]">"author"</span>
									{`],
    defaultSort: { field: f.createdAt, direction: `}
									<span className="text-[var(--syntax-string)]">"desc"</span>
									{` },
  }))
  .`}
									<span className="text-[var(--syntax-function)]">form</span>
									{`(({ v, f }) => v.`}
									<span className="text-[var(--syntax-function)]">collectionForm</span>
									{`({
    fields: [f.title, f.content],
    sidebar: { position: `}
									<span className="text-[var(--syntax-string)]">"right"</span>
									{`, fields: [f.status, f.author] },
  }))`}
								</pre>
								<div className="border-border text-muted-foreground mx-6 mt-4 border-t pt-3 pb-4 text-[11px]">
									Swappable package. Web, React Native, or build your own.
								</div>
							</TwoColLeft>
							<TwoColRight className="p-0!">
								<div className="grid grid-cols-[140px_1fr] overflow-hidden font-mono text-[11px] max-[900px]:grid-cols-1">
									<div className="bg-card border-border max-[900px]:border-border border-r p-3 max-[900px]:flex max-[900px]:flex-wrap max-[900px]:gap-1 max-[900px]:border-r-0 max-[900px]:border-b">
										<div className="text-muted-foreground/60 mb-1 px-3.5 py-1 font-mono text-[9px] tracking-[2px] uppercase max-[900px]:mb-0">
											Admin
										</div>
										<div className="text-foreground border-primary border-l-2 px-3.5 py-1">
											Posts
										</div>
										<div className="text-muted-foreground px-3.5 py-1">
											Users
										</div>
										<div className="text-muted-foreground px-3.5 py-1">
											Settings
										</div>
										<div className="text-muted-foreground px-3.5 py-1">
											Assets
										</div>
										<div className="text-muted-foreground px-3.5 py-1">
											Audit log
										</div>
									</div>
									<div className="flex flex-col">
										<div className="border-border flex items-center justify-between border-b px-3 py-2">
											<span className="text-foreground font-bold">Posts</span>
											<div className="flex gap-1">
												<span className="bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground opacity-80">
													EN
												</span>
												<span className="border-border text-muted-foreground border px-1.5 py-0.5 text-[9px]">
													SK
												</span>
											</div>
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
													<th className="bg-card text-muted-foreground border-border border-b px-2.5 py-1.5 text-left text-[9px] font-medium tracking-[1.5px] uppercase">
														Author
													</th>
													<th className="bg-card text-muted-foreground border-border border-b px-2.5 py-1.5 text-left text-[9px] font-medium tracking-[1.5px] uppercase">
														Date
													</th>
												</tr>
											</thead>
											<tbody>
												<tr>
													<td className="border-border text-foreground border-b px-2.5 py-1.5">
														Getting Started Guide
													</td>
													<td className="border-border border-b px-2.5 py-1.5 text-[9px] tracking-wide text-[var(--status-success)]">
														PUBLISHED
													</td>
													<td className="border-border text-muted-foreground border-b px-2.5 py-1.5">
														admin
													</td>
													<td className="border-border text-muted-foreground border-b px-2.5 py-1.5">
														Mar 6
													</td>
												</tr>
												<tr>
													<td className="border-border text-foreground border-b px-2.5 py-1.5">
														Adapter Architecture
													</td>
													<td className="border-border border-b px-2.5 py-1.5 text-[9px] tracking-wide text-[var(--syntax-number)]">
														DRAFT
													</td>
													<td className="border-border text-muted-foreground border-b px-2.5 py-1.5">
														admin
													</td>
													<td className="border-border text-muted-foreground border-b px-2.5 py-1.5">
														Mar 5
													</td>
												</tr>
												<tr>
													<td className="border-border text-foreground border-b px-2.5 py-1.5">
														File Conventions Deep Dive
													</td>
													<td className="border-border border-b px-2.5 py-1.5 text-[9px] tracking-wide text-[var(--status-success)]">
														PUBLISHED
													</td>
													<td className="border-border text-muted-foreground border-b px-2.5 py-1.5">
														admin
													</td>
													<td className="border-border text-muted-foreground border-b px-2.5 py-1.5">
														Mar 3
													</td>
												</tr>
												<tr>
													<td className="text-foreground border-b-0 px-2.5 py-1.5">
														Block System Overview
													</td>
													<td className="border-b-0 px-2.5 py-1.5 text-[9px] tracking-wide text-[var(--syntax-number)]">
														DRAFT
													</td>
													<td className="text-muted-foreground border-b-0 px-2.5 py-1.5">
														admin
													</td>
													<td className="text-muted-foreground border-b-0 px-2.5 py-1.5">
														Mar 1
													</td>
												</tr>
											</tbody>
										</table>
									</div>
								</div>
							</TwoColRight>
						</TwoCol>
					</Lmw>
				</section>
			</Reveal>

			{/* ─── §6 TYPE SAFETY ─── */}
			<Reveal>
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
								"React",
							].map((step, i) => (
								<>
									{i > 0 && (
										<span
											key={`a-${step}`}
											className="text-primary px-0.5 text-base"
										>
											&rarr;
										</span>
									)}
									<div
										key={step}
										className="bg-card border-border text-foreground border px-3.5 py-2 font-mono text-[11px] max-sm:px-2.5 max-sm:py-1.5 max-sm:text-[10px]"
									>
										{step}
									</div>
								</>
							))}
						</div>
						<div className="bg-background text-muted-foreground border-border border-b font-mono text-xs leading-relaxed">
							<pre className="px-5 py-4">
								<span className="text-primary font-semibold">const</span>
								{` { docs } = `}
								<span className="text-primary font-semibold">await</span>
								{` client.collections.posts.`}
								<span className="text-[var(--syntax-function)]">find</span>
								{`({
  where: { status: { eq: `}
								<span className="text-[var(--syntax-string)]">"published"</span>
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
								{`
`}
								<span className="text-muted-foreground/60">
									{"// docs[0].author → User"}
								</span>
								{`
`}
								<span className="text-muted-foreground/60">
									{"// docs[0].tags → Tag[]"}
								</span>
								{`
`}
								<span className="text-muted-foreground/60">
									{"// Change a field — TypeScript catches it everywhere."}
								</span>
							</pre>
						</div>
					</Lmw>
				</section>
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
							{[
								[
									"01",
									"questpie-starter",
									"Auth, users, sessions, API keys, assets. Better Auth integration. Default access. i18n messages.",
								],
								[
									"02",
									"questpie-admin",
									"Admin UI. 18 field renderers, 3 view types, sidebar, dashboard widgets. Table, form, block editor.",
								],
								[
									"03",
									"questpie-audit",
									"Change logging via global hooks. Every create, update, delete tracked. Zero config required.",
								],
								[
									"04",
									"Your module",
									"Same file conventions, same patterns. Build your own module. Publish to npm. No special APIs.",
								],
							].map(([idx, title, desc]) => (
								<div
									key={idx}
									className="bg-background hover:outline-primary p-5 transition-[outline-color] hover:relative hover:z-[2] hover:outline hover:outline-1 hover:-outline-offset-1"
								>
									<div className="text-primary mb-1.5 font-mono text-[10px] tracking-[3px]">
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
				<section>
					<Lmw>
						<SectionBar
							num="07"
							label="Developer experience"
							title="The details matter."
						/>
						<div className="bg-border grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-px">
							<div className="bg-background hover:outline-primary p-5 transition-[outline-color] hover:relative hover:z-[2] hover:outline hover:outline-1 hover:-outline-offset-1">
								<div className="text-primary mb-1.5 font-mono text-[10px] tracking-[3px]">
									WATCH
								</div>
								<div className="bg-background text-muted-foreground my-2 px-4 py-3 font-mono text-[11px] leading-[1.8] whitespace-pre">
									<span className="text-primary">$</span> questpie dev{"\n"}
									<span className="text-[var(--syntax-string)]">
										&#10003;
									</span>{" "}
									Watching...{"\n"}
									<span className="text-[var(--syntax-string)]">
										&#10003;
									</span>{" "}
									server (23 collections)
									{"\n"}
									<span className="text-[var(--syntax-string)]">
										&#10003;
									</span>{" "}
									admin-client (15 blocks)
								</div>
								<div className="text-muted-foreground text-xs leading-normal">
									Instant regeneration on file changes.
								</div>
							</div>
							<div className="bg-background hover:outline-primary p-5 transition-[outline-color] hover:relative hover:z-[2] hover:outline hover:outline-1 hover:-outline-offset-1">
								<div className="text-primary mb-1.5 font-mono text-[10px] tracking-[3px]">
									SCAFFOLD
								</div>
								<div className="bg-background text-muted-foreground my-2 px-4 py-3 font-mono text-[11px] leading-[1.8] whitespace-pre">
									<span className="text-primary">$</span> questpie add
									collection products
									{"\n"}
									<span className="text-[var(--syntax-string)]">
										&#10003;
									</span>{" "}
									Created collections/products.ts{"\n"}
									<span className="text-[var(--syntax-string)]">
										&#10003;
									</span>{" "}
									Regenerated types
								</div>
								<div className="text-muted-foreground text-xs leading-normal">
									One command. Typed immediately.
								</div>
							</div>
							<div className="bg-background hover:outline-primary p-5 transition-[outline-color] hover:relative hover:z-[2] hover:outline hover:outline-1 hover:-outline-offset-1">
								<div className="text-primary mb-1.5 font-mono text-[10px] tracking-[3px]">
									VALIDATE
								</div>
								<div className="bg-background text-muted-foreground my-2 px-4 py-3 font-mono text-[11px] leading-[1.8] whitespace-pre">
									<span className="text-destructive">
										&#10007; Server defines blocks/hero
									</span>
									{"\n"}
									<span className="text-destructive">
										&nbsp; but no renderer found
									</span>
									{"\n"}
									<span className="text-primary">
										&rarr; Create admin/blocks/hero.tsx
									</span>
								</div>
								<div className="text-muted-foreground text-xs leading-normal">
									Mismatch = build error. Not runtime surprise.
								</div>
							</div>
							<div className="bg-background hover:outline-primary p-5 transition-[outline-color] hover:relative hover:z-[2] hover:outline hover:outline-1 hover:-outline-offset-1">
								<div className="text-primary mb-1.5 font-mono text-[10px] tracking-[3px]">
									REALTIME
								</div>
								<div
									className="bg-background text-muted-foreground my-2 font-mono text-xs leading-relaxed"
									style={{ padding: "10px 14px", fontSize: 11 }}
								>
									<pre>
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
									</pre>
								</div>
								<div className="text-muted-foreground text-xs leading-normal">
									SSE multiplexer. PG NOTIFY. Auto-reconnect.
								</div>
							</div>
						</div>
					</Lmw>
				</section>
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
