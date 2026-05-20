import { Link } from "@tanstack/react-router";

import {
	Eyebrow,
	LIcon,
	Reveal,
	Section,
	SectionHeading,
} from "./primitives";
import { smoothScrollNavigate } from "./shared-nav";

const AP_ACCENT = "var(--pillar-autopilot)";

/* ============================================================
 * AI BUILDER
 * ============================================================ */
const BUILDER_MESSAGES: Array<{
	who: "user" | "agent";
	text: string;
	diff?: string[];
}> = [
	{
		who: "user",
		text: "Tighten the hero, add a contact form, swap headings to Geist.",
	},
	{
		who: "agent",
		text: "Updated hero spacing, inserted a contact form below the pricing, applied Geist to h1, h2 and h3. Live preview ready.",
		diff: ["+ Geist h1, h2, h3", "+ <ContactForm/>", "~ hero padding 80 → 120"],
	},
	{
		who: "user",
		text: "Add a Team section with three barbers and short bios.",
	},
	{
		who: "agent",
		text: 'Added a Team section with three columns and image placeholders. Hooked to the `team` collection so you can edit in admin.',
		diff: ["+ <TeamSection/>", "+ collections/team.ts (3 rows)", "+ image slots"],
	},
];

const BUILDER_PROMPTS = [
	"Add an opening-hours widget",
	"Translate to Slovak",
	"Use a warmer palette",
	"Add Instagram embed",
];

