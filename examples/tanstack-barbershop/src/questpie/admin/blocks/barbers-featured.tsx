/**
 * Barbers Featured Block
 *
 * Manually selected barbers in a grid.
 * Design: Team member cards with photos and specialties.
 */

import {
  type BlockRendererProps,
  RichTextRenderer,
  type TipTapDoc,
} from "@questpie/admin/client";
import { cn } from "../../../lib/utils";
import { builder } from "../builder";

type Barber = {
  id: string;
  name: string;
  slug: string;
  bio: TipTapDoc | null;
  avatar: string | null;
  specialties: string[] | null;
};

type BarbersFeaturedValues = {
  title: string;
  subtitle?: string;
  barberIds: string[];
  columns: "2" | "3" | "4";
};

function BarbersFeaturedRenderer({
  values,
  data,
}: BlockRendererProps<BarbersFeaturedValues>) {
  const { barbers = [] } = (data as { barbers: Barber[] }) || {};

  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4",
  }[values.columns || "3"];

  return (
    <section className="py-20 px-6">
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

        {/* Barbers Grid */}
        <div className={cn("grid grid-cols-1 gap-8", columnsClass)}>
          {barbers.map((barber) => (
            <article
              key={barber.id}
              className="group bg-card border rounded-lg overflow-hidden hover:shadow-lg transition-all duration-300"
            >
              {/* Avatar */}
              <div className="aspect-square overflow-hidden bg-muted">
                {barber.avatar ? (
                  <img
                    src={barber.avatar}
                    alt={barber.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-6xl font-bold text-muted-foreground/20">
                    {barber.name[0]}
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="p-6">
                <h3 className="text-xl font-bold mb-2">{barber.name}</h3>
                {barber.bio && (
                  <div className="mb-4 line-clamp-2">
                    <RichTextRenderer
                      content={barber.bio}
                      styles={{
                        doc: "",
                        paragraph: "text-muted-foreground",
                      }}
                    />
                  </div>
                )}

                {/* Specialties */}
                {barber.specialties && barber.specialties.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {barber.specialties.map((specialty, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1 bg-muted text-sm rounded-full"
                      >
                        {specialty}
                      </span>
                    ))}
                  </div>
                )}

                {/* CTA */}
                <a
                  href={`/barbers/${barber.slug}`}
                  className="inline-block mt-2 text-sm font-medium text-primary hover:underline"
                >
                  View Profile →
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export const barbersFeaturedBlock = builder
  .block("barbers-featured")
  .label({ en: "Barbers (Featured)", sk: "Holiči (vybraní)" })
  .description({
    en: "Manually selected barbers",
    sk: "Ručne vybratí holiči",
  })
  .icon("UsersThree")
  .category("content")
  .fields(({ r }) => ({
    title: r.text({
      label: { en: "Title", sk: "Nadpis" },
      required: true,
      localized: true,
      defaultValue: { en: "Our Team", sk: "Náš tím" },
    }),
    subtitle: r.text({
      label: { en: "Subtitle", sk: "Podnadpis" },
      localized: true,
    }),
    barberIds: r.relation({
      label: { en: "Select Barbers", sk: "Vybrať holičov" },
      targetCollection: "barbers",
      required: true,
      type: "multiple",
      maxItems: 10,
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
  .renderer(BarbersFeaturedRenderer)
  .build();
