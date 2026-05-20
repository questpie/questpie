import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";

import { Input } from "@/components/ui/input";

import {
	type CodeLine,
	CodeBlock,
	Eyebrow,
	FN,
	KW,
	LIcon,
	Mark,
	NUM,
	Reveal,
	STR,
	Section,
	SectionHeading,
	StatusBadge,
	TYP,
	CM,
} from "./primitives";

/* ============================================================
 * HERO
 * ============================================================ */
export function Hero() {
	return (
		<section
			id="top"
			style={{
				position: "relative",
				paddingTop: 120,
				paddingBottom: 64,
				overflow: "hidden",
			}}
		>
			<div
				className="landing-grid-bg"
				aria-hidden="true"
				style={{
					position: "absolute",
					inset: 0,
					opacity: 0.55,
					pointerEvents: "none",
					zIndex: 0,
				}}
			/>
			<div
				style={{
					maxWidth: 1120,
					margin: "0 auto",
					padding: "0 24px",
					position: "relative",
					zIndex: 1,
				}}
			>
				<div
					className="landing-hero-grid"
					style={{
						display: "grid",
						gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 0.95fr)",
						gap: 56,
						alignItems: "center",
					}}
				>
					<div>
						<Reveal>
							<div style={{ marginBottom: 22 }}>
								<Eyebrow dot color="var(--success)">
									v0.3.0 · MIT · TypeScript · Bun + Node
								</Eyebrow>
							</div>
						</Reveal>
						<Reveal delay={60}>
							<h1
								style={{
									fontSize: "clamp(38px, 2.4rem + 1.6vw, 52px)",
									lineHeight: 1.0,
									letterSpacing: "-0.025em",
									margin: 0,
									color: "var(--foreground)",
									fontWeight: 600,
								}}
							>
								<span style={{ display: "block" }}>Your site.</span>
								<span
									style={{
										display: "block",
										color: "var(--foreground-muted)",
									}}
								>
									Your ops.
								</span>
								<span
									style={{
										display: "block",
										color: "var(--foreground-muted)",
									}}
								>
									Your infrastructure.
								</span>
								<span style={{ display: "block", color: "var(--primary)" }}>
									One open stack.
								</span>
							</h1>
						</Reveal>
						<Reveal delay={120}>
							<p
								className="landing-balance"
								style={{
									marginTop: 20,
									fontSize: 17,
									lineHeight: 1.55,
									color: "var(--foreground-muted)",
									maxWidth: 500,
								}}
							>
								QUESTPIE replaces the SaaS patchwork with one open-source
								stack: a typed backend framework, managed cloud, and AI agents
								that run your business. You own the code. You own the data.
							</p>
						</Reveal>
						<Reveal delay={180}>
							<div
								style={{
									marginTop: 28,
									display: "flex",
									gap: 10,
									alignItems: "center",
									flexWrap: "wrap",
								}}
							>
								<a
									className="landing-btn landing-btn-primary"
									href="/docs"
								>
									Start a project
									<LIcon name="arrow-right" size={14} />
								</a>
								<Link className="landing-btn landing-btn-secondary" to="/cloud">
									Try Cloud
									<LIcon name="arrow-down" size={14} />
								</Link>
								<a
									className="landing-btn landing-btn-ghost"
									href="https://github.com/questpie/questpie"
									target="_blank"
									rel="noreferrer"
								>
									<LIcon name="github-logo" size={14} />
									View source
								</a>
							</div>
						</Reveal>
						<Reveal delay={240}>
							<div
								style={{
									marginTop: 36,
									display: "grid",
									gridTemplateColumns: "repeat(3, minmax(0,1fr))",
									gap: 0,
									borderTop: "1px solid var(--border-subtle)",
									borderBottom: "1px solid var(--border-subtle)",
								}}
							>
								{[
									{ k: "Self-host", v: "Free · MIT" },
									{
										k: "Adapters",
										v: "Hono · Elysia · Next · TanStack",
									},
									{ k: "Database", v: "Postgres · Drizzle" },
								].map((stat, i) => (
									<div
										key={stat.k}
										style={{
											padding: "14px 14px 14px 0",
											borderRight:
												i < 2 ? "1px solid var(--border-subtle)" : undefined,
											paddingLeft: i === 0 ? 0 : 14,
										}}
									>
										<div className="landing-eyebrow">{stat.k}</div>
										<div
											style={{
												marginTop: 4,
												fontSize: 13,
												color: "var(--foreground)",
												fontFamily: "var(--font-mono)",
											}}
										>
											{stat.v}
										</div>
									</div>
								))}
							</div>
						</Reveal>
					</div>

					<Reveal delay={200}>
						<HeroProof />
					</Reveal>
				</div>
			</div>

			<style>{`
				@media (max-width: 980px) {
					.landing-hero-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
				}
			`}</style>
		</section>
	);
}

function HeroProof() {
	const collectionLines: CodeLine[] = [
		[KW("export const "), TYP("posts"), " = ", FN("collection"), "(", STR('"posts"'), ")"],
		["  .", FN("fields"), "(({ f }) => ({"],
		["    title:   f.", FN("text"), "(", NUM("255"), ").", FN("required"), "(),"],
		["    slug:    f.", FN("text"), "(", NUM("160"), "),"],
		[
			"    status:  f.",
			FN("select"),
			"([",
			STR('"draft"'),
			", ",
			STR('"published"'),
			"]),",
		],
		["    content: f.", FN("richText"), "().", FN("localized"), "(),"],
		["    author:  f.", FN("relation"), "(", STR('"users"'), "),"],
		["  }))"],
		[
			"  .",
			FN("admin"),
			"(({ c }) => ({ icon: c.",
			FN("icon"),
			"(",
			STR('"ph:article"'),
			") }));",
		],
	];
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
			<CodeBlock
				filename="collections/posts.ts"
				lines={collectionLines}
				copyable
			/>
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					color: "var(--foreground-subtle)",
				}}
			>
				<LIcon name="arrow-down" size={14} />
			</div>
			<AdminMock />
		</div>
	);
}

function AdminMock() {
	const rows: Array<{
		title: string;
		status: string;
		date: string;
		st: "ok" | "warn" | "draft";
	}> = [
		{
			title: "Getting started with QUESTPIE",
			status: "Published",
			date: "May 18",
			st: "ok",
		},
		{
			title: "How AI agents run your ops",
			status: "Draft",
			date: "May 17",
			st: "draft",
		},
		{
			title: "Self-host vs managed cloud",
			status: "Published",
			date: "May 14",
			st: "ok",
		},
		{
			title: "Building custom collections",
			status: "Review",
			date: "May 12",
			st: "warn",
		},
	];
	return (
		<div className="landing-panel" style={{ overflow: "hidden" }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "10px 14px",
					borderBottom: "1px solid var(--border-subtle)",
					background: "var(--surface-low)",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
					<div
						style={{
							width: 18,
							height: 18,
							borderRadius: 5,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Mark size={16} />
					</div>
					<span
						className="landing-mono"
						style={{ fontSize: 12, color: "var(--foreground-muted)" }}
					>
						/admin/posts
					</span>
				</div>
				<div style={{ display: "flex", gap: 6 }}>
					<span
						className="landing-mono"
						style={{
							fontSize: 11,
							padding: "3px 8px",
							borderRadius: 6,
							background: "var(--surface-mid)",
							color: "var(--foreground-subtle)",
						}}
					>
						4 records
					</span>
					<span
						style={{
							fontSize: 11,
							padding: "3px 8px",
							borderRadius: 6,
							display: "inline-flex",
							alignItems: "center",
							gap: 4,
							background: "var(--primary)",
							color: "var(--primary-foreground)",
						}}
					>
						<LIcon name="plus" size={10} />
						New
					</span>
				</div>
			</div>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 86px 80px 20px",
					padding: "8px 14px",
					borderBottom: "1px solid var(--border-subtle)",
					background: "var(--muted)",
					fontFamily: "var(--font-mono)",
					fontSize: 10,
					letterSpacing: "0.04em",
					textTransform: "uppercase",
					color: "var(--foreground-subtle)",
					gap: 8,
				}}
			>
				<span>Title</span>
				<span>Status</span>
				<span>Date</span>
				<span />
			</div>
			{rows.map((r, i) => (
				<div
					key={r.title}
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 86px 80px 20px",
						padding: "11px 14px",
						borderBottom:
							i === rows.length - 1 ? "none" : "1px solid var(--border-subtle)",
						fontSize: 13,
						color: "var(--foreground)",
						alignItems: "center",
						gap: 8,
					}}
				>
					<span
						style={{
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{r.title}
					</span>
					<span
						style={{
							fontFamily: "var(--font-mono)",
							fontSize: 11,
							color:
								r.st === "ok"
									? "var(--success)"
									: r.st === "warn"
										? "#f2ca72"
										: "var(--foreground-subtle)",
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						<span
							style={{
								width: 6,
								height: 6,
								borderRadius: "50%",
								background: "currentColor",
							}}
						/>
						{r.status}
					</span>
					<span
						className="landing-mono landing-tabular"
						style={{ fontSize: 12, color: "var(--foreground-muted)" }}
					>
						{r.date}
					</span>
					<span style={{ color: "var(--foreground-subtle)" }}>
						<LIcon name="arrow-right" size={12} />
					</span>
				</div>
			))}
		</div>
	);
}

/* ============================================================
 * PILLARS
 * ============================================================ */
type PillarStatus = "live" | "soon" | "beta";
type Pillar = {
	id: string;
	n: string;
	name: string;
	status: PillarStatus;
	statusLabel: string;
	color: string;
	tagline: string;
	description: string;
	points: string[];
	cta: { label: string; href: string };
};

const PILLARS: Pillar[] = [
	{
		id: "framework",
		n: "01",
		name: "Framework",
		status: "live",
		statusLabel: "Available now",
		color: "var(--pillar-framework)",
		tagline: "The base layer.",
		description:
			"Server-first TypeScript application framework. Define collections once. Get typed API, admin workspace, validation, auth, jobs, and clients projected from one schema.",
		points: [
			"Collections + globals + hooks",
			"Drizzle ORM + Zod + Better Auth",
			"Hono, Elysia, Next, TanStack adapters",
			"MIT. Runs in your codebase",
		],
		cta: { label: "Read the docs", href: "/docs" },
	},
	{
		id: "cloud",
		n: "02",
		name: "Cloud",
		status: "soon",
		statusLabel: "Q3 2026 · Waitlist open",
		color: "var(--pillar-cloud)",
		tagline: "Runtime control plane.",
		description:
			"Accounts, projects, environments, managed Postgres, storage, custom domains, builds, rollouts and observability. Plus hosted Autopilot for your account.",
		points: [
			"Health-checked deploys + rollback",
			"Managed Postgres + storage + email",
			"Custom domains + SSL automatic",
			"Hosted Autopilot per account",
		],
		cta: { label: "Explore Cloud", href: "/cloud" },
	},
	{
		id: "autopilot",
		n: "03",
		name: "Autopilot",
		status: "beta",
		statusLabel: "Q4 2026 · Early access",
		color: "var(--pillar-autopilot)",
		tagline: "AI-native operating layer.",
		description:
			"Like Linear for work, Lovable for app building, Zapier for automation. Issues, workflows, schedules, knowledge, agents and an AI builder. Open source.",
		points: [
			"Issues + durable workflows + schedules",
			"AI builder for QUESTPIE apps",
			"Pluggable agents · MCP · same RBAC",
			"Slack / GitHub integrations",
		],
		cta: { label: "Explore Autopilot", href: "/autopilot" },
	},
];

export function PillarsSection() {
	return (
		<Section id="ecosystem" pad="64px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="The ecosystem"
					title="Three products. One platform."
					lede="Start with the open-source framework today. Add managed infrastructure and AI agents as you grow. Switch off any layer without losing your data."
					align="center"
				/>
			</Reveal>
			<div
				className="landing-pillars-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(3, minmax(0,1fr))",
					gap: 0,
					border: "1px solid var(--border-subtle)",
					borderRadius: "var(--surface-radius)",
					overflow: "hidden",
					background: "var(--card)",
				}}
			>
				{PILLARS.map((p, i) => (
					<PillarCard
						key={p.id}
						pillar={p}
						isLast={i === PILLARS.length - 1}
					/>
				))}
			</div>
			<style>{`
				@media (max-width: 880px) {
					.landing-pillars-grid { grid-template-columns: 1fr !important; }
					.landing-pillar-cell { border-right: none !important; border-bottom: 1px solid var(--border-subtle) !important; }
					.landing-pillar-cell:last-child { border-bottom: none !important; }
				}
			`}</style>
		</Section>
	);
}

function PillarCard({ pillar, isLast }: { pillar: Pillar; isLast: boolean }) {
	return (
		<div
			className="landing-pillar-cell"
			style={{
				padding: 28,
				borderRight: isLast ? "none" : "1px solid var(--border-subtle)",
				display: "flex",
				flexDirection: "column",
				gap: 18,
				position: "relative",
				background: "var(--card)",
			}}
		>
			<div
				aria-hidden="true"
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					height: 2,
					background: pillar.color,
					opacity: 0.7,
				}}
			/>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<span
					className="landing-mono landing-tabular"
					style={{
						fontSize: 11,
						color: "var(--foreground-subtle)",
						letterSpacing: "0.05em",
					}}
				>
					[{pillar.n}]
				</span>
				<StatusBadge tone={pillar.status}>{pillar.statusLabel}</StatusBadge>
			</div>

			<div>
				<h3
					style={{
						fontSize: 22,
						fontWeight: 600,
						color: "var(--foreground)",
						marginBottom: 6,
					}}
				>
					{pillar.name}
				</h3>
				<p
					style={{
						color: "var(--foreground-muted)",
						fontSize: 14,
						lineHeight: 1.55,
					}}
				>
					{pillar.tagline}
				</p>
			</div>

			<p
				style={{
					color: "var(--foreground-muted)",
					fontSize: 14,
					lineHeight: 1.6,
				}}
			>
				{pillar.description}
			</p>

			<ul
				style={{
					listStyle: "none",
					padding: 0,
					margin: 0,
					display: "flex",
					flexDirection: "column",
					gap: 8,
					flex: 1,
				}}
			>
				{pillar.points.map((pt) => (
					<li
						key={pt}
						style={{
							display: "flex",
							alignItems: "flex-start",
							gap: 10,
							fontSize: 13,
							color: "var(--foreground)",
						}}
					>
						<span
							style={{
								marginTop: 6,
								width: 6,
								height: 6,
								borderRadius: 2,
								background: pillar.color,
								flexShrink: 0,
							}}
						/>
						{pt}
					</li>
				))}
			</ul>

			<a
				href={pillar.cta.href}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 6,
					fontSize: 13,
					fontWeight: 500,
					color: pillar.color,
					marginTop: 4,
				}}
			>
				{pillar.cta.label}
				<LIcon name="arrow-right" size={12} />
			</a>
		</div>
	);
}

