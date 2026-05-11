import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

function Reveal({
	children,
	className,
	delay,
}: {
	children: ReactNode;
	className?: string;
	delay?: number;
}) {
	return (
		<div
			data-reveal
			className={cn(
				"translate-y-4 opacity-0 transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] data-[visible]:translate-y-0 data-[visible]:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none",
				className,
			)}
			style={delay ? { transitionDelay: `${delay}ms` } : undefined}
		>
			{children}
		</div>
	);
}

const USE_CASES = [
	{ label: "Restaurants & Cafes", href: "/for/restaurants" },
	{ label: "E-commerce & Retail", href: "/for/ecommerce" },
	{ label: "Agencies & Studios", href: "/for/agencies" },
	{ label: "Real Estate", href: "/for/real-estate" },
	{ label: "Portfolios & Freelancers", href: "/for/portfolios" },
];

const navItems = [
	{ label: "Framework", href: "#framework", type: "anchor" as const },
	{ label: "Autopilot", href: "/autopilot", type: "internal" as const },
	{ label: "Cloud", href: "/cloud", type: "internal" as const },
	{ label: "Use cases", href: "#", type: "dropdown" as const },
	{ label: "Docs", href: "/docs/$", type: "internal" as const },
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
		handleScroll();
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	const renderNavLink = (item: (typeof navItems)[number]) => {
		const cls =
			"hover:text-foreground rounded-[var(--control-radius-inner)] px-3 py-2 transition-colors";

		if (item.type === "anchor") {
			return (
				<a key={item.label} href={item.href} className={cls}>
					{item.label}
				</a>
			);
		}
		if (item.type === "dropdown") {
			return (
				<div key={item.label} className="group relative">
					<button type="button" className={cn(cls, "inline-flex items-center gap-1")}>
						{item.label}
						<Icon ssr icon="ph:caret-down" width={10} height={10} />
					</button>
					<div className="pointer-events-none absolute top-full left-0 pt-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
						<div className="bg-background/95 border-border-subtle min-w-48 rounded-[var(--surface-radius)] border p-1 shadow-lg backdrop-blur-xl">
							{USE_CASES.map((uc) => (
								<Link
									key={uc.href}
									to={uc.href}
									className="text-muted-foreground hover:text-foreground hover:bg-surface-low block rounded-[var(--control-radius-inner)] px-3 py-2 text-sm transition-colors"
								>
									{uc.label}
								</Link>
							))}
						</div>
					</div>
				</div>
			);
		}
		if (item.type === "internal") {
			return (
				<Link key={item.label} to={item.href} className={cls}>
					{item.label}
				</Link>
			);
		}
		return (
			<a
				key={item.label}
				href={item.href}
				target="_blank"
				rel="noreferrer"
				className={cls}
			>
				{item.label}
			</a>
		);
	};

	return (
		<header
			className={cn(
				"fixed inset-x-0 top-0 z-50 h-14 transition-[background-color,border-color] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)]",
				isScrolled
					? "bg-background/60 border-border-subtle border-b backdrop-blur-xl"
					: "border-transparent bg-transparent",
			)}
		>
			<div className="mx-auto flex h-full max-w-5xl items-center justify-between px-6">
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

					<div className="text-muted-foreground hidden items-center gap-1 text-sm md:flex">
						{navItems.map(renderNavLink)}
					</div>
				</div>

				<div className="flex items-center gap-2">
					<ThemeToggle />
					<Link
						to="/docs/$"
						params={{ _splat: "start-here/first-app" }}
						className={cn(primaryCta, "hidden sm:inline-flex")}
					>
						Start for free
					</Link>
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground flex size-10 items-center justify-center rounded-[var(--control-radius)] transition-colors md:hidden"
						onClick={() => setMobileOpen((v) => !v)}
						aria-label="Toggle navigation"
					>
						<Icon
							ssr
							icon={mobileOpen ? "ph:x" : "ph:list"}
							width={20}
							height={20}
						/>
					</button>
				</div>
			</div>

			{mobileOpen && (
				<div className="bg-background/95 border-border-subtle absolute inset-x-0 top-full border-b p-4 backdrop-blur-xl md:hidden">
					<div className="mx-auto flex max-w-5xl flex-col gap-1">
						{navItems.map((item) => {
							if (item.type === "dropdown") {
								return (
									<div key={item.label}>
										<span className="text-muted-foreground/60 px-3 py-1 text-xs font-medium uppercase tracking-wider">
											{item.label}
										</span>
										{USE_CASES.map((uc) => (
											<Link
												key={uc.href}
												to={uc.href}
												className="text-muted-foreground hover:text-foreground rounded-[var(--control-radius)] px-3 py-2.5 pl-6 text-sm transition-colors"
												onClick={() => setMobileOpen(false)}
											>
												{uc.label}
											</Link>
										))}
									</div>
								);
							}
							return (
								<a
									key={item.label}
									href={
										item.type === "internal" ? item.href : item.href
									}
									{...(item.type === "external"
										? { target: "_blank", rel: "noreferrer" }
										: {})}
									className="text-muted-foreground hover:text-foreground rounded-[var(--control-radius)] px-3 py-2.5 text-sm transition-colors"
									onClick={() => setMobileOpen(false)}
								>
									{item.label}
								</a>
							);
						})}
						<div className="bg-border-subtle my-2 h-px" />
						<div className="flex items-center justify-between">
							<ThemeToggle />
							<Link
								to="/docs/$"
								params={{ _splat: "start-here/first-app" }}
								className={primaryCta}
								onClick={() => setMobileOpen(false)}
							>
								Start for free
							</Link>
						</div>
					</div>
				</div>
			)}
		</header>
	);
}

