import { Icon as IconifyIcon } from "@iconify/react";
import type * as React from "react";

import { cn } from "../../lib/utils";

type WidgetEmptyStateProps = {
	title: React.ReactNode;
	description?: React.ReactNode;
	iconName?: string;
	action?: React.ReactNode;
	className?: string;
};

export function WidgetEmptyState({
	title,
	description,
	iconName = "ph:tray",
	action,
	className,
}: WidgetEmptyStateProps) {
	return (
		<div
			data-slot="widget-empty-state"
			className={cn(
				"qa-widget-empty-state flex min-h-28 flex-col items-center justify-center px-4 py-6 text-center",
				className,
			)}
		>
			<div className="flex max-w-64 flex-col items-center">
				<div className="border-border-subtle bg-surface-low text-muted-foreground mb-3 flex size-9 items-center justify-center rounded-md border">
					<IconifyIcon icon={iconName} className="size-4" />
				</div>

				<p className="text-foreground text-sm leading-5 font-medium text-balance">
					{title}
				</p>

				{description && (
					<p className="text-muted-foreground mt-1 max-w-60 text-xs/5 text-pretty">
						{description}
					</p>
				)}

				{action && <div className="mt-4">{action}</div>}
			</div>
		</div>
	);
}
