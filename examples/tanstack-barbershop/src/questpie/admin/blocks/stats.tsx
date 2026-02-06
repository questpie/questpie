/**
 * Stats Block
 *
 * Display key metrics/statistics in a grid.
 * Design: Clean cards with large numbers and labels.
 */

import type { BlockRendererProps } from "@questpie/admin/client";
import { cn } from "../../../lib/utils";
import { builder } from "../builder";

type Stat = {
  value: string;
  label: string;
  description?: string;
};

type StatsValues = {
  title?: string;
  stats: Stat[];
  columns: "2" | "3" | "4";
};

function StatsRenderer({ values }: BlockRendererProps<StatsValues>) {
  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4",
  }[values.columns || "3"];

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

export const statsBlock = builder
  .block("stats")
  .label({ en: "Statistics", sk: "Štatistiky" })
  .description({
    en: "Display key metrics in a grid",
    sk: "Zobrazí kľúčové metriky",
  })
  .icon("ChartBar")
  .category("content")
  .fields(({ r }) => ({
    title: r.text({
      label: { en: "Title", sk: "Nadpis" },
      localized: true,
    }),
    stats: r.array({
      label: { en: "Statistics", sk: "Štatistiky" },
      item: ({ r }) => ({
        value: r.text({
          label: { en: "Value", sk: "Hodnota" },
          required: true,
          placeholder: { en: "1000+", sk: "1000+" },
        }),
        label: r.text({
          label: { en: "Label", sk: "Popis" },
          required: true,
          localized: true,
          placeholder: { en: "Happy Clients", sk: "Spokojných klientov" },
        }),
        description: r.text({
          label: { en: "Description (optional)", sk: "Popis (voliteľný)" },
          localized: true,
        }),
      }),
    }),
    columns: r.select({
      label: { en: "Columns", sk: "Stĺpce" },
      options: [
        { value: "2", label: { en: "2 columns", sk: "2 stĺpce" } },
        { value: "3", label: { en: "3 columns", sk: "3 stĺpce" } },
        { value: "4", label: { en: "4 columns", sk: "4 stĺpce" } },
      ],
      defaultValue: "3",
    }),
  }))
  .renderer(StatsRenderer)
  .build();
