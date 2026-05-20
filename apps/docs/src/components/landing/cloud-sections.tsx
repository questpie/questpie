import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { Input } from "@/components/ui/input";

import { FaqSection } from "./index-sections";
import {
	Eyebrow,
	LIcon,
	Reveal,
	Section,
	SectionHeading,
} from "./primitives";
import { smoothScrollNavigate } from "./shared-nav";

const CLOUD_ACCENT = "var(--pillar-cloud)";

/* ============================================================
 * HERO
 * ============================================================ */
export function CloudHero() {
	return (
		<section
			style={{
				position: "relative",
				paddingTop: 120,
				paddingBottom: 72,
				overflow: "hidden",
			}}
		>
			<div
				className="landing-grid-bg"
				aria-hidden="true"
				style={{
					position: "absolute",
					inset: 0,
					opacity: 0.4,
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
					className="landing-cloud-hero-grid"
					style={{
						display: "grid",
						gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
						gap: 56,
						alignItems: "center",
					}}
				>
					<div>
						<Reveal>
							<span
								className="landing-eyebrow"
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 8,
									padding: "6px 10px",
									border:
										"1px solid color-mix(in srgb, var(--pillar-cloud) 28%, transparent)",
									background:
										"color-mix(in srgb, var(--pillar-cloud) 10%, transparent)",
									color: CLOUD_ACCENT,
									borderRadius: 999,
								}}
							>
								<span
									style={{
										width: 6,
										height: 6,
										borderRadius: "50%",
										background: CLOUD_ACCENT,
										boxShadow:
											"0 0 0 3px color-mix(in srgb, var(--pillar-cloud) 25%, transparent)",
									}}
								/>
								02 · Cloud · Waitlist open
							</span>
						</Reveal>

						<Reveal delay={60}>
							<h1
								style={{
									marginTop: 22,
									fontSize: "clamp(28px, 5.5vw + 14px, 52px)",
									lineHeight: 1.0,
									letterSpacing: "-0.025em",
									color: "var(--foreground)",
									fontWeight: 600,
								}}
							>
								<span style={{ display: "block" }}>Your runtime.</span>
								<span
									style={{
										display: "block",
										color: "var(--foreground-muted)",
									}}
								>
									Managed.
								</span>
								<span style={{ display: "block", color: CLOUD_ACCENT }}>
									Your data, yours.
								</span>
							</h1>
						</Reveal>

						<Reveal delay={120}>
							<p
								className="landing-balance"
								style={{
									marginTop: 22,
									fontSize: 17,
									lineHeight: 1.55,
									color: "var(--foreground-muted)",
									maxWidth: 520,
								}}
							>
								Cloud is the runtime control plane for the QUESTPIE ecosystem.
								Accounts, projects, environments, managed Postgres, custom
								domains, builds, rollouts and observability. Plus hosted{" "}
								<Link
									to="/autopilot"
									style={{ color: CLOUD_ACCENT, marginLeft: 4 }}
								>
									Autopilot
								</Link>{" "}
								for your account.
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
									className="landing-btn"
									href="#waitlist"
									onClick={(e) => smoothScrollNavigate("/cloud#waitlist", e)}
									style={{
										background: CLOUD_ACCENT,
										color: "#0a0a0a",
										fontWeight: 600,
									}}
								>
									Reserve your spot
									<LIcon name="arrow-right" size={14} />
								</a>
								<a
									className="landing-btn landing-btn-secondary"
									href="#console"
									onClick={(e) => smoothScrollNavigate("/cloud#console", e)}
								>
									See the deploy console
									<LIcon name="arrow-down" size={14} />
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
									{ k: "Deploy", v: "Health-checked" },
									{ k: "Postgres", v: "Managed + PITR" },
									{ k: "Lock-in", v: "Never" },
								].map((stat, i) => (
									<div
										key={stat.k}
										style={{
											padding: "14px 14px 14px 0",
											borderRight:
												i < 2
													? "1px solid var(--border-subtle)"
													: undefined,
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
						<CloudHeroPreview />
					</Reveal>
				</div>
			</div>

			<style>{`
				@media (max-width: 980px) {
					.landing-cloud-hero-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 40px !important; }
				}
			`}</style>
		</section>
	);
}

function CloudHeroPreview() {
	type DeployStatus = "live" | "building" | "queued";
	const deploys: Array<{
		proj: string;
		env: string;
		status: DeployStatus;
		time: string;
		build: string;
	}> = [
		{
			proj: "marketing-site",
			env: "prod",
			status: "live",
			time: "2m",
			build: "84ms p95",
		},
		{
			proj: "marketing-site",
			env: "preview/feat-pricing",
			status: "building",
			time: "0:42",
			build: "step 3/6",
		},
		{
			proj: "blog",
			env: "prod",
			status: "live",
			time: "1h",
			build: "62ms p95",
		},
		{
			proj: "internal-tools",
			env: "prod",
			status: "live",
			time: "yesterday",
			build: "ok",
		},
	];
	const dotColor = (s: DeployStatus) =>
		s === "live"
			? "var(--success)"
			: s === "building"
				? CLOUD_ACCENT
				: "var(--foreground-subtle)";
	return (
		<div
			style={{
				position: "relative",
				border: "1px solid var(--border-subtle)",
				borderRadius: "var(--surface-radius)",
				background: "var(--card)",
				overflow: "hidden",
				boxShadow: "var(--floating-shadow)",
			}}
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
							}}
						/>
					))}
				</div>
				<span
					className="landing-mono"
					style={{ fontSize: 11, color: "var(--foreground-subtle)" }}
				>
					cloud.questpie.com · deployments
				</span>
				<span
					className="landing-mono"
					style={{
						marginLeft: "auto",
						fontSize: 10,
						color: CLOUD_ACCENT,
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

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(4, minmax(0,1fr))",
					padding: "14px 16px",
					borderBottom: "1px solid var(--border-subtle)",
				}}
			>
				{[
					{ k: "Deploys / 7d", v: "127" },
					{ k: "p95 latency", v: "84ms" },
					{ k: "Uptime", v: "99.99%" },
					{ k: "Failed builds", v: "0" },
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

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 120px 70px",
					padding: "8px 16px",
					background: "var(--muted)",
					borderBottom: "1px solid var(--border-subtle)",
					fontFamily: "var(--font-mono)",
					fontSize: 10,
					letterSpacing: "0.04em",
					textTransform: "uppercase",
					color: "var(--foreground-subtle)",
					gap: 8,
				}}
			>
				<span>Project · branch</span>
				<span>Status</span>
				<span style={{ textAlign: "right" }}>Time</span>
			</div>
			{deploys.map((d, i) => (
				<div
					key={`${d.proj}-${d.env}`}
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 120px 70px",
						padding: "11px 16px",
						borderBottom:
							i === deploys.length - 1
								? "none"
								: "1px solid var(--border-subtle)",
						fontSize: 13,
						alignItems: "center",
						gap: 8,
					}}
				>
					<span
						style={{
							minWidth: 0,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						<span style={{ color: "var(--foreground)" }}>{d.proj}</span>{" "}
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
							color: dotColor(d.status),
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
								boxShadow:
									d.status === "building"
										? `0 0 0 3px color-mix(in srgb, ${dotColor(d.status)} 25%, transparent)`
										: "none",
							}}
						/>
						{d.status}
					</span>
					<span
						className="landing-mono landing-tabular"
						style={{
							fontSize: 12,
							color: "var(--foreground-muted)",
							textAlign: "right",
						}}
					>
						{d.time}
					</span>
				</div>
			))}
		</div>
	);
}

