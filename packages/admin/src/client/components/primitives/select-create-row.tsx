"use client";

import { Icon } from "@iconify/react";

/**
 * Pinned "create new" action row at the bottom of a select menu (SelectSingle
 * / SelectMulti). Lives OUTSIDE the CommandList so search filtering can never
 * hide it — creation stays one tap away even with zero results.
 *
 * Visually a CommandItem (same item-surface radius, metrics and hover), muted
 * until hovered to read as a secondary action.
 */
export function SelectCreateRow({
	label,
	onSelect,
}: {
	label: string;
	onSelect: () => void;
}) {
	return (
		<div className="border-border-subtle border-t p-1">
			<button
				type="button"
				onClick={onSelect}
				className="item-surface text-muted-foreground hover:bg-accent hover:text-accent-foreground flex min-h-9 w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-sm"
			>
				<Icon icon="ph:plus" className="size-3.5 shrink-0" />
				<span className="truncate">{label}</span>
			</button>
		</div>
	);
}