function HeroSection() {
	return (
		<section className="mt-14 px-6 pt-24 pb-16 md:pt-36 md:pb-24">
			<div className="mx-auto max-w-3xl text-center">
				<p className="text-muted-foreground mb-6 text-sm tracking-wide">
					Open-source business platform
				</p>

				<h1 className="text-foreground mb-6 text-4xl leading-[1.08] font-semibold text-balance md:text-5xl lg:text-6xl">
					Build your site.{" "}
					<br className="hidden sm:block" />
					Automate your business.{" "}
					<br className="hidden sm:block" />
					<span className="bg-gradient-to-r from-[#b700ff] to-[#d946ef] bg-clip-text text-transparent">
						Own everything.
					</span>
				</h1>

				<p className="text-muted-foreground mx-auto mb-10 max-w-xl text-lg leading-relaxed text-pretty">
					QUESTPIE replaces the SaaS patchwork with one open-source platform.
					A modern CMS, AI agents for operations, and managed cloud
					infrastructure.
				</p>

				<div className="flex flex-wrap items-center justify-center gap-3">
					<Link
						to="/docs/$"
						params={{ _splat: "start-here/first-app" }}
						className={primaryCta}
					>
						Start for free
						<Icon ssr icon="ph:arrow-right" width={16} height={16} />
					</Link>
					<a href="#autopilot" className={secondaryCta}>
						Get early access
						<Icon ssr icon="ph:arrow-down" width={16} height={16} />
					</a>
				</div>

				<div className="text-muted-foreground/50 mt-14 flex flex-wrap items-center justify-center gap-4 text-xs">
					<span className="flex items-center gap-1.5">
						<Icon ssr icon="ph:code" width={13} height={13} />
						Self-host free
					</span>
					<span className="flex items-center gap-1.5">
						<Icon ssr icon="ph:cloud" width={13} height={13} />
						Managed cloud
					</span>
					<span className="flex items-center gap-1.5">
						<Icon ssr icon="ph:lock-open" width={13} height={13} />
						No vendor lock-in
					</span>
				</div>
			</div>
		</section>
	);
}

const REPLACED_TOOLS = [
	{ name: "Squarespace", cost: "$33" },
	{ name: "Notion", cost: "$10" },
	{ name: "Asana", cost: "$11" },
	{ name: "Zapier", cost: "$20" },
	{ name: "Mailchimp", cost: "$13" },
	{ name: "Analytics", cost: "$49" },
];

function ProblemSection() {
	return (
		<section className="px-6 py-16 md:py-24">
			<div className="mx-auto max-w-3xl">
				<h2 className="text-foreground mb-4 text-center text-3xl leading-tight font-semibold text-balance md:text-4xl">
					You&apos;re paying for tools that don&apos;t talk to each other
				</h2>
				<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-center text-lg leading-relaxed text-pretty">
					The average business uses dozens of disconnected SaaS apps.
					Different logins, different billing, data trapped in silos.
				</p>

				<div className="flex flex-col items-center gap-8">
					{/* Before */}
					<div className="w-full">
						<div className="text-muted-foreground/50 mb-3 text-center text-xs font-medium uppercase tracking-wider">
							Before
						</div>
						<div className="flex flex-wrap items-center justify-center gap-2">
							{REPLACED_TOOLS.map((tool) => (
								<span
									key={tool.name}
									className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-low)] px-3.5 py-1.5 text-sm"
								>
									{tool.name}
									<span className="text-destructive/70 text-xs">
										{tool.cost}
									</span>
								</span>
							))}
						</div>
						<p className="text-destructive/70 mt-3 text-center font-mono text-sm">
							$136+/mo across 6 tools
						</p>
					</div>

					{/* Transition */}
					<div className="text-muted-foreground/30">
						<Icon ssr icon="ph:arrow-down" width={20} height={20} />
					</div>

					{/* After */}
					<div className="glass-panel w-full max-w-md rounded-[var(--surface-radius)] border p-6">
						<div className="relative overflow-hidden rounded-[var(--control-radius)] border border-primary/20 bg-primary/[0.04] p-5">
							<div
								aria-hidden="true"
								className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,color-mix(in_srgb,var(--primary)_12%,transparent)_0,transparent_70%)]"
							/>
							<div className="relative flex items-center gap-3">
								<img
									src="/symbol/symbol-light.svg"
									alt=""
									className="block h-8 w-auto dark:hidden"
								/>
								<img
									src="/symbol/symbol-dark.svg"
									alt=""
									className="hidden h-8 w-auto dark:block"
								/>
								<div>
									<div className="text-foreground text-lg font-semibold">
										QUESTPIE
									</div>
									<div className="text-muted-foreground text-xs">
										Website, automation, and infrastructure
									</div>
								</div>
							</div>
							<p className="text-success mt-4 text-center font-mono text-sm">
								Open source &middot; One login &middot; Fully integrated
							</p>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

