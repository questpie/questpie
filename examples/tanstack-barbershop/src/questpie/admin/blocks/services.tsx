/**
 * Services Block
 *
 * Grid of services with pricing and duration.
 * Supports both automatic fetch and manual selection modes.
 */

import { Icon } from "@iconify/react";

import { useTranslation } from "../../../lib/providers/locale-provider";
import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

type Service = {
	id: string;
	name: string;
	description: string | null;
	price: number;
	duration: number;
	image?: { url: string } | string | null;
};

export function ServicesRenderer({ values, data }: BlockProps<"services">) {
	const { t, locale } = useTranslation();
	const services = (data?.services ?? []) as unknown as Service[];

	const columnsClass = {
		"2": "md:grid-cols-2",
		"3": "md:grid-cols-2 lg:grid-cols-3",
		"4": "md:grid-cols-2 lg:grid-cols-4",
	}[values.columns || "3"];

	const formatPrice = (cents: number) => {
		return new Intl.NumberFormat(locale === "sk" ? "sk-SK" : "en-US", {
			style: "currency",
			currency: "EUR",
		}).format(cents / 100);
	};

	return (
		<section className="px-6 py-20">
			<div className="container">
				{/* Header */}
				{(values.title || values.subtitle) && (
					<div className="mx-auto mb-16 max-w-2xl text-center">
						{values.title && (
							<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
								{values.title}
							</h2>
						)}
						{values.subtitle && (
							<p className="text-muted-foreground text-lg">{values.subtitle}</p>
						)}
					</div>
				)}

				{/* Services Grid */}
				<div className={cn("grid grid-cols-1 gap-6", columnsClass)}>
					{services.map((service, i) => {
						const imageUrl =
							typeof service.image === "object"
								? service.image?.url
								: service.image;
						return (
							<article
								key={service.id}
								className="group border-border bg-card hover:border-foreground/20 animate-fade-in-up rounded-lg border p-6 transition-all duration-300 hover:shadow-lg"
								style={{ animationDelay: `${i * 50}ms` }}
							>
								{imageUrl && (
									<div className="border-border bg-muted mb-4 aspect-[4/3] overflow-hidden rounded-md border">
										<img
											src={imageUrl}
											alt={service.name}
											className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
										/>
									</div>
								)}
								<h3 className="group-hover:text-highlight mb-2 text-xl font-semibold transition-colors">
									{service.name}
								</h3>

								{service.description && (
									<p className="text-muted-foreground mb-6 line-clamp-2 text-sm">
										{service.description}
									</p>
								)}

								<div className="border-border flex items-center justify-between border-t pt-4">
									<div className="text-muted-foreground flex items-center gap-4 text-sm">
										{values.showDuration && (
											<span className="flex items-center gap-1.5">
												<Icon icon="ph:clock-bold" className="size-4" />
												{service.duration} min
											</span>
										)}
									</div>

									{values.showPrices && (
										<span className="text-highlight font-semibold">
											{formatPrice(service.price)}
										</span>
									)}
								</div>
							</article>
						);
					})}
				</div>

				{services.length === 0 && (
					<p className="text-muted-foreground py-12 text-center">
						{t("blocks.services.empty")}
					</p>
				)}

				{/* View All Link */}
				{services.length > 0 && (
					<div className="mt-12 text-center">
						<a
							href="/services"
							className="text-foreground hover:text-highlight group inline-flex items-center gap-2 text-sm font-medium transition-colors"
						>
							{t("blocks.services.viewAll")}
							<Icon
								icon="ph:arrow-right"
								className="size-4 transition-transform group-hover:translate-x-1"
							/>
						</a>
					</div>
				)}
			</div>
		</section>
	);
}
