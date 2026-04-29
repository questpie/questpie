/**
 * Table View - Default list view component
 *
 * Renders collection items in a table with columns, sorting, filtering, and search.
 * This is the default list view registered in the admin view registry.
 */

import {
	closestCenter,
	DragOverlay,
	DndContext,
	type DragEndEvent,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { createActionRegistryProxy } from "../../builder/types/action-registry";
import type {
	ActionDefinition,
	ActionsConfig,
} from "../../builder/types/action-types";
import type {
	CollectionBuilderState,
	ListViewConfig,
} from "../../builder/types/collection-types";
import { ActionButton } from "../../components/actions/action-button";
import { ActionDialog } from "../../components/actions/action-dialog";
import { HeaderActions } from "../../components/actions/header-actions";
import { sanitizeFilename } from "../../components/fields/field-utils";
import { FilterBuilderSheet } from "../../components/filter-builder/filter-builder-sheet";
import type {
	AvailableField,
	ViewConfiguration,
} from "../../components/filter-builder/types";
import { LocaleSwitcher } from "../../components/locale-switcher";
import { AssetPreview } from "../../components/primitives/asset-preview";
import { Dropzone } from "../../components/primitives/dropzone";
import { flattenOptions } from "../../components/primitives/types";
import { ResourceSheet } from "../../components/sheets";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { EmptyState } from "../../components/ui/empty-state";
import { ScrollFade } from "../../components/ui/scroll-fade";
import { SearchInput } from "../../components/ui/search-input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "../../components/ui/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../components/ui/tooltip";
import { useActions } from "../../hooks/use-action";
import {
	useCollectionDelete,
	useCollectionList,
	useCollectionRestore,
	useCollectionUpdateBatch,
} from "../../hooks/use-collection";
import { useCollectionFields } from "../../hooks/use-collection-fields";
import { useSuspenseCollectionMeta } from "../../hooks/use-collection-meta";
import { useSessionState } from "../../hooks/use-current-user";
import { getLockUser, useLocks } from "../../hooks/use-locks";
import { useRealtimeHighlight } from "../../hooks/use-realtime-highlight";
import {
	useDeleteSavedView,
	useSavedViews,
	useSaveView,
} from "../../hooks/use-saved-views";
import { useDebouncedValue, useSearch } from "../../hooks/use-search";
import {
	mergeServerActions,
	useServerActions,
} from "../../hooks/use-server-actions";
import { useSidebarSearchParam } from "../../hooks/use-sidebar-search-param";
import { type Asset, useUpload } from "../../hooks/use-upload";
import { useUploadCollection } from "../../hooks/use-upload-collection";
import { useViewState } from "../../hooks/use-view-state";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
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
import { AdminViewHeader, AdminViewLayout } from "../layout/admin-view-layout";
import { BulkActionToolbar } from "./bulk-action-toolbar";
import {
	buildColumns,
	computeDefaultColumns,
	getAllAvailableFields,
} from "./columns";
import { TableViewSkeleton } from "./view-skeletons";

// ============================================================================
// Types
// ============================================================================

/**
 * Table view configuration from registry.
 *
 * Re-exports ListViewConfig for type consistency between builder and component.
 */
type TableViewConfig = ListViewConfig;

const actionRegistry = createActionRegistryProxy<any>();
const STICKY_TABLE_COLUMN_COUNT = 2;
const REORDER_DROP_DURATION = 160;
const REORDER_MOVE_EASING = "cubic-bezier(0.25, 1, 0.5, 1)";
const REORDER_DROP_ANIMATION = {
	duration: REORDER_DROP_DURATION,
	easing: REORDER_MOVE_EASING,
};

function UploadCollectionButton({
	collection,
	onUploaded,
}: {
	collection: string;
	onUploaded?: () => void | Promise<void>;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = React.useState(false);

	return (
		<>
			<Button
				variant="default"
				size="sm"
				className="gap-2"
				onClick={() => setOpen(true)}
			>
				<Icon icon="ph:cloud-arrow-up" className="size-3.5" />
				{t("common.upload")}
			</Button>
			<UploadCollectionSheet
				open={open}
				onOpenChange={setOpen}
				collection={collection}
				onUploaded={onUploaded}
			/>
		</>
	);
}

function UploadCollectionSheet({
	open,
	onOpenChange,
	collection,
	onUploaded,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	collection: string;
	onUploaded?: () => void | Promise<void>;
}) {
	const { t } = useTranslation();
	const { uploadMany, isUploading, progress } = useUpload();
	const [uploadedAssets, setUploadedAssets] = React.useState<Asset[]>([]);
	const [editAssetId, setEditAssetId] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (!open) {
			setUploadedAssets([]);
			setEditAssetId(null);
		}
	}, [open]);

	const handleValidationError = React.useCallback(
		(errors: { message: string }[]) => {
			for (const validationError of errors) {
				toast.error(validationError.message);
			}
		},
		[],
	);

	const handleDrop = React.useCallback(
		async (files: File[]) => {
			if (files.length === 0 || isUploading) return;

			const sanitizedFiles = files.map(
				(file) =>
					new File([file], sanitizeFilename(file.name), {
						type: file.type,
						lastModified: file.lastModified,
					}),
			);

			try {
				const uploaded = await uploadMany(sanitizedFiles, { to: collection });
				setUploadedAssets((current) => [...uploaded, ...current]);
				toast.success(t("upload.bulkSuccess", { count: uploaded.length }));
				await onUploaded?.();
			} catch (error) {
				toast.error(error instanceof Error ? error.message : t("upload.error"));
			}
		},
		[collection, isUploading, onUploaded, t, uploadMany],
	);

	return (
		<Sheet open={open} onOpenChange={onOpenChange} modal={false}>
			<SheetContent
				side="right"
				showOverlay={false}
				className="qa-upload-sheet w-full p-0 data-[side=right]:sm:max-w-xl"
			>
				<SheetHeader className="border-b px-6 py-5">
					<SheetTitle>{t("upload.bulkTitle")}</SheetTitle>
					<SheetDescription>{t("upload.bulkDescription")}</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
					<Dropzone
						onDrop={handleDrop}
						multiple
						loading={isUploading}
						progress={isUploading ? progress : undefined}
						label={t("upload.dropzone")}
						hint={t("upload.bulkHint")}
						onValidationError={handleValidationError}
					/>

					{uploadedAssets.length > 0 && (
						<div className="space-y-3">
							<p className="text-muted-foreground font-chrome chrome-meta text-xs font-medium">
								{t("upload.uploadedCount", { count: uploadedAssets.length })}
							</p>
							<div className="grid gap-2">
								{uploadedAssets.map((asset) => (
									<AssetPreview
										key={asset.id}
										asset={asset}
										variant="compact"
										onEdit={() => setEditAssetId(asset.id)}
									/>
								))}
							</div>
						</div>
					)}
				</div>

				<SheetFooter className="border-t px-6 py-4">
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isUploading}
					>
						{t("common.close")}
					</Button>
				</SheetFooter>

				{editAssetId && (
					<ResourceSheet
						type="collection"
						collection={collection}
						itemId={editAssetId}
						open={!!editAssetId}
						onOpenChange={(nextOpen) => {
							if (!nextOpen) setEditAssetId(null);
						}}
						onSave={() => {
							onUploaded?.();
						}}
					/>
				)}
			</SheetContent>
		</Sheet>
	);
}

