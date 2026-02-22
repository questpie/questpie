import { Link } from "@tanstack/react-router";
import { Box, Layers, Palette, Plug } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { AnimFloatingPies } from "@/components/landing/BrandVisuals";
import { cn } from "@/lib/utils";

const layers = [
	{
		icon: Box,
		label: "Core",
		api: "q()",
		description: "Collections, globals, fields, jobs, auth — all type-safe.",
	},
	{
		icon: Plug,
		label: "Adapters",
		api: ".build()",
		description:
			"Storage, queue, email, search, realtime — swap providers, keep your schema.",
	},
	{
		icon: Layers,
		label: "Modules",
		api: ".use()",
		description:
			"Compose builders together. Admin module ships the full panel.",
	},
	{
		icon: Palette,
		label: "Client",
		api: "qa()",
		description:
			"Field renderers, views, widgets, components — all registries.",
	},
];

export function Composability() {
	const [activeLayer, setActiveLayer] = useState<number>(0);
	const [isAutoPlaying, setIsAutoPlaying] = useState(true);

	// Auto-play interval
	useEffect(() => {
		if (!isAutoPlaying) return;

		const interval = setInterval(() => {
			setActiveLayer((prev) => (prev + 1) % layers.length);
		}, 3000); // 3 seconds per layer

		return () => clearInterval(interval);
	}, [isAutoPlaying]);

	return (
		<section
			id="composability"
			className="border-t border-border/40 py-20 overflow-hidden relative"
		>
			{/* Ambient background visuals */}
			<AnimFloatingPies className="absolute inset-0 w-full h-full pointer-events-none opacity-40" />
			{/* Ambient glow */}
			<div className="absolute hidden dark:block top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none bg-[radial-gradient(circle,_oklch(0.5984_0.3015_310.74_/_0.08)_0%,_transparent_70%)]" />

			<div className="mx-auto w-full max-w-7xl px-4 relative z-10">
				<motion.div
					className="mx-auto mb-12 max-w-2xl space-y-3 text-center"
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.6 }}
				>
					<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary">
						Architecture
					</h2>
					<h3 className="text-3xl font-mono font-bold tracking-[-0.02em] text-balance md:text-4xl">
						Four layers.
						<br />
						Zero lock-in.
					</h3>
					<p className="mt-5 mx-auto text-muted-foreground text-balance max-w-2xl text-lg leading-relaxed">
						Server defines <strong className="text-foreground">what</strong>.
						Client defines <strong className="text-foreground">how</strong>.
						Adapters define <strong className="text-foreground">where</strong>.
						Compose them your way.
					</p>

					<div className="mt-8">
						<Link
							to="/docs/$"
							params={{ _splat: "mentality" }}
							className="inline-flex items-center gap-2 font-mono text-xs text-primary transition-colors hover:text-primary/80"
						>
							Read the architecture philosophy →
						</Link>
					</div>
				</motion.div>

				{/* Interactive Pipeline visualization */}
				<motion.div
					className="relative flex flex-col items-center justify-center mx-auto w-full max-w-5xl"
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.8, delay: 0.2 }}
				>
					{/* Flow / Nodes area */}
					<div
						className="relative flex w-full h-[120px] items-center justify-between px-8 md:px-16 mb-8"
						onMouseEnter={() => setIsAutoPlaying(false)}
						onMouseLeave={() => setIsAutoPlaying(true)}
						role="group"
						aria-label="Layer pipeline"
					>
						{/* Background connecting line */}
						<div className="absolute inset-x-8 md:inset-x-16 top-1/2 h-[1px] -translate-y-1/2 bg-border/40" />

						{/* Active glowing connection lines */}
						<div className="absolute inset-x-8 md:inset-x-16 top-1/2 flex h-[1px] -translate-y-1/2 items-center z-0">
							{/* Segment 1: Core -> Adapters */}
							<motion.div
								className="h-full bg-primary/70"
								style={{ width: "33.33%" }}
								initial={{ scaleX: 0, originX: 0 }}
								animate={{ scaleX: activeLayer >= 1 ? 1 : 0 }}
								transition={{ duration: 0.5, ease: "easeOut" }}
							/>
							{/* Segment 2: Adapters -> Modules */}
							<motion.div
								className="h-full bg-primary/70"
								style={{ width: "33.33%" }}
								initial={{ scaleX: 0, originX: 0 }}
								animate={{ scaleX: activeLayer >= 2 ? 1 : 0 }}
								transition={{ duration: 0.5, ease: "easeOut" }}
							/>
							{/* Segment 3: Modules -> Client */}
							<motion.div
								className="h-full bg-primary/70"
								style={{ width: "33.33%" }}
								initial={{ scaleX: 0, originX: 0 }}
								animate={{ scaleX: activeLayer >= 3 ? 1 : 0 }}
								transition={{ duration: 0.5, ease: "easeOut" }}
							/>
						</div>

						{/* Traveling light pulses */}
						<div className="absolute inset-x-8 md:inset-x-16 top-1/2 flex h-[1px] -translate-y-1/2 items-center z-10 pointer-events-none">
							<motion.div
								className="absolute top-1/2 h-[2px] w-12 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_20px_4px_rgba(183,0,255,0.7)] hidden md:block"
								initial={{ left: "0%" }}
								animate={{ left: `${activeLayer * 33.333}%` }}
								transition={{ type: "spring", stiffness: 120, damping: 20 }}
							/>

							<motion.div
								className="absolute top-1/2 h-[2px] w-8 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_15px_3px_rgba(183,0,255,0.7)] md:hidden"
								initial={{ left: "0%" }}
								animate={{ left: `${activeLayer * 33.333}%` }}
								transition={{ type: "spring", stiffness: 120, damping: 20 }}
							/>
						</div>

						{/* Nodes */}
						{layers.map((layer, i) => {
							const isHovered = activeLayer === i;
							const isPassed = i <= activeLayer;

							return (
								<button
									key={layer.label}
									type="button"
									className="relative flex flex-col items-center group z-20 cursor-pointer bg-transparent border-0 p-0"
									onClick={() => {
										setActiveLayer(i);
										setIsAutoPlaying(false);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											setActiveLayer(i);
											setIsAutoPlaying(false);
										}
									}}
								>
									{/* Interactive hit area */}
									<div className="absolute inset-[-40px]" />

									<motion.div
										className={cn(
											"relative flex h-12 w-12 md:h-14 md:w-14 items-center justify-center border border-border backdrop-blur-sm backdrop-blur-md transition-all duration-300",
											isHovered
												? "border-primary bg-primary/20 backdrop-blur-md shadow-[0_0_30px_-5px_rgba(183,0,255,0.5)] scale-110"
												: isPassed
													? "border-primary/50 bg-primary/5 hover:border-primary/80"
													: "border-border bg-card/20 hover:border-primary/40",
										)}
									>
										<layer.icon
											className={cn(
												"h-5 w-5 md:h-6 md:w-6 transition-colors duration-300",
												isHovered
													? "text-primary"
													: isPassed
														? "text-primary/70"
														: "text-muted-foreground",
											)}
										/>
									</motion.div>

									<motion.div
										className="mt-3 flex flex-col items-center text-center absolute top-14 md:top-16 w-24 md:w-32"
										animate={{
											opacity: isHovered ? 1 : isPassed ? 0.7 : 0.4,
											y: isHovered ? 0 : 0,
										}}
									>
										<span
											className={cn(
												"font-mono text-xs md:text-sm font-bold uppercase transition-colors duration-300",
												isHovered ? "text-primary" : "text-foreground",
											)}
										>
											{layer.label}
										</span>
										<span
											className={cn(
												"mt-1.5 font-mono text-[9px] md:text-[10px] rounded-sm px-2 py-1 transition-colors duration-300 border",
												isHovered
													? "bg-primary/10 text-primary border-primary/30"
													: "bg-muted/30 text-muted-foreground border-transparent",
											)}
										>
											{layer.api}
										</span>
									</motion.div>
								</button>
							);
						})}
					</div>

					{/* Description Area below pipeline */}
					<div className="h-[120px] md:h-[100px] w-full max-w-xl px-4 mt-4 md:mt-6 flex items-center justify-center">
						<AnimatePresence mode="wait">
							<motion.div
								key={activeLayer}
								initial={{ opacity: 0, y: 10, scale: 0.98 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={{ opacity: 0, y: -10, scale: 0.98 }}
								transition={{ duration: 0.3 }}
								className="w-full rounded-none border border-border bg-card/20 p-5 md:p-6 backdrop-blur-md transition-colors hover:border-primary/30"
							>
								<div className="flex flex-col md:flex-row md:items-center gap-4">
									<div className="flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center border border-primary/20 bg-primary/10 text-primary transition-colors">
										{(() => {
											const Icon = layers[activeLayer].icon;
											return <Icon className="h-5 w-5 md:h-6 md:w-6" />;
										})()}
									</div>
									<div>
										<h4 className="text-base md:text-lg font-semibold text-foreground mb-1.5">
											{layers[activeLayer].label} Layer
										</h4>
										<p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
											{layers[activeLayer].description}
										</p>
									</div>
								</div>
							</motion.div>
						</AnimatePresence>
					</div>
				</motion.div>
			</div>
		</section>
	);
}
