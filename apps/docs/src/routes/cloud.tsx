import { Icon } from "@iconify/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import {
	generateJsonLd,
	generateLinks,
	generateMeta,
	siteConfig,
} from "@/lib/seo";

export const Route = createFileRoute("/cloud")({
	component: CloudPage,
	head: () => ({
		links: generateLinks({ url: "/cloud" }),
		meta: generateMeta({
			title: "QUESTPIE Cloud — Managed hosting for your business",
			description:
				"Go from template to live site in minutes. Managed hosting, AI-powered website builder, custom domains, and one-click deployment. No terminal, no DevOps.",
			url: "/cloud",
			keywords: [
				"managed CMS hosting",
				"website builder with AI",
				"one-click website deployment",
				"managed business platform",
				"CMS cloud hosting",
				"AI website builder",
				"no-code website builder",
				"business website platform",
				"managed TypeScript hosting",
				"website templates for business",
			],
		}),
		scripts: [
			{
				type: "application/ld+json",
				children: JSON.stringify({
					"@context": "https://schema.org",
					"@type": "SoftwareApplication",
					name: "QUESTPIE Cloud",
					applicationCategory: "BusinessApplication",
					operatingSystem: "Any",
					description:
						"Managed hosting, AI-powered website builder, templates, and one-click deployment for QUESTPIE.",
					url: `${siteConfig.url}/cloud`,
					offers: {
						"@type": "AggregateOffer",
						lowPrice: "0",
						priceCurrency: "USD",
						offerCount: "4",
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
const primaryCta = cn(ctaBase, "bg-[#60a5fa] text-black hover:opacity-90");
const secondaryCta = cn(
	ctaBase,
	"border-border-subtle bg-surface-low text-foreground hover:bg-surface-mid border",
);

const FEATURES = [
	{
		icon: "ph:paint-brush",
		title: "AI website builder",
		description:
			"Describe what you want in natural language. AI builds and customizes your site live — colors, layout, content, components.",
	},
	{
		icon: "ph:browser",
		title: "Template library",
		description:
			"Industry-specific templates for restaurants, shops, portfolios, agencies, and more. Professional designs, ready to customize.",
	},
	{
		icon: "ph:rocket-launch",
		title: "One-click deploy",
		description:
			"Push changes to production instantly. Durable deploy workflows with health checks before switchover.",
	},
	{
		icon: "ph:globe",
		title: "Custom domains & SSL",
		description:
			"Connect your domain, automatic SSL certificates, DNS configuration — all from one dashboard.",
	},
	{
		icon: "ph:database",
		title: "Managed infrastructure",
		description:
			"PostgreSQL databases, object storage, email domains — auto-provisioned and backed up. You never touch a server.",
	},
	{
		icon: "ph:robot",
		title: "Managed Autopilot",
		description:
			"QUESTPIE Autopilot AI agents, hosted and scaled for you. Content creation, SEO, analytics — zero setup.",
	},
	{
		icon: "ph:chart-bar",
		title: "Built-in analytics",
		description:
			"Traffic, engagement, and conversion tracking. No third-party scripts needed. Privacy-friendly by default.",
	},
	{
		icon: "ph:shield-check",
		title: "Enterprise ready",
		description:
			"Multi-environment management, team roles, API keys, audit logs, and priority support for growing businesses.",
	},
];

const STEPS = [
	{
		num: "1",
		title: "Pick a template",
		description: "Choose an industry-specific starting point designed for your business type.",
	},
	{
		num: "2",
		title: "Customize with AI",
		description:
			'Tell the AI what you want — "Make the hero blue, add a contact form, change the pricing." It builds it live.',
	},
	{
		num: "3",
		title: "Connect your domain",
		description: "Point yourbusiness.com to your site. SSL and DNS configured automatically.",
	},
	{
		num: "4",
		title: "Go live",
		description: "One click to publish. Your team manages content through the admin panel. AI handles the rest.",
	},
];

const PRICING_TIERS = [
	{
		name: "Free",
		price: "$0",
		description: "Side projects and evaluation",
		features: ["1 project", "Shared resources", "Community support", "Basic AI chat"],
	},
	{
		name: "Starter",
		price: "$19",
		period: "/mo",
		description: "Small businesses getting started",
		features: [
			"3 projects",
			"Custom domain",
			"5 GB storage",
			"Full AI chat",
			"2 Autopilot agents",
		],
	},
	{
		name: "Pro",
		price: "$49",
		period: "/mo",
		description: "Growing businesses",
		features: [
			"10 projects",
			"Multi-environment",
			"50 GB storage",
			"Unlimited agents",
			"Full workflows",
			"Knowledge base",
		],
		highlighted: true,
	},
	{
		name: "Scale",
		price: "Custom",
		description: "Enterprises with dedicated needs",
		features: [
			"Unlimited projects",
			"Dedicated resources",
			"Custom agent configs",
			"SLA & priority support",
			"Advanced automation",
		],
	},
];

const FAQ_ITEMS = [
	{
		q: "What is QUESTPIE Cloud?",
		a: "QUESTPIE Cloud is the managed hosting layer for the QUESTPIE platform. It handles infrastructure, deployment, scaling, and maintenance so you can focus on your business. It includes an AI-powered website builder, template library, managed Autopilot agents, and custom domain support.",
	},
	{
		q: "Do I need to know how to code?",
		a: "No. Cloud is designed for non-technical users. Pick a template, customize it with AI (just describe what you want), connect your domain, and publish. The admin panel for managing content is point-and-click.",
	},
	{
		q: "Can I migrate to self-hosting later?",
		a: "Yes. QUESTPIE Framework is open source. You can export your project and self-host it on your own infrastructure at any time. No vendor lock-in — your data, your code, your choice.",
	},
	{
		q: "What happens to my site if I cancel Cloud?",
		a: "You own your code and data. Export everything and self-host with QUESTPIE Framework, or migrate to any other hosting provider. Nothing is locked behind Cloud.",
	},
	{
		q: "How does AI website building work?",
		a: "Describe changes in natural language — 'Add a pricing section', 'Change the color scheme to dark blue', 'Add a contact form with email and phone fields'. The AI modifies your site in real-time with a live preview before you publish.",
	},
	{
		q: "What's included in managed Autopilot?",
		a: "Cloud includes hosted QUESTPIE Autopilot agents that handle content creation, SEO optimization, analytics, and workflow automation. The agents are pre-configured and scaled for your plan — no setup required.",
	},
	{
		q: "When will Cloud be available?",
		a: "Cloud is in active development. Join the waitlist to get early access and be notified when we launch.",
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
			<div className="inline-flex items-center gap-2 rounded-full bg-[#60a5fa]/10 px-5 py-2.5 text-sm font-medium text-[#60a5fa]">
				<Icon ssr icon="ph:check-circle" width={16} height={16} />
				You're on the list for QUESTPIE Cloud.
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
				className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--control-radius)] bg-[#60a5fa] px-4 text-sm font-medium text-black transition-opacity hover:opacity-90 active:opacity-75"
			>
				Reserve your spot
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
					<span className="text-foreground text-sm font-medium">Cloud</span>
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

function CloudPage() {
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
					className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,color-mix(in_srgb,#60a5fa_8%,transparent)_0,transparent_60%)]"
				/>

				<div className="relative z-10">
					{/* Hero */}
					<section className="mt-14 px-6 pt-24 pb-16 md:pt-36 md:pb-24">
						<div className="mx-auto max-w-3xl text-center">
							<div className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#60a5fa]/10 px-3 py-1 text-xs font-medium text-[#60a5fa]">
								<Icon ssr icon="ph:clock" width={12} height={12} />
								Coming soon — join the waitlist
							</div>

							<h1 className="text-foreground mb-6 text-4xl leading-[1.08] font-semibold text-balance md:text-5xl lg:text-6xl">
								Your business online{" "}
								<br className="hidden sm:block" />
								<span className="text-[#60a5fa]">in minutes, not months.</span>
							</h1>

							<p className="text-muted-foreground mx-auto mb-10 max-w-xl text-lg leading-relaxed text-pretty">
								Managed hosting, AI-powered website builder, and templates
								for every industry. No terminal, no DevOps, no infrastructure
								headaches.
							</p>

							<div className="mx-auto max-w-md">
								<WaitlistForm />
							</div>
						</div>
					</section>

					{/* Features */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-5xl">
								<h2 className="text-foreground mb-4 text-center text-3xl font-semibold md:text-4xl">
									Everything you need to launch
								</h2>
								<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-center text-lg leading-relaxed">
									Cloud handles hosting, deployment, and scaling.
									You focus on your business.
								</p>

								<div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--surface-radius)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-4">
									{FEATURES.map((f) => (
										<div key={f.title} className="bg-background p-5">
											<Icon
												ssr
												icon={f.icon}
												width={18}
												height={18}
												className="mb-3 text-[#60a5fa]"
											/>
											<h3 className="text-foreground mb-1 text-sm font-medium">
												{f.title}
											</h3>
											<p className="text-muted-foreground text-[13px] leading-relaxed">
												{f.description}
											</p>
										</div>
									))}
								</div>
							</div>
						</section>
					</Reveal>

					{/* How it works */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-3xl">
								<h2 className="text-foreground mb-12 text-center text-3xl font-semibold md:text-4xl">
									From template to live site
								</h2>

								<div className="flex flex-col gap-8">
									{STEPS.map((step, i) => (
										<div key={step.num} className="flex gap-4">
											<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#60a5fa]/10 text-sm font-semibold text-[#60a5fa]">
												{step.num}
											</div>
											<div>
												<h3 className="text-foreground mb-1 font-medium">
													{step.title}
												</h3>
												<p className="text-muted-foreground text-sm leading-relaxed">
													{step.description}
												</p>
											</div>
										</div>
									))}
								</div>
							</div>
						</section>
					</Reveal>

					{/* Pricing */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-5xl">
								<h2 className="text-foreground mb-4 text-center text-3xl font-semibold md:text-4xl">
									Simple, transparent pricing
								</h2>
								<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-center text-lg leading-relaxed">
									Start free. Scale as you grow. Framework stays open source forever.
								</p>

								<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
									{PRICING_TIERS.map((tier) => (
										<div
											key={tier.name}
											className={cn(
												"rounded-[var(--surface-radius)] border p-5",
												tier.highlighted
													? "border-[#60a5fa]/30 bg-[#60a5fa]/[0.04]"
													: "border-border-subtle bg-background",
											)}
										>
											<h3 className="text-foreground text-sm font-medium">
												{tier.name}
											</h3>
											<div className="mt-2 mb-1 flex items-baseline gap-0.5">
												<span className="text-foreground text-2xl font-semibold">
													{tier.price}
												</span>
												{tier.period && (
													<span className="text-muted-foreground text-sm">
														{tier.period}
													</span>
												)}
											</div>
											<p className="text-muted-foreground mb-4 text-xs">
												{tier.description}
											</p>
											<ul className="flex flex-col gap-1.5">
												{tier.features.map((f) => (
													<li
														key={f}
														className="text-muted-foreground flex items-center gap-1.5 text-xs"
													>
														<Icon
															ssr
															icon="ph:check"
															width={12}
															height={12}
															className="text-[#60a5fa]"
														/>
														{f}
													</li>
												))}
											</ul>
										</div>
									))}
								</div>
							</div>
						</section>
					</Reveal>

					{/* Open source note */}
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
									No vendor lock-in. Ever.
								</h2>
								<p className="text-muted-foreground mb-6 text-sm leading-relaxed">
									QUESTPIE Framework and Autopilot are MIT-licensed open source.
									Cloud is a convenience layer — your code and data are always
									yours. Self-host anytime.
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
										Self-host guide
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
							Be the first to try QUESTPIE Cloud.
						</h2>
						<p className="text-muted-foreground mx-auto mb-8 max-w-md text-lg leading-relaxed">
							Join the waitlist for early access. We'll notify you as
							soon as Cloud is ready.
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