const PILLARS = [
	{
		id: "framework",
		name: "Framework",
		available: true,
		color: "var(--success)",
		description:
			"Open-source TypeScript CMS engine. Collections, admin workspace, API, auth, and file management.",
		icon: "ph:hammer",
		href: "#framework",
	},
	{
		id: "cloud",
		name: "Cloud",
		available: false,
		color: "#60a5fa",
		description:
			"Managed hosting, templates, and one-click deployment. Launch without touching a terminal.",
		icon: "ph:cloud",
		href: "/cloud",
	},
	{
		id: "autopilot",
		name: "Autopilot",
		available: false,
		color: "#4ade80",
		description:
			"Open-source AI agents that handle content, SEO, analytics, and operations automatically.",
		icon: "ph:robot",
		href: "/autopilot",
	},
] as const;

function PillarsSection() {
	return (
		<section className="px-6 py-16 md:py-24">
			<div className="mx-auto max-w-5xl">
				<div className="mb-12 text-center">
					<h2 className="text-foreground mb-4 text-3xl leading-tight font-semibold text-balance md:text-4xl">
						Three pillars, one platform
					</h2>
					<p className="text-muted-foreground mx-auto max-w-xl text-lg leading-relaxed text-pretty">
						Start with what you need today. Add capabilities as you grow.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					{PILLARS.map((pillar) => (
						<a
							key={pillar.id}
							href={pillar.href}
							className="border-border-subtle hover:border-border-strong group relative overflow-hidden rounded-[var(--surface-radius)] border bg-[var(--surface-low)]/40 p-6 transition-[border-color]"
						>
							<div
								aria-hidden="true"
								className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
								style={{
									background: `radial-gradient(circle at 50% 0, color-mix(in srgb, ${pillar.color} 8%, transparent) 0, transparent 70%)`,
								}}
							/>
							<div className="relative">
								<div className="mb-4 flex items-center justify-between">
									<Icon
										ssr
										icon={pillar.icon}
										width={20}
										height={20}
										className="text-foreground"
									/>
									<span
										className="text-xs font-medium"
										style={{ color: pillar.color }}
									>
										{pillar.available
											? "Available now"
											: "Coming soon"}
									</span>
								</div>

								<h3 className="text-foreground mb-2 text-lg font-semibold">
									{pillar.name}
								</h3>

								<p className="text-muted-foreground text-sm leading-relaxed text-pretty">
									{pillar.description}
								</p>

								<div
									className="mt-5 flex items-center gap-1.5 text-sm font-medium"
									style={{ color: pillar.color }}
								>
									{pillar.available
										? "Start building"
										: "Learn more"}
									<Icon
										ssr
										icon={pillar.available ? "ph:arrow-down" : "ph:arrow-right"}
										width={14}
										height={14}
									/>
								</div>
							</div>
						</a>
					))}
				</div>
			</div>
		</section>
	);
}

const FRAMEWORK_FEATURES = [
	{
		icon: "ph:database",
		title: "Collections & content",
		description: "Define your data model once. Get CRUD API, admin, typed client, and validation.",
	},
	{
		icon: "ph:layout",
		title: "Admin workspace",
		description: "Production-ready admin UI from your schema. Custom fields, access control, localization.",
	},
	{
		icon: "ph:plugs-connected",
		title: "Swap any adapter",
		description: "Storage, cache, queue, search, email. Pick the service you already use.",
	},
	{
		icon: "ph:shield-check",
		title: "Auth & access control",
		description: "Users, roles, field-level permissions. Built on Better Auth with OAuth support.",
	},
	{
		icon: "ph:flow-arrow",
		title: "Jobs & workflows",
		description: "Background tasks, scheduled jobs, and durable workflows that survive restarts.",
	},
	{
		icon: "ph:brackets-curly",
		title: "End-to-end type safety",
		description: "Schema fields become Drizzle columns, Zod validators, and typed API clients.",
	},
];

