import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultComponents from "fumadocs-ui/mdx";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function CustomPre({
	title,
	className,
	...props
}: ComponentProps<"pre"> & { title?: string }) {
	return (
		<div className="group border-border-subtle bg-card relative my-6 overflow-hidden rounded-[var(--surface-radius)] border shadow-[var(--surface-shadow)]">
			{title && (
				<div className="border-border-subtle bg-surface-low border-b px-4 py-2">
					<span className="text-muted-foreground font-chrome text-xs font-medium">
						{title}
					</span>
				</div>
			)}
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