export function BuilderSection() {
	return (
		<Section id="builder" pad="48px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="AI builder"
					eyebrowColor={AP_ACCENT}
					title="Like Lovable, but it edits real QUESTPIE code."
					lede="Describe a change and the builder modifies collections, admin views, routes, components and content as a real commit. Live preview, human approval, full audit. Hosted on Cloud or self-hosted."
				/>
			</Reveal>

			<Reveal>
				<div
					className="landing-builder-grid"
					style={{
						border: "1px solid var(--border-subtle)",
						borderRadius: "var(--surface-radius)",
						background: "var(--card)",
						overflow: "hidden",
						display: "grid",
						gridTemplateColumns: "minmax(0, 420px) minmax(0, 1fr)",
					}}
				>
					<BuilderChat />
					<BuilderPreview />
				</div>
			</Reveal>

			<Reveal delay={80}>
				<div
					style={{
						marginTop: 14,
						display: "flex",
						justifyContent: "center",
						gap: 8,
						flexWrap: "wrap",
					}}
				>
					{BUILDER_PROMPTS.map((p) => (
						<span
							key={p}
							style={{
								padding: "6px 12px",
								fontSize: 12.5,
								color: "var(--foreground-muted)",
								border: "1px solid var(--border-subtle)",
								background: "var(--surface-low)",
								borderRadius: 999,
								cursor: "default",
							}}
						>
							<LIcon
								name="sparkle"
								size={10}
								style={{ marginRight: 6, color: AP_ACCENT }}
							/>
							{p}
						</span>
					))}
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 980px) {
					.landing-builder-grid { grid-template-columns: 1fr !important; }
				}
			`}</style>
		</Section>
	);
}

function BuilderChat() {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				borderRight: "1px solid var(--border-subtle)",
				background: "var(--surface)",
				minHeight: 520,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "12px 16px",
					borderBottom: "1px solid var(--border-subtle)",
					background: "var(--surface-low)",
				}}
			>
				<LIcon name="sparkle" size={14} style={{ color: AP_ACCENT }} />
				<span
					className="landing-mono"
					style={{ fontSize: 11.5, color: "var(--foreground)" }}
				>
					builder · marekstreet.barbers
				</span>
				<span
					className="landing-mono"
					style={{
						marginLeft: "auto",
						fontSize: 10,
						color: AP_ACCENT,
						border:
							"1px solid color-mix(in srgb, var(--pillar-autopilot) 30%, transparent)",
						background:
							"color-mix(in srgb, var(--pillar-autopilot) 8%, transparent)",
						padding: "2px 8px",
						borderRadius: 6,
					}}
				>
					24 edits
				</span>
			</div>
			<div
				style={{
					flex: 1,
					padding: 14,
					display: "flex",
					flexDirection: "column",
					gap: 12,
					overflow: "hidden",
				}}
			>
				{BUILDER_MESSAGES.map((m, i) => (
					<ChatBubble
						// biome-ignore lint/suspicious/noArrayIndexKey: stable
						key={i}
						m={m}
					/>
				))}
			</div>
			<div
				style={{
					borderTop: "1px solid var(--border-subtle)",
					padding: 12,
					background: "var(--surface-low)",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						border: "1px solid var(--border)",
						background: "var(--card)",
						borderRadius: "var(--control-radius)",
						padding: "8px 12px",
					}}
				>
					<LIcon
						name="sparkle"
						size={13}
						style={{ color: "var(--foreground-subtle)" }}
					/>
					<span
						style={{ fontSize: 13, color: "var(--foreground-subtle)", flex: 1 }}
					>
						Describe the change…
					</span>
					<span
						className="landing-mono"
						style={{
							fontSize: 10,
							color: "var(--foreground-subtle)",
							border: "1px solid var(--border-subtle)",
							padding: "2px 6px",
							borderRadius: 4,
						}}
					>
						⏎
					</span>
				</div>
				<div
					style={{
						marginTop: 8,
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						fontSize: 11,
						color: "var(--foreground-subtle)",
					}}
				>
					<span className="landing-mono">3 changes pending</span>
					<span style={{ display: "inline-flex", gap: 6 }}>
						<span
							className="landing-btn landing-btn-secondary landing-btn-sm"
							style={{ pointerEvents: "none" }}
						>
							Discard
						</span>
						<span
							className="landing-btn landing-btn-sm"
							style={{
								pointerEvents: "none",
								background: AP_ACCENT,
								color: "#0a0a0a",
								fontWeight: 600,
							}}
						>
							Apply &amp; deploy
						</span>
					</span>
				</div>
			</div>
		</div>
	);
}

function ChatBubble({
	m,
}: {
	m: { who: "user" | "agent"; text: string; diff?: string[] };
}) {
	const isAgent = m.who === "agent";
	return (
		<div
			style={{
				alignSelf: isAgent ? "flex-start" : "flex-end",
				maxWidth: "92%",
				display: "flex",
				flexDirection: "column",
				gap: 6,
			}}
		>
			<div
				style={{
					padding: "9px 13px",
					border: "1px solid",
					borderColor: isAgent
						? "color-mix(in srgb, var(--pillar-autopilot) 28%, transparent)"
						: "var(--border-subtle)",
					background: isAgent
						? "color-mix(in srgb, var(--pillar-autopilot) 8%, transparent)"
						: "var(--surface-mid)",
					color: "var(--foreground)",
					fontSize: 13,
					lineHeight: 1.55,
					borderRadius: 10,
				}}
			>
				{m.text}
			</div>
			{m.diff && (
				<div
					style={{
						fontFamily: "var(--font-mono)",
						fontSize: 11,
						display: "flex",
						flexDirection: "column",
						gap: 2,
						padding: "4px 8px",
					}}
				>
					{m.diff.map((d) => (
						<span
							key={d}
							style={{
								color: d.startsWith("+")
									? "var(--success)"
									: d.startsWith("~")
										? "#f2ca72"
										: "var(--foreground-subtle)",
							}}
						>
							{d}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

function BuilderPreview() {
	return (
		<div
			style={{
				background: "var(--background)",
				padding: 24,
				minHeight: 520,
				display: "flex",
				flexDirection: "column",
				gap: 16,
			}}
		>
			<div
				style={{
					border: "1px solid var(--border-subtle)",
					background: "var(--card)",
					borderRadius: "var(--surface-radius)",
					padding: 22,
					display: "flex",
					flexDirection: "column",
					gap: 16,
					flex: 1,
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
						style={{
							fontFamily: "var(--font-sans)",
							fontWeight: 700,
							fontSize: 14,
							letterSpacing: "0.05em",
						}}
					>
						MAREK STREET BARBERS
					</span>
					<span
						className="landing-mono"
						style={{ fontSize: 10, color: "var(--foreground-subtle)" }}
					>
						HOME · BOOK · MENU · ABOUT
					</span>
				</div>
				<div>
					<div
						style={{
							fontSize: 36,
							lineHeight: 1.0,
							fontWeight: 600,
							letterSpacing: "-0.025em",
							color: "var(--foreground)",
						}}
					>
						<span style={{ display: "block" }}>Old-school cuts.</span>
						<span style={{ display: "block", color: AP_ACCENT }}>
							New-school booking.
						</span>
					</div>
					<p
						style={{
							marginTop: 12,
							fontSize: 13.5,
							color: "var(--foreground-muted)",
							maxWidth: 360,
							lineHeight: 1.5,
						}}
					>
						Three chairs. Twenty years. Walk in or reserve online in seconds.
					</p>
					<div style={{ marginTop: 14, display: "flex", gap: 8 }}>
						<span
							className="landing-btn landing-btn-sm"
							style={{
								background: AP_ACCENT,
								color: "#0a0a0a",
								fontWeight: 600,
								pointerEvents: "none",
							}}
						>
							Book a chair
							<LIcon name="arrow-right" size={12} />
						</span>
						<span
							className="landing-btn landing-btn-secondary landing-btn-sm"
							style={{ pointerEvents: "none" }}
						>
							See gallery
						</span>
					</div>
				</div>

				<div
					style={{
						paddingTop: 14,
						borderTop: "1px solid var(--border-subtle)",
						display: "flex",
						flexDirection: "column",
						gap: 10,
						position: "relative",
					}}
				>
					<span
						style={{
							position: "absolute",
							top: 8,
							right: 0,
							fontFamily: "var(--font-mono)",
							fontSize: 10,
							padding: "2px 8px",
							borderRadius: 4,
							background:
								"color-mix(in srgb, var(--success) 12%, transparent)",
							color: "var(--success)",
							border:
								"1px solid color-mix(in srgb, var(--success) 28%, transparent)",
						}}
					>
						+ just added
					</span>
					<span className="landing-eyebrow">The team</span>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(3, 1fr)",
							gap: 10,
						}}
					>
						{["Marek", "Tomáš", "Bea"].map((name, i) => (
							<div
								key={name}
								style={{
									background:
										"repeating-linear-gradient(135deg, var(--surface-mid) 0 7px, var(--surface-low) 7px 14px)",
									border: "1px solid var(--border-subtle)",
									borderRadius: 10,
									height: 80,
									display: "flex",
									alignItems: "flex-end",
									padding: 8,
								}}
							>
								<div>
									<div
										style={{
											fontSize: 12,
											color: "var(--foreground)",
											fontWeight: 500,
										}}
									>
										{name}
									</div>
									<div
										className="landing-mono"
										style={{ fontSize: 9, color: "var(--foreground-subtle)" }}
									>
										PHOTO-{i + 1}
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					fontSize: 11.5,
					color: "var(--foreground-subtle)",
					fontFamily: "var(--font-mono)",
				}}
			>
				<span>● live preview · marekstreet.barbers</span>
				<span>p95: 84ms · 0 errors</span>
			</div>
		</div>
	);
}

/* ============================================================
 * INTEGRATIONS
 * ============================================================ */
const INTEGRATIONS = [
	{
		name: "Slack",
		icon: "chat-circle",
		desc: "Open issues from a thread. Approve workflow steps with one click. Get digests on a channel.",
		state: "Beta",
	},
	{
		name: "GitHub",
		icon: "github-logo",
		desc: "Pull requests created by the builder. Issues sync to QUESTPIE. Branch-per-issue.",
		state: "Beta",
	},
	{
		name: "GitLab",
		icon: "code",
		desc: "Same surface as GitHub for self-hosted GitLab installations.",
		state: "Planned",
	},
	{
		name: "Linear",
		icon: "tree-structure",
		desc: "Two-way sync for teams already living in Linear. Move when ready.",
		state: "Planned",
	},
	{
		name: "Email",
		icon: "envelope",
		desc: "Inbound mail creates issues. Outbound from workflows uses configured sender.",
		state: "Active",
	},
	{
		name: "MCP",
		icon: "plug",
		desc: "Your data exposed as tools to external IDE-side agents. Same RBAC as humans.",
		state: "Active",
	},
];

export function IntegrationsSection() {
	return (
		<Section id="integrations" pad="48px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Integrations"
					eyebrowColor={AP_ACCENT}
					title="Where your team already talks. Where your code already lives."
					lede="Autopilot connects to the channels your humans use and the systems your code runs in. Issues, approvals, digests, deploys. Flow through Slack, GitHub, email and MCP."
				/>
			</Reveal>

			<Reveal>
				<div
					className="landing-integrations-grid"
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
					{INTEGRATIONS.map((it, i, arr) => {
						const lastInRow = (i + 1) % 3 === 0;
						const lastRow = i >= arr.length - 3;
						const active = it.state === "Active" || it.state === "Beta";
						return (
							<div
								key={it.name}
								style={{
									padding: 18,
									borderRight: lastInRow
										? "none"
										: "1px solid var(--border-subtle)",
									borderBottom: lastRow
										? "none"
										: "1px solid var(--border-subtle)",
									display: "flex",
									flexDirection: "column",
									gap: 8,
								}}
							>
								<div
									style={{ display: "flex", alignItems: "center", gap: 10 }}
								>
									<LIcon
										name={it.icon}
										size={15}
										style={{ color: AP_ACCENT }}
									/>
									<span
										style={{
											fontSize: 14,
											color: "var(--foreground)",
											fontWeight: 500,
										}}
									>
										{it.name}
									</span>
									<span
										className="landing-mono"
										style={{
											marginLeft: "auto",
											fontSize: 10,
											color: active ? AP_ACCENT : "var(--foreground-subtle)",
											letterSpacing: "0.05em",
											textTransform: "uppercase",
										}}
									>
										{it.state}
									</span>
								</div>
								<p
									style={{
										fontSize: 12.5,
										color: "var(--foreground-muted)",
										lineHeight: 1.55,
									}}
								>
									{it.desc}
								</p>
							</div>
						);
					})}
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 880px) {
					.landing-integrations-grid { grid-template-columns: repeat(2, 1fr) !important; }
					.landing-integrations-grid > div:nth-child(2n) { border-right: none !important; }
					.landing-integrations-grid > div:nth-child(odd) { border-right: 1px solid var(--border-subtle) !important; }
				}
				@media (max-width: 560px) {
					.landing-integrations-grid { grid-template-columns: 1fr !important; }
					.landing-integrations-grid > div { border-right: none !important; }
				}
			`}</style>
		</Section>
	);
}

