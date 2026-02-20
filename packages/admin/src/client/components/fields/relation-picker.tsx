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
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import { useQueryClient } from "@tanstack/react-query";
import type { Questpie } from "questpie";
import * as React from "react";
import { toast } from "sonner";
import { useAdminConfig } from "../../hooks/use-admin-config";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { selectClient, useAdminStore } from "../../runtime";
import { resolveIconElement } from "../component-renderer";
import { SelectSingle } from "../primitives/select-single";
import type { SelectOption } from "../primitives/types";
import { ResourceSheet } from "../sheets/resource-sheet";
import { Button } from "../ui/button";
import { getAutoColumns } from "./field-utils";
import { LocaleBadge } from "./locale-badge";
import {
	type RelationDisplayFields,
	type RelationDisplayMode,
	RelationItemsDisplay,
} from "./relation";

// Module-level constant for empty array to avoid recreating on each render
const EMPTY_VALUE: string[] = [];

export interface RelationPickerProps<_T extends Questpie<any>> {
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
	 * Filter options based on form values
	 */
	filter?: (formValues: any) => any;

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
	 * Display mode for selected items
	 * @default "list"
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

export function RelationPicker<T extends Questpie<any>>({
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
	display = "list",
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
	const displayColumns = React.useMemo(() => {
		if (columns && columns.length > 0) return columns;
		if (display === "table" && targetConfig) {
			return getAutoColumns(targetConfig);
		}
		return ["_title"];
	}, [columns, display, targetConfig]);

	// Normalize value to array (handles prefill with single string ID)
	const selectedIds = React.useMemo(() => {
		if (!resolvedValue) return [];
		if (Array.isArray(resolvedValue)) return resolvedValue;
		// Single string ID (from prefill) - convert to array
		return [resolvedValue];
	}, [resolvedValue]);
	const client = useAdminStore(selectClient);

	// Keep track of fetched items for display
	// Using lazy init to avoid creating new Map on every render
	const [fetchedItems, setFetchedItems] = React.useState<Map<string, any>>(
		() => new Map(),
	);

	// Track loading state for items
	const [isLoadingItems, setIsLoadingItems] = React.useState(false);

	// Load options from server with search
	const loadOptions = React.useCallback(
		async (search: string): Promise<SelectOption<string>[]> => {
			if (!client) return [];

			try {
				const options: any = {
					limit: 50,
				};

				// Add search filter for _title
				if (search) {
					options.search = search;
				}

				// Add custom filter if provided
				if (filter) {
					options.where = filter({});
				}

				const response = await (client as any).collections[
					targetCollection
				].find(options);
				const docs = response?.docs || [];

				// Immutable update - create new Map with spread to avoid mutations
				setFetchedItems(
					(prev) =>
						new Map([
							...prev,
							...docs.map((doc: any) => [doc.id, doc] as const),
						]),
				);

				// Filter out already selected items and transform to SelectOption format
				return docs
					.filter((opt: any) => !selectedIds.includes(opt.id))
					.map((item: any) => ({
						value: item.id,
						label: renderOption
							? String(renderOption(item))
							: item._title || item.id || "",
						icon: resolveIconElement(collectionIconRef, {
							className: "size-3.5 text-muted-foreground",
						}),
					}));
			} catch (error) {
				console.error("Failed to load relation options:", error);
				toast.error("Failed to load options");
				return [];
			}
		},
		[
			client,
			targetCollection,
			filter,
			selectedIds,
			renderOption,
			collectionIconRef,
		],
	);

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
		// Clear cached items to force refresh
		setFetchedItems(new Map());
		queryClient.invalidateQueries({
			queryKey: queryOpts.key(["collections", targetCollection, "find"]),
		});
		selectedIds.forEach((id) => {
			queryClient.invalidateQueries({
				queryKey: queryOpts.key([
					"collections",
					targetCollection,
					"findOne",
					{ where: { id } },
				]),
			});
		});
	}, [queryClient, queryOpts, selectedIds, targetCollection]);

	// Fetch selected items on mount for display
	React.useEffect(() => {
		if (!client || !selectedIds.length) {
			setIsLoadingItems(false);
			return;
		}

		// Fetch any selected items that we don't have in cache
		const missingIds = selectedIds.filter((id) => !fetchedItems.has(id));
		if (missingIds.length === 0) {
			setIsLoadingItems(false);
			return;
		}

		setIsLoadingItems(true);

		let cancelled = false;

		(async () => {
			try {
				for (const id of missingIds) {
					if (cancelled) return;
					const response = await (client as any).collections[
						targetCollection
					].findOne({ where: { id } });
					if (cancelled) continue;
					if (response) {
						// Immutable update - spread prev and add new entry
						setFetchedItems((prev) => new Map([...prev, [id, response]]));
					}
				}
			} catch (error) {
				console.error("Failed to fetch selected items:", error);
				toast.error("Failed to load selected items");
			} finally {
				if (!cancelled) {
					setIsLoadingItems(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [client, targetCollection, selectedIds, fetchedItems]);

	// Get selected items from cache
	const selectedItems = React.useMemo(() => {
		return selectedIds
			.map((id: string) => fetchedItems.get(id))
			.filter(Boolean);
	}, [selectedIds, fetchedItems]);

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
		}),
		[readOnly, required, selectedIds.length, handleOpenEdit, handleRemove],
	);

	return (
		<div className="space-y-2">
			{label && (
				<div className="flex items-center gap-2">
					<label
						htmlFor={name}
						className="text-sm font-medium flex items-center gap-1.5"
					>
						{resolveIconElement(collectionIconRef, {
							className: "size-3.5 text-muted-foreground",
						})}
						{resolvedLabel}
						{required && <span className="text-destructive">*</span>}
						{maxItems && (
							<span className="ml-2 text-xs text-muted-foreground">
								({selectedIds.length}/{maxItems})
							</span>
						)}
					</label>
					{localized && <LocaleBadge locale={locale || "i18n"} />}
				</div>
			)}

			{/* Selected Items Display */}
			{(selectedItems.length > 0 || isLoadingItems) && (
				<RelationItemsDisplay
					display={display}
					items={selectedItems}
					collection={targetCollection}
					collectionIcon={collectionIconRef}
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
				<div className="flex gap-2">
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
										where: filter ? filter({}) : undefined,
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
						/>
					</div>

					{/* Create Button */}
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={handleOpenCreate}
						disabled={disabled}
						title={createLabel}
						aria-label={createLabel}
					>
						<Icon icon="ph:plus" className="h-4 w-4" />
					</Button>
				</div>
			)}

			{/* Empty State - only show when not loading */}
			{selectedIds.length === 0 && !isLoadingItems && (
				<div className="rounded-lg border border-dashed p-4 text-center">
					<p className="text-sm text-muted-foreground">
						{resolvedPlaceholder || emptyLabel}
					</p>
				</div>
			)}

			{/* Error message */}
			{error && <p className="text-sm text-destructive">{error}</p>}

			{/* Side Sheet for Create/Edit */}
			<ResourceSheet
				type="collection"
				collection={targetCollection}
				itemId={editingItemId}
				open={isSheetOpen}
				onOpenChange={setIsSheetOpen}
				onSave={handleSheetSave}
			/>
		</div>
	);
}
