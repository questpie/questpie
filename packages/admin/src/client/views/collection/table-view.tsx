/**
 * Table View - Default list view component
 *
 * Renders collection items in a table with columns, sorting, filtering, and search.
 * This is the default list view registered in the admin view registry.
 */

import { Icon } from "@iconify/react";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type RowSelectionState,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import * as React from "react";
import { useMemo, useState } from "react";
import type { ActionsConfig } from "../../builder/types/action-types";
import type {
	CollectionBuilderState,
	ListViewConfig,
} from "../../builder/types/collection-types";
import { ActionDialog } from "../../components/actions/action-dialog";
import { HeaderActions } from "../../components/actions/header-actions";
import { FilterBuilderSheet } from "../../components/filter-builder/filter-builder-sheet";
import type {
	AvailableField,
	ViewConfiguration,
} from "../../components/filter-builder/types";
import { LocaleSwitcher } from "../../components/locale-switcher";
import { flattenOptions } from "../../components/primitives/types";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { EmptyState } from "../../components/ui/empty-state";
import { SearchInput } from "../../components/ui/search-input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../components/ui/table";
import {
	Toolbar,
	ToolbarSection,
	ToolbarSeparator,
} from "../../components/ui/toolbar";
import { useActions } from "../../hooks/use-action";
import {
	useCollectionDelete,
	useCollectionList,
} from "../../hooks/use-collection";
import { useCollectionFields } from "../../hooks/use-collection-fields";
import { useCollectionMeta } from "../../hooks/use-collection-meta";
import {
	useDeleteSavedView,
	useSavedViews,
	useSaveView,
} from "../../hooks/use-saved-views";
import { useDebouncedValue, useSearch } from "../../hooks/use-search";
import { useViewState } from "../../hooks/use-view-state";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import {
	selectRealtime,
	useAdminStore,
	useSafeContentLocales,
	useScopedLocale,
} from "../../runtime";
import {
	autoExpandFields,
	hasFieldsToExpand,
} from "../../utils/auto-expand-fields";

import { BulkActionToolbar } from "./bulk-action-toolbar";
import {
	buildColumns,
	computeDefaultColumns,
	getAllAvailableFields,
} from "./columns";

// ============================================================================
// Types
// ============================================================================

/**
 * Table view configuration from registry.
 *
 * Re-exports ListViewConfig for type consistency between builder and component.
 */
export type TableViewConfig = ListViewConfig;

function mapListSchemaToConfig(list?: {
	view?: string;
	columns?: string[];
	defaultSort?: { field: string; direction: "asc" | "desc" };
	searchable?: string[];
	filterable?: string[];
	actions?: unknown;
}): ListViewConfig | undefined {
	if (!list) return undefined;

	const config: ListViewConfig = {};
	if (list.columns?.length) config.columns = list.columns;
	if (list.defaultSort) config.defaultSort = list.defaultSort as any;
	if (list.searchable?.length) {
		config.searchFields = list.searchable as any;
		config.searchable = true;
	}

	return config;
}

/**
 * Props for TableView component
 */
export interface TableViewProps {
	/**
	 * Collection name
	 */
	collection: string;

	/**
	 * Collection configuration from admin builder
	 * Accepts CollectionBuilderState or any compatible config object
	 */
	config?: Partial<CollectionBuilderState> | Record<string, any>;

	/**
	 * View-specific configuration from registry
	 */
	viewConfig?: TableViewConfig;

	/**
	 * Navigate function for routing
	 */
	navigate: (path: string) => void;

	/**
	 * Base path for admin routes (e.g., "/admin")
	 */
	basePath?: string;

	/**
	 * Show search functionality
	 * @default true
	 */
	showSearch?: boolean;

	/**
	 * Show filter functionality
	 * @default true
	 */
	showFilters?: boolean;

	/**
	 * Show toolbar
	 * @default true
	 */
	showToolbar?: boolean;

	/**
	 * Enable realtime invalidation for this table.
	 * Falls back to AdminProvider realtime config when undefined.
	 */
	realtime?: boolean;

	/**
	 * Custom header actions (in addition to configured actions)
	 * @deprecated Use actions config instead
	 */
	headerActions?: React.ReactNode;

