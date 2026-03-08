/**
 * Grid Display - compact grid with thumbnails
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { CollectionEditLink } from "../../../admin-link";
import { resolveIconElement } from "../../../component-renderer";
import { Button } from "../../../ui/button";
import { Skeleton } from "../../../ui/skeleton";
import {
	getImageUrl,
	getItemDisplayValue,
	type RelationDisplayProps,
} from "./types";

const gridCols = {
	1: "grid-cols-1",
	2: "grid-cols-2",
	3: "grid-cols-2 sm:grid-cols-3",
	4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
};

function GridSkeleton({
	count = 6,
	gridColumns = 3,
}: {
	count?: number;
	gridColumns?: 1 | 2 | 3 | 4;
}) {
	const skeletonKeys = React.useMemo(
		() => Array.from({ length: count }, () => crypto.randomUUID()),
		[count],
	);

	return (
		<div className={`grid gap-2 ${gridCols[gridColumns]}`}>
			{skeletonKeys.map((key) => (
				<div
					key={key}
					className="flex items-center gap-2 rounded-md border border-border bg-card p-2"
				>
					<Skeleton className="size-8 shrink-0 rounded" />
					<Skeleton className="h-4 flex-1 max-w-[120px] rounded" />
				</div>
			))}
		</div>
	);
}

export function GridDisplay({
	items,
	collection,
	collectionIcon,
	actions,
	editable = false,
	fields,
	gridColumns = 3,
	linkToDetail = false,
	isLoading = false,
	loadingCount = 6,
}: RelationDisplayProps) {
	const getTitle = (item: any) =>
		item[fields?.title || "_title"] || getItemDisplayValue(item);
	const getImage = (item: any) => getImageUrl(item, fields?.image);

	// Show skeleton when loading and no items
	if (isLoading && items.length === 0) {
		return <GridSkeleton count={loadingCount} gridColumns={gridColumns} />;
	}

	return (
		<div className={`grid gap-2 ${gridCols[gridColumns]}`}>
			{items.map((item) => {
				const image = getImage(item);

				const gridContent = (
					<div className="flex items-center gap-2 rounded-md border border-border bg-card p-2 hover:bg-card transition-colors h-full">
						{image ? (
							<div className="size-8 rounded bg-muted shrink-0 overflow-hidden">
								<img
									src={image}
									alt={getTitle(item)}
									className="w-full h-full object-cover"
								/>
							</div>
						) : collectionIcon ? (
							<div className="size-8 rounded bg-muted shrink-0 flex items-center justify-center">
								{resolveIconElement(collectionIcon, {
									className: "size-4 text-muted-foreground",
								})}
							</div>
						) : null}
						<span className="text-sm truncate flex-1">{getTitle(item)}</span>
						{/* Action buttons for editable mode */}
						{editable && (actions?.onEdit || actions?.onRemove) && (
							<div className="flex items-center gap-0.5 shrink-0">
								{actions?.onEdit && (
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="h-6 w-6"
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											actions.onEdit?.(item);
										}}
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
										className="h-6 w-6"
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											actions.onRemove?.(item);
										}}
										aria-label="Remove item"
									>
										<Icon icon="ph:x" className="size-3" />
									</Button>
								)}
							</div>
						)}
					</div>
				);

				// Non-editable with sheet edit
				if (!editable && actions?.onEdit) {
					return (
						<button
							key={item.id}
							type="button"
							onClick={() => actions.onEdit?.(item)}
							className="text-left w-full"
						>
							{gridContent}
						</button>
					);
				}

				// Non-editable with link to detail
				if (!editable && linkToDetail) {
					return (
						<CollectionEditLink
							key={item.id}
							collection={collection as any}
							id={item.id}
							className="block"
						>
							{gridContent}
						</CollectionEditLink>
					);
				}

				// Editable or read-only
				return <div key={item.id}>{gridContent}</div>;
			})}
		</div>
	);
}