/* ============================================================
 * AUDIENCE STRIP
 * ============================================================ */
const AUDIENCE = [
	{ icon: "storefront", label: "Restaurants & cafés" },
	{ icon: "storefront", label: "Shops & e-commerce" },
	{ icon: "users", label: "Agencies & studios" },
	{ icon: "globe", label: "Real estate" },
	{ icon: "pencil", label: "Creators" },
];

export function CloudAudience() {
	return (
		<Section pad="40px 24px 24px">
			<Reveal>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 18,
						justifyContent: "center",
						flexWrap: "wrap",
					}}
				>
					<span className="landing-eyebrow" style={{ flexShrink: 0 }}>
						Made for
					</span>
					{AUDIENCE.map((a, i) => (
						<span
							key={a.label}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 18,
							}}
						>
							{i > 0 && (
								<span
									aria-hidden="true"
									style={{
										color: "var(--foreground-disabled)",
										fontSize: 10,
									}}
								>
									·
								</span>
							)}
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 8,
									fontSize: 13,
									color: "var(--foreground)",
								}}
							>
								<LIcon
									name={a.icon}
									size={13}
									style={{ color: "var(--foreground-subtle)" }}
								/>
								{a.label}
							</span>
						</span>
					))}
				</div>
			</Reveal>
		</Section>
	);
}

/* ============================================================
 * JOURNEY
 * ============================================================ */
const JOURNEY = [
	{
		n: "01",
		title: "Create a project.",
		desc: "From a starter, an existing repo, or a clone of an Autopilot template. Project = environments + resources.",
		meta: "Project starters · Coming soon",
		icon: "layout",
		metaSoon: true,
	},
	{
		n: "02",
		title: "Provision resources.",
		desc: "Managed Postgres, object storage, email and KV. Env vars and secrets attached per environment.",
		meta: "Postgres · Storage · KV",
		icon: "database",
		metaSoon: false,
	},
	{
		n: "03",
		title: "Deploy with rollback.",
		desc: "Durable build workflow. Health checks before switchover. One-click rollback if metrics regress.",
		meta: "Builds · Health checks",
		icon: "rocket",
		metaSoon: false,
	},
	{
		n: "04",
		title: "Observe & scale.",
		desc: "Logs, metrics, alerts. Hosted Autopilot runs your operating layer on the same infra.",
		meta: "Logs · Metrics · Autopilot",
		icon: "chart-bar",
		metaSoon: false,
	},
];

export function CloudJourney() {
	return (
		<Section pad="48px 24px 80px">
			<Reveal>
				<SectionHeading
					eyebrow="How it works"
					eyebrowColor={CLOUD_ACCENT}
					title="From repo to running service in four steps."
					lede="Cloud is the runtime control plane. Autopilot decides what to ship; Cloud builds, deploys and runs it. Same product, no DevOps."
					align="center"
				/>
			</Reveal>

			<div
				className="landing-journey-grid"
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
				{JOURNEY.map((s, i) => (
					<div
						key={s.n}
						className="landing-journey-cell"
						style={{
							padding: 22,
							borderRight:
								i === JOURNEY.length - 1
									? "none"
									: "1px solid var(--border-subtle)",
							position: "relative",
							display: "flex",
							flexDirection: "column",
							gap: 12,
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
							}}
						>
							<span
								className="landing-mono"
								style={{
									fontSize: 11,
									color: "var(--foreground-subtle)",
									letterSpacing: "0.05em",
								}}
							>
								STEP {s.n}
							</span>
							<LIcon
								name={s.icon}
								size={16}
								style={{ color: CLOUD_ACCENT }}
							/>
						</div>
						<h3
							style={{
								fontSize: 16,
								fontWeight: 600,
								color: "var(--foreground)",
								marginTop: 4,
							}}
						>
							{s.title}
						</h3>
						<p
							style={{
								fontSize: 13,
								color: "var(--foreground-muted)",
								lineHeight: 1.55,
								flex: 1,
							}}
						>
							{s.desc}
						</p>
						<span
							className="landing-mono"
							style={{
								fontSize: 11,
								color: s.metaSoon ? CLOUD_ACCENT : "var(--foreground-subtle)",
							}}
						>
							{s.meta}
						</span>
						{i < JOURNEY.length - 1 && (
							<span
								aria-hidden="true"
								className="landing-journey-arrow"
								style={{
									position: "absolute",
									right: -8,
									top: "50%",
									width: 16,
									height: 16,
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									background: "var(--background)",
									color: "var(--foreground-subtle)",
									borderRadius: "50%",
									border: "1px solid var(--border-subtle)",
									zIndex: 2,
									transform: "translateY(-50%)",
								}}
							>
								<LIcon name="arrow-right" size={9} />
							</span>
						)}
					</div>
				))}
			</div>

			<style>{`
				@media (max-width: 880px) {
					.landing-journey-grid { grid-template-columns: minmax(0, 1fr) !important; }
					.landing-journey-cell { border-right: none !important; border-bottom: 1px solid var(--border-subtle); }
					.landing-journey-cell:last-child { border-bottom: none; }
					.landing-journey-arrow { display: none !important; }
				}
			`}</style>
		</Section>
	);
}

