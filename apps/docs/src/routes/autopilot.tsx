import { Icon } from "@iconify/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import {
	generateLinks,
	generateMeta,
	siteConfig,
} from "@/lib/seo";

export const Route = createFileRoute("/autopilot")({
	component: AutopilotPage,
	head: () => ({
		links: generateLinks({ url: "/autopilot" }),
		meta: generateMeta({
			title: "QUESTPIE Autopilot — AI agents that run your business",
			description:
				"Open-source AI operations layer. Agents that handle content creation, SEO, analytics, task management, and workflow automation. Transparent, inspectable, and built to work alongside your team.",
			url: "/autopilot",
			keywords: [
				"AI business automation",
				"AI agents for business",
				"business workflow automation",
				"AI content creation",
				"AI SEO optimization",
				"open source AI agents",
				"business operations AI",
				"AI task management",
				"durable workflows",
				"MCP AI agents",
				"AI knowledge management",
			],
		}),
		scripts: [
			{
				type: "application/ld+json",
				children: JSON.stringify({
					"@context": "https://schema.org",
					"@type": "SoftwareApplication",
					name: "QUESTPIE Autopilot",
					applicationCategory: "BusinessApplication",
					operatingSystem: "Any",
					description:
						"Open-source AI agents that run your business — content, SEO, analytics, task management, and workflow automation.",
					url: `${siteConfig.url}/autopilot`,
					codeRepository: "https://github.com/questpie/questpie",
					license: "https://opensource.org/licenses/MIT",
					offers: {
						"@type": "Offer",
						price: "0",
						priceCurrency: "USD",
					},
				}),
			},
		],
	}),
	headers: () => ({
		"Cache-Control":
			"public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
	}),
	staleTime: 60 * 60_000,
	gcTime: 2 * 60 * 60_000,
});

function Reveal({
	children,
	className,
	delay,
}: { children: ReactNode; className?: string; delay?: number }) {
	return (
		<div
			data-reveal
			className={cn(
				"translate-y-4 opacity-0 transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] data-[visible]:translate-y-0 data-[visible]:opacity-100",
				className,
			)}
			style={delay ? { transitionDelay: `${delay}ms` } : undefined}
		>
			{children}
		</div>
	);
}

const ctaBase =
	"inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--control-radius)] px-4 py-2 text-sm font-medium transition-[background-color,color,opacity,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)] active:scale-[0.97]";
const primaryCta = cn(ctaBase, "bg-[#4ade80] text-black hover:opacity-90");
const secondaryCta = cn(
	ctaBase,
	"border-border-subtle bg-surface-low text-foreground hover:bg-surface-mid border",
);

const CAPABILITIES = [
	{
		icon: "ph:pencil-line",
		title: "Content creation",
		description:
			"Generate blog posts, product descriptions, and marketing copy from your brand voice. AI writes, you approve.",
	},
	{
		icon: "ph:magnifying-glass",
		title: "SEO optimization",
		description:
			"Analyze pages, suggest improvements, and auto-optimize metadata across your entire site.",
	},
	{
		icon: "ph:chart-line-up",
		title: "Business analytics",
		description:
			"Track performance, surface insights, and get actionable recommendations — not just dashboards.",
	},
	{
		icon: "ph:kanban",
		title: "Task & project management",
		description:
			"AI agents create, assign, prioritize, and track tasks. Replace your project management tool entirely.",
	},
	{
		icon: "ph:users",
		title: "People management",
		description:
			"Team directory, roles, permissions, availability. Agents assign work based on skills and capacity.",
	},
	{
		icon: "ph:book-open-text",
		title: "Knowledge management",
		description:
			"Company knowledge base with semantic search. AI finds answers, not just keywords. Like Google Drive, but smart.",
	},
	{
		icon: "ph:git-branch",
		title: "Workflow automation",
		description:
			"Durable workflows with step-level persistence. Automate any multi-step business process.",
	},
	{
		icon: "ph:chat-circle-text",
		title: "AI chat",
		description:
			"Context-aware chat that understands your business data. Ask questions, give commands, get reports.",
	},
];

const WORKFLOW_PRIMITIVES = [
	{
		code: 'step.run("charge", fn)',
		description: "Execute a named task. Result is persisted — safe to retry.",
	},
	{
		code: 'step.sleep("wait", "2h")',
		description: "Pause for hours, days, or weeks. State is persisted to the database.",
	},
	{
		code: 'step.waitForEvent("approval")',
		description: "Block until an external event arrives — human approval, webhook, signal.",
	},
	{
		code: 'step.invoke("sub-workflow")',
		description: "Call another workflow. Compose complex processes from simple pieces.",
	},
];

