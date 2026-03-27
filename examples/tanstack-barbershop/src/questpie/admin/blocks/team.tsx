/**
 * Team Block (Barbers)
 *
 * Grid of team members with photos.
 * Supports both automatic fetch and manual selection modes.
 */

import { Icon } from "@iconify/react";

import { RichTextRenderer, type TipTapDoc } from "@questpie/admin/client";

import { useTranslation } from "../../../lib/providers/locale-provider";
import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

type Barber = {
	id: string;
	name: string;
	slug: string;
	bio: TipTapDoc | null;
	avatar: { id: string; url: string; filename: string } | null;
	specialties: string[] | null;
};

export function TeamRenderer({ values, data }: BlockProps<"team">) {
	const { t } = useTranslation();
	const barbers = (data?.barbers ?? []) as unknown as Barber[];
	const showBio = values.showBio ?? false;

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

				{/* Team Grid */}
				<div className={cn("grid grid-cols-1 gap-8", columnsClass)}>
					{barbers.map((barber, i) => (
						<a
							key={barber.id}
							href={`/barbers/${barber.slug}`}
							className="group animate-fade-in-up block"
							style={{ animationDelay: `${i * 100}ms` }}
						>
							{/* Photo */}
							<div
								className={cn(
									"bg-muted relative mb-4 overflow-hidden",
									showBio ? "aspect-square rounded-lg" : "aspect-[3/4]",
								)}
							>
								{barber.avatar?.url ? (
									<img
										src={barber.avatar.url}
										alt={barber.name}
										className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
									/>
								) : (
									<div className="bg-muted flex h-full w-full items-center justify-center">
										<Icon
											icon="ph:user"
											className="text-muted-foreground/30 size-24"
										/>
									</div>
								)}

								{/* Overlay on hover */}
								<div className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/20" />
							</div>

							{/* Info */}
							<div className="space-y-2">
								<h3 className="group-hover:text-highlight text-xl font-semibold transition-colors">
									{barber.name}
								</h3>

								{/* Bio (when showBio is enabled) */}
								{showBio && barber.bio && (
									<div className="line-clamp-2">
										<RichTextRenderer
											content={barber.bio}
											styles={{
												doc: "",
												paragraph: "text-muted-foreground text-sm",
											}}
										/>
									</div>
								)}

								{/* Specialties */}
								{barber.specialties && barber.specialties.length > 0 && (
									<div className="flex flex-wrap gap-2">
										{barber.specialties.slice(0, 3).map((specialty, idx) => (
											<span
												key={idx}
												className={cn(
													"text-sm",
													showBio
														? "bg-muted rounded-full px-3 py-1"
														: "text-muted-foreground",
												)}
											>
												{showBio
													? specialty
													: (idx > 0 ? " · " : "") + specialty}
											</span>
										))}
									</div>
								)}
							</div>
						</a>
					))}
				</div>

				{barbers.length === 0 && (
					<p className="text-muted-foreground py-12 text-center">
						{t("blocks.team.empty")}
					</p>
				)}

				{/* View All Link */}
				{barbers.length > 0 && (
					<div className="mt-12 text-center">
						<a
							href="/barbers"
							className="text-foreground hover:text-highlight group inline-flex items-center gap-2 text-sm font-medium transition-colors"
						>
							{t("blocks.team.viewAll")}
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
