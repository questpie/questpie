/**
 * CTA Block
 *
 * Call to action section with title, description, and button.
 * Design: Bold background colors with contrasting text.
 */

import { Icon } from "@iconify/react";

import { PreviewField } from "@questpie/admin/client";

import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

export function CTARenderer({ values }: BlockProps<"cta">) {
	const variantStyles = {
		highlight: {
			section: "bg-highlight text-highlight-foreground",
			button: "bg-foreground text-background hover:bg-foreground/90",
		},
		dark: {
			section: "bg-foreground text-background",
			button: "bg-highlight text-highlight-foreground hover:bg-highlight/90",
		},
		light: {
			section: "bg-muted text-foreground",
			button: "bg-foreground text-background hover:bg-foreground/90",
		},
	}[values.variant || "highlight"]!;

	const sizeStyles = {
		small: "py-12",
		medium: "py-20",
		large: "py-28",
	}[values.size || "medium"];

	return (
		<section className={cn("px-6", sizeStyles, variantStyles.section)}>
			<div className="container mx-auto max-w-3xl text-center">
				<PreviewField
					field="title"
					editable="text"
					as="h2"
					className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl"
				>
					{values.title}
				</PreviewField>

				{values.description && (
					<PreviewField
						field="description"
						editable="textarea"
						as="p"
						className="mx-auto mb-10 max-w-2xl text-lg opacity-90"
					>
						{values.description}
					</PreviewField>
				)}

				{values.buttonText && (
					<a
						href={values.buttonLink || "/booking"}
						className={cn(
							buttonVariants({ size: "lg" }),
							"group gap-3 text-base font-semibold",
							variantStyles.button,
						)}
					>
						<PreviewField field="buttonText" editable="text" as="span">
							{values.buttonText}
						</PreviewField>
						<Icon
							icon="ph:arrow-right-bold"
							className="size-5 transition-transform group-hover:translate-x-1"
						/>
					</a>
				)}
			</div>
		</section>
	);
}
