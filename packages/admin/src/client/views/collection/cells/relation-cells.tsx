/**
 * Relation Cell Components
 *
 * Cells for displaying relation fields:
 * - RelationCell - forward relations (belongs-to, has-one, has-many)
 * - ReverseRelationCell - reverse relations (computed from other collections)
 */

import * as React from "react";

import type { FieldInstance } from "../../../builder/field/field";
import { ResourceSheet } from "../../../components/sheets";
import { Badge } from "../../../components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../../components/ui/tooltip";
import { useResolveText } from "../../../i18n/hooks";
import {
	getRelationItemId,
	getRelationItemLabelWithField,
} from "./shared/cell-helpers";
import { RelationChip } from "./shared/relation-chip";

// ============================================================================
// Relation Cell
// ============================================================================

/**
 * Relation cell - displays relation as clickable chips
 * Supports both single relations and arrays
 * Opens detail sheet on click
 */
export function RelationCell({
	value,
	fieldDef,
}: {
	value: unknown;
	row?: unknown;
	fieldDef?: FieldInstance;
}) {
	const resolveText = useResolveText();
	const fieldOptions =
		(fieldDef?.["~options"] as {
			targetCollection?: string;
			listCell?: {
				display?: "chip" | "avatarChip";
				avatarField?: string;
				labelField?: string;
			};
		}) ?? {};
	const targetCollection = fieldOptions.targetCollection;
	const listCellConfig = fieldOptions.listCell;
	const showAvatar = listCellConfig?.display === "avatarChip";
	const avatarField = listCellConfig?.avatarField;
	const labelField = listCellConfig?.labelField;

	// Sheet state
	const [sheetOpen, setSheetOpen] = React.useState(false);
	const [sheetItemId, setSheetItemId] = React.useState<string | undefined>();
	const [sheetCollection, setSheetCollection] = React.useState<
		string | undefined
	>();

	const handleChipClick = React.useCallback(
		(itemId: string, collection: string) => {
			setSheetItemId(itemId);
			setSheetCollection(collection);
			setSheetOpen(true);
		},
		[],
	);

	const handleSheetOpenChange = React.useCallback((open: boolean) => {
		setSheetOpen(open);
		if (!open) {
			setSheetItemId(undefined);
			setSheetCollection(undefined);
		}
	}, []);

	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}

	// Handle array of relations (multiple)
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return <span className="text-muted-foreground">-</span>;
		}

		const visibleItems = value.slice(0, 2);
		const remainingCount = value.length - 2;

		return (
			<>
				<Tooltip>
					<TooltipTrigger
						render={
							<span className="inline-flex max-w-[260px] flex-nowrap items-center gap-1 overflow-hidden">
								{visibleItems.map((item) => {
									const itemId = getRelationItemId(item);
									return (
										<RelationChip
											key={itemId ?? String(item)}
											item={item}
											targetCollection={targetCollection}
											onClick={handleChipClick}
											className="max-w-28 shrink-0"
											showAvatar={showAvatar}
											avatarField={avatarField}
											labelField={labelField}
										/>
									);
								})}
								{remainingCount > 0 && (
									<Badge
										variant="outline"
										className="h-5 shrink-0 px-1.5 text-[10px]"
									>
										+{remainingCount}
									</Badge>
								)}
							</span>
						}
					/>
					{value.length > 3 && (
						<TooltipContent side="bottom" align="start" className="w-56 p-0">
							<div className="max-h-[200px] space-y-1 overflow-y-auto p-2">
								{value.map((item, idx) => {
									const label = resolveText(
										getRelationItemLabelWithField(item, labelField),
									);
									const id = getRelationItemId(item);
									const canNavigate = targetCollection && id;
									const key = id ?? label ?? `item-${idx}`;

									return canNavigate ? (
										<button
											key={key}
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												handleChipClick(id, targetCollection);
											}}
											className="item-surface border-border hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm"
										>
											<span className="bg-muted-foreground/50 size-1.5 shrink-0 rounded-full" />
											<span className="truncate">{label}</span>
										</button>
									) : (
										<div
											key={key}
											className="item-surface border-border flex w-full items-center gap-2 px-2 py-1.5 text-sm"
										>
											<span className="bg-muted-foreground/50 size-1.5 shrink-0 rounded-full" />
											<span className="truncate">{label}</span>
										</div>
									);
								})}
							</div>
						</TooltipContent>
					)}
				</Tooltip>

				{/* Detail sheet */}
				{sheetCollection && sheetItemId && (
					<ResourceSheet
						type="collection"
						collection={sheetCollection}
						itemId={sheetItemId}
						open={sheetOpen}
						onOpenChange={handleSheetOpenChange}
					/>
				)}
			</>
		);
	}

	// Handle single relation
	return (
		<>
			<RelationChip
				item={value}
				targetCollection={targetCollection}
				onClick={handleChipClick}
				showAvatar={showAvatar}
				avatarField={avatarField}
				labelField={labelField}
			/>
			{/* Detail sheet */}
			{sheetCollection && sheetItemId && (
				<ResourceSheet
					type="collection"
					collection={sheetCollection}
					itemId={sheetItemId}
					open={sheetOpen}
					onOpenChange={handleSheetOpenChange}
				/>
			)}
		</>
	);
}
