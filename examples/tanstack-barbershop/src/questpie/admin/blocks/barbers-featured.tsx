/**
 * Barbers Featured Block
 *
 * Manually selected barbers in a grid.
 * Design: Team member cards with photos and specialties.
 */

import {  RichTextRenderer,
  type TipTapDoc } from "@questpie/admin/client";
import type { BlockProps } from "./types";
import { cn } from "../../../lib/utils";

type Barber = {
  id: string;
  name: string;
  slug: string;
  bio: TipTapDoc | null;
  avatar: string | null;
  specialties: string[] | null;
};

export function BarbersFeaturedRenderer({
  values,
  data }: BlockProps<"barbers-featured">) {
  const barbers = (data?.barbers ?? []) as Barber[];

  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4" }[values.columns || "3"];

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
                        paragraph: "text-muted-foreground" }}
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

