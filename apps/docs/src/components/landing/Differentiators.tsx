import { Check, X } from "lucide-react";

const comparisons = [
  {
    target: "Payload CMS",
    rows: [
      ["Drizzle ORM (you control schema)", "Custom ORM (Payload controls)"],
      ["Better Auth (modern, extensible)", "Built-in auth (limited)"],
      ["Postgres-only (simple)", "MongoDB + Postgres"],
      ["Backend & Admin separate", "Tightly coupled"],
      ["Builder pattern config", "JSON/TS config"],
    ],
  },
  {
    target: "Strapi",
    rows: [
      ["Code-first, TypeScript", "GUI-first, code generation"],
      ["Your schema, your migrations", "Auto-generated schema"],
      ["No lock-in", "Plugin marketplace lock-in"],
      ["Native libraries", "Custom implementations"],
    ],
  },
  {
    target: "Building from Scratch",
    rows: [
      ["Admin UI included", "Build yourself"],
      ["Auth, jobs, email wired", "Wire everything yourself"],
      ["Type-safe CRUD", "Write all CRUD"],
      ["Native Drizzle", "Use Drizzle directly"],
    ],
  },
];

export function Differentiators() {
  return (
    <section className="py-24 border-t border-border/30">
      <div className="w-full max-w-7xl mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
          <h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">
            Differentiators
          </h2>
          <h3 className="text-3xl md:text-4xl font-bold">How We Compare</h3>
          <p className="text-muted-foreground">
            QUESTPIE is built for developers who want full control over their
            code while having all the boilerplate handled.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {comparisons.map((comp) => (
            <div key={comp.target} className="space-y-6">
              <h4 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-primary" />
                vs. {comp.target}
              </h4>
              <div className="border border-border bg-card/30 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-4 font-bold text-primary">
                        QUESTPIE
                      </th>
                      <th className="text-left p-4 font-bold text-muted-foreground">
                        {comp.target}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {comp.rows.map((row, i) => (
                      <tr
                        key={i}
                        className="group hover:bg-white/5 transition-colors"
                      >
                        <td className="p-4 align-top">
                          <div className="flex gap-2">
                            <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                            <span>{row[0]}</span>
                          </div>
                        </td>
                        <td className="p-4 align-top text-muted-foreground">
                          <div className="flex gap-2">
                            <X className="w-4 h-4 text-red-500/50 shrink-0 mt-0.5" />
                            <span>{row[1]}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
