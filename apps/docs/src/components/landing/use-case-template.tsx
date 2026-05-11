import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

export type UseCaseData = {
	slug: string;
	name: string;
	headline: ReactNode;
	description: string;
	painPoints: { icon: string; title: string; description: string }[];
	solutions: { icon: string; title: string; description: string }[];
	features: { icon: string; title: string; description: string }[];
	pillars: {
		framework: string[];
		cloud: string[];
		autopilot: string[];
	};
	faq: { q: string; a: string }[];
};

const ctaBase =
	"inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--control-radius)] px-4 py-2 text-sm font-medium transition-[background-color,color,opacity,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)] active:scale-[0.97]";
const primaryCta = cn(ctaBase, "bg-[#b700ff] text-white hover:opacity-90");
const secondaryCta = cn(
	ctaBase,
	"border-border-subtle bg-surface-low text-foreground hover:bg-surface-mid border",
);

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
			<div className="inline-flex items-center gap-2 rounded-full bg-[#b700ff]/10 px-5 py-2.5 text-sm font-medium text-[#b700ff]">
				<Icon ssr icon="ph:check-circle" width={16} height={16} />
				You're on the list. We'll be in touch.
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
				className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--control-radius)] bg-[#b700ff] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 active:opacity-75"
			>
				Get early access
				<Icon ssr icon="ph:arrow-right" width={14} height={14} />
			</button>
		</form>
	);
}