const AGENT_RUNTIMES = [
	{ name: "Claude Code", status: "In progress" },
	{ name: "Codex (OpenAI)", status: "In progress" },
	{ name: "OpenCode", status: "Planned" },
	{ name: "Gemini", status: "Planned" },
	{ name: "GitHub Copilot", status: "Planned" },
	{ name: "Cursor", status: "Planned" },
];

const FAQ_ITEMS = [
	{
		q: "What are AI agents in QUESTPIE Autopilot?",
		a: "AI agents are autonomous programs that handle repetitive business tasks alongside your human team. They can create content, optimize SEO, manage projects, automate workflows, and answer questions about your business data. Every decision is inspectable and auditable.",
	},
	{
		q: "Is Autopilot really open source?",
		a: "Yes. QUESTPIE Autopilot is MIT-licensed. You can self-host it on your own infrastructure, inspect every line of code, and modify it to your needs. No black box AI — full transparency.",
	},
	{
		q: "How do durable workflows work?",
		a: "Each workflow step persists its result to the database. If the process restarts, completed steps are skipped — no re-execution, no duplicate side effects. Steps can sleep for hours or days, wait for external events, and invoke sub-workflows. Error handling and compensation are explicit — you define what happens on failure.",
	},
	{
		q: "What is MCP and why does it matter?",
		a: "MCP (Model Context Protocol) lets AI agents access your business data safely. Every collection becomes CRUD tools, custom API endpoints become callable, and the same permission rules that apply to human users apply to agents. Your AI can read and write your data, but only what it's allowed to.",
	},
	{
		q: "Can I use Autopilot without Cloud?",
		a: "Absolutely. Self-host Autopilot on your own servers. It works with QUESTPIE Framework out of the box. Cloud just adds managed hosting and scaling for those who don't want to handle infrastructure.",
	},
	{
		q: "What AI models does Autopilot support?",
		a: "The agent runtime connects to AI coding agents via spawn-agent. Claude Code and Codex (OpenAI) are in active development. OpenCode, Gemini, GitHub Copilot, and Cursor are planned. You configure which runtimes to use per agent profile.",
	},
	{
		q: "When will Autopilot be available?",
		a: "Autopilot is in active development. Join the waitlist to get early access. Framework is available now — start building today and add Autopilot when it launches.",
	},
];

function WaitlistForm() {
	const [email, setEmail] = useState("");
	const [submitted, setSubmitted] = useState(false);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!email) return;
		setSubmitted(true);
	};

	if (submitted) {
		return (
			<div className="inline-flex items-center gap-2 rounded-full bg-[#4ade80]/10 px-5 py-2.5 text-sm font-medium text-[#4ade80]">
				<Icon ssr icon="ph:check-circle" width={16} height={16} />
				You're on the list for QUESTPIE Autopilot.
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
				className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--control-radius)] bg-[#4ade80] px-4 text-sm font-medium text-black transition-opacity hover:opacity-90 active:opacity-75"
			>
				Get early access
				<Icon ssr icon="ph:arrow-right" width={14} height={14} />
			</button>
		</form>
	);
}

function FAQItem({ item }: { item: (typeof FAQ_ITEMS)[number] }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="border-border-subtle border-b">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center justify-between gap-4 py-4 text-left"
			>
				<h3 className="text-foreground text-[15px] font-medium">{item.q}</h3>
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
					<div className="text-muted-foreground pb-4 text-sm leading-relaxed">
						{item.a}
					</div>
				</div>
			</div>
		</div>
	);
}

function SubpageNav() {
	return (
		<header className="bg-background/60 border-border-subtle fixed inset-x-0 top-0 z-50 h-14 border-b backdrop-blur-xl">
			<div className="mx-auto flex h-full max-w-5xl items-center justify-between px-6">
				<div className="flex items-center gap-6">
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
					<span className="text-muted-foreground text-sm">/</span>
					<span className="text-foreground text-sm font-medium">Autopilot</span>
				</div>
				<div className="flex items-center gap-2">
					<ThemeToggle />
					<Link to="/" className={secondaryCta}>
						Back to home
					</Link>
				</div>
			</div>
		</header>
	);
}

