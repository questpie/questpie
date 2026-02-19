/**
 * CTA Block Renderer
 *
 * Call to action section for city council pages.
 */

import type { BlockComponentProps } from "@questpie/admin/client";
import type { App } from "@/questpie/server/app";

export function CTARenderer({ values }: BlockComponentProps<App, "cta">) {
	const variantStyles = {
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
	}[values.variant || "highlight"];

	return (
		<section className={`px-6 py-20 ${variantStyles.section}`}>
			<div className="container max-w-3xl mx-auto text-center">
				<h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-6">
					{values.title}
				</h2>

				{values.description && (
					<p className="text-lg opacity-90 mb-10 max-w-2xl mx-auto">
						{values.description}
					</p>
				)}

				{values.buttonText && (
					<a
						href={values.buttonLink || "#"}
						className={`inline-flex items-center gap-2 px-8 py-3 rounded-md font-semibold transition-colors ${variantStyles.button}`}
					>
						{values.buttonText}
					</a>
				)}
			</div>
		</section>
	);
}