/* ============================================================
 * FRAMEWORK DEEP DIVE
 * ============================================================ */
const FRAMEWORK_FEATURES = [
	{
		icon: "database",
		title: "Collections",
		desc: "Define data once. Get CRUD API, validation, types, and admin views.",
	},
	{
		icon: "layout",
		title: "Admin workspace",
		desc: "Production-ready UI from your schema. Custom fields, access control, i18n.",
	},
	{
		icon: "shield",
		title: "Auth & RBAC",
		desc: "Better Auth built-in. Roles, OAuth, field-level permissions.",
	},
	{
		icon: "tree-structure",
		title: "Jobs & workflows",
		desc: "Background tasks, scheduled jobs, durable workflows that survive restarts.",
	},
	{
		icon: "plug",
		title: "Adapter-first",
		desc: "Storage, cache, queue, search, email. Swap for what you already use.",
	},
	{
		icon: "brackets-curly",
		title: "End-to-end types",
		desc: "Schema → Drizzle columns → Zod → typed clients. No glue code.",
	},
	{
		icon: "puzzle-piece",
		title: "Modules",
		desc: "Extension unit. Add collections, routes, services, views. Autopilot itself is a module on top.",
	},
	{
		icon: "code",
		title: "Codegen + introspection",
		desc: "Plugin-driven codegen produces typed clients, OpenAPI, admin metadata from one schema.",
	},
];