function AutopilotPage() {
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
		<div className="bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
			<SubpageNav />

			<main className="relative isolate overflow-hidden bg-background">
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,color-mix(in_srgb,#4ade80_8%,transparent)_0,transparent_60%)]"
				/>

				<div className="relative z-10">
					{/* Hero */}
					<section className="mt-14 px-6 pt-24 pb-16 md:pt-36 md:pb-24">
						<div className="mx-auto max-w-3xl text-center">
							<div className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#4ade80]/10 px-3 py-1 text-xs font-medium text-[#4ade80]">
								<Icon ssr icon="ph:clock" width={12} height={12} />
								Coming soon — join the waitlist
							</div>

							<h1 className="text-foreground mb-6 text-4xl leading-[1.08] font-semibold text-balance md:text-5xl lg:text-6xl">
								AI agents that{" "}
								<br className="hidden sm:block" />
								<span className="text-[#4ade80]">run your business.</span>
							</h1>

							<p className="text-muted-foreground mx-auto mb-10 max-w-xl text-lg leading-relaxed text-pretty">
								Not a chatbot — a team of AI agents that operate your company
								alongside your human team. Content, SEO, tasks, knowledge,
								automation. Open source, transparent, inspectable.
							</p>

							<div className="mx-auto max-w-md">
								<WaitlistForm />
							</div>
						</div>
					</section>

					{/* Capabilities */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-5xl">
								<h2 className="text-foreground mb-4 text-center text-3xl font-semibold md:text-4xl">
									What Autopilot handles for you
								</h2>
								<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-center text-lg leading-relaxed">
									Each capability is an AI agent that works alongside your team.
									Transparent decisions, auditable actions.
								</p>

								<div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--surface-radius)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-4">
									{CAPABILITIES.map((cap) => (
										<div key={cap.title} className="bg-background p-5">
											<Icon
												ssr
												icon={cap.icon}
												width={18}
												height={18}
												className="mb-3 text-[#4ade80]"
											/>
											<h3 className="text-foreground mb-1 text-sm font-medium">
												{cap.title}
											</h3>
											<p className="text-muted-foreground text-[13px] leading-relaxed">
												{cap.description}
											</p>
										</div>
									))}
								</div>
							</div>
						</section>
					</Reveal>

					{/* Durable Workflows */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-5xl">
								<div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
									<div>
										<h2 className="text-foreground mb-4 text-3xl font-semibold md:text-4xl">
											Workflows that never break
										</h2>
										<p className="text-muted-foreground mb-8 max-w-md text-lg leading-relaxed">
											Every step persists its result. If the process restarts,
											completed steps are skipped automatically. Sleep for days,
											wait for events, compose sub-workflows.
										</p>

										<div className="flex flex-col gap-3">
											{WORKFLOW_PRIMITIVES.map((p) => (
												<div key={p.code} className="flex gap-3">
													<code className="text-primary shrink-0 font-mono text-xs leading-relaxed">
														{p.code}
													</code>
													<span className="text-muted-foreground text-xs leading-relaxed">
														{p.description}
													</span>
												</div>
											))}
										</div>
									</div>

									<div className="glass-panel overflow-hidden rounded-[var(--surface-radius)] border">
										<div className="border-border-subtle border-b px-4 py-2.5">
											<span className="text-muted-foreground font-mono text-xs">
												workflows/onboarding.ts
											</span>
										</div>
										<div className="text-muted-foreground overflow-x-auto p-5 font-mono text-[13px] leading-[1.8] whitespace-pre">
											<span className="text-primary font-semibold">export default</span>{" "}
											<span className="text-[var(--syntax-function)]">workflow</span>
											{"(\n  "}
											<span className="text-[var(--syntax-string)]">"onboard-customer"</span>
											{",\n  "}
											<span className="text-primary font-semibold">async</span>
											{" (step, { email }) => {\n    "}
											<span className="text-primary font-semibold">const</span>
											{" user = "}
											<span className="text-primary font-semibold">await</span>
											{" step."}
											<span className="text-[var(--syntax-function)]">run</span>
											{"(\n      "}
											<span className="text-[var(--syntax-string)]">"create-account"</span>
											{",\n      () => createUser(email)\n    );\n\n    "}
											<span className="text-primary font-semibold">await</span>
											{" step."}
											<span className="text-[var(--syntax-function)]">run</span>
											{"("}
											<span className="text-[var(--syntax-string)]">"send-welcome"</span>
											{",\n      () => sendEmail(user)\n    );\n\n    "}
											<span className="text-primary font-semibold">await</span>
											{" step."}
											<span className="text-[var(--syntax-function)]">sleep</span>
											{"("}
											<span className="text-[var(--syntax-string)]">"trial"</span>
											{", "}
											<span className="text-[var(--syntax-string)]">"14d"</span>
											{");\n\n    "}
											<span className="text-primary font-semibold">await</span>
											{" step."}
											<span className="text-[var(--syntax-function)]">run</span>
											{"("}
											<span className="text-[var(--syntax-string)]">"check-in"</span>
											{",\n      () => sendCheckIn(user)\n    );\n  }\n)"}
										</div>
									</div>
								</div>
							</div>
						</section>
					</Reveal>

					{/* Agent Runtimes */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-3xl text-center">
								<h2 className="text-foreground mb-4 text-3xl font-semibold md:text-4xl">
									Works with your favorite AI
								</h2>
								<p className="text-muted-foreground mx-auto mb-8 max-w-xl text-lg leading-relaxed">
									Pluggable agent runtime. Configure which models to use per
									agent profile. The system picks the best available provider.
								</p>

								<div className="mx-auto grid max-w-lg grid-cols-2 gap-px overflow-hidden rounded-[var(--surface-radius)] bg-[var(--border-subtle)] sm:grid-cols-3">
									{AGENT_RUNTIMES.map((rt) => (
										<div
											key={rt.name}
											className="bg-background flex flex-col items-center justify-center gap-1 p-4"
										>
											<span className="text-foreground text-sm">{rt.name}</span>
											<span className={cn(
												"text-[11px]",
												rt.status === "In progress" ? "text-[#4ade80]" : "text-muted-foreground",
											)}>
												{rt.status}
											</span>
										</div>
									))}
								</div>
							</div>
						</section>
					</Reveal>

					{/* MCP */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-3xl">
								<h2 className="text-foreground mb-4 text-center text-3xl font-semibold md:text-4xl">
									Your data, accessible to AI — safely
								</h2>
								<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-center text-lg leading-relaxed">
									MCP (Model Context Protocol) exposes your business data to AI
									agents with the same access control rules that apply to humans.
								</p>

								<div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--surface-radius)] bg-[var(--border-subtle)] sm:grid-cols-2">
									{[
										{
											icon: "ph:database",
											title: "Auto-expose collections",
											desc: "Every collection becomes CRUD tools — list, create, read, update, delete.",
										},
										{
											icon: "ph:plug",
											title: "Auto-expose routes",
											desc: "Custom API endpoints become callable tools for any AI agent.",
										},
										{
											icon: "ph:shield-check",
											title: "Access control",
											desc: "Same permission rules apply to agents as to humans. Row-level, field-level.",
										},
										{
											icon: "ph:wrench",
											title: "Custom MCP tools",
											desc: "Define domain-specific tools. Agents discover your data model via schema resources.",
										},
									].map((item) => (
										<div key={item.title} className="bg-background p-5">
											<Icon
												ssr
												icon={item.icon}
												width={18}
												height={18}
												className="mb-3 text-[#4ade80]"
											/>
											<h3 className="text-foreground mb-1 text-sm font-medium">
												{item.title}
											</h3>
											<p className="text-muted-foreground text-[13px] leading-relaxed">
												{item.desc}
											</p>
										</div>
									))}
								</div>
							</div>
						</section>
					</Reveal>

					{/* Open source */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="glass-panel mx-auto max-w-2xl rounded-[var(--surface-radius)] border p-8 text-center">
								<Icon
									ssr
									icon="ph:lock-open"
									width={24}
									height={24}
									className="text-foreground mx-auto mb-4"
								/>
								<h2 className="text-foreground mb-2 text-xl font-semibold">
									100% open source. MIT licensed.
								</h2>
								<p className="text-muted-foreground mb-6 text-sm leading-relaxed">
									Every agent decision is inspectable. Every workflow step is
									auditable. Fork it, modify it, self-host it. No black box AI.
								</p>
								<div className="flex flex-wrap items-center justify-center gap-3">
									<a
										href="https://github.com/questpie/questpie"
										target="_blank"
										rel="noreferrer"
										className={secondaryCta}
									>
										<Icon ssr icon="ph:github-logo" width={16} height={16} />
										View source
									</a>
									<Link
										to="/docs/$"
										params={{ _splat: "start-here/first-app" }}
										className={secondaryCta}
									>
										Start with Framework
									</Link>
								</div>
							</div>
						</section>
					</Reveal>

					{/* FAQ */}
					<Reveal>
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
					</Reveal>

					{/* Final CTA */}
					<section className="px-6 py-24 text-center md:py-32">
						<h2 className="text-foreground mb-4 text-3xl font-semibold text-balance md:text-4xl">
							Be the first to try QUESTPIE Autopilot.
						</h2>
						<p className="text-muted-foreground mx-auto mb-8 max-w-md text-lg leading-relaxed">
							Join the waitlist for early access. Framework is available now —
							start building and add Autopilot when it launches.
						</p>
						<div className="mx-auto max-w-md">
							<WaitlistForm />
						</div>
					</section>
				</div>
			</main>
		</div>
	);
}
