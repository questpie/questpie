/**
 * Barber Profile Route
 *
 * Displays individual barber bio, specialties, and their specific services.
 */

import { Icon } from "@iconify/react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

import { getBarber } from "@/lib/getBarbers.function";
import {
	PreviewField,
	PreviewProvider,
	RichTextRenderer,
	type TipTapDoc,
	useCollectionPreview,
} from "@questpie/admin/client";

export const Route = createFileRoute("/_app/barbers/$slug")({
	loader: async (ctx) => {
		return await getBarber({
			data: { slug: ctx.params.slug },
		});
	},
	component: BarberProfilePage,
});

function BarberProfilePage() {
	const loaderData = Route.useLoaderData();
	const barber = loaderData?.barber;
	const router = useRouter();

	const { data, isPreviewMode, focusedField, handleFieldClick } =
		useCollectionPreview({
			initialData: barber,
			onRefresh: () => router.invalidate(),
		});

	const previewBarber = data as typeof barber;

	const formatPrice = (cents: number) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
		}).format(cents / 100);
	};

	return (
		<PreviewProvider
			isPreviewMode={isPreviewMode}
			focusedField={focusedField}
			onFieldClick={handleFieldClick}
		>
			<div className={isPreviewMode ? "preview-mode px-6 py-20" : "px-6 py-20"}>
				<div className="container mx-auto max-w-5xl">
					{/* Back Link */}
					<Link
						to="/barbers"
						className="text-muted-foreground hover:text-foreground group mb-12 inline-flex items-center gap-2 transition-colors"
					>
						<Icon
							icon="ph:arrow-left"
							className="size-4 transition-transform group-hover:-translate-x-1"
						/>
						Back to Team
					</Link>

					<div className="grid grid-cols-1 gap-16 lg:grid-cols-12">
						{/* Left: Avatar & Info */}
						<div className="space-y-8 lg:col-span-5">
							<PreviewField
								field="avatar"
								className="bg-muted border-border sticky top-24 aspect-[3/4] overflow-hidden border"
							>
								{previewBarber.avatar ? (
									<img
										src={previewBarber.avatar as string}
										alt={previewBarber.name as string}
										className="h-full w-full object-cover"
									/>
								) : (
									<div className="flex h-full w-full items-center justify-center">
										<Icon
											icon="ph:user"
											className="text-muted-foreground/20 size-40"
										/>
									</div>
								)}
							</PreviewField>
						</div>

						{/* Right: Bio & Services */}
						<div className="space-y-12 lg:col-span-7">
							<section>
								<PreviewField
									field="name"
									as="h1"
									className="mb-4 text-4xl font-bold tracking-tight md:text-5xl"
								>
									{previewBarber.name}
								</PreviewField>

								{previewBarber.specialties &&
									(previewBarber.specialties as string[]).length > 0 && (
										<PreviewField
											field="specialties"
											className="mb-8 flex flex-wrap gap-2"
										>
											{(previewBarber.specialties as string[]).map((s) => (
												<span
													key={s}
													className="bg-highlight/10 text-highlight px-3 py-1 text-sm font-bold tracking-wider uppercase"
												>
													{s}
												</span>
											))}
										</PreviewField>
									)}

								<PreviewField
									field="bio"
									className="prose prose-stone prose-lg dark:prose-invert max-w-none"
								>
									<RichTextRenderer
										content={previewBarber.bio as TipTapDoc}
										styles={{
											paragraph:
												"text-muted-foreground leading-relaxed mb-4 last:mb-0",
										}}
									/>
									{!previewBarber.bio && (
										<p className="text-muted-foreground leading-relaxed">
											No biography available.
										</p>
									)}
								</PreviewField>
							</section>

							{/* Contact Info */}
							<section className="bg-muted/30 border-border grid grid-cols-1 gap-6 border p-8 sm:grid-cols-2">
								<PreviewField field="email" className="space-y-1">
									<span className="text-muted-foreground text-xs font-bold tracking-widest uppercase">
										Email
									</span>
									<a
										href={`mailto:${previewBarber.email}`}
										className="hover:text-highlight flex items-center gap-2 font-medium transition-colors"
									>
										<Icon icon="ph:envelope-simple" className="size-5" />
										{previewBarber.email}
									</a>
								</PreviewField>
								<PreviewField field="phone" className="space-y-1">
									<span className="text-muted-foreground text-xs font-bold tracking-widest uppercase">
										Phone
									</span>
									<a
										href={`tel:${previewBarber.phone}`}
										className="hover:text-highlight flex items-center gap-2 font-medium transition-colors"
									>
										<Icon icon="ph:phone" className="size-5" />
										{previewBarber.phone}
									</a>
								</PreviewField>
							</section>

							{/* Personal Services */}
							{previewBarber.services && previewBarber.services.length > 0 && (
								<PreviewField
									field="services"
									fieldType="relation"
									as="section"
									className="space-y-8"
								>
									<h2 className="text-3xl font-bold tracking-tight">
										Services by {String(previewBarber.name).split(" ")[0]}
									</h2>
									<div className="space-y-4">
										{previewBarber.services.map((service: any) => (
											<div
												key={service.id}
												className="border-border bg-card hover:border-highlight/30 group flex flex-col justify-between border p-6 transition-all sm:flex-row sm:items-center"
											>
												<div className="mb-4 sm:mb-0">
													<h3 className="group-hover:text-highlight text-xl font-bold transition-colors">
														{service.name}
													</h3>
													<div className="text-muted-foreground mt-1 flex items-center gap-4 text-sm">
														<span className="flex items-center gap-1.5">
															<Icon icon="ph:clock" className="size-4" />
															{service.duration} min
														</span>
														<span className="text-highlight font-bold">
															{formatPrice(service.price)}
														</span>
													</div>
												</div>

												<Link
													to="/booking"
													search={{
														barber: previewBarber.id,
														service: service.id,
													}}
													className="bg-foreground text-background hover:bg-highlight hover:text-highlight-foreground px-6 py-3 text-center text-sm font-bold tracking-widest uppercase transition-all"
												>
													Book This
												</Link>
											</div>
										))}
									</div>
								</PreviewField>
							)}

							{isPreviewMode && (
								<div className="bg-highlight text-highlight-foreground fixed right-4 bottom-4 z-50 rounded-full px-4 py-2 text-sm font-medium shadow-lg">
									Preview Mode - Click fields to edit
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</PreviewProvider>
	);
}