export function FrameworkSection() {
	const lines: CodeLine[] = [
		[KW("import "), "{ collection } ", KW("from "), STR('"#questpie/factories"'), ";"],
		[""],
		[KW("export const "), TYP("posts"), " = ", FN("collection"), "(", STR('"posts"'), ")"],
		["  .", FN("options"), "({ versioning: { workflow: ", KW("true"), " } })"],
		["  .", FN("fields"), "(({ f }) => ({"],
		["    title:   f.", FN("text"), "(", NUM("255"), ").", FN("required"), "(),"],
		["    slug:    f.", FN("text"), "(", NUM("160"), "),"],
		["    content: f.", FN("richText"), "().", FN("localized"), "(),"],
		[
			"    author:  f.",
			FN("relation"),
			"(",
			STR('"users"'),
			").",
			FN("required"),
			"(),",
		],
		[
			"    status:  f.",
			FN("select"),
			"([",
			STR('"draft"'),
			", ",
			STR('"published"'),
			"]),",
		],
		["  }))"],
		["  .", FN("access"), "({"],
		["    update: ({ session, d }) => d.authorId === session?.user.id,"],
		[
			"    delete: ({ session }) => session?.user.role === ",
			STR('"admin"'),
			",",
		],
		["  })"],
		["  .", FN("hooks"), "({"],
		["    beforeChange: ({ data }) =>"],
		["      ({ ...data, slug: ", FN("slugify"), "(data.title) }),"],
		["  })"],
		[
			"  .",
			FN("admin"),
			"(({ c }) => ({ icon: c.",
			FN("icon"),
			"(",
			STR('"ph:article"'),
			") }))",
		],
		["  .", FN("list"), "(({ v, f }) =>"],
		["    v.", FN("collectionTable"), "({ columns: [f.title, f.status] }))"],
		["  .", FN("form"), "(({ v, f }) =>"],
		["    v.", FN("collectionForm"), "({ fields: [f.title, f.content] }));"],
	];
	return (
		<Section
			id="framework"
			pad="64px 24px 96px"
			style={{ position: "relative" }}
		>
			<Reveal>
				<SectionHeading
					eyebrow="01 · Framework"
					eyebrowColor="var(--pillar-framework)"
					title="Backend architecture, executable."
					lede="Instead of manually wiring APIs, admin dashboards and operational tooling, QUESTPIE derives them automatically from your TypeScript schema."
				/>
			</Reveal>

			<div
				className="landing-framework-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
					gap: 48,
					alignItems: "start",
				}}
			>
				<Reveal>
					<CodeBlock filename="collections/posts.ts" lines={lines} />
				</Reveal>

				<Reveal delay={80}>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "1fr 1fr",
							gap: 0,
							border: "1px solid var(--border-subtle)",
							borderRadius: "var(--surface-radius)",
							overflow: "hidden",
							background: "var(--card)",
						}}
					>
						{FRAMEWORK_FEATURES.map((f, i) => {
							const lastInRow = (i + 1) % 2 === 0;
							const lastRow = i >= FRAMEWORK_FEATURES.length - 2;
							return (
								<div
									key={f.title}
									style={{
										padding: 20,
										borderRight: lastInRow
											? "none"
											: "1px solid var(--border-subtle)",
										borderBottom: lastRow
											? "none"
											: "1px solid var(--border-subtle)",
									}}
								>
									<LIcon
										name={f.icon}
										size={16}
										style={{
											color: "var(--foreground-muted)",
											marginBottom: 12,
										}}
									/>
									<div
										style={{
											fontSize: 14,
											fontWeight: 500,
											color: "var(--foreground)",
											marginBottom: 4,
										}}
									>
										{f.title}
									</div>
									<div
										style={{
											fontSize: 12.5,
											color: "var(--foreground-muted)",
											lineHeight: 1.55,
										}}
									>
										{f.desc}
									</div>
								</div>
							);
						})}
					</div>
				</Reveal>
			</div>

			<Reveal delay={100}>
				<ProductionStrip />
			</Reveal>

			<Reveal delay={140}>
				<AdapterSwitcher />
			</Reveal>

			<Reveal delay={180}>
				<SchemaOutputsMap />
			</Reveal>

			<Reveal delay={220}>
				<div
					style={{
						marginTop: 36,
						display: "flex",
						gap: 10,
						alignItems: "center",
						flexWrap: "wrap",
					}}
				>
					<a className="landing-btn landing-btn-primary" href="/docs">
						Start with the docs
						<LIcon name="arrow-right" size={14} />
					</a>
					<a
						className="landing-btn landing-btn-secondary"
						href="https://github.com/questpie/questpie"
						target="_blank"
						rel="noreferrer"
					>
						<LIcon name="github-logo" size={14} />
						Star on GitHub
					</a>
					<span
						className="landing-mono"
						style={{
							marginLeft: "auto",
							fontSize: 12,
							color: "var(--foreground-subtle)",
						}}
					>
						$ bun add questpie drizzle-orm zod
					</span>
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 980px) {
					.landing-framework-grid { grid-template-columns: 1fr !important; gap: 28px !important; }
				}
			`}</style>
		</Section>
	);
}

const PRODUCTION_FEATURES = [
	{
		icon: "globe",
		title: "i18n built-in",
		desc: "Mark a field `.localized()` and it lives in a per-locale i18n table. Fallback chain, admin locale switcher, typed queries.",
	},
	{
		icon: "lightning",
		title: "Realtime SSE",
		desc: "Every mutation writes to an outbox. Subscribers get live updates via pg_notify or Redis Streams. TanStack Query picks it up automatically.",
	},
	{
		icon: "shield",
		title: "Versioning + workflow",
		desc: "Opt into versioning per collection. Draft → review → published transitions. Revert to any version. Full audit trail.",
	},
	{
		icon: "layout",
		title: "Blocks · page builder",
		desc: "`f.blocks()` field type. Define block schemas server-side, register React renderers client-side. Server prefetches data for SSR.",
	},
];

function ProductionStrip() {
	return (
		<div style={{ marginTop: 36 }}>
			<div className="landing-eyebrow" style={{ marginBottom: 12 }}>
				Built for production
			</div>
			<div
				className="landing-production-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(4, minmax(0,1fr))",
					gap: 0,
					border: "1px solid var(--border-subtle)",
					borderRadius: "var(--surface-radius)",
					overflow: "hidden",
					background: "var(--card)",
				}}
			>
				{PRODUCTION_FEATURES.map((f, i, arr) => {
					const lastInRow = (i + 1) % 4 === 0;
					const lastRow = i >= arr.length - 4;
					return (
						<div
							key={f.title}
							style={{
								padding: 20,
								borderRight: lastInRow
									? "none"
									: "1px solid var(--border-subtle)",
								borderBottom: lastRow
									? "none"
									: "1px solid var(--border-subtle)",
							}}
						>
							<LIcon
								name={f.icon}
								size={16}
								style={{
									color: "var(--pillar-framework)",
									marginBottom: 12,
								}}
							/>
							<div
								style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}
							>
								{f.title}
							</div>
							<div
								style={{
									fontSize: 12.5,
									color: "var(--foreground-muted)",
									lineHeight: 1.55,
								}}
							>
								{f.desc}
							</div>
						</div>
					);
				})}
			</div>
			<style>{`
				@media (max-width: 880px) {
					.landing-production-grid { grid-template-columns: repeat(2, 1fr) !important; }
					.landing-production-grid > div:nth-child(2n) { border-right: none !important; }
					.landing-production-grid > div:nth-child(odd) { border-right: 1px solid var(--border-subtle) !important; }
				}
				@media (max-width: 540px) {
					.landing-production-grid { grid-template-columns: 1fr !important; }
					.landing-production-grid > div { border-right: none !important; }
				}
			`}</style>
		</div>
	);
}

const ADAPTERS: Array<{
	key: string;
	label: string;
	filename: string;
	lines: CodeLine[];
}> = [
	{
		key: "hono",
		label: "Hono",
		filename: "server.ts",
		lines: [
			[KW("import "), "{ Hono } ", KW("from "), STR('"hono"'), ";"],
			[
				KW("import "),
				"{ questpieHono } ",
				KW("from "),
				STR('"@questpie/hono/server"'),
				";",
			],
			[KW("import "), "{ app } ", KW("from "), STR('"#questpie"'), ";"],
			[""],
			[KW("const "), TYP("server"), " = ", KW("new "), FN("Hono"), "();"],
			[
				"server.",
				FN("route"),
				"(",
				STR('"/api"'),
				", ",
				FN("questpieHono"),
				"(app));",
			],
			[""],
			[
				KW("export default "),
				"{ port: ",
				NUM("3000"),
				", fetch: server.fetch };",
			],
		],
	},
	{
		key: "elysia",
		label: "Elysia",
		filename: "server.ts",
		lines: [
			[KW("import "), "{ Elysia } ", KW("from "), STR('"elysia"'), ";"],
			[
				KW("import "),
				"{ questpieElysia } ",
				KW("from "),
				STR('"@questpie/elysia/server"'),
				";",
			],
			[KW("import "), "{ app } ", KW("from "), STR('"#questpie"'), ";"],
			[""],
			[KW("const "), TYP("server"), " = ", KW("new "), FN("Elysia"), "()"],
			["  .", FN("use"), "(", FN("questpieElysia"), "(app))"],
			["  .", FN("listen"), "(", NUM("3000"), ");"],
			[""],
			[KW("export type "), TYP("AppServer"), " = ", KW("typeof "), "server;"],
		],
	},
	{
		key: "next",
		label: "Next.js",
		filename: "app/api/[...path]/route.ts",
		lines: [
			[
				KW("import "),
				"{ questpieNextRouteHandlers } ",
				KW("from "),
				STR('"@questpie/next"'),
				";",
			],
			[KW("import "), "{ app } ", KW("from "), STR('"#questpie"'), ";"],
			[""],
			[KW("export const "), "{ GET, POST, PUT, PATCH, DELETE } ="],
			[
				"  ",
				FN("questpieNextRouteHandlers"),
				"(app, { basePath: ",
				STR('"/api"'),
				" });",
			],
			[""],
			[KW("export const "), "dynamic = ", STR('"force-dynamic"'), ";"],
		],
	},
	{
		key: "tanstack",
		label: "TanStack",
		filename: "src/routes/api/$.ts",
		lines: [
			[
				KW("import "),
				"{ createFetchHandler } ",
				KW("from "),
				STR('"questpie/http"'),
				";",
			],
			[
				KW("import "),
				"{ createAPIFileRoute } ",
				KW("from "),
				STR('"@tanstack/react-start/api"'),
				";",
			],
			[KW("import "), "{ app } ", KW("from "), STR('"#questpie"'), ";"],
			[""],
			[
				KW("const "),
				TYP("handler"),
				" = ",
				FN("createFetchHandler"),
				"(app, { basePath: ",
				STR('"/api"'),
				" });",
			],
			[""],
			[
				KW("export const "),
				TYP("APIRoute"),
				" = ",
				FN("createAPIFileRoute"),
				"(",
				STR('"/api/$"'),
				")({",
			],
			["  GET: ({ request }) => ", FN("handler"), "(request),"],
			["  POST: ({ request }) => ", FN("handler"), "(request),"],
			["});"],
		],
	},
];

function AdapterSwitcher() {
	const [active, setActive] = useState("hono");
	const current = ADAPTERS.find((a) => a.key === active) ?? ADAPTERS[0];
	return (
		<div style={{ marginTop: 36 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					flexWrap: "wrap",
					gap: 12,
					marginBottom: 12,
				}}
			>
				<div>
					<div className="landing-eyebrow" style={{ marginBottom: 4 }}>
						Plug into your stack
					</div>
					<div
						style={{
							fontSize: 15,
							color: "var(--foreground)",
							fontWeight: 500,
						}}
					>
						One adapter line. The same typed app.
					</div>
				</div>
				<div
					role="tablist"
					style={{
						display: "inline-flex",
						border: "1px solid var(--border-subtle)",
						background: "var(--surface-low)",
						borderRadius: "var(--control-radius)",
						padding: 3,
						gap: 2,
					}}
				>
					{ADAPTERS.map((a) => (
						<button
							key={a.key}
							type="button"
							role="tab"
							aria-selected={active === a.key}
							onClick={() => setActive(a.key)}
							style={{
								fontSize: 12.5,
								padding: "6px 12px",
								borderRadius: "var(--control-radius-inner)",
								background: active === a.key ? "var(--card)" : "transparent",
								border:
									active === a.key
										? "1px solid var(--border-subtle)"
										: "1px solid transparent",
								color:
									active === a.key
										? "var(--foreground)"
										: "var(--foreground-muted)",
								fontWeight: active === a.key ? 500 : 400,
								transition:
									"all var(--motion-duration-base) var(--motion-ease-standard)",
								cursor: "pointer",
							}}
						>
							{a.label}
						</button>
					))}
				</div>
			</div>
			<CodeBlock filename={current.filename} lines={current.lines} />
		</div>
	);
}

const SCHEMA_OUTPUTS = [
	{
		icon: "plug",
		title: "REST API",
		desc: "GET / POST / PATCH / DELETE on /posts. Pagination, filtering, sorting.",
	},
	{
		icon: "database",
		title: "Drizzle schema",
		desc: "Typed Postgres columns + indexes + FK constraints.",
	},
	{
		icon: "shield",
		title: "Zod validators",
		desc: "Input + output schemas. Field-level overrides honored.",
	},
	{
		icon: "layout",
		title: "Admin list + form",
		desc: "Server-driven views with filters, search, tabs, sidebar.",
	},
	{
		icon: "brackets-curly",
		title: "TypeScript types",
		desc: '`AppCollections["posts"]` exact shape across server and client.',
	},
	{
		icon: "code",
		title: "OpenAPI + SDK",
		desc: "Auto-published OpenAPI. Typed client. TanStack Query hooks.",
	},
	{
		icon: "plug",
		title: "MCP tools",
		desc: "CRUD exposed to agents under the same RBAC. No prompt glue.",
	},
	{
		icon: "lightning",
		title: "Realtime feed",
		desc: "Every mutation publishes to SSE. TanStack Query auto-refetches.",
	},
];

function SchemaOutputsMap() {
	return (
		<div style={{ marginTop: 44 }}>
			<div style={{ marginBottom: 14 }}>
				<div className="landing-eyebrow" style={{ marginBottom: 4 }}>
					One schema, many projections
				</div>
				<div
					style={{
						fontSize: 15,
						color: "var(--foreground)",
						fontWeight: 500,
					}}
				>
					Codegen turns your collection into everything around it.
				</div>
			</div>
			<div
				className="landing-som-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 260px) 60px minmax(0, 1fr)",
					gap: 0,
					border: "1px solid var(--border-subtle)",
					borderRadius: "var(--surface-radius)",
					background: "var(--card)",
					overflow: "hidden",
				}}
			>
				<div
					style={{
						padding: "20px 18px",
						borderRight: "1px solid var(--border-subtle)",
						background: "var(--surface-low)",
						display: "flex",
						flexDirection: "column",
						gap: 8,
						justifyContent: "center",
					}}
				>
					<div
						className="landing-eyebrow"
						style={{ color: "var(--pillar-framework)" }}
					>
						Input
					</div>
					<div
						style={{
							fontFamily: "var(--font-mono)",
							fontSize: 12,
							color: "var(--foreground)",
							lineHeight: 1.6,
							background: "var(--card)",
							border: "1px solid var(--border-subtle)",
							borderRadius: "var(--control-radius-inner)",
							padding: 10,
						}}
					>
						<span style={{ color: "var(--syntax-keyword)" }}>collection</span>(
						<span style={{ color: "var(--syntax-string)" }}>"posts"</span>)<br />
						&nbsp;&nbsp;.
						<span style={{ color: "var(--syntax-function)" }}>fields</span>(
						{"{...}"})<br />
						&nbsp;&nbsp;.
						<span style={{ color: "var(--syntax-function)" }}>hooks</span>(
						{"{...}"})<br />
						&nbsp;&nbsp;.
						<span style={{ color: "var(--syntax-function)" }}>access</span>(
						{"{...}"})<br />
						&nbsp;&nbsp;.
						<span style={{ color: "var(--syntax-function)" }}>list</span>(v.
						<span style={{ color: "var(--syntax-function)" }}>
							collectionTable
						</span>
						)<br />
						&nbsp;&nbsp;.
						<span style={{ color: "var(--syntax-function)" }}>form</span>(v.
						<span style={{ color: "var(--syntax-function)" }}>
							collectionForm
						</span>
						)
					</div>
					<div
						className="landing-mono"
						style={{ fontSize: 11, color: "var(--foreground-subtle)" }}
					>
						$ questpie generate
					</div>
				</div>

				<div
					aria-hidden="true"
					className="landing-som-arrows"
					style={{
						position: "relative",
						background: "var(--surface)",
						borderRight: "1px solid var(--border-subtle)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<svg
						width="60"
						height="100%"
						viewBox="0 0 60 280"
						preserveAspectRatio="none"
						style={{
							position: "absolute",
							inset: 0,
							width: "100%",
							height: "100%",
						}}
						aria-hidden="true"
					>
						<title>connector lines</title>
						{[0, 1, 2, 3].map((i) => {
							const mid = 140;
							const targetY = 35 + i * 70;
							return (
								<path
									key={i}
									d={`M0 ${mid} C30 ${mid}, 30 ${targetY}, 60 ${targetY}`}
									fill="none"
									stroke="var(--border)"
									strokeWidth="1"
								/>
							);
						})}
					</svg>
				</div>

				<div
					className="landing-som-outputs"
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
					}}
				>
					{SCHEMA_OUTPUTS.map((o, i, arr) => {
						const lastInRow = (i + 1) % 2 === 0;
						const lastRow = i >= arr.length - 2;
						return (
							<div
								key={`${o.title}-${i}`}
								style={{
									padding: "14px 16px",
									borderRight: lastInRow
										? "none"
										: "1px solid var(--border-subtle)",
									borderBottom: lastRow
										? "none"
										: "1px solid var(--border-subtle)",
									display: "flex",
									gap: 12,
									alignItems: "flex-start",
								}}
							>
								<span
									style={{
										width: 26,
										height: 26,
										borderRadius: 7,
										background:
											"color-mix(in srgb, var(--pillar-framework) 8%, transparent)",
										border:
											"1px solid color-mix(in srgb, var(--pillar-framework) 22%, transparent)",
										color: "var(--pillar-framework)",
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										flexShrink: 0,
									}}
								>
									<LIcon name={o.icon} size={13} />
								</span>
								<div>
									<div
										style={{
											fontSize: 13.5,
											color: "var(--foreground)",
											fontWeight: 500,
										}}
									>
										{o.title}
									</div>
									<div
										style={{
											fontSize: 11.5,
											color: "var(--foreground-muted)",
											lineHeight: 1.45,
											marginTop: 2,
										}}
									>
										{o.desc}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>
			<style>{`
				@media (max-width: 880px) {
					.landing-som-grid { grid-template-columns: 1fr !important; }
					.landing-som-grid > div:first-child { border-right: none !important; border-bottom: 1px solid var(--border-subtle); }
					.landing-som-arrows { display: none !important; }
				}
			`}</style>
		</div>
	);
}

/* ============================================================
 * CLOUD SECTION (index)
 * ============================================================ */
const CLOUD_FEATURES = [
	{
		icon: "rocket",
		title: "Health-checked deploys",
		desc: "Durable build workflow, atomic switchover, one-click rollback when metrics regress.",
	},
	{
		icon: "database",
		title: "Managed Postgres + storage",
		desc: "Provisioned, scaled, point-in-time recovery up to 30 days. S3-compatible object storage served via CDN.",
	},
	{
		icon: "globe",
		title: "Custom domains + SSL",
		desc: "Point DNS at QUESTPIE. Certificates and routing configured automatically.",
	},
	{
		icon: "git-branch",
		title: "Preview deploys per branch",
		desc: "Every PR gets a stable URL. Same pipeline as production, build cache reused across deploys.",
	},
	{
		icon: "robot",
		title: "Hosted Autopilot per account",
		desc: "Managed Autopilot installation mapped to your Cloud projects. AI builder + workflows + agents ready.",
	},
	{
		icon: "chart-bar",
		title: "Logs, metrics, alerts",
		desc: "p95, errors, uptime in dashboard. Alerts to your channels. Same data Cloud uses for health checks.",
	},
	{
		icon: "shield",
		title: "Backups + audit",
		desc: "Daily backups, PITR restore, audit log on Scale. Data residency configurable on enterprise plans.",
	},
	{
		icon: "users",
		title: "Team roles + SSO",
		desc: "Member roles, scoped API keys, SAML/OIDC SSO and audit log on enterprise tiers.",
	},
];

export function CloudSection() {
	return (
		<Section id="cloud" pad="64px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="02 · Cloud"
					eyebrowColor="var(--pillar-cloud)"
					title="The runtime control plane."
					lede="Accounts, projects, environments, managed Postgres, custom domains, builds and rollouts. Plus hosted Autopilot for your account. Framework stays free; Cloud is the part you'd rather not operate."
				/>
			</Reveal>

			<div
				className="landing-cloud-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
					gap: 40,
					alignItems: "stretch",
					marginBottom: 32,
				}}
			>
				<Reveal>
					<CloudConsoleMock />
				</Reveal>
				<Reveal delay={80}>
					<CloudBuilderMock />
				</Reveal>
			</div>

			<Reveal delay={120}>
				<div
					className="landing-features-grid-4"
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(4, minmax(0,1fr))",
						gap: 0,
						border: "1px solid var(--border-subtle)",
						borderRadius: "var(--surface-radius)",
						overflow: "hidden",
						background: "var(--card)",
					}}
				>
					{CLOUD_FEATURES.map((f, i) => {
						const lastInRow = (i + 1) % 4 === 0;
						const lastRow = i >= CLOUD_FEATURES.length - 4;
						return (
							<div
								key={f.title}
								style={{
									padding: 20,
									borderRight: lastInRow
										? "none"
										: "1px solid var(--border-subtle)",
									borderBottom: lastRow
										? "none"
										: "1px solid var(--border-subtle)",
								}}
							>
								<LIcon
									name={f.icon}
									size={16}
									style={{
										color: "var(--pillar-cloud)",
										marginBottom: 12,
									}}
								/>
								<div
									style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}
								>
									{f.title}
								</div>
								<div
									style={{
										fontSize: 12.5,
										color: "var(--foreground-muted)",
										lineHeight: 1.55,
									}}
								>
									{f.desc}
								</div>
							</div>
						);
					})}
				</div>
			</Reveal>

			<Reveal delay={160}>
				<WaitlistRow
					accent="var(--pillar-cloud)"
					cta="Reserve your spot"
					product="Cloud"
				/>
			</Reveal>

			<Reveal delay={200}>
				<div style={{ marginTop: 16, textAlign: "center" }}>
					<Link
						to="/cloud"
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 8,
							fontSize: 13,
							color: "var(--pillar-cloud)",
							fontWeight: 500,
						}}
					>
						See the full Cloud page
						<LIcon name="arrow-right" size={12} />
					</Link>
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 980px) {
					.landing-cloud-grid { grid-template-columns: 1fr !important; gap: 28px !important; }
					.landing-features-grid-4 { grid-template-columns: repeat(2, 1fr) !important; }
					.landing-features-grid-4 > div:nth-child(2n) { border-right: none !important; }
					.landing-features-grid-4 > div:nth-child(odd) { border-right: 1px solid var(--border-subtle) !important; }
				}
			`}</style>
		</Section>
	);
}

