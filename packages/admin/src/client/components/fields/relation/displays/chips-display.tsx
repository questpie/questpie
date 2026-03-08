/**
 * Chips Display - compact badge/tag style
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { CollectionEditLink } from "../../../admin-link";
import { resolveIconElement } from "../../../component-renderer";
import { Badge } from "../../../ui/badge";
import { Button } from "../../../ui/button";
import { Skeleton } from "../../../ui/skeleton";
import { getItemDisplayValue, type RelationDisplayProps } from "./types";

function ChipsSkeleton({ count = 3 }: { count?: number }) {
	const skeletonKeys = React.useMemo(
		() => Array.from({ length: count }, () => crypto.randomUUID()),
		[count],
	);

	return (
		<div className="flex flex-wrap gap-2">
			{skeletonKeys.map((key) => (
				<Skeleton key={key} className="h-6 w-20 rounded-full" />
			))}
		</div>
	);
}

export function ChipsDisplay({
	items,
	collection,
	collectionIcon,
	actions,
	editable = false,
	linkToDetail = false,
	isLoading = false,
	loadingCount = 3,
}: RelationDisplayProps) {
	const iconElement = resolveIconElement(collectionIcon, {
		className: "size-3 text-muted-foreground",
	});

	// Show skeleton when loading and no items
	if (isLoading && items.length === 0) {
		return <ChipsSkeleton count={loadingCount} />;
	}

	return (
		<div className="flex flex-wrap gap-2">
			{items.map((item) => {
				const displayText = getItemDisplayValue(item);

				// Editable mode - show edit/remove buttons
				if (editable && (actions?.onEdit || actions?.onRemove)) {
					return (
						<div
							key={item.id}
							className="inline-flex items-center gap-1 rounded-md border bg-secondary pl-2 pr-1 py-1"
						>
							{iconElement}
							<span className="text-sm">{displayText}</span>
							{actions?.onEdit && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="h-5 w-5"
									onClick={() => actions.onEdit?.(item)}
									aria-label="Edit item"
								>
									<Icon icon="ph:pencil" className="size-3" />
								</Button>
							)}
							{actions?.onRemove && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="h-5 w-5"
									onClick={() => actions.onRemove?.(item)}
									aria-label="Remove item"
								>
									<Icon icon="ph:x" className="size-3" />
								</Button>
							)}
						</div>
					);
				}

				// Clickable for edit in sheet
				if (actions?.onEdit) {
					return (
						<button
							key={item.id}
							type="button"
							onClick={() => actions.onEdit?.(item)}
							className="inline-flex"
						>
							<Badge
								variant="secondary"
								className="hover:bg-secondary cursor-pointer gap-1"
							>
								{iconElement}
								{displayText}
								<Icon icon="ph:pencil" className="size-3" />
							</Badge>
						</button>
					);
				}

				// Link to detail page
				if (linkToDetail && actions?.onNavigate) {
					return (
						<CollectionEditLink
							key={item.id}
							collection={collection as any}
							id={item.id}
							className="inline-flex"
						>
							<Badge
								variant="secondary"
								className="hover:bg-secondary cursor-pointer gap-1"
							>
								{iconElement}
								{displayText}
							</Badge>
						</CollectionEditLink>
					);
				}

				// Read-only badge
				return (
					<Badge key={item.id} variant="secondary" className="gap-1">
						{iconElement}
						{displayText}
					</Badge>
				);
			})}
		</div>
	);
}
