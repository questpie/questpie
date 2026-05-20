import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { FaqSection } from "./index-sections";
import {
	CM,
	type CodeLine,
	CodeBlock,
	Eyebrow,
	FN,
	KW,
	LIcon,
	Reveal,
	STR,
	Section,
	SectionHeading,
} from "./primitives";
import { smoothScrollNavigate } from "./shared-nav";

const AP_ACCENT = "var(--pillar-autopilot)";

/* ============================================================
 * HERO
 * ============================================================ */
export function APHero() {
	return (
		<section
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
					className="landing-ap-hero-grid"
					style={{
						display: "grid",
						gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.05fr)",
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
										"1px solid color-mix(in srgb, var(--pillar-autopilot) 28%, transparent)",
									background:
										"color-mix(in srgb, var(--pillar-autopilot) 10%, transparent)",
									color: AP_ACCENT,
									borderRadius: 999,
								}}
							>
								<span
									style={{
										width: 6,
										height: 6,
										borderRadius: "50%",
										background: AP_ACCENT,
										boxShadow:
											"0 0 0 3px color-mix(in srgb, var(--pillar-autopilot) 25%, transparent)",
									}}
								/>
								03 · Autopilot · Early access
							</span>
						</Reveal>

						<Reveal delay={60}>
							<h1
								style={{
									marginTop: 22,
									fontSize: "clamp(38px, 2.4rem + 1.6vw, 52px)",
									lineHeight: 1.0,
									letterSpacing: "-0.025em",
									color: "var(--foreground)",
									fontWeight: 600,
								}}
							>
								<span style={{ display: "block" }}>Run your company.</span>
								<span
									style={{
										display: "block",
										color: "var(--foreground-muted)",
									}}
								>
									Build your apps.
								</span>
								<span style={{ display: "block", color: AP_ACCENT }}>
									Automate the rest.
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
									maxWidth: 540,
								}}
							>
								Autopilot is the AI-native operating layer for QUESTPIE. Think
								Linear for work, Lovable for app building, Zapier for
								automation. On one open source stack. Self-host, or run hosted
								on{" "}
								<Link to="/cloud" style={{ color: AP_ACCENT }}>
									Cloud
								</Link>
								.
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
									onClick={(e) =>
										smoothScrollNavigate("/autopilot#waitlist", e)
									}
									style={{
										background: AP_ACCENT,
										color: "#0a0a0a",
										fontWeight: 600,
									}}
								>
									Get early access
									<LIcon name="arrow-right" size={14} />
								</a>
								<a
									className="landing-btn landing-btn-secondary"
									href="#issue"
									onClick={(e) => smoothScrollNavigate("/autopilot#issue", e)}
								>
									See an issue run
									<LIcon name="arrow-down" size={14} />
								</a>
								<a
									className="landing-btn landing-btn-ghost"
									href="https://github.com/questpie/questpie"
									target="_blank"
									rel="noreferrer"
								>
									<LIcon name="github-logo" size={14} />
									Source
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
									{ k: "Like", v: "Linear + Lovable + Zapier" },
									{ k: "License", v: "MIT" },
									{ k: "Audit", v: "Every step" },
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
						<IssueDetailMock />
					</Reveal>
				</div>
			</div>

			<style>{`
				@media (max-width: 1000px) {
					.landing-ap-hero-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
				}
			`}</style>
		</section>
	);
}

