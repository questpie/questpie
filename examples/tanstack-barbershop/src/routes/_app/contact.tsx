/**
 * Contact Page Route
 *
 * Displays shop location, contact info, and business hours.
 */

import { Icon } from "@iconify/react";
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
		<div className="px-6 py-20">
			<div className="container mx-auto max-w-5xl">
				<header className="mx-auto mb-16 max-w-2xl text-center">
					<h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
						{t("contact.title")}
					</h1>
					<p className="text-muted-foreground text-xl">
						{t("contact.subtitle")}
					</p>
				</header>

				<div className="grid grid-cols-1 gap-16 md:grid-cols-2">
					{/* Contact Info */}
					<div className="space-y-12">
						<div className="space-y-8">
							<h2 className="text-2xl font-bold">{t("contact.details")}</h2>

							<div className="flex items-start gap-6">
								<div className="bg-muted border-border flex size-12 shrink-0 items-center justify-center border">
									<Icon
										icon="ph:map-pin-fill"
										className="text-highlight size-6"
									/>
								</div>
								<div>
									<h3 className="mb-1 text-lg font-bold">
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

							<div className="flex items-start gap-6">
								<div className="bg-muted border-border flex size-12 shrink-0 items-center justify-center border">
									<Icon
										icon="ph:phone-fill"
										className="text-highlight size-6"
									/>
								</div>
								<div>
									<h3 className="mb-1 text-lg font-bold">
										{t("contact.phone")}
									</h3>
									<p className="text-muted-foreground hover:text-highlight text-lg transition-colors">
										<a href={`tel:${settings.contactPhone}`}>
											{settings.contactPhone || "+421 900 000 000"}
										</a>
									</p>
								</div>
							</div>

							<div className="flex items-start gap-6">
								<div className="bg-muted border-border flex size-12 shrink-0 items-center justify-center border">
									<Icon
										icon="ph:envelope-fill"
										className="text-highlight size-6"
									/>
								</div>
								<div>
									<h3 className="mb-1 text-lg font-bold">
										{t("contact.email")}
									</h3>
									<p className="text-muted-foreground hover:text-highlight text-lg transition-colors">
										<a href={`mailto:${settings.contactEmail}`}>
											{settings.contactEmail}
										</a>
									</p>
								</div>
							</div>
						</div>

						{/* Map */}
						{settings.mapEmbedUrl ? (
							<div className="bg-muted border-border relative aspect-video overflow-hidden border">
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
							<div className="bg-muted border-border group relative aspect-video overflow-hidden border">
								<div className="absolute inset-0 flex items-center justify-center">
									<p className="text-muted-foreground font-medium">
										{t("contact.mapPlaceholder")}
									</p>
								</div>
								<div className="bg-highlight/5 absolute inset-0 transition-colors duration-500 group-hover:bg-transparent" />
							</div>
						)}
					</div>

					{/* Business Hours */}
					<div className="bg-muted/30 border-border border p-10">
						<h2 className="mb-8 text-center text-2xl font-bold md:text-left">
							{t("contact.hours")}
						</h2>
						<div className="space-y-6">
							{days.map((day) => {
								const hours =
									businessHours[day.id as keyof typeof businessHours];
								return (
									<div
										key={day.id}
										className="border-border/50 flex items-center justify-between border-b pb-4"
									>
										<span className="text-lg font-medium">
											{t(day.labelKey)}
										</span>
										{hours.isOpen ? (
											<span className="text-muted-foreground font-medium">
												{hours.start} — {hours.end}
											</span>
										) : (
											<span className="text-highlight text-sm font-bold tracking-wider uppercase">
												{t("contact.closed")}
											</span>
										)}
									</div>
								);
							})}
						</div>

						<div className="mt-12 text-center">
							<p className="text-muted-foreground mb-6 text-sm italic">
								{t("contact.holidayNote")}
							</p>
							<a
								href="/booking"
								className="bg-foreground text-background hover:bg-highlight hover:text-highlight-foreground inline-block w-full py-4 text-lg font-bold transition-all duration-300"
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
