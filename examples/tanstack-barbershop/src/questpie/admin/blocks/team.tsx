/**
 * Team Block (Barbers)
 *
 * Grid of team members with photos.
 * Design: Portrait images with minimal info overlay.
 */

import { ArrowRight, User } from "@phosphor-icons/react";
import type { BlockRendererProps } from "@questpie/admin/client";
import { cn } from "../../../lib/utils";
import { builder } from "../builder";

type Barber = {
  id: string;
  name: string;
  slug: string;
  avatar: string | null;
  specialties: string[] | null;
};

type TeamValues = {
  title: string;
  subtitle: string;
  columns: "2" | "3" | "4";
  limit: number;
};

function TeamRenderer({ values, data }: BlockRendererProps<TeamValues>) {
  const { barbers = [] } = (data as { barbers: Barber[] }) || {};

  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4",
  }[values.columns || "3"];

  return (
    <section className="py-20 px-6 bg-muted/30">
      <div className="container">
        {/* Header */}
        {(values.title || values.subtitle) && (
          <div className="text-center mb-16 max-w-2xl mx-auto">
            {values.title && (
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                {values.title}
              </h2>
            )}
            {values.subtitle && (
              <p className="text-lg text-muted-foreground">{values.subtitle}</p>
            )}
          </div>
        )}

        {/* Team Grid */}
        <div className={cn("grid grid-cols-1 gap-8", columnsClass)}>
          {barbers.map((barber, i) => (
            <a
              key={barber.id}
              href={`/barbers/${barber.slug}`}
              className="group block animate-fade-in-up"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              {/* Photo */}
              <div className="aspect-[3/4] bg-muted mb-4 overflow-hidden relative">
                {barber.avatar ? (
                  <img
                    src={barber.avatar}
                    alt={barber.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted">
                    <User className="size-24 text-muted-foreground/30" />
                  </div>
                )}

                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
              </div>

              {/* Info */}
              <div className="space-y-1">
                <h3 className="text-xl font-semibold group-hover:text-highlight transition-colors">
                  {barber.name}
                </h3>
                {barber.specialties && barber.specialties.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {barber.specialties.slice(0, 3).join(" · ")}
                  </p>
                )}
              </div>
            </a>
          ))}
        </div>

        {barbers.length === 0 && (
          <p className="text-center text-muted-foreground py-12">
            No team members available
          </p>
        )}

        {/* View All Link */}
        {barbers.length > 0 && (
          <div className="text-center mt-12">
            <a
              href="/barbers"
              className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-highlight transition-colors group"
            >
              Meet the full team
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

export const teamBlock = builder
  .block("team")
  .label({ en: "Team", sk: "Tím" })
  .description({
    en: "Display team members",
    sk: "Zobrazenie členov tímu",
  })
  .icon("Users")
  .category("sections")
  .fields(({ r }) => ({
    title: r.text({
      label: { en: "Title", sk: "Titulok" },
      localized: true,
    }),
    subtitle: r.textarea({
      label: { en: "Subtitle", sk: "Podtitulok" },
      localized: true,
    }),
    columns: r.select({
      label: { en: "Columns", sk: "Stĺpce" },
      options: [
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
      ],
      defaultValue: "3",
    }),
    limit: r.number({
      label: { en: "Max Members", sk: "Max členov" },
      defaultValue: 6,
      min: 1,
      max: 12,
    }),
  }))
  .renderer(TeamRenderer)
  .build();
