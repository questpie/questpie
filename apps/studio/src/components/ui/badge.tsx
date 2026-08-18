import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"focus-visible:border-border focus-visible:ring-foreground/15 aria-invalid:border-border group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-xs border border-transparent px-2 py-0.5 text-[0.625rem] font-[var(--font-chrome,var(--font-sans))] font-medium whitespace-nowrap tabular-nums transition-[background-color,border-color,color,box-shadow] duration-150 ease-out focus-visible:ring-[3px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-2.5!",
	{
		variants: {
			variant: {
				default:
					"border-border bg-secondary text-secondary-foreground [a]:hover:bg-accent",
				secondary:
					"bg-secondary text-secondary-foreground [a]:hover:bg-secondary",
				destructive:
					"bg-destructive text-destructive-foreground [a]:hover:bg-destructive/90 border-transparent",
				outline:
					"border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground bg-transparent",
				ghost: "hover:bg-muted hover:text-muted-foreground",
				link: "text-foreground underline-offset-4 hover:underline",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant = "default",
	render,
	...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return useRender({
		defaultTagName: "span",
		props: mergeProps<"span">(
			{
				className: cn(badgeVariants({ className, variant })),
			},
			props,
		),
		render,
		state: {
			slot: "badge",
			variant,
		},
	});
}

export { Badge, badgeVariants };