function CloudConsoleMock() {
	const deployments = [
		{
			name: "marketing-site",
			env: "prod",
			status: "live",
			time: "2m ago",
			color: "var(--success)",
		},
		{
			name: "blog",
			env: "prod",
			status: "live",
			time: "1h ago",
			color: "var(--success)",
		},
		{
			name: "marketing-site",
			env: "preview/feat-pricing",
			status: "building",
			time: "3m",
			color: "var(--pillar-cloud)",
		},
		{
			name: "internal-tools",
			env: "prod",
			status: "live",
			time: "yesterday",
			color: "var(--success)",
		},
	];
	return (
		<div
			className="landing-panel"
			style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "10px 14px",
					borderBottom: "1px solid var(--border-subtle)",
					background: "var(--surface-low)",
				}}
			>
				<div style={{ display: "flex", gap: 4 }}>
					{[0, 1, 2].map((i) => (
						<span
							key={i}
							style={{
								width: 9,
								height: 9,
								borderRadius: "50%",
								background: "var(--surface-high)",
								display: "inline-block",
							}}
						/>
					))}
				</div>
				<span
					className="landing-mono"
					style={{ fontSize: 11, color: "var(--foreground-subtle)" }}
				>
					cloud.questpie.com / deployments
				</span>
				<span
					className="landing-mono"
					style={{
						marginLeft: "auto",
						fontSize: 10,
						color: "var(--pillar-cloud)",
						border:
							"1px solid color-mix(in srgb, var(--pillar-cloud) 30%, transparent)",
						background:
							"color-mix(in srgb, var(--pillar-cloud) 8%, transparent)",
						padding: "2px 8px",
						borderRadius: 6,
					}}
				>
					us-east-1
				</span>
			</div>

			<div
				style={{
					padding: "14px 16px",
					borderBottom: "1px solid var(--border-subtle)",
				}}
			>
				<div className="landing-eyebrow" style={{ marginBottom: 8 }}>
					Last 7 days
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "baseline",
						gap: 16,
						flexWrap: "wrap",
					}}
				>
					{[
						{ k: "Deploys", v: "127" },
						{ k: "p95", v: "84ms" },
						{ k: "Uptime", v: "99.99%" },
						{ k: "Builds", v: "0 failed" },
					].map((s) => (
						<div key={s.k}>
							<div
								className="landing-mono landing-tabular"
								style={{
									fontSize: 18,
									color: "var(--foreground)",
									fontWeight: 600,
								}}
							>
								{s.v}
							</div>
							<div className="landing-eyebrow">{s.k}</div>
						</div>
					))}
				</div>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 110px 70px",
					padding: "8px 16px",
					background: "var(--muted)",
					borderBottom: "1px solid var(--border-subtle)",
					fontFamily: "var(--font-mono)",
					fontSize: 10,
					letterSpacing: "0.04em",
					textTransform: "uppercase",
					color: "var(--foreground-subtle)",
				}}
			>
				<span>Project · branch</span>
				<span>Status</span>
				<span>Time</span>
			</div>
			{deployments.map((d, i) => (
				<div
					key={`${d.name}-${d.env}`}
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 110px 70px",
						padding: "11px 16px",
						borderBottom:
							i === deployments.length - 1
								? "none"
								: "1px solid var(--border-subtle)",
						fontSize: 13,
						alignItems: "center",
					}}
				>
					<span>
						<span style={{ color: "var(--foreground)" }}>{d.name}</span>{" "}
						<span
							className="landing-mono"
							style={{ color: "var(--foreground-subtle)", fontSize: 12 }}
						>
							{d.env}
						</span>
					</span>
					<span
						style={{
							fontFamily: "var(--font-mono)",
							fontSize: 11,
							color: d.color,
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						<span
							style={{
								width: 6,
								height: 6,
								borderRadius: "50%",
								background: "currentColor",
							}}
						/>
						{d.status}
					</span>
					<span
						className="landing-mono landing-tabular"
						style={{ fontSize: 12, color: "var(--foreground-muted)" }}
					>
						{d.time}
					</span>
				</div>
			))}
		</div>
	);
}

