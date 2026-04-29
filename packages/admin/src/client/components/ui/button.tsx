"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
	"qa-button font-chrome group/button text-foreground focus-visible:border-border-strong focus-visible:ring-ring/20 aria-invalid:border-border-strong aria-invalid:ring-ring/20 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[var(--control-radius)] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-150 ease-out outline-none select-none focus-visible:ring-[3px] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 aria-invalid:ring-[3px] motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground shadow-[var(--control-shadow)] hover:opacity-95",
				outline:
					"border-input bg-card text-foreground hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground shadow-[var(--control-shadow)]",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent aria-expanded:text-secondary-foreground",
				ghost:
					"text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/25 border-transparent shadow-[var(--control-shadow)]",
				link: "text-foreground h-auto px-0 underline-offset-4 hover:underline",
			},
			size: {
				default:
					"h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-4",
				xs: "h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
				sm: "h-8 gap-1.5 px-3 text-xs has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-11 gap-2 px-4 text-base has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5 [&_svg:not([class*='size-'])]:size-4",
				icon: "size-9 [&_svg:not([class*='size-'])]:size-4",
				"icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
				"icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
				"icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-5",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

type ButtonProps = ButtonPrimitive.Props &
	VariantProps<typeof buttonVariants> & {
		static?: boolean;
	};

function Button({
	className,
	type = "button",
	variant = "default",
	size = "default",
	static: staticPress = false,
	...props
}: ButtonProps) {
	return (
		<ButtonPrimitive
			data-slot="button"
			type={type}
			className={cn(
				buttonVariants({ variant, size }),
				staticPress && "active:scale-100",
				className,
			)}
			{...props}
		/>
	);
}

export { Button };
