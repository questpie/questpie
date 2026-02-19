/**
 * Hero Block Renderer
 *
 * Full-width banner with background image, title, subtitle, and CTA.
 * Designed for city council landing pages.
 */

import type { BlockComponentProps } from "@questpie/admin/client";
import type { App } from "@/questpie/server/app";

export function HeroRenderer({
	values,
	data,
	children,
}: BlockComponentProps<App, "hero">) {
	const bgImageUrl = data?.backgroundImage?.url || values.backgroundImage;

	const heightClass = {
		small: "min-h-[40vh]",
		medium: "min-h-[60vh]",
		large: "min-h-[80vh]",
		full: "min-h-screen",
	}[values.height || "medium"];

	const alignClass = {
		left: "text-left items-start",
		center: "text-center items-center",
		right: "text-right items-end",
	}[values.alignment || "center"];

	return (
		<section
			className={`relative flex items-center bg-cover bg-center ${heightClass}`}
			style={{
				backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : undefined,
				backgroundColor: bgImageUrl ? undefined : "var(--primary, #1e40af)",
			}}
		>
			{/* Overlay */}
			<div
				className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/60"
				style={{ opacity: (values.overlayOpacity ?? 60) / 100 }}
			/>

			{/* Content */}
			<div
				className={`relative z-10 container mx-auto px-6 py-20 flex flex-col gap-6 ${alignClass}`}
			>
				<h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight leading-[1.1] max-w-4xl">
					{values.title}
				</h1>

				{values.subtitle && (
					<p className="text-lg sm:text-xl md:text-2xl text-white/85 max-w-2xl">
						{values.subtitle}
					</p>
				)}

				{values.ctaText && (
					<a
						href={values.ctaLink || "#"}
						className="mt-4 inline-flex items-center gap-2 bg-white text-gray-900 px-8 py-3 rounded-md font-semibold hover:bg-gray-100 transition-colors"
					>
						{values.ctaText}
						<svg
							className="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 5l7 7-7 7"
							/>
						</svg>
					</a>
				)}

				{values.showSearch && (
					<div className="mt-6 w-full max-w-xl">
						<div className="flex">
							<input
								type="search"
								placeholder="Search for services, news, or information..."
								className="flex-1 px-4 py-3 rounded-l-md text-gray-900 focus:outline-none"
							/>
							<button
								type="button"
								className="px-6 py-3 bg-primary text-primary-foreground rounded-r-md hover:bg-primary/90 font-medium"
							>
								Search
							</button>
						</div>
					</div>
				)}

				{children}
			</div>
		</section>
	);
}
