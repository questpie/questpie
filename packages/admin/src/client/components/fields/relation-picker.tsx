/**
 * RelationPicker Component
 *
 * Multiple relation field (one-to-many, many-to-many) with:
 * - Searchable select to add existing items
 * - Plus button to create new related item (opens side sheet)
 * - Edit button on each selected item (opens side sheet)
 * - Remove button on each selected item
 * - Optional drag-and-drop reordering
 * - Multiple display modes (list, chips, table, cards, grid)
 * - Responsive: Popover on desktop, Drawer on mobile
 */

import { Icon } from "@iconify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QuestpieApp } from "questpie/client";
import * as React from "react";
import { toast } from "sonner";

import { createQuestpieQueryOptions } from "@questpie/tanstack-query";

import { useAdminConfig } from "../../hooks/use-admin-config";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { selectClient, useAdminStore } from "../../runtime";
import { resolveIconElement } from "../component-renderer";
import { SelectMulti } from "../primitives/select-multi";
import { SelectSingle } from "../primitives/select-single";
import type { SelectOption } from "../primitives/types";
import { ResourceSheet } from "../sheets/resource-sheet";
import { Button } from "../ui/button";
import { getAutoColumns, getRelationOptionDescription } from "./field-utils";
import { LocaleBadge } from "./locale-badge";
import {
	type RelationDisplayFields,
	type RelationDisplayMode,
	RelationItemsDisplay,
} from "./relation";

// Module-level constant for empty array to avoid recreating on each render
const EMPTY_VALUE: string[] = [];

export interface RelationPickerProps<_T extends QuestpieApp> {
	/**
	 * Field name
	 */
	name: string;

	/**
	 * Current value (array of IDs of related items)
	 */
	value?: string[] | null;

	/**
	 * Change handler
	 */
	onChange: (value: string[]) => void;

	/**
	 * Target collection name
	 */
	targetCollection: string;

	/**
	 * Label for the field
	 */
	label?: string;

	/**
	 * Localized field
	 */
	localized?: boolean;

	/**
	 * Active locale
	 */
	locale?: string;

	/**
	 * Pre-resolved `where` clause for the relation `find()` call. Reactive
	 * filters (`f.relation(...).admin({ filter: ({ data }) => ({...}) })` or
	 * layout-level `props.filter`) are resolved by `FieldRenderer` against
	 * the live form via `/admin/reactive` before they reach this component —
	 * so by the time `filter` lands here it's plain JSON.
	 */
	filter?: Record<string, unknown>;

	/**
	 * Is the field required
	 */
	required?: boolean;

	/**
	 * Is the field disabled
	 */
	disabled?: boolean;

	/**
	 * Is the field readonly
	 */
	readOnly?: boolean;

	/**
	 * Placeholder text
	 */
	placeholder?: string;

	/**
	 * Error message
	 */
	error?: string;

	/**
	 * Enable drag-and-drop reordering
	 */
	orderable?: boolean;

	/**
	 * Maximum number of items
	 */
	maxItems?: number;

	/**
	 * Display mode for the field.
	 * - "select" (default): compact select control with linked records as
	 *   chips inside it — chip label opens the editor, × unlinks.
	 * - "list" | "chips" | "table" | "cards" | "grid": linked records
	 *   rendered below a separate add control (default for orderable fields,
	 *   which need the move buttons).
	 */
	display?: RelationDisplayMode;

	/**
	 * Columns to show in table display mode
	 */
	columns?: string[];

	/**
	 * Field mapping for cards/grid display modes
	 */
	fields?: RelationDisplayFields;

	/**
	 * Number of columns for grid/cards layout
	 */
	gridColumns?: 1 | 2 | 3 | 4;

	/**
	 * Custom render function for selected items (only used in list mode)
	 */
	renderItem?: (item: any, index: number) => React.ReactNode;

	/**
	 * Custom render function for dropdown options
	 */
	renderOption?: (item: any) => React.ReactNode;
}

