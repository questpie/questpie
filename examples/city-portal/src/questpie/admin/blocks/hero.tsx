/**
 * Hero Block Renderer
 */

import type { BlockProps } from "../.generated/client";

export function HeroRenderer({ values, data, children }: BlockProps<"hero">) {
	const bgImageUrl =
		(data?.backgroundImage as any)?.url || values.backgroundImage;

	const heightClasses: Record<string, string> = {
		small: "min-h-[40vh]",
		medium: "min-h-[60vh]",
		large: "min-h-[80vh]",
		full: "min-h-screen",
	};

	const alignClasses: Record<string, string> = {
		left: "text-left items-start",
		center: "text-center items-center",
		right: "text-right items-end",
	};

	const heightClass = heightClasses[values.height || "medium"];
	const alignClass = alignClasses[values.alignment || "center"];

	return (
		<section
			className={`relative flex items-center bg-cover bg-center ${heightClass}`}
			style={{
				backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : undefined,
				backgroundColor: bgImageUrl ? undefined : "var(--primary, #1e40af)",
			}}
		>
			<div
				className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/60"
				style={{ opacity: (values.overlayOpacity ?? 60) / 100 }}
			/>

			<div
				className={`relative z-10 container mx-auto flex flex-col gap-6 px-6 py-20 ${alignClass}`}
			>
				<h1 className="max-w-4xl text-4xl leading-[1.1] font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
					{values.title}
				</h1>

				{values.subtitle && (
					<p className="max-w-2xl text-lg text-white/85 sm:text-xl md:text-2xl">
						{values.subtitle}
					</p>
				)}

				{values.ctaText && (
					<a
						href={values.ctaLink || "#"}
						className="mt-4 inline-flex items-center gap-2 rounded-md bg-white px-8 py-3 font-semibold text-gray-900 transition-colors hover:bg-gray-100"
					>
						{values.ctaText}
						<svg
							className="h-5 w-5"
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
								className="flex-1 rounded-l-md px-4 py-3 text-gray-900 focus:outline-none"
							/>
							<button
								type="button"
								className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-r-md px-6 py-3 font-medium"
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
