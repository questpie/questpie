/**
 * List Display - vertical list with action buttons
 */

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@iconify/react";
import * as React from "react";

import { useTranslation } from "../../../../i18n/hooks";
import { cn } from "../../../../lib/utils";
import { CollectionEditLink } from "../../../admin-link";
import { Button } from "../../../ui/button";
import { Skeleton } from "../../../ui/skeleton";
import {
	getItemDisplayValue,
	type RelationDisplayProps,
	type RelationItemActions,
} from "./types";

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
					<Skeleton variant="text" className="h-4 w-32" />
				</li>
			))}
		</ul>
	);
}

/** A single relation item (dynamic record; typed via the shared props). */
type RelationItem = RelationDisplayProps["items"][number];

/** Edit + remove buttons — shared by the drag row and the up/down row. */
function RowActions({
	item,
	actions,
}: {
	item: RelationItem;
	actions?: RelationItemActions;
}) {
	const { t } = useTranslation();
	return (
		<>
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
					<Icon icon="ph:pencil" className="size-3" />
				</Button>
			)}

			{/* Remove Button — breaks the LINK (the record itself survives);
			    the link-break glyph disambiguates from delete. */}
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
					<Icon icon="ph:link-break" className="size-3" />
				</Button>
			)}
		</>
	);
}

/** Draggable row for an orderable relation (dnd-kit). */
function SortableEditableRow({
	item,
	index,
	actions,
	renderItem,
}: {
	item: RelationItem;
	index: number;
	actions?: RelationItemActions;
	renderItem?: RelationDisplayProps["renderItem"];
}) {
	const { t } = useTranslation();
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: item.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				"item-surface border-border bg-card flex items-center gap-2 px-3 py-2.5",
				isDragging && "relative z-10 opacity-60 shadow-sm",
			)}
		>
			{/* Drag handle — dnd-kit KeyboardSensor makes this keyboard-accessible
			    (space to lift, arrows to move, space to drop). */}
			<button
				type="button"
				className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab touch-none active:cursor-grabbing"
				title={t("field.reorder")}
				aria-label={t("field.reorder")}
				{...attributes}
				{...listeners}
			>
				<Icon icon="ph:dots-six-vertical" className="size-4" />
			</button>

			{/* Item Display */}
			<div className="flex min-w-0 flex-1 items-center gap-2">
				{renderItem ? (
					renderItem(item, index)
				) : (
					<span className="truncate text-sm">{getItemDisplayValue(item)}</span>
				)}
			</div>

			<RowActions item={item} actions={actions} />
		</div>
	);
}

export function ListDisplay({
	items,
	collection,
	actions,
	editable = false,
	orderable = false,
	linkToDetail = false,
	renderItem,
	isLoading = false,
	loadingCount = 3,
}: RelationDisplayProps) {
	const { t } = useTranslation();

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	// Show skeleton when loading and no items
	if (isLoading && items.length === 0) {
		return <ListSkeleton count={loadingCount} editable={editable} />;
	}

	// Editable + orderable with drag-and-drop reorder. dnd-kit hands us the
	// dragged and target ids; RelationPicker owns the value array and applies
	// the move (onReorder). Falls through to the up/down list when no onReorder.
	if (editable && orderable && actions?.onReorder) {
		const handleDragEnd = (event: DragEndEvent) => {
			const { active, over } = event;
			if (!over || active.id === over.id) return;
			const oldIndex = items.findIndex((it) => it.id === active.id);
			const newIndex = items.findIndex((it) => it.id === over.id);
			if (oldIndex !== -1 && newIndex !== -1) {
				actions.onReorder?.(oldIndex, newIndex);
			}
		};

		return (
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
			>
				<SortableContext
					items={items.map((it) => it.id)}
					strategy={verticalListSortingStrategy}
				>
					<div className="panel-surface space-y-2 p-3">
						{items.map((item, index) => (
							<SortableEditableRow
								key={item.id}
								item={item}
								index={index}
								actions={actions}
								renderItem={renderItem}
							/>
						))}
					</div>
				</SortableContext>
			</DndContext>
		);
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
						{/* Item Display */}
						<div className="flex min-w-0 flex-1 items-center gap-2">
							{renderItem ? (
								renderItem(item, index)
							) : (
								<span className="truncate text-sm">
									{getItemDisplayValue(item)}
								</span>
							)}
						</div>

						{/* Move Buttons (orderable relations without drag) — reorder
						    delegates up to RelationPicker, which owns the value array */}
						{orderable && actions?.onMoveUp && (
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="shrink-0"
								onClick={() => actions.onMoveUp?.(item)}
								disabled={index === 0}
								title={t("field.moveUp")}
								aria-label={t("field.moveUp")}
							>
								<Icon icon="ph:caret-up" className="size-3" />
							</Button>
						)}
						{orderable && actions?.onMoveDown && (
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="shrink-0"
								onClick={() => actions.onMoveDown?.(item)}
								disabled={index === items.length - 1}
								title={t("field.moveDown")}
								aria-label={t("field.moveDown")}
							>
								<Icon icon="ph:caret-down" className="size-3" />
							</Button>
						)}

						<RowActions item={item} actions={actions} />
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
						{displayText}
					</li>
				);
			})}
		</ul>
	);
}
