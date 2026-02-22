import {
	ArrowRight,
	GithubLogo,
	Lock,
	Sparkle,
	Terminal,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import { AnimHeroArcs } from "@/components/landing/BrandVisuals";
import { cn } from "@/lib/utils";

SyntaxHighlighter.registerLanguage("typescript", typescript);

const rows = [
	{ id: 1, title: "Homepage Redesign", author: "Alex K.", status: "published" },
	{
		id: 2,
		title: "API Documentation",
		author: "Mila J.",
		status: "draft",
		locked: true,
		lockedBy: "MJ",
	},
	{ id: 3, title: "Release Notes v2", author: "Jaro T.", status: "published" },
	{ id: 4, title: "Migration Guide", author: "Alex K.", status: "draft" },
];

const script = [
	{ row: 0, status: "draft" },
	{ row: 2, status: "draft" },
	{ row: 3, status: "published" },
	{ row: 0, status: "published" },
	{ row: 1, status: "published" },
	{ row: 3, status: "draft" },
	{ row: 2, status: "published" },
	{ row: 1, status: "draft" },
];

export function Hero() {
	const shouldReduceMotion = useReducedMotion();
	const [tableRows, setTableRows] = useState(rows);
	const [pulsingRow, setPulsingRow] = useState<number | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		const { signal } = controller;

		const wait = (ms: number) =>
			new Promise<void>((resolve, reject) => {
				const id = setTimeout(resolve, ms);
				signal.addEventListener("abort", () => {
					clearTimeout(id);
					reject(new Error("aborted"));
				});
			});

		const run = async () => {
			try {
				await wait(1500);
				let step = 0;
				while (!signal.aborted) {
					const s = script[step % script.length];
					setTableRows((prev) =>
						prev.map((r, i) => (i === s.row ? { ...r, status: s.status } : r)),
					);
					setPulsingRow(s.row);
					await wait(600);
					setPulsingRow(null);
					await wait(1000);
					step++;
				}
			} catch {
				// aborted
			}
		};

		run();
		return () => controller.abort();
	}, []);

	return (
		<section className="relative min-h-[85vh] lg:min-h-0 lg:flex-1 flex items-center overflow-hidden">
			{/* Brand arc motif — pinned to bottom-right corner, dark mode only */}
			<AnimHeroArcs className="absolute bottom-0 right-0 w-[60%] max-w-[800px] pointer-events-none" />

			{/* Dark mode ambient glow */}
			<div className="hidden dark:block absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] pointer-events-none bg-[radial-gradient(ellipse,_oklch(0.5984_0.3015_310.74_/_0.08)_0%,_transparent_60%)]" />

			{/* Horizontal beam sweep on load - dark mode only */}
			{!shouldReduceMotion && (
				<motion.div
					className="hidden dark:block absolute top-1/3 left-0 h-px w-full pointer-events-none"
					style={{
						background:
							"linear-gradient(90deg, transparent 0%, oklch(0.5984 0.3015 310.74 / 0.5) 50%, transparent 100%)",
					}}
					initial={{ opacity: 0, scaleX: 0 }}
					animate={{ opacity: [0, 1, 0], scaleX: [0, 1, 1] }}
					transition={{ duration: 2, delay: 0.5, ease: "easeOut" }}
				/>
			)}

			<div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-24 lg:py-32">
				<div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-12 items-center">
					{/* Left — text content */}
					<div className="relative">
						<motion.div
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5 }}
						>
							<span className="inline-flex items-center gap-2 border border-primary/20 bg-primary/[0.05] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
								<Sparkle className="h-3 w-3" aria-hidden="true" />
								Open Source
							</span>
						</motion.div>

						<motion.h1
							className="mt-6 font-mono text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance text-foreground md:text-5xl lg:text-6xl"
							initial={{ opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.08 }}
						>
							One backend,{" "}
							<span className="relative inline-block">
								<span className="text-primary">ship everywhere</span>
								<motion.span
									className="absolute -bottom-1 left-0 h-[2px] bg-primary/30"
									initial={{ width: 0 }}
									animate={{ width: "100%" }}
									transition={{ duration: 0.8, delay: 1 }}
								/>
							</span>
						</motion.h1>

						<motion.p
							className="mt-5 max-w-xl text-base leading-relaxed text-balance text-muted-foreground lg:text-lg"
							initial={{ opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.16 }}
						>
							Model in TypeScript. Ship REST, RPC, realtime, typed clients, and
							optional admin UI.
						</motion.p>

						<motion.div
							className="mt-6 flex flex-wrap gap-2"
							initial={{ opacity: 0, y: 14 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5, delay: 0.2 }}
						>
							{[
								"Backend-first",
								"Types end-to-end",
								"Admin is optional UI",
							].map((pill) => (
								<span
									key={pill}
									className="inline-flex items-center border border-border bg-card/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
								>
									{pill}
								</span>
							))}
						</motion.div>

						<motion.div
							className="mt-8 flex flex-col gap-3 sm:flex-row"
							initial={{ opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.24 }}
						>
							<Link
								to="/docs/$"
								params={{ _splat: "getting-started/quickstart" }}
								className="group relative inline-flex h-12 items-center justify-center overflow-hidden bg-primary px-8 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
							>
								<span className="relative z-10">Get Started</span>
								<ArrowRight className="relative z-10 ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								<motion.div
									className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
									initial={{ x: "-100%" }}
									whileHover={{ x: "100%" }}
									transition={{ duration: 0.5 }}
								/>
							</Link>
							<a
								href="https://github.com/questpie/questpie"
								target="_blank"
								rel="noreferrer"
								className="group inline-flex h-12 items-center justify-center gap-2 border border-border bg-card/10 backdrop-blur-sm px-8 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:border-primary/30 hover:bg-card/20"
							>
								<GithubLogo
									className="h-4 w-4 transition-transform group-hover:scale-110"
									aria-hidden="true"
								/>
								GitHub
							</a>
						</motion.div>

						<motion.div
							className="mt-6 inline-flex items-center gap-3 border border-border bg-card/10 backdrop-blur-sm px-4 py-2.5 font-mono text-sm text-muted-foreground rounded-sm group cursor-pointer hover:border-primary/20 transition-colors"
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5, delay: 0.32 }}
							onClick={() => {
								navigator.clipboard.writeText("bun i questpie");
							}}
						>
							<Terminal className="h-4 w-4 text-primary" aria-hidden="true" />
							<span>
								<span className="text-primary">$</span> bun i questpie
							</span>
							<motion.span
								className="text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity"
								initial={false}
							>
								Click to copy
							</motion.span>
						</motion.div>
					</div>

					{/* Right — live admin preview */}
					<motion.div
						className="relative"
						initial={{ opacity: 0, x: 20 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.7, delay: 0.3 }}
					>
						{/* Main admin card */}
						<div className="relative border border-border bg-card/10 backdrop-blur-sm overflow-hidden">
							{/* Browser chrome */}
							<div className="relative flex items-center gap-2 border-b border-border px-4 py-3 bg-background/50">
								<div className="flex gap-1.5">
									<div className="h-3 w-3 bg-red-400/80" />
									<div className="h-3 w-3 bg-yellow-400/80" />
									<div className="h-3 w-3 bg-green-400/80" />
								</div>
								<div className="ml-2 flex-1 border border-border/50 bg-background/60 px-3 py-1">
									<span className="font-mono text-[10px] text-muted-foreground">
										localhost:3000/admin/posts
									</span>
								</div>
								<span className="inline-flex items-center gap-1.5 border border-primary/20 bg-primary/[0.05] px-2 py-0.5">
									<span className="relative flex h-1.5 w-1.5">
										<span className="absolute inline-flex h-full w-full animate-ping bg-primary opacity-75" />
										<span className="relative inline-flex h-1.5 w-1.5 bg-primary" />
									</span>
									<span className="text-[9px] font-medium text-primary">
										SYNCED
									</span>
								</span>
							</div>

							{/* Table header */}
							<div className="relative flex items-center justify-between border-b border-border px-4 py-3 bg-card/5">
								<div className="flex items-center gap-2">
									<span className="text-sm font-semibold text-foreground">
										Posts View
									</span>
								</div>
								<div className="flex items-center gap-2">
									<div className="h-7 w-24 border border-border bg-background/50 rounded-sm" />
									<div className="h-7 w-20 border border-border bg-primary/10 rounded-sm" />
								</div>
							</div>

							{/* Column headers */}
							<div className="relative grid grid-cols-[1fr_0.6fr_0.4fr_auto] gap-2 border-b border-border px-4 py-2 bg-muted/30">
								{["Title", "Author", "Status", ""].map((h) => (
									<span
										key={h || "lock"}
										className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground"
									>
										{h}
									</span>
								))}
							</div>

							{/* Rows */}
							<div className="relative">
								{tableRows.map((row, i) => (
									<motion.div
										key={row.id}
										initial={{ opacity: 0, x: -10 }}
										animate={{ opacity: 1, x: 0 }}
										transition={{ delay: 0.5 + i * 0.1 }}
										className={cn(
											"grid grid-cols-[1fr_0.6fr_0.4fr_auto] gap-2 border-b border-border/30 px-4 py-2.5 transition-all hover:bg-background/40",
											pulsingRow === i && "bg-primary/5",
										)}
									>
										<span className="text-[11px] text-foreground truncate">
											{row.title}
										</span>
										<span className="text-[11px] text-muted-foreground">
											{row.author}
										</span>
										<span
											className={cn(
												"inline-flex w-fit items-center px-2 py-0.5 text-[9px] font-medium rounded-sm transition-all duration-300",
												row.status === "published"
													? "bg-primary/10 text-primary border border-primary/20"
													: "bg-muted/30 text-muted-foreground border border-border",
											)}
										>
											{row.status}
										</span>
										<div className="flex items-center justify-end w-8">
											{row.locked && (
												<motion.span
													initial={{ scale: 0.95, opacity: 0 }}
													animate={{ scale: 1, opacity: 1 }}
													className="inline-flex items-center gap-1"
												>
													<Lock
														className="h-3 w-3 text-muted-foreground"
														aria-hidden="true"
													/>
													<span className="inline-flex h-4 w-4 items-center justify-center bg-primary/10 text-[7px] font-mono text-primary rounded-sm">
														{row.lockedBy}
													</span>
												</motion.span>
											)}
										</div>
									</motion.div>
								))}
							</div>

							{/* Ambient glow behind card */}
							<div className="hidden dark:block absolute -inset-4 -z-10 bg-[radial-gradient(ellipse_at_center,_oklch(0.5984_0.3015_310.74_/_0.1)_0%,_transparent_70%)] blur-2xl" />
						</div>
					</motion.div>
				</div>
			</div>
		</section>
	);
}