type ActivityStatus = "done" | "wait" | "queue" | undefined;
function IssueDetailMock() {
	const activity: Array<{
		t: string;
		who: string;
		text: string;
		status?: ActivityStatus;
	}> = [
		{
			t: "08:12",
			who: "Marek",
			text: "Created issue · attached workflow review-content",
		},
		{
			t: "08:12",
			who: "step.run",
			text: "draft  ✓  generated 612 words",
			status: "done",
		},
		{
			t: "08:14",
			who: "step.run",
			text: "fact-check  ✓  3 sources verified",
			status: "done",
		},
		{
			t: "08:15",
			who: "step.run",
			text: "seo-pass  ✓  title + meta updated",
			status: "done",
		},
		{
			t: "08:16",
			who: "step.waitForEvent",
			text: "human-approval",
			status: "wait",
		},
		{ t: "", who: "step.run", text: "publish · queued", status: "queue" },
	];
	return (
		<div
			id="issue"
			style={{
				border: "1px solid var(--border-subtle)",
				borderRadius: "var(--surface-radius)",
				background: "var(--card)",
				overflow: "hidden",
				boxShadow: "var(--floating-shadow)",
			}}
		>
			<div
				style={{
					padding: "14px 16px",
					borderBottom: "1px solid var(--border-subtle)",
					background: "var(--surface-low)",
					display: "flex",
					alignItems: "center",
					gap: 10,
				}}
			>
				<span
					className="landing-mono"
					style={{ fontSize: 11, color: "var(--foreground-subtle)" }}
				>
					QAP-4821
				</span>
				<span
					style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}
				>
					Publish Q3 launch announcement
				</span>
				<span
					className="landing-mono"
					style={{
						marginLeft: "auto",
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						fontSize: 10,
						color: AP_ACCENT,
						border:
							"1px solid color-mix(in srgb, var(--pillar-autopilot) 30%, transparent)",
						background:
							"color-mix(in srgb, var(--pillar-autopilot) 8%, transparent)",
						padding: "3px 8px",
						borderRadius: 6,
						letterSpacing: "0.04em",
						textTransform: "uppercase",
					}}
				>
					<StatusIcon name="in_review" size={10} />
					In review
				</span>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(4, minmax(0,1fr))",
					padding: "10px 16px",
					borderBottom: "1px solid var(--border-subtle)",
					gap: 12,
				}}
			>
				{[
					{ k: "Type", v: "Feature", icon: "sparkle", mono: false },
					{ k: "Project", v: "Marketing site", icon: null, mono: false },
					{
						k: "Workflow",
						v: "review-content",
						icon: "git-branch",
						mono: true,
					},
					{ k: "Updated", v: "2m ago", icon: null, mono: true },
				].map((p) => (
					<div key={p.k} style={{ minWidth: 0 }}>
						<div className="landing-eyebrow">{p.k}</div>
						<div
							style={{
								marginTop: 3,
								fontSize: 12.5,
								color: "var(--foreground)",
								display: "flex",
								alignItems: "center",
								gap: 6,
								overflow: "hidden",
								whiteSpace: "nowrap",
								textOverflow: "ellipsis",
								fontFamily: p.mono
									? "var(--font-mono)"
									: "var(--font-sans)",
							}}
						>
							{p.icon && (
								<LIcon
									name={p.icon}
									size={11}
									style={{
										color: "var(--foreground-subtle)",
										flexShrink: 0,
									}}
								/>
							)}
							<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
								{p.v}
							</span>
						</div>
					</div>
				))}
			</div>

			<div style={{ padding: 16 }}>
				<div className="landing-eyebrow" style={{ marginBottom: 10 }}>
					Activity
				</div>
				{activity.map((a, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: stable
						key={i}
						style={{
							display: "grid",
							gridTemplateColumns: "44px 1fr",
							gap: 12,
							padding: "8px 0",
							borderTop:
								i === 0 ? "none" : "1px dashed var(--border-subtle)",
							fontSize: 12.5,
							alignItems: "baseline",
						}}
					>
						<span
							className="landing-mono landing-tabular"
							style={{ color: "var(--foreground-subtle)", fontSize: 11 }}
						>
							{a.t || "·"}
						</span>
						<span
							style={{
								color: "var(--foreground)",
								lineHeight: 1.5,
								display: "inline-flex",
								alignItems: "center",
								gap: 8,
								flexWrap: "wrap",
							}}
						>
							<StepDot status={a.status} />
							<code
								style={{
									fontSize: 11.5,
									color: a.who.includes("step.")
										? AP_ACCENT
										: "var(--foreground-muted)",
								}}
							>
								{a.who}
							</code>
							<span style={{ color: "var(--foreground)" }}>{a.text}</span>
						</span>
					</div>
				))}
			</div>

			<div
				style={{
					padding: "10px 14px",
					borderTop: "1px solid var(--border-subtle)",
					background: "var(--surface-low)",
					display: "flex",
					justifyContent: "space-between",
					fontSize: 11,
					color: "var(--foreground-subtle)",
				}}
			>
				<span className="landing-mono">trace: wf_a821-0428 · 5 / 6 steps</span>
				<span className="landing-mono">5.4s</span>
			</div>
		</div>
	);
}

function StepDot({ status }: { status?: ActivityStatus }) {
	if (!status) return null;
	const c =
		status === "done"
			? "var(--success)"
			: status === "wait"
				? AP_ACCENT
				: "var(--foreground-subtle)";
	return (
		<span
			style={{
				width: 7,
				height: 7,
				borderRadius: "50%",
				background: c,
				boxShadow:
					status === "wait"
						? `0 0 0 3px color-mix(in srgb, ${c} 25%, transparent)`
						: "none",
				display: "inline-block",
				flexShrink: 0,
			}}
		/>
	);
}

type StatusName =
	| "backlog"
	| "todo"
	| "in_progress"
	| "in_review"
	| "done"
	| "cancelled";

function StatusIcon({
	name,
	size = 12,
}: {
	name: StatusName;
	size?: number;
}) {
	if (name === "backlog")
		return (
			<svg
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeDasharray="3 2"
				aria-hidden="true"
			>
				<title>backlog</title>
				<circle cx="12" cy="12" r="9" />
			</svg>
		);
	if (name === "todo")
		return (
			<svg
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				aria-hidden="true"
			>
				<title>todo</title>
				<circle cx="12" cy="12" r="9" />
			</svg>
		);
	if (name === "in_progress")
		return (
			<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
				<title>in progress</title>
				<circle
					cx="12"
					cy="12"
					r="9"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				/>
				<path d="M12 3 A9 9 0 0 1 12 21 Z" fill="currentColor" />
			</svg>
		);
	if (name === "in_review")
		return (
			<svg
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				aria-hidden="true"
			>
				<title>in review</title>
				<circle cx="12" cy="12" r="9" />
				<path d="m7 12 4 4 6-7" />
			</svg>
		);
	if (name === "done")
		return (
			<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
				<title>done</title>
				<circle cx="12" cy="12" r="9" fill="currentColor" />
				<path
					d="m7 12 4 4 6-7"
					stroke="var(--background)"
					strokeWidth="2"
					fill="none"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		);
	if (name === "cancelled")
		return (
			<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
				<title>cancelled</title>
				<circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.4" />
				<path
					d="m9 9 6 6M15 9l-6 6"
					stroke="var(--background)"
					strokeWidth="2"
					fill="none"
					strokeLinecap="round"
				/>
			</svg>
		);
	return null;
}

/* ============================================================
 * APPILLARS
 * ============================================================ */
