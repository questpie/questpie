"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

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
				"qa-tabs group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
				className,
			)}
			{...props}
		/>
	);
}

const tabsListVariants = cva(
	"qa-tabs__list group/tabs-list text-muted-foreground bg-surface-low border-border-subtle inline-flex w-fit items-center justify-center gap-1 rounded-md border p-1 group-data-horizontal/tabs:min-h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
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
				"qa-tabs__trigger font-chrome text-muted-foreground hover:text-foreground data-active:bg-surface-high data-active:text-foreground focus-visible:ring-ring/20 relative inline-flex min-h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-transparent px-3 py-1 text-xs font-medium whitespace-nowrap tabular-nums transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)] group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start group-data-[variant=line]/tabs-list:rounded-none group-data-[orientation=vertical]/tabs:after:inset-y-1.5 group-data-[orientation=vertical]/tabs:after:right-auto group-data-[orientation=vertical]/tabs:after:left-0 group-data-[orientation=vertical]/tabs:after:h-auto group-data-[orientation=vertical]/tabs:after:w-px group-data-[orientation=vertical]/tabs:after:scale-y-50 group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-2 group-data-[variant=line]/tabs-list:after:-bottom-px group-data-[variant=line]/tabs-list:after:h-px group-data-[variant=line]/tabs-list:after:scale-x-50 group-data-[variant=line]/tabs-list:after:rounded-full group-data-[variant=line]/tabs-list:after:bg-current group-data-[variant=line]/tabs-list:after:opacity-0 group-data-[variant=line]/tabs-list:after:transition-[opacity,scale] group-data-[variant=line]/tabs-list:after:duration-[var(--motion-duration-base)] focus-visible:ring-[3px] focus-visible:outline-none active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[orientation=vertical]/tabs:data-active:after:scale-y-100 group-data-[variant=line]/tabs-list:data-active:after:scale-x-100 group-data-[variant=line]/tabs-list:data-active:after:opacity-60 motion-reduce:transition-none motion-reduce:after:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
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
				"qa-tabs__content flex-1 text-xs/relaxed transition-opacity duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)] outline-none motion-reduce:transition-none",
				className,
			)}
			{...props}
		/>
	);
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