/* ============================================================
 * DEPLOY CONSOLE
 * ============================================================ */
const PIPELINE_STAGES = [
	{
		name: "clone",
		status: "done",
		t: "00.4s",
		note: "git@github.com/acme/marketing",
	},
	{
		name: "install",
		status: "done",
		t: "08.2s",
		note: "bun install · 412 packages",
	},
	{
		name: "migrate",
		status: "done",
		t: "01.1s",
		note: "drizzle · 2 new migrations",
	},
	{
		name: "build",
		status: "done",
		t: "14.6s",
		note: "vite + tsdown · 12 outputs",
	},
	{
		name: "test",
		status: "done",
		t: "06.0s",
		note: "238 passed · 0 failed",
	},
	{
		name: "deploy",
		status: "running",
		t: "·",
		note: "rolling new image to fleet",
	},
	{
		name: "health-check",
		status: "queued",
		t: "·",
		note: "p95 < 200ms for 60s",
	},
] as const;

const BUILD_LOG = [
	{ c: "var(--foreground-subtle)", t: "$ bunx questpie deploy --env prod" },
	{
		c: "var(--foreground-muted)",
		t: "→ resolved project marketing-site (gen 482)",
	},
	{ c: "var(--foreground)", t: "→ stage clone · ok 00.4s" },
	{ c: "var(--foreground)", t: "→ stage install · ok 08.2s" },
	{ c: "var(--foreground)", t: "→ stage migrate · ok 01.1s" },
	{ c: "var(--foreground)", t: "→ stage build · ok 14.6s" },
	{ c: "var(--foreground)", t: "→ stage test · 238 / 0 / 0" },
	{ c: CLOUD_ACCENT, t: "→ stage deploy · streaming…" },
	{ c: "var(--foreground-muted)", t: "   image: sha256:9f3a..2d18" },
	{ c: "var(--foreground-muted)", t: "   replicas: 3 → 3 (rolling)" },
	{ c: "var(--foreground-subtle)", t: "" },
];

