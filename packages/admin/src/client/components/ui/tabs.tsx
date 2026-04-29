"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

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

type TabsListVariant = "pills";

const tabsListBase =
	"qa-tabs__list group/tabs-list text-muted-foreground bg-surface-low border-border-subtle inline-flex w-fit items-center justify-center gap-1 rounded-md border p-1 group-data-horizontal/tabs:min-h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col";

const tabsListVariantStyles: Record<TabsListVariant, string> = {
	pills: "border-transparent bg-muted/70",
};

function TabsList({
	className,
	variant,
	...props
}: TabsPrimitive.List.Props & { variant?: TabsListVariant }) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			data-variant={variant ?? "default"}
			className={cn(
				tabsListBase,
				variant && tabsListVariantStyles[variant],
				className,
			)}
			{...props}
		/>
	);
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-trigger"
			className={cn(
				"qa-tabs__trigger font-chrome text-muted-foreground hover:text-foreground data-active:bg-surface-high data-active:text-foreground focus-visible:ring-ring/20 relative inline-flex min-h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-transparent px-3 py-1 text-xs font-medium whitespace-nowrap tabular-nums transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)] group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:ring-[3px] focus-visible:outline-none active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
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
