/**
 * Reviews Block
 *
 * Customer testimonials with ratings.
 * Supports filter and configurable columns.
 */

import { Quotes, Star } from "@phosphor-icons/react";
import { useTranslation } from "../../../lib/providers/locale-provider";
import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

type Review = {
	id: string;
	rating: number;
	comment: string | null;
	customerName: string | null;
	createdAt: string;
};

export function ReviewsRenderer({ values, data }: BlockProps<"reviews">) {
	const { t } = useTranslation();
	const reviews = (data?.reviews ?? []) as unknown as Review[];

	const columnsClass = {
		"2": "md:grid-cols-2",
		"3": "md:grid-cols-2 lg:grid-cols-3",
		"4": "md:grid-cols-2 lg:grid-cols-4",
	}[values.columns || "3"];

	return (
		<section className="py-20 px-6 bg-muted/30">
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

				{/* Reviews Grid */}
				<div className={cn("grid grid-cols-1 gap-6", columnsClass)}>
					{reviews.map((review, i) => (
						<article
							key={review.id}
							className="bg-card border border-border p-8 rounded-lg hover:shadow-lg transition-all animate-fade-in-up"
							style={{ animationDelay: `${i * 100}ms` }}
						>
							{/* Quote Icon */}
							<Quotes
								className="size-10 text-highlight/20 mb-4"
								weight="fill"
							/>

							{/* Rating */}
							<div className="flex items-center gap-0.5 mb-4">
								{[1, 2, 3, 4, 5].map((star) => (
									<Star
										key={star}
										weight={star <= review.rating ? "fill" : "regular"}
										className={cn(
											"size-5",
											star <= review.rating
												? "text-highlight"
												: "text-muted-foreground/30",
										)}
									/>
								))}
							</div>

							{/* Comment */}
							{review.comment && (
								<p className="text-foreground leading-relaxed mb-6 line-clamp-4">
									"{review.comment}"
								</p>
							)}

							{/* Footer */}
							<div className="pt-4 border-t border-border">
								<span className="font-medium text-sm">
									{review.customerName || t("blocks.reviews.anonymous")}
								</span>
							</div>
						</article>
					))}
				</div>

				{reviews.length === 0 && (
					<p className="text-center text-muted-foreground py-12">
						{t("blocks.reviews.empty")}
					</p>
				)}
			</div>
		</section>
	);
}
