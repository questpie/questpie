import { ArrowLeftRight, Code2, Layers, Puzzle } from "lucide-react";

const approaches = [
  {
    icon: Code2,
    title: "Two Builders, One System",
    description:
      "q() for backend schema and logic. qa() for admin UI configuration. Types flow automatically between them.",
  },
  {
    icon: Layers,
    title: "Native Libraries",
    description:
      "Drizzle for database. Better Auth for authentication. pg-boss for jobs. No proprietary abstractions.",
  },
  {
    icon: ArrowLeftRight,
    title: "Decoupled by Design",
    description:
      "Backend works headless without admin. Admin is optional. Build APIs first, add admin when you need it.",
  },
  {
    icon: Puzzle,
    title: "Framework Agnostic",
    description:
      "Works with Hono, Elysia, Next.js, TanStack Start. Mount anywhere with native adapters.",
  },
];

export function OurApproach() {
  return (
    <section className="py-24 border-t border-border/30 relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 right-1/4 w-[400px] h-[400px] bg-primary/3 rounded-full blur-[150px] -translate-y-1/2" />

      <div className="w-full max-w-7xl mx-auto px-4 relative z-10">
        <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
          <h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">
            Our Approach
          </h2>
          <h3 className="text-3xl md:text-4xl font-bold">
            Backend + Admin, Zero Lock-in
          </h3>
          <p className="text-muted-foreground">
            A complete CMS framework built on libraries you already know. Own
            every line of code.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {approaches.map((approach) => (
            <div
              key={approach.title}
              className="group p-6 border border-border hover:border-primary/50 transition-colors"
            >
              <div className="p-2 border border-border group-hover:border-primary/50 w-fit mb-4 transition-colors">
                <approach.icon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>

              <h4 className="font-bold mb-2 group-hover:text-primary transition-colors">
                {approach.title}
              </h4>

              <p className="text-sm text-muted-foreground leading-relaxed">
                {approach.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