const PILLARS_AP = [
	{
		key: "issues",
		label: "Issues",
		icon: "circle",
		desc: "Linear-style work items.",
		sub: "title · status · type · project · workflow",
	},
	{
		key: "workflows",
		label: "Workflows",
		icon: "tree-structure",
		desc: "Reusable durable procedures.",
		sub: "step.run · step.sleep · step.waitForEvent",
	},
	{
		key: "schedules",
		label: "Schedules",
		icon: "calendar",
		desc: "Cron triggers that create work.",
		sub: "create issue · or run workflow",
	},
	{
		key: "knowledge",
		label: "Knowledge",
		icon: "book-open",
		desc: "Context, docs, rules, references.",
		sub: "semantic search for agents",
	},
	{
		key: "projects",
		label: "Projects",
		icon: "folder",
		desc: "Workspaces, repos, scopes.",
		sub: "isolation + defaults",
	},
];

const AP_PLUS = [
	{
		key: "builder",
		label: "AI builder",
		icon: "sparkle",
		desc: "Lovable-style. Modifies real QUESTPIE code.",
	},
	{
		key: "agents",
		label: "Agents",
		icon: "robot",
		desc: "Capability profiles + tools + MCP.",
	},
	{
		key: "packs",
		label: "Packs",
		icon: "code",
		desc: "Skills, workflows, recipes. Installable.",
	},
	{
		key: "integrations",
		label: "Integrations",
		icon: "plug",
		desc: "Slack, GitHub, channels.",
	},
];

