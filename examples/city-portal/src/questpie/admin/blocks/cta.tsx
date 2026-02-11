/**
 * CTA Block Renderer
 *
 * Call to action section for city council pages.
 */

import type { BlockComponentProps } from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

export function CTARenderer({ values }: BlockComponentProps<AppCMS, "cta">) {
	const variantStyles = {
		highlight: {
			section: "bg-blue-700 text-white",
			button: "bg-white text-blue-700 hover:bg-gray-100",
		},
		dark: {
			section: "bg-gray-900 text-white",
			button: "bg-blue-600 text-white hover:bg-blue-700",
		},
		light: {
			section: "bg-gray-100 text-gray-900",
			button: "bg-blue-700 text-white hover:bg-blue-800",
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
