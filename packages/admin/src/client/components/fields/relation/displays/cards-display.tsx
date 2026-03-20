/**
 * Cards Display - card grid with image, title, subtitle, meta
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import { useResolveText, useTranslation } from "../../../../i18n/hooks";
import { CollectionEditLink } from "../../../admin-link";
import { Button } from "../../../ui/button";
import { Skeleton } from "../../../ui/skeleton";
import {
	formatCellValue,
	formatColumnHeader,
	getImageUrl,
	getItemDisplayValue,
	type RelationDisplayProps,
} from "./types";

const gridCols = {
	1: "grid-cols-1",
	2: "grid-cols-1 sm:grid-cols-2",
	3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
	4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

function CardsSkeleton({
	count = 3,
	gridColumns = 2,
	hasImage = false,
}: {
	count?: number;
	gridColumns?: 1 | 2 | 3 | 4;
	hasImage?: boolean;
}) {
	const skeletonKeys = React.useMemo(
		() => Array.from({ length: count }, () => crypto.randomUUID()),
		[count],
	);

	return (
		<div className={`grid gap-4 ${gridCols[gridColumns]}`}>
			{skeletonKeys.map((key) => (
				<div
					key={key}
					className="border-border bg-card overflow-hidden rounded-lg border"
				>
					{hasImage && <Skeleton className="aspect-video w-full" />}
					<div className="space-y-2 p-3">
						<Skeleton className="h-5 w-3/4 rounded" />
						<Skeleton className="h-4 w-1/2 rounded" />
					</div>
				</div>
			))}
		</div>
	);
}

export function CardsDisplay({
	items,
	collection,
	actions,
	editable = false,
	fields,
	gridColumns = 2,
	linkToDetail = false,
	isLoading = false,
	loadingCount = 3,
}: RelationDisplayProps) {
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const getTitle = (item: any) =>
		item[fields?.title || "_title"] || getItemDisplayValue(item);
	const getSubtitle = (item: any) =>
		fields?.subtitle ? item[fields.subtitle] : null;
	const getImage = (item: any) => getImageUrl(item, fields?.image);
	const getMeta = (item: any) => {
		if (!fields?.meta?.length) return [];
		return fields.meta
			.map((field) => ({
				label: formatColumnHeader(field),
				value: formatCellValue(item[field]),
			}))
			.filter((m) => m.value !== "-");
	};

	// Show skeleton when loading and no items
	if (isLoading && items.length === 0) {
		return (
			<CardsSkeleton
				count={loadingCount}
				gridColumns={gridColumns}
				hasImage={!!fields?.image}
			/>
		);
	}

	return (
		<div className={`grid gap-4 ${gridCols[gridColumns]}`}>
			{items.map((item) => {
				const image = getImage(item);
				const subtitle = getSubtitle(item);
				const meta = getMeta(item);

				const cardContent = (
					<div className="border-border bg-card hover:bg-card h-full overflow-hidden rounded-lg border transition-colors">
						{image && (
							<div className="bg-muted aspect-video">
								<img
									src={image}
									alt={getTitle(item)}
									className="h-full w-full object-cover"
								/>
							</div>
						)}
						<div className="p-3">
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0 flex-1">
									<div className="truncate font-medium">{getTitle(item)}</div>
									{subtitle && (
										<div className="text-muted-foreground mt-0.5 truncate text-sm">
											{subtitle}
										</div>
									)}
								</div>
								{/* Action buttons for editable mode */}
								{editable && (actions?.onEdit || actions?.onRemove) && (
									<div className="flex shrink-0 items-center gap-1">
										{actions?.onEdit && (
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-7 w-7"
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
												className="h-7 w-7"
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
							{meta.length > 0 && (
								<div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
									{meta.map((m) => (
										<span key={String(m.label)}>
											<span className="font-medium">
												{resolveText(m.label)}:
											</span>
											{m.value}
										</span>
									))}
								</div>
							)}
						</div>
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
							{cardContent}
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
							{cardContent}
						</CollectionEditLink>
					);
				}

				// Editable or read-only
				return <div key={item.id}>{cardContent}</div>;
			})}
		</div>
	);
}