export function APPillars() {
	return (
		<Section pad="48px 24px 80px">
			<Reveal>
				<SectionHeading
					eyebrow="The product"
					eyebrowColor={AP_ACCENT}
					title="Five surfaces. Plus everything underneath."
					lede="Top-level navigation is what a human actually thinks about: work, procedures, triggers, context, scopes. Agents, builder, packs and integrations live inside the issues that need them."
					align="center"
				/>
			</Reveal>

			<Reveal>
				<div
					className="landing-ap-pillars-grid"
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(5, minmax(0,1fr))",
						gap: 0,
						border: "1px solid var(--border-subtle)",
						borderRadius: "var(--surface-radius)",
						overflow: "hidden",
						background: "var(--card)",
					}}
				>
					{PILLARS_AP.map((p, i) => (
						<a
							key={p.key}
							href={`#${p.key}`}
							onClick={(e) =>
								smoothScrollNavigate(`/autopilot#${p.key}`, e)
							}
							className="landing-ap-pillar-cell"
							style={{
								padding: "22px 18px",
								borderRight:
									i === PILLARS_AP.length - 1
										? "none"
										: "1px solid var(--border-subtle)",
								display: "flex",
								flexDirection: "column",
								gap: 10,
								textDecoration: "none",
								color: "inherit",
								transition:
									"background-color var(--motion-duration-base) var(--motion-ease-standard)",
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.background = "var(--surface-low)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.background = "var(--card)";
							}}
						>
							<span
								style={{
									width: 28,
									height: 28,
									borderRadius: 8,
									background:
										"color-mix(in srgb, var(--pillar-autopilot) 10%, transparent)",
									border:
										"1px solid color-mix(in srgb, var(--pillar-autopilot) 26%, transparent)",
									color: AP_ACCENT,
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								<LIcon name={p.icon} size={14} />
							</span>
							<div>
								<div
									style={{
										fontSize: 14,
										fontWeight: 600,
										color: "var(--foreground)",
									}}
								>
									{p.label}
								</div>
								<div
									style={{
										fontSize: 12.5,
										color: "var(--foreground-muted)",
										lineHeight: 1.5,
										marginTop: 4,
									}}
								>
									{p.desc}
								</div>
							</div>
							<span
								className="landing-mono"
								style={{
									fontSize: 10.5,
									color: "var(--foreground-subtle)",
									marginTop: "auto",
								}}
							>
								{p.sub}
							</span>
						</a>
					))}
				</div>
			</Reveal>

			<Reveal delay={80}>
				<div
					className="landing-ap-plus-grid"
					style={{
						marginTop: 14,
						display: "grid",
						gridTemplateColumns: "repeat(4, minmax(0,1fr))",
						gap: 0,
						border: "1px solid var(--border-subtle)",
						borderRadius: "var(--surface-radius)",
						overflow: "hidden",
						background: "var(--surface-low)",
					}}
				>
					{AP_PLUS.map((p, i, arr) => (
						<a
							key={p.key}
							href={`#${p.key}`}
							onClick={(e) =>
								smoothScrollNavigate(`/autopilot#${p.key}`, e)
							}
							className="landing-ap-plus-cell"
							style={{
								padding: "14px 16px",
								borderRight:
									i === arr.length - 1
										? "none"
										: "1px solid var(--border-subtle)",
								display: "flex",
								gap: 12,
								alignItems: "center",
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
							<span
								style={{
									width: 26,
									height: 26,
									borderRadius: 7,
									background:
										"color-mix(in srgb, var(--pillar-autopilot) 10%, transparent)",
									border:
										"1px solid color-mix(in srgb, var(--pillar-autopilot) 24%, transparent)",
									color: AP_ACCENT,
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									flexShrink: 0,
								}}
							>
								<LIcon name={p.icon} size={13} />
							</span>
							<div style={{ minWidth: 0 }}>
								<div
									style={{
										fontSize: 13.5,
										color: "var(--foreground)",
										fontWeight: 500,
									}}
								>
									{p.label}
								</div>
								<div
									style={{
										fontSize: 11.5,
										color: "var(--foreground-muted)",
										lineHeight: 1.4,
										marginTop: 1,
									}}
								>
									{p.desc}
								</div>
							</div>
							<LIcon
								name="arrow-right"
								size={11}
								style={{
									color: "var(--foreground-subtle)",
									marginLeft: "auto",
								}}
							/>
						</a>
					))}
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 1000px) {
					.landing-ap-pillars-grid { grid-template-columns: repeat(2, 1fr) !important; }
					.landing-ap-pillar-cell:nth-child(2n) { border-right: none !important; }
					.landing-ap-pillar-cell:nth-child(odd) { border-right: 1px solid var(--border-subtle) !important; }
					.landing-ap-pillar-cell { border-bottom: 1px solid var(--border-subtle); }
					.landing-ap-pillar-cell:nth-last-child(-n+2) { border-bottom: none; }
					.landing-ap-plus-grid { grid-template-columns: repeat(2, 1fr) !important; }
					.landing-ap-plus-cell:nth-child(2n) { border-right: none !important; }
					.landing-ap-plus-cell:nth-child(odd) { border-right: 1px solid var(--border-subtle) !important; }
					.landing-ap-plus-cell { border-bottom: 1px solid var(--border-subtle); }
					.landing-ap-plus-cell:nth-last-child(-n+2) { border-bottom: none; }
				}
				@media (max-width: 560px) {
					.landing-ap-pillars-grid { grid-template-columns: 1fr !important; }
					.landing-ap-pillar-cell { border-right: none !important; border-bottom: 1px solid var(--border-subtle); }
					.landing-ap-pillar-cell:last-child { border-bottom: none; }
					.landing-ap-plus-grid { grid-template-columns: 1fr !important; }
					.landing-ap-plus-cell { border-right: none !important; border-bottom: 1px solid var(--border-subtle); }
					.landing-ap-plus-cell:last-child { border-bottom: none; }
				}
			`}</style>
		</Section>
	);
}

/* ============================================================
 * ISSUES
 * ============================================================ */
const STATUS_COLOR: Record<StatusName, string> = {
	backlog: "var(--foreground-subtle)",
	todo: "var(--foreground-muted)",
	in_progress: "#eab308",
	in_review: "#22c55e",
	done: "#818cf8",
	cancelled: "var(--foreground-subtle)",
};
const STATUS_LABEL: Record<StatusName, string> = {
	backlog: "Backlog",
	todo: "Todo",
	in_progress: "In progress",
	in_review: "In review",
	done: "Done",
	cancelled: "Cancelled",
};

const SAMPLE_ISSUES: Array<{
	id: string;
	title: string;
	type: keyof typeof TYPE_ICON;
	status: StatusName;
	project: string;
	workflow: string;
	t: string;
}> = [
	{
		id: "QAP-4821",
		title: "Publish Q3 launch announcement",
		type: "feature",
		status: "in_review",
		project: "Marketing site",
		workflow: "review-content",
		t: "2m",
	},
	{
		id: "QAP-4818",
		title: "Fix DNS for marekstreet.barbers",
		type: "bug",
		status: "in_progress",
		project: "Cloud ops",
		workflow: "incident-triage",
		t: "12m",
	},
	{
		id: "QAP-4815",
		title: "Weekly newsletter draft",
		type: "task",
		status: "todo",
		project: "Marketing site",
		workflow: "draft-newsletter",
		t: "1h",
	},
	{
		id: "QAP-4801",
		title: "Investigate slow listing queries",
		type: "research",
		status: "backlog",
		project: "Realtor app",
		workflow: "·",
		t: "yesterday",
	},
	{
		id: "QAP-4799",
		title: "Review June P&L",
		type: "review",
		status: "done",
		project: "Internal",
		workflow: "monthly-finance",
		t: "yesterday",
	},
	{
		id: "QAP-4790",
		title: "Onboard new partner shop",
		type: "task",
		status: "in_progress",
		project: "Partnerships",
		workflow: "partner-onboarding",
		t: "3h",
	},
];

const TYPE_ICON = {
	task: "code",
	feature: "sparkle",
	bug: "lightning",
	research: "magnifying-glass",
	review: "check",
	approval: "shield",
};

export function IssuesSection() {
	return (
		<Section id="issues" pad="48px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Issues"
					eyebrowColor={AP_ACCENT}
					title="The work, in one keyboard-driven list."
					lede="Dense rows. Status icons that scan in a glance. Quick filters for Open, Needs review, Needs attention, Done, Scheduled. Open any issue to see properties, activity, attached workflow runs."
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
							display: "flex",
							alignItems: "center",
							gap: 8,
							padding: "10px 14px",
							borderBottom: "1px solid var(--border-subtle)",
							background: "var(--surface-low)",
							flexWrap: "wrap",
						}}
					>
						<span
							className="landing-mono"
							style={{ fontSize: 11, color: "var(--foreground-subtle)" }}
						>
							/admin/issues
						</span>
						<div style={{ display: "flex", gap: 4, marginLeft: 10 }}>
							{["Open", "Needs review", "Needs attention", "Done", "Scheduled"].map(
								(q, i) => (
									<span
										key={q}
										className="landing-mono"
										style={{
											fontSize: 11,
											padding: "3px 9px",
											borderRadius: 6,
											background:
												i === 0 ? "var(--surface-high)" : "transparent",
											color:
												i === 0
													? "var(--foreground)"
													: "var(--foreground-muted)",
											border:
												i === 0
													? "1px solid var(--border)"
													: "1px solid transparent",
										}}
									>
										{q}
									</span>
								),
							)}
						</div>
						<span
							className="landing-mono"
							style={{
								marginLeft: "auto",
								fontSize: 11,
								color: "var(--foreground-subtle)",
								display: "inline-flex",
								gap: 6,
								alignItems: "center",
							}}
						>
							<LIcon name="magnifying-glass" size={11} />
							search · ⌘K
						</span>
					</div>

					<div
						style={{
							display: "grid",
							gridTemplateColumns: "92px 1fr 116px 130px 130px 64px",
							padding: "8px 14px",
							borderBottom: "1px solid var(--border-subtle)",
							background: "var(--muted)",
							fontFamily: "var(--font-mono)",
							fontSize: 10.5,
							letterSpacing: "0.04em",
							textTransform: "uppercase",
							color: "var(--foreground-subtle)",
							gap: 10,
						}}
					>
						<span>ID</span>
						<span>Title</span>
						<span>Status</span>
						<span>Project</span>
						<span>Workflow</span>
						<span style={{ textAlign: "right" }}>Updated</span>
					</div>

					{SAMPLE_ISSUES.map((row, i) => (
						<div
							key={row.id}
							style={{
								display: "grid",
								gridTemplateColumns: "92px 1fr 116px 130px 130px 64px",
								padding: "11px 14px",
								borderBottom:
									i === SAMPLE_ISSUES.length - 1
										? "none"
										: "1px solid var(--border-subtle)",
								fontSize: 13,
								alignItems: "center",
								gap: 10,
							}}
						>
							<span
								className="landing-mono landing-tabular"
								style={{
									color: "var(--foreground-subtle)",
									fontSize: 11.5,
								}}
							>
								{row.id}
							</span>
							<span
								style={{
									display: "flex",
									gap: 10,
									alignItems: "center",
									minWidth: 0,
								}}
							>
								<LIcon
									name={TYPE_ICON[row.type]}
									size={13}
									style={{
										color: "var(--foreground-subtle)",
										flexShrink: 0,
									}}
								/>
								<span
									style={{
										color: "var(--foreground)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{row.title}
								</span>
							</span>
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									fontSize: 12,
									color: STATUS_COLOR[row.status],
								}}
							>
								<StatusIcon name={row.status} size={12} />
								{STATUS_LABEL[row.status]}
							</span>
							<span
								style={{
									color: "var(--foreground-muted)",
									fontSize: 12.5,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{row.project}
							</span>
							<span
								className="landing-mono"
								style={{
									color:
										row.workflow === "·"
											? "var(--foreground-disabled)"
											: AP_ACCENT,
									fontSize: 11.5,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{row.workflow}
							</span>
							<span
								className="landing-mono landing-tabular"
								style={{
									color: "var(--foreground-subtle)",
									fontSize: 11.5,
									textAlign: "right",
								}}
							>
								{row.t}
							</span>
						</div>
					))}

					<div
						style={{
							padding: "10px 14px",
							borderTop: "1px solid var(--border-subtle)",
							background: "var(--surface-low)",
							display: "flex",
							justifyContent: "space-between",
							fontSize: 11,
							color: "var(--foreground-subtle)",
							fontFamily: "var(--font-mono)",
						}}
					>
						<span>6 of 42 issues · sort: updated desc</span>
						<span>shortcut: ↑↓ Enter</span>
					</div>
				</div>
			</Reveal>

			<Reveal delay={80}>
				<div
					style={{
						marginTop: 16,
						display: "flex",
						flexWrap: "wrap",
						gap: 18,
						justifyContent: "center",
						fontSize: 12.5,
						color: "var(--foreground-muted)",
					}}
				>
					{(
						[
							{ label: "Backlog", st: "backlog" },
							{ label: "Todo", st: "todo" },
							{ label: "In progress", st: "in_progress" },
							{ label: "In review", st: "in_review" },
							{ label: "Done", st: "done" },
							{ label: "Cancelled", st: "cancelled" },
						] satisfies Array<{ label: string; st: StatusName }>
					).map((s) => (
						<span
							key={s.label}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								color: STATUS_COLOR[s.st],
							}}
						>
							<StatusIcon name={s.st} size={12} />
							<span style={{ color: "var(--foreground-muted)" }}>
								{s.label}
							</span>
						</span>
					))}
				</div>
			</Reveal>
		</Section>
	);
}

/* ============================================================
 * WORKFLOWS
 * ============================================================ */
export function WorkflowsSection() {
	const lines: CodeLine[] = [
		[CM("// workflows/review-content.ts. Durable, restartable")],
		[KW("export default "), FN("workflow"), "("],
		["  ", STR('"review-content"'), ","],
		["  ", KW("async"), " (step, { issueId }) => {"],
		["    ", KW("const"), " issue = ", KW("await"), " step.", FN("run"), "("],
		[
			"      ",
			STR('"load"'),
			", () => ctx.collections.tasks.findById(issueId)",
		],
		["    );"],
		[""],
		["    ", KW("const"), " draft = ", KW("await"), " step.", FN("run"), "("],
		[
			"      ",
			STR('"draft"'),
			", () => agent.draft(issue, { capability: ",
			STR('"writer-v2"'),
			" })",
		],
		["    );"],
		[
			"    ",
			KW("await"),
			" step.",
			FN("run"),
			"(",
			STR('"fact-check"'),
			", () => agent.factCheck(draft));",
		],
		[
			"    ",
			KW("await"),
			" step.",
			FN("run"),
			"(",
			STR('"seo-pass"'),
			",   () => agent.seo(draft));",
		],
		[""],
		[
			"    ",
			KW("await"),
			" step.",
			FN("waitForEvent"),
			"(",
			STR('"human-approval"'),
			");",
		],
		[
			"    ",
			KW("await"),
			" step.",
			FN("run"),
			"(",
			STR('"publish"'),
			", () => ctx.collections.tasks.update({ id: issueId, status: ",
			STR('"done"'),
			" }));",
		],
		["  }"],
		[");"],
	];
	return (
		<Section id="workflows" pad="48px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Workflows"
					eyebrowColor={AP_ACCENT}
					title="Procedures, written once. Re-attached to every issue."
					lede="Each step persists its result. The process can sleep for hours, wait for human approval, invoke sub-workflows, and survive every restart. Compose business logic the same way you write any TypeScript."
				/>
			</Reveal>

			<div
				className="landing-wf-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)",
					gap: 32,
					alignItems: "start",
				}}
			>
				<Reveal>
					<CodeBlock filename="workflows/review-content.ts" lines={lines} />
				</Reveal>

				<Reveal delay={80}>
					<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
						<PrimitiveRow
							code="step.run(name, fn)"
							desc="Execute & persist. Safe to retry."
						/>
						<PrimitiveRow
							code="step.sleep(name, '14d')"
							desc="Pause hours, days, weeks."
						/>
						<PrimitiveRow
							code="step.waitForEvent('approval')"
							desc="Block until a signal arrives."
						/>
						<PrimitiveRow
							code="step.invoke('sub-flow', input)"
							desc="Compose workflows."
						/>
						<PrimitiveRow
							code="ctx.collections.*"
							desc="Read & write any QUESTPIE collection."
						/>
						<PrimitiveRow
							code="agent.run(capability, input)"
							desc="Hand off to a configured capability."
						/>

						<div
							style={{
								marginTop: 6,
								padding: "12px 14px",
								border: "1px solid var(--border-subtle)",
								background: "var(--surface-low)",
								borderRadius: "var(--control-radius)",
								fontSize: 12.5,
								color: "var(--foreground-muted)",
								lineHeight: 1.55,
							}}
						>
							Workflows live in{" "}
							<code style={{ color: AP_ACCENT, fontSize: 11.5 }}>
								workflow_configs
							</code>{" "}
							as steps + defaults. Attach one to any issue, or trigger via
							Schedules.
						</div>
					</div>
				</Reveal>
			</div>

			<style>{`
				@media (max-width: 980px) {
					.landing-wf-grid { grid-template-columns: 1fr !important; gap: 24px !important; }
				}
			`}</style>
		</Section>
	);
}

function PrimitiveRow({ code, desc }: { code: string; desc: string }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "flex-start",
				gap: 14,
				padding: "10px 14px",
				border: "1px solid var(--border-subtle)",
				borderRadius: "var(--control-radius)",
				background: "var(--card)",
			}}
		>
			<code
				style={{
					color: AP_ACCENT,
					fontSize: 12,
					flexShrink: 0,
					minWidth: 180,
				}}
			>
				{code}
			</code>
			<span
				style={{
					fontSize: 12.5,
					color: "var(--foreground-muted)",
					lineHeight: 1.5,
				}}
			>
				{desc}
			</span>
		</div>
	);
}

/* ============================================================
 * SCHEDULES
 * ============================================================ */
const SCHEDULES = [
	{
		name: "Weekly newsletter brief",
		cron: "0 8 * * 1",
		mode: "task",
		action: "create issue",
		workflow: "draft-newsletter",
		next: "Mon 08:00",
	},
	{
		name: "Monthly P&L review",
		cron: "0 7 1 * *",
		mode: "task",
		action: "create issue",
		workflow: "monthly-finance",
		next: "Jul 1, 07:00",
	},
	{
		name: "SEO sweep",
		cron: "0 4 * * *",
		mode: "chat",
		action: "run workflow",
		workflow: "seo-sweep",
		next: "tomorrow 04:00",
	},
	{
		name: "Backup verification",
		cron: "0 */6 * * *",
		mode: "chat",
		action: "run workflow",
		workflow: "verify-backup",
		next: "in 4h",
	},
];

export function SchedulesSection() {
	return (
		<Section id="schedules" pad="48px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Schedules"
					eyebrowColor={AP_ACCENT}
					title="Time triggers that produce real work."
					lede="A schedule either creates an issue with a template, or runs a workflow directly. Pick cron, pick a workflow, decide what happens on overlap. The product surface stays human."
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
							gridTemplateColumns: "1.4fr 110px 130px 1fr 140px",
							padding: "8px 14px",
							background: "var(--muted)",
							borderBottom: "1px solid var(--border-subtle)",
							fontFamily: "var(--font-mono)",
							fontSize: 10.5,
							letterSpacing: "0.04em",
							textTransform: "uppercase",
							color: "var(--foreground-subtle)",
							gap: 12,
						}}
					>
						<span>Name</span>
						<span>Cron</span>
						<span>Action</span>
						<span>Workflow</span>
						<span style={{ textAlign: "right" }}>Next run</span>
					</div>
					{SCHEDULES.map((s, i) => (
						<div
							key={s.name}
							style={{
								display: "grid",
								gridTemplateColumns: "1.4fr 110px 130px 1fr 140px",
								padding: "12px 14px",
								borderBottom:
									i === SCHEDULES.length - 1
										? "none"
										: "1px solid var(--border-subtle)",
								fontSize: 13,
								alignItems: "center",
								gap: 12,
							}}
						>
							<span
								style={{
									display: "flex",
									gap: 10,
									alignItems: "center",
									minWidth: 0,
								}}
							>
								<LIcon
									name="calendar"
									size={13}
									style={{ color: AP_ACCENT, flexShrink: 0 }}
								/>
								<span
									style={{
										color: "var(--foreground)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{s.name}
								</span>
							</span>
							<code style={{ fontSize: 11.5, color: "var(--foreground-muted)" }}>
								{s.cron}
							</code>
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									fontSize: 11.5,
									color:
										s.mode === "task" ? "var(--foreground)" : AP_ACCENT,
								}}
							>
								<span
									style={{
										width: 6,
										height: 6,
										borderRadius: 2,
										background:
											s.mode === "task"
												? "var(--foreground-muted)"
												: AP_ACCENT,
									}}
								/>
								{s.action}
							</span>
							<code
								style={{
									fontSize: 11.5,
									color: AP_ACCENT,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{s.workflow}
							</code>
							<span
								className="landing-mono landing-tabular"
								style={{
									color: "var(--foreground-muted)",
									fontSize: 11.5,
									textAlign: "right",
								}}
							>
								{s.next}
							</span>
						</div>
					))}
				</div>
			</Reveal>
		</Section>
	);
}

/* ============================================================
 * KNOWLEDGE + PROJECTS
 * ============================================================ */
export function KnowledgeProjectsSection() {
	return (
		<Section pad="48px 24px 96px">
			<div
				className="landing-kp-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
					gap: 28,
				}}
			>
				<Reveal>
					<div
						id="knowledge"
						style={{
							border: "1px solid var(--border-subtle)",
							borderRadius: "var(--surface-radius)",
							background: "var(--card)",
							padding: 24,
							display: "flex",
							flexDirection: "column",
							gap: 16,
							height: "100%",
						}}
					>
						<div
							style={{ display: "flex", alignItems: "center", gap: 10 }}
						>
							<span
								style={{
									width: 28,
									height: 28,
									borderRadius: 8,
									background:
										"color-mix(in srgb, var(--pillar-autopilot) 10%, transparent)",
									border:
										"1px solid color-mix(in srgb, var(--pillar-autopilot) 26%, transparent)",
									color: AP_ACCENT,
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								<LIcon name="book-open" size={14} />
							</span>
							<h3
								style={{
									fontSize: 18,
									color: "var(--foreground)",
									fontWeight: 600,
								}}
							>
								Knowledge
							</h3>
						</div>
						<p
							style={{
								fontSize: 14,
								color: "var(--foreground-muted)",
								lineHeight: 1.55,
							}}
						>
							Context, docs, brand rules, references. Indexed for semantic
							search. Workflows and agents query knowledge before they decide.
						</p>
						<div
							style={{
								border: "1px solid var(--border-subtle)",
								borderRadius: "var(--control-radius)",
								background: "var(--surface-low)",
								padding: "12px 14px",
								fontFamily: "var(--font-mono)",
								fontSize: 12,
								color: "var(--foreground-muted)",
							}}
						>
							<span style={{ color: AP_ACCENT }}>knowledge.search</span>(
							<span style={{ color: "var(--syntax-string)" }}>
								"how do we structure pricing pages"
							</span>
							) →<br />
							<span style={{ color: "var(--foreground)" }}>3 results</span> ·
							pricing-style.md · landing-copy-v2.md · brand-voice.md
						</div>
					</div>
				</Reveal>

				<Reveal delay={80}>
					<div
						id="projects"
						style={{
							border: "1px solid var(--border-subtle)",
							borderRadius: "var(--surface-radius)",
							background: "var(--card)",
							padding: 24,
							display: "flex",
							flexDirection: "column",
							gap: 16,
							height: "100%",
						}}
					>
						<div
							style={{ display: "flex", alignItems: "center", gap: 10 }}
						>
							<span
								style={{
									width: 28,
									height: 28,
									borderRadius: 8,
									background:
										"color-mix(in srgb, var(--pillar-autopilot) 10%, transparent)",
									border:
										"1px solid color-mix(in srgb, var(--pillar-autopilot) 26%, transparent)",
									color: AP_ACCENT,
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								<LIcon name="folder" size={14} />
							</span>
							<h3
								style={{
									fontSize: 18,
									color: "var(--foreground)",
									fontWeight: 600,
								}}
							>
								Projects
							</h3>
						</div>
						<p
							style={{
								fontSize: 14,
								color: "var(--foreground-muted)",
								lineHeight: 1.55,
							}}
						>
							Workspaces, repos, scopes. Each project has its own issues,
							workflows, schedules and defaults. Multi-tenant by design.
						</p>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 6,
								border: "1px solid var(--border-subtle)",
								borderRadius: "var(--control-radius)",
								background: "var(--surface-low)",
								overflow: "hidden",
							}}
						>
							{[
								{ name: "Marketing site", open: 8, default: true },
								{ name: "Cloud ops", open: 14, default: false },
								{ name: "Realtor app", open: 23, default: false },
								{ name: "Partnerships", open: 4, default: false },
							].map((p, i, arr) => (
								<div
									key={p.name}
									style={{
										padding: "10px 14px",
										borderBottom:
											i === arr.length - 1
												? "none"
												: "1px solid var(--border-subtle)",
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										fontSize: 13,
									}}
								>
									<span
										style={{
											display: "inline-flex",
											gap: 8,
											alignItems: "center",
										}}
									>
										<span
											style={{
												width: 6,
												height: 6,
												borderRadius: 2,
												background: p.default
													? AP_ACCENT
													: "var(--foreground-muted)",
											}}
										/>
										{p.name}
										{p.default && (
											<span
												className="landing-mono"
												style={{
													marginLeft: 4,
													fontSize: 10,
													padding: "2px 5px",
													borderRadius: 3,
													background:
														"color-mix(in srgb, var(--pillar-autopilot) 10%, transparent)",
													color: AP_ACCENT,
													letterSpacing: "0.04em",
													textTransform: "uppercase",
												}}
											>
												default
											</span>
										)}
									</span>
									<span
										className="landing-mono landing-tabular"
										style={{
											fontSize: 11,
											color: "var(--foreground-subtle)",
										}}
									>
										{p.open} open
									</span>
								</div>
							))}
						</div>
					</div>
				</Reveal>
			</div>

			<style>{`
				@media (max-width: 880px) { .landing-kp-grid { grid-template-columns: 1fr !important; } }
			`}</style>
		</Section>
	);
}

/* ============================================================
 * FAQ + FINAL CTA (re-uses shared FaqSection)
 * ============================================================ */
const AP_FAQ = [
	{
		q: "What is Autopilot, really?",
		a: "An AI-native operating layer for QUESTPIE. Like Linear for work, Lovable for app building, Zapier for automation, on one open source stack. Issues are the human entry point, workflows are durable procedures, agents are configurable profiles, and the AI builder edits your real code.",
	},
	{
		q: "What's the actual data model?",
		a: "Issues live in a 'tasks' collection (title, description, type, status, project, workflow). Workflows in 'workflow_configs' (steps + defaults). Schedules in 'schedules' (cron + action). Knowledge in 'knowledge'. Projects in 'projects'. Plus capabilities, providers, models, runs and events under advanced settings. Everything is a normal QUESTPIE collection.",
	},
	{
		q: "How does the AI builder relate to Lovable / v0?",
		a: "Similar vibe, different surface: the builder reads your QUESTPIE repo and edits collections, admin config, components and routes. Every change is a workflow run with named steps, a preview deploy through Cloud, and an approval before publishing.",
	},
	{
		q: "What are Packs?",
		a: "An installable bundle of capability: skills, workflows, schedules, MCP tools, knowledge seeds and recipes. Drop a pack in and you get a working capability. Marketing-content, support-ops, release-engineering, finance-monthly. Packs are shareable across the team or the community.",
	},
	{
		q: "How do integrations work?",
		a: "Slack and GitHub are first-class. Open issues from a thread, approve workflow steps with a click, pull requests created by the builder. Email, Linear and GitLab are on the roadmap. MCP exposes your data to external IDE-side agents with the same RBAC.",
	},
	{
		q: "Why durable workflows over plain functions?",
		a: "Because real ops processes survive restarts, wait for human approvals, sleep for days, and need to be auditable. step.run persists every result. Re-runs skip completed steps. Sleeps and waits don't burn worker time.",
	},
	{
		q: "Self-host or Cloud?",
		a: "Both are first-class. Self-host the open package on your own infra. You wire workers, providers, MCP, packs, schedules yourself. Or run on Cloud and get a managed Autopilot installation per account, with the Cloud deploy bridge wired in.",
	},
	{
		q: "Which models can I use?",
		a: "Providers are pluggable: Anthropic and OpenAI are active, plus local providers (Ollama et al.) and custom endpoints. Gemini and Cursor are planned. Configure per capability. Agents pick the provider they need.",
	},
	{
		q: "Is there a CLI / TUI for developers?",
		a: "Planned, shipping with the Autopilot package. Open it in any repo to see current issue, ready queue, latest run, condensed logs. Same Issues / Workflows / Schedules mental model, keyboard-driven.",
	},
];

export function APFaq() {
	return <FaqSection items={AP_FAQ} />;
}

export function APFinalCta() {
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
						"linear-gradient(180deg, color-mix(in srgb, var(--pillar-autopilot) 6%, var(--surface-low)) 0%, var(--card) 100%)",
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
							"radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--pillar-autopilot) 14%, transparent) 0%, transparent 70%)",
						pointerEvents: "none",
					}}
				/>
				<Reveal>
					<Eyebrow dot color={AP_ACCENT}>
						Coming Q4 2026
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
						Be early on Autopilot.
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
						We're onboarding teams in batches. Tell us what you'd run on
						Autopilot and we'll fast-track the closest fits. No spam, ever.
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
									border: `1px solid ${AP_ACCENT}`,
									borderRadius: "var(--control-radius)",
									color: AP_ACCENT,
									fontSize: 14,
									background:
										"color-mix(in srgb, var(--pillar-autopilot) 10%, transparent)",
								}}
							>
								<LIcon name="check" size={14} />
								You're on the list. We'll be in touch.
							</span>
						) : (
							<form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
								<input
									type="email"
									required
									placeholder="you@company.com"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									style={{
										height: 44,
										padding: "0 16px",
										borderRadius: "var(--control-radius)",
										border: "1px solid var(--border-subtle)",
										background: "var(--surface-low)",
										color: "var(--foreground)",
										fontSize: 14,
										minWidth: 280,
										outline: "none",
									}}
								/>
								<button
									type="submit"
									className="landing-btn"
									style={{
										height: 44,
										background: AP_ACCENT,
										color: "#0a0a0a",
										fontWeight: 600,
									}}
								>
									Get early access
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
						<span>MIT-licensed</span>
						<span style={{ color: "var(--foreground-disabled)" }}>·</span>
						<span>$ bun add @questpie/autopilot</span>
						<span style={{ color: "var(--foreground-disabled)" }}>·</span>
						<a
							href="https://github.com/questpie/questpie"
							target="_blank"
							rel="noreferrer"
							style={{ color: AP_ACCENT }}
						>
							View source ↗
						</a>
					</div>
				</Reveal>
			</div>
		</Section>
	);
}

export { AP_ACCENT };