function getColumnSizeStyle(width: number): React.CSSProperties {
	return { width, minWidth: width, maxWidth: width };
}

function getColumnSize(column: unknown, fallback = 120): number {
	return typeof (column as any)?.getSize === "function"
		? (column as any).getSize()
		: fallback;
}

function getStickyLeftOffset(columns: unknown[], index: number): number {
	return columns.slice(0, index).reduce<number>((left, column, columnIndex) => {
		const fallback = columnIndex === 0 ? 40 : 360;
		return left + getColumnSize(column, fallback);
	}, 0);
}

type ServerActionReference =
	| string
	| (() => unknown)
	| { type?: string; config?: Record<string, unknown> };

function getActionReferenceType(
	reference: ServerActionReference,
): string | undefined {
	if (typeof reference === "string") return reference;
	if (typeof reference === "function") {
		const actionType = (reference as { type?: unknown }).type;
		if (typeof actionType === "string") return actionType;

		const resolved = reference();
		return typeof resolved === "string" ? resolved : undefined;
	}
	return typeof reference?.type === "string" ? reference.type : undefined;
}

function resolveBuiltinListAction(
	reference: ServerActionReference,
): ActionDefinition | null {
	if (
		typeof reference === "object" &&
		reference !== null &&
		"id" in reference &&
		"handler" in reference
	) {
		return reference as ActionDefinition;
	}

	const type = getActionReferenceType(reference);

	const config =
		typeof reference === "object" && reference !== null
			? (reference.config as Partial<ActionDefinition> | undefined)
			: undefined;

	if (!type) return null;

	switch (type) {
		case "create":
			return actionRegistry.create(config);
		case "delete":
			return actionRegistry.delete(config);
		case "deleteMany":
			return actionRegistry.deleteMany(config);
		case "duplicate":
			return actionRegistry.duplicate(config);
		default:
			return null;
	}
}

function mapActionReferencesToDefinitions(
	references: unknown,
): ActionDefinition[] {
	if (!Array.isArray(references)) return [];

	return references
		.map((reference) =>
			resolveBuiltinListAction(reference as ServerActionReference),
		)
		.filter((action): action is ActionDefinition => action !== null);
}

function mapListActionsToDefinitions(
	actions?: unknown,
): ActionsConfig | undefined {
	if (!actions || typeof actions !== "object") return undefined;

	const listActions = actions as {
		header?: {
			primary?: unknown;
			secondary?: unknown;
		};
		row?: unknown;
		bulk?: unknown;
	};

	const header = listActions.header
		? {
				primary: mapActionReferencesToDefinitions(listActions.header.primary),
				secondary: mapActionReferencesToDefinitions(
					listActions.header.secondary,
				),
			}
		: undefined;

	const row = mapActionReferencesToDefinitions(listActions.row);
	const bulk = mapActionReferencesToDefinitions(listActions.bulk);

	if (!header && row.length === 0 && bulk.length === 0) return undefined;

	return {
		...(header ? { header } : {}),
		...(row.length > 0 ? { row } : {}),
		...(bulk.length > 0 ? { bulk } : {}),
	};
}

function mapListSchemaToConfig(list?: {
	view?: string;
	columns?: string[];
	defaultSort?: { field: string; direction: "asc" | "desc" };
	orderable?: ListViewConfig["orderable"];
	searchable?: string[];
	filterable?: string[];
	grouping?: ListViewConfig["grouping"];
	actions?: unknown;
}): ListViewConfig | undefined {
	if (!list) return undefined;

	const config: ListViewConfig = {};
	if (list.columns?.length) config.columns = list.columns;
	if (list.defaultSort) config.defaultSort = list.defaultSort as any;
	if (list.orderable) config.orderable = list.orderable;
	if (list.searchable?.length) {
		config.searchFields = list.searchable as any;
		config.searchable = true;
	}
	if (list.grouping?.fields?.length) config.grouping = list.grouping;

	config.actions = mapListActionsToDefinitions(list.actions);

	return config;
}

function stringifyGroupValue(
	value: unknown,
	field?: AvailableField,
	resolveText?: (value: any, fallback?: string) => string,
	noValueLabel = "No value",
): string {
	if (value === null || value === undefined || value === "")
		return noValueLabel;
	if (Array.isArray(value)) {
		return value.length > 0
			? value
					.map((item) =>
						stringifyGroupValue(item, field, resolveText, noValueLabel),
					)
					.join(", ")
			: noValueLabel;
	}

	const options = field?.options?.options;
	if (options) {
		const option = flattenOptions(options).find(
			(item) => String(item.value) === String(value),
		);
		if (option) {
			return (
				resolveText?.(option.label, String(option.value)) ??
				String(option.label)
			);
		}
	}

	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const displayValue =
			record.title ?? record.name ?? record.label ?? record.id;
		return (
			resolveText?.(displayValue, "Object") ?? String(displayValue ?? "Object")
		);
	}
	return String(value);
}