function CloudBuilderMock() {
	const envs = [
		{ name: "prod", url: "marekstreet.barbers", state: "live", build: "ok" },
		{
			name: "staging",
			url: "staging.marekstreet.barbers",
			state: "live",
			build: "ok",
		},
		{
			name: "preview/feat-pricing",
			url: "preview-feat-pricing.questpie.app",
			state: "building",
			build: "step 3/6",
		},
	];
	return (
		<div
			className="landing-panel"
			style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "10px 14px",
					borderBottom: "1px solid var(--border-subtle)",
					background: "var(--surface-low)",
				}}
			>
				<LIcon
					name="layout"
					size={13}
					style={{ color: "var(--pillar-cloud)" }}
				/>
				<span
					className="landing-mono"
					style={{ fontSize: 11, color: "var(--foreground)" }}
				>
					project · marekstreet
				</span>
				<span
					className="landing-mono"
					style={{
						marginLeft: "auto",
						fontSize: 10,
						color: "var(--pillar-cloud)",
						border:
							"1px solid color-mix(in srgb, var(--pillar-cloud) 30%, transparent)",
						background:
							"color-mix(in srgb, var(--pillar-cloud) 8%, transparent)",
						padding: "2px 8px",
						borderRadius: 6,
					}}
				>
					eu-west-1
				</span>
			</div>

			<div style={{ padding: "14px 16px" }}>
				<div className="landing-eyebrow" style={{ marginBottom: 10 }}>
					Environments
				</div>
				{envs.map((e, i) => (
					<div
						key={e.name}
						style={{
							display: "grid",
							gridTemplateColumns: "auto 1fr 90px",
							gap: 12,
							padding: "9px 0",
							borderTop:
								i === 0 ? "none" : "1px dashed var(--border-subtle)",
							alignItems: "center",
							fontSize: 12.5,
						}}
					>
						<span
							style={{
								width: 7,
								height: 7,
								borderRadius: "50%",
								background:
									e.state === "live"
										? "var(--success)"
										: e.state === "building"
											? "var(--pillar-cloud)"
											: "var(--foreground-subtle)",
								boxShadow:
									e.state === "building"
										? "0 0 0 3px color-mix(in srgb, var(--pillar-cloud) 25%, transparent)"
										: "none",
							}}
						/>
						<span style={{ minWidth: 0 }}>
							<code
								style={{ fontSize: 11.5, color: "var(--foreground)" }}
							>
								{e.name}
							</code>{" "}
							<span
								className="landing-mono"
								style={{ fontSize: 11, color: "var(--foreground-subtle)" }}
							>
								· {e.url}
							</span>
						</span>
						<span
							className="landing-mono landing-tabular"
							style={{
								textAlign: "right",
								fontSize: 11,
								color:
									e.state === "building"
										? "var(--pillar-cloud)"
										: "var(--foreground-muted)",
							}}
						>
							{e.build}
						</span>
					</div>
				))}
			</div>

			<div
				style={{
					padding: "12px 16px",
					borderTop: "1px solid var(--border-subtle)",
					background: "var(--surface-low)",
				}}
			>
				<div className="landing-eyebrow" style={{ marginBottom: 8 }}>
					Resources
				</div>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(2, 1fr)",
						gap: 8,
					}}
				>
					{[
						{ label: "Postgres", v: "shared-eu · 16 GB", icon: "database" },
						{ label: "Storage", v: "5.2 GB · S3-compat", icon: "database" },
						{ label: "Email", v: "send · verified", icon: "chat-circle" },
						{ label: "Domains", v: "2 · SSL auto", icon: "globe" },
					].map((r) => (
						<div
							key={r.label}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								fontSize: 12,
								color: "var(--foreground)",
								padding: "6px 0",
							}}
						>
							<LIcon
								name={r.icon}
								size={12}
								style={{ color: "var(--pillar-cloud)" }}
							/>
							<span style={{ color: "var(--foreground-muted)" }}>
								{r.label}
							</span>
							<span
								className="landing-mono"
								style={{
									marginLeft: "auto",
									fontSize: 11,
									color: "var(--foreground-subtle)",
								}}
							>
								{r.v}
							</span>
						</div>
					))}
				</div>
			</div>

			<div
				style={{
					padding: "10px 14px",
					borderTop: "1px solid var(--border-subtle)",
					background: "var(--card)",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					fontSize: 11.5,
					color: "var(--foreground-subtle)",
				}}
			>
				<span className="landing-mono">hosted Autopilot · mapped</span>
				<span
					className="landing-mono"
					style={{ color: "var(--pillar-autopilot)" }}
				>
					marekstreet.autopilot ↗
				</span>
			</div>
		</div>
	);
}

/* ============================================================
 * AUTOPILOT SECTION (index)
 * ============================================================ */
const AUTOPILOT_CAPS = [
	{
		icon: "circle",
		title: "Issues",
		desc: "Linear-style work items with status, type, project and attached workflow.",
	},
	{
		icon: "tree-structure",
		title: "Workflows",
		desc: "Durable procedures. step.run · step.sleep · step.waitForEvent · step.invoke.",
	},
	{
		icon: "calendar",
		title: "Schedules",
		desc: "Cron triggers that create issues or run workflows directly.",
	},
	{
		icon: "book-open",
		title: "Knowledge",
		desc: "Context, docs and rules with semantic search. Used by workflows and agents.",
	},
	{
		icon: "sparkle",
		title: "AI builder",
		desc: "Lovable-style. Modifies real QUESTPIE code, opens a PR, deploys through Cloud.",
	},
	{
		icon: "robot",
		title: "Agents",
		desc: "Capability profiles + tools + MCP. Pluggable provider. Anthropic, OpenAI, local.",
	},
	{
		icon: "chat-circle",
		title: "Integrations",
		desc: "Slack, GitHub, email. Open issues from a thread. Approve workflows in one click.",
	},
	{
		icon: "code",
		title: "Packs",
		desc: "Installable bundles: skills, workflows, schedules, MCP tools, knowledge seeds.",
	},
];

const RUNTIMES = [
	{ name: "Claude Code", state: "Active" },
	{ name: "Codex", state: "Active" },
	{ name: "Gemini", state: "Planned" },
	{ name: "Cursor", state: "Planned" },
	{ name: "OpenCode", state: "Planned" },
	{ name: "Copilot", state: "Planned" },
];