export function DeployConsole() {
	return (
		<Section id="console" pad="64px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="The deploy console"
					eyebrowColor={CLOUD_ACCENT}
					title="Builds you can read. Deploys you can roll back."
					lede="Every deploy is a durable workflow with named stages. Stream the log live, see what failed, redeploy or roll back in one click. Same pipeline whether you push from git or Autopilot triggers it for you."
				/>
			</Reveal>

			<Reveal>
				<div
					className="landing-console-grid"
					style={{
						border: "1px solid var(--border-subtle)",
						borderRadius: "var(--surface-radius)",
						background: "var(--card)",
						overflow: "hidden",
						display: "grid",
						gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							borderRight: "1px solid var(--border-subtle)",
							background: "#0a0a0a",
							minHeight: 480,
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 10,
								padding: "10px 14px",
								borderBottom: "1px solid #1f1f1f",
								background: "#0f0f0f",
							}}
						>
							<LIcon
								name="terminal"
								size={14}
								style={{ color: CLOUD_ACCENT }}
							/>
							<span
								className="landing-mono"
								style={{ fontSize: 11.5, color: "#a0a0a0" }}
							>
								marketing-site / prod · build #482
							</span>
							<span
								className="landing-mono"
								style={{
									marginLeft: "auto",
									fontSize: 10,
									color: CLOUD_ACCENT,
									border:
										"1px solid color-mix(in srgb, var(--pillar-cloud) 30%, transparent)",
									background:
										"color-mix(in srgb, var(--pillar-cloud) 8%, transparent)",
									padding: "2px 8px",
									borderRadius: 6,
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
										background: CLOUD_ACCENT,
										boxShadow: `0 0 0 3px color-mix(in srgb, ${CLOUD_ACCENT} 25%, transparent)`,
									}}
								/>
								live
							</span>
						</div>
						<pre
							className="landing-thin-scroll"
							style={{
								flex: 1,
								margin: 0,
								padding: "16px 18px",
								fontFamily: "var(--font-mono)",
								fontSize: 12.5,
								lineHeight: 1.7,
								color: "#d0d0d0",
								overflow: "auto",
							}}
						>
							{BUILD_LOG.map((l, i) => (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: stable
									key={i}
									style={{ color: l.c }}
								>
									{l.t || " "}
								</div>
							))}
							<span
								style={{
									color: CLOUD_ACCENT,
									animation: "landing-blink 1s steps(1) infinite",
								}}
							>
								▍
							</span>
						</pre>
						<style>{`@keyframes landing-blink { 50% { opacity: 0; } }`}</style>
					</div>

					<div
						style={{
							display: "flex",
							flexDirection: "column",
							background: "var(--card)",
						}}
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
								name="tree-structure"
								size={13}
								style={{ color: CLOUD_ACCENT }}
							/>
							<span
								className="landing-mono"
								style={{
									fontSize: 11,
									color: "var(--foreground-subtle)",
								}}
							>
								pipeline · 7 stages
							</span>
							<span
								className="landing-mono"
								style={{
									marginLeft: "auto",
									fontSize: 11,
									color: "var(--foreground-subtle)",
								}}
							>
								30.3s
							</span>
						</div>
						<div style={{ padding: 14 }}>
							{PIPELINE_STAGES.map((stg, i) => {
								const c =
									stg.status === "done"
										? "var(--success)"
										: stg.status === "running"
											? CLOUD_ACCENT
											: "var(--foreground-subtle)";
								return (
									<div
										key={stg.name}
										style={{
											display: "grid",
											gridTemplateColumns: "14px 1fr 60px",
											gap: 12,
											padding: "10px 0",
											borderTop:
												i === 0
													? "none"
													: "1px dashed var(--border-subtle)",
											alignItems: "center",
										}}
									>
										<span
											style={{
												width: 10,
												height: 10,
												borderRadius: "50%",
												background: c,
												boxShadow:
													stg.status === "running"
														? `0 0 0 4px color-mix(in srgb, ${c} 22%, transparent)`
														: "none",
											}}
										/>
										<div style={{ minWidth: 0 }}>
											<div
												style={{
													fontFamily: "var(--font-mono)",
													fontSize: 12.5,
													color:
														stg.status === "queued"
															? "var(--foreground-subtle)"
															: "var(--foreground)",
												}}
											>
												stage.{stg.name}
											</div>
											<div
												style={{
													fontSize: 11.5,
													color: "var(--foreground-muted)",
													marginTop: 1,
												}}
											>
												{stg.note}
											</div>
										</div>
										<span
											className="landing-mono landing-tabular"
											style={{
												fontSize: 11,
												color: "var(--foreground-subtle)",
												textAlign: "right",
											}}
										>
											{stg.t}
										</span>
									</div>
								);
							})}
						</div>
						<div
							style={{
								padding: "10px 14px",
								borderTop: "1px solid var(--border-subtle)",
								background: "var(--surface-low)",
								display: "flex",
								gap: 6,
								justifyContent: "flex-end",
							}}
						>
							<span
								className="landing-btn landing-btn-secondary landing-btn-sm"
								style={{ pointerEvents: "none" }}
							>
								<LIcon name="arrow-down" size={12} />
								Rollback
							</span>
							<span
								className="landing-btn landing-btn-secondary landing-btn-sm"
								style={{ pointerEvents: "none" }}
							>
								Redeploy
							</span>
						</div>
					</div>
				</div>
			</Reveal>

			<Reveal delay={80}>
				<div
					className="landing-console-foot"
					style={{
						marginTop: 18,
						display: "grid",
						gridTemplateColumns: "repeat(3, minmax(0,1fr))",
						gap: 14,
					}}
				>
					{[
						{
							icon: "git-branch",
							title: "Preview deploys per branch",
							desc: "Every PR gets a stable URL. Build cache reused across deploys.",
						},
						{
							icon: "shield",
							title: "Atomic rollouts + rollback",
							desc: "Switchover after health checks pass. Reverse in one command.",
						},
						{
							icon: "code",
							title: "From git or from Autopilot",
							desc: "Same pipeline whether a human pushed or an Autopilot workflow triggered it.",
						},
					].map((f) => (
						<div
							key={f.title}
							style={{
								padding: 16,
								border: "1px solid var(--border-subtle)",
								borderRadius: "var(--control-radius)",
								background: "var(--card)",
							}}
						>
							<LIcon
								name={f.icon}
								size={15}
								style={{ color: CLOUD_ACCENT, marginBottom: 10 }}
							/>
							<div
								style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}
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
					))}
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 980px) {
					.landing-console-grid { grid-template-columns: minmax(0, 1fr) !important; }
					.landing-console-grid > div:first-child { border-right: none !important; border-bottom: 1px solid var(--border-subtle); }
					.landing-console-foot { grid-template-columns: minmax(0, 1fr) !important; }
				}
			`}</style>
		</Section>
	);
}

/* ============================================================
 * TEMPLATES
 * ============================================================ */
const TEMPLATES = [
	{ name: "Café Roastery", cat: "Restaurants", color: "#d97757" },
	{ name: "Bistro Classic", cat: "Restaurants", color: "#c08552" },
	{ name: "Salon & Spa", cat: "Beauty", color: "#b07ab9" },
	{ name: "Barber Shop", cat: "Beauty", color: "#7c8de8" },
	{ name: "Clothing Store", cat: "E-commerce", color: "#5fa8d3" },
	{ name: "Specialty Goods", cat: "E-commerce", color: "#6f9e7d" },
	{ name: "Real Estate Pro", cat: "Real estate", color: "#a8a8a8" },
	{ name: "Property Lite", cat: "Real estate", color: "#8b8b8b" },
	{ name: "Studio Portfolio", cat: "Portfolios", color: "#e3a96b" },
	{ name: "Freelancer Site", cat: "Portfolios", color: "#d4b483" },
	{ name: "Agency Pro", cat: "Agencies", color: "#7b88a8" },
	{ name: "Local Service", cat: "Service", color: "#9b8aa8" },
];

export function TemplatesSection() {
	return (
		<Section id="templates" pad="64px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Project starters"
					eyebrowColor={CLOUD_ACCENT}
					title="Start from a working project, not a blank repo."
					lede="Industry starters ship with schema, admin, sample content and an Autopilot brief tuned for that domain. Clone, deploy, customize. Coming alongside Cloud."
				/>
			</Reveal>

			<Reveal>
				<div
					className="landing-templates-grid"
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(4, minmax(0,1fr))",
						gap: 14,
					}}
				>
					{TEMPLATES.map((t) => (
						<TemplateCard key={t.name} t={t} />
					))}
				</div>
			</Reveal>

			<Reveal delay={80}>
				<div
					style={{
						marginTop: 28,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						gap: 14,
						padding: "16px 20px",
						border: "1px dashed var(--border)",
						background: "var(--surface-low)",
						borderRadius: "var(--surface-radius)",
					}}
				>
					<LIcon name="lightning" size={16} style={{ color: CLOUD_ACCENT }} />
					<span style={{ fontSize: 13.5, color: "var(--foreground)" }}>
						Want a template for your industry?
					</span>
					<a
						href="#waitlist"
						onClick={(e) => smoothScrollNavigate("/cloud#waitlist", e)}
						style={{
							fontSize: 13,
							color: CLOUD_ACCENT,
							fontWeight: 500,
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						Tell us what you need
						<LIcon name="arrow-right" size={12} />
					</a>
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 980px) { .landing-templates-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; } }
				@media (max-width: 720px) { .landing-templates-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
				@media (max-width: 460px) { .landing-templates-grid { grid-template-columns: minmax(0, 1fr) !important; } }
			`}</style>
		</Section>
	);
}

