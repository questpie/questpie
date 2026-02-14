/**
 * Stats Block
 *
 * Display key metrics/statistics in a grid.
 * Design: Clean cards with large numbers and labels.
 */

import type { BlockProps } from "./types";
import { cn } from "../../../lib/utils";

export function StatsRenderer({ values }: BlockProps<"stats">) {
  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4" }[values.columns || "3"];

  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-6xl">
        {values.title && (
          <h2 className="mb-12 text-3xl font-bold tracking-tight text-center">
            {values.title}
          </h2>
        )}
        <div className={cn("grid gap-6 grid-cols-1", columnsClass)}>
          {values.stats?.map((stat, index) => (
            <div
              key={index}
              className="rounded-lg border bg-card p-6 text-center"
            >
              <div className="text-4xl font-bold text-foreground mb-2">
                {stat.value}
              </div>
              <div className="text-lg font-medium text-foreground mb-1">
                {stat.label}
              </div>
              {stat.description && (
                <div className="text-sm text-muted-foreground">
                  {stat.description}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

