/**
 * CTA Block Renderer
 */

import type { BlockProps } from "../.generated/client";

export function CTARenderer({ values }: BlockProps<"cta">) {
	const variantMap: Record<string, { section: string; button: string }> = {
		highlight: {
			section: "bg-primary text-primary-foreground",
			button: "bg-white text-primary hover:bg-gray-100",
		},
		dark: {
			section: "bg-gray-900 text-white",
			button: "bg-primary text-primary-foreground hover:bg-primary/90",
		},
		light: {
			section: "bg-gray-100 text-gray-900",
			button: "bg-primary text-primary-foreground hover:bg-primary/90",
		},
	};

	const variantStyles =
		variantMap[values.variant || "highlight"] || variantMap.highlight;

	return (
		<section className={`px-6 py-20 ${variantStyles.section}`}>
			<div className="container mx-auto max-w-3xl text-center">
				<h2 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">
					{values.title}
				</h2>

				{values.description && (
					<p className="mx-auto mb-10 max-w-2xl text-lg opacity-90">
						{values.description}
					</p>
				)}

				{values.buttonText && (
					<a
						href={values.buttonLink || "#"}
						className={`inline-flex items-center gap-2 rounded-md px-8 py-3 font-semibold transition-colors ${variantStyles.button}`}
					>
						{values.buttonText}
					</a>
				)}
			</div>
		</section>
	);
}
