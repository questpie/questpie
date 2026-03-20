/**
 * List Display - vertical list with action buttons
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import { useTranslation } from "../../../../i18n/hooks";
import { CollectionEditLink } from "../../../admin-link";
import { resolveIconElement } from "../../../component-renderer";
import { Button } from "../../../ui/button";
import { Skeleton } from "../../../ui/skeleton";
import { getItemDisplayValue, type RelationDisplayProps } from "./types";

function ListSkeleton({
	count = 3,
	editable = false,
}: {
	count?: number;
	editable?: boolean;
}) {
	const skeletonKeys = React.useMemo(
		() => Array.from({ length: count }, () => crypto.randomUUID()),
		[count],
	);

	if (editable) {
		return (
			<div className="border-border bg-card space-y-2 rounded-lg border p-3">
				{skeletonKeys.map((key) => (
					<div
						key={key}
						className="border-border bg-card flex items-center gap-2 rounded-md border p-2"
					>
						<Skeleton className="size-3.5 rounded" />
						<Skeleton className="h-4 max-w-[200px] flex-1 rounded" />
					</div>
				))}
			</div>
		);
	}

	return (
		<ul className="space-y-1">
			{skeletonKeys.map((key) => (
				<li key={key} className="flex items-center gap-1">
					<Skeleton className="size-3 rounded" />
					<Skeleton className="h-4 w-32 rounded" />
				</li>
			))}
		</ul>
	);
}

export function ListDisplay({
	items,
	collection,
	collectionIcon,
	actions,
	editable = false,
	orderable = false,
	linkToDetail = false,
	renderItem,
	isLoading = false,
	loadingCount = 3,
}: RelationDisplayProps) {
	const { t } = useTranslation();
	const iconElement = resolveIconElement(collectionIcon, {
		className: "size-3.5 text-muted-foreground shrink-0",
	});
	const smallIconElement = resolveIconElement(collectionIcon, {
		className: "size-3 text-muted-foreground",
	});

	// Show skeleton when loading and no items
	if (isLoading && items.length === 0) {
		return <ListSkeleton count={loadingCount} editable={editable} />;
	}

	// Editable list with cards
	if (editable) {
		return (
			<div className="border-border bg-card space-y-2 rounded-lg border p-3">
				{items.map((item, index) => (
					<div
						key={item.id}
						className="border-border bg-card flex items-center gap-2 rounded-md border p-2"
					>
						{/* Drag Handle */}
						{orderable && (
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground cursor-grab"
								aria-label={t("field.dragToReorder")}
							>
								<Icon icon="ph:dots-six-vertical" className="h-4 w-4" />
							</button>
						)}

						{/* Item Display */}
						<div className="flex min-w-0 flex-1 items-center gap-2">
							{iconElement}
							{renderItem ? (
								renderItem(item, index)
							) : (
								<span className="truncate text-sm">
									{getItemDisplayValue(item)}
								</span>
							)}
						</div>

						{/* Edit Button */}
						{actions?.onEdit && (
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-7 w-7 shrink-0"
								onClick={() => actions.onEdit?.(item)}
								title={t("common.edit")}
								aria-label={t("field.editItem")}
							>
								<Icon icon="ph:pencil" className="h-3 w-3" />
							</Button>
						)}

						{/* Remove Button */}
						{actions?.onRemove && (
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-7 w-7 shrink-0"
								onClick={() => actions.onRemove?.(item)}
								title={t("common.remove")}
								aria-label={t("field.removeItem")}
							>
								<Icon icon="ph:x" className="h-3 w-3" />
							</Button>
						)}
					</div>
				))}
			</div>
		);
	}

	// Read-only list
	return (
		<ul className="space-y-1">
			{items.map((item, index) => {
				const displayText = renderItem
					? renderItem(item, index)
					: getItemDisplayValue(item);

				// Clickable for sheet edit
				if (actions?.onEdit) {
					return (
						<li key={item.id}>
							<button
								type="button"
								onClick={() => actions.onEdit?.(item)}
								className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
							>
								{smallIconElement}
								{displayText}
								<Icon icon="ph:pencil" className="size-3" />
							</button>
						</li>
					);
				}

				// Link to detail page
				if (linkToDetail) {
					return (
						<li key={item.id}>
							<CollectionEditLink
								collection={collection as any}
								id={item.id}
								className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
							>
								{smallIconElement}
								{displayText}
								<Icon icon="ph:arrow-right" className="size-3" />
							</CollectionEditLink>
						</li>
					);
				}

				// Read-only
				return (
					<li key={item.id} className="flex items-center gap-1 text-sm">
						{smallIconElement}
						{displayText}
					</li>
				);
			})}
		</ul>
	);
}
