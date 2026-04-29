"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

function Tabs({
	className,
	orientation = "horizontal",
	...props
}: TabsPrimitive.Root.Props) {
	return (
		<TabsPrimitive.Root
			data-slot="tabs"
			data-orientation={orientation}
			className={cn(
				"group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
				className,
			)}
			{...props}
		/>
	);
}

const tabsListVariants = cva(
	"group/tabs-list text-muted-foreground border-border-subtle inline-flex w-fit items-center justify-center gap-1 rounded-[var(--control-radius,0.75rem)] border border-[color:var(--border-subtle,var(--border))] bg-[var(--surface-low,var(--card))] p-1 group-data-[orientation=horizontal]/tabs:min-h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
	{
		variants: {
			variant: {
				default: "",
				line: "border-x-0 border-t-0 bg-transparent p-0",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function TabsList({
	className,
	variant = "default",
	...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			data-variant={variant}
			className={cn(tabsListVariants({ variant }), className)}
			{...props}
		/>
	);
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-trigger"
			className={cn(
				"text-muted-foreground hover:text-foreground data-active:text-foreground focus-visible:ring-foreground/15 relative inline-flex min-h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--control-radius-inner,0.5rem)] border border-transparent px-3 py-1 text-xs font-[var(--font-chrome,var(--font-sans))] font-medium whitespace-nowrap tabular-nums transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start group-data-[orientation=vertical]/tabs:after:inset-y-1.5 group-data-[orientation=vertical]/tabs:after:right-auto group-data-[orientation=vertical]/tabs:after:left-0 group-data-[orientation=vertical]/tabs:after:h-auto group-data-[orientation=vertical]/tabs:after:w-px group-data-[orientation=vertical]/tabs:after:scale-y-50 group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-2 group-data-[variant=line]/tabs-list:after:-bottom-px group-data-[variant=line]/tabs-list:after:h-px group-data-[variant=line]/tabs-list:after:scale-x-50 group-data-[variant=line]/tabs-list:after:rounded-full group-data-[variant=line]/tabs-list:after:bg-current group-data-[variant=line]/tabs-list:after:opacity-0 group-data-[variant=line]/tabs-list:after:transition-[opacity,scale] group-data-[variant=line]/tabs-list:after:duration-150 focus-visible:ring-[3px] focus-visible:outline-none active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 data-active:bg-[var(--surface-high,var(--muted))] group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[orientation=vertical]/tabs:data-active:after:scale-y-100 group-data-[variant=line]/tabs-list:data-active:after:scale-x-100 group-data-[variant=line]/tabs-list:data-active:after:opacity-60 motion-reduce:transition-none motion-reduce:after:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
				className,
			)}
			{...props}
		/>
	);
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
	return (
		<TabsPrimitive.Panel
			data-slot="tabs-content"
			className={cn(
				"flex-1 text-xs/relaxed transition-opacity duration-100 ease-out outline-none motion-reduce:transition-none",
				className,
			)}
			{...props}
		/>
	);
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
