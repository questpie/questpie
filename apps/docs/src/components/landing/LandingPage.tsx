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
		<div className="grid grid-cols-[auto_1fr] border-b border-border">
			<div className="bg-card px-5 py-4 text-5xl font-extrabold text-primary leading-none min-w-[100px] text-center border-r border-border flex items-center justify-center max-sm:text-3xl max-sm:px-4 max-sm:min-w-[72px]">
				{num}
			</div>
			<div className="px-5 py-4 flex flex-col justify-center">
				<div className="text-[10px] tracking-[3px] uppercase text-primary">
					{label}
				</div>
				<div className="text-base font-bold text-foreground mt-0.5 sm:text-lg">
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
	return <div className={cn("rv", className)}>{children}</div>;
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
				"max-w-[1200px] mx-auto relative z-[1] border-x border-border",
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
				"p-6 border-b border-border border-r border-border max-[900px]:border-r-0",
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
		<div className={cn("p-6 border-b border-border", className)}>
			{children}
		</div>
	);
}

/* ─── File Conventions Section (with toggle) ─── */

function FileConventionsSection() {
	const [layout, setLayout] = useState<"by-type" | "by-feature">("by-type");

	const byTypeTree = (
		<pre className="p-6" style={{ fontSize: 12 }}>
			<span className="c">src/questpie/server/</span>
			{`
├── collections/
│   ├── `}
			<span className="kw">posts.ts</span>
			{`
│   └── `}
			<span className="kw">users.ts</span>
			{`
├── functions/
│   └── `}
			<span className="kw">admin/stats.ts</span>
			{`
├── blocks/
│   └── `}
			<span className="kw">hero.ts</span>
			{`
├── jobs/
│   └── `}
			<span className="kw">send-newsletter.ts</span>
			{`
├── services/
│   └── `}
			<span className="kw">stripe.ts</span>
			{`
├── seeds/
│   └── `}
			<span className="kw">demo-data.ts</span>
			{`
└── `}
			<span className="kw">auth.ts</span>
		</pre>
	);

	const byFeatureTree = (
		<pre className="p-6" style={{ fontSize: 12 }}>
			<span className="c">src/questpie/server/</span>
			{`
├── blog/
│   ├── `}
			<span className="kw">posts.collection.ts</span>
			{`
│   ├── `}
			<span className="kw">hero.block.ts</span>
			{`
│   └── `}
			<span className="kw">newsletter.job.ts</span>
			{`
├── shop/
│   ├── `}
			<span className="kw">products.collection.ts</span>
			{`
│   ├── `}
			<span className="kw">orders.collection.ts</span>
			{`
│   └── `}
			<span className="kw">stripe.service.ts</span>
			{`
├── shared/
│   ├── `}
			<span className="kw">users.collection.ts</span>
			{`
│   └── `}
			<span className="kw">stats.function.ts</span>
			{`
└── `}
			<span className="kw">auth.ts</span>
		</pre>
	);

	const byTypeBadges = [
		["posts.ts", "CRUD + API + ADMIN", "l-success"],
		["users.ts", "AUTH-CONNECTED ENTITY", "l-success"],
		["admin/stats.ts", "TYPE-SAFE RPC", "primary"],
		["hero.ts", "VISUAL BLOCK", "l-warning"],
		["send-newsletter.ts", "BACKGROUND JOB", "l-info"],
		["stripe.ts", "SINGLETON SERVICE", "muted-foreground"],
		["demo-data.ts", "DB SEED", "muted-foreground"],
		["auth.ts", "BETTER AUTH", "muted-foreground"],
	];

	const byFeatureBadges = [
		["posts.collection.ts", "COLLECTION", "l-success"],
		["hero.block.ts", "BLOCK", "l-warning"],
		["newsletter.job.ts", "JOB", "l-info"],
		["products.collection.ts", "COLLECTION", "l-success"],
		["orders.collection.ts", "COLLECTION", "l-success"],
		["stripe.service.ts", "SERVICE", "muted-foreground"],
		["users.collection.ts", "COLLECTION", "l-success"],
		["stats.function.ts", "RPC", "primary"],
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
				<div className="flex border-b border-border">
					{(["by-type", "by-feature"] as const).map((mode) => (
						<button
							key={mode}
							type="button"
							onClick={() => setLayout(mode)}
							className={cn(
								"flex-1 py-2 text-[10px] uppercase tracking-[2px] font-semibold transition-colors border-r border-border last:border-r-0",
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
					<TwoColLeft className="code-block p-0!">
						{layout === "by-type" ? byTypeTree : byFeatureTree}
					</TwoColLeft>
					<TwoColRight className="p-0!">
						<div
							className="grid gap-px bg-border"
							style={{ gridTemplateColumns: "1fr" }}
						>
							{badges.map(([name, badge, color]) => (
								<div
									key={name}
									className="flex justify-between items-center px-5 py-2.5 bg-background"
								>
									<span className="text-foreground">{name}</span>
									<span
										className="text-[10px] tracking-wide"
										style={{ color: `var(--${color})` }}
									>
										{badge}
									</span>
								</div>
							))}
						</div>
						<div className="px-5 py-3 text-[11px] text-muted-foreground border-t border-border">
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
					? "bg-background/95 backdrop-blur-sm border-border"
					: "bg-background border-border",
			)}
		>
			<div className="mx-auto max-w-[1200px] px-6 h-full flex items-center justify-between max-sm:px-3">
				<Link to="/" className="flex items-center gap-2">
					<img
						src="/symbol/Q-symbol-dark-pink.svg"
						alt="QUESTPIE"
						className="block h-6 w-auto dark:hidden sm:hidden"
					/>
					<img
						src="/symbol/Q-symbol-white-pink.svg"
						alt="QUESTPIE"
						className="hidden h-6 w-auto dark:block dark:sm:hidden"
					/>
					<img
						src="/logo/Questpie-dark-pink.svg"
						alt="QUESTPIE"
						className="hidden h-5 w-auto dark:hidden sm:block"
					/>
					<img
						src="/logo/Questpie-white-pink.svg"
						alt="QUESTPIE"
						className="hidden h-5 w-auto dark:sm:block"
					/>
				</Link>

				<div className="hidden md:flex items-center gap-6">
					{navItems.map((item) =>
						item.type === "internal" ? (
							<Link
								key={item.label}
								to={item.href}
								params={item.params as never}
								className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider transition-colors hover:text-foreground"
							>
								{item.label}
							</Link>
						) : (
							<a
								key={item.label}
								href={item.href}
								target="_blank"
								rel="noreferrer"
								className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider transition-colors hover:text-foreground"
							>
								{item.label}
							</a>
						),
					)}
					<ThemeToggle />
					<Link
						to="/docs/$"
						params={{ _splat: "start-here/first-app" }}
						className="inline-flex h-7 items-center justify-center border border-primary/40 bg-primary/10 px-4 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary transition-all hover:bg-primary hover:text-white"
					>
						Get started
					</Link>
				</div>

				<button
					type="button"
					className="p-1.5 text-muted-foreground transition-colors hover:text-foreground md:hidden"
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
				<div className="absolute inset-x-0 top-full border-b border-border bg-background p-4 md:hidden">
					<div className="mx-auto max-w-[1200px] flex flex-col gap-3">
						<Link
							to="/docs/$"
							className="text-sm text-muted-foreground"
							onClick={() => setMobileOpen(false)}
						>
							Docs
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "examples" }}
							className="text-sm text-muted-foreground"
							onClick={() => setMobileOpen(false)}
						>
							Examples
						</Link>
						<a
							href="https://github.com/questpie/questpie"
							target="_blank"
							rel="noreferrer"
							className="text-sm text-muted-foreground"
							onClick={() => setMobileOpen(false)}
						>
							GitHub
						</a>
						<div className="my-1 h-px bg-border" />
						<div className="flex items-center justify-between">
							<ThemeToggle />
							<Link
								to="/docs/$"
								params={{ _splat: "start-here/first-app" }}
								className="inline-flex h-7 items-center border border-primary/40 bg-primary/10 px-3 font-mono text-[10px] uppercase tracking-wider text-primary"
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
				<div className="grid grid-cols-4 gap-px bg-border max-sm:grid-cols-2">
					<div className="bg-background p-5">
						<div className="text-[9px] tracking-[2px] uppercase text-muted-foreground/60 mb-2">
							Product
						</div>
						<Link
							to="/docs/$"
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							Docs
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "examples" }}
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							Examples
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "start-here" }}
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							Getting Started
						</Link>
						<a
							href="https://github.com/questpie/questpie/releases"
							target="_blank"
							rel="noreferrer"
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							Releases
						</a>
					</div>
					<div className="bg-background p-5">
						<div className="text-[9px] tracking-[2px] uppercase text-muted-foreground/60 mb-2">
							Ecosystem
						</div>
						<Link
							to="/docs/$"
							params={{ _splat: "frontend/adapters/hono" }}
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							Hono
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "frontend/adapters/elysia" }}
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							Elysia
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "frontend/adapters/nextjs" }}
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							Next.js
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "frontend/tanstack-query" }}
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							TanStack
						</Link>
					</div>
					<div className="bg-background p-5">
						<div className="text-[9px] tracking-[2px] uppercase text-muted-foreground/60 mb-2">
							Community
						</div>
						<a
							href="https://github.com/questpie/questpie"
							target="_blank"
							rel="noreferrer"
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							GitHub
						</a>
						<a
							href="https://github.com/questpie/questpie/issues"
							target="_blank"
							rel="noreferrer"
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							Issues
						</a>
						<a
							href="https://github.com/questpie/questpie/pulls"
							target="_blank"
							rel="noreferrer"
							className="block text-xs text-muted-foreground py-0.5 hover:text-primary transition-colors"
						>
							Pull Requests
						</a>
					</div>
					<div className="bg-background p-5">
						<div className="text-[9px] tracking-[2px] uppercase text-muted-foreground/60 mb-2">
							Install
						</div>
						<div className="text-xs text-primary mt-1">npx create-questpie</div>
						<div className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
							MIT License
							<br />
							TypeScript &middot; Drizzle &middot; Zod
							<br />
							Better Auth &middot; Hono
						</div>
					</div>
				</div>
				<div className="px-6 py-4 flex justify-between items-center flex-wrap gap-2 text-[11px] text-muted-foreground/60">
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
					if (e.isIntersecting) e.target.classList.add("v");
				}
			},
			{ threshold: 0.1 },
		);
		document.querySelectorAll(".rv").forEach((el) => obs.observe(el));
		return () => obs.disconnect();
	}, []);

	return (
		<div className="landing bg-background bg-grid-quest text-foreground">
			<Nav />

			{/* ─── §1 HERO ─── */}
			<section className="mt-14 border-b border-border">
				<div className="grid grid-cols-2 min-h-[calc(100vh-56px)] max-w-[1200px] mx-auto border-x border-border max-[900px]:grid-cols-1">
					<div className="px-6 py-16 sm:py-20 flex flex-col justify-center border-r border-border max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:border-border">
						<div className="text-[10px] tracking-[3px] text-primary uppercase mb-6">
							Open source framework
						</div>
						<h1 className="text-[clamp(28px,5vw,52px)] font-extrabold text-foreground leading-[1.05] tracking-tight">
							One backend.
							<br />
							Ship everywhere.
						</h1>
						<p className="text-sm text-muted-foreground leading-relaxed mt-5 max-w-[440px]">
							Define your schema once. Get REST, RPC, realtime, typed client
							SDK, and optional admin UI. Server-first TypeScript. Built on
							Drizzle, Zod, Better Auth.
						</p>
						<div className="flex gap-px mt-8">
							<Link
								to="/docs/$"
								params={{ _splat: "start-here/first-app" }}
								className="px-5 py-2.5 bg-primary border border-primary text-white text-[11px] font-semibold uppercase tracking-wider transition-colors hover:bg-primary/80"
							>
								Get started &rarr;
							</Link>
							<a
								href="https://github.com/questpie/questpie"
								target="_blank"
								rel="noreferrer"
								className="px-5 py-2.5 bg-background border border-border text-foreground text-[11px] font-semibold uppercase tracking-wider transition-colors hover:border-primary hover:text-primary"
							>
								GitHub &#9733;
							</a>
						</div>
						<div className="flex gap-px mt-6 flex-wrap">
							{[
								"TypeScript",
								"Server-first",
								"Zero lock-in",
								"MIT license",
							].map((t) => (
								<span
									key={t}
									className="text-[10px] px-2.5 py-1 bg-card text-muted-foreground tracking-wide"
								>
									{t}
								</span>
							))}
						</div>
					</div>
					<div className="flex flex-col">
						<div className="code-block flex-1 border-b border-border">
							<pre>
								<span className="kw">collection</span>(
								<span className="s">"posts"</span>)
								{`
  .`}
								<span className="fn">fields</span>
								{`(({ f }) => ({
    title:   f.`}
								<span className="fn">text</span>(<span className="n">255</span>
								).<span className="fn">required</span>
								{`(),
    content: f.`}
								<span className="fn">richText</span>().
								<span className="fn">localized</span>
								{`(),
    status:  f.`}
								<span className="fn">select</span>
								{`([
      { value: `}
								<span className="s">"draft"</span>
								{`, label: `}
								<span className="s">"Draft"</span>
								{` },
      { value: `}
								<span className="s">"published"</span>
								{`, label: `}
								<span className="s">"Published"</span>
								{` },
    ]),
    author:  f.`}
								<span className="fn">relation</span>(
								<span className="s">"users"</span>).
								<span className="fn">required</span>
								{`(),
    tags:    f.`}
								<span className="fn">relation</span>(
								<span className="s">"tags"</span>).
								<span className="fn">hasMany</span>
								{`({ foreignKey: `}
								<span className="s">"postId"</span>
								{` }),
    seo:     f.`}
								<span className="fn">object</span>
								{`({
      title: f.`}
								<span className="fn">text</span>
								{`(),
      desc:  f.`}
								<span className="fn">text</span>(<span className="n">160</span>)
								{`,
    }),
  }))
  .`}
								<span className="fn">access</span>
								{`({
    read: `}
								<span className="kw">true</span>
								{`,
    create: ({ session }) => !!session,
    update: ({ session, doc }) =>
      doc.authorId === session?.user?.id,
  })
  .`}
								<span className="fn">versioning</span>
								{`({ enabled: `}
								<span className="kw">true</span>
								{`, maxVersions: `}
								<span className="n">10</span>
								{` })`}
							</pre>
						</div>
						<div className="grid grid-cols-4 gap-px bg-border">
							{[
								"REST API",
								"Typed client SDK",
								"Admin panel",
								"Zod validation",
							].map((label) => (
								<div
									key={label}
									className="bg-background px-3 py-2.5 text-[10px] tracking-wide text-success"
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
							<TwoColLeft className="code-block p-0!">
								<pre className="p-6">
									<span className="c">
										{"// This one definition generates:"}
									</span>
									{"\n"}
									<span className="c">
										{"// REST, RPC, Admin, Validation,"}
									</span>
									{"\n"}
									<span className="c">{"// Client SDK, Realtime, Search"}</span>
									{"\n\n"}
									<span className="kw">collection</span>(
									<span className="s">"posts"</span>)
									{`
  .`}
									<span className="fn">fields</span>
									{`(({ f }) => ({
    title:   f.`}
									<span className="fn">text</span>(
									<span className="n">255</span>).
									<span className="fn">required</span>
									{`(),
    content: f.`}
									<span className="fn">richText</span>().
									<span className="fn">localized</span>
									{`(),
    status:  f.`}
									<span className="fn">select</span>
									{`([...]).`}
									<span className="fn">required</span>
									{`(),
    author:  f.`}
									<span className="fn">relation</span>(
									<span className="s">"users"</span>)
									{`,
  }))`}
								</pre>
							</TwoColLeft>
							<TwoColRight>
								<ul className="list-none text-xs p-0 m-0">
									{[
										["REST API", "/api/collections/posts"],
										["RPC functions", "typed, namespaced"],
										["Realtime via SSE", "subscribe to changes"],
										["Typed client SDK", "zero codegen step"],
										["Admin panel", "table, form, block editor"],
										["Zod validation", "from field definitions"],
										["Access control", "row-level, field-level"],
										["i18n", "two-table strategy, per-field localization"],
										["Versioning", "workflow stages, drafts → published"],
									].map(([title, desc]) => (
										<li
											key={title}
											className="py-1 flex gap-2.5 border-b border-border"
										>
											<span className="text-success">&#10003;</span>
											<span className="text-foreground">{title}</span>
											<span className="text-muted-foreground ml-1">
												&mdash;{" "}
												{desc.includes("→")
													? desc.split("→").map((part, i) => (
															<span key={i}>
																{i > 0 && (
																	<span className="text-success"> → </span>
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
							<TwoColLeft className="p-0! border-b-0!">
								<div
									className="grid gap-px bg-border"
									style={{ gridTemplateColumns: "100px 1fr" }}
								>
									{[
										["Runtime", "Node.js · Bun · Cloudflare Workers · Deno"],
										["Database", "PostgreSQL · PGlite · Neon · PlanetScale"],
										["Queue", "pg-boss · Cloudflare Queues"],
										["Search", "Postgres FTS · Meilisearch · Elasticsearch"],
										["Realtime", "PG NOTIFY · Redis Streams"],
										["Storage", "Local · S3 · R2 · GCS (FlyDrive)"],
										["HTTP", "Hono · Elysia · Next.js · TanStack Start"],
									].map(([cat, val]) => (
										<>
											<div
												key={`c-${cat}`}
												className="px-4 py-2 text-[10px] tracking-[2px] text-primary uppercase bg-card flex items-center"
											>
												{cat}
											</div>
											<div
												key={`v-${cat}`}
												className="px-4 py-2 text-foreground bg-background"
											>
												{val}
											</div>
										</>
									))}
								</div>
							</TwoColLeft>
							<TwoColRight className="code-block p-0! border-b-0!">
								<pre className="p-6">
									{`runtimeConfig({
  db: { url: `}
									<span className="s">DATABASE_URL</span>
									{` },
  queue: { adapter: `}
									<span className="fn">pgBossAdapter</span>
									{`() },
  search: `}
									<span className="fn">postgresSearchAdapter</span>
									{`(),
  realtime: { adapter: `}
									<span className="fn">pgNotifyAdapter</span>
									{`() },
  storage: { driver: `}
									<span className="fn">s3Driver</span>
									{`({
    bucket: `}
									<span className="s">"assets"</span>
									{`
  }) },
  email: { adapter: `}
									<span className="fn">smtpAdapter</span>
									{`() },
})`}
								</pre>
								<div className="mt-4 pt-3 border-t border-border mx-6 text-[11px] text-muted-foreground pb-4">
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
							<TwoColLeft className="code-block p-0!">
								<pre className="p-6">
									<span className="kw">collection</span>(
									<span className="s">"posts"</span>)
									{`
  .`}
									<span className="fn">admin</span>
									{`(({ c }) => ({
    label: { en: `}
									<span className="s">"Posts"</span>
									{`, sk: `}
									<span className="s">"Príspevky"</span>
									{` },
    icon: c.`}
									<span className="fn">icon</span>(
									<span className="s">"ph:article"</span>)
									{`,
  }))
  .`}
									<span className="fn">list</span>
									{`(({ v, f }) => v.`}
									<span className="fn">table</span>
									{`({
    columns: [`}
									<span className="s">"title"</span>
									{`, `}
									<span className="s">"status"</span>
									{`, `}
									<span className="s">"author"</span>
									{`],
    defaultSort: { field: f.createdAt },
  }))
  .`}
									<span className="fn">form</span>
									{`(({ v, f }) => v.`}
									<span className="fn">form</span>
									{`({
    fields: [f.title, f.content],
    sidebar: { fields: [f.status, f.author] },
  }))`}
								</pre>
								<div className="mt-4 pt-3 border-t border-border mx-6 text-[11px] text-muted-foreground pb-4">
									Swappable package. Web, React Native, or build your own.
								</div>
							</TwoColLeft>
							<TwoColRight className="p-0!">
								<div className="grid grid-cols-[140px_1fr] text-[11px] overflow-hidden max-[900px]:grid-cols-1">
									<div className="bg-card border-r border-border p-3 max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:border-border max-[900px]:flex max-[900px]:gap-1 max-[900px]:flex-wrap">
										<div className="text-[9px] tracking-[2px] text-muted-foreground/60 uppercase px-3.5 py-1 mb-1 max-[900px]:mb-0">
											Admin
										</div>
										<div className="px-3.5 py-1 text-foreground border-l-2 border-primary">
											Posts
										</div>
										<div className="px-3.5 py-1 text-muted-foreground">
											Users
										</div>
										<div className="px-3.5 py-1 text-muted-foreground">
											Settings
										</div>
										<div className="px-3.5 py-1 text-muted-foreground">
											Assets
										</div>
										<div className="px-3.5 py-1 text-muted-foreground">
											Audit log
										</div>
									</div>
									<div className="flex flex-col">
										<div className="flex justify-between items-center px-3 py-2 border-b border-border">
											<span className="font-bold text-foreground">Posts</span>
											<div className="flex gap-1">
												<span className="text-[9px] px-1.5 py-0.5 bg-primary text-white opacity-80">
													EN
												</span>
												<span className="text-[9px] px-1.5 py-0.5 border border-border text-muted-foreground">
													SK
												</span>
											</div>
										</div>
										<table className="admin-table">
											<thead>
												<tr>
													<th>Title</th>
													<th>Status</th>
													<th>Author</th>
													<th>Date</th>
												</tr>
											</thead>
											<tbody>
												<tr>
													<td className="text-foreground">
														Getting Started Guide
													</td>
													<td className="text-success text-[9px] tracking-wide">
														PUBLISHED
													</td>
													<td>admin</td>
													<td>Mar 6</td>
												</tr>
												<tr>
													<td className="text-foreground">
														Adapter Architecture
													</td>
													<td className="text-warning text-[9px] tracking-wide">
														DRAFT
													</td>
													<td>admin</td>
													<td>Mar 5</td>
												</tr>
												<tr>
													<td className="text-foreground">
														File Conventions Deep Dive
													</td>
													<td className="text-success text-[9px] tracking-wide">
														PUBLISHED
													</td>
													<td>admin</td>
													<td>Mar 3</td>
												</tr>
												<tr>
													<td className="text-foreground">
														Block System Overview
													</td>
													<td className="text-warning text-[9px] tracking-wide">
														DRAFT
													</td>
													<td>admin</td>
													<td>Mar 1</td>
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
						<div className="flex items-center flex-wrap gap-0 p-6 border-b border-border overflow-x-auto max-sm:p-4">
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
										className="py-2 px-3.5 bg-card border border-border text-[11px] text-foreground max-sm:text-[10px] max-sm:py-1.5 max-sm:px-2.5"
									>
										{step}
									</div>
								</>
							))}
						</div>
						<div className="code-block border-b border-border">
							<pre>
								<span className="kw">const</span>
								{` { docs } = `}
								<span className="kw">await</span>
								{` client.collections.posts.`}
								<span className="fn">find</span>
								{`({
  where: { status: { eq: `}
								<span className="s">"published"</span>
								{` } },
  orderBy: { createdAt: `}
								<span className="s">"desc"</span>
								{` },
  with: { author: `}
								<span className="kw">true</span>
								{`, tags: `}
								<span className="kw">true</span>
								{` },
  locale: `}
								<span className="s">"sk"</span>
								{`,
});
`}
								<span className="c">{"// docs[0].title → string"}</span>
								{`
`}
								<span className="c">{"// docs[0].author → User"}</span>
								{`
`}
								<span className="c">{"// docs[0].tags → Tag[]"}</span>
								{`
`}
								<span className="c">
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
						<div className="grid gap-px bg-border grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
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
									className="bg-background p-5 transition-[outline-color] hover:outline hover:outline-1 hover:outline-primary hover:-outline-offset-1 hover:z-[2] hover:relative"
								>
									<div className="text-[10px] tracking-[3px] text-primary mb-1.5">
										{idx}
									</div>
									<div className="text-[13px] font-bold text-foreground mb-1">
										{title}
									</div>
									<div className="text-xs text-muted-foreground leading-normal">
										{desc}
									</div>
								</div>
							))}
						</div>
						<div className="px-5 py-3 text-[11px] text-muted-foreground border-b border-border">
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
						<div className="grid gap-px bg-border grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
							<div className="bg-background p-5 transition-[outline-color] hover:outline hover:outline-1 hover:outline-primary hover:-outline-offset-1 hover:z-[2] hover:relative">
								<div className="text-[10px] tracking-[3px] text-primary mb-1.5">
									WATCH
								</div>
								<div className="term my-2">
									<span className="ps">$</span> questpie dev{"\n"}
									<span className="ok">&#10003;</span> Watching...{"\n"}
									<span className="ok">&#10003;</span> server (23 collections)
									{"\n"}
									<span className="ok">&#10003;</span> admin-client (15 blocks)
								</div>
								<div className="text-xs text-muted-foreground leading-normal">
									Instant regeneration on file changes.
								</div>
							</div>
							<div className="bg-background p-5 transition-[outline-color] hover:outline hover:outline-1 hover:outline-primary hover:-outline-offset-1 hover:z-[2] hover:relative">
								<div className="text-[10px] tracking-[3px] text-primary mb-1.5">
									SCAFFOLD
								</div>
								<div className="term my-2">
									<span className="ps">$</span> questpie add collection products
									{"\n"}
									<span className="ok">&#10003;</span> Created
									collections/products.ts{"\n"}
									<span className="ok">&#10003;</span> Regenerated types
								</div>
								<div className="text-xs text-muted-foreground leading-normal">
									One command. Typed immediately.
								</div>
							</div>
							<div className="bg-background p-5 transition-[outline-color] hover:outline hover:outline-1 hover:outline-primary hover:-outline-offset-1 hover:z-[2] hover:relative">
								<div className="text-[10px] tracking-[3px] text-primary mb-1.5">
									VALIDATE
								</div>
								<div className="term my-2">
									<span className="er">
										&#10007; Server defines blocks/hero
									</span>
									{"\n"}
									<span className="er">&nbsp; but no renderer found</span>
									{"\n"}
									<span className="fx">
										&rarr; Create admin/blocks/hero.tsx
									</span>
								</div>
								<div className="text-xs text-muted-foreground leading-normal">
									Mismatch = build error. Not runtime surprise.
								</div>
							</div>
							<div className="bg-background p-5 transition-[outline-color] hover:outline hover:outline-1 hover:outline-primary hover:-outline-offset-1 hover:z-[2] hover:relative">
								<div className="text-[10px] tracking-[3px] text-primary mb-1.5">
									REALTIME
								</div>
								<div
									className="code-block my-2"
									style={{ padding: "10px 14px", fontSize: 11 }}
								>
									<pre>
										{`client.realtime.`}
										<span className="fn">subscribe</span>
										{`(
  { resource: `}
										<span className="s">"posts"</span>
										{` },
  (event) => `}
										<span className="fn">updateUI</span>
										{`(event)
);`}
									</pre>
								</div>
								<div className="text-xs text-muted-foreground leading-normal">
									SSE multiplexer. PG NOTIFY. Auto-reconnect.
								</div>
							</div>
						</div>
					</Lmw>
				</section>
			</Reveal>

			{/* ─── §9 CTA ─── */}
			<section className="border-y border-border">
				<div className="grid grid-cols-[1fr_auto] max-w-[1200px] mx-auto border-x border-border max-[900px]:grid-cols-1">
					<div className="py-10 px-6 border-r border-border max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:border-border">
						<h2 className="text-[clamp(20px,3vw,28px)] font-extrabold text-foreground tracking-tight">
							One backend. Ship everywhere.
						</h2>
						<div className="mt-3 text-sm text-primary">npx create-questpie</div>
					</div>
					<div className="p-6 flex flex-col gap-px justify-center">
						<Link
							to="/docs/$"
							params={{ _splat: "start-here/first-app" }}
							className="px-5 py-2.5 bg-primary border border-primary text-white text-[11px] uppercase tracking-wider text-center block transition-colors hover:bg-primary/80"
						>
							Read the docs &rarr;
						</Link>
						<Link
							to="/docs/$"
							params={{ _splat: "examples" }}
							className="px-5 py-2.5 bg-background border border-border text-foreground text-[11px] uppercase tracking-wider text-center block transition-colors hover:border-primary hover:text-primary"
						>
							Browse examples &rarr;
						</Link>
						<a
							href="https://github.com/questpie/questpie"
							target="_blank"
							rel="noreferrer"
							className="px-5 py-2.5 bg-background border border-border text-foreground text-[11px] uppercase tracking-wider text-center block transition-colors hover:border-primary hover:text-primary"
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
