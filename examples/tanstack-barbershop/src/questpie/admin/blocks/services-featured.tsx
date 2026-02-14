/**
 * Services Featured Block
 *
 * Manually selected services in a grid.
 * Design: Same as services block but with manual selection.
 */

import { Clock, CurrencyDollar } from "@phosphor-icons/react";
import type { BlockProps } from "./types";
import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration: number;
  image: string | null;
};

export function ServicesFeaturedRenderer({
  values,
  data }: BlockProps<"services-featured">) {
  const services = (data?.services ?? []) as Service[];

  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4" }[values.columns || "3"];

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("sk-SK", {
      style: "currency",
      currency: "EUR" }).format(cents / 100);
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
        <div className={cn("grid grid-cols-1 gap-8", columnsClass)}>
          {services.map((service, _i) => (
            <article
              key={service.id}
              className="group bg-card border rounded-lg overflow-hidden hover:shadow-lg transition-all duration-300"
            >
              {/* Image */}
              {service.image && (
                <div className="aspect-[4/3] overflow-hidden bg-muted">
                  <img
                    src={service.image}
                    alt={service.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
              )}

              {/* Content */}
              <div className="p-6">
                <h3 className="text-xl font-bold mb-2">{service.name}</h3>
                {service.description && (
                  <p className="text-muted-foreground mb-4 line-clamp-2">
                    {service.description}
                  </p>
                )}

                {/* Meta */}
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-4" weight="bold" />
                      {service.duration} min
                    </span>
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                      <CurrencyDollar className="size-4" weight="bold" />
                      {formatPrice(service.price)}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-12">
          <a
            href="/booking"
            className={cn(
              buttonVariants({ size: "lg" }),
              "text-base font-semibold",
            )}
          >
            Book Appointment
          </a>
        </div>
      </div>
    </section>
  );
}