function SubpageNav({ name }: { name: string }) {
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
					<span className="text-foreground text-sm font-medium">{name}</span>
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

function FAQItem({ item }: { item: { q: string; a: string } }) {
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

const PILLAR_META = [
	{
		key: "framework" as const,
		name: "Framework",
		icon: "ph:code",
		color: "#b700ff",
		description: "Open-source TypeScript engine",
	},
	{
		key: "cloud" as const,
		name: "Cloud",
		icon: "ph:cloud",
		color: "#60a5fa",
		description: "Managed hosting & AI builder",
	},
	{
		key: "autopilot" as const,
		name: "Autopilot",
		icon: "ph:robot",
		color: "#4ade80",
		description: "AI agents for operations",
	},
];

export function UseCasePage({ data }: { data: UseCaseData }) {
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
			<SubpageNav name={`For ${data.name}`} />

			<main className="relative isolate overflow-hidden bg-background">
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,color-mix(in_srgb,#b700ff_6%,transparent)_0,transparent_60%)]"
				/>

				<div className="relative z-10">
					{/* Hero */}
					<section className="mt-14 px-6 pt-24 pb-16 md:pt-36 md:pb-24">
						<div className="mx-auto max-w-3xl text-center">
							<div className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#b700ff]/10 px-3 py-1 text-xs font-medium text-[#b700ff]">
								For {data.name}
							</div>

							<h1 className="text-foreground mb-6 text-4xl leading-[1.08] font-semibold text-balance md:text-5xl lg:text-6xl">
								{data.headline}
							</h1>

							<p className="text-muted-foreground mx-auto mb-10 max-w-xl text-lg leading-relaxed text-pretty">
								{data.description}
							</p>

							<div className="flex flex-wrap items-center justify-center gap-3">
								<div className="w-full max-w-md sm:w-auto sm:flex-1">
									<WaitlistForm />
								</div>
							</div>
							<div className="mt-4 flex justify-center">
								<Link
									to="/docs/$"
									params={{ _splat: "start-here/first-app" }}
									className={cn(secondaryCta, "text-xs")}
								>
									<Icon ssr icon="ph:github-logo" width={14} height={14} />
									Try Framework free
								</Link>
							</div>
						</div>
					</section>

					{/* Pain points */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-5xl">
								<h2 className="text-foreground mb-4 text-center text-3xl font-semibold md:text-4xl">
									Sound familiar?
								</h2>
								<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-center text-lg leading-relaxed">
									The problems every {data.name.toLowerCase()} business deals
									with.
								</p>

								<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
									{data.painPoints.map((p) => (
										<div
											key={p.title}
											className="border-border-subtle bg-surface-low rounded-[var(--surface-radius)] border p-5"
										>
											<Icon
												ssr
												icon={p.icon}
												width={18}
												height={18}
												className="mb-3 text-red-400"
											/>
											<h3 className="text-foreground mb-1 text-sm font-medium">
												{p.title}
											</h3>
											<p className="text-muted-foreground text-[13px] leading-relaxed">
												{p.description}
											</p>
										</div>
									))}
								</div>
							</div>
						</section>
					</Reveal>

					{/* Solutions */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-5xl">
								<h2 className="text-foreground mb-4 text-center text-3xl font-semibold md:text-4xl">
									How QUESTPIE helps
								</h2>
								<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-center text-lg leading-relaxed">
									One platform replaces the patchwork of tools you're stitching
									together.
								</p>

								<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
									{data.solutions.map((s) => (
										<div
											key={s.title}
											className="border-border-subtle bg-surface-low rounded-[var(--surface-radius)] border p-5"
										>
											<Icon
												ssr
												icon={s.icon}
												width={18}
												height={18}
												className="mb-3 text-[#b700ff]"
											/>
											<h3 className="text-foreground mb-1 text-sm font-medium">
												{s.title}
											</h3>
											<p className="text-muted-foreground text-[13px] leading-relaxed">
												{s.description}
											</p>
										</div>
									))}
								</div>
							</div>
						</section>
					</Reveal>

					{/* Features grid */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-5xl">
								<h2 className="text-foreground mb-4 text-center text-3xl font-semibold md:text-4xl">
									Everything you need, built in
								</h2>
								<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-center text-lg leading-relaxed">
									No plugins to install, no integrations to configure. It just
									works.
								</p>

								<div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--surface-radius)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-4">
									{data.features.map((f) => (
										<div key={f.title} className="bg-background p-5">
											<Icon
												ssr
												icon={f.icon}
												width={18}
												height={18}
												className="mb-3 text-[#b700ff]"
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

					{/* Three pillars */}
					<Reveal>
						<section className="px-6 py-16 md:py-24">
							<div className="mx-auto max-w-5xl">
								<h2 className="text-foreground mb-4 text-center text-3xl font-semibold md:text-4xl">
									Three products, one platform
								</h2>
								<p className="text-muted-foreground mx-auto mb-12 max-w-xl text-center text-lg leading-relaxed">
									Framework, Cloud, and Autopilot work together so you don't
									have to.
								</p>

								<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
									{PILLAR_META.map((pillar) => (
										<div
											key={pillar.key}
											className="border-border-subtle rounded-[var(--surface-radius)] border p-6"
										>
											<div className="mb-4 flex items-center gap-3">
												<Icon
													ssr
													icon={pillar.icon}
													width={20}
													height={20}
													style={{ color: pillar.color }}
												/>
												<div>
													<h3 className="text-foreground text-sm font-medium">
														{pillar.name}
													</h3>
													<p className="text-muted-foreground text-xs">
														{pillar.description}
													</p>
												</div>
											</div>
											<ul className="flex flex-col gap-2">
												{data.pillars[pillar.key].map((item) => (
													<li
														key={item}
														className="text-muted-foreground flex items-start gap-2 text-[13px] leading-relaxed"
													>
														<Icon
															ssr
															icon="ph:check"
															width={12}
															height={12}
															className="mt-0.5 shrink-0"
															style={{ color: pillar.color }}
														/>
														{item}
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
									Open source. No lock-in.
								</h2>
								<p className="text-muted-foreground mb-6 text-sm leading-relaxed">
									QUESTPIE Framework and Autopilot are MIT-licensed. Cloud is a
									convenience layer — your code and data are always yours.
									Self-host anytime.
								</p>
								<div className="flex flex-wrap items-center justify-center gap-3">
									<a
										href="https://github.com/questpie/questpie"
										target="_blank"
										rel="noreferrer"
										className={secondaryCta}
									>
										<Icon
											ssr
											icon="ph:github-logo"
											width={16}
											height={16}
										/>
										View source
									</a>
									<Link to="/cloud" className={secondaryCta}>
										Learn about Cloud
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
								{data.faq.map((item) => (
									<FAQItem key={item.q} item={item} />
								))}
							</div>
						</section>
					</Reveal>

					{/* Final CTA */}
					<section className="px-6 py-24 text-center md:py-32">
						<h2 className="text-foreground mb-4 text-3xl font-semibold text-balance md:text-4xl">
							Ready to simplify your {data.name.toLowerCase()} business?
						</h2>
						<p className="text-muted-foreground mx-auto mb-8 max-w-md text-lg leading-relaxed">
							Join the waitlist for early access to QUESTPIE Cloud. Open-source
							Framework is available now.
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
