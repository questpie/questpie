import {
	Database,
	Shield,
	Clock,
	HardDrive,
	Mail,
	GitBranch,
} from "lucide-react";

const stack = [
	{
		icon: Database,
		layer: "Schema & Database",
		library: "Drizzle ORM",
		description:
			"Type-safe schemas, raw SQL when you need it. The ORM the community actually loves.",
		link: "https://orm.drizzle.team/",
	},
	{
		icon: GitBranch,
		layer: "Migrations",
		library: "Drizzle Kit + Custom Runner",
		description:
			"Auto-generated migrations with full rollback support. Up, down, reset, fresh—batched and reversible.",
		link: "/docs/reference/cli",
	},
	{
		icon: Shield,
		layer: "Authentication",
		library: "Better Auth",
		description:
			"Sessions, OAuth, 2FA, organizations. Modern auth that just works with any framework.",
		link: "https://www.better-auth.com/",
	},
	{
		icon: Clock,
		layer: "Background Jobs",
		library: "pg-boss",
		description:
			"Job queues powered by PostgreSQL. No Redis needed. Retries, scheduling, priorities built-in.",
		link: "https://github.com/timgit/pg-boss",
	},
	{
		icon: HardDrive,
		layer: "File Storage",
		library: "Flydrive",
		description:
			"Unified API for local disk, S3, R2, GCS. Swap providers without changing code.",
		link: "https://flydrive.dev/",
	},
	{
		icon: Mail,
		layer: "Email",
		library: "Nodemailer + React Email",
		description:
			"Battle-tested delivery with modern React templates. SMTP, Resend, Sendgrid—your choice.",
		link: "https://react.email/",
	},
];

export function Comparison() {
	return (
		<section className="py-24 border-y border-border bg-card/30 backdrop-blur-sm">
			<div className="w-full max-w-7xl mx-auto px-4">
				<div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
					<h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">
						The Stack
					</h2>
					<h3 className="text-3xl md:text-4xl font-bold">
						Built on Libraries You Already Know
					</h3>
					<p className="text-muted-foreground">
						We don't reinvent what the community already perfected. QUESTPIE is
						glue code for the best TypeScript libraries—learn them once, use
						them everywhere.
					</p>
				</div>

				<div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
					{stack.map((item, i) => (
						<a
							key={i}
							href={item.link}
							target="_blank"
							rel="noopener noreferrer"
							className="group p-6 border border-border bg-background/50 hover:border-primary/50 hover:bg-card/50 transition-all"
						>
							<div className="flex items-start gap-4">
								<div className="shrink-0 w-10 h-10 bg-primary/10 border border-primary/20 flex items-center justify-center">
									<item.icon className="w-5 h-5 text-primary" />
								</div>
								<div className="space-y-2 min-w-0">
									<div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
										{item.layer}
									</div>
									<h4 className="font-bold group-hover:text-primary transition-colors">
										{item.library}
									</h4>
									<p className="text-sm text-muted-foreground leading-relaxed">
										{item.description}
									</p>
								</div>
							</div>
						</a>
					))}
				</div>

				<div className="mt-12 text-center">
					<p className="text-sm text-muted-foreground">
						All libraries are swappable via adapters.{" "}
						<span className="text-primary">
							Postgres is the only requirement.
						</span>
					</p>
				</div>
			</div>
		</section>
	);
}
