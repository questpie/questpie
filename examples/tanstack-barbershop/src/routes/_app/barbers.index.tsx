/**
 * Barbers Index Page
 *
 * Displays all active barbers with their specialties and bio snippets.
 */

import { ArrowRight, User } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { RichTextRenderer, type TipTapDoc } from "@questpie/admin/client";
import { getAllBarbers } from "@/lib/getBarbers.function";

export const Route = createFileRoute("/_app/barbers/")({
  loader: async () => {
    const result = await getAllBarbers({ data: undefined });
    return { barbers: result.barbers };
  },
  component: BarbersPage,
});

function BarbersPage() {
  const { barbers } = Route.useLoaderData();

  return (
    <div className="py-20 px-6">
      <div className="container max-w-6xl mx-auto">
        <header className="mb-16 text-center max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Meet Our Team
          </h1>
          <p className="text-xl text-muted-foreground">
            Our master barbers are dedicated to the craft of traditional
            grooming and modern styling.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10">
          {barbers.map((barber, i) => (
            <a
              key={barber.id}
              href={`/barbers/${barber.slug}`}
              className="group block animate-fade-in-up"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="aspect-[3/4] bg-muted mb-6 overflow-hidden relative border border-border">
                {barber.avatar ? (
                  <img
                    src={barber.avatar as string}
                    alt={barber.name as string}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted">
                    <User className="size-32 text-muted-foreground/20" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-500" />

                <div className="absolute bottom-0 left-0 right-0 p-6 translate-y-full group-hover:translate-y-0 transition-transform duration-500 bg-gradient-to-t from-black/80 to-transparent">
                  <span className="text-white font-bold inline-flex items-center gap-2">
                    View Profile <ArrowRight className="size-4" />
                  </span>
                </div>
              </div>

              <h3 className="text-2xl font-bold mb-2 group-hover:text-highlight transition-colors">
                {barber.name}
              </h3>

              {barber.specialties &&
                (barber.specialties as string[]).length > 0 && (
                  <p className="text-highlight font-medium text-sm mb-3">
                    {(barber.specialties as string[]).join(" · ")}
                  </p>
                )}

              <div className="line-clamp-2">
                <RichTextRenderer
                  content={barber.bio as TipTapDoc}
                  styles={{
                    doc: "",
                    paragraph: "text-muted-foreground leading-relaxed",
                  }}
                />
              </div>
            </a>
          ))}
        </div>

        {barbers.length === 0 && (
          <div className="text-center py-20 bg-muted/30 border border-dashed border-border">
            <p className="text-xl text-muted-foreground">No barbers found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
