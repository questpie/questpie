import { Link } from "@tanstack/react-router";
import { AnimatedWorkflow } from "./AnimatedWorkflow";
import { workflowSteps } from "./workflow-steps";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";

const headlines = [
	{
		top: "CMS Speedrun",
		highlight: "any%",
	},
	{
		top: "Drizzle + Auth + Queues.",
		highlight: "Ship it.",
	},
	{
		top: "It's Just Drizzle",
		highlight: "All the Way Down",
	},
	{
		top: "Your Favorite Libraries.",
		highlight: "One Backend.",
	},
	{
		top: "Stop Reinventing.",
		highlight: "Start Shipping.",
	},
	{
		top: "The TypeScript CMS",
		highlight: "Without the BS",
	},
	{
		top: "Postgres Goes",
		highlight: "Brrrr",
	},
	{
		top: "Finally, a CMS Built on",
		highlight: "Tools You Know",
	},
];

function getRandomHeadline() {
	return headlines[Math.floor(Math.random() * headlines.length)];
}

export function Hero() {
	const headline = useMemo(() => getRandomHeadline(), []);

	return (
		<section className="relative overflow-hidden pt-24 pb-24 lg:pt-32 lg:pb-32">
			{/* Background Ambience */}
			<div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none">
				<div className="absolute top-0 left-1/4 w-[500px] h-[500px] ambient-beam opacity-30" />
			</div>

			<div className="w-full max-w-7xl relative mx-auto px-4 z-10 grid lg:grid-cols-2 gap-12 items-center">
				{/* Left Column: Copy */}
				<div className="space-y-8 text-center lg:text-left min-w-0">
					<div className="inline-flex items-center gap-2 border border-primary/20 bg-primary/5 px-3 py-1 text-[10px] uppercase tracking-widest text-primary font-mono backdrop-blur-sm">
						<span className="w-1.5 h-1.5 bg-primary animate-pulse" />
						Beta
					</div>

					<h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter text-balance leading-[1.1]">
						{headline.top}{" "}
						<span className="text-transparent bg-clip-text bg-linear-to-r from-primary to-purple-400">
							{headline.highlight}
						</span>
					</h1>

					<p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto lg:mx-0 leading-relaxed">
						Headless CMS built on Drizzle, Better Auth, pg-boss, and Flydrive.
						Just Postgres—no Redis, no external services. Swap any part when you
						scale.
					</p>

					<div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
						<Link
							to="/docs/$"
							className="inline-flex items-center justify-center h-12 px-8 text-sm font-medium transition-all bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"
						>
							Read Documentation
							<ArrowRight className="ml-2 h-4 w-4" />
						</Link>
						<a
							href="#examples"
							className="inline-flex items-center justify-center h-12 px-8 text-sm font-medium transition-all border border-input bg-background hover:bg-accent hover:text-accent-foreground"
						>
							View Examples
						</a>
					</div>

					<ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-muted-foreground text-left max-w-lg mx-auto lg:mx-0">
						{[
							"Drizzle ORM — your schema, your migrations",
							"Better Auth — sessions out of the box",
							"pg-boss — queues without Redis",
							"Flydrive — S3, R2, local, whatever",
							"Hono / Elysia / Next / TanStack",
							"Type-safe from DB to frontend",
							// biome-ignore lint/suspicious/noArrayIndexKey: stable list
						].map((item, i) => (
							<li key={i} className="flex items-center gap-2">
								<div className="w-1 h-1 bg-primary" />
								{item}
							</li>
						))}
					</ul>
				</div>

				{/* Right Column: Code Preview */}
				<div className="relative min-w-0">
					<div className="absolute inset-0 bg-linear-to-tr from-primary/10 to-transparent blur-3xl -z-10" />

					{/* Animated Workflow */}
					<AnimatedWorkflow
						steps={workflowSteps}
						className="h-[600px] border border-border shadow-2xl"
					/>
				</div>
			</div>
		</section>
	);
}