	/**
	 * Custom empty state
	 */
	emptyState?: React.ReactNode;

	/**
	 * Actions configuration (header, row, bulk)
	 * If not provided, defaults will be used
	 */
	actionsConfig?: ActionsConfig;
}

// ============================================================================
// Component
// ============================================================================

/**
 * TableView - Default table-based list view for collections
 *
 * Features:
 * - Auto-generates columns from collection config
 * - Search and filter functionality
 * - Sortable columns
 * - Saved views support
 * - Auto-expands upload/relation fields
 *
 * @example
 * ```tsx
 * // Used automatically via registry when navigating to /admin/collections/:name
 * // Can also be used directly:
 * <TableView
 *   collection="posts"
 *   config={postsConfig}
 *   navigate={navigate}
 *   basePath="/admin"
 * />
 * ```
 */
export default function TableView({
	collection,
	config,
	viewConfig,
	navigate,
	basePath = "/admin",
	showSearch = true,
	showFilters = true,
	showToolbar = true,
	realtime,
	headerActions,
	emptyState,
	actionsConfig,
}: TableViewProps): React.ReactElement {
	const globalRealtimeConfig = useAdminStore(selectRealtime);
	const { fields: resolvedFields, schema } = useCollectionFields(collection, {
		fallbackFields: (config as any)?.fields,
	});
	const schemaListConfig = mapListSchemaToConfig(schema?.admin?.list as any);
	const resolvedListConfig =
		(config?.list as any)?.["~config"] ?? config?.list ?? schemaListConfig;
	// Default to global realtime.enabled if not explicitly set
	const resolvedRealtime =
		realtime ??
		((resolvedListConfig as any)?.realtime as boolean | undefined) ??
		globalRealtimeConfig.enabled;

	// Use actionsConfig from prop or from config.list view config
	// Actions are now stored in the list view config, not at collection level
	const resolvedActionsConfig =
		actionsConfig ?? (resolvedListConfig as any)?.actions;

	// Fetch collection metadata from backend (for title field detection, timestamps, etc.)
	const { data: collectionMeta } = useCollectionMeta(collection);

	// i18n translations
	const { t } = useTranslation();
	const resolveText = useResolveText();

	// Locale switching (scoped or global)
	const { locale: contentLocale, setLocale: setContentLocale } =
		useScopedLocale();
	const contentLocales = useSafeContentLocales();
	const localeOptions = contentLocales?.locales ?? [];

	// Use actions hook for helpers and dialog state
	const {
		helpers: actionHelpers,
		actions,
		dialogAction,
		dialogItem,
		openDialog,
		closeDialog,
	} = useActions({
		collection,
		actionsConfig: resolvedActionsConfig,
	});

	// Build columns from config - buildAllColumns enables showing any field user selects
	const columns = useMemo(
		() =>
			buildColumns({
				config: {
					fields: resolvedFields,
					list: resolvedListConfig,
				},
				fallbackColumns: ["id"],
				buildAllColumns: true, // Build all columns so user can toggle any field
				meta: collectionMeta, // Use meta to determine title field
			}),
		[resolvedFields, resolvedListConfig, collectionMeta],
	);

	// Auto-detect fields to expand (uploads, relations)
	const expandedFields = useMemo(
		() =>
			autoExpandFields({
				fields: resolvedFields,
				list: resolvedListConfig as any,
				relations: collectionMeta?.relations,
			}),
		[resolvedFields, resolvedListConfig, collectionMeta?.relations],
	);

	// Filter builder sheet state
	const [isSheetOpen, setIsSheetOpen] = useState(false);
	const [searchTerm, setSearchTerm] = useState("");

	// Default columns using configured columns from .list() or auto-detection
	// When .list({ columns: [...] }) is defined, those become the defaults
	const defaultColumns = useMemo(
		() =>
			computeDefaultColumns(resolvedFields, {
				meta: collectionMeta,
				configuredColumns: resolvedListConfig?.columns as any,
			}),
		[resolvedFields, resolvedListConfig?.columns, collectionMeta],
	);

	// View state (filters, sort, visible columns, realtime) - with database persistence
	const viewState = useViewState(
		defaultColumns,
		{ realtime: resolvedRealtime },
		collection,
	);
	const effectiveRealtime = viewState.config.realtime ?? resolvedRealtime;

	// Build query options from view state (filters, sort)
	const queryOptions = useMemo(() => {
		const options: any = {};

		// Add field expansion if needed
		if (hasFieldsToExpand(expandedFields)) {
			options.with = expandedFields;
		}

		// Apply filters from view state
		if (viewState.config.filters.length > 0) {
			const whereConditions: Record<string, any> = { ...options.where };
			const relationNames = collectionMeta?.relations ?? [];

			const isEmptyValue = (val: unknown) => {
				if (val === undefined || val === null) return true;
				if (typeof val === "string") return val.trim().length === 0;
				if (Array.isArray(val)) return val.length === 0;
				return false;
			};

			const normalizeSelectValue = (val: unknown, fieldOptions: any) => {
				const optionsList = fieldOptions?.options;
				if (!optionsList) return val;
				const map = new Map(
					flattenOptions(optionsList).map((opt) => [
						String(opt.value),
						opt.value,
					]),
				);
				const mapValue = (item: unknown) => map.get(String(item)) ?? item;
				if (Array.isArray(val)) return val.map(mapValue);
				if (val === undefined || val === null) return val;
				return mapValue(val);
			};

			const coerceValue = (val: unknown, fieldDef?: any) => {
				if (!fieldDef) return val;
				const fieldType = fieldDef?.name ?? "text";
				const fieldOptions = fieldDef?.["~options"] ?? {};

				if (fieldType === "number" && typeof val === "string") {
					const parsed = Number(val);
					return Number.isNaN(parsed) ? val : parsed;
				}
				if (
					(fieldType === "checkbox" || fieldType === "switch") &&
					typeof val === "string"
				) {
					if (val === "true") return true;
					if (val === "false") return false;
				}
				if (fieldType === "select") {
					return normalizeSelectValue(val, fieldOptions);
				}

				return val;
			};

			const toArray = (val: unknown): unknown[] => {
				if (Array.isArray(val)) return val;
				if (val === undefined || val === null || val === "") return [];
				return [val];
			};

			const buildRelationCondition = (
				operator: string,
				val: unknown,
				relationType: "single" | "multiple",
			) => {
				const isMultiple = relationType === "multiple";
				const ids = toArray(val);

				switch (operator) {
					case "equals":
						return isMultiple ? { some: { id: val } } : { is: { id: val } };
					case "not_equals":
						return isMultiple ? { none: { id: val } } : { isNot: { id: val } };
					case "in":
						return isMultiple
							? { some: { id: { in: ids } } }
							: { is: { id: { in: ids } } };
					case "not_in":
						return isMultiple
							? { none: { id: { in: ids } } }
							: { isNot: { id: { in: ids } } };
					case "some":
						return { some: { id: { in: ids } } };
					case "every":
						return { every: { id: { in: ids } } };
					case "none":
						return { none: { id: { in: ids } } };
					case "is_empty":
						return isMultiple ? { none: {} } : { isNot: {} };
					case "is_not_empty":
						return isMultiple ? { some: {} } : { is: {} };
					default:
						return undefined;
				}
			};

			for (const filter of viewState.config.filters) {
				const { field, operator, value } = filter;
				if (!field || field === "_title") continue;

				const fieldDef = resolvedFields?.[field] as any;
				const fieldType = fieldDef?.name ?? "text";
				const fieldOptions = fieldDef?.["~options"] ?? {};
				const relationName =
					fieldType === "relation"
						? ((fieldOptions.relationName as string | undefined) ?? field)
						: undefined;
				const hasRelation =
					relationName &&
					(relationNames.length === 0 || relationNames.includes(relationName));
				const isRelationField = fieldType === "relation" && !!hasRelation;

				const requiresValue =
					operator !== "is_empty" && operator !== "is_not_empty";
				if (requiresValue && isEmptyValue(value)) continue;

				const normalizedValue = coerceValue(value, fieldDef);

				if (isRelationField && relationName) {
					const relationType =
						fieldOptions.type === "multiple" ? "multiple" : "single";
					const condition = buildRelationCondition(
						operator,
						normalizedValue,
						relationType,
					);
					if (condition) {
						whereConditions[relationName] = condition;
					}
					continue;
				}

				switch (operator) {
					case "equals":
						whereConditions[field] = normalizedValue;
						break;
					case "not_equals":
						whereConditions[field] = { ne: normalizedValue };
						break;
					case "contains":
						whereConditions[field] = { contains: normalizedValue };
						break;
					case "not_contains":
						whereConditions[field] = {
							notIlike: `%${normalizedValue}%`,
						};
						break;
					case "starts_with":
						whereConditions[field] = { startsWith: normalizedValue };
						break;
					case "ends_with":
						whereConditions[field] = { endsWith: normalizedValue };
						break;
					case "greater_than":
						whereConditions[field] = { gt: normalizedValue };
						break;
					case "less_than":
						whereConditions[field] = { lt: normalizedValue };
						break;
					case "greater_than_or_equal":
						whereConditions[field] = { gte: normalizedValue };
						break;
					case "less_than_or_equal":
						whereConditions[field] = { lte: normalizedValue };
						break;
					case "in": {
						const values = Array.isArray(normalizedValue)
							? normalizedValue
							: [normalizedValue];
						whereConditions[field] = { in: values };
						break;
					}
					case "not_in": {
						const values = Array.isArray(normalizedValue)
							? normalizedValue
							: [normalizedValue];
						whereConditions[field] = { notIn: values };
						break;
					}
					case "is_empty":
						whereConditions[field] = { isNull: true };
						break;
					case "is_not_empty":
						whereConditions[field] = { isNotNull: true };
						break;
				}
			}

			options.where = whereConditions;
		}

		// Apply sort from view state
		if (viewState.config.sortConfig) {
			const { field, direction } = viewState.config.sortConfig;
			options.orderBy = { [field]: direction };
		}

		return options;
	}, [
		expandedFields,
		viewState.config.filters,
		viewState.config.sortConfig,
		resolvedFields,
		collectionMeta?.relations,
	]);

	// Debounce search term for API requests (300ms)
	const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
	const isSearching = debouncedSearchTerm.trim().length > 0;

	// Search API for FTS-powered search
	// Returns full records with search metadata (_search.score, _search.highlights)
	const {
		data: searchData,
		isLoading: searchLoading,
		isFetching: searchFetching,
	} = useSearch(
		{
			collection,
			query: debouncedSearchTerm,
			limit: 100,
			highlights: true,
		},
		{ enabled: isSearching },
	);

	// Data fetching with filters and sort applied (normal browsing)
	const { data: listData, isLoading: listLoading } = useCollectionList(
		collection as any,
		queryOptions,
		{ enabled: !isSearching },
		{ realtime: effectiveRealtime },
	);

	// Merge data sources - search returns full records directly now
	const isLoading = isSearching ? searchLoading : listLoading;
	const isSearchActive = isSearching && searchFetching;

	// Saved views hooks
	const { data: savedViewsData, isLoading: savedViewsLoading } =
		useSavedViews(collection);
	const saveViewMutation = useSaveView(collection);
	const deleteViewMutation = useDeleteSavedView(collection);

	// Delete mutation for bulk actions
	const deleteMutation = useCollectionDelete(collection as any);

	// Build available fields from config for column picker
	// All fields are available in Options, but defaults come from .list() config
	const availableFields: AvailableField[] = useMemo(() => {
		return getAllAvailableFields(resolvedFields, { meta: collectionMeta });
	}, [resolvedFields, collectionMeta]);

	// Filter columns based on visibleColumns from view state
	// Includes checkbox selection column as first column
	const visibleColumnDefs = useMemo(() => {
		// Checkbox selection column (first column, sticky)
		const selectCol: ColumnDef<any> = {
			id: "_select",
			header: ({ table: t }) => {
				const isAllSelected = t.getIsAllPageRowsSelected();
				const isSomeSelected = t.getIsSomePageRowsSelected();
				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: <explanation>
					<div
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<Checkbox
							checked={isAllSelected}
							indeterminate={!isAllSelected && isSomeSelected}
							onCheckedChange={(checked) =>
								t.toggleAllPageRowsSelected(!!checked)
							}
							aria-label="Select all"
						/>
					</div>
				);
			},
			cell: ({ row }) => {
				const isSelected = row.getIsSelected();
				const canSelect = row.getCanSelect();
				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: <explanation>
					<div
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<Checkbox
							checked={isSelected}
							disabled={!canSelect}
							onCheckedChange={(checked) => row.toggleSelected(!!checked)}
							aria-label="Select row"
						/>
					</div>
				);
			},
			size: 40,
			enableSorting: false,
			enableHiding: false,
		};

		// Determine title column name from meta
		const titleFieldName = collectionMeta?.title?.fieldName;
		const titleType = collectionMeta?.title?.type;
		const titleColName =
			titleType === "field" && titleFieldName ? titleFieldName : "_title";

		// Start with checkbox column
		const orderedColumns: ColumnDef<any>[] = [selectCol];

		// Always add title column first (after checkbox) if it exists
		const titleCol = columns.find(
			(c) =>
				(c as any).accessorKey === titleColName ||
				(c as any).id === titleColName,
		);
		if (titleCol) {
			orderedColumns.push(titleCol as ColumnDef<any>);
		}

		// Add remaining visible columns (excluding title since it's already added)
		for (const colName of viewState.config.visibleColumns) {
			// Skip title column - already added first
			if (colName === titleColName) continue;

			const col = columns.find(
				(c) => (c as any).accessorKey === colName || (c as any).id === colName,
			);
			if (col) {
				orderedColumns.push(col as ColumnDef<any>);
			}
		}

		return orderedColumns;
	}, [columns, viewState.config.visibleColumns, collectionMeta]);

	// Table sorting state - sync with view state
	const [sorting, setSorting] = React.useState<SortingState>(() => {
		if (viewState.config.sortConfig) {
			return [
				{
					id: viewState.config.sortConfig.field,
					desc: viewState.config.sortConfig.direction === "desc",
				},
			];
		}
		return [];
	});

	// Row selection state
	const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

	// Sync table sorting with view state
	const handleSortingChange = React.useCallback(
		(updater: SortingState | ((old: SortingState) => SortingState)) => {
			const newSorting =
				typeof updater === "function" ? updater(sorting) : updater;
			setSorting(newSorting);
			if (newSorting.length > 0) {
				viewState.setSort({
					field: newSorting[0].id,
					direction: newSorting[0].desc ? "desc" : "asc",
				});
			} else {
				viewState.setSort(null);
			}
		},
		[sorting, viewState],
	);

	// Get items from appropriate data source
	// Search returns full records directly with _search metadata
	// List returns normal CRUD results
	const items = useMemo(() => {
		if (isSearching) {
			return searchData?.docs ?? [];
		}
		return listData?.docs ?? [];
	}, [isSearching, searchData?.docs, listData?.docs]);

	// Search results are already sorted by score, list results are server-sorted
	const filteredItems = items;

	const table = useReactTable({
		data: filteredItems as any[],
		columns: visibleColumnDefs,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		onSortingChange: handleSortingChange,
		enableRowSelection: true,
		onRowSelectionChange: setRowSelection,
		getRowId: (row: any) => row.id, // Use item ID as row ID for selection
		state: {
			sorting,
			rowSelection,
		},
	});

	// Handlers
	const handleSaveView = (name: string, config: ViewConfiguration) => {
		saveViewMutation.mutate({
			name,
			configuration: config,
		});
	};

	const handleDeleteView = (viewId: string) => {
		deleteViewMutation.mutate(viewId);
	};

	const handleRowClick = (item: any) => {
		navigate(`${basePath}/collections/${collection}/${item.id}`);
	};

	// Bulk delete handler
	const handleBulkDelete = React.useCallback(
		async (ids: string[]) => {
			// Delete items in parallel
			const results = await Promise.allSettled(
				ids.map((id) => deleteMutation.mutateAsync({ id })),
			);

			const successCount = results.filter(
				(r) => r.status === "fulfilled",
			).length;
			const failCount = results.filter((r) => r.status === "rejected").length;

			if (failCount === 0) {
				actionHelpers.toast.success(
					t("collection.bulkDeleteSuccess", { count: successCount }),
				);
			} else if (successCount === 0) {
				actionHelpers.toast.error(t("collection.bulkDeleteError"));
			} else {
				actionHelpers.toast.warning(
					t("collection.bulkDeletePartial", {
						success: successCount,
						failed: failCount,
					}),
				);
			}
		},
		[deleteMutation, actionHelpers, t],
	);

	if (isLoading) {
		return (
			<div className="container">
				<div className="flex h-64 items-center justify-center text-muted-foreground">
					<Icon icon="ph:spinner-gap" className="size-6 animate-spin" />
				</div>
			</div>
		);
	}

	return (
		<div className="container">
			<div className="space-y-4">
				{/* Header - Title & Actions */}
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-3">
							<h1 className="text-2xl md:text-3xl font-extrabold tracking-tight truncate">
								{resolveText(
									(config as any)?.label ?? schema?.admin?.config?.label,
									collection,
								)}
							</h1>
							{localeOptions.length > 0 && (
								<LocaleSwitcher
									locales={localeOptions}
									value={contentLocale}
									onChange={setContentLocale}
								/>
							)}
						</div>
						{((config as any)?.description ??
						schema?.admin?.config?.description) ? (
							<p className="text-muted-foreground text-sm mt-1 line-clamp-2">
								{resolveText(
									(config as any)?.description ??
										schema?.admin?.config?.description,
								)}
							</p>
						) : null}
					</div>
					<div className="flex items-center gap-2 shrink-0">
						{headerActions}
						{(actions.header.primary?.length ||
							actions.header.secondary?.length) && (
							<HeaderActions
								actions={actions.header}
								collection={collection}
								helpers={actionHelpers}
								onOpenDialog={(action) => openDialog(action)}
							/>
						)}
					</div>
				</div>

				{/* Toolbar */}
				{showToolbar && (
					<div className="space-y-2">
						<Toolbar>
							{/* Search */}
							{showSearch && (
								<ToolbarSection className="flex-1">
									<SearchInput
										value={searchTerm}
										onChange={(e) => setSearchTerm(e.target.value)}
										onClear={() => setSearchTerm("")}
										placeholder={t("common.search")}
										containerClassName="border-none bg-transparent dark:bg-transparent"
									/>
								</ToolbarSection>
							)}

							{/* Separator + Options */}
							{showFilters && (
								<>
									{showSearch && <ToolbarSeparator />}
									<ToolbarSection>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setIsSheetOpen(true)}
											className="gap-2"
										>
											<Icon
												icon="ph:sliders-horizontal"
												width={16}
												height={16}
											/>
											{t("viewOptions.title")}
										</Button>
									</ToolbarSection>
								</>
							)}
						</Toolbar>
					</div>
				)}

				{/* Floating toolbar - shows when rows selected OR filters active */}
				<BulkActionToolbar
					table={table}
					actions={actions.bulk}
					collection={collection}
					helpers={actionHelpers}
					totalCount={isSearching ? searchData?.total : listData?.totalDocs}
					pageCount={filteredItems.length}
					onOpenDialog={(action, items) => openDialog(action, items)}
					onBulkDelete={handleBulkDelete}
					filterCount={viewState.config.filters.length}
					onOpenFilters={() => setIsSheetOpen(true)}
					onClearFilters={() =>
						viewState.setConfig({ ...viewState.config, filters: [] })
					}
				/>

				{/* Table */}
				<div className="bg-card/5 backdrop-blur-sm border border-border/40 overflow-hidden">
					<Table>
						<TableHeader>
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow key={headerGroup.id} className="hover:bg-transparent">
									{headerGroup.headers.map((header, headerIndex) => {
										// First column (checkbox) is sticky at left=0, width ~36px
										// Second column (title) is sticky at left=36px
										const stickyLeft =
											headerIndex === 0
												? 0
												: headerIndex === 1
													? 36
													: undefined;
										// Only show border on the last sticky column (title)
										const showStickyBorder = headerIndex === 1;
										// Checkbox column gets compact styling
										const isCheckboxCol = headerIndex === 0;

										return (
											<TableHead
												key={header.id}
												stickyLeft={stickyLeft}
												showStickyBorder={showStickyBorder}
												className={
													isCheckboxCol ? "w-9 min-w-9 px-1.5" : undefined
												}
											>
												{header.isPlaceholder ? null : (
													<button
														type="button"
														className={
															header.column.getCanSort()
																? "cursor-pointer select-none flex items-center gap-2 hover:text-foreground transition-colors"
																: ""
														}
														onClick={header.column.getToggleSortingHandler()}
													>
														{flexRender(
															header.column.columnDef.header,
															header.getContext(),
														)}
														{header.column.getIsSorted() && (
															<span>
																{header.column.getIsSorted() === "asc"
																	? "↑"
																	: "↓"}
															</span>
														)}
													</button>
												)}
											</TableHead>
										);
									})}
								</TableRow>
							))}
						</TableHeader>
						<TableBody>
							{table.getRowModel().rows?.length ? (
								table.getRowModel().rows.map((row) => (
									<TableRow
										key={row.id}
										data-state={row.getIsSelected() && "selected"}
										className="group"
									>
										{row.getVisibleCells().map((cell, cellIndex) => {
											// First column (checkbox) is sticky at left=0, width ~36px
											// Second column (title) is sticky at left=36px
											const stickyLeft =
												cellIndex === 0 ? 0 : cellIndex === 1 ? 36 : undefined;
											// Only show border on the last sticky column (title)
											const showStickyBorder = cellIndex === 1;
											// Checkbox column gets compact styling
											const isCheckboxCol = cellIndex === 0;

											// Title column (index 1) is clickable
											const isTitleCol = cellIndex === 1;

											return (
												<TableCell
													key={cell.id}
													stickyLeft={stickyLeft}
													showStickyBorder={showStickyBorder}
													className={
														isCheckboxCol ? "w-9 min-w-9 px-1.5" : undefined
													}
												>
													{isTitleCol ? (
														<button
															type="button"
															onClick={() => handleRowClick(row.original)}
															className="text-left underline underline-offset-2 decoration-muted-foreground/50 hover:decoration-foreground transition-colors cursor-pointer"
														>
															{flexRender(
																cell.column.columnDef.cell,
																cell.getContext(),
															)}
														</button>
													) : (
														flexRender(
															cell.column.columnDef.cell,
															cell.getContext(),
														)
													)}
												</TableCell>
											);
										})}
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell colSpan={visibleColumnDefs.length} className="p-0">
										{emptyState || (
											<EmptyState
												title="NO_RESULTS"
												description={
													isSearching
														? t("collectionSearch.noResults")
														: "No items found in this collection"
												}
												height="h-48"
											/>
										)}
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>

				{/* Footer - Item count */}
				<div className="text-sm text-muted-foreground flex items-center gap-2">
					{isSearchActive && (
						<Icon icon="ph:spinner-gap" className="size-3 animate-spin" />
					)}
					{filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
					{isSearching && searchData?.total !== undefined && (
						<span>
							({searchData.total} match{searchData.total !== 1 ? "es" : ""}{" "}
							found)
						</span>
					)}
				</div>

				{/* Filter Builder Sheet */}
				<FilterBuilderSheet
					collection={collection}
					availableFields={availableFields}
					currentConfig={viewState.config}
					onConfigChange={viewState.setConfig}
					isOpen={isSheetOpen}
					onOpenChange={setIsSheetOpen}
					savedViews={savedViewsData?.docs ?? []}
					savedViewsLoading={savedViewsLoading}
					onSaveView={handleSaveView}
					onDeleteView={handleDeleteView}
				/>

				{/* Action Dialog */}
				{dialogAction && (
					<ActionDialog
						open={!!dialogAction}
						onOpenChange={(open) => !open && closeDialog()}
						action={dialogAction}
						collection={collection}
						item={dialogItem}
						helpers={actionHelpers}
					/>
				)}
			</div>
		</div>
	);
}
