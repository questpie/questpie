/**
 * List Display - vertical list with action buttons
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import { useTranslation } from "../../../../i18n/hooks";
import { cn } from "../../../../lib/utils";
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
			<div className="panel-surface space-y-2 p-3">
				{skeletonKeys.map((key) => (
					<div
						key={key}
						className="item-surface border-border bg-card flex items-center gap-2 px-3 py-2.5"
					>
						<Skeleton variant="text" className="size-3.5" />
						<Skeleton variant="text" className="h-4 max-w-[200px] flex-1" />
					</div>
				))}
			</div>
		);
	}

	return (
		<ul className="space-y-2">
			{skeletonKeys.map((key) => (
				<li
					key={key}
					className="item-surface border-border bg-card flex items-center gap-2 px-3 py-2"
				>
					<Skeleton variant="text" className="size-3.5" />
					<Skeleton variant="text" className="h-4 w-32" />
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
		className: "size-3.5 text-muted-foreground shrink-0",
	});

	// Show skeleton when loading and no items
	if (isLoading && items.length === 0) {
		return <ListSkeleton count={loadingCount} editable={editable} />;
	}

	// Editable list with cards
	if (editable) {
		return (
			<div className="panel-surface space-y-2 p-3">
				{items.map((item, index) => (
					<div
						key={item.id}
						className="item-surface border-border bg-card flex items-center gap-2 px-3 py-2.5"
					>
						{/* Drag Handle */}
						{orderable && (
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground flex shrink-0 cursor-grab items-center"
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
								size="icon-xs"
								className="shrink-0"
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
								size="icon-xs"
								className="shrink-0"
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
	const itemSurfaceClass =
		"item-surface border-border bg-card flex w-full items-center gap-2 px-3 py-2 text-sm";

	return (
		<ul className="space-y-2">
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
								className={cn(
									itemSurfaceClass,
									"hover:border-border hover:bg-accent hover:text-accent-foreground",
								)}
							>
								{smallIconElement}
								{displayText}
								<Icon icon="ph:pencil" className="ml-auto size-3.5 shrink-0" />
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
								className={cn(
									itemSurfaceClass,
									"hover:border-border hover:bg-accent hover:text-accent-foreground",
								)}
							>
								{smallIconElement}
								{displayText}
								<Icon
									icon="ph:arrow-right"
									className="ml-auto size-3.5 shrink-0"
								/>
							</CollectionEditLink>
						</li>
					);
				}

				// Read-only
				return (
					<li key={item.id} className={itemSurfaceClass}>
						{smallIconElement}
						{displayText}
					</li>
				);
			})}
		</ul>
	);
}
