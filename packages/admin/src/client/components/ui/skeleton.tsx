import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const skeletonVariants = cva("qa-skeleton bg-muted animate-pulse", {
	variants: {
		variant: {
			default: "rounded-sm",
			text: "rounded-xs",
			chip: "rounded-sm",
			avatar: "rounded-md",
		},
	},
	defaultVariants: {
		variant: "default",
	},
});

function Skeleton({
	className,
	variant,
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof skeletonVariants>) {
	return (
		<div
			data-slot="skeleton"
			data-variant={variant}
			className={cn(skeletonVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Skeleton };
