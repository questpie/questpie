import {
	Broadcast,
	FilePlus,
	Lock,
	Sparkle,
	Trash,
	Users,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AnimDotGrid } from "@/components/landing/BrandVisuals";
import { cn } from "@/lib/utils";

const features = [
	{
		icon: Broadcast,
		title: "Streamed Queries",
		description: "SSE-powered live updates. No polling, no WebSocket setup.",
	},
	{
		icon: Lock,
		title: "Document Locks",
		description: "Collaborative editing awareness. See who's editing what.",
	},
	{
		icon: Sparkle,
		title: "Change Highlighting",
		description:
			"Visual pulse on modified rows so operators never miss updates.",
	},
	{
		icon: FilePlus,
		title: "Document Events",
		description:
			"Create, update, and delete — every mutation streams to connected clients.",
	},
];

const initialRows = [
	{
		id: 1,
		title: "Homepage Redesign",
		author: "Alex K.",
		status: "published",
	},
	{
		id: 2,
		title: "API Documentation",
		author: "Mila J.",
		status: "draft",
		locked: true,
		lockedBy: "AK",
	},
	{
		id: 3,
		title: "Release Notes v1",
		author: "Jaro T.",
		status: "published",
	},
	{
		id: 4,
		title: "Migration Guide",
		author: "Alex K.",
		status: "draft",
	},
	{
		id: 5,
		title: "Component Library",
		author: "Mila J.",
		status: "published",
	},
];

const statusCycle = ["draft", "published", "published", "draft", "published"];

type EventType = "update" | "create" | "delete";
interface FeedEvent {
	id: number;
	type: EventType;
	label: string;
}