export function RelationPicker<T extends QuestpieApp>({
	name,
	value,
	onChange,
	targetCollection,
	label,
	filter,
	required,
	disabled,
	readOnly,
	placeholder,
	error,
	localized,
	locale: localeProp,
	orderable = false,
	maxItems,
	display,
	columns,
	fields,
	gridColumns,
	renderItem,
	renderOption,
}: RelationPickerProps<T>) {
	"use no memo";
	const resolvedValue = value ?? EMPTY_VALUE;
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const resolvedLabel = label ? resolveText(label) : undefined;
	const resolvedPlaceholder = placeholder
		? resolveText(placeholder)
		: undefined;
	const labelText = resolvedLabel || targetCollection;
	const addLabel = t("relation.addItem", { name: labelText });
	const noResultsLabel = t("relation.noResults", { name: labelText });
	const emptyLabel = t("relation.noneSelected", { name: labelText });
	const createLabel = t("relation.createNew", { name: labelText });
	const locale = localeProp;
	const [isSheetOpen, setIsSheetOpen] = React.useState(false);
	const [editingItemId, setEditingItemId] = React.useState<
		string | undefined
	>();

	// Get admin config for target collection from server
	const { data: serverConfig } = useAdminConfig();
	const targetConfig = serverConfig?.collections?.[targetCollection];
	const collectionIconRef = (targetConfig as any)?.icon;
	// Default: the compact select-with-chips control. Orderable fields keep
	// the list rows — reordering needs the move buttons.
	const effectiveDisplay: RelationDisplayMode =
		display ?? (orderable ? "list" : "select");
	const isSelectDisplay = effectiveDisplay === "select";
	const displayColumns = React.useMemo(() => {
		if (columns && columns.length > 0) return columns;
		if (effectiveDisplay === "table" && targetConfig) {
			return getAutoColumns(targetConfig);
		}
		return ["_title"];
	}, [columns, effectiveDisplay, targetConfig]);

	// Normalize value to array (handles prefill with single string ID)
	const selectedIds = React.useMemo(() => {
		if (!resolvedValue) return [];
		if (Array.isArray(resolvedValue)) return resolvedValue;
		// Single string ID (from prefill) - convert to array
		return [resolvedValue];
	}, [resolvedValue]);
	const client = useAdminStore(selectClient);

	const {
		data: fetchedItemsMap = new Map<string, any>(),
		isLoading: isLoadingItems,
	} = useQuery({
		queryKey: [
			"questpie",
			"collections",
			targetCollection,
			"relation-batch",
			...selectedIds,
		],
		queryFn: async () => {
			if (!client || selectedIds.length === 0) return new Map<string, any>();
			const response = await (client as any).collections[targetCollection].find(
				{
					where: { id: { in: selectedIds } },
					limit: selectedIds.length,
				},
			);
			const map = new Map<string, any>();
			if (response?.docs) {
				for (const doc of response.docs) {
					map.set(doc.id, doc);
				}
			}
			return map;
		},
		enabled: !!client && !!targetCollection && selectedIds.length > 0,
		staleTime: 30_000,
		placeholderData: (prev) => prev,
	});

	// Load options from server with search
	const loadOptions = React.useCallback(
		async (search: string): Promise<SelectOption<string>[]> => {
			if (!client || !targetCollection) return [];

			try {
				const options: any = {
					limit: 50,
				};

				// Add search filter for _title
				if (search) {
					options.search = search;
				}

				// Add custom filter if provided (already resolved by FieldRenderer)
				if (filter) {
					options.where = filter;
				}

				const response = await (client as any).collections[
					targetCollection
				].find(options);
				let docs: any[];
				if (response) {
					if (response.docs) {
						docs = response.docs;
					} else {
						docs = [];
					}
				} else {
					docs = [];
				}

				// The select control shows already-linked options as checked (toggle
				// semantics); the legacy add-row modes hide them instead.
				const selectedIdSet = new Set(selectedIds);
				return docs
					.filter((opt: any) => isSelectDisplay || !selectedIdSet.has(opt.id))
					.map((item: any) => {
						let label: string;
						if (renderOption) {
							label = String(renderOption(item));
						} else if (item._title) {
							label = item._title;
						} else if (item.id) {
							label = item.id;
						} else {
							label = "";
						}
						// No per-option icon: every option shares the collection's
						// icon, so it carries zero information — the field label
						// already shows it once. The description gives each option
						// the context a bare title lacks.
						return {
							value: item.id,
							label,
							description: getRelationOptionDescription(item, targetConfig),
						};
					});
			} catch (error) {
				console.error("Failed to load relation options:", error);
				toast.error(t("error.failedToLoadOptions"));
				return [];
			}
		},
		[
			client,
			targetCollection,
			filter,
			selectedIds,
			renderOption,
			isSelectDisplay,
			targetConfig,
			t,
		],
	);

	// Labels for chips whose records may fall outside the loaded option window.
	const selectedLabels = React.useMemo(() => {
		const map: Record<string, string> = {};
		for (const [id, doc] of fetchedItemsMap) {
			map[id] = doc?._title || id;
		}
		return map;
	}, [fetchedItemsMap]);

	// Refetch for mutations (after create/update)
	const queryClient = useQueryClient();
	const queryOpts = React.useMemo(
		() =>
			createQuestpieQueryOptions(
				(client ?? {}) as any,
				{
					keyPrefix: ["questpie", "collections"],
				} as any,
			),
		[client],
	);

	const refetch = React.useCallback(async () => {
		queryClient.invalidateQueries({
			queryKey: ["questpie", "collections", targetCollection, "relation-batch"],
		});
		queryClient.invalidateQueries({
			queryKey: queryOpts.key(["collections", targetCollection, "find"]),
		});
	}, [queryClient, queryOpts, targetCollection]);

	// Get selected items from cache
	const selectedItems = React.useMemo(() => {
		return selectedIds
			.map((id: string) => fetchedItemsMap.get(id))
			.filter(Boolean);
	}, [selectedIds, fetchedItemsMap]);

	const handleAdd = React.useCallback(
		(itemId: string | null) => {
			if (!itemId) return;
			if (selectedIds.includes(itemId)) return;
			if (maxItems && selectedIds.length >= maxItems) return;
			onChange([...selectedIds, itemId]);
		},
		[selectedIds, maxItems, onChange],
	);

	const handleRemove = React.useCallback(
		(itemId: string) => {
			onChange(selectedIds.filter((id) => id !== itemId));
		},
		[selectedIds, onChange],
	);

	// Reorder an item within the selected-ids array (RelationPicker owns the
	// value array, so the displays delegate reordering up to here). Guarded at
	// the array bounds; a no-op move never fires onChange.
	const handleMove = React.useCallback(
		(itemId: string, direction: -1 | 1) => {
			const index = selectedIds.indexOf(itemId);
			if (index === -1) return;
			const target = index + direction;
			if (target < 0 || target >= selectedIds.length) return;
			const next = [...selectedIds];
			const [moved] = next.splice(index, 1);
			next.splice(target, 0, moved);
			onChange(next);
		},
		[selectedIds, onChange],
	);

	// Drag-and-drop reorder by array index (dnd-kit gives us from/to). Bounds-
	// guarded; a no-op move never fires onChange.
	const handleReorder = React.useCallback(
		(fromIndex: number, toIndex: number) => {
			if (
				fromIndex === toIndex ||
				fromIndex < 0 ||
				toIndex < 0 ||
				fromIndex >= selectedIds.length ||
				toIndex >= selectedIds.length
			)
				return;
			const next = [...selectedIds];
			const [moved] = next.splice(fromIndex, 1);
			next.splice(toIndex, 0, moved);
			onChange(next);
		},
		[selectedIds, onChange],
	);

	const handleOpenCreate = React.useCallback(() => {
		setEditingItemId(undefined);
		setIsSheetOpen(true);
	}, []);

	const handleOpenEdit = React.useCallback((itemId: string) => {
		setEditingItemId(itemId);
		setIsSheetOpen(true);
	}, []);

	// Handle save from ResourceSheet
	const handleSheetSave = React.useCallback(
		async (result: any) => {
			// Add newly created item to selection (create mode = no editingItemId)
			if (!editingItemId && result?.id) {
				onChange([...selectedIds, result.id]);
			}
			await refetch();
		},
		[editingItemId, selectedIds, onChange, refetch],
	);

	const canAddMore = !maxItems || selectedIds.length < maxItems;

	// Memoize actions to prevent infinite re-renders
	const displayActions = React.useMemo(
		() => ({
			onEdit: !readOnly ? (item: any) => handleOpenEdit(item.id) : undefined,
			onRemove:
				!readOnly && (!required || selectedIds.length > 1)
					? (item: any) => handleRemove(item.id)
					: undefined,
			onMoveUp:
				orderable && !readOnly
					? (item: any) => handleMove(item.id, -1)
					: undefined,
			onMoveDown:
				orderable && !readOnly
					? (item: any) => handleMove(item.id, 1)
					: undefined,
			onReorder: orderable && !readOnly ? handleReorder : undefined,
		}),
		[
			readOnly,
			required,
			selectedIds.length,
			handleOpenEdit,
			handleRemove,
			orderable,
			handleMove,
			handleReorder,
		],
	);

	const labelBlock = label && (
		<div className="flex items-center gap-2">
			<label
				htmlFor={name}
				className="font-chrome flex items-center gap-1.5 text-sm font-medium"
			>
				{resolveIconElement(collectionIconRef, {
					className: "size-3.5 text-muted-foreground",
				})}
				{resolvedLabel}
				{required && <span className="text-destructive">*</span>}
				{maxItems && (
					<span className="text-muted-foreground font-chrome chrome-meta ml-2 text-xs tabular-nums">
						({selectedIds.length}/{maxItems})
					</span>
				)}
			</label>
			{localized && <LocaleBadge locale={locale || "i18n"} />}
		</div>
	);

	const resourceSheet = (
		<ResourceSheet
			type="collection"
			collection={targetCollection}
			itemId={editingItemId}
			open={isSheetOpen}
			onOpenChange={setIsSheetOpen}
			onSave={handleSheetSave}
		/>
	);

	// Compact default: ONE control — linked records live as chips inside the
	// select (label click edits, × unlinks, menu toggles + creates).
	if (isSelectDisplay) {
		return (
			<div className="qa-relation-picker space-y-2">
				{labelBlock}
				<SelectMulti
					id={name}
					value={selectedIds}
					onChange={onChange}
					loadOptions={loadOptions}
					queryKey={(search) =>
						queryOpts.key([
							"collections",
							targetCollection,
							"find",
							{
								limit: 50,
								search,
								where: filter ?? undefined,
								withSelected: true,
							},
						])
					}
					prefetchOnMount
					placeholder={resolvedPlaceholder || `${addLabel}...`}
					disabled={disabled || readOnly}
					emptyMessage={noResultsLabel}
					drawerTitle={addLabel}
					maxSelections={maxItems}
					// Linked records are the field's content — show them all
					// (wrapping), don't collapse into "+N more".
					maxVisibleChips={100}
					selectedLabels={selectedLabels}
					loading={isLoadingItems}
					onCreateNew={!readOnly && !disabled ? handleOpenCreate : undefined}
					createNewLabel={createLabel}
					onValueClick={
						!readOnly && !disabled ? (id) => handleOpenEdit(id) : undefined
					}
					aria-invalid={!!error}
				/>
				{error && (
					<p className="text-destructive text-sm text-pretty">{error}</p>
				)}
				{resourceSheet}
			</div>
		);
	}

	return (
		<div className="qa-relation-picker space-y-2">
			{labelBlock}

			{/* Selected Items Display */}
			{(selectedItems.length > 0 || isLoadingItems) && (
				<RelationItemsDisplay
					display={effectiveDisplay}
					items={selectedItems}
					collection={targetCollection}
					editable={!readOnly && !disabled}
					orderable={orderable && !readOnly && !disabled}
					columns={displayColumns}
					fields={fields}
					gridColumns={gridColumns}
					renderItem={renderItem}
					actions={displayActions}
					collectionConfig={targetConfig as any}
					isLoading={isLoadingItems}
					loadingCount={selectedIds.length || 3}
				/>
			)}

			{/* Add More */}
			{!readOnly && canAddMore && (
				<div className="qa-relation-picker__add-more flex items-center gap-2">
					{/* Searchable Select to add existing items - uses server-side search */}
					<div className="flex-1">
						<SelectSingle
							value={null}
							onChange={handleAdd}
							loadOptions={loadOptions}
							queryKey={(search) =>
								queryOpts.key([
									"collections",
									targetCollection,
									"find",
									{
										limit: 50,
										search,
										where: filter ?? undefined,
										selectedIds,
									},
								])
							}
							prefetchOnMount
							placeholder={resolvedPlaceholder || `${addLabel}...`}
							disabled={disabled}
							clearable={false}
							emptyMessage={noResultsLabel}
							drawerTitle={addLabel}
							onCreateNew={handleOpenCreate}
							createNewLabel={createLabel}
						/>
					</div>

					{/* Create Button */}
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="text-muted-foreground hover:text-foreground size-10"
						onClick={handleOpenCreate}
						disabled={disabled}
						title={createLabel}
						aria-label={createLabel}
					>
						<Icon icon="ph:plus" className="size-4" />
					</Button>
				</div>
			)}

			{/* Empty State - only show when not loading */}
			{selectedIds.length === 0 && !isLoadingItems && (
				<div className="qa-relation-picker__empty-state py-2">
					<p className="text-muted-foreground text-sm text-pretty">
						{resolvedPlaceholder || emptyLabel}
					</p>
				</div>
			)}

			{/* Error message */}
			{error && <p className="text-destructive text-sm text-pretty">{error}</p>}

			{/* Side Sheet for Create/Edit */}
			{resourceSheet}
		</div>
	);
}