/* ============================================================
 * PACKS
 * ============================================================ */
const PACKS = [
	{
		name: "marketing-content",
		desc: "Editorial calendar workflow, SEO sweep, brand voice prompts, newsletter schedule.",
		items: ["3 workflows", "2 schedules", "1 agent profile", "knowledge seed"],
	},
	{
		name: "support-ops",
		desc: "Inbound triage from Slack/email. Knowledge-grounded answers. Escalation rules.",
		items: ["4 workflows", "1 schedule", "2 MCP tools"],
	},
	{
		name: "release-engineering",
		desc: "Generate changelogs, drive deploys via Cloud, post digests to Slack.",
		items: ["5 workflows", "Cloud bridge", "agent: release-manager"],
	},
	{
		name: "finance-monthly",
		desc: "Pull P&L, draft monthly review, send for approval, archive in knowledge.",
		items: ["1 workflow", "1 schedule (cron 0 7 1 * *)", "approvers config"],
	},
];

export function PacksSection() {
	return (
		<Section id="packs" pad="48px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Packs"
					eyebrowColor={AP_ACCENT}
					title="Business capability, installable in one command."
					lede="A pack bundles skills, workflows, schedules, MCP tools and knowledge seeds into a single installable unit. Drop one in, get a working capability. Share with your team or the community."
				/>
			</Reveal>

			<Reveal>
				<div
					className="landing-packs-grid"
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
						gap: 14,
					}}
				>
					{PACKS.map((p) => (
						<div
							key={p.name}
							style={{
								border: "1px solid var(--border-subtle)",
								borderRadius: "var(--surface-radius)",
								background:
									"radial-gradient(ellipse 70% 40% at 80% 0%, color-mix(in srgb, var(--pillar-autopilot) 7%, transparent) 0%, transparent 70%), var(--card)",
								padding: 20,
								position: "relative",
								overflow: "hidden",
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									marginBottom: 8,
								}}
							>
								<code style={{ fontSize: 13, color: AP_ACCENT }}>
									@questpie/pack-{p.name}
								</code>
								<span
									className="landing-mono"
									style={{
										marginLeft: "auto",
										fontSize: 10,
										color: "var(--foreground-subtle)",
										border: "1px solid var(--border-subtle)",
										padding: "2px 6px",
										borderRadius: 4,
										background: "var(--surface-low)",
									}}
								>
									Coming soon
								</span>
							</div>
							<p
								style={{
									fontSize: 13.5,
									color: "var(--foreground)",
									marginBottom: 12,
									lineHeight: 1.5,
								}}
							>
								{p.desc}
							</p>
							<div
								style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
							>
								{p.items.map((it) => (
									<span
										key={it}
										className="landing-mono"
										style={{
											fontSize: 11,
											padding: "3px 8px",
											borderRadius: 4,
											background: "var(--surface-mid)",
											color: "var(--foreground-muted)",
										}}
									>
										{it}
									</span>
								))}
							</div>
						</div>
					))}
				</div>
			</Reveal>

			<Reveal delay={80}>
				<div
					style={{
						marginTop: 16,
						padding: "12px 16px",
						border: "1px solid var(--border-subtle)",
						background: "var(--surface-low)",
						borderRadius: "var(--surface-radius)",
						display: "flex",
						alignItems: "center",
						gap: 14,
						flexWrap: "wrap",
						justifyContent: "space-between",
					}}
				>
					<span style={{ fontSize: 13, color: "var(--foreground-muted)" }}>
						<code style={{ color: AP_ACCENT, fontSize: 12 }}>
							$ autopilot pack install @questpie/pack-marketing-content
						</code>
					</span>
					<span
						className="landing-mono"
						style={{ fontSize: 11, color: "var(--foreground-subtle)" }}
					>
						registry · @questpie / public · private soon
					</span>
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 720px) { .landing-packs-grid { grid-template-columns: 1fr !important; } }
			`}</style>
		</Section>
	);
}

/* ============================================================
 * RUNTIME + MCP
 * ============================================================ */
const RUNTIMES_AP = [
	{ name: "Anthropic", sub: "Claude SDK", state: "Active" },
	{ name: "OpenAI", sub: "Codex SDK", state: "Active" },
	{ name: "Local", sub: "Ollama et al.", state: "Active" },
	{ name: "Custom", sub: "BYO endpoint", state: "Active" },
	{ name: "Gemini", sub: "Vertex / API", state: "Planned" },
	{ name: "Cursor", sub: "Agent SDK", state: "Planned" },
];

export function RuntimeMCPSection() {
	return (
		<Section id="agents" pad="48px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Agents · Runtime · MCP"
					eyebrowColor={AP_ACCENT}
					title="Agents your data trusts. Models you choose."
					lede="An agent is a profile: capability, allowed tools, MCP scope. Point it at a provider. Anthropic, OpenAI, local. And let it work through the same RBAC rules that apply to your humans."
				/>
			</Reveal>

			<div
				className="landing-rt-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
					gap: 28,
				}}
			>
				<Reveal>
					<div
						style={{
							border: "1px solid var(--border-subtle)",
							borderRadius: "var(--surface-radius)",
							background: "var(--card)",
							padding: 18,
							height: "100%",
							display: "flex",
							flexDirection: "column",
							gap: 14,
						}}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "flex-end",
								flexWrap: "wrap",
								gap: 12,
							}}
						>
							<div>
								<div
									className="landing-eyebrow"
									style={{ marginBottom: 4 }}
								>
									Providers
								</div>
								<div
									style={{
										fontSize: 15,
										color: "var(--foreground)",
										fontWeight: 500,
									}}
								>
									Bring the model. Or run it on-prem.
								</div>
							</div>
							<span
								className="landing-mono"
								style={{ fontSize: 11, color: "var(--foreground-subtle)" }}
							>
								providers · capabilities · models
							</span>
						</div>

						<div
							className="landing-runtime-matrix"
							style={{
								display: "grid",
								gridTemplateColumns: "repeat(3, minmax(0,1fr))",
								gap: 0,
								border: "1px solid var(--border-subtle)",
								borderRadius: "var(--control-radius)",
								overflow: "hidden",
							}}
						>
							{RUNTIMES_AP.map((r, i) => {
								const lastInRow = (i + 1) % 3 === 0;
								const lastRow = i >= RUNTIMES_AP.length - 3;
								const active = r.state === "Active";
								return (
									<div
										key={r.name}
										style={{
											padding: "14px 12px",
											borderRight: lastInRow
												? "none"
												: "1px solid var(--border-subtle)",
											borderBottom: lastRow
												? "none"
												: "1px solid var(--border-subtle)",
											background: "var(--surface-low)",
											display: "flex",
											flexDirection: "column",
											gap: 2,
										}}
									>
										<div
											style={{
												fontSize: 13,
												color: "var(--foreground)",
												fontWeight: 500,
											}}
										>
											{r.name}
										</div>
										<div
											className="landing-mono"
											style={{
												fontSize: 11,
												color: "var(--foreground-subtle)",
											}}
										>
											{r.sub}
										</div>
										<div
											className="landing-mono"
											style={{
												marginTop: 4,
												fontSize: 10,
												color: active
													? AP_ACCENT
													: "var(--foreground-subtle)",
												letterSpacing: "0.04em",
												textTransform: "uppercase",
											}}
										>
											{r.state}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				</Reveal>

				<Reveal delay={80}>
					<div
						id="mcp"
						style={{
							border: "1px solid var(--border-subtle)",
							borderRadius: "var(--surface-radius)",
							background: "var(--card)",
							padding: 18,
							height: "100%",
							display: "flex",
							flexDirection: "column",
							gap: 14,
						}}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "flex-end",
								flexWrap: "wrap",
								gap: 12,
							}}
						>
							<div>
								<div
									className="landing-eyebrow"
									style={{ marginBottom: 4 }}
								>
									MCP
								</div>
								<div
									style={{
										fontSize: 15,
										color: "var(--foreground)",
										fontWeight: 500,
									}}
								>
									Your data, safely exposed.
								</div>
							</div>
							<span
								className="landing-mono"
								style={{ fontSize: 11, color: "var(--foreground-subtle)" }}
							>
								model context protocol
							</span>
						</div>

						<div
							style={{
								border: "1px solid var(--border-subtle)",
								borderRadius: "var(--control-radius)",
								background: "var(--surface-low)",
								padding: 14,
								fontFamily: "var(--font-mono)",
								fontSize: 12,
								color: "var(--foreground-muted)",
								lineHeight: 1.7,
								overflowX: "auto",
							}}
						>
							<div>collections:</div>
							<div style={{ paddingLeft: 14 }}>
								<span style={{ color: AP_ACCENT }}>tasks</span>: read, write
							</div>
							<div style={{ paddingLeft: 14 }}>
								<span style={{ color: AP_ACCENT }}>knowledge</span>: read,
								write, delete
							</div>
							<div style={{ paddingLeft: 14 }}>
								<span style={{ color: AP_ACCENT }}>schedules</span>: read,
								write
							</div>
							<div
								style={{
									paddingLeft: 14,
									color: "var(--foreground-subtle)",
								}}
							>
								projects, runs, providers: read
							</div>
							<div style={{ marginTop: 6 }}>routes:</div>
							<div style={{ paddingLeft: 14 }}>
								exposeAnnotated: <span style={{ color: AP_ACCENT }}>true</span>
							</div>
							<div style={{ marginTop: 6 }}>resources: schemas + routes</div>
						</div>

						<p
							style={{
								fontSize: 12.5,
								color: "var(--foreground-muted)",
								lineHeight: 1.55,
								margin: 0,
							}}
						>
							Same RBAC as humans. Annotated routes auto-discovered as tools.
							Schemas and OpenAPI shipped as MCP resources, so agents know your
							data model without you wiring prompts.
						</p>
					</div>
				</Reveal>
			</div>

			<style>{`
				@media (max-width: 980px) {
					.landing-rt-grid { grid-template-columns: 1fr !important; }
					.landing-runtime-matrix { grid-template-columns: repeat(2, 1fr) !important; }
				}
			`}</style>
		</Section>
	);
}

/* ============================================================
 * QAP COCKPIT (CLI/TUI)
 * ============================================================ */
export function QapCockpit() {
	return (
		<Section pad="48px 24px 96px">
			<Reveal>
				<SectionHeading
					eyebrow="Developer cockpit · planned"
					eyebrowColor={AP_ACCENT}
					title="A terminal cockpit, in the same package."
					lede="The same product, operated from your terminal. Open in any repo, inspect runs, steer sessions, retry failed steps. Keyboard-first, session-scoped. Ships with the Autopilot package."
				/>
			</Reveal>

			<div
				className="landing-qap-grid"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
					gap: 28,
					alignItems: "stretch",
				}}
			>
				<Reveal>
					<QapTui />
				</Reveal>

				<Reveal delay={80}>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 12,
							height: "100%",
						}}
					>
						<QapCommandRow
							cmd="autopilot"
							sub="open the TUI in the current workspace"
						/>
						<QapCommandRow
							cmd="autopilot status"
							sub="health, current run, ready tasks"
						/>
						<QapCommandRow
							cmd="autopilot run-task QAP-246"
							sub="execute one issue in a fresh session"
						/>
						<QapCommandRow
							cmd="autopilot logs --follow"
							sub="condensed session log, conversation mode"
						/>
						<QapCommandRow
							cmd="autopilot retry QAP-238"
							sub="re-run a failed task with remediation"
						/>
						<QapCommandRow
							cmd="autopilot note QAP-246 'focus only on HookContext'"
							sub="persistent steering for the next step"
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
							Same product mental model (Issues, Workflows, Schedules),
							session-scoped logs, command palette with autocomplete on issue
							IDs and projects. Coming with the Autopilot package.
						</div>
					</div>
				</Reveal>
			</div>

			<style>{`
				@media (max-width: 980px) {
					.landing-qap-grid { grid-template-columns: 1fr !important; }
				}
			`}</style>
		</Section>
	);
}

function QapCommandRow({ cmd, sub }: { cmd: string; sub: string }) {
	return (
		<div
			style={{
				padding: "10px 14px",
				border: "1px solid var(--border-subtle)",
				borderRadius: "var(--control-radius)",
				background: "var(--card)",
				display: "flex",
				flexDirection: "column",
				gap: 2,
			}}
		>
			<code style={{ fontSize: 12.5, color: "var(--foreground)" }}>
				<span style={{ color: "var(--foreground-subtle)" }}>$ </span>
				<span style={{ color: AP_ACCENT }}>{cmd.split(" ")[0]}</span>
				{cmd.includes(" ") && (
					<span style={{ color: "var(--foreground)" }}>
						{cmd.slice(cmd.indexOf(" "))}
					</span>
				)}
			</code>
			<span style={{ fontSize: 12, color: "var(--foreground-muted)" }}>
				{sub}
			</span>
		</div>
	);
}

function QapTui() {
	return (
		<div
			style={{
				border: "1px solid var(--border-subtle)",
				borderRadius: "var(--surface-radius)",
				background: "#0a0a0a",
				overflow: "hidden",
				boxShadow: "var(--floating-shadow)",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "8px 12px",
					borderBottom: "1px solid #222",
					background: "#0f0f0f",
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
								background: "#222",
							}}
						/>
					))}
				</div>
				<span
					className="landing-mono"
					style={{ fontSize: 11, color: "#666" }}
				>
					~/dev/marekstreet · autopilot
				</span>
				<span
					className="landing-mono"
					style={{ marginLeft: "auto", fontSize: 10, color: "#888" }}
				>
					mock
				</span>
			</div>
			<pre
				className="landing-thin-scroll"
				style={{
					margin: 0,
					padding: "16px 18px",
					fontFamily: "var(--font-mono)",
					fontSize: 12.5,
					lineHeight: 1.7,
					color: "#d0d0d0",
					background: "#0a0a0a",
					overflowX: "auto",
				}}
			>
				<span style={{ color: AP_ACCENT }}>■ QUESTPIE AUTOPILOT</span>
				{"\n"}
				<span style={{ color: "#888" }}>
					marekstreet / marketing-site / session 676dcda1 / anthropic
				</span>
				{"\n\n"}
				<span style={{ color: "#888" }}>State</span>
				{"\n"}
				<span style={{ color: "#67e895" }}>done 4</span> <span>ready 15</span>{" "}
				<span style={{ color: "#ff6f6f" }}>failed 1</span>{" "}
				<span style={{ color: "#888" }}>todo 40</span>
				{"\n\n"}
				<span style={{ color: "#888" }}>Current</span>
				{"\n"}
				task: <span style={{ color: "#eab308" }}>QAP-246</span>
				{"\n"}
				phase: validation{"\n"}
				last event: Bash{"\n\n"}
				<span style={{ color: "#888" }}>Ready</span>
				{"\n"}
				QAP-256 draft weekly newsletter{"\n"}
				QAP-247 bug DNS edge-case{"\n"}
				QAP-248 task onboard partner shop{"\n\n"}
				<span style={{ color: "#888" }}>Failed</span>
				{"\n"}
				<span style={{ color: "#ff6f6f" }}>
					QAP-238 Primary validation failed
				</span>
				{"\n\n"}
				<span style={{ color: AP_ACCENT }}>$</span> /run-task QAP-256
				<span
					style={{
						color: AP_ACCENT,
						animation: "landing-blink 1s steps(1) infinite",
					}}
				>
					▍
				</span>
			</pre>
		</div>
	);
}

/* ============================================================
 * OPEN SOURCE
 * ============================================================ */
export function OpenSourceSection() {
	return (
		<Section pad="32px 24px 96px">
			<Reveal>
				<div
					className="landing-oss-grid"
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
						<Eyebrow dot color={AP_ACCENT}>
							Open source · Two paths
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
							Self-host the open package. Or run hosted on Cloud.
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
							Autopilot is MIT. Self-host as long as you like. Workflows are
							TypeScript, schemas are Drizzle, everything stays in git. When you
							outgrow one machine, point{" "}
							<Link to="/cloud" style={{ color: AP_ACCENT }}>
								Cloud
							</Link>{" "}
							at the same project. Hosted Autopilot inherits all of it: same
							code, same data, plus managed runtime and the Cloud deploy bridge.
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
								View source
							</a>
							<a
								className="landing-btn landing-btn-ghost landing-btn-sm"
								href="/cloud#hosted-autopilot"
								onClick={(e) =>
									smoothScrollNavigate("/cloud#hosted-autopilot", e)
								}
							>
								See hosted Autopilot
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
						<div style={{ color: "var(--foreground-subtle)" }}>
							{`# Self-host the open package`}
						</div>
						<div>
							<span style={{ color: "var(--syntax-keyword)" }}>$</span> bun add{" "}
							<span style={{ color: "var(--syntax-string)" }}>
								@questpie/autopilot
							</span>
						</div>
						<div>
							<span style={{ color: "var(--syntax-keyword)" }}>$</span> bunx
							questpie migrate:up
						</div>
						<div>
							<span style={{ color: "var(--syntax-keyword)" }}>$</span> bun dev
						</div>
						<div style={{ marginTop: 14, color: "var(--foreground-subtle)" }}>
							{`# Open the TUI cockpit (coming with the package)`}
						</div>
						<div>
							<span style={{ color: "var(--syntax-keyword)" }}>$</span> bunx
							@questpie/autopilot
						</div>
					</div>
				</div>
			</Reveal>

			<style>{`
				@media (max-width: 980px) { .landing-oss-grid { grid-template-columns: 1fr !important; gap: 24px !important; } }
			`}</style>
		</Section>
	);
}