export function RealtimeDemo() {
	const [pulsingRow, setPulsingRow] = useState<number | null>(null);
	const [rows, setRows] = useState(initialRows);
	const [presenceVisible, setPresenceVisible] = useState([true, true, false]);
	const [eventFeed, setEventFeed] = useState<FeedEvent[]>([]);
	const [eventCounter, setEventCounter] = useState(0);
	const [stats, setStats] = useState({ published: 3, draft: 2, total: 5 });
	const [isVisible, setIsVisible] = useState(false);
	const sectionRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const el = sectionRef.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			([entry]) => setIsVisible(entry.isIntersecting),
			{ threshold: 0.1 },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!isVisible) return;
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

		const pushEvent = (type: EventType, label: string) => {
			setEventCounter((prev) => {
				const id = prev + 1;
				setEventFeed((feed) => [{ id, type, label }, ...feed].slice(0, 4));
				return id;
			});
		};

		// Scripted sequence that loops forever — each step is: highlight row + push event
		const script: Array<{
			row: number;
			status: string;
			event: { type: EventType; label: string };
			presence?: number;
		}> = [
			{
				row: 0,
				status: "draft",
				event: { type: "update", label: "Homepage Redesign" },
			},
			{
				row: 2,
				status: "draft",
				event: { type: "update", label: "Release Notes v1" },
				presence: 2,
			},
			{
				row: 3,
				status: "published",
				event: { type: "create", label: "New Blog Post" },
			},
			{
				row: 1,
				status: "published",
				event: { type: "update", label: "API Documentation" },
				presence: 0,
			},
			{ row: 4, status: "draft", event: { type: "delete", label: "FAQ Page" } },
			{
				row: 0,
				status: "published",
				event: { type: "update", label: "Homepage Redesign" },
				presence: 2,
			},
			{
				row: 3,
				status: "draft",
				event: { type: "create", label: "Changelog Entry" },
				presence: 1,
			},
			{
				row: 2,
				status: "published",
				event: { type: "update", label: "Release Notes v1" },
			},
			{
				row: 4,
				status: "published",
				event: { type: "delete", label: "Team Bio" },
				presence: 0,
			},
			{
				row: 1,
				status: "draft",
				event: { type: "create", label: "New FAQ Page" },
			},
		];

		const run = async () => {
			try {
				await wait(1000);
				let step = 0;
				while (!signal.aborted) {
					const s = script[step % script.length];

					// Highlight + status change + event + stats — all at once
					setRows((prev) =>
						prev.map((r, i) => (i === s.row ? { ...r, status: s.status } : r)),
					);
					setPulsingRow(s.row);
					pushEvent(s.event.type, s.event.label);

					// Recompute stats from new rows
					setRows((prev) => {
						const published = prev.filter(
							(r) => r.status === "published",
						).length;
						setStats({
							published,
							draft: prev.length - published,
							total: prev.length,
						});
						return prev;
					});

					// Toggle presence if specified
					if (s.presence !== undefined) {
						const idx = s.presence;
						setPresenceVisible((prev) => {
							const next = [...prev];
							next[idx] = !next[idx];
							return next;
						});
					}

					await wait(600);
					setPulsingRow(null);
					await wait(900);

					step++;
				}
			} catch {
				// aborted
			}
		};

		run();
		return () => controller.abort();
	}, [isVisible]);

	return (
		<section
			ref={sectionRef}
			className="relative border-t border-border/40 py-20 overflow-hidden"
		>
			{/* Brand dot grid — data streaming motif */}
			<AnimDotGrid className="absolute inset-0 w-full h-full pointer-events-none opacity-60" />
			<div className="mx-auto w-full max-w-7xl px-4 relative z-10">
				<div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] items-center mb-12">
					{/* Left Column — Text */}
					<motion.div
						className="space-y-3"
						initial={{ opacity: 0, x: -20 }}
						whileInView={{ opacity: 1, x: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.6 }}
					>
						<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary text-balance">
							Realtime
						</h2>
						<h3 className="font-mono text-3xl font-bold tracking-[-0.02em] text-balance md:text-4xl">
							Every change, everywhere, instantly
						</h3>
						<p className="text-muted-foreground text-balance mt-3">
							SSE-powered live queries, document locks, and change highlighting
							ship out of the box. No WebSocket setup, no polling.
						</p>
					</motion.div>

					{/* Right Column — Live demo */}
					<motion.div
						className="grid gap-4 sm:grid-cols-[1fr_180px] w-full"
						initial={{ opacity: 0, x: 20 }}
						whileInView={{ opacity: 1, x: 0 }}
						viewport={{ once: true }}
						transition={{ duration: 0.5, delay: 0.2 }}
					>
						{/* Animated admin table */}
						<div className="border border-border bg-card/20 backdrop-blur-sm overflow-hidden flex flex-col h-full">
							{/* Table header with live badge and presence */}
							<div className="flex items-center justify-between border-b border-border px-3 py-2 bg-background/50">
								<div className="flex items-center gap-2">
									<span className="text-xs font-semibold">Posts</span>
									<span className="inline-flex items-center gap-1 border border-primary/20 bg-primary/10 px-1.5 py-0.5">
										<span className="relative flex h-1.5 w-1.5">
											<span className="absolute inline-flex h-full w-full animate-ping bg-primary opacity-75" />
											<span className="relative inline-flex h-1.5 w-1.5 bg-primary" />
										</span>
										<span className="text-[8px] font-medium text-primary">
											LIVE
										</span>
									</span>
								</div>

								{/* Presence dots */}
								<div className="flex items-center gap-1">
									<Users className="h-3 w-3 text-muted-foreground mr-1" />
									{["AK", "MJ", "JT"].map((user, i) => (
										<span
											key={user}
											className={cn(
												"inline-flex h-5 w-5 items-center justify-center text-[8px] font-mono transition-all duration-300",
												presenceVisible[i]
													? "bg-primary/15 text-primary border border-primary/20 scale-100 opacity-100"
													: "bg-transparent text-transparent scale-0 opacity-0 border border-transparent",
											)}
										>
											{user}
										</span>
									))}
								</div>
							</div>

							{/* Column headers */}
							<div className="grid grid-cols-[1fr_0.5fr_0.4fr_auto] gap-2 border-b border-border px-3 py-1.5 bg-muted/20">
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
							<div className="flex-1 flex flex-col justify-center">
								{rows.map((row, i) => (
									<div
										key={row.id}
										className="grid grid-cols-[1fr_0.5fr_0.4fr_auto] gap-2 border-b border-border/50 px-3 py-2 transition-all"
										style={{
											animation:
												pulsingRow === i
													? "realtime-pulse 1s ease-out"
													: undefined,
										}}
									>
										<span className="text-[10px] text-foreground truncate">
											{row.title}
										</span>
										<span className="text-[10px] text-muted-foreground">
											{row.author}
										</span>
										<span
											className={cn(
												"inline-flex w-fit items-center px-1 py-0.5 text-[8px] font-medium transition-colors",
												row.status === "published"
													? "bg-primary/10 text-primary border border-primary/20"
													: "bg-muted text-muted-foreground border border-border",
											)}
										>
											{row.status}
										</span>
										<div className="flex items-center justify-end w-10">
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
						</div>

						{/* Dashboard stats sidebar */}
						<div className="flex flex-col gap-3">
							{/* Event counter */}
							<div className="border border-border bg-card/20 backdrop-blur-sm p-3">
								<div className="flex items-center gap-2 mb-2">
									<span className="relative flex h-1.5 w-1.5">
										<span className="absolute inline-flex h-full w-full animate-ping bg-primary opacity-75" />
										<span className="relative inline-flex h-1.5 w-1.5 bg-primary" />
									</span>
									<span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
										Events
									</span>
								</div>
								<span className="block text-2xl font-bold tabular-nums text-foreground">
									{eventCounter}
								</span>
								<span className="text-[9px] text-muted-foreground">
									streamed via SSE
								</span>
							</div>

							{/* Published / Draft stats */}
							<div className="border border-border bg-card/20 backdrop-blur-sm p-3">
								<span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground mb-2 block">
									Status
								</span>
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<span className="text-[9px] text-muted-foreground">
											Published
										</span>
										<span className="text-xs font-semibold tabular-nums text-primary">
											{stats.published}
										</span>
									</div>
									<div className="h-1 bg-muted/30">
										<div
											className="h-full bg-primary transition-all duration-500"
											style={{
												width: `${(stats.published / stats.total) * 100}%`,
											}}
										/>
									</div>
									<div className="flex items-center justify-between">
										<span className="text-[9px] text-muted-foreground">
											Draft
										</span>
										<span className="text-xs font-semibold tabular-nums text-foreground">
											{stats.draft}
										</span>
									</div>
									<div className="h-1 bg-muted/30">
										<div
											className="h-full bg-muted-foreground/30 transition-all duration-500"
											style={{
												width: `${(stats.draft / stats.total) * 100}%`,
											}}
										/>
									</div>
								</div>
							</div>

							{/* Latest event */}
							<div className="border border-border bg-card/20 backdrop-blur-sm p-3 flex-1 flex flex-col justify-end">
								<span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground mb-2 block">
									Latest
								</span>
								<AnimatePresence mode="wait">
									{eventFeed[0] ? (
										<motion.div
											key={eventFeed[0].id}
											initial={{ opacity: 0, y: 4 }}
											animate={{ opacity: 1, y: 0 }}
											exit={{ opacity: 0, y: -4 }}
											transition={{ duration: 0.15 }}
											className="flex items-center gap-2"
										>
											<EventIcon type={eventFeed[0].type} />
											<div className="min-w-0 flex-1">
												<span className="block text-[9px] text-foreground truncate">
													{eventFeed[0].label}
												</span>
												<span
													className={cn(
														"text-[8px] font-mono uppercase",
														eventFeed[0].type === "create" && "text-primary",
														eventFeed[0].type === "update" &&
															"text-muted-foreground",
														eventFeed[0].type === "delete" &&
															"text-destructive",
													)}
												>
													{eventFeed[0].type}
												</span>
											</div>
										</motion.div>
									) : (
										<span className="text-[9px] text-muted-foreground">
											Waiting...
										</span>
									)}
								</AnimatePresence>
							</div>
						</div>
					</motion.div>
				</div>

				{/* Feature cards — Full width below the Header/Demo layout */}
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-10 w-full">
					{features.map((feature, i) => (
						<motion.div
							key={feature.title}
							className="border border-border bg-card/20 backdrop-blur-sm p-4 group transition-colors hover:border-primary/30"
							initial={{ opacity: 0, y: 16 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true }}
							transition={{ duration: 0.4, delay: i * 0.08 }}
						>
							<div className="mb-3 flex h-9 w-9 items-center justify-center border border-primary/20 bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
								<feature.icon className="h-4 w-4" />
							</div>
							<h4 className="text-sm font-semibold mb-1">{feature.title}</h4>
							<p className="text-xs text-muted-foreground leading-relaxed">
								{feature.description}
							</p>
						</motion.div>
					))}
				</div>

				{/* Link */}
				<div className="mt-8 text-center">
					<Link
						to="/docs/$"
						params={{ _splat: "infrastructure/realtime" }}
						className="inline-flex items-center gap-2 font-mono text-xs text-primary transition-colors hover:text-primary/80"
					>
						Read the realtime docs →
					</Link>
				</div>
			</div>
		</section>
	);
}

function EventIcon({ type }: { type: EventType }) {
	if (type === "create")
		return (
			<FilePlus className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
		);
	if (type === "delete")
		return (
			<Trash className="h-3 w-3 shrink-0 text-destructive" aria-hidden="true" />
		);
	return (
		<Sparkle
			className="h-3 w-3 shrink-0 text-muted-foreground"
			aria-hidden="true"
		/>
	);
}
