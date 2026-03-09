/**
 * Services Block
 *
 * Grid of services with pricing and duration.
 * Supports both automatic fetch and manual selection modes.
 */

import { ArrowRight, Clock } from "@phosphor-icons/react";
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
					{services.map((service, i) => {
						const imageUrl =
							typeof service.image === "object"
								? service.image?.url
								: service.image;
						return (
							<article
								key={service.id}
								className="group p-6 border border-border bg-card rounded-lg hover:border-foreground/20 hover:shadow-lg transition-all duration-300 animate-fade-in-up"
								style={{ animationDelay: `${i * 50}ms` }}
							>
								{imageUrl && (
									<div className="mb-4 aspect-[4/3] overflow-hidden border border-border bg-muted rounded-md">
										<img
											src={imageUrl}
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
												<Clock className="size-4" weight="bold" />
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
						);
					})}
				</div>

				{services.length === 0 && (
					<p className="text-center text-muted-foreground py-12">
						{t("blocks.services.empty")}
					</p>
				)}

				{/* View All Link */}
				{services.length > 0 && (
					<div className="text-center mt-12">
						<a
							href="/services"
							className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-highlight transition-colors group"
						>
							{t("blocks.services.viewAll")}
							<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
						</a>
					</div>
				)}
			</div>
		</section>
	);
}
