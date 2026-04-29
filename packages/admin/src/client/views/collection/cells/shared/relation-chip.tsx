/**
 * RelationChip Component
 *
 * Clickable chip for displaying relation items.
 * Extracted from RelationCell to eliminate duplication.
 * Used by RelationCell and ReverseRelationCell.
 */

import type * as React from "react";

import { Badge } from "../../../../components/ui/badge";
import { useResolveText } from "../../../../i18n/hooks";
import { cn } from "../../../../lib/utils";
import {
	getRelationItemAvatarUrl,
	getRelationItemId,
	getRelationItemLabelWithField,
} from "./cell-helpers";

interface RelationChipProps {
	/**
	 * Relation item (object with id, name, title, etc.)
	 */
	item: unknown;

	/**
	 * Target collection name for navigation
	 */
	targetCollection?: string;

	/**
	 * Click handler (if provided, prevents default navigation)
	 * Receives item ID and collection name
	 */
	onClick?: (itemId: string, collection: string) => void;

	/**
	 * Additional CSS classes
	 */
	className?: string;

	/**
	 * Show avatar thumbnail before label
	 */
	showAvatar?: boolean;

	/**
	 * Dot-path to avatar field on related item (e.g. "image" or "avatar.url")
	 */
	avatarField?: string;

	/**
	 * Dot-path to preferred label field on related item
	 */
	labelField?: string;
}

/**
 * Clickable relation chip component
 * Shows label and navigates to related item on click (or opens sheet if onClick provided)
 */
export function RelationChip({
	item,
	targetCollection,
	onClick,
	className,
	showAvatar = false,
	avatarField,
	labelField,
}: RelationChipProps) {
	const resolveText = useResolveText();
	const label = resolveText(getRelationItemLabelWithField(item, labelField));
	const avatarUrl = getRelationItemAvatarUrl(item, avatarField);
	const id = getRelationItemId(item);
	const canInteract = targetCollection && id;
	const avatar =
		showAvatar && avatarUrl ? (
			<img
				src={avatarUrl}
				alt={label}
				className="image-outline size-4 rounded-full object-cover"
			/>
		) : null;

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (onClick && id && targetCollection) {
			e.preventDefault();
			onClick(id, targetCollection);
		}
	};

	if (canInteract) {
		const href = `/admin/collections/${targetCollection}/${id}`;

		// If onClick provided, use button-like behavior but keep href for accessibility
		return (
			<Badge
				variant="secondary"
				render={
					<a
						href={href}
						onClick={handleClick}
						onPointerDown={(e) => e.stopPropagation()}
					/>
				}
				className={cn("qa-relation-chip cursor-pointer", "max-w-40", className)}
			>
				{avatar}
				<span className="truncate">{label}</span>
			</Badge>
		);
	}

	// Non-clickable chip (no target collection or id)
	return (
		<Badge
			variant="secondary"
			className={cn("qa-relation-chip cursor-default", className)}
		>
			{avatar}
			<span className="truncate">{label}</span>
		</Badge>
	);
}
