import { Link } from "@tanstack/react-router";
import { ArrowRight, Github, Terminal } from "lucide-react";
import { motion } from "motion/react";

export function CallToAction() {
	return (
		<section className="relative border-t border-border/40 py-24">
			{/* Extra ambient glow for CTA */}
			<div className="hidden dark:block absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] pointer-events-none bg-[radial-gradient(ellipse,_oklch(0.5984_0.3015_310.74_/_0.08)_0%,_transparent_60%)]" />

			<div className="relative z-10 mx-auto w-full max-w-7xl px-4 text-center">
				{/* Logo + badge inline */}
				<motion.div
					className="mb-6 inline-flex items-center gap-3"
					initial={{ opacity: 0, y: 10 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true }}
					transition={{ duration: 0.5 }}
				>
					<div className="relative">
						<div className="absolute inset-0 bg-primary/20 blur-2xl" />
						<img
							src="/symbol/Q-symbol-white-pink.svg"
							alt="QUESTPIE"
							className="relative h-10 w-auto"
						/>
					</div>
					<span className="inline-flex items-center gap-2 border border-primary/20 bg-primary/[0.05] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
						<span className="h-1.5 w-1.5 bg-primary" />
						Open Source
					</span>
				</motion.div>

				<motion.h2
					className="text-3xl font-bold tracking-[-0.02em] text-balance md:text-4xl"
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true }}
					transition={{ duration: 0.6, delay: 0.15 }}
				>
					Start with one backend. Ship fast.
				</motion.h2>

				<motion.p
					className="mx-auto mt-4 max-w-md text-base text-muted-foreground text-balance"
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true }}
					transition={{ duration: 0.6, delay: 0.2 }}
				>
					Get CRUD + RPC running first. Add admin UI and client SDKs when you
					need them.
				</motion.p>

				<motion.div
					className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true }}
					transition={{ duration: 0.6, delay: 0.25 }}
				>
					<Link
						to="/docs/$"
						params={{ _splat: "getting-started/quickstart" }}
						className="group inline-flex h-11 items-center justify-center bg-primary px-7 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						Start with Quickstart
						<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
					</Link>
					<Link
						to="/docs/$"
						params={{
							_splat: "examples/tanstack-barbershop-architecture-tour",
						}}
						className="inline-flex h-11 items-center justify-center border border-border bg-card/10 backdrop-blur-sm px-7 text-sm font-medium transition-colors hover:border-primary/30"
					>
						Architecture Example
					</Link>
					<a
						href="https://github.com/questpie/questpie"
						target="_blank"
						rel="noreferrer"
						className="inline-flex h-11 items-center justify-center gap-2 px-7 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						<Github className="h-4 w-4" />
						GitHub
					</a>
				</motion.div>

				{/* Terminal command */}
				<motion.div
					className="mt-6 inline-flex items-center gap-3 border border-border bg-card/10 backdrop-blur-sm px-4 py-2.5 font-mono text-sm text-muted-foreground"
					initial={{ opacity: 0, y: 10 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true }}
					transition={{ duration: 0.5, delay: 0.3 }}
				>
					<Terminal className="h-4 w-4 text-primary" />
					<div className="text-left leading-tight">
						<div>
							<span className="text-primary">$</span> bun i questpie
						</div>
						<div className="text-[10px] text-muted-foreground/80">
							optional generated admin UI
						</div>
					</div>
				</motion.div>
			</div>
		</section>
	);
}