function getGroupSortIndex(value: unknown, field?: AvailableField): number {
	const options = field?.options?.options;
	if (!options) return Number.MAX_SAFE_INTEGER;
	const compareValue = Array.isArray(value) ? value[0] : value;
	const index = flattenOptions(options).findIndex(
		(option) => String(option.value) === String(compareValue),
	);
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

type ReorderRowContextValue = {
	attributes: Record<string, any>;
	listeners: Record<string, any> | undefined;
	setActivatorNodeRef: (element: HTMLElement | null) => void;
};

const ReorderRowContext = React.createContext<ReorderRowContextValue | null>(
	null,
);

function ReorderHandle(): React.ReactElement {
	const sortable = React.useContext(ReorderRowContext);

	return (
		<button
			type="button"
			ref={sortable?.setActivatorNodeRef}
			className="text-muted-foreground/50 hover:text-muted-foreground focus-visible:ring-ring/40 flex h-8 w-full cursor-grab touch-none items-center justify-center rounded-md transition-colors select-none focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
			aria-label="Drag to reorder"
			{...(sortable?.attributes ?? {})}
			{...(sortable?.listeners ?? {})}
		>
			<Icon icon="ph:dots-six-vertical" className="size-3.5" />
		</button>
	);
}

function ReorderDragOverlay({
	row,
	columns,
	rect,
}: {
	row: any;
	columns: Array<any>;
	rect: { width: number; height: number } | null;
}): React.ReactElement | null {
	if (!row) return null;

	const cells = row.getVisibleCells?.() ?? [];
	return (
		<div
			className="bg-background text-foreground ring-border-strong pointer-events-none overflow-hidden rounded-md shadow-xl ring-1"
			style={{
				width: rect?.width,
				height: rect?.height,
			}}
		>
			<div
				className="grid h-full items-center"
				style={{
					gridTemplateColumns: columns
						.map((column) => `${getColumnSize(column, 120)}px`)
						.join(" "),
				}}
			>
				{cells.map((cell: any, index: number) => (
					<div
						key={cell.id}
						className={cn(
							"min-w-0 truncate px-3 py-1.5 text-sm whitespace-nowrap tabular-nums",
							index === 0 && "px-1.5 text-center",
						)}
					>
						{index === 0 ? (
							<Icon
								icon="ph:dots-six-vertical"
								className="text-muted-foreground mx-auto size-3.5"
							/>
						) : (
							flexRender(cell.column.columnDef.cell, cell.getContext())
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function SortableTableRow({
	id,
	className,
	children,
	...props
}: React.ComponentProps<typeof TableRow> & { id: string }): React.ReactElement {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id,
		transition: {
			duration: REORDER_DROP_DURATION,
			easing: REORDER_MOVE_EASING,
		},
	});

	return (
		<TableRow
			ref={setNodeRef}
			className={cn(
				"select-none",
				isDragging && "bg-muted/[0.18] opacity-35",
				className,
			)}
			style={{
				transform: isDragging ? undefined : CSS.Transform.toString(transform),
				transition: isDragging ? undefined : transition,
				...(props.style ?? {}),
			}}
			{...props}
		>
			<ReorderRowContext.Provider
				value={{ attributes, listeners, setActivatorNodeRef }}
			>
				{children}
			</ReorderRowContext.Provider>
		</TableRow>
	);
}

/**
 * Props for TableView component
 */
interface TableViewProps {
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
 * Uses Suspense for data loading to eliminate race conditions.
 * Critical data (collectionMeta, user session, preferences) is loaded
 * before rendering, ensuring stable initial state.
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
export default function TableView(props: TableViewProps): React.ReactElement {
	return (
		<Suspense fallback={<TableViewSkeleton />}>
			<TableViewInner {...props} />
		</Suspense>
	);
}

/**
 * Inner component that uses Suspense queries.
 * This component will suspend until all critical data is loaded.
 */
function TableViewInner({
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
	"use no memo";
	const globalRealtimeConfig = useAdminStore(selectRealtime);
	const { fields: resolvedFields, schema } = useCollectionFields(collection, {
		fallbackFields: (config as any)?.fields,
	});
	const { collections: uploadCollections } = useUploadCollection();
	const schemaListConfig = mapListSchemaToConfig(schema?.admin?.list as any);
	const resolvedListConfig =
		viewConfig ??
		(config?.list as any)?.["~config"] ??
		config?.list ??
		schemaListConfig;
	// Default to global realtime.enabled if not explicitly set
	const resolvedRealtime =
		realtime ??
		((resolvedListConfig as any)?.realtime as boolean | undefined) ??
		globalRealtimeConfig.enabled;

	// Use actionsConfig from prop or from config.list view config
	// Actions are now stored in the list view config, not at collection level
	const rawActionsConfig =
		actionsConfig ?? (resolvedListConfig as any)?.actions;
	const resolvedActionsConfig = React.useMemo(
		() => mapListActionsToDefinitions(rawActionsConfig),
		[rawActionsConfig],
	);

	const { serverActions } = useServerActions({ collection });

	const mergedActionsConfig = React.useMemo(
		() =>
			mergeServerActions(
				(resolvedActionsConfig ?? {}) as ActionsConfig,
				serverActions,
			),
		[resolvedActionsConfig, serverActions],
	);

	// Get user session for preferences (suspense-enabled)
	const { user } = useSessionState();

	// Fetch collection metadata from backend (suspense-enabled)
	// This will suspend until data is loaded, eliminating race conditions
	const { data: collectionMeta } = useSuspenseCollectionMeta(collection);

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
		actionsConfig: mergedActionsConfig,
	});
	const canUploadToCollection =
		uploadCollections.includes(collection) &&
		schema?.access?.operations?.create?.allowed === true;

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
	const [isSheetOpen, setIsSheetOpen] = useSidebarSearchParam("view-options", {
		legacyKey: "viewOptions",
	});
	const [searchTerm, setSearchTerm] = useState("");
	const [isSearchPanelOpen, setIsSearchPanelOpen] = useState(false);
	const [isReorderMode, setIsReorderMode] = useState(false);
	const [activeReorderId, setActiveReorderId] = useState<string | null>(null);
	const [activeReorderRect, setActiveReorderRect] = useState<{
		width: number;
		height: number;
	} | null>(null);
	const [optimisticOrderIds, setOptimisticOrderIds] = useState<string[] | null>(
		null,
	);
	const reorderStartOrderIdsRef = React.useRef<string[] | null>(null);
	const reorderOverlayCleanupRef = React.useRef<number | null>(null);
	const clearReorderOverlay = React.useCallback((delay = 0) => {
		if (reorderOverlayCleanupRef.current !== null) {
			window.clearTimeout(reorderOverlayCleanupRef.current);
			reorderOverlayCleanupRef.current = null;
		}

		const clear = () => {
			setActiveReorderId(null);
			setActiveReorderRect(null);
			reorderOverlayCleanupRef.current = null;
		};

		if (delay > 0) {
			reorderOverlayCleanupRef.current = window.setTimeout(clear, delay);
			return;
		}

		clear();
	}, []);
	React.useEffect(
		() => () => {
			if (reorderOverlayCleanupRef.current !== null) {
				window.clearTimeout(reorderOverlayCleanupRef.current);
			}
		},
		[],
	);

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
	const groupingConfig = resolvedListConfig?.grouping;
	const defaultGroupBy = groupingConfig?.defaultField ?? null;
	const orderableConfig = resolvedListConfig?.orderable;
	const isOrderableEnabled = !!orderableConfig;
	const orderField = "order";
	const orderDirection =
		typeof orderableConfig === "object"
			? (orderableConfig.direction ?? "asc")
			: "asc";
	const orderStep =
		typeof orderableConfig === "object" ? (orderableConfig.step ?? 10) : 10;

	// View state (filters, sort, visible columns, realtime) - with database persistence
	// Uses Suspense internally for loading preferences
	const viewState = useViewState(
		defaultColumns,
		{ realtime: resolvedRealtime, groupBy: defaultGroupBy },
		collection,
		user?.id,
	);
	const effectiveRealtime = viewState.config.realtime ?? resolvedRealtime;
	const isKnownSortField = React.useCallback(
		(field: string | undefined) =>
			!!field && (field === "_title" || !!resolvedFields?.[field]),
		[resolvedFields],
	);
	const hasOrderField = isKnownSortField(orderField);
	const canUseOrderableSort = isOrderableEnabled && hasOrderField;
	const effectiveSort = useMemo(() => {
		if (isKnownSortField(viewState.config.sortConfig?.field)) {
			return viewState.config.sortConfig;
		}
		if (isKnownSortField(resolvedListConfig?.defaultSort?.field)) {
			return resolvedListConfig.defaultSort;
		}
		if (canUseOrderableSort) {
			return { field: orderField, direction: orderDirection };
		}
		return null;
	}, [
		viewState.config.sortConfig,
		resolvedListConfig?.defaultSort,
		canUseOrderableSort,
		orderField,
		orderDirection,
		isKnownSortField,
	]);

	// Build query options from view state (filters, sort)
	const queryOptions = useMemo(() => {
		const options: any = {};

		if (collectionMeta?.softDelete) {
			options.includeDeleted = !!viewState.config.includeDeleted;
		}

		if (viewState.config.groupBy) {
			options.groupBy = { field: viewState.config.groupBy };
		}

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

		// Keep grouped pages contiguous by sorting by the group field before row sort.
		const groupBy = viewState.config.groupBy;
		const sortConfig = effectiveSort;
		if (groupBy && sortConfig?.field && sortConfig.field !== groupBy) {
			options.orderBy = [
				{ [groupBy]: "asc" },
				{ [sortConfig.field]: sortConfig.direction },
			];
		} else if (groupBy) {
			options.orderBy = { [groupBy]: sortConfig?.direction ?? "asc" };
		} else if (sortConfig) {
			options.orderBy = { [sortConfig.field]: sortConfig.direction };
		}

		// Apply pagination from view state
		const pageSize = viewState.config.pagination?.pageSize ?? 25;
		const page = viewState.config.pagination?.page ?? 1;
		options.limit = pageSize;
		options.offset = (page - 1) * pageSize;

		return options;
	}, [
		expandedFields,
		viewState.config.filters,
		viewState.config.includeDeleted,
		viewState.config.groupBy,
		effectiveSort,
		viewState.config.pagination?.page,
		viewState.config.pagination?.pageSize,
		resolvedFields,
		collectionMeta?.softDelete,
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
	const {
		data: listData,
		isLoading: listLoading,
		error: listError,
	} = useCollectionList(
		collection as any,
		queryOptions,
		{ enabled: !isSearching },
		{ realtime: effectiveRealtime },
	);

	// Merge data sources - search returns full records directly now
	const isLoading = isSearching ? searchLoading : listLoading;
	const isSearchActive = isSearching && searchFetching;

	// Saved views hooks
	const { data: savedViewsData, isLoading: savedViewsLoading } = useSavedViews(
		collection,
		user?.id,
	);
	const saveViewMutation = useSaveView(collection, user?.id);
	const deleteViewMutation = useDeleteSavedView(collection, user?.id);

	// Delete mutation for bulk actions
	const deleteMutation = useCollectionDelete(collection as any);
	const restoreMutation = useCollectionRestore(collection as any);
	const updateBatchMutation = useCollectionUpdateBatch(collection as any);

	// Build available fields from config for column picker
	// All fields are available in Options, but defaults come from .list() config
	const availableFields: AvailableField[] = useMemo(() => {
		return getAllAvailableFields(resolvedFields, { meta: collectionMeta });
	}, [resolvedFields, collectionMeta]);
	const groupableFields = useMemo(() => {
		const groupableNames = groupingConfig?.fields ?? [];
		if (groupableNames.length === 0) return [];
		const groupableSet = new Set(groupableNames);
		return availableFields.filter((field) => groupableSet.has(field.name));
	}, [availableFields, groupingConfig?.fields]);

	// Filter columns based on visibleColumns from view state
	// Includes checkbox selection column as first column
	const visibleColumnDefs = useMemo(() => {
		// Checkbox selection column (first column, sticky)
		const selectCol: ColumnDef<any> = {
			id: "_select",
			header: ({ table: t }) => {
				if (isReorderMode) {
					return (
						<div
							className="text-muted-foreground/60 flex h-8 items-center justify-center"
							title="Order"
							aria-label="Order"
						>
							<Icon icon="ph:dots-six-vertical" className="size-3.5" />
						</div>
					);
				}

				const isAllSelected = t.getIsAllPageRowsSelected();
				const isSomeSelected = t.getIsSomePageRowsSelected();
				return (
					<div
						role="presentation"
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
				if (isReorderMode) {
					return <ReorderHandle />;
				}

				const isSelected = row.getIsSelected();
				const canSelect = row.getCanSelect();
				return (
					<div
						role="presentation"
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

		// Determine which columns to show
		// Cascade: saved prefs → computed defaults → all columns
		const columnsToShow =
			viewState.config.visibleColumns.length > 0
				? viewState.config.visibleColumns
				: defaultColumns.length > 0
					? defaultColumns
					: columns
							.map((c) => (c as any).accessorKey || (c as any).id)
							.filter(Boolean);

		// Build lookup map for O(1) column access
		const columnMap = new Map<string, ColumnDef<any>>();
		for (const c of columns) {
			const key = (c as any).accessorKey || (c as any).id;
			if (key) columnMap.set(key, c as ColumnDef<any>);
		}

		// Add remaining visible columns (excluding title since it's already added)
		for (const colName of columnsToShow) {
			// Skip title column - already added first
			if (colName === titleColName) continue;

			const col = columnMap.get(colName);
			if (col) {
				orderedColumns.push(col);
			}
		}

		if (actions.row.length > 0) {
			orderedColumns.push({
				id: "_actions",
				header: () => <span className="sr-only">{t("common.actions")}</span>,
				cell: ({ row }) => (
					<div
						role="presentation"
						className="flex justify-end gap-1"
						onClick={(event) => event.stopPropagation()}
						onKeyDown={(event) => event.stopPropagation()}
					>
						{actions.row.map((action) => (
							<ActionButton
								key={action.id}
								action={action}
								collection={collection}
								item={row.original}
								helpers={actionHelpers}
								size="icon-sm"
								iconOnly
								onOpenDialog={(dialogAction) =>
									openDialog(dialogAction, row.original)
								}
							/>
						))}
					</div>
				),
				size: 72,
				enableSorting: false,
				enableHiding: false,
			});
		}

		return orderedColumns;
	}, [
		columns,
		viewState.config.visibleColumns,
		defaultColumns,
		collectionMeta,
		isReorderMode,
		actions.row,
		collection,
		actionHelpers,
		openDialog,
		t,
	]);

	// Table sorting state - cascade: saved prefs -> list defaultSort -> order field -> empty
	const [sorting, setSorting] = React.useState<SortingState>(() => {
		const sortSource = effectiveSort;
		if (sortSource?.field) {
			return [
				{
					id: sortSource.field,
					desc: sortSource.direction === "desc",
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

	// Track realtime changes and highlight affected rows
	const { isHighlighted } = useRealtimeHighlight(items, {
		enabled: effectiveRealtime && !isSearching,
	});

	// Track who is editing which documents
	const { getLock, isLocked: isDocLocked } = useLocks({
		resourceType: "collection",
		resource: collection,
		realtime: effectiveRealtime,
	});

	React.useEffect(() => {
		if (!isReorderMode) {
			setOptimisticOrderIds(null);
			return;
		}

		setOptimisticOrderIds((current) => {
			const itemIds = items.map((item: any) => String(item.id));
			if (!current) return itemIds;

			const knownIds = new Set(itemIds);
			const next = current.filter((id) => knownIds.has(id));
			for (const id of itemIds) {
				if (!next.includes(id)) next.push(id);
			}

			return next;
		});
	}, [isReorderMode, items]);

	// Search results are already sorted by score, list results are server-sorted.
	// While reordering, keep the dropped row order locally until the server/refetch catches up.
	const filteredItems = useMemo(() => {
		if (!isReorderMode || !optimisticOrderIds) return items;

		const itemsById = new Map(
			items.map((item: any) => [String(item.id), item]),
		);
		const seen = new Set<string>();
		const ordered = optimisticOrderIds
			.map((id) => {
				const item = itemsById.get(id);
				if (item) seen.add(id);
				return item;
			})
			.filter(Boolean);

		for (const item of items as any[]) {
			const id = String(item.id);
			if (!seen.has(id)) ordered.push(item);
		}

		return ordered;
	}, [isReorderMode, items, optimisticOrderIds]);
	const hasActiveFilters = viewState.config.filters.length > 0;
	const isOrderSortActive =
		canUseOrderableSort &&
		effectiveSort?.field === orderField &&
		(effectiveSort.direction ?? "asc") === orderDirection;
	const hasMultiplePages = !isSearching && (listData?.totalPages ?? 1) > 1;
	const reorderHardBlocker = !isOrderableEnabled
		? t("collection.reorderEnableOrderable")
		: !hasOrderField
			? t("collection.reorderAddOrderField")
			: isSearching
				? t("collection.reorderClearSearch")
				: viewState.config.groupBy
					? t("collection.reorderRemoveGrouping")
					: hasActiveFilters
						? t("collection.reorderClearFilters")
						: hasMultiplePages
							? t("collection.reorderShowOnePage")
							: null;
	const reorderTooltip =
		reorderHardBlocker ??
		(isOrderSortActive
			? isReorderMode
				? t("collection.reorderExitMode")
				: t("collection.reorderItems")
			: t("collection.reorderSwitchSort", { field: orderField }));
	const reorderAriaLabel = reorderHardBlocker
		? t("collection.reorderUnavailable", { reason: reorderHardBlocker })
		: isReorderMode
			? t("collection.reorderExitMode")
			: t("collection.reorderEnterMode");
	const canReorder = isOrderableEnabled && !reorderHardBlocker;
	const handleReorderToggle = React.useCallback(() => {
		if (!canReorder) return;

		if (!isOrderSortActive) {
			const nextSort = { field: orderField, direction: orderDirection };
			setSorting([{ id: nextSort.field, desc: nextSort.direction === "desc" }]);
			viewState.setSort(nextSort);
			setIsReorderMode(true);
			return;
		}

		setIsReorderMode((active) => !active);
	}, [canReorder, isOrderSortActive, orderDirection, viewState]);
	const hasViewOptionsState =
		hasActiveFilters ||
		!!viewState.config.groupBy ||
		viewState.config.visibleColumns.length !== defaultColumns.length ||
		!!viewState.config.includeDeleted;
	const clearFilters = () => {
		viewState.setConfig({ ...viewState.config, filters: [] });
	};
	React.useEffect(() => {
		if (isReorderMode && !canReorder) {
			setIsReorderMode(false);
		}
	}, [isReorderMode, canReorder]);

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

	const tableRows = table.getRowModel().rows;
	const visibleLeafColumns = table.getVisibleLeafColumns();
	const selectColumnWidth = getColumnSize(visibleLeafColumns[0], 40);
	const titleColumnWidth = getColumnSize(visibleLeafColumns[1], 360);
	const sortableRowIds = useMemo(
		() => tableRows.map((row) => String(row.id)),
		[tableRows],
	);
	const activeReorderRow = useMemo(
		() =>
			activeReorderId
				? tableRows.find((row) => String(row.id) === activeReorderId)
				: null,
		[activeReorderId, tableRows],
	);
	const reorderSensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 4 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const handleReorderDragStart = React.useCallback(
		(event: DragStartEvent) => {
			const initialRect = event.active.rect.current.initial;
			clearReorderOverlay();
			reorderStartOrderIdsRef.current = sortableRowIds;
			setActiveReorderId(String(event.active.id));
			setActiveReorderRect(
				initialRect
					? { width: initialRect.width, height: initialRect.height }
					: null,
			);
			setOptimisticOrderIds((current) => current ?? sortableRowIds);
		},
		[clearReorderOverlay, sortableRowIds],
	);
	const handleReorderDragCancel = React.useCallback(() => {
		setOptimisticOrderIds(reorderStartOrderIdsRef.current);
		clearReorderOverlay();
		reorderStartOrderIdsRef.current = null;
	}, [clearReorderOverlay]);
	const handleReorderDragEnd = React.useCallback(
		async (event: DragEndEvent) => {
			if (updateBatchMutation.isPending) {
				clearReorderOverlay();
				return;
			}

			const { active, over } = event;
			const previousOrderIds =
				reorderStartOrderIdsRef.current ?? sortableRowIds;
			reorderStartOrderIdsRef.current = null;
			if (!over) {
				setOptimisticOrderIds(previousOrderIds);
				clearReorderOverlay();
				return;
			}

			let nextOrderIds = previousOrderIds;
			if (active.id !== over.id) {
				const oldIndex = previousOrderIds.indexOf(String(active.id));
				const newIndex = previousOrderIds.indexOf(String(over.id));
				if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
					clearReorderOverlay(REORDER_DROP_DURATION);
					return;
				}

				nextOrderIds = arrayMove(previousOrderIds, oldIndex, newIndex);
			}

			if (nextOrderIds.join("\0") === previousOrderIds.join("\0")) {
				clearReorderOverlay(REORDER_DROP_DURATION);
				return;
			}

			setOptimisticOrderIds(nextOrderIds);
			clearReorderOverlay(REORDER_DROP_DURATION);
			const rowsById = new Map(tableRows.map((row) => [String(row.id), row]));
			const reorderedRows = nextOrderIds
				.map((id) => rowsById.get(id))
				.filter((row): row is (typeof tableRows)[number] => !!row);

			try {
				await updateBatchMutation.mutateAsync({
					updates: reorderedRows.map((row, index) => ({
						id: String(row.id),
						data: { [orderField]: (index + 1) * orderStep },
					})),
				});
				actionHelpers.toast.success(t("collection.orderSaved"));
			} catch (error) {
				clearReorderOverlay();
				setOptimisticOrderIds(previousOrderIds);
				actionHelpers.toast.error(
					error instanceof Error
						? error.message
						: t("collection.orderSaveFailed"),
				);
			}
		},
		[
			sortableRowIds,
			tableRows,
			updateBatchMutation,
			orderField,
			orderStep,
			t,
			actionHelpers.toast,
			clearReorderOverlay,
		],
	);
	const groupedRowModel = useMemo(() => {
		const rows = tableRows;
		const groupBy = viewState.config.groupBy;
		if (!groupBy) {
			return rows.map((row) => ({ type: "row" as const, row }));
		}

		const groupField = groupableFields.find((field) => field.name === groupBy);
		const collapsedGroups = new Set(viewState.config.collapsedGroups ?? []);
		const serverGroups = !isSearching ? listData?.groups : undefined;
		if (serverGroups?.length) {
			const rowsById = new Map(rows.map((row) => [row.id, row]));
			return serverGroups.flatMap((group: any) => {
				const label = stringifyGroupValue(
					group.value,
					groupField,
					resolveText,
					t("common.noValue"),
				);
				const groupKey = `${groupBy}:${label}`;
				const collapsed = collapsedGroups.has(groupKey);
				const groupRows = (group.docs ?? [])
					.map((doc: any) => rowsById.get(String(doc.id)))
					.filter(Boolean);

				return [
					{
						type: "group" as const,
						key: groupKey,
						label,
						count: group.count,
						collapsed,
					},
					...(collapsed
						? []
						: groupRows.map((row: any) => ({ type: "row" as const, row }))),
				];
			});
		}

		const groups = new Map<
			string,
			{ label: string; rows: typeof rows; sortIndex: number }
		>();

		for (const row of rows) {
			const valueLabel = stringifyGroupValue(
				(row.original as any)?.[groupBy],
				groupField,
				resolveText,
				t("common.noValue"),
			);
			const groupKey = `${groupBy}:${valueLabel}`;
			const group = groups.get(groupKey);
			if (group) {
				group.rows.push(row);
				continue;
			}
			groups.set(groupKey, {
				label: valueLabel,
				rows: [row],
				sortIndex: getGroupSortIndex(
					(row.original as any)?.[groupBy],
					groupField,
				),
			});
		}

		return Array.from(groups.entries())
			.sort(([, a], [, b]) => a.sortIndex - b.sortIndex)
			.flatMap(([key, group]) => {
				const collapsed = collapsedGroups.has(key);
				return [
					{
						type: "group" as const,
						key,
						label: group.label,
						count: group.rows.length,
						collapsed,
					},
					...(collapsed
						? []
						: group.rows.map((row) => ({ type: "row" as const, row }))),
				];
			});
	}, [
		tableRows,
		viewState.config.groupBy,
		viewState.config.collapsedGroups,
		groupableFields,
		isSearching,
		listData?.groups,
		resolveText,
		t,
	]);

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

	// Bulk restore handler
	const handleBulkRestore = React.useCallback(
		async (ids: string[]) => {
			const results = await Promise.allSettled(
				ids.map((id) => restoreMutation.mutateAsync({ id })),
			);

			const successCount = results.filter(
				(r) => r.status === "fulfilled",
			).length;
			const failCount = results.filter((r) => r.status === "rejected").length;

			if (failCount === 0) {
				actionHelpers.toast.success(
					t("collection.bulkRestoreSuccess", { count: successCount }),
				);
			} else if (successCount === 0) {
				actionHelpers.toast.error(t("collection.bulkRestoreError"));
			} else {
				actionHelpers.toast.warning(
					t("collection.bulkRestorePartial", {
						success: successCount,
						failed: failCount,
					}),
				);
			}
		},
		[restoreMutation, actionHelpers, t],
	);

	if (listError && !isSearching) {
		const errorMessage =
			listError instanceof Error ? listError.message : undefined;

		return (
			<div className="container">
				<EmptyState
					variant="error"
					iconName="ph:warning-circle"
					title={t("error.failedToLoad")}
					description={errorMessage}
					height="h-64"
					action={
						<Button
							variant="outline"
							size="sm"
							className="gap-2"
							onClick={() => window.location.reload()}
						>
							<Icon icon="ph:arrow-clockwise" className="size-3.5" />
							{t("common.retry")}
						</Button>
					}
				/>
			</div>
		);
	}

	if (isLoading) {
		return <TableViewSkeleton />;
	}

	const emptyStateTitle =
		isSearching || hasActiveFilters
			? t("collectionSearch.noResults")
			: t("table.noItemsInCollection");
	const emptyStateDescription = isSearching
		? t("collectionSearch.noResultsDescription")
		: hasActiveFilters
			? t("viewOptions.noResultsDescription")
			: t("table.emptyDescription");
	const emptyStateAction =
		isSearching || hasActiveFilters ? (
			<>
				{isSearching && (
					<Button
						variant="outline"
						size="sm"
						className="gap-2"
						onClick={() => setSearchTerm("")}
					>
						<Icon icon="ph:x" className="size-3.5" />
						{t("common.clear")}
					</Button>
				)}
				{hasActiveFilters && (
					<Button
						variant="outline"
						size="sm"
						className="gap-2"
						onClick={clearFilters}
					>
						<Icon icon="ph:funnel-x" className="size-3.5" />
						{t("viewOptions.clearFilters")}
					</Button>
				)}
			</>
		) : undefined;

	return (
		<AdminViewLayout
			header={
				<AdminViewHeader
					title={resolveText(
						(config as any)?.label ?? schema?.admin?.config?.label,
						collection,
					)}
					titleAccessory={
						localeOptions.length > 0 ? (
							<LocaleSwitcher
								locales={localeOptions}
								value={contentLocale}
								onChange={setContentLocale}
							/>
						) : undefined
					}
					description={resolveText(
						(config as any)?.description ?? schema?.admin?.config?.description,
					)}
					actions={
						<>
							{isOrderableEnabled && (
								<Tooltip>
									<TooltipTrigger
										render={
											<Button
												variant="outline"
												size="icon-sm"
												className={cn(
													"relative aria-disabled:opacity-50",
													isReorderMode &&
														"border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background",
												)}
												onClick={handleReorderToggle}
												aria-label={reorderAriaLabel}
												aria-disabled={!canReorder || undefined}
												aria-pressed={isReorderMode}
											>
												<Icon icon="ph:arrows-down-up" />
											</Button>
										}
									/>
									<TooltipContent side="bottom" align="end">
										{reorderTooltip}
									</TooltipContent>
								</Tooltip>
							)}
							{showSearch && (
								<Tooltip>
									<TooltipTrigger
										render={
											<Button
												variant="outline"
												size="icon-sm"
												className="relative"
												onClick={() => setIsSearchPanelOpen((open) => !open)}
												aria-label={t("common.search")}
											>
												<Icon icon="ph:magnifying-glass" />
												{searchTerm && (
													<span className="bg-foreground absolute top-1 right-1 size-1.5 rounded-full" />
												)}
											</Button>
										}
									/>
									<TooltipContent side="bottom" align="end">
										{t("common.search")}
									</TooltipContent>
								</Tooltip>
							)}
							{showFilters && (
								<Tooltip>
									<TooltipTrigger
										render={
											<Button
												variant="outline"
												size="icon-sm"
												className="relative"
												onClick={() => setIsSheetOpen(true)}
												aria-label={t("viewOptions.title")}
											>
												<Icon icon="ph:sliders-horizontal" />
												{hasViewOptionsState && (
													<span className="bg-foreground absolute top-1 right-1 size-1.5 rounded-full" />
												)}
											</Button>
										}
									/>
									<TooltipContent side="bottom" align="end">
										{t("viewOptions.title")}
									</TooltipContent>
								</Tooltip>
							)}
							{canUploadToCollection && (
								<UploadCollectionButton
									collection={collection}
									onUploaded={() =>
										actionHelpers.invalidateCollection(collection)
									}
								/>
							)}
							{headerActions}
							{((actions.header.primary?.length ?? 0) > 0 ||
								(actions.header.secondary?.length ?? 0) > 0) && (
								<HeaderActions
									actions={actions.header}
									collection={collection}
									helpers={actionHelpers}
									onOpenDialog={(action) => openDialog(action)}
								/>
							)}
						</>
					}
				/>
			}
			contentClassName="overflow-y-auto pb-3"
		>
			<div className="qa-table-view min-w-0 space-y-4">
				{/* Search */}
				{showToolbar && showSearch && (isSearchPanelOpen || searchTerm) && (
					<div className="max-w-xl">
						<SearchInput
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							onClear={() => setSearchTerm("")}
							placeholder={t("common.search")}
							containerClassName="h-10"
						/>
					</div>
				)}

				{isReorderMode && canUseOrderableSort && (
					<div className="border-border/70 bg-muted/30 text-muted-foreground flex min-h-10 items-center justify-between gap-3 border-y px-3 py-2 font-mono text-xs">
						<div className="flex min-w-0 items-center gap-2">
							<span className="bg-foreground text-background inline-flex size-5 items-center justify-center rounded-full">
								<Icon icon="ph:arrows-down-up" className="size-3" />
							</span>
							<span className="text-foreground font-medium">
								{t("collection.reorderMode")}
							</span>
							<span className="hidden sm:inline">
								{t("collection.sortedByField", {
									field: orderField,
									direction: orderDirection,
								})}
							</span>
						</div>
						<Button
							variant="ghost"
							size="xs"
							onClick={() => setIsReorderMode(false)}
						>
							{t("common.done")}
						</Button>
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
					onBulkRestore={handleBulkRestore}
					filterCount={viewState.config.filters.length}
					onOpenFilters={() => setIsSheetOpen(true)}
					onClearFilters={clearFilters}
				/>

				{/* Table */}
				<div className="qa-table-view__table-wrapper min-w-0">
					<ScrollFade leftInset={selectColumnWidth + titleColumnWidth}>
						<DndContext
							sensors={reorderSensors}
							collisionDetection={closestCenter}
							onDragStart={handleReorderDragStart}
							onDragCancel={handleReorderDragCancel}
							onDragEnd={handleReorderDragEnd}
						>
							<Table
								className="table-fixed"
								style={{ width: table.getTotalSize() }}
								aria-label={resolveText(
									(config as any)?.label ?? schema?.admin?.config?.label,
									collection,
								)}
							>
								<colgroup>
									{visibleLeafColumns.map((column) => (
										<col key={column.id} style={{ width: column.getSize() }} />
									))}
								</colgroup>
								<TableHeader>
									{table.getHeaderGroups().map((headerGroup) => (
										<TableRow
											key={headerGroup.id}
											className="hover:bg-transparent"
										>
											{headerGroup.headers.map((header, headerIndex) => {
												// Checkbox column gets compact styling
												const isCheckboxCol = headerIndex === 0;
												const columnWidth = getColumnSize(
													header.column,
													isCheckboxCol ? 40 : 120,
												);
												const isStickyColumn =
													headerIndex < STICKY_TABLE_COLUMN_COUNT;
												const stickyLeft = isStickyColumn
													? getStickyLeftOffset(visibleLeafColumns, headerIndex)
													: undefined;

												// Determine aria-sort for sortable columns
												const sortDirection = header.column.getIsSorted();
												const ariaSort:
													| "ascending"
													| "descending"
													| "none"
													| undefined = header.column.getCanSort()
													? sortDirection === "asc"
														? "ascending"
														: sortDirection === "desc"
															? "descending"
															: "none"
													: undefined;

												return (
													<TableHead
														key={header.id}
														stickyLeft={stickyLeft}
														showStickyBorder={
															headerIndex === STICKY_TABLE_COLUMN_COUNT - 1
														}
														className={
															isCheckboxCol ? "w-9 min-w-9 px-1.5" : undefined
														}
														style={getColumnSizeStyle(columnWidth)}
														aria-sort={ariaSort}
													>
														{header.isPlaceholder ? null : (
															<button
																type="button"
																className={
																	header.column.getCanSort()
																		? "hover:text-foreground focus-visible:ring-ring/40 -mx-1.5 flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 transition-colors select-none focus-visible:ring-2 focus-visible:outline-none"
																		: ""
																}
																onClick={header.column.getToggleSortingHandler()}
																aria-label={
																	header.column.getCanSort()
																		? `Sort by ${typeof header.column.columnDef.header === "string" ? header.column.columnDef.header : header.column.id}`
																		: undefined
																}
															>
																{flexRender(
																	header.column.columnDef.header,
																	header.getContext(),
																)}
																{header.column.getIsSorted() && (
																	<span aria-hidden="true">
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
								<SortableContext
									items={sortableRowIds}
									strategy={verticalListSortingStrategy}
								>
									<TableBody>
										{groupedRowModel.map((entry: any) => {
											if (entry.type === "group") {
												return (
													<TableRow
														key={entry.key}
														className="hover:bg-transparent"
													>
														<TableCell
															stickyLeft={0}
															className="w-9 min-w-9 border-b-0 px-1.5 group-hover/row:bg-transparent"
															style={getColumnSizeStyle(selectColumnWidth)}
														/>
														<TableCell
															stickyLeft={selectColumnWidth}
															showStickyBorder
															className="bg-background top-8 z-20 border-b-0 group-hover/row:bg-transparent"
															style={getColumnSizeStyle(titleColumnWidth)}
														>
															<button
																type="button"
																aria-expanded={!entry.collapsed}
																className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/40 -ml-1 inline-flex min-h-8 items-center gap-2 rounded-md px-1 font-mono text-[11px] font-semibold tracking-[0.12em] uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none"
																onClick={() =>
																	viewState.toggleCollapsedGroup(entry.key)
																}
															>
																<Icon
																	icon={
																		entry.collapsed
																			? "ph:caret-right"
																			: "ph:caret-down"
																	}
																	className="size-3.5 shrink-0"
																/>
																<span>{entry.label}</span>
																{groupingConfig?.showCounts !== false && (
																	<span className="bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] tracking-normal tabular-nums">
																		{entry.count}
																	</span>
																)}
															</button>
														</TableCell>
														{visibleLeafColumns.length >
															STICKY_TABLE_COLUMN_COUNT && (
															<TableCell
																colSpan={
																	visibleLeafColumns.length -
																	STICKY_TABLE_COLUMN_COUNT
																}
																className="border-b-0"
															/>
														)}
													</TableRow>
												);
											}

											const row = entry.row;
											const isRowDeleted = !!(row.original as any)?.deletedAt;
											const DataRow = isReorderMode
												? SortableTableRow
												: TableRow;
											return (
												<DataRow
													id={String(row.id)}
													key={row.id}
													data-state={row.getIsSelected() && "selected"}
													className={cn(
														"group",
														isReorderMode && "bg-muted/[0.18]",
														isHighlighted(row.id) && "animate-realtime-pulse",
														isRowDeleted && "opacity-50",
													)}
												>
													{row
														.getVisibleCells()
														.map((cell: any, cellIndex: number) => {
															// Checkbox column gets compact styling
															const isCheckboxCol = cellIndex === 0;
															const columnWidth = getColumnSize(
																cell.column,
																isCheckboxCol ? 40 : 120,
															);
															const isStickyColumn =
																cellIndex < STICKY_TABLE_COLUMN_COUNT;
															const stickyLeft = isStickyColumn
																? getStickyLeftOffset(
																		visibleLeafColumns,
																		cellIndex,
																	)
																: undefined;

															// Title column (index 1) is clickable
															const isTitleCol = cellIndex === 1;

															return (
																<TableCell
																	key={cell.id}
																	stickyLeft={stickyLeft}
																	showStickyBorder={
																		cellIndex === STICKY_TABLE_COLUMN_COUNT - 1
																	}
																	className={
																		isCheckboxCol
																			? "w-9 min-w-9 px-1.5"
																			: undefined
																	}
																	style={getColumnSizeStyle(columnWidth)}
																>
																	{isTitleCol ? (
																		<div className="flex min-w-0 items-center gap-2">
																			<button
																				type="button"
																				onClick={() =>
																					handleRowClick(row.original)
																				}
																				disabled={isReorderMode}
																				className={cn(
																					"decoration-muted-foreground/50 hover:decoration-foreground max-w-full min-w-0 text-left underline underline-offset-2 transition-colors disabled:cursor-default disabled:no-underline",
																					!isReorderMode && "cursor-pointer",
																				)}
																			>
																				{flexRender(
																					cell.column.columnDef.cell,
																					cell.getContext(),
																				)}
																			</button>
																			{isRowDeleted && (
																				<span className="text-destructive bg-destructive/10 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs">
																					<Icon
																						icon="ph:trash"
																						className="size-3"
																					/>
																					{t("common.deleted")}
																				</span>
																			)}
																			{isDocLocked(row.id) &&
																				(() => {
																					const lock = getLock(row.id);
																					const user = lock
																						? getLockUser(lock)
																						: null;
																					return (
																						<span
																							className="text-muted-foreground bg-muted inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs"
																							title={
																								user?.name ??
																								user?.email ??
																								"Someone is editing"
																							}
																						>
																							{user?.image ? (
																								<img
																									src={user.image}
																									alt=""
																									className="image-outline size-4 rounded-full"
																								/>
																							) : (
																								<Icon
																									icon="ph:pencil-simple"
																									className="size-3"
																								/>
																							)}
																							<span className="max-w-20 truncate">
																								{user?.name?.split(" ")[0] ??
																									t("table.editing")}
																							</span>
																						</span>
																					);
																				})()}
																		</div>
																	) : (
																		flexRender(
																			cell.column.columnDef.cell,
																			cell.getContext(),
																		)
																	)}
																</TableCell>
															);
														})}
												</DataRow>
											);
										})}
									</TableBody>
								</SortableContext>
							</Table>
							<DragOverlay
								adjustScale={false}
								dropAnimation={REORDER_DROP_ANIMATION}
							>
								<ReorderDragOverlay
									row={activeReorderRow}
									columns={visibleLeafColumns}
									rect={activeReorderRect}
								/>
							</DragOverlay>
						</DndContext>
					</ScrollFade>
					{/* Empty state rendered outside table to avoid colSpan/border-separate width issues */}
					{!table.getRowModel().rows.length &&
						(emptyState || (
							<EmptyState
								variant={isSearching || hasActiveFilters ? "search" : "empty"}
								iconName={
									isSearching
										? "ph:magnifying-glass"
										: hasActiveFilters
											? "ph:funnel-x"
											: "ph:tray"
								}
								title={emptyStateTitle}
								description={emptyStateDescription}
								action={emptyStateAction}
								height="h-48"
							/>
						))}
				</div>

				{/* Footer - Pagination */}
				{!isSearching && (
					<div
						className="qa-table-view__pagination flex items-center justify-between gap-4 py-2 tabular-nums"
						role="navigation"
						aria-label={t("table.pagination")}
					>
						{/* Left side - item count and page size */}
						<div
							className="text-muted-foreground flex items-center gap-4 text-sm"
							aria-live="polite"
							aria-atomic="true"
						>
							<span>
								{filteredItems.length > 0
									? `${((viewState.config.pagination?.page ?? 1) - 1) * (viewState.config.pagination?.pageSize ?? 25) + 1}-${Math.min(((viewState.config.pagination?.page ?? 1) - 1) * (viewState.config.pagination?.pageSize ?? 25) + (viewState.config.pagination?.pageSize ?? 25), listData?.totalDocs ?? filteredItems.length)}`
									: "0"}{" "}
								{t("table.of")} {listData?.totalDocs ?? 0}
							</span>
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground">{t("table.show")}</span>
								<Select
									value={String(viewState.config.pagination?.pageSize ?? 25)}
									onValueChange={(value) =>
										viewState.setPageSize(Number(value))
									}
								>
									<SelectTrigger className="h-8 w-[70px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent side="top">
										{[10, 25, 50, 100].map((size) => (
											<SelectItem key={size} value={String(size)}>
												{size}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						{/* Right side - pagination controls */}
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								className="size-8 p-0"
								disabled={(viewState.config.pagination?.page ?? 1) <= 1}
								onClick={() =>
									viewState.setPage(
										(viewState.config.pagination?.page ?? 1) - 1,
									)
								}
								aria-label={t("table.previousPage")}
							>
								<Icon icon="ph:caret-left" className="size-4" />
							</Button>

							{/* Page numbers */}
							{Array.from(
								{
									length: Math.min(5, listData?.totalPages ?? 1),
								},
								(_, i) => {
									const currentPage = viewState.config.pagination?.page ?? 1;
									const totalPages = listData?.totalPages ?? 1;
									let pageNum: number;

									if (totalPages <= 5) {
										pageNum = i + 1;
									} else if (currentPage <= 3) {
										pageNum = i + 1;
									} else if (currentPage >= totalPages - 2) {
										pageNum = totalPages - 4 + i;
									} else {
										pageNum = currentPage - 2 + i;
									}

									return (
										<Button
											key={pageNum}
											variant={currentPage === pageNum ? "secondary" : "ghost"}
											size="sm"
											className="size-8 min-w-[32px] p-0 tabular-nums"
											onClick={() => viewState.setPage(pageNum)}
											aria-label={t("table.page", { page: pageNum })}
											aria-current={
												currentPage === pageNum ? "page" : undefined
											}
										>
											{pageNum}
										</Button>
									);
								},
							)}

							<Button
								variant="ghost"
								size="sm"
								className="size-8 p-0"
								disabled={
									(viewState.config.pagination?.page ?? 1) >=
									(listData?.totalPages ?? 1)
								}
								onClick={() =>
									viewState.setPage(
										(viewState.config.pagination?.page ?? 1) + 1,
									)
								}
								aria-label={t("table.nextPage")}
							>
								<Icon icon="ph:caret-right" className="size-4" />
							</Button>
						</div>
					</div>
				)}

				{/* Search mode footer */}
				{isSearching && (
					<div
						className="text-muted-foreground flex items-center gap-2 py-2 text-sm tabular-nums"
						aria-live="polite"
						aria-atomic="true"
					>
						{isSearchActive && (
							<Icon icon="ph:spinner-gap" className="size-3 animate-spin" />
						)}
						{filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
						{searchData?.total !== undefined && (
							<span>
								({searchData.total} match{searchData.total !== 1 ? "es" : ""}{" "}
								found)
							</span>
						)}
					</div>
				)}

				{/* Filter Builder Sheet */}
				<FilterBuilderSheet
					collection={collection}
					availableFields={availableFields}
					defaultColumns={defaultColumns}
					currentConfig={viewState.config}
					onConfigChange={viewState.setConfig}
					isOpen={isSheetOpen}
					onOpenChange={setIsSheetOpen}
					groupableFields={groupableFields}
					defaultGroupBy={defaultGroupBy}
					savedViews={savedViewsData?.docs ?? []}
					savedViewsLoading={savedViewsLoading}
					onSaveView={handleSaveView}
					onDeleteView={handleDeleteView}
					supportsSoftDelete={collectionMeta?.softDelete ?? false}
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
		</AdminViewLayout>
	);
}
