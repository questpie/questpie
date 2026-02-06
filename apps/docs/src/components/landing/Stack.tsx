import {
  Clock,
  Database,
  GitBranch,
  HardDrive,
  Mail,
  Shield,
} from "lucide-react";

const stack = [
  {
    icon: Database,
    layer: "Schema & DB",
    library: "Drizzle ORM",
    description:
      "Your schema is real Drizzle. Type-safe queries, raw SQL when you need it, zero abstraction tax.",
    href: "https://orm.drizzle.team/",
  },
  {
    icon: GitBranch,
    layer: "Migrations",
    library: "Drizzle Kit",
    description:
      "Schema changes auto-generate migrations. Push, pull, and rollback with a single command.",
    href: "https://orm.drizzle.team/kit-docs/overview",
  },
  {
    icon: Shield,
    layer: "Authentication",
    library: "Better Auth",
    description:
      "Sessions, OAuth, 2FA, organizations out of the box. Production-grade auth, not a toy.",
    href: "https://www.better-auth.com/",
  },
  {
    icon: Clock,
    layer: "Background Jobs",
    library: "pg-boss",
    description:
      "Job queues on Postgres. No Redis, no extra infrastructure. Retries, scheduling, priorities built in.",
    href: "https://github.com/timgit/pg-boss",
  },
  {
    icon: HardDrive,
    layer: "File Storage",
    library: "Flydrive",
    description:
      "Local disk, S3, R2, GCS — same API. Switch storage providers without touching your code.",
    href: "https://flydrive.dev/",
  },
  {
    icon: Mail,
    layer: "Email",
    library: "React Email",
    description:
      "Build email templates with React. Send via SMTP, Resend, or Sendgrid. No HTML table nightmares.",
    href: "https://react.email/",
  },
];

export function Stack() {
  return (
    <section className="py-24 border-t border-border/30 relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/4 w-[400px] h-[400px] bg-primary/3 rounded-full blur-[150px] -translate-y-1/2" />

      <div className="w-full max-w-7xl mx-auto px-4 relative z-10">
        <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
          <h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">
            Built With
          </h2>
          <h3 className="text-3xl md:text-4xl font-bold">
            Libraries You Already Know
          </h3>
          <p className="text-muted-foreground">
            No proprietary ORM. No custom auth. QuestPie integrates
            battle-tested TypeScript libraries you can learn, debug, and use
            independently.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {stack.map((item) => (
            <a
              key={item.library}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group p-6 border border-border backdrop-blur-xs bg-background/5 hover:border-primary/50 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="p-2 border border-border group-hover:border-primary/50 transition-colors">
                  <item.icon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {item.layer}
                </span>
              </div>

              <h4 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors">
                {item.library}
              </h4>

              <p className="text-sm text-muted-foreground leading-relaxed">
                {item.description}
              </p>
            </a>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-sm text-muted-foreground">
            Every integration is swappable via adapters.{" "}
            <span className="text-foreground">
              Postgres is the only hard requirement.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
