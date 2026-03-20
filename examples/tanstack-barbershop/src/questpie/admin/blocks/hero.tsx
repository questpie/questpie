/**
 * Hero Block
 *
 * Full-width banner with background image, title, subtitle, and CTA.
 * Design: Modern minimalist with smooth animations.
 *
 * The `backgroundImage` upload field is expanded via `.prefetch({ with: ['backgroundImage'] })`.
 */

import { Icon } from "@iconify/react";

import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

export function HeroRenderer({ values, data, children }: BlockProps<"hero">) {
	const bgImageUrl = data?.backgroundImage?.url as string | undefined;

	const heightClass = {
		small: "min-h-[50vh]",
		medium: "min-h-[70vh]",
		large: "min-h-[85vh]",
		full: "min-h-screen",
	}[values.height || "medium"];

	const alignClass = {
		left: "text-left items-start",
		center: "text-center items-center",
		right: "text-right items-end",
	}[values.alignment || "center"];

	return (
		<section
			className={cn(
				"relative flex items-center bg-cover bg-center",
				heightClass,
			)}
			style={{ backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : undefined }}
		>
			{/* Gradient overlay */}
			<div
				className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70"
				style={{ opacity: (values.overlayOpacity ?? 60) / 100 }}
			/>

			{/* Content */}
			<div
				className={cn(
					"relative z-10 container flex flex-col gap-6 px-6 py-20",
					alignClass,
				)}
			>
				<h1 className="animate-fade-in-up max-w-4xl text-4xl leading-[1.1] font-bold tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
					{values.title}
				</h1>

				{values.subtitle && (
					<p className="animate-fade-in-up max-w-2xl text-lg text-white/85 [animation-delay:100ms] sm:text-xl md:text-2xl">
						{values.subtitle}
					</p>
				)}

				{values.ctaText && (
					<a
						href={values.ctaLink || "/booking"}
						className={cn(
							buttonVariants({ size: "lg" }),
							"animate-fade-in-up mt-4 [animation-delay:200ms]",
							"group bg-highlight text-highlight-foreground hover:bg-highlight/90 gap-3",
							"text-base font-semibold",
						)}
					>
						{values.ctaText}
						<Icon
							icon="ph:arrow-right-bold"
							className="size-5 transition-transform group-hover:translate-x-1"
						/>
					</a>
				)}

				{children}
			</div>
		</section>
	);
}
