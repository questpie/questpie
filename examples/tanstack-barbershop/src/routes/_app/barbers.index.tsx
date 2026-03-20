/**
 * Barbers Index Page
 *
 * Displays all active barbers with their specialties and bio snippets.
 */

import { Icon } from "@iconify/react";
import { createFileRoute } from "@tanstack/react-router";

import { getAllBarbers } from "@/lib/getBarbers.function";
import { useTranslation } from "@/lib/providers/locale-provider";
import { RichTextRenderer, type TipTapDoc } from "@questpie/admin/client";

export const Route = createFileRoute("/_app/barbers/")({
	loader: async () => {
		const result = await getAllBarbers({ data: undefined });
		return { barbers: result.barbers };
	},
	component: BarbersPage,
});

function BarbersPage() {
	const { barbers } = Route.useLoaderData();
	const { t } = useTranslation();

	return (
		<div className="px-6 py-20">
			<div className="container mx-auto max-w-6xl">
				<header className="mx-auto mb-16 max-w-2xl text-center">
					<h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
						{t("barbers.title")}
					</h1>
					<p className="text-muted-foreground text-xl">
						{t("barbers.subtitle")}
					</p>
				</header>

				<div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-3">
					{barbers.map((barber, i) => (
						<a
							key={barber.id}
							href={`/barbers/${barber.slug}`}
							className="group animate-fade-in-up block"
							style={{ animationDelay: `${i * 100}ms` }}
						>
							<div className="bg-muted border-border relative mb-6 aspect-[3/4] overflow-hidden border">
								{barber.avatar ? (
									<img
										src={barber.avatar as string}
										alt={barber.name as string}
										className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
									/>
								) : (
									<div className="bg-muted flex h-full w-full items-center justify-center">
										<Icon
											icon="ph:user"
											className="text-muted-foreground/20 size-32"
										/>
									</div>
								)}
								<div className="absolute inset-0 bg-black/0 transition-colors duration-500 group-hover:bg-black/20" />

								<div className="absolute right-0 bottom-0 left-0 translate-y-full bg-gradient-to-t from-black/80 to-transparent p-6 transition-transform duration-500 group-hover:translate-y-0">
									<span className="inline-flex items-center gap-2 font-bold text-white">
										{t("barbers.viewProfile")}{" "}
										<Icon icon="ph:arrow-right" className="size-4" />
									</span>
								</div>
							</div>

							<h3 className="group-hover:text-highlight mb-2 text-2xl font-bold transition-colors">
								{barber.name}
							</h3>

							{barber.specialties &&
								(barber.specialties as string[]).length > 0 && (
									<p className="text-highlight mb-3 text-sm font-medium">
										{(barber.specialties as string[]).join(" · ")}
									</p>
								)}

							<div className="line-clamp-2">
								<RichTextRenderer
									content={barber.bio as TipTapDoc}
									styles={{
										doc: "",
										paragraph: "text-muted-foreground leading-relaxed",
									}}
								/>
							</div>
						</a>
					))}
				</div>

				{barbers.length === 0 && (
					<div className="bg-muted/30 border-border border border-dashed py-20 text-center">
						<p className="text-muted-foreground text-xl">
							{t("barbers.empty")}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
