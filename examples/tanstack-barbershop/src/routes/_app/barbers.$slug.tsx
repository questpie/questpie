/**
 * Barber Profile Route
 *
 * Displays individual barber bio, specialties, and their specific services.
 */

import {
  ArrowLeft,
  Clock,
  EnvelopeSimple,
  Phone,
  User,
} from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RichTextRenderer, type TipTapDoc } from "@questpie/admin/client";
import { getBarber } from "@/lib/getBarbers.function";

export const Route = createFileRoute("/_app/barbers/$slug")({
  loader: async (ctx) => {
    return getBarber({ data: { slug: ctx.params.slug } });
  },
  component: BarberProfilePage,
});

function BarberProfilePage() {
  const { barber } = Route.useLoaderData();

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  return (
    <div className="py-20 px-6">
      <div className="container max-w-5xl mx-auto">
        {/* Back Link */}
        <Link
          to="/barbers"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-12 transition-colors group"
        >
          <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
          Back to Team
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
          {/* Left: Avatar & Info */}
          <div className="lg:col-span-5 space-y-8">
            <div className="aspect-[3/4] bg-muted overflow-hidden border border-border sticky top-24">
              {barber.avatar ? (
                <img
                  src={barber.avatar as string}
                  alt={barber.name as string}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User className="size-40 text-muted-foreground/20" />
                </div>
              )}
            </div>
          </div>

          {/* Right: Bio & Services */}
          <div className="lg:col-span-7 space-y-12">
            <section>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
                {barber.name}
              </h1>

              {barber.specialties &&
                (barber.specialties as string[]).length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-8">
                    {(barber.specialties as string[]).map((s) => (
                      <span
                        key={s}
                        className="px-3 py-1 bg-highlight/10 text-highlight text-sm font-bold uppercase tracking-wider"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}

              <div className="prose prose-stone prose-lg dark:prose-invert max-w-none">
                <RichTextRenderer
                  content={barber.bio as TipTapDoc}
                  styles={{
                    paragraph:
                      "text-muted-foreground leading-relaxed mb-4 last:mb-0",
                  }}
                />
                {!barber.bio && (
                  <p className="text-muted-foreground leading-relaxed">
                    No biography available.
                  </p>
                )}
              </div>
            </section>

            {/* Contact Info */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-8 bg-muted/30 border border-border">
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Email
                </span>
                <a
                  href={`mailto:${barber.email}`}
                  className="flex items-center gap-2 font-medium hover:text-highlight transition-colors"
                >
                  <EnvelopeSimple className="size-5" />
                  {barber.email}
                </a>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Phone
                </span>
                <a
                  href={`tel:${barber.phone}`}
                  className="flex items-center gap-2 font-medium hover:text-highlight transition-colors"
                >
                  <Phone className="size-5" />
                  {barber.phone}
                </a>
              </div>
            </section>

            {/* Personal Services */}
            {barber.services && barber.services.length > 0 && (
              <section className="space-y-8">
                <h2 className="text-3xl font-bold tracking-tight">
                  Services by {barber.name.split(" ")[0]}
                </h2>
                <div className="space-y-4">
                  {barber.services.map((service: any) => (
                    <div
                      key={service.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-6 border border-border bg-card hover:border-highlight/30 transition-all group"
                    >
                      <div className="mb-4 sm:mb-0">
                        <h3 className="text-xl font-bold group-hover:text-highlight transition-colors">
                          {service.name}
                        </h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Clock className="size-4" />
                            {service.duration} min
                          </span>
                          <span className="font-bold text-highlight">
                            {formatPrice(service.price)}
                          </span>
                        </div>
                      </div>

                      <Link
                        to="/booking"
                        search={{ barber: barber.id, service: service.id }}
                        className="px-6 py-3 bg-foreground text-background text-sm font-bold uppercase tracking-widest hover:bg-highlight hover:text-highlight-foreground transition-all text-center"
                      >
                        Book This
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
