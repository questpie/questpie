"use client";

import * as React from "react";

import { ComponentRenderer } from "../../components/component-renderer";
import type {
	FilterRule,
	QuickFilterConfig,
} from "../../components/filter-builder/types";
import { Button } from "../../components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../components/ui/tooltip";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { cloneFilters, filtersEqual } from "../../lib/view-filter-utils";

export function QuickFilterBar({
	quickFilters,
	currentFilters,
	onApply,
}: {
	quickFilters?: QuickFilterConfig[];
	currentFilters: FilterRule[];
	onApply: (filters: FilterRule[]) => void;
}) {
	const resolveText = useResolveText();
	const visibleFilters = quickFilters?.filter((filter) => filter.filters) ?? [];

	if (visibleFilters.length === 0) return null;

	return (
		<div className="flex min-w-0 flex-wrap items-center gap-2">
			{visibleFilters.map((filter) => {
				const active = filtersEqual(currentFilters, filter.filters);
				const label = resolveText(filter.label, filter.id);
				const description = resolveText(filter.description);
				const button = (
					<Button
						key={filter.id}
						variant={active ? "secondary" : "outline"}
						size="sm"
						className={cn(
							"gap-1.5 text-xs",
							active && "border-border-strong bg-muted text-foreground",
						)}
						aria-pressed={active}
						onClick={() => onApply(cloneFilters(filter.filters))}
					>
						<ComponentRenderer
							reference={filter.icon}
							additionalProps={{ className: "size-4 shrink-0" }}
						/>
						<span>{label}</span>
					</Button>
				);

				if (!description) return button;

				return (
					<Tooltip key={filter.id}>
						<TooltipTrigger render={button} />
						<TooltipContent side="bottom" align="start">
							{description}
						</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}
