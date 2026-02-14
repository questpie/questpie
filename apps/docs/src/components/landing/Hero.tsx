import { Link } from "@tanstack/react-router";
import { ArrowRight, Github, Lock, Terminal } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import coldarkCold from "react-syntax-highlighter/dist/esm/styles/prism/coldark-cold";
import coldarkDark from "react-syntax-highlighter/dist/esm/styles/prism/coldark-dark";
import { cn } from "@/lib/utils";

SyntaxHighlighter.registerLanguage("typescript", typescript);

const schemaSnippet = `q.collection("posts")
  .fields((f) => ({
    title: f.text(),
    author: f.relation({ to: "users" }),
    status: f.select({
      options: ["draft", "published"],
    }),
  }))`;

const rows = [
	{ id: 1, title: "Homepage Redesign", author: "Alex K.", status: "published" },
	{ id: 2, title: "API Documentation", author: "Mila J.", status: "draft", locked: true, lockedBy: "MJ" },
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
						prev.map((r, i) =>
							i === s.row ? { ...r, status: s.status } : r,
						),
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
		<section className="relative min-h-[80vh] lg:min-h-[90vh] flex items-center">
			{/* Horizontal beam sweep on load */}
			<motion.div
				className="hidden dark:block absolute top-1/2 left-0 h-px w-full pointer-events-none"
				style={{
					background:
						"linear-gradient(90deg, transparent 0%, oklch(0.5984 0.3015 310.74 / 0.4) 50%, transparent 100%)",
				}}
				initial={{ opacity: 0, scaleX: 0 }}
				animate={{ opacity: [0, 1, 0], scaleX: [0, 1, 1] }}
				transition={{ duration: 2, delay: 0.5, ease: "easeOut" }}
			/>

			<div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-24 lg:py-32">
				<div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-16 items-center">
					{/* Left — text content */}
					<div>
						<motion.div
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5 }}
						>
							<span className="inline-flex items-center gap-2 border border-primary/20 bg-primary/[0.05] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
								<span className="relative flex h-1.5 w-1.5">
									<span className="absolute inline-flex h-full w-full animate-ping bg-primary opacity-75" />
									<span className="relative inline-flex h-1.5 w-1.5 bg-primary" />
								</span>
								v1 Beta — Open Source
							</span>
						</motion.div>

						<motion.h1
							className="mt-6 text-4xl font-bold leading-[1.08] tracking-[-0.03em] text-balance text-foreground md:text-5xl"
							initial={{ opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.08 }}
						>
							The modern backend that <span className="text-primary">builds itself</span>
						</motion.h1>

						<motion.p
							className="mt-5 text-base leading-relaxed text-balance text-muted-foreground"
							initial={{ opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.16 }}
						>
							TypeScript framework with built-in realtime. Define your collections once&nbsp;— get a REST&nbsp;API, realtime admin&nbsp;panel, and type-safe&nbsp;SDK out of the box.
						</motion.p>

						<motion.div
							className="mt-8 flex flex-col gap-3 sm:flex-row"
							initial={{ opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.24 }}
						>
							<Link
								to="/docs/$"
								params={{ _splat: "getting-started/quickstart" }}
								className="group inline-flex h-11 items-center justify-center bg-primary px-7 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
							>
								Get Started
								<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
							</Link>
							<a
								href="https://github.com/questpie/questpie-cms"
								target="_blank"
								rel="noreferrer"
								className="inline-flex h-11 items-center justify-center gap-2 border border-border bg-card/10 backdrop-blur-sm px-7 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-primary/30"
							>
								<Github className="h-4 w-4" />
								GitHub
							</a>
						</motion.div>

						<motion.div
							className="mt-5 inline-flex items-center gap-3 border border-border bg-card/10 backdrop-blur-sm px-4 py-2.5 font-mono text-sm text-muted-foreground"
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5, delay: 0.32 }}
						>
							<Terminal className="h-4 w-4 text-primary" />
							<span>
								<span className="text-primary">$</span> bun i
								questpie @questpie/admin
							</span>
						</motion.div>
					</div>

					{/* Right — live admin preview + code overlay */}
					<motion.div
						className="relative"
						initial={{ opacity: 0, x: 20 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.7, delay: 0.3 }}
					>
						{/* Admin table card */}
						<div className="border border-border bg-card/10 backdrop-blur-sm overflow-hidden">
							{/* Browser chrome */}
							<div className="flex items-center gap-2 border-b border-border px-3 py-2">
								<div className="flex gap-1.5">
									<div className="h-2 w-2 border border-border bg-muted/30" />
									<div className="h-2 w-2 border border-border bg-muted/30" />
									<div className="h-2 w-2 border border-border bg-muted/30" />
								</div>
								<div className="ml-1 flex-1 border border-border bg-card/10 px-2.5 py-0.5">
									<span className="font-mono text-[9px] text-muted-foreground">
										localhost:3000/admin/posts
									</span>
								</div>
							</div>

							{/* Table header */}
							<div className="flex items-center justify-between border-b border-border px-3 py-2">
								<div className="flex items-center gap-2">
									<span className="text-xs font-semibold text-foreground">
										Posts
									</span>
								</div>
								<span className="inline-flex items-center gap-1 border border-primary/20 bg-primary/[0.05] px-1.5 py-0.5">
										<span className="relative flex h-1.5 w-1.5">
											<span className="absolute inline-flex h-full w-full animate-ping bg-primary opacity-75" />
											<span className="relative inline-flex h-1.5 w-1.5 bg-primary" />
										</span>
										<span className="text-[8px] font-medium text-primary">
											LIVE
										</span>
									</span>
							</div>

							{/* Column headers */}
							<div className="grid grid-cols-[1fr_0.6fr_0.4fr_auto] gap-2 border-b border-border px-3 py-1.5 bg-card/10">
								{["Title", "Author", "Status", ""].map((h) => (
									<span
										key={h || "lock"}
										className="text-[8px] font-medium uppercase tracking-wider text-muted-foreground"
									>
										{h}
									</span>
								))}
							</div>

							{/* Rows */}
							{tableRows.map((row, i) => (
								<div
									key={row.id}
									className="grid grid-cols-[1fr_0.6fr_0.4fr_auto] gap-2 border-b border-border/30 px-3 py-2 transition-all"
									style={{
										animation:
											pulsingRow === i
												? "realtime-pulse 1s ease-out"
												: undefined,
									}}
								>
									<span className="text-[11px] text-foreground truncate">
										{row.title}
									</span>
									<span className="text-[11px] text-muted-foreground">
										{row.author}
									</span>
									<span
										className={cn(
											"inline-flex w-fit items-center px-1.5 py-0.5 text-[9px] font-medium transition-colors",
											row.status === "published"
												? "bg-primary/10 text-primary border border-primary/20"
												: "bg-muted/20 text-muted-foreground border border-border",
										)}
									>
										{row.status}
									</span>
									<div className="flex items-center justify-end w-8">
										{row.locked && (
											<span className="inline-flex items-center gap-0.5">
												<Lock className="h-2.5 w-2.5 text-muted-foreground" />
												<span className="inline-flex h-4 w-4 items-center justify-center bg-primary/10 text-[7px] font-mono text-primary">
													{row.lockedBy}
												</span>
											</span>
										)}
									</div>
								</div>
							))}
						</div>

						{/* Code overlay — glass, offset */}
						<motion.div
							className="absolute -bottom-6 -left-4 lg:-left-8 max-w-[260px] border border-primary/20 bg-background/40 backdrop-blur-xl p-3"
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5, delay: 1 }}
						>
							<p className="mb-1.5 font-mono text-[8px] uppercase tracking-wider text-primary">
								Schema definition
							</p>
							<div className="dark:hidden">
								<SyntaxHighlighter
									language="typescript"
									style={coldarkCold}
									customStyle={{
										background: "transparent",
										padding: 0,
										margin: 0,
										fontSize: "0.625rem",
										lineHeight: "1.6",
									}}
								>
									{schemaSnippet}
								</SyntaxHighlighter>
							</div>
							<div className="hidden dark:block">
								<SyntaxHighlighter
									language="typescript"
									style={coldarkDark}
									customStyle={{
										background: "transparent",
										padding: 0,
										margin: 0,
										fontSize: "0.625rem",
										lineHeight: "1.6",
									}}
								>
									{schemaSnippet}
								</SyntaxHighlighter>
							</div>
						</motion.div>

						{/* Ambient glow */}
						<div className="hidden dark:block absolute -inset-8 -z-10 bg-[radial-gradient(ellipse,_oklch(0.5984_0.3015_310.74_/_0.06)_0%,_transparent_70%)]" />
					</motion.div>
				</div>
			</div>
		</section>
	);
}
