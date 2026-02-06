import { Link } from "@tanstack/react-router";
import { ArrowRight, FolderOpen, Github } from "lucide-react";

const example = {
  title: "Fullstack Barbershop",
  stack: "TanStack Start",
  description:
    "A complete booking system — appointments, services, barbers, customer management. Server-rendered with TanStack Query and a type-safe client SDK.",
  features: [
    "6 collections with relations",
    "18 page builder blocks",
    "Dashboard with real analytics",
    "i18n (EN/SK)",
  ],
  githubLink:
    "https://github.com/questpie/questpie-cms/tree/main/examples/tanstack-barbershop",
};

export function Examples() {
  return (
    <section
      id="examples"
      className="py-24 border-t border-border/30 relative overflow-hidden"
    >
      {/* Subtle background glow */}
      <div className="absolute top-0 right-1/4 w-[400px] h-[400px] bg-primary/3 rounded-full blur-[150px]" />

      <div className="w-full max-w-7xl mx-auto px-4 relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
          <div className="space-y-4">
            <h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">
              Templates
            </h2>
            <h3 className="text-3xl font-bold">Clone and Ship</h3>
            <p className="text-muted-foreground max-w-xl">
              Production-ready starters with best practices built in. Clone,
              customize, deploy.
            </p>
          </div>
          <a
            href="https://github.com/questpie/questpie-cms/tree/main/examples"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            View all on GitHub
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Main example */}
          <div className="group flex flex-col p-6 border border-border hover:border-primary/50 transition-colors">
            <div className="flex justify-between items-start mb-4">
              <span className="font-mono text-xs text-primary">
                {example.stack}
              </span>
              <a
                href={example.githubLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="h-4 w-4" />
              </a>
            </div>

            <h4 className="font-bold mb-2 group-hover:text-primary transition-colors">
              {example.title}
            </h4>

            <p className="text-sm text-muted-foreground mb-4">
              {example.description}
            </p>

            <ul className="text-xs text-muted-foreground space-y-1 mb-6">
              {example.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <div className="w-1 h-1 bg-primary" />
                  {feature}
                </li>
              ))}
            </ul>

            <div className="mt-auto flex gap-3">
              <a
                href={example.githubLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center h-9 px-4 text-xs font-medium border border-border hover:border-primary/50 transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5 mr-2" />
                Clone
              </a>
              <Link
                to="/docs/$"
                className="flex-1 inline-flex items-center justify-center h-9 px-4 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                Docs
                <ArrowRight className="h-3.5 w-3.5 ml-2" />
              </Link>
            </div>
          </div>

          {/* Coming soon placeholders */}
          {[1, 2].map((i) => (
            <div
              key={i}
              className="flex flex-col items-center justify-center p-6 border border-dashed border-border/30 text-center min-h-[280px]"
            >
              <div className="w-10 h-10 bg-muted/50 flex items-center justify-center mb-4">
                <FolderOpen className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">More coming soon</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
