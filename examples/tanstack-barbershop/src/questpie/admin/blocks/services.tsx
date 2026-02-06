/**
 * Services Block
 *
 * Grid of services with pricing and duration.
 * Design: Clean cards with subtle hover effects.
 */

import { ArrowRight, Clock } from "@phosphor-icons/react";
import type {
  BlockDefinition,
  BlockRendererProps,
} from "@questpie/admin/client";
import { cn } from "../../../lib/utils";

type Service = {
  id: string;
  name: string;
  description: string | null;
  imageUrl?: string | null;
  price: number;
  duration: number;
};

type ServicesValues = {
  title: string;
  subtitle: string;
  showPrices: boolean;
  showDuration: boolean;
  columns: "2" | "3" | "4";
  limit: number;
};

function ServicesRenderer({
  values,
  data,
}: BlockRendererProps<ServicesValues>) {
  const { services = [] } = (data as { services: Service[] }) || {};

  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4",
  }[values.columns || "3"];

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

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

        {/* Services Grid */}
        <div className={cn("grid grid-cols-1 gap-6", columnsClass)}>
          {services.map((service, i) => (
            <article
              key={service.id}
              className="group p-6 border border-border bg-card hover:border-foreground/20 transition-all duration-300 animate-fade-in-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              {service.imageUrl && (
                <div className="mb-4 aspect-[4/3] overflow-hidden border border-border bg-muted">
                  <img
                    src={service.imageUrl}
                    alt={service.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
              )}
              <h3 className="text-xl font-semibold mb-2 group-hover:text-highlight transition-colors">
                {service.name}
              </h3>

              {service.description && (
                <p className="text-muted-foreground text-sm mb-6 line-clamp-2">
                  {service.description}
                </p>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {values.showDuration && (
                    <span className="flex items-center gap-1.5">
                      <Clock className="size-4" />
                      {service.duration} min
                    </span>
                  )}
                </div>

                {values.showPrices && (
                  <span className="font-semibold text-highlight">
                    {formatPrice(service.price)}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>

        {services.length === 0 && (
          <p className="text-center text-muted-foreground py-12">
            No services available
          </p>
        )}

        {/* View All Link */}
        {services.length > 0 && (
          <div className="text-center mt-12">
            <a
              href="/services"
              className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-highlight transition-colors group"
            >
              View all services
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

export const servicesBlock = {
  name: "services",
  renderer: ServicesRenderer,
} satisfies BlockDefinition;
