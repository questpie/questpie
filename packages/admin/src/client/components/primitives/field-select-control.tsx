"use client";

import type * as React from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { InputGroup } from "../ui/input-group";

type FieldSelectTriggerProps = React.ComponentProps<typeof Button> & {
	hasValue?: boolean;
	asInputGroupControl?: boolean;
};

function FieldSelectTrigger({
	className,
	hasValue,
	asInputGroupControl,
	...props
}: FieldSelectTriggerProps) {
	return (
		<Button
			variant="outline"
			data-slot={asInputGroupControl ? "input-group-control" : undefined}
			className={cn(
				"qa-field-select-control qa-select-single control-surface w-full justify-between px-3 py-2 font-normal",
				"hover:bg-surface-low focus-visible:border-border-strong focus-visible:ring-ring/20 aria-expanded:border-border-strong aria-expanded:ring-ring/20 focus-visible:ring-[3px] aria-expanded:ring-[3px]",
				!hasValue && "text-muted-foreground",
				asInputGroupControl &&
					"h-full min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0",
				className,
			)}
			{...props}
		/>
	);
}

function FieldSelectActionGroup({
	className,
	error,
	...props
}: React.ComponentProps<"div"> & { error?: boolean }) {
	return (
		<InputGroup
			className={cn(
				"qa-field-select-action-group control-surface overflow-hidden p-0",
				error && "border-destructive ring-destructive/20 ring-[2px]",
				className,
			)}
			{...props}
		/>
	);
}

export { FieldSelectActionGroup, FieldSelectTrigger };
