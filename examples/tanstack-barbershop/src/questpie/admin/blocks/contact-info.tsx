/**
 * Contact Info Block
 *
 * Display contact information with optional map embed.
 * Design: Two-column layout with info cards and map.
 */

import { Icon } from "@iconify/react";

import { useTranslation } from "../../../lib/providers/locale-provider";
import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

export function ContactInfoRenderer({
	values,
	data,
}: BlockProps<"contact-info">) {
	const { t } = useTranslation();
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
		<section className="px-6 py-20">
			<div className="container">
				{values.title && (
					<h2 className="mb-12 text-center text-3xl font-bold tracking-tight sm:text-4xl">
						{values.title}
					</h2>
				)}

				<div
					className={cn(
						"grid gap-8",
						values.showMap && data?.mapEmbedUrl
							? "grid-cols-1 lg:grid-cols-2"
							: "mx-auto max-w-2xl",
					)}
				>
					{/* Contact Info Cards */}
					<div className="space-y-6">
						{contactPhone && (
							<div className="bg-card flex items-start gap-4 rounded-lg border p-6">
								<Icon
									icon="ph:phone-bold"
									className="text-highlight mt-1 size-6 flex-shrink-0"
								/>
								<div>
									<h3 className="mb-1 font-semibold">
										{t("blocks.contact.phone")}
									</h3>
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
							<div className="bg-card flex items-start gap-4 rounded-lg border p-6">
								<Icon
									icon="ph:envelope-bold"
									className="text-highlight mt-1 size-6 flex-shrink-0"
								/>
								<div>
									<h3 className="mb-1 font-semibold">
										{t("blocks.contact.email")}
									</h3>
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
							<div className="bg-card flex items-start gap-4 rounded-lg border p-6">
								<Icon
									icon="ph:map-pin-bold"
									className="text-highlight mt-1 size-6 flex-shrink-0"
								/>
								<div>
									<h3 className="mb-1 font-semibold">
										{t("blocks.contact.address")}
									</h3>
									<p className="text-muted-foreground">{fullAddress}</p>
								</div>
							</div>
						)}
					</div>

					{/* Map */}
					{values.showMap && mapEmbedUrl && (
						<div className="bg-muted aspect-square overflow-hidden rounded-lg border lg:aspect-auto">
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
