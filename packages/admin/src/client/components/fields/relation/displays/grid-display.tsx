/**
 * Grid Display - compact grid with thumbnails
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import { useTranslation } from "../../../../i18n/hooks";
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
					className="border-border bg-card flex items-center gap-2 rounded-md border p-2"
				>
					<Skeleton className="size-8 shrink-0 rounded" />
					<Skeleton className="h-4 max-w-[120px] flex-1 rounded" />
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
	const { t } = useTranslation();
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
					<div className="border-border bg-card hover:bg-card flex h-full items-center gap-2 rounded-md border p-2 transition-colors">
						{image ? (
							<div className="bg-muted size-8 shrink-0 overflow-hidden rounded">
								<img
									src={image}
									alt={getTitle(item)}
									className="h-full w-full object-cover"
								/>
							</div>
						) : collectionIcon ? (
							<div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded">
								{resolveIconElement(collectionIcon, {
									className: "size-4 text-muted-foreground",
								})}
							</div>
						) : null}
						<span className="flex-1 truncate text-sm">{getTitle(item)}</span>
						{/* Action buttons for editable mode */}
						{editable && (actions?.onEdit || actions?.onRemove) && (
							<div className="flex shrink-0 items-center gap-0.5">
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
										aria-label={t("field.editItem")}
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
										aria-label={t("field.removeItem")}
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
							className="w-full text-left"
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
