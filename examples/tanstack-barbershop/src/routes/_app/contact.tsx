/**
 * Contact Page Route
 *
 * Displays shop location, contact info, and business hours.
 */

import { Envelope, MapPin, Phone } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import {
  getSiteSettings,
  type SiteSettingsData,
} from "@/lib/getSiteSettings.function";
import { useTranslation } from "@/lib/providers/locale-provider";

export const Route = createFileRoute("/_app/contact")({
  loader: async () => {
    const settings = (await getSiteSettings({
      data: { locale: undefined },
    })) as SiteSettingsData;
    return { settings };
  },
  component: ContactPage,
});

function ContactPage() {
  const { settings } = Route.useLoaderData();
  const { t } = useTranslation();

  const businessHours = settings.businessHours || {
    monday: { isOpen: true, start: "08:00", end: "20:00" },
    tuesday: { isOpen: true, start: "08:00", end: "20:00" },
    wednesday: { isOpen: true, start: "08:00", end: "20:00" },
    thursday: { isOpen: true, start: "08:00", end: "20:00" },
    friday: { isOpen: true, start: "08:00", end: "20:00" },
    saturday: { isOpen: true, start: "09:00", end: "18:00" },
    sunday: { isOpen: false, start: "00:00", end: "00:00" },
  };

  const days = [
    { id: "monday", labelKey: "day.monday" },
    { id: "tuesday", labelKey: "day.tuesday" },
    { id: "wednesday", labelKey: "day.wednesday" },
    { id: "thursday", labelKey: "day.thursday" },
    { id: "friday", labelKey: "day.friday" },
    { id: "saturday", labelKey: "day.saturday" },
    { id: "sunday", labelKey: "day.sunday" },
  ] as const;

  return (
    <div className="py-20 px-6">
      <div className="container max-w-5xl mx-auto">
        <header className="mb-16 text-center max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            {t("contact.title")}
          </h1>
          <p className="text-xl text-muted-foreground">
            {t("contact.subtitle")}
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
          {/* Contact Info */}
          <div className="space-y-12">
            <div className="space-y-8">
              <h2 className="text-2xl font-bold">{t("contact.details")}</h2>

              <div className="flex gap-6 items-start">
                <div className="size-12 bg-muted flex items-center justify-center border border-border shrink-0">
                  <MapPin weight="fill" className="size-6 text-highlight" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">
                    {t("contact.address")}
                  </h3>
                  <p className="text-muted-foreground text-lg">
                    {settings.address || "123 Grooming St."}
                    <br />
                    {settings.zipCode} {settings.city || "Barbertown"}
                    <br />
                    {settings.country || "Slovakia"}
                  </p>
                </div>
              </div>

              <div className="flex gap-6 items-start">
                <div className="size-12 bg-muted flex items-center justify-center border border-border shrink-0">
                  <Phone weight="fill" className="size-6 text-highlight" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">
                    {t("contact.phone")}
                  </h3>
                  <p className="text-muted-foreground text-lg hover:text-highlight transition-colors">
                    <a href={`tel:${settings.contactPhone}`}>
                      {settings.contactPhone || "+421 900 000 000"}
                    </a>
                  </p>
                </div>
              </div>

              <div className="flex gap-6 items-start">
                <div className="size-12 bg-muted flex items-center justify-center border border-border shrink-0">
                  <Envelope weight="fill" className="size-6 text-highlight" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">
                    {t("contact.email")}
                  </h3>
                  <p className="text-muted-foreground text-lg hover:text-highlight transition-colors">
                    <a href={`mailto:${settings.contactEmail}`}>
                      {settings.contactEmail}
                    </a>
                  </p>
                </div>
              </div>
            </div>

            {/* Map */}
            {settings.mapEmbedUrl ? (
              <div className="aspect-video bg-muted border border-border relative overflow-hidden">
                <iframe
                  src={settings.mapEmbedUrl}
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Location Map"
                />
              </div>
            ) : (
              <div className="aspect-video bg-muted border border-border relative overflow-hidden group">
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-muted-foreground font-medium">
                    {t("contact.mapPlaceholder")}
                  </p>
                </div>
                <div className="absolute inset-0 bg-highlight/5 group-hover:bg-transparent transition-colors duration-500" />
              </div>
            )}
          </div>

          {/* Business Hours */}
          <div className="bg-muted/30 border border-border p-10">
            <h2 className="text-2xl font-bold mb-8 text-center md:text-left">
              {t("contact.hours")}
            </h2>
            <div className="space-y-6">
              {days.map((day) => {
                const hours =
                  businessHours[day.id as keyof typeof businessHours];
                return (
                  <div
                    key={day.id}
                    className="flex justify-between items-center border-b border-border/50 pb-4"
                  >
                    <span className="font-medium text-lg">
                      {t(day.labelKey)}
                    </span>
                    {hours.isOpen ? (
                      <span className="text-muted-foreground font-medium">
                        {hours.start} — {hours.end}
                      </span>
                    ) : (
                      <span className="text-highlight font-bold uppercase text-sm tracking-wider">
                        {t("contact.closed")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-12 text-center">
              <p className="text-sm text-muted-foreground mb-6 italic">
                {t("contact.holidayNote")}
              </p>
              <a
                href="/booking"
                className="inline-block w-full py-4 bg-foreground text-background font-bold text-lg hover:bg-highlight hover:text-highlight-foreground transition-all duration-300"
              >
                {t("cta.bookNow")}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