export function AutopilotSection() {
	return (
		<Section id="autopilot" pad="64px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="03 · Autopilot"
					eyebrowColor="var(--pillar-autopilot)"
					title="The AI-native operating layer."
					lede="Like Linear for work, Lovable for app building, Zapier for automation. Issues, durable workflows, schedules, knowledge, agents and an AI builder that edits real code. Open source. Audited. Yours."
				/>
			</Reveal>

			<div
				className="landing-autopilot-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
					gap: 40,
					alignItems: "start",
					marginBottom: 32,
				}}
			>
				<Reveal>
					<WorkflowCode />
				</Reveal>
				<Reveal delay={80}>
					<AgentInspector />
				</Reveal>
			</div>

			<Reveal delay={120}>
				<div
					className="landing-features-grid-4"
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(4, minmax(0,1fr))",
						gap: 0,
						border: "1px solid var(--border-subtle)",
						borderRadius: "var(--surface-radius)",
						overflow: "hidden",
						background: "var(--card)",
						marginBottom: 32,
					}}
				>
					{AUTOPILOT_CAPS.map((f, i) => {
						const lastInRow = (i + 1) % 4 === 0;
						const lastRow = i >= AUTOPILOT_CAPS.length - 4;
						return (
							<div
								key={f.title}
								style={{
									padding: 20,
									borderRight: lastInRow
										? "none"
										: "1px solid var(--border-subtle)",
									borderBottom: lastRow
										? "none"
										: "1px solid var(--border-subtle)",
								}}
							>
								<LIcon
									name={f.icon}
									size={16}
									style={{
										color: "var(--pillar-autopilot)",
										marginBottom: 12,
									}}
								/>
								<div
									style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}
								>
									{f.title}
								</div>
								<div
									style={{
										fontSize: 12.5,
										color: "var(--foreground-muted)",
										lineHeight: 1.55,
									}}
								>
									{f.desc}
								</div>
							</div>
						);
					})}
				</div>
			</Reveal>

			<Reveal delay={160}>
				<RuntimeMatrix />
			</Reveal>

			<Reveal delay={200}>
				<WaitlistRow
					accent="var(--pillar-autopilot)"
					cta="Get early access"
					product="Autopilot"
				/>
			</Reveal>

			<Reveal delay={240}>
				<div style={{ marginTop: 16, textAlign: "center" }}>
					<Link
						to="/autopilot"
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 8,
							fontSize: 13,
							color: "var(--pillar-autopilot)",
							fontWeight: 500,
						}}
					>
						See the full Autopilot page
						<LIcon name="arrow-right" size={12} />
					</Link>
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 980px) {
					.landing-autopilot-grid { grid-template-columns: 1fr !important; gap: 28px !important; }
				}
			`}</style>
		</Section>
	);
}

function WorkflowCode() {
	const lines: CodeLine[] = [
		[CM("// workflows/onboard-customer.ts · durable, restartable")],
		[KW("export default "), FN("workflow"), "("],
		["  ", STR('"onboard-customer"'), ","],
		["  ", KW("async"), " (step, { email }) => {"],
		["    ", KW("const"), " user = ", KW("await"), " step.", FN("run"), "("],
		["      ", STR('"create-account"'), ", () => createUser(email)"],
		["    );"],
		[""],
		[
			"    ",
			KW("await"),
			" step.",
			FN("run"),
			"(",
			STR('"welcome"'),
			", () => sendWelcome(user));",
		],
		[
			"    ",
			KW("await"),
			" step.",
			FN("sleep"),
			"(",
			STR('"trial"'),
			", ",
			STR('"14d"'),
			");",
		],
		[
			"    ",
			KW("await"),
			" step.",
			FN("waitForEvent"),
			"(",
			STR('"trial-end-action"'),
			");",
		],
		[
			"    ",
			KW("await"),
			" step.",
			FN("invoke"),
			"(",
			STR('"send-renewal"'),
			", { user });",
		],
		["  }"],
		[");"],
	];
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<CodeBlock filename="workflows/onboard-customer.ts" lines={lines} />
			<div
				style={{
					padding: "12px 14px",
					border: "1px solid var(--border-subtle)",
					background: "var(--surface-low)",
					borderRadius: "var(--surface-radius)",
					fontSize: 12.5,
					lineHeight: 1.6,
					color: "var(--foreground-muted)",
				}}
			>
				<div className="landing-eyebrow" style={{ marginBottom: 6 }}>
					Workflow primitives
				</div>
				<div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
					{[
						["step.run", "execute + persist"],
						["step.sleep", "wait hours/days/weeks"],
						["step.waitForEvent", "block on signal"],
						["step.invoke", "compose workflows"],
					].map(([k, v]) => (
						<span
							key={k}
							style={{
								display: "inline-flex",
								gap: 6,
								alignItems: "center",
							}}
						>
							<code
								style={{ fontSize: 12, color: "var(--pillar-autopilot)" }}
							>
								{k}
							</code>
							<span
								style={{ fontSize: 12, color: "var(--foreground-subtle)" }}
							>
								{v}
							</span>
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

function AgentInspector() {
	type StepState = "done" | "wait" | "queued";
	const steps: Array<{
		name: string;
		state: StepState;
		t: string;
		out: string;
	}> = [
		{ name: "draft-post", state: "done", t: "01.4s", out: "Generated 612 words" },
		{ name: "fact-check", state: "done", t: "03.1s", out: "3 sources verified" },
		{ name: "seo-pass", state: "done", t: "00.9s", out: "title + meta updated" },
		{ name: "human-review", state: "wait", t: "·", out: "Waiting for @marek" },
		{ name: "publish", state: "queued", t: "·", out: "Will run after approval" },
	];
	const dotColor = (s: StepState) =>
		s === "done"
			? "var(--success)"
			: s === "wait"
				? "var(--pillar-autopilot)"
				: "var(--foreground-subtle)";
	return (
		<div
			className="landing-panel"
			style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "10px 14px",
					borderBottom: "1px solid var(--border-subtle)",
					background: "var(--surface-low)",
				}}
			>
				<LIcon
					name="robot"
					size={13}
					style={{ color: "var(--pillar-autopilot)" }}
				/>
				<span
					className="landing-mono"
					style={{ fontSize: 11, color: "var(--foreground)" }}
				>
					agent · content-team-01
				</span>
				<span
					className="landing-mono"
					style={{
						marginLeft: "auto",
						fontSize: 10,
						color: "var(--pillar-autopilot)",
						border:
							"1px solid color-mix(in srgb, var(--pillar-autopilot) 30%, transparent)",
						background:
							"color-mix(in srgb, var(--pillar-autopilot) 8%, transparent)",
						padding: "2px 8px",
						borderRadius: 6,
					}}
				>
					running
				</span>
			</div>

			<div style={{ padding: 14 }}>
				<div className="landing-eyebrow" style={{ marginBottom: 10 }}>
					Run · #4821
				</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
					{steps.map((s, i) => (
						<div
							key={s.name}
							style={{
								display: "flex",
								alignItems: "flex-start",
								gap: 12,
								padding: "10px 0",
								borderTop:
									i === 0 ? "none" : "1px dashed var(--border-subtle)",
							}}
						>
							<span
								style={{
									width: 8,
									height: 8,
									borderRadius: "50%",
									background: dotColor(s.state),
									marginTop: 6,
									flexShrink: 0,
									boxShadow:
										s.state === "wait"
											? `0 0 0 3px color-mix(in srgb, ${dotColor(s.state)} 25%, transparent)`
											: "none",
								}}
							/>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										gap: 12,
									}}
								>
									<code
										style={{ fontSize: 12.5, color: "var(--foreground)" }}
									>
										step.{s.name}
									</code>
									<span
										className="landing-mono landing-tabular"
										style={{
											fontSize: 11,
											color: "var(--foreground-subtle)",
										}}
									>
										{s.t}
									</span>
								</div>
								<div
									style={{
										fontSize: 12,
										color: "var(--foreground-muted)",
										marginTop: 2,
									}}
								>
									{s.out}
								</div>
							</div>
						</div>
					))}
				</div>
			</div>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "10px 14px",
					borderTop: "1px solid var(--border-subtle)",
					background: "var(--surface-low)",
					fontSize: 12,
					color: "var(--foreground-subtle)",
				}}
			>
				<span className="landing-mono">trace: wf_a821-0428</span>
				<span className="landing-mono">3 / 5 steps · 5.4s</span>
			</div>
		</div>
	);
}

function RuntimeMatrix() {
	return (
		<div
			style={{
				border: "1px solid var(--border-subtle)",
				borderRadius: "var(--surface-radius)",
				background: "var(--card)",
				padding: 20,
				marginBottom: 32,
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-end",
					marginBottom: 14,
					flexWrap: "wrap",
					gap: 12,
				}}
			>
				<div>
					<div className="landing-eyebrow" style={{ marginBottom: 4 }}>
						Agent runtimes
					</div>
					<div
						style={{
							fontSize: 15,
							color: "var(--foreground)",
							fontWeight: 500,
						}}
					>
						Pluggable backbone. Works with the model you trust.
					</div>
				</div>
				<span
					className="landing-mono"
					style={{ fontSize: 11, color: "var(--foreground-subtle)" }}
				>
					MCP · spawn-agent · streaming
				</span>
			</div>

			<div
				className="landing-runtime-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(6, minmax(0,1fr))",
					gap: 0,
					border: "1px solid var(--border-subtle)",
					borderRadius: "var(--control-radius)",
					overflow: "hidden",
				}}
			>
				{RUNTIMES.map((r, i) => (
					<div
						key={r.name}
						style={{
							padding: "14px 12px",
							textAlign: "center",
							borderRight:
								i === RUNTIMES.length - 1
									? "none"
									: "1px solid var(--border-subtle)",
							background: "var(--surface-low)",
						}}
					>
						<div
							style={{
								fontSize: 13,
								color: "var(--foreground)",
								marginBottom: 4,
							}}
						>
							{r.name}
						</div>
						<div
							className="landing-mono"
							style={{
								fontSize: 10,
								color:
									r.state === "Active"
										? "var(--pillar-autopilot)"
										: "var(--foreground-subtle)",
								letterSpacing: "0.04em",
								textTransform: "uppercase",
							}}
						>
							{r.state}
						</div>
					</div>
				))}
			</div>
			<style>{`
				@media (max-width: 760px) {
					.landing-runtime-grid { grid-template-columns: repeat(3, 1fr) !important; }
					.landing-runtime-grid > div:nth-child(3n) { border-right: none !important; }
					.landing-runtime-grid > div { border-bottom: 1px solid var(--border-subtle) !important; }
					.landing-runtime-grid > div:nth-last-child(-n+3) { border-bottom: none !important; }
				}
			`}</style>
		</div>
	);
}

export function WaitlistRow({
	accent,
	cta,
	product,
}: {
	accent: string;
	cta: string;
	product: string;
}) {
	const [email, setEmail] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!email) return;
		setSubmitted(true);
	};
	return (
		<div
			style={{
				marginTop: 16,
				padding: 20,
				border: "1px solid var(--border-subtle)",
				borderRadius: "var(--surface-radius)",
				background: "var(--card)",
				display: "flex",
				gap: 16,
				alignItems: "center",
				flexWrap: "wrap",
			}}
		>
			<div style={{ flex: 1, minWidth: 220 }}>
				<div className="landing-eyebrow" style={{ marginBottom: 4 }}>
					{product} · Waitlist
				</div>
				<div style={{ fontSize: 14, color: "var(--foreground)" }}>
					Be first to try {product}. We email when your environment is ready. No
					spam, ever.
				</div>
			</div>
			{submitted ? (
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 8,
						padding: "8px 14px",
						border: `1px solid ${accent}`,
						borderRadius: "var(--control-radius)",
						color: accent,
						fontSize: 13,
					}}
				>
					<LIcon name="check" size={14} />
					You're on the list for {product}.
				</span>
			) : (
				<form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
					<Input
						type="email"
						required
						placeholder="you@company.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						style={{ minWidth: 240 }}
					/>
					<button
						type="submit"
						className="landing-btn"
						style={{
							background: accent,
							color: "#0a0a0a",
							fontWeight: 600,
						}}
					>
						{cta}
						<LIcon name="arrow-right" size={14} />
					</button>
				</form>
			)}
		</div>
	);
}

/* ============================================================
 * USE CASES
 * ============================================================ */
type Stack = "Framework" | "Cloud" | "Autopilot";
const STACK_COLOR: Record<Stack, string> = {
	Framework: "var(--pillar-framework)",
	Cloud: "var(--pillar-cloud)",
	Autopilot: "var(--pillar-autopilot)",
};

const USE_CASES = [
	{
		id: "uc-restaurants",
		icon: "storefront",
		name: "Restaurants & cafés",
		headline: "Menu, bookings and online orders in one place.",
		bullets: [
			"Bilingual menu with allergens, photos and price history",
			"Reservation engine with floor plan and SMS confirmation",
			"Online ordering with stock, opening hours and pickup slots",
		],
		proof: { k: "Saving", v: "$214/mo" },
		stack: ["Framework", "Cloud"] satisfies Stack[],
	},
	{
		id: "uc-ecommerce",
		icon: "storefront",
		name: "E-commerce & retail",
		headline: "A storefront that ships, not 12 plugins glued together.",
		bullets: [
			"Products, variants, stock, taxes and discounts as collections",
			"Stripe + Pay by Square + COD adapters out of the box",
			"Autopilot drafts product descriptions and SEO meta",
		],
		proof: { k: "Replaces", v: "Shopify + Klaviyo + Notion" },
		stack: ["Framework", "Autopilot"] satisfies Stack[],
	},
	{
		id: "uc-agencies",
		icon: "users",
		name: "Agencies & studios",
		headline: "Spin up 30 client sites without spinning out.",
		bullets: [
			"Multi-tenant deployments with shared design system",
			"Per-client admin, custom roles and brand themes",
			"Hand the keys over. Clients edit without breaking the build",
		],
		proof: { k: "Per project", v: "~3 hours to ship" },
		stack: ["Framework", "Cloud", "Autopilot"] satisfies Stack[],
	},
	{
		id: "uc-realestate",
		icon: "globe",
		name: "Real estate",
		headline: "Listings, leads and pipelines that talk to each other.",
		bullets: [
			"Listings with map, gallery, status and price changes",
			"Lead capture with assignment to agents by region",
			"Workflows for viewings, follow-ups and contract steps",
		],
		proof: { k: "Pipeline ops", v: "Automated end-to-end" },
		stack: ["Framework", "Autopilot"] satisfies Stack[],
	},
	{
		id: "uc-portfolios",
		icon: "pencil",
		name: "Portfolios & creators",
		headline: "A site that grows with your work, not against it.",
		bullets: [
			"Case studies with rich text, video and password-gated pages",
			"Localized content, custom domains and analytics built-in",
			"Autopilot writes alt-text, tags and SEO for every upload",
		],
		proof: { k: "Setup", v: "10 minutes" },
		stack: ["Framework", "Cloud"] satisfies Stack[],
	},
	{
		id: "uc-saas",
		icon: "lightning",
		name: "Internal tools & SaaS",
		headline: "Stop building yet another admin from scratch.",
		bullets: [
			"Generate full CRUD admins from your existing Postgres schema",
			"Field-level RBAC, audit log, hooks and impersonation built-in",
			"Use as the backplane for any TanStack / Next / Hono app",
		],
		proof: { k: "Boilerplate", v: "0 lines" },
		stack: ["Framework"] satisfies Stack[],
	},
];

export function UseCasesSection() {
	return (
		<Section id="use-cases" pad="64px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="For real businesses"
					title="Built for every kind of business."
					lede="Use the same Framework + Cloud + Autopilot stack to ship a restaurant menu, a Shopify alternative or a multi-tenant agency platform. Less glue, less SaaS spend, less migration debt."
				/>
			</Reveal>

			<div
				className="landing-uc-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(3, minmax(0,1fr))",
					gap: 16,
				}}
			>
				{USE_CASES.map((uc, i) => (
					<Reveal key={uc.id} delay={i * 40}>
						<UseCaseCard data={uc} />
					</Reveal>
				))}
			</div>

			<style>{`
				@media (max-width: 980px) { .landing-uc-grid { grid-template-columns: repeat(2, 1fr) !important; } }
				@media (max-width: 660px) { .landing-uc-grid { grid-template-columns: 1fr !important; } }
			`}</style>
		</Section>
	);
}

function UseCaseCard({ data }: { data: (typeof USE_CASES)[number] }) {
	return (
		<a
			id={data.id}
			href={`#${data.id}`}
			className="landing-uc-card"
			style={{
				display: "flex",
				flexDirection: "column",
				padding: 20,
				border: "1px solid var(--border-subtle)",
				borderRadius: "var(--surface-radius)",
				background: "var(--card)",
				transition:
					"border-color var(--motion-duration-base) var(--motion-ease-standard), background-color var(--motion-duration-base) var(--motion-ease-standard)",
				height: "100%",
				textDecoration: "none",
				color: "inherit",
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.borderColor = "var(--border)";
				e.currentTarget.style.background = "var(--surface-low)";
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.borderColor = "var(--border-subtle)";
				e.currentTarget.style.background = "var(--card)";
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: 14,
				}}
			>
				<div
					style={{
						width: 32,
						height: 32,
						borderRadius: 8,
						background: "var(--surface-mid)",
						border: "1px solid var(--border-subtle)",
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						color: "var(--foreground)",
					}}
				>
					<LIcon name={data.icon} size={15} />
				</div>
				<div style={{ display: "flex", gap: 4 }}>
					{data.stack.map((s) => (
						<span
							key={s}
							className="landing-mono"
							style={{
								fontSize: 10,
								padding: "3px 6px",
								borderRadius: 4,
								background: `color-mix(in srgb, ${STACK_COLOR[s]} 14%, transparent)`,
								color: STACK_COLOR[s],
								letterSpacing: "0.04em",
								textTransform: "uppercase",
							}}
						>
							{s}
						</span>
					))}
				</div>
			</div>

			<h3
				style={{
					fontSize: 16,
					fontWeight: 600,
					color: "var(--foreground)",
					marginBottom: 4,
				}}
			>
				{data.name}
			</h3>
			<p
				style={{
					fontSize: 13.5,
					color: "var(--foreground-muted)",
					lineHeight: 1.55,
					marginBottom: 16,
				}}
			>
				{data.headline}
			</p>

			<ul
				style={{
					listStyle: "none",
					padding: 0,
					margin: 0,
					display: "flex",
					flexDirection: "column",
					gap: 8,
					flex: 1,
				}}
			>
				{data.bullets.map((b) => (
					<li
						key={b}
						style={{
							fontSize: 12.5,
							color: "var(--foreground)",
							display: "flex",
							gap: 10,
							lineHeight: 1.55,
						}}
					>
						<LIcon
							name="check"
							size={12}
							style={{
								color: "var(--foreground-subtle)",
								marginTop: 4,
								flexShrink: 0,
							}}
						/>
						{b}
					</li>
				))}
			</ul>

			<div
				style={{
					marginTop: 18,
					paddingTop: 14,
					borderTop: "1px dashed var(--border-subtle)",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div>
					<div className="landing-eyebrow">{data.proof.k}</div>
					<div
						className="landing-mono landing-tabular"
						style={{ fontSize: 13, color: "var(--foreground)", marginTop: 2 }}
					>
						{data.proof.v}
					</div>
				</div>
				<span
					style={{
						color: "var(--foreground-subtle)",
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						fontSize: 12,
					}}
				>
					See template
					<LIcon name="arrow-up-right" size={12} />
				</span>
			</div>
		</a>
	);
}

