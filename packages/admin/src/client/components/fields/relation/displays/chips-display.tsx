/**
 * Chips Display - compact badge/tag style
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import { useTranslation } from "../../../../i18n/hooks";
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
				<Skeleton key={key} variant="chip" className="h-6 w-20" />
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
	const { t } = useTranslation();
	const iconElement = resolveIconElement(collectionIcon, {
		className: "size-3 text-muted-foreground",
	});

	// Show skeleton when loading and no items
	if (isLoading && items.length === 0) {
		return <ChipsSkeleton count={loadingCount} />;
	}

	return (
		<div className="qa-chips-display flex flex-wrap gap-2">
			{items.map((item) => {
				const displayText = getItemDisplayValue(item);

				// Editable mode - show edit/remove buttons
				if (editable && (actions?.onEdit || actions?.onRemove)) {
					return (
						<div
							key={item.id}
							className="qa-chips-display__chip item-surface border-border bg-secondary text-secondary-foreground inline-flex min-h-8 items-center gap-1 py-0.5 pr-1 pl-2"
						>
							{iconElement}
							<span className="text-sm">{displayText}</span>
							{actions?.onEdit && (
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className="relative after:absolute after:-inset-1"
									onClick={() => actions.onEdit?.(item)}
									aria-label={t("field.editItem")}
								>
									<Icon icon="ph:pencil" className="size-3" />
								</Button>
							)}
							{actions?.onRemove && (
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className="relative after:absolute after:-inset-1"
									onClick={() => actions.onRemove?.(item)}
									aria-label={t("field.removeItem")}
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
							className="focus-visible:ring-ring/40 inline-flex rounded-md focus-visible:ring-2 focus-visible:outline-none active:scale-[0.96]"
						>
							<Badge
								variant="secondary"
								className="item-surface border-border hover:bg-accent hover:text-accent-foreground cursor-pointer gap-1"
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
							className="focus-visible:ring-ring/40 inline-flex rounded-md focus-visible:ring-2 focus-visible:outline-none active:scale-[0.96]"
						>
							<Badge
								variant="secondary"
								className="item-surface border-border hover:bg-accent hover:text-accent-foreground cursor-pointer gap-1"
							>
								{iconElement}
								{displayText}
							</Badge>
						</CollectionEditLink>
					);
				}

				// Read-only badge
				return (
					<Badge
						key={item.id}
						variant="secondary"
						className="item-surface border-border gap-1"
					>
						{iconElement}
						{displayText}
					</Badge>
				);
			})}
		</div>
	);
}
