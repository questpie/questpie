import { cn } from "@/lib/utils";
import defaultComponents from "fumadocs-ui/mdx";
import { TypeTable } from "fumadocs-ui/components/type-table";
import type { ComponentProps } from "react";

export function CustomPre({
	title,
	className,
	...props
}: ComponentProps<"pre"> & { title?: string }) {
	return (
		<div className="group relative my-6 overflow-hidden border border-border bg-card/30 backdrop-blur-sm transition-all duration-300 hover:border-primary/50 hover:bg-card/50 hover:shadow-[0_0_30px_-15px_var(--primary)]">
			<div className="flex items-center gap-2 border-b border-border bg-muted/20 px-4 py-2">
				<div className="flex gap-1.5 opacity-30 transition-opacity duration-300 group-hover:opacity-100">
					<div className="h-2 w-2 rounded-full bg-red-500/80" />
					<div className="h-2 w-2 rounded-full bg-yellow-500/80" />
					<div className="h-2 w-2 rounded-full bg-green-500/80" />
				</div>
				{title && (
					<span className="ml-2 font-mono text-[10px] text-muted-foreground tracking-wider uppercase">
						{title}
					</span>
				)}
			</div>
			{/* We disable the default title rendering by passing undefined, but we keep other functionality */}
			<defaultComponents.pre
				{...props}
				title={undefined}
				className={cn("!my-0 !border-0 !bg-transparent", className)}
			>
				{props.children}
			</defaultComponents.pre>
		</div>
	);
}

export const components = {
	...defaultComponents,
	pre: CustomPre,
	// TypeTable is required for auto-type-table remark plugin
	TypeTable,
};
