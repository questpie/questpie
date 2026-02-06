/**
 * Services Page Route
 *
 * Displays all active services offered by the barbershop.
 */

import { ArrowRight, Clock } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { getAllServices } from "@/lib/getServices.function";

export const Route = createFileRoute("/_app/services")({
  loader: async () => {
    const result = await getAllServices({ data: undefined });
    return { services: result.services };
  },
  component: ServicesPage,
});

function ServicesPage() {
  const { services } = Route.useLoaderData();

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  return (
    <div className="py-20 px-6">
      <div className="container max-w-5xl mx-auto">
        <header className="mb-16 text-center max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Our Services
          </h1>
          <p className="text-xl text-muted-foreground">
            Premium grooming services tailored to your style. We combine
            traditional techniques with modern aesthetics.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {services.map((service, i) => (
            <div
              key={service.id}
              className="group p-8 border border-border bg-card hover:border-highlight/30 transition-all duration-300 animate-fade-in-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              {service.image?.url && (
                <div className="mb-6 aspect-[4/3] overflow-hidden border border-border bg-muted">
                  <img
                    src={service.image.url}
                    alt={service.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
              )}
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-2xl font-bold group-hover:text-highlight transition-colors">
                  {service.name}
                </h3>
                <span className="text-xl font-bold text-highlight">
                  {formatPrice(service.price)}
                </span>
              </div>

              {service.description && (
                <p className="text-muted-foreground mb-8 text-lg leading-relaxed">
                  {service.description}
                </p>
              )}

              <div className="flex items-center justify-between mt-auto pt-6 border-t border-border">
                <div className="flex items-center gap-2 text-muted-foreground font-medium">
                  <Clock weight="bold" className="size-5" />
                  {service.duration} minutes
                </div>

                <a
                  href={`/booking?service=${service.id}`}
                  className="inline-flex items-center gap-2 font-bold text-highlight group/link"
                >
                  Book Now
                  <ArrowRight className="size-4 transition-transform group-hover/link:translate-x-1" />
                </a>
              </div>
            </div>
          ))}
        </div>

        {services.length === 0 && (
          <div className="text-center py-20 bg-muted/30 border border-dashed border-border">
            <p className="text-xl text-muted-foreground">No services found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
