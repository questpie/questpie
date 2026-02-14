/**
 * Booking CTA Block
 *
 * Specialized call-to-action for booking appointments.
 * Design: Prominent button with optional pre-selected service/barber.
 */

import type { BlockProps } from "./types";
import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";

export function BookingCtaRenderer({ values }: BlockProps<"booking-cta">) {
  // Build booking URL with query params
  const params = new URLSearchParams();
  if (values.serviceId) params.set("service", values.serviceId);
  if (values.barberId) params.set("barber", values.barberId);
  const bookingUrl = `/booking${params.toString() ? `?${params.toString()}` : ""}`;

  const buttonClass = cn(
    buttonVariants({
      size: values.size === "lg" ? "lg" : "default",
      variant: values.variant === "outline" ? "outline" : "default" }),
    "text-base font-semibold",
    values.variant === "highlight" &&
      "bg-highlight text-white hover:bg-highlight/90",
    values.variant === "default" &&
      "bg-primary text-primary-foreground hover:bg-primary/90",
    values.variant === "outline" &&
      "border-primary text-primary hover:bg-primary hover:text-primary-foreground",
  );

  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          {values.title || "Book Your Appointment"}
        </h2>
        {values.description && (
          <p className="mt-4 text-lg text-muted-foreground">
            {values.description}
          </p>
        )}
        <div className="mt-8">
          <a href={bookingUrl} className={buttonClass}>
            {values.buttonText || "Book Now"}
          </a>
        </div>
      </div>
    </section>
  );
}

