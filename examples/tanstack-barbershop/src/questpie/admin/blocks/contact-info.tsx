/**
 * Contact Info Block
 *
 * Display contact information with optional map embed.
 * Design: Two-column layout with info cards and map.
 */

import { Envelope, MapPin, Phone } from "@phosphor-icons/react";
import type { BlockProps } from "./types";
import { cn } from "../../../lib/utils";

export function ContactInfoRenderer({
  values,
  data }: BlockProps<"contact-info">) {
  const contactPhone = data?.contactPhone as string | undefined;
  const contactEmail = data?.contactEmail as string | undefined;
  const mapEmbedUrl = data?.mapEmbedUrl as string | undefined;
  const fullAddress = [
    data?.address as string | undefined,
    data?.city as string | undefined,
    data?.zipCode as string | undefined,
    data?.country as string | undefined,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="py-20 px-6">
      <div className="container">
        {values.title && (
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-12 text-center">
            {values.title}
          </h2>
        )}

        <div
          className={cn(
            "grid gap-8",
            values.showMap && data?.mapEmbedUrl
              ? "grid-cols-1 lg:grid-cols-2"
              : "max-w-2xl mx-auto",
          )}
        >
          {/* Contact Info Cards */}
          <div className="space-y-6">
            {contactPhone && (
              <div className="flex items-start gap-4 p-6 bg-card border rounded-lg">
                <Phone
                  className="size-6 text-highlight flex-shrink-0 mt-1"
                  weight="bold"
                />
                <div>
                  <h3 className="font-semibold mb-1">Phone</h3>
                  <a
                    href={`tel:${contactPhone}`}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {contactPhone}
                  </a>
                </div>
              </div>
            )}

            {contactEmail && (
              <div className="flex items-start gap-4 p-6 bg-card border rounded-lg">
                <Envelope
                  className="size-6 text-highlight flex-shrink-0 mt-1"
                  weight="bold"
                />
                <div>
                  <h3 className="font-semibold mb-1">Email</h3>
                  <a
                    href={`mailto:${contactEmail}`}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {contactEmail}
                  </a>
                </div>
              </div>
            )}

            {fullAddress && (
              <div className="flex items-start gap-4 p-6 bg-card border rounded-lg">
                <MapPin
                  className="size-6 text-highlight flex-shrink-0 mt-1"
                  weight="bold"
                />
                <div>
                  <h3 className="font-semibold mb-1">Address</h3>
                  <p className="text-muted-foreground">{fullAddress}</p>
                </div>
              </div>
            )}
          </div>

          {/* Map */}
          {values.showMap && mapEmbedUrl && (
            <div className="rounded-lg overflow-hidden border bg-muted aspect-square lg:aspect-auto">
              <iframe
                src={mapEmbedUrl}
                width="100%"
                height="100%"
                style={{ border: 0, minHeight: "400px" }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Location Map"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

