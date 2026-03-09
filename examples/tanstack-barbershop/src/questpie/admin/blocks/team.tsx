/**
 * Team Block (Barbers)
 *
 * Grid of team members with photos.
 * Supports both automatic fetch and manual selection modes.
 */

import { ArrowRight, User } from "@phosphor-icons/react";
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

				{/* Team Grid */}
				<div className={cn("grid grid-cols-1 gap-8", columnsClass)}>
					{barbers.map((barber, i) => (
						<a
							key={barber.id}
							href={`/barbers/${barber.slug}`}
							className="group block animate-fade-in-up"
							style={{ animationDelay: `${i * 100}ms` }}
						>
							{/* Photo */}
							<div
								className={cn(
									"bg-muted mb-4 overflow-hidden relative",
									showBio ? "aspect-square rounded-lg" : "aspect-[3/4]",
								)}
							>
								{barber.avatar?.url ? (
									<img
										src={barber.avatar.url}
										alt={barber.name}
										className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
									/>
								) : (
									<div className="w-full h-full flex items-center justify-center bg-muted">
										<User className="size-24 text-muted-foreground/30" />
									</div>
								)}

								{/* Overlay on hover */}
								<div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
							</div>

							{/* Info */}
							<div className="space-y-2">
								<h3 className="text-xl font-semibold group-hover:text-highlight transition-colors">
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
														? "px-3 py-1 bg-muted rounded-full"
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
					<p className="text-center text-muted-foreground py-12">
						{t("blocks.team.empty")}
					</p>
				)}

				{/* View All Link */}
				{barbers.length > 0 && (
					<div className="text-center mt-12">
						<a
							href="/barbers"
							className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-highlight transition-colors group"
						>
							{t("blocks.team.viewAll")}
							<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
						</a>
					</div>
				)}
			</div>
		</section>
	);
}