/* ============================================================
 * STACK / ARCHITECTURE
 * ============================================================ */
type StackRowProps = {
	label: string;
	sub: string;
	badge?: string;
	badgeTone?: "live" | "soon" | "beta" | "neutral";
	items: Array<{ name: string; icon: string }>;
	accent: string;
	isLast?: boolean;
	href?: string;
};

export function StackSection() {
	return (
		<Section id="stack" pad="64px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Architecture"
					title="What you ship vs. what we run."
					lede="QUESTPIE is a stack you can read. Open packages on top, open infrastructure underneath. Cloud is the part you'd rather not operate yourself."
					align="center"
				/>
			</Reveal>

			<Reveal>
				<div
					style={{
						border: "1px solid var(--border-subtle)",
						borderRadius: "var(--surface-radius)",
						background: "var(--card)",
						overflow: "hidden",
					}}
				>
					<StackRow
						label="Surface"
						sub="Your site & internal tools"
						items={[
							{ name: "Public site", icon: "globe" },
							{ name: "Admin workspace", icon: "layout" },
							{ name: "API & SDKs", icon: "code" },
							{ name: "Docs site", icon: "book-open" },
						]}
						accent="var(--foreground)"
					/>
					<StackRow
						label="Framework"
						sub="Open source · MIT"
						badge="LIVE"
						badgeTone="live"
						href="#framework"
						items={[
							{ name: "Collections + admin", icon: "database" },
							{ name: "Auth + RBAC", icon: "shield" },
							{ name: "Jobs + workflows", icon: "git-branch" },
							{ name: "Adapters", icon: "plug" },
						]}
						accent="var(--pillar-framework)"
					/>
					<StackRow
						label="Autopilot"
						sub="Open source · MIT"
						badge="Q4 26"
						badgeTone="beta"
						href="/autopilot"
						items={[
							{ name: "Issues + workflows", icon: "circle" },
							{ name: "AI builder", icon: "sparkle" },
							{ name: "Agents + MCP", icon: "robot" },
							{ name: "Knowledge + packs", icon: "book-open" },
						]}
						accent="var(--pillar-autopilot)"
					/>
					<StackRow
						label="QProbe"
						sub="Verification layer"
						badge="LIVE"
						badgeTone="live"
						items={[
							{ name: "Run app locally", icon: "rocket" },
							{ name: "Drive browsers", icon: "globe" },
							{ name: "API checks", icon: "plug" },
							{ name: "Evidence for runs", icon: "shield" },
						]}
						accent="var(--foreground-muted)"
					/>
					<StackRow
						label="Cloud"
						sub="Managed by QUESTPIE"
						badge="Q3 26"
						badgeTone="soon"
						href="/cloud"
						items={[
							{ name: "Build + deploy", icon: "rocket" },
							{ name: "Postgres + storage", icon: "database" },
							{ name: "Domains + SSL", icon: "globe" },
							{ name: "Hosted Autopilot", icon: "robot" },
						]}
						accent="var(--pillar-cloud)"
						isLast
					/>
				</div>
			</Reveal>

			<Reveal delay={80}>
				<div
					style={{
						marginTop: 14,
						display: "flex",
						flexWrap: "wrap",
						gap: 18,
						fontSize: 12,
						color: "var(--foreground-subtle)",
						justifyContent: "center",
					}}
				>
					<span className="landing-mono">PostgreSQL · Drizzle ORM · Zod v4</span>
					<span>·</span>
					<span className="landing-mono">Better Auth · pg-boss · Flydrive</span>
					<span>·</span>
					<span className="landing-mono">React 19 · Tailwind v4 · shadcn</span>
					<span>·</span>
					<span className="landing-mono">Bun / Node 18+</span>
				</div>
			</Reveal>
		</Section>
	);
}

