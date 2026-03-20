/**
 * Reviews Block
 *
 * Customer testimonials with ratings.
 * Supports filter and configurable columns.
 */

import { Icon } from "@iconify/react";

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
		<section className="bg-muted/30 px-6 py-20">
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

				{/* Reviews Grid */}
				<div className={cn("grid grid-cols-1 gap-6", columnsClass)}>
					{reviews.map((review, i) => (
						<article
							key={review.id}
							className="bg-card border-border animate-fade-in-up rounded-lg border p-8 transition-all hover:shadow-lg"
							style={{ animationDelay: `${i * 100}ms` }}
						>
							{/* Quote Icon */}
							<Icon
								icon="ph:quotes-fill"
								className="text-highlight/20 mb-4 size-10"
							/>

							{/* Rating */}
							<div className="mb-4 flex items-center gap-0.5">
								{[1, 2, 3, 4, 5].map((star) => (
									<Icon
										icon={star <= review.rating ? "ph:star-fill" : "ph:star"}
										key={star}
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
								<p className="text-foreground mb-6 line-clamp-4 leading-relaxed">
									"{review.comment}"
								</p>
							)}

							{/* Footer */}
							<div className="border-border border-t pt-4">
								<span className="text-sm font-medium">
									{review.customerName || t("blocks.reviews.anonymous")}
								</span>
							</div>
						</article>
					))}
				</div>

				{reviews.length === 0 && (
					<p className="text-muted-foreground py-12 text-center">
						{t("blocks.reviews.empty")}
					</p>
				)}
			</div>
		</section>
	);
}