function AdminMockup() {
	const sidebarItems = [
		{ icon: "ph:house", label: "Dashboard", active: false },
		{ icon: "ph:article", label: "Posts", active: true },
		{ icon: "ph:user", label: "Users", active: false },
		{ icon: "ph:image", label: "Media", active: false },
		{ icon: "ph:gear", label: "Settings", active: false },
	];

	const tableRows = [
		{ title: "Getting started with QUESTPIE", status: "Published", author: "Admin", date: "May 10" },
		{ title: "How AI agents automate your ops", status: "Draft", author: "Admin", date: "May 9" },
		{ title: "Self-hosting vs managed cloud", status: "Published", author: "Team", date: "May 7" },
		{ title: "Building custom collections", status: "Review", author: "Admin", date: "May 5" },
	];

	return (
		<div className="relative mx-auto w-full max-w-3xl">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute -inset-16 bg-[radial-gradient(ellipse_at_50%_50%,color-mix(in_srgb,var(--primary)_8%,transparent)_0,transparent_70%)]"
			/>
			<div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c0c0c] shadow-2xl shadow-black/40">
				<div className="flex h-9 items-center gap-2 border-b border-white/[0.06] bg-[#161616] px-4">
					<div className="flex gap-1.5">
						<div className="size-2.5 rounded-full bg-white/10" />
						<div className="size-2.5 rounded-full bg-white/10" />
						<div className="size-2.5 rounded-full bg-white/10" />
					</div>
					<div className="mx-auto flex h-5 w-48 items-center justify-center rounded bg-white/[0.04] text-[10px] text-white/25">
						localhost:3000/admin
					</div>
				</div>

				<div className="flex" style={{ height: 280 }}>
					<div className="flex w-40 shrink-0 flex-col border-r border-white/[0.06] bg-[#111111]">
						<div className="flex items-center gap-2 border-b border-white/[0.04] px-3 py-2.5">
							<div className="flex size-5 items-center justify-center rounded bg-primary/20">
								<span className="text-[8px] font-bold text-primary">Q</span>
							</div>
							<span className="text-[11px] font-medium text-white/70">QUESTPIE</span>
						</div>
						<div className="flex flex-1 flex-col gap-0.5 p-2">
							{sidebarItems.map((item) => (
								<div
									key={item.label}
									className={cn(
										"flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px]",
										item.active
											? "bg-white/[0.06] text-white"
											: "text-white/35",
									)}
								>
									<Icon ssr icon={item.icon} width={12} height={12} />
									{item.label}
								</div>
							))}
						</div>
					</div>

					<div className="flex flex-1 flex-col overflow-hidden">
						<div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
							<span className="text-[12px] font-medium text-white/80">Posts</span>
							<div className="flex h-5 items-center gap-1 rounded bg-primary/80 px-2 text-[9px] font-medium text-white">
								<Icon ssr icon="ph:plus" width={9} height={9} />
								New
							</div>
						</div>

						<div className="flex-1 overflow-hidden">
							<div className="grid grid-cols-[1fr_70px_50px_56px] gap-px border-b border-white/[0.04] bg-white/[0.02] px-4 py-1.5 text-[9px] font-medium text-white/25 uppercase tracking-wider">
								<span>Title</span>
								<span>Status</span>
								<span>Author</span>
								<span>Date</span>
							</div>
							{tableRows.map((row) => (
								<div
									key={row.title}
									className="grid grid-cols-[1fr_70px_50px_56px] items-center border-b border-white/[0.03] px-4 py-2 text-[10px]"
								>
									<span className="truncate text-white/60">{row.title}</span>
									<span className={cn(
										"text-[9px]",
										row.status === "Published" ? "text-green-400/70" :
										row.status === "Draft" ? "text-white/25" :
										"text-amber-400/70",
									)}>{row.status}</span>
									<span className="text-white/25">{row.author}</span>
									<span className="text-white/20">{row.date}</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function FrameworkSection() {
	return (
		<section id="framework" className="px-6 py-16 md:py-24">
			<div className="mx-auto max-w-5xl">
				<div className="mb-12 text-center">
					<div className="mb-1 flex items-center justify-center gap-2">
						<h2 className="text-foreground text-3xl leading-tight font-semibold md:text-4xl">
							Framework
						</h2>
						<span className="text-success text-xs font-medium">
							Available now
						</span>
					</div>
					<p className="text-muted-foreground mx-auto max-w-xl text-lg leading-relaxed text-pretty">
						Define your product once in TypeScript. QUESTPIE projects it into
						APIs, an admin workspace, validation, and typed clients.
					</p>
				</div>

				<Reveal>
					<AdminMockup />
				</Reveal>

				<div className="mt-16 grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
					<div>
						<div className="glass-panel overflow-hidden rounded-[var(--surface-radius)] border">
							<div className="border-border-subtle border-b px-4 py-2.5">
								<span className="text-muted-foreground font-mono text-xs">
									collections/posts.ts
								</span>
							</div>
							<div className="text-muted-foreground overflow-x-auto p-5 font-mono text-[13px] leading-[1.8] whitespace-pre">
								<span className={kw}>export default</span>{" "}
								<span className={fn}>collection</span>
								{"("}
								<span className={str}>"posts"</span>
								{")\n  ."}
								<span className={fn}>fields</span>
								{`(({ f }) => ({
    title:   f.`}
								<span className={fn}>text</span>
								{"("}
								<span className={num}>255</span>
								{")."}
								<span className={fn}>required</span>
								{`(),
    content: f.`}
								<span className={fn}>richText</span>
								{`().`}
								<span className={fn}>localized</span>
								{`(),
    author:  f.`}
								<span className={fn}>relation</span>
								{"("}
								<span className={str}>"users"</span>
								{")."}
								<span className={fn}>required</span>
								{`(),
  }))`}
							</div>
						</div>

						<div className="mt-6 flex flex-wrap items-center gap-3">
							<Link
								to="/docs/$"
								params={{ _splat: "start-here/first-app" }}
								className={primaryCta}
							>
								Start building
								<Icon ssr icon="ph:arrow-right" width={16} height={16} />
							</Link>
							<a
								href="https://github.com/questpie/questpie"
								target="_blank"
								rel="noreferrer"
								className={ghostCta}
							>
								<Icon ssr icon="ph:github-logo" width={16} height={16} />
								Star on GitHub
							</a>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
						{FRAMEWORK_FEATURES.map((f) => (
							<div key={f.title} className="rounded-[var(--control-radius)] p-4">
								<div className="mb-1.5 flex items-center gap-2">
									<Icon
										ssr
										icon={f.icon}
										width={15}
										height={15}
										className="text-muted-foreground"
									/>
									<h3 className="text-foreground text-sm font-medium">
										{f.title}
									</h3>
								</div>
								<p className="text-muted-foreground text-[13px] leading-relaxed">
									{f.description}
								</p>
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}

const AUTOPILOT_CAPABILITIES = [
	{
		icon: "ph:pencil-line",
		label: "Content creation",
		description: "Generate blog posts, product descriptions, and marketing copy from your brand voice.",
	},
	{
		icon: "ph:magnifying-glass",
		label: "SEO optimization",
		description: "Analyze pages, suggest improvements, and auto-optimize metadata across your site.",
	},
	{
		icon: "ph:chart-line-up",
		label: "Business analytics",
		description: "Track performance, surface insights, and get actionable recommendations.",
	},
	{
		icon: "ph:git-branch",
		label: "Workflow automation",
		description: "Replace manual processes with intelligent agents that learn and adapt.",
	},
	{
		icon: "ph:chat-circle-text",
		label: "Customer communication",
		description: "Draft responses, manage inquiries, and keep your audience engaged.",
	},
	{
		icon: "ph:database",
		label: "Data management",
		description: "Clean, organize, and enrich your business data without manual effort.",
	},
];

function AutopilotSection() {
	return (
		<section
			id="autopilot"
			className="relative isolate overflow-hidden px-6 py-20 md:py-28"
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,color-mix(in_srgb,#4ade80_6%,transparent)_0,transparent_70%)]"
			/>

			<div className="relative mx-auto max-w-5xl">
				<div className="mx-auto max-w-2xl text-center">
					<div className="mb-4 flex items-center justify-center gap-3">
						<h2 className="text-foreground text-3xl leading-tight font-semibold md:text-4xl lg:text-5xl">
							Autopilot
						</h2>
						<span className="text-xs font-medium text-[#4ade80]">
							Coming soon
						</span>
					</div>

					<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-lg leading-relaxed">
						Open-source AI agents that handle content, SEO, analytics, and
						operations. Transparent, inspectable, and built to work alongside
						your team.
					</p>
				</div>

				<div className="mb-12 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--surface-radius)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-3">
					{AUTOPILOT_CAPABILITIES.map((cap) => (
						<div
							key={cap.label}
							className="bg-background p-5"
						>
							<div className="mb-2 flex items-center gap-2">
								<Icon
									ssr
									icon={cap.icon}
									width={15}
									height={15}
									className="text-[#4ade80]"
								/>
								<h3 className="text-foreground text-sm font-medium">
									{cap.label}
								</h3>
							</div>
							<p className="text-muted-foreground text-sm leading-relaxed">
								{cap.description}
							</p>
						</div>
					))}
				</div>

				<div className="mx-auto max-w-md text-center">
					<WaitlistForm
						product="Autopilot"
						accentColor="#4ade80"
						ctaText="Get early access"
					/>
					<p className="text-muted-foreground/50 mt-3 text-xs">
						Open source. Free to self-host. Managed option coming with QUESTPIE Cloud.
					</p>
				</div>
			</div>
		</section>
	);
}

const CLOUD_FEATURES = [
	{
		icon: "ph:rocket-launch",
		label: "One-click deploy",
		description: "Go from template to live site in minutes. No terminal, no DevOps.",
	},
	{
		icon: "ph:palette",
		label: "Site templates",
		description: "Professionally designed templates for restaurants, shops, portfolios, and more.",
	},
	{
		icon: "ph:globe",
		label: "Custom domains",
		description: "Connect your domain, automatic SSL, and DNS from one dashboard.",
	},
	{
		icon: "ph:robot",
		label: "Managed AI agents",
		description: "QUESTPIE Autopilot, hosted and scaled for you. Zero setup.",
	},
	{
		icon: "ph:chart-bar",
		label: "Built-in analytics",
		description: "Traffic, engagement, and conversion. No third-party scripts.",
	},
	{
		icon: "ph:shield-check",
		label: "Enterprise ready",
		description: "Compliance, backups, team management, and priority support.",
	},
];

function CloudSection() {
	return (
		<section
			id="cloud"
			className="relative isolate overflow-hidden px-6 py-20 md:py-28"
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,color-mix(in_srgb,#60a5fa_6%,transparent)_0,transparent_70%)]"
			/>

			<div className="relative mx-auto max-w-5xl">
				<div className="mx-auto max-w-2xl text-center">
					<div className="mb-4 flex items-center justify-center gap-3">
						<h2 className="text-foreground text-3xl leading-tight font-semibold md:text-4xl lg:text-5xl">
							Cloud
						</h2>
						<span className="text-xs font-medium text-[#60a5fa]">
							Coming soon
						</span>
					</div>

					<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-lg leading-relaxed">
						The managed layer for QUESTPIE. Hosting, templates, and managed AI
						agents. Self-host free, or let us handle everything.
					</p>
				</div>

				<div className="mb-12 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--surface-radius)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-3">
					{CLOUD_FEATURES.map((f) => (
						<div
							key={f.label}
							className="bg-background p-5"
						>
							<div className="mb-2 flex items-center gap-2">
								<Icon
									ssr
									icon={f.icon}
									width={15}
									height={15}
									className="text-[#60a5fa]"
								/>
								<h3 className="text-foreground text-sm font-medium">
									{f.label}
								</h3>
							</div>
							<p className="text-muted-foreground text-sm leading-relaxed">
								{f.description}
							</p>
						</div>
					))}
				</div>

				<div className="mx-auto max-w-md text-center">
					<WaitlistForm
						product="Cloud"
						accentColor="#60a5fa"
						ctaText="Reserve your spot"
					/>
					<p className="text-muted-foreground/50 mt-3 text-xs">
						Framework stays free and open source forever. Cloud adds managed hosting and support.
					</p>
				</div>
			</div>
		</section>
	);
}

function WaitlistForm({
	product,
	accentColor,
	ctaText,
}: {
	product: string;
	accentColor: string;
	ctaText: string;
}) {
	const [email, setEmail] = useState("");
	const [submitted, setSubmitted] = useState(false);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!email) return;
		setSubmitted(true);
	};

	if (submitted) {
		return (
			<div
				className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium"
				style={{
					backgroundColor: `color-mix(in srgb, ${accentColor} 10%, transparent)`,
					color: accentColor,
				}}
			>
				<Icon ssr icon="ph:check-circle" width={16} height={16} />
				You&apos;re on the list for QUESTPIE {product}.
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="flex items-center gap-2">
			<input
				type="email"
				required
				placeholder="you@company.com"
				value={email}
				onChange={(e) => setEmail(e.target.value)}
				className="text-foreground placeholder-muted-foreground/50 border-border-subtle bg-surface-low h-10 min-w-0 flex-1 rounded-[var(--control-radius)] border px-4 text-sm outline-none transition-[border-color] focus:border-[var(--border-strong)]"
			/>
			<button
				type="submit"
				className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--control-radius)] px-4 text-sm font-medium text-black transition-opacity hover:opacity-90 active:opacity-75"
				style={{ backgroundColor: accentColor }}
			>
				{ctaText}
				<Icon ssr icon="ph:arrow-right" width={14} height={14} />
			</button>
		</form>
	);
}

function OpenSourceSection() {
	return (
		<section className="px-6 py-16 md:py-24">
			<div className="mx-auto max-w-3xl text-center">
				<h2 className="text-foreground mb-4 text-3xl leading-tight font-semibold text-balance md:text-4xl">
					Open source means you own everything
				</h2>
				<p className="text-muted-foreground mx-auto mb-10 max-w-xl text-lg leading-relaxed text-pretty">
					Both Framework and Autopilot are MIT-licensed. Your code,
					your data, your infrastructure.
				</p>

				<div className="glass-panel mx-auto max-w-2xl rounded-[var(--surface-radius)] border">
					<div className="divide-border-subtle grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
						<div className="p-6 text-center">
							<Icon
								ssr
								icon="ph:lock-open"
								width={20}
								height={20}
								className="text-foreground mx-auto mb-3"
							/>
							<h3 className="text-foreground mb-1 text-sm font-medium">
								No vendor lock-in
							</h3>
							<p className="text-muted-foreground text-xs leading-relaxed">
								MIT License. Fork it, modify it, run it anywhere.
							</p>
						</div>

						<div className="p-6 text-center">
							<Icon
								ssr
								icon="ph:eye"
								width={20}
								height={20}
								className="text-foreground mx-auto mb-3"
							/>
							<h3 className="text-foreground mb-1 text-sm font-medium">
								Transparent AI
							</h3>
							<p className="text-muted-foreground text-xs leading-relaxed">
								Every agent decision is inspectable and auditable.
							</p>
						</div>

						<div className="p-6 text-center">
							<Icon
								ssr
								icon="ph:cloud"
								width={20}
								height={20}
								className="text-foreground mx-auto mb-3"
							/>
							<h3 className="text-foreground mb-1 text-sm font-medium">
								Self-host or cloud
							</h3>
							<p className="text-muted-foreground text-xs leading-relaxed">
								Same platform, your choice of hosting.
							</p>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

const FAQ_ITEMS = [
	{
		q: "What is QUESTPIE?",
		a: "QUESTPIE is an open-source business platform that combines a website builder, content management system, and AI-powered automation into one unified platform. It replaces the need for separate tools like Squarespace, Notion, Asana, and Zapier.",
	},
	{
		q: "Is QUESTPIE really free?",
		a: "Yes. QUESTPIE Framework and Autopilot are open-source and free to use under the MIT license. QUESTPIE Cloud, our managed commercial layer with hosting, templates, and managed AI agents, is coming soon with paid plans.",
	},
	{
		q: "How does QUESTPIE compare to Squarespace or Wix?",
		a: "Unlike Squarespace or Wix, QUESTPIE is open-source with no vendor lock-in. It includes AI-powered business automation and serves as a complete business platform, not just a website builder. You can self-host it or use QUESTPIE Cloud.",
	},
	{
		q: "What are AI agents in QUESTPIE Autopilot?",
		a: "AI agents are autonomous programs that handle repetitive business tasks: content creation, SEO optimization, analytics, and workflow automation. They work alongside your team, handling the tasks that eat up your time.",
	},
	{
		q: "Can I self-host QUESTPIE?",
		a: "Absolutely. Both Framework and Autopilot are designed to be self-hosted. Deploy them on your own servers, VPS, or any cloud provider. QUESTPIE Cloud is an optional managed layer for those who don't want to handle infrastructure.",
	},
	{
		q: "When will Autopilot and Cloud be available?",
		a: "Both are in active development. Join the waitlist to get early access and be notified as soon as they launch. Framework is available now.",
	},
	{
		q: "Do I need to be a developer to use QUESTPIE?",
		a: "Framework requires some TypeScript knowledge to set up, but the admin workspace is designed for non-technical users. When Cloud launches, you'll be able to start from templates with no coding required.",
	},
];

function FAQItem({ item }: { item: (typeof FAQ_ITEMS)[number] }) {
	const [open, setOpen] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);

	return (
		<div className="border-border-subtle border-b">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center justify-between gap-4 py-4 text-left"
			>
				<h3 className="text-foreground text-[15px] font-medium">
					{item.q}
				</h3>
				<Icon
					ssr
					icon="ph:caret-down"
					width={14}
					height={14}
					className={cn(
						"text-muted-foreground shrink-0 transition-transform duration-200",
						open && "rotate-180",
					)}
				/>
			</button>
			<div
				className="grid transition-[grid-template-rows] duration-200"
				style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
			>
				<div className="overflow-hidden">
					<div
						ref={contentRef}
						className="text-muted-foreground pb-4 text-sm leading-relaxed"
					>
						{item.a}
					</div>
				</div>
			</div>
		</div>
	);
}

function FAQSection() {
	return (
		<section className="px-6 py-16 md:py-24">
			<div className="mx-auto max-w-xl">
				<h2 className="text-foreground mb-8 text-center text-2xl font-semibold">
					Frequently asked questions
				</h2>
				{FAQ_ITEMS.map((item) => (
					<FAQItem key={item.q} item={item} />
				))}
			</div>
		</section>
	);
}

function FinalCTASection() {
	return (
		<section className="px-6 py-24 text-center md:py-32">
			<h2 className="text-foreground mb-4 text-3xl leading-tight font-semibold text-balance md:text-4xl lg:text-5xl">
				Start building today.{" "}
				<br className="hidden sm:block" />
				<span className="text-muted-foreground">Automate tomorrow.</span>
			</h2>
			<p className="text-muted-foreground mx-auto mb-8 max-w-md text-lg leading-relaxed">
				Framework is free and open source. Get started in minutes.
			</p>

			<div className="glass-panel mb-8 inline-flex items-center gap-3 rounded-[var(--surface-radius)] border px-5 py-3">
				<span className="text-primary font-mono text-sm">$</span>
				<code className="font-mono text-sm">bun create questpie</code>
			</div>

			<div className="flex flex-wrap items-center justify-center gap-3">
				<Link
					to="/docs/$"
					params={{ _splat: "start-here/first-app" }}
					className={primaryCta}
				>
					Read the docs
					<Icon ssr icon="ph:arrow-right" width={16} height={16} />
				</Link>
				<a href="#autopilot" className={secondaryCta}>
					Join the waitlist
				</a>
				<a
					href="https://github.com/questpie/questpie"
					target="_blank"
					rel="noreferrer"
					className={ghostCta}
				>
					<Icon ssr icon="ph:github-logo" width={16} height={16} />
					GitHub
				</a>
			</div>
		</section>
	);
}

function LandingFooter() {
	return (
		<footer className="border-border-subtle border-t">
			<div className="mx-auto max-w-5xl px-6 py-12">
				<div className="grid grid-cols-2 gap-8 sm:grid-cols-5">
					<div className="col-span-2 sm:col-span-1">
						<Link to="/" className="mb-4 inline-block">
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
						<p className="text-muted-foreground/50 text-xs">
							MIT License
						</p>
					</div>

					<div>
						<div className="text-foreground mb-3 text-xs font-medium">
							Platform
						</div>
						<ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
							<li>
								<a href="#framework" className="hover:text-foreground transition-colors">Framework</a>
							</li>
							<li>
								<Link to="/autopilot" className="hover:text-foreground transition-colors">Autopilot</Link>
							</li>
							<li>
								<Link to="/cloud" className="hover:text-foreground transition-colors">Cloud</Link>
							</li>
						</ul>
					</div>

					<div>
						<div className="text-foreground mb-3 text-xs font-medium">
							Use cases
						</div>
						<ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
							{USE_CASES.map((uc) => (
								<li key={uc.href}>
									<Link to={uc.href} className="hover:text-foreground transition-colors">{uc.label}</Link>
								</li>
							))}
						</ul>
					</div>

					<div>
						<div className="text-foreground mb-3 text-xs font-medium">
							Resources
						</div>
						<ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
							<li>
								<Link to="/docs/$" className="hover:text-foreground transition-colors">Docs</Link>
							</li>
							<li>
								<Link to="/docs/$" params={{ _splat: "start-here" }} className="hover:text-foreground transition-colors">
									Getting started
								</Link>
							</li>
							<li>
								<a href="https://github.com/questpie/questpie/releases" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">
									Releases
								</a>
							</li>
						</ul>
					</div>

					<div>
						<div className="text-foreground mb-3 text-xs font-medium">
							Community
						</div>
						<ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
							<li>
								<a href="https://github.com/questpie/questpie" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">
									GitHub
								</a>
							</li>
							<li>
								<a href="https://github.com/questpie/questpie/issues" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">
									Issues
								</a>
							</li>
						</ul>
					</div>
				</div>
			</div>
		</footer>
	);
}

// Syntax highlighting tokens
const fn = "text-[var(--syntax-function)]";
const str = "text-[var(--syntax-string)]";
const num = "text-[var(--syntax-number)]";
const kw = "text-primary font-semibold";

// Button styles
const ctaBase =
	"inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--control-radius)] px-4 py-2 text-sm font-medium transition-[background-color,color,opacity,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)] active:scale-[0.97] motion-reduce:active:scale-100";
const primaryCta = cn(
	ctaBase,
	"bg-primary text-primary-foreground hover:opacity-90",
);
const secondaryCta = cn(
	ctaBase,
	"border-border-subtle bg-surface-low text-foreground hover:bg-surface-mid border",
);
const ghostCta = cn(
	ctaBase,
	"text-muted-foreground hover:text-foreground bg-transparent px-2",
);

// Background layers
const landingShell =
	"relative isolate overflow-hidden bg-background";
const landingAmbientLayer =
	"pointer-events-none absolute inset-x-[-10%] inset-y-0 z-0 bg-[radial-gradient(ellipse_at_50%_-8rem,color-mix(in_srgb,var(--foreground)_8%,transparent)_0,transparent_40rem),radial-gradient(ellipse_at_18%_22rem,var(--ambient-top)_0,transparent_32rem),radial-gradient(ellipse_at_84%_20rem,color-mix(in_srgb,var(--primary)_7%,transparent)_0,transparent_28rem),radial-gradient(ellipse_at_50%_64rem,var(--ambient-edge)_0,transparent_56rem),linear-gradient(112deg,transparent_0_28%,var(--ambient-sheen)_46%,transparent_66%_100%)] opacity-55 motion-safe:animate-[landing-field-sweep_34s_var(--motion-ease-standard)_infinite_alternate] motion-reduce:opacity-30";
const landingTraceLayer =
	"pointer-events-none absolute inset-x-[-12%] inset-y-0 z-0 bg-[linear-gradient(116deg,transparent_0_31%,var(--ambient-trace)_31.15%_31.35%,transparent_31.55%_100%),linear-gradient(64deg,transparent_0_54%,var(--ambient-trace)_54.1%_54.22%,transparent_54.4%_100%)] [background-size:44rem_44rem,58rem_58rem] opacity-[0.28] motion-safe:animate-[landing-trace-drift_48s_linear_infinite_alternate] motion-reduce:opacity-[0.18] dark:opacity-[0.34]";
const landingParticleLayer =
	"pointer-events-none absolute inset-x-[-10%] inset-y-0 z-0 bg-[radial-gradient(circle_at_14px_18px,var(--ambient-particle)_0_1px,transparent_1.45px),radial-gradient(circle_at_88px_64px,var(--ambient-particle-accent)_0_1px,transparent_1.5px),radial-gradient(circle_at_150px_112px,var(--ambient-particle-muted)_0_1px,transparent_1.45px)] [background-size:180px_180px,260px_260px,340px_340px] opacity-[0.5] motion-safe:animate-[landing-particle-drift_80s_linear_infinite] motion-reduce:opacity-[0.24] dark:opacity-[0.62]";
const landingVignetteLayer =
	"pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(90deg,var(--background)_0,transparent_12%_88%,var(--background)_100%)] opacity-75";
const landingNoiseLayer =
	"pointer-events-none absolute inset-0 z-0 opacity-[0.045] mix-blend-soft-light dark:opacity-[0.06] [background-image:url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%20width%3D%22160%22%20height%3D%22160%22%20viewBox%3D%220%200%20160%20160%22%3E%3Cfilter%20id%3D%22n%22%3E%3CfeTurbulence%20type%3D%22fractalNoise%22%20baseFrequency%3D%22.75%22%20numOctaves%3D%224%22%20stitchTiles%3D%22stitch%22/%3E%3C/filter%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20filter%3D%22url(%23n)%22%20opacity%3D%22.38%22/%3E%3C/svg%3E')] [background-size:160px_160px]";

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

		const revealVisible = () => {
			document.querySelectorAll("[data-reveal]").forEach((el) => {
				const rect = el.getBoundingClientRect();
				if (
					rect.top < window.innerHeight * 0.92 &&
					rect.bottom > window.innerHeight * 0.08
				) {
					el.setAttribute("data-visible", "");
				}
			});
		};

		document.querySelectorAll("[data-reveal]").forEach((el) => obs.observe(el));
		revealVisible();
		window.addEventListener("scroll", revealVisible, { passive: true });

		return () => {
			obs.disconnect();
			window.removeEventListener("scroll", revealVisible);
		};
	}, []);

	return (
		<div className="landing bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
			<Nav />

			<main className={landingShell}>
				<div aria-hidden="true" data-bg-layer="ambient" className={landingAmbientLayer} />
				<div aria-hidden="true" data-bg-layer="trace" className={landingTraceLayer} />
				<div aria-hidden="true" data-bg-layer="particles" className={landingParticleLayer} />
				<div aria-hidden="true" data-bg-layer="vignette" className={landingVignetteLayer} />
				<div aria-hidden="true" data-bg-layer="noise" className={landingNoiseLayer} />

				<div className="relative z-10">
					<HeroSection />

					<Reveal>
						<ProblemSection />
					</Reveal>

					<Reveal>
						<PillarsSection />
					</Reveal>

					<Reveal>
						<FrameworkSection />
					</Reveal>

					<Reveal>
						<AutopilotSection />
					</Reveal>

					<Reveal>
						<CloudSection />
					</Reveal>

					<Reveal>
						<OpenSourceSection />
					</Reveal>

					<Reveal>
						<FAQSection />
					</Reveal>

					<FinalCTASection />

					<LandingFooter />
				</div>
			</main>
		</div>
	);
}