function TemplateCard({ t }: { t: (typeof TEMPLATES)[number] }) {
	return (
		<div
			style={{
				border: "1px solid var(--border-subtle)",
				background: "var(--card)",
				borderRadius: "var(--surface-radius)",
				overflow: "hidden",
				position: "relative",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<div
				aria-hidden="true"
				style={{
					height: 140,
					position: "relative",
					background: `linear-gradient(135deg, ${t.color}22, ${t.color}06)`,
					borderBottom: "1px solid var(--border-subtle)",
				}}
			>
				<div
					style={{
						position: "absolute",
						inset: 14,
						border:
							"1px dashed color-mix(in srgb, var(--foreground) 18%, transparent)",
						borderRadius: 6,
						background:
							"repeating-linear-gradient(135deg, color-mix(in srgb, var(--foreground) 4%, transparent) 0 8px, transparent 8px 16px)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<span
						className="landing-mono"
						style={{
							fontSize: 10,
							color: "var(--foreground-subtle)",
							letterSpacing: "0.05em",
							textTransform: "uppercase",
						}}
					>
						Preview placeholder
					</span>
				</div>
				<div
					style={{
						position: "absolute",
						top: 10,
						left: 10,
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						padding: "3px 8px",
						borderRadius: 4,
						background: "var(--background)",
						border: "1px solid var(--border-subtle)",
						fontSize: 10,
						color: "var(--foreground-muted)",
						fontFamily: "var(--font-mono)",
						letterSpacing: "0.04em",
						textTransform: "uppercase",
					}}
				>
					<span
						style={{
							width: 6,
							height: 6,
							borderRadius: 2,
							background: t.color,
						}}
					/>
					{t.cat}
				</div>
			</div>
			<div
				style={{
					padding: 14,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
				}}
			>
				<span
					style={{ fontSize: 14, color: "var(--foreground)", fontWeight: 500 }}
				>
					{t.name}
				</span>
				<span
					className="landing-mono"
					style={{
						fontSize: 10,
						padding: "3px 7px",
						borderRadius: 4,
						color: CLOUD_ACCENT,
						background: "color-mix(in srgb, var(--pillar-cloud) 10%, transparent)",
						border:
							"1px solid color-mix(in srgb, var(--pillar-cloud) 28%, transparent)",
						letterSpacing: "0.04em",
						textTransform: "uppercase",
						whiteSpace: "nowrap",
					}}
				>
					Coming soon
				</span>
			</div>
		</div>
	);
}

/* ============================================================
 * MANAGED INFRA MATRIX
 * ============================================================ */
const INFRA_ROWS: Array<
	[string, string, boolean, boolean, string]
> = [
	[
		"Hosting & deploys",
		"globe",
		false,
		true,
		"Health-checked deploys with rollback",
	],
	[
		"PostgreSQL",
		"database",
		false,
		true,
		"Provisioned, scaled, backed up daily",
	],
	[
		"Object storage",
		"database",
		false,
		true,
		"S3-compatible, served via CDN",
	],
	[
		"Custom domains + SSL",
		"globe",
		false,
		true,
		"DNS records and certs auto-managed",
	],
	[
		"Email sending",
		"chat-circle",
		false,
		true,
		"Transactional mail, deliverability tuned",
	],
	["Backups + restore", "shield", false, true, "PITR up to 30 days"],
	[
		"Monitoring",
		"chart-bar",
		false,
		true,
		"p95, errors, alerts in dashboard",
	],
	[
		"Autopilot agents",
		"robot",
		false,
		true,
		"Hosted runtime, auto-scaled",
	],
	[
		"Your code & schema",
		"code",
		true,
		false,
		"Stays in your git, exportable anytime",
	],
	["Your data", "lock", true, false, "Exportable as SQL dump on demand"],
];

export function ManagedInfra() {
	return (
		<Section pad="64px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Managed infrastructure"
					eyebrowColor={CLOUD_ACCENT}
					title="What you ship vs. what we run."
					lede="The boring half of running a product, fully delegated. Your code and data stay yours."
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
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "minmax(0, 1fr) 92px 92px",
							padding: "12px 18px",
							borderBottom: "1px solid var(--border-subtle)",
							background: "var(--muted)",
							fontFamily: "var(--font-mono)",
							fontSize: 10.5,
							letterSpacing: "0.05em",
							textTransform: "uppercase",
							color: "var(--foreground-subtle)",
						}}
					>
						<span>Component</span>
						<span style={{ textAlign: "center" }}>You</span>
						<span style={{ textAlign: "center" }}>Cloud</span>
					</div>
					{INFRA_ROWS.map(([name, icon, mine, theirs, note], i) => (
						<div
							key={name}
							style={{
								display: "grid",
								gridTemplateColumns: "minmax(0, 1fr) 92px 92px",
								padding: "14px 18px",
								borderBottom:
									i === INFRA_ROWS.length - 1
										? "none"
										: "1px solid var(--border-subtle)",
								alignItems: "center",
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 12,
									minWidth: 0,
								}}
							>
								<LIcon
									name={icon}
									size={15}
									style={{
										color: theirs
											? CLOUD_ACCENT
											: "var(--foreground-muted)",
										flexShrink: 0,
									}}
								/>
								<div style={{ minWidth: 0 }}>
									<div
										style={{ fontSize: 14, color: "var(--foreground)" }}
									>
										{name}
									</div>
									<div
										style={{
											fontSize: 12,
											color: "var(--foreground-muted)",
											marginTop: 1,
										}}
									>
										{note}
									</div>
								</div>
							</div>
							<CellMark on={mine} tone="foreground" />
							<CellMark on={theirs} tone="cloud" />
						</div>
					))}
				</div>
			</Reveal>
		</Section>
	);
}

function CellMark({
	on,
	tone,
}: {
	on: boolean;
	tone: "foreground" | "cloud";
}) {
	const color = tone === "cloud" ? CLOUD_ACCENT : "var(--foreground)";
	return (
		<span style={{ display: "flex", justifyContent: "center" }}>
			{on ? (
				<span
					style={{
						width: 22,
						height: 22,
						borderRadius: 6,
						background: `color-mix(in srgb, ${color} 14%, transparent)`,
						color,
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
					}}
				>
					<LIcon name="check" size={12} />
				</span>
			) : (
				<span
					style={{
						width: 22,
						height: 22,
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						color: "var(--foreground-disabled)",
						fontFamily: "var(--font-mono)",
						fontSize: 14,
					}}
				>
					·
				</span>
			)}
		</span>
	);
}

/* ============================================================
 * HOSTED AUTOPILOT
 * ============================================================ */
export function HostedAutopilotSection() {
	return (
		<Section id="hosted-autopilot" pad="56px 24px 40px">
			<Reveal>
				<div
					className="landing-hosted-grid"
					style={{
						border: "1px solid var(--border-subtle)",
						background: "var(--card)",
						borderRadius: "var(--surface-radius)",
						overflow: "hidden",
						display: "grid",
						gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)",
					}}
				>
					<div
						style={{
							padding: 28,
							display: "flex",
							flexDirection: "column",
							gap: 14,
						}}
					>
						<span
							className="landing-eyebrow"
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 8,
								color: CLOUD_ACCENT,
								width: "fit-content",
							}}
						>
							<span
								style={{
									width: 6,
									height: 6,
									borderRadius: 2,
									background: CLOUD_ACCENT,
								}}
							/>
							Cloud ↔ Autopilot
						</span>
						<h3
							style={{
								fontSize: "clamp(22px, 1.4rem + 0.6vw, 30px)",
								color: "var(--foreground)",
								fontWeight: 600,
								lineHeight: 1.1,
							}}
						>
							Cloud also hosts your Autopilot.
						</h3>
						<p
							className="landing-balance"
							style={{
								color: "var(--foreground-muted)",
								fontSize: 14.5,
								lineHeight: 1.6,
								maxWidth: 460,
							}}
						>
							When you log into Cloud you get a managed Autopilot installation
							for the whole account. Your Cloud projects map to Autopilot
							projects. Autopilot deploys through Cloud APIs. No Kubernetes, no
							glue code.
						</p>
						<div
							style={{
								marginTop: 4,
								display: "flex",
								gap: 8,
								flexWrap: "wrap",
							}}
						>
							<Link
								className="landing-btn landing-btn-secondary landing-btn-sm"
								to="/autopilot"
							>
								See Autopilot
								<LIcon name="arrow-right" size={12} />
							</Link>
							<a
								className="landing-btn landing-btn-ghost landing-btn-sm"
								href="/#stack"
								onClick={(e) => smoothScrollNavigate("/#stack", e)}
							>
								Architecture
							</a>
						</div>
					</div>

					<div
						style={{
							padding: 22,
							background: "var(--surface-low)",
							borderLeft: "1px solid var(--border-subtle)",
							display: "flex",
							flexDirection: "column",
							gap: 12,
						}}
					>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "1fr 36px 1fr",
								gap: 10,
								alignItems: "center",
							}}
						>
							<div
								style={{
									border: "1px solid var(--border-subtle)",
									background: "var(--card)",
									borderRadius: "var(--control-radius)",
									padding: 12,
								}}
							>
								<div
									className="landing-eyebrow"
									style={{ color: CLOUD_ACCENT }}
								>
									Cloud account
								</div>
								<div
									style={{ marginTop: 4, fontSize: 13, fontWeight: 500 }}
								>
									acme.questpie.cloud
								</div>
								<div
									className="landing-mono"
									style={{
										marginTop: 8,
										fontSize: 11,
										color: "var(--foreground-muted)",
										lineHeight: 1.7,
									}}
								>
									• project: marketing-site
									<br />
									• project: blog
									<br />• project: internal-tools
								</div>
							</div>
							<div
								style={{
									textAlign: "center",
									color: "var(--foreground-subtle)",
								}}
							>
								<LIcon name="arrow-right" size={22} />
							</div>
							<div
								style={{
									border:
										"1px solid color-mix(in srgb, var(--pillar-autopilot) 32%, transparent)",
									background:
										"color-mix(in srgb, var(--pillar-autopilot) 6%, var(--card))",
									borderRadius: "var(--control-radius)",
									padding: 12,
								}}
							>
								<div
									className="landing-eyebrow"
									style={{ color: "var(--pillar-autopilot)" }}
								>
									Managed Autopilot
								</div>
								<div
									style={{ marginTop: 4, fontSize: 13, fontWeight: 500 }}
								>
									acme.autopilot
								</div>
								<div
									className="landing-mono"
									style={{
										marginTop: 8,
										fontSize: 11,
										color: "var(--foreground-muted)",
										lineHeight: 1.7,
									}}
								>
									• mapped: marketing-site
									<br />
									• mapped: blog
									<br />• mapped: internal-tools
								</div>
							</div>
						</div>

						<div
							style={{
								marginTop: 6,
								padding: "10px 14px",
								background: "var(--card)",
								border: "1px solid var(--border-subtle)",
								borderRadius: "var(--control-radius)",
								fontFamily: "var(--font-mono)",
								fontSize: 11.5,
								color: "var(--foreground-muted)",
								lineHeight: 1.7,
							}}
						>
							<span style={{ color: "var(--pillar-autopilot)" }}>
								autopilot
							</span>
							.deploy(
							<span style={{ color: "var(--syntax-string)" }}>
								"marketing-site"
							</span>
							) →<br />
							<span style={{ color: CLOUD_ACCENT }}>cloud</span>.projects.
							<span style={{ color: "var(--syntax-function)" }}>build</span>(...).
							<span style={{ color: "var(--syntax-function)" }}>deploy</span>(env:{" "}
							<span style={{ color: "var(--syntax-string)" }}>"prod"</span>)
						</div>
						<div style={{ fontSize: 11.5, color: "var(--foreground-subtle)" }}>
							Autopilot doesn't bypass Cloud. It calls Cloud APIs for build,
							env, domain, rollout. Cloud stays the deployment source of truth.
						</div>
					</div>
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 900px) {
					.landing-hosted-grid { grid-template-columns: minmax(0, 1fr) !important; }
					.landing-hosted-grid > div:nth-child(2) { border-left: none !important; border-top: 1px solid var(--border-subtle); }
				}
			`}</style>
		</Section>
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

const CLOUD_TIERS: Tier[] = [
	{
		name: "Free",
		price: "$0",
		period: "evaluate",
		description: "Side projects and trying things out.",
		cta: { label: "Start free", href: "#waitlist", tone: "secondary" },
		features: [
			["1 project, shared resources", true],
			["questpie.app subdomain", true],
			["Hosted Autopilot · sandbox", true],
			["Community support", true],
			["Custom domain", false],
			["Production-grade Postgres", false],
			["Multi-environment", false],
			["SSO + audit log", false],
		],
	},
	{
		name: "Starter",
		price: "$19",
		period: "/ month",
		description: "Ship one site with a custom domain.",
		cta: { label: "Join waitlist", href: "#waitlist", tone: "secondary" },
		features: [
			["1 project, 1 environment", true],
			["Custom domain + SSL", true],
			["5 GB storage · 100 GB BW", true],
			["Production Postgres + PITR", true],
			["Hosted Autopilot · 2 agents", true],
			["Email + community support", true],
			["Multi-environment", false],
			["SSO + audit log", false],
		],
	},
	{
		name: "Pro",
		price: "$49",
		period: "/ month",
		description: "Teams shipping multiple sites and automating ops.",
		highlighted: true,
		cta: { label: "Join waitlist", href: "#waitlist", tone: "primary" },
		features: [
			["10 projects, multi-env", true],
			["50 GB storage · 1 TB BW", true],
			["Preview deploys per branch", true],
			["Hosted Autopilot · unlimited", true],
			["Knowledge base + workflows", true],
			["Team roles + API keys", true],
			["Priority support", true],
			["SSO + audit log", false],
		],
	},
	{
		name: "Scale",
		price: "Custom",
		period: "SLA",
		description: "Compliance, dedicated capacity, custom contract.",
		cta: { label: "Talk to us", href: "#contact", tone: "secondary" },
		features: [
			["Unlimited projects + envs", true],
			["Dedicated database & VPC", true],
			["Custom Autopilot configs", true],
			["99.99% uptime SLA", true],
			["SSO + audit log", true],
			["Data residency", true],
			["Solution engineering", true],
			["Volume discount", true],
		],
	},
];

export function CloudPricing() {
	return (
		<Section id="pricing" pad="64px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Pricing"
					eyebrowColor={CLOUD_ACCENT}
					title="Pay for the parts you don't want to run."
					lede="Framework + Autopilot are free open source. Cloud only charges for the managed half: hosting, infrastructure, and team features."
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
				{CLOUD_TIERS.map((t) => (
					<Reveal key={t.name}>
						<CloudTierCard tier={t} />
					</Reveal>
				))}
			</div>
		</Section>
	);
}

function CloudTierCard({ tier }: { tier: Tier }) {
	const accent = CLOUD_ACCENT;
	const highlightBg = tier.highlighted
		? `color-mix(in srgb, ${accent} 4%, var(--card))`
		: "var(--card)";
	const highlightBorder = tier.highlighted
		? `color-mix(in srgb, ${accent} 50%, transparent)`
		: "var(--border-subtle)";
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				padding: 20,
				border: `1px solid ${highlightBorder}`,
				background: highlightBg,
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
						background: accent,
						color: "#0a0a0a",
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
				onClick={(e) => smoothScrollNavigate(`/cloud${tier.cta.href}`, e)}
				className="landing-btn landing-btn-sm"
				style={{
					width: "100%",
					marginBottom: 18,
					background: tier.cta.tone === "primary" ? accent : "var(--card)",
					color:
						tier.cta.tone === "primary" ? "#0a0a0a" : "var(--foreground)",
					border:
						tier.cta.tone === "primary"
							? "none"
							: "1px solid var(--border-subtle)",
					fontWeight: tier.cta.tone === "primary" ? 600 : 500,
				}}
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
 * MIGRATION
 * ============================================================ */
export function MigrationSection() {
	return (
		<Section pad="40px 24px 96px">
			<Reveal>
				<div
					className="landing-migration-grid"
					style={{
						border: "1px solid var(--border-subtle)",
						background: "var(--card)",
						borderRadius: "var(--surface-radius)",
						padding: 28,
						display: "grid",
						gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)",
						gap: 36,
						alignItems: "center",
					}}
				>
					<div>
						<Eyebrow dot color={CLOUD_ACCENT}>
							No lock-in
						</Eyebrow>
						<h3
							style={{
								marginTop: 12,
								fontSize: "clamp(22px, 1.4rem + 0.6vw, 28px)",
								color: "var(--foreground)",
								fontWeight: 600,
								lineHeight: 1.15,
							}}
						>
							Self-host today. Move to Cloud later. Or back.
						</h3>
						<p
							className="landing-balance"
							style={{
								marginTop: 12,
								color: "var(--foreground-muted)",
								fontSize: 14,
								lineHeight: 1.6,
							}}
						>
							Cloud is just QUESTPIE code plus a Postgres database. No
							proprietary runtime, no walled garden. Migrate in either
							direction with two commands. Your project is your project.
						</p>
						<div
							style={{
								marginTop: 16,
								display: "flex",
								gap: 8,
								flexWrap: "wrap",
							}}
						>
							<a
								className="landing-btn landing-btn-secondary landing-btn-sm"
								href="https://github.com/questpie/questpie"
								target="_blank"
								rel="noreferrer"
							>
								<LIcon name="github-logo" size={13} />
								Read the source
							</a>
							<a
								className="landing-btn landing-btn-ghost landing-btn-sm"
								href="/docs"
							>
								Self-host guide
								<LIcon name="arrow-right" size={12} />
							</a>
						</div>
					</div>

					<div
						style={{
							background: "var(--background)",
							border: "1px solid var(--border-subtle)",
							borderRadius: "var(--control-radius)",
							padding: 16,
							fontFamily: "var(--font-mono)",
							fontSize: 12.5,
							lineHeight: 1.8,
							color: "var(--foreground-muted)",
							overflowX: "auto",
						}}
					>
						<div
							style={{ color: "var(--foreground-subtle)" }}
						>{`# Pull a Cloud project to local`}</div>
						<div>
							<span style={{ color: "var(--syntax-keyword)" }}>$</span> bunx
							questpie pull{" "}
							<span style={{ color: "var(--syntax-string)" }}>my-project</span>
						</div>
						<div
							style={{ marginTop: 14, color: "var(--foreground-subtle)" }}
						>
							{`# Or push your local project to Cloud`}
						</div>
						<div>
							<span style={{ color: "var(--syntax-keyword)" }}>$</span> bunx
							questpie deploy{" "}
							<span style={{ color: "var(--syntax-keyword)" }}>--cloud</span>
						</div>
					</div>
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 880px) { .landing-migration-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 24px !important; } }
			`}</style>
		</Section>
	);
}

/* ============================================================
 * FAQ + FINAL CTA
 * ============================================================ */
const CLOUD_FAQ = [
	{
		q: "What does Cloud actually do?",
		a: "Cloud is the runtime control plane for QUESTPIE. It owns accounts, projects, environments, managed Postgres, object storage, custom domains, builds, rollouts and observability. If it's infrastructure for running your apps, it's Cloud.",
	},
	{
		q: "Where does the AI builder live?",
		a: "Inside Autopilot. Autopilot edits your apps and content, Cloud builds and deploys them. When you use hosted Autopilot inside Cloud, the two are stitched together. Autopilot triggers Cloud deploys through Cloud's APIs.",
	},
	{
		q: "What is hosted Autopilot in Cloud?",
		a: "When you log into Cloud you get a managed Autopilot installation for the whole account. Your Cloud projects map to Autopilot projects. The AI builder, agents, workflows and knowledge all run there. You can still self-host Autopilot separately if you prefer.",
	},
	{
		q: "Can I bring my own domain?",
		a: "Yes, from the Starter plan onwards. Point your DNS to QUESTPIE, we provision an SSL certificate automatically, and traffic is served via CDN. Free plans use a questpie.app subdomain.",
	},
	{
		q: "Where is my data hosted?",
		a: "EU-West and US-East at launch. Scale plans can request specific data residency. All projects run on managed PostgreSQL with point-in-time recovery up to 30 days.",
	},
	{
		q: "Can I move back to self-hosting?",
		a: "Yes, anytime. Cloud is just QUESTPIE code plus a Postgres dump. Run `bunx questpie pull` to get everything locally and deploy with the Hono / Elysia / Next / TanStack adapter of your choice. No proprietary runtime.",
	},
	{
		q: "Will project starters be available?",
		a: "Yes. Coming alongside Cloud. Each starter ships with a working QUESTPIE schema, admin, sample content and an Autopilot brief tuned for the domain. You can request a starter for your industry on the waitlist.",
	},
];

export function CloudFAQ() {
	return <FaqSection items={CLOUD_FAQ} />;
}

export function CloudFinalCta() {
	const [email, setEmail] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!email) return;
		setSubmitted(true);
	};

	return (
		<Section id="waitlist" pad="80px 24px 96px">
			<div
				style={{
					border: "1px solid var(--border-subtle)",
					borderRadius: "var(--surface-radius)",
					padding: "48px 32px",
					background:
						"linear-gradient(180deg, color-mix(in srgb, var(--pillar-cloud) 6%, var(--surface-low)) 0%, var(--card) 100%)",
					textAlign: "center",
					position: "relative",
					overflow: "hidden",
				}}
			>
				<div
					aria-hidden="true"
					style={{
						position: "absolute",
						top: -80,
						left: "50%",
						transform: "translateX(-50%)",
						width: 480,
						height: 200,
						background:
							"radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--pillar-cloud) 18%, transparent) 0%, transparent 70%)",
						pointerEvents: "none",
					}}
				/>
				<Reveal>
					<Eyebrow dot color={CLOUD_ACCENT}>
						Coming Q3 2026
					</Eyebrow>
				</Reveal>
				<Reveal delay={60}>
					<h2
						className="landing-balance"
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
						Be first on QUESTPIE Cloud.
					</h2>
				</Reveal>
				<Reveal delay={120}>
					<p
						className="landing-balance"
						style={{
							marginTop: 16,
							color: "var(--foreground-muted)",
							fontSize: 16,
							maxWidth: 520,
							marginInline: "auto",
							lineHeight: 1.6,
						}}
					>
						Join the waitlist. We'll email you when your environment is ready,
						with priority for early adopters. No spam, ever.
					</p>
				</Reveal>
				<Reveal delay={180}>
					<div
						style={{
							marginTop: 28,
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
						}}
					>
						{submitted ? (
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 8,
									padding: "10px 16px",
									border: `1px solid ${CLOUD_ACCENT}`,
									borderRadius: "var(--control-radius)",
									color: CLOUD_ACCENT,
									fontSize: 14,
									background:
										"color-mix(in srgb, var(--pillar-cloud) 10%, transparent)",
								}}
							>
								<LIcon name="check" size={14} />
								You're on the list. We'll be in touch.
							</span>
						) : (
							<form
								onSubmit={submit}
								className="landing-waitlist-form"
								style={{ display: "flex", gap: 8 }}
							>
								<Input
									type="email"
									required
									placeholder="you@company.com"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									className="h-11"
									style={{ minWidth: 280 }}
								/>
								<button
									type="submit"
									className="landing-btn"
									style={{
										height: 44,
										background: CLOUD_ACCENT,
										color: "#0a0a0a",
										fontWeight: 600,
									}}
								>
									Reserve your spot
									<LIcon name="arrow-right" size={14} />
								</button>
							</form>
						)}
					</div>
				</Reveal>
				<Reveal delay={240}>
					<div
						className="landing-mono"
						style={{
							marginTop: 32,
							display: "flex",
							justifyContent: "center",
							gap: 18,
							flexWrap: "wrap",
							fontSize: 11.5,
							color: "var(--foreground-subtle)",
						}}
					>
						<span>Framework available today</span>
						<span style={{ color: "var(--foreground-disabled)" }}>·</span>
						<span>$ bun create questpie my-app</span>
						<span style={{ color: "var(--foreground-disabled)" }}>·</span>
						<a href="/docs" style={{ color: CLOUD_ACCENT }}>
							Read the docs ↗
						</a>
					</div>
				</Reveal>
			</div>
		</Section>
	);
}