function StackRow({
	label,
	sub,
	badge,
	badgeTone = "neutral",
	items,
	accent,
	isLast,
	href,
}: StackRowProps) {
	const labelInner = (
		<>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<span
					style={{
						width: 8,
						height: 8,
						borderRadius: 2,
						background: accent,
					}}
				/>
				<span
					style={{
						fontSize: 14,
						fontWeight: 600,
						color: "var(--foreground)",
					}}
				>
					{label}
				</span>
				{badge && <StatusBadge tone={badgeTone}>{badge}</StatusBadge>}
				{href && (
					<LIcon
						name="arrow-up-right"
						size={12}
						style={{
							color: "var(--foreground-subtle)",
							marginLeft: "auto",
						}}
					/>
				)}
			</div>
			<span
				className="landing-mono"
				style={{ fontSize: 11.5, color: "var(--foreground-subtle)" }}
			>
				{sub}
			</span>
		</>
	);
	return (
		<div
			className="landing-stack-row"
			style={{
				display: "grid",
				gridTemplateColumns: "minmax(180px, 220px) 1fr",
				borderBottom: isLast ? "none" : "1px solid var(--border-subtle)",
			}}
		>
			{href ? (
				<a
					href={href}
					style={{
						padding: "18px 20px",
						borderRight: "1px solid var(--border-subtle)",
						background: "var(--surface-low)",
						display: "flex",
						flexDirection: "column",
						gap: 6,
						textDecoration: "none",
						color: "inherit",
						transition:
							"background-color var(--motion-duration-base) var(--motion-ease-standard)",
					}}
					onMouseEnter={(e) => {
						e.currentTarget.style.background = "var(--surface-mid)";
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.background = "var(--surface-low)";
					}}
				>
					{labelInner}
				</a>
			) : (
				<div
					style={{
						padding: "18px 20px",
						borderRight: "1px solid var(--border-subtle)",
						background: "var(--surface-low)",
						display: "flex",
						flexDirection: "column",
						gap: 6,
					}}
				>
					{labelInner}
				</div>
			)}

			<div
				className="landing-stack-items"
				style={{
					display: "grid",
					gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))`,
				}}
			>
				{items.map((item, i) => (
					<div
						key={item.name}
						style={{
							padding: "16px 18px",
							borderRight:
								i === items.length - 1
									? "none"
									: "1px solid var(--border-subtle)",
							display: "flex",
							alignItems: "center",
							gap: 10,
						}}
					>
						<LIcon name={item.icon} size={15} style={{ color: accent }} />
						<span style={{ fontSize: 13, color: "var(--foreground)" }}>
							{item.name}
						</span>
					</div>
				))}
			</div>
			<style>{`
				@media (max-width: 880px) {
					.landing-stack-row { grid-template-columns: 1fr !important; }
					.landing-stack-row > div:first-child, .landing-stack-row > a:first-child { border-right: none !important; border-bottom: 1px solid var(--border-subtle) !important; }
					.landing-stack-items { grid-template-columns: repeat(2, 1fr) !important; }
					.landing-stack-items > div:nth-child(2n) { border-right: none !important; }
					.landing-stack-items > div:nth-child(odd) { border-right: 1px solid var(--border-subtle) !important; }
					.landing-stack-items > div:nth-last-child(-n+2) { border-bottom: none !important; }
					.landing-stack-items > div { border-bottom: 1px solid var(--border-subtle); }
				}
			`}</style>
		</div>
	);
}

/* ============================================================
 * PRICING
 * ============================================================ */
type Tier = {
	name: string;
	price: string;
	period: string;
	description: string;
	highlighted?: boolean;
	cta: { label: string; href: string; tone: "primary" | "secondary" };
	features: Array<[string, boolean]>;
};

const TIERS: Tier[] = [
	{
		name: "Self-host",
		price: "Free",
		period: "MIT",
		description:
			"Run QUESTPIE Framework + Autopilot on your own infrastructure.",
		cta: { label: "Read the docs", href: "/docs", tone: "secondary" },
		features: [
			["Collections, admin, auth, workflows", true],
			["All adapters (Hono / Elysia / Next / TanStack)", true],
			["Autopilot. Self-hosted, full", true],
			["Community support", true],
			["Managed builds + deploys", false],
			["Managed Postgres + storage", false],
			["Hosted Autopilot per account", false],
			["Enterprise SLA + SSO", false],
		],
	},
	{
		name: "Cloud · Starter",
		price: "$19",
		period: "/ month",
		description: "One project, custom domain, hosted Autopilot.",
		cta: { label: "Explore Cloud", href: "/cloud", tone: "secondary" },
		features: [
			["1 project, 1 environment", true],
			["Custom domain + SSL", true],
			["5 GB storage, 100 GB bandwidth", true],
			["Production Postgres + PITR", true],
			["Hosted Autopilot, 2 agents", true],
			["Email + community support", true],
			["Multi-environment", false],
			["SSO + audit log", false],
		],
	},
	{
		name: "Cloud · Pro",
		price: "$49",
		period: "/ month",
		description: "Multi-project teams shipping apps and operating ops.",
		highlighted: true,
		cta: { label: "Explore Cloud", href: "/cloud", tone: "primary" },
		features: [
			["10 projects, multi-environment", true],
			["50 GB storage, 1 TB bandwidth", true],
			["Preview deploys per branch", true],
			["Hosted Autopilot, unlimited", true],
			["Knowledge base + workflows", true],
			["Team roles + API keys", true],
			["Priority support", true],
			["SSO + audit log", false],
		],
	},
	{
		name: "Cloud · Scale",
		price: "Custom",
		period: "SLA",
		description: "Dedicated capacity for enterprises with compliance needs.",
		cta: { label: "Talk to us", href: "#contact", tone: "secondary" },
		features: [
			["Unlimited projects + envs", true],
			["Dedicated database + VPC", true],
			["Custom Autopilot configs + packs", true],
			["99.99% uptime SLA", true],
			["SSO + audit log", true],
			["Solution engineering", true],
			["Custom contract / data residency", true],
			["Volume discount", true],
		],
	},
];

export function PricingSection() {
	return (
		<Section id="pricing" pad="64px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Pricing"
					title="Free to self-host. Managed when you want it."
					lede="Framework is open source. Self-host for as long as you like. Cloud just removes the parts of running infrastructure you'd rather skip."
					align="center"
				/>
			</Reveal>
			<div
				className="landing-pricing-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(4, minmax(0,1fr))",
					gap: 14,
				}}
			>
				{TIERS.map((t) => (
					<Reveal key={t.name}>
						<PricingCard tier={t} />
					</Reveal>
				))}
			</div>
			<style>{`
				@media (max-width: 1024px) { .landing-pricing-grid { grid-template-columns: repeat(2, 1fr) !important; } }
				@media (max-width: 560px) { .landing-pricing-grid { grid-template-columns: 1fr !important; } }
			`}</style>
		</Section>
	);
}

function PricingCard({ tier }: { tier: Tier }) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				padding: 20,
				border: tier.highlighted
					? "1px solid color-mix(in srgb, var(--primary) 50%, transparent)"
					: "1px solid var(--border-subtle)",
				background: tier.highlighted
					? "color-mix(in srgb, var(--primary) 4%, var(--card))"
					: "var(--card)",
				borderRadius: "var(--surface-radius)",
				position: "relative",
				height: "100%",
			}}
		>
			{tier.highlighted && (
				<span
					style={{
						position: "absolute",
						top: -10,
						right: 14,
						background: "var(--primary)",
						color: "var(--primary-foreground)",
						fontFamily: "var(--font-mono)",
						fontSize: 10,
						padding: "3px 8px",
						borderRadius: 4,
						letterSpacing: "0.05em",
						textTransform: "uppercase",
						fontWeight: 600,
					}}
				>
					Popular
				</span>
			)}
			<div
				style={{
					fontSize: 13,
					color: "var(--foreground-muted)",
					marginBottom: 8,
				}}
			>
				{tier.name}
			</div>
			<div
				style={{
					display: "flex",
					alignItems: "baseline",
					gap: 6,
					marginBottom: 4,
				}}
			>
				<span
					className="landing-tabular"
					style={{
						fontSize: 30,
						color: "var(--foreground)",
						fontWeight: 600,
						letterSpacing: "-0.01em",
					}}
				>
					{tier.price}
				</span>
				<span
					className="landing-mono"
					style={{ fontSize: 12, color: "var(--foreground-subtle)" }}
				>
					{tier.period}
				</span>
			</div>
			<p
				style={{
					fontSize: 12.5,
					color: "var(--foreground-muted)",
					lineHeight: 1.5,
					marginBottom: 16,
					minHeight: 36,
				}}
			>
				{tier.description}
			</p>

			<a
				href={tier.cta.href}
				className={`landing-btn landing-btn-sm ${
					tier.cta.tone === "primary"
						? "landing-btn-primary"
						: "landing-btn-secondary"
				}`}
				style={{ width: "100%", marginBottom: 18 }}
			>
				{tier.cta.label}
				<LIcon name="arrow-right" size={12} />
			</a>

			<ul
				style={{
					listStyle: "none",
					padding: 0,
					margin: 0,
					display: "flex",
					flexDirection: "column",
					gap: 8,
					flex: 1,
				}}
			>
				{tier.features.map(([label, on]) => (
					<li
						key={label}
						style={{
							display: "flex",
							gap: 9,
							alignItems: "flex-start",
							fontSize: 12.5,
							color: on
								? "var(--foreground)"
								: "var(--foreground-disabled)",
						}}
					>
						<LIcon
							name={on ? "check" : "minus"}
							size={12}
							style={{
								marginTop: 4,
								flexShrink: 0,
								color: on
									? "var(--foreground-muted)"
									: "var(--foreground-disabled)",
							}}
						/>
						<span style={{ lineHeight: 1.5 }}>{label}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/* ============================================================
 * FAQ
 * ============================================================ */
const FAQ = [
	{
		q: "What's the difference between Framework, Cloud and Autopilot?",
		a: "Framework is the open-source TypeScript engine: collections, admin, auth, workflows, adapters. Autopilot is the open-source AI-native operating layer on top. Issues, workflows, schedules, knowledge, agents and an AI builder. Cloud is the managed runtime control plane that builds, deploys and hosts both. You can run any combination, including just Framework on your own server.",
	},
	{
		q: "Is everything really MIT?",
		a: "Framework and Autopilot are MIT-licensed. You can fork, modify and self-host them forever. Cloud is the only paid product, and it's optional. It exists for teams that don't want to run Postgres, deploys and infrastructure themselves.",
	},
	{
		q: "Can I move from Cloud back to self-hosting later?",
		a: "Yes. Your project is just QUESTPIE code + a Postgres dump. Export, point it at your own database and deploy with the Hono/Elysia/Next/TanStack adapter of your choice. No proprietary runtime.",
	},
	{
		q: "Why a backend framework instead of a hosted platform?",
		a: "Hosted platforms own your schema, your data and your operational tooling. QUESTPIE inverts that. Your code defines the schema, and the admin, API and workflows are generated. You stay in TypeScript, in version control, in your codebase.",
	},
	{
		q: "How does Autopilot stay safe with my data?",
		a: "Autopilot uses MCP (Model Context Protocol) to expose your collections and routes to agents. The same field-level permissions that apply to your humans apply to agents. Every action is logged, every workflow step is auditable, and you can require human approval anywhere in the workflow.",
	},
	{
		q: "Which AI models does Autopilot work with?",
		a: "The runtime is pluggable. Claude Code and Codex are active. Gemini, GitHub Copilot, Cursor and OpenCode are on the roadmap. You can configure which runtime to use per agent profile, and rotate without changing your workflows.",
	},
	{
		q: "When does Cloud / Autopilot ship?",
		a: "Cloud: Q3 2026. Autopilot: Q4 2026. Both are accepting waitlist signups. Framework is shipping today on npm.",
	},
];

export function FaqSection({
	items = FAQ,
}: {
	items?: Array<{ q: string; a: ReactNode }>;
}) {
	const [open, setOpen] = useState(0);
	return (
		<Section id="faq" pad="64px 24px 96px">
			<div
				className="landing-faq-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 340px) 1fr",
					gap: 56,
				}}
			>
				<Reveal>
					<div>
						<Eyebrow dot>FAQ</Eyebrow>
						<h2
							style={{
								marginTop: 14,
								fontSize: "clamp(28px, 1.5rem + 1.2vw, 36px)",
								lineHeight: 1.08,
								letterSpacing: "-0.015em",
								color: "var(--foreground)",
							}}
						>
							Questions, answered.
						</h2>
						<p
							style={{
								marginTop: 14,
								color: "var(--foreground-muted)",
								fontSize: 14,
								lineHeight: 1.6,
							}}
						>
							Honest answers. No marketing fluff. Can't find what you need?{" "}
							<a
								href="#contact"
								style={{
									color: "var(--primary)",
									textDecoration: "underline",
									textDecorationColor:
										"color-mix(in srgb, var(--primary) 40%, transparent)",
								}}
							>
								Ask the team
							</a>
							.
						</p>
					</div>
				</Reveal>

				<Reveal delay={60}>
					<div style={{ borderTop: "1px solid var(--border-subtle)" }}>
						{items.map((item, i) => (
							<FaqItem
								key={String(item.q)}
								item={item}
								isOpen={open === i}
								onToggle={() => setOpen(open === i ? -1 : i)}
							/>
						))}
					</div>
				</Reveal>
			</div>

			<style>{`
				@media (max-width: 880px) { .landing-faq-grid { grid-template-columns: 1fr !important; gap: 24px !important; } }
			`}</style>
		</Section>
	);
}

function FaqItem({
	item,
	isOpen,
	onToggle,
}: {
	item: { q: string; a: ReactNode };
	isOpen: boolean;
	onToggle: () => void;
}) {
	return (
		<div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
			<button
				type="button"
				onClick={onToggle}
				style={{
					width: "100%",
					padding: "16px 0",
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					gap: 18,
					textAlign: "left",
				}}
			>
				<span
					style={{
						fontSize: 15,
						color: "var(--foreground)",
						fontWeight: 500,
					}}
				>
					{item.q}
				</span>
				<LIcon
					name={isOpen ? "minus" : "plus"}
					size={14}
					style={{ color: "var(--foreground-subtle)", flexShrink: 0 }}
				/>
			</button>
			<div
				style={{
					display: "grid",
					gridTemplateRows: isOpen ? "1fr" : "0fr",
					transition:
						"grid-template-rows var(--motion-duration-slow) var(--motion-ease-standard)",
				}}
			>
				<div style={{ overflow: "hidden" }}>
					<p
						style={{
							fontSize: 14,
							color: "var(--foreground-muted)",
							lineHeight: 1.65,
							paddingBottom: 18,
						}}
					>
						{item.a}
					</p>
				</div>
			</div>
		</div>
	);
}

/* ============================================================
 * FINAL CTA
 * ============================================================ */
export function FinalCta() {
	return (
		<Section id="docs" pad="80px 24px 96px">
			<div
				style={{
					border: "1px solid var(--border-subtle)",
					borderRadius: "var(--surface-radius)",
					padding: "48px 32px",
					background:
						"linear-gradient(180deg, var(--surface-low) 0%, var(--card) 100%)",
					textAlign: "center",
				}}
			>
				<Reveal>
					<Eyebrow dot color="var(--primary)">
						Build. Deploy. Automate.
					</Eyebrow>
				</Reveal>
				<Reveal delay={60}>
					<h2
						style={{
							marginTop: 14,
							fontSize: "clamp(32px, 1.8rem + 1.6vw, 48px)",
							lineHeight: 1.05,
							letterSpacing: "-0.02em",
							color: "var(--foreground)",
							maxWidth: 640,
							marginInline: "auto",
						}}
					>
						One stack you actually own.
					</h2>
				</Reveal>
				<Reveal delay={120}>
					<p
						style={{
							marginTop: 16,
							color: "var(--foreground-muted)",
							fontSize: 16,
							maxWidth: 560,
							marginInline: "auto",
							lineHeight: 1.6,
						}}
					>
						Start with Framework today. It's free, open and ready to ship. Add
						Cloud and Autopilot whenever you outgrow what you can run
						yourself.
					</p>
				</Reveal>
				<Reveal delay={180}>
					<div
						style={{
							marginTop: 28,
							display: "flex",
							gap: 10,
							justifyContent: "center",
							flexWrap: "wrap",
						}}
					>
						<a className="landing-btn landing-btn-primary" href="/docs">
							Start building
							<LIcon name="arrow-right" size={14} />
						</a>
						<a
							className="landing-btn landing-btn-secondary"
							href="https://github.com/questpie/questpie"
							target="_blank"
							rel="noreferrer"
						>
							<LIcon name="github-logo" size={14} />
							Star on GitHub
							<LIcon name="star" size={12} />
						</a>
						<a className="landing-btn landing-btn-ghost" href="#contact">
							Talk to the team
						</a>
					</div>
				</Reveal>
				<Reveal delay={220}>
					<div
						className="landing-mono"
						style={{
							marginTop: 36,
							display: "flex",
							justifyContent: "center",
							gap: 18,
							flexWrap: "wrap",
							fontSize: 11.5,
							color: "var(--foreground-subtle)",
						}}
					>
						<span>$ bun create questpie my-app</span>
						<span style={{ color: "var(--foreground-disabled)" }}>·</span>
						<span>cd my-app</span>
						<span style={{ color: "var(--foreground-disabled)" }}>·</span>
						<span>bun dev</span>
					</div>
				</Reveal>
			</div>
		</Section>
	);
}
