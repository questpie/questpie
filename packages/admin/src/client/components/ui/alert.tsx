import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "#questpie/admin/client/lib/utils";

const alertVariants = cva(
	"qa-alert group/alert border-border-subtle bg-card text-card-foreground *:[svg]:text-muted-foreground relative grid w-full gap-0.5 border px-2 py-1.5 text-left text-xs/relaxed has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-1.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			variant: {
				default: "",
				destructive:
					"border-destructive/30 bg-destructive/10 text-destructive *:data-[slot=alert-description]:text-destructive/85 *:[svg]:text-destructive",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Alert({
	className,
	variant,
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
	return (
		<div
			data-slot="alert"
			role="alert"
			className={cn(alertVariants({ variant }), className)}
			{...props}
		/>
	);
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-title"
			className={cn(
				"[&_a]:hover:text-foreground font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDescription({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"qa-alert__description text-muted-foreground [&_a]:hover:text-foreground text-xs/relaxed text-balance md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
				className,
			)}
			{...props}
		/>
	);
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-action"
			className={cn("absolute top-1.5 right-2", className)}
			{...props}
		/>
	);
}

export { Alert, AlertDescription };
