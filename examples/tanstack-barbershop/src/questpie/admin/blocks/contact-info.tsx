/**
 * Contact Info Block
 *
 * Display contact information with optional map embed.
 * Design: Two-column layout with info cards and map.
 */

import { Envelope, MapPin, Phone } from "@phosphor-icons/react";
import type {
	BlockDefinition,
	BlockRendererProps,
} from "@questpie/admin/client";
import { client } from "../../../lib/cms-client";
import { cn } from "../../../lib/utils";

type ContactInfoValues = {
	title?: string;
	showMap: boolean;
};

type ContactInfoPrefetchedData = {
	shopName?: string;
	contactEmail?: string;
	contactPhone?: string;
	address?: string;
	city?: string;
	zipCode?: string;
	country?: string;
	mapEmbedUrl?: string;
};

function ContactInfoRenderer({
	values,
	data,
}: BlockRendererProps<ContactInfoValues>) {
	const contactData = (data as ContactInfoPrefetchedData) || {};
	const fullAddress = [
		contactData?.address,
		contactData?.city,
		contactData?.zipCode,
		contactData?.country,
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
						values.showMap && contactData?.mapEmbedUrl
							? "grid-cols-1 lg:grid-cols-2"
							: "max-w-2xl mx-auto",
					)}
				>
					{/* Contact Info Cards */}
					<div className="space-y-6">
						{contactData?.contactPhone && (
							<div className="flex items-start gap-4 p-6 bg-card border rounded-lg">
								<Phone
									className="size-6 text-highlight flex-shrink-0 mt-1"
									weight="bold"
								/>
								<div>
									<h3 className="font-semibold mb-1">Phone</h3>
									<a
										href={`tel:${contactData.contactPhone}`}
										className="text-muted-foreground hover:text-foreground transition-colors"
									>
										{contactData.contactPhone}
									</a>
								</div>
							</div>
						)}

						{contactData?.contactEmail && (
							<div className="flex items-start gap-4 p-6 bg-card border rounded-lg">
								<Envelope
									className="size-6 text-highlight flex-shrink-0 mt-1"
									weight="bold"
								/>
								<div>
									<h3 className="font-semibold mb-1">Email</h3>
									<a
										href={`mailto:${contactData.contactEmail}`}
										className="text-muted-foreground hover:text-foreground transition-colors"
									>
										{contactData.contactEmail}
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
					{values.showMap && contactData?.mapEmbedUrl && (
						<div className="rounded-lg overflow-hidden border bg-muted aspect-square lg:aspect-auto">
							<iframe
								src={contactData.mapEmbedUrl}
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

export const contactInfoBlock = {
	name: "contact-info",
	renderer: ContactInfoRenderer,
	prefetch: async () => {
		const settings = await client.globals.siteSettings.get();
		return {
			shopName: settings?.shopName,
			contactEmail: settings?.contactEmail,
			contactPhone: settings?.contactPhone,
			address: settings?.address,
			city: settings?.city,
			zipCode: settings?.zipCode,
			country: settings?.country,
			mapEmbedUrl: settings?.mapEmbedUrl,
		};
	},
} satisfies BlockDefinition;
