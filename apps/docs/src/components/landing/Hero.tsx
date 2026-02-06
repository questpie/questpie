import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { HeroVisual } from "./HeroVisual";
import { type Headline, headlines } from "./headlines";

export type HeroProps = {
  headlineIndex: number;
};

export function Hero({ headlineIndex }: HeroProps) {
  const headline: Headline = headlines[headlineIndex] ?? headlines[0];

  return (
    <section className="relative overflow-hidden py-24 lg:py-32">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[180px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-primary/3 rounded-full blur-[150px]" />
      </div>

      <div className="w-full max-w-7xl relative mx-auto px-4 z-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: Copy */}
          <div>
            {/* Badge */}
            <div className="inline-flex items-center gap-2 border border-primary/30 bg-primary/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-primary font-mono mb-8">
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              Open Source &middot; MIT License
            </div>

            {/* Headline */}
            <h1 className="text-4xl md:text-5xl lg:text-5xl xl:text-6xl font-bold tracking-tight leading-[1.08] mb-6">
              {headline.top}
              <br />
              <span className="text-primary">{headline.highlight}</span>
            </h1>

            {/* Subheadline */}
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-4 max-w-lg">
              Define your schema. Chain{" "}
              <code className="text-primary font-mono text-base bg-primary/10 px-1">
                .admin()
              </code>{" "}
              <code className="text-primary font-mono text-base bg-primary/10 px-1">
                .list()
              </code>{" "}
              <code className="text-primary font-mono text-base bg-primary/10 px-1">
                .form()
              </code>
              . Get a complete CMS with API, admin UI, auth, and jobs.
            </p>

            {/* Value props */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground mb-10">
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 bg-primary" />
                Drizzle ORM Native
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 bg-primary" />
                End-to-End Type Safety
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 bg-primary" />
                Config-Driven Admin
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 bg-primary" />
                Zero Codegen
              </span>
            </div>

            {/* CTA buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                to="/docs/$"
                className="group inline-flex items-center justify-center h-12 px-8 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href="https://github.com/questpie/questpie-cms"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-12 px-8 text-sm font-medium border border-border hover:bg-muted transition-colors"
              >
                View on GitHub
              </a>
            </div>

            {/* Install snippet */}
            <div className="mt-8 inline-flex items-center gap-3 px-4 py-2.5 bg-card border border-border font-mono text-sm text-muted-foreground">
              <span className="text-primary select-none">$</span>
              <span>bun add questpie @questpie/admin</span>
            </div>
          </div>

          {/* Right: Visual */}
          <div className="relative">
            <HeroVisual />
          </div>
        </div>
      </div>
    </section>
  );
}
