/**
 * Table Widget
 *
 * Displays a mini table with collection data.
 * Automatically uses field definitions from collection config for:
 * - Column labels (from field.label)
 * - Cell rendering (from field.cell)
 *
 * Columns can be simple field keys or objects with overrides.
 */

import type * as React from "react";
import type { FieldInstance } from "../../builder/field/field";
import type {
	TableWidgetColumn,
	TableWidgetColumnConfig,
	TableWidgetConfig,
} from "../../builder/types/widget-types";
import { useCollectionList } from "../../hooks/use-collection";
import { useResolveText } from "../../i18n/hooks";
import type { I18nText } from "../../i18n/types";
import { cn, formatLabel } from "../../lib/utils";
import { DefaultCell } from "../../views/collection/cells/primitive-cells";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { TableWidgetSkeleton } from "./widget-skeletons";

/**
 * Table widget props
 */
interface TableWidgetProps {
	config: TableWidgetConfig;
	/** Base path for navigation */
	basePath?: string;
	/** Navigate function for row clicks */
	navigate?: (path: string) => void;
}

/**
 * Field types that need fieldDef passed to their cell component
 */
const FIELD_TYPES_NEEDING_FIELD_DEF = new Set([
	"object",
	"array",
	"relation",
	"reverseRelation",
]);

/**
 * Normalize column config - converts string to object format
 */
function normalizeColumn(column: TableWidgetColumn): TableWidgetColumnConfig {
	if (typeof column === "string") {
		return { key: column };
	}
	return column;
}

/**
 * Get column label from field definition or column config
 */
function getColumnLabel(
	column: TableWidgetColumnConfig,
	fieldDef: FieldInstance | undefined,
): I18nText | string {
	// Use override if provided
	if (column.label) {
		return column.label;
	}
	// Use field label if available
	const fieldOptions = fieldDef?.["~options"] as
		| { label?: I18nText }
		| undefined;
	if (fieldOptions?.label) {
		return fieldOptions.label;
	}
	// Fallback to formatted key
	return formatLabel(column.key);
}

/**
 * Resolve cell component from field definition
 */
function resolveCellComponent(
	fieldDef: FieldInstance | undefined,
): React.ComponentType<{
	value: unknown;
	row?: unknown;
	fieldDef?: FieldInstance;
}> {
	if (fieldDef?.cell) {
		return fieldDef.cell as React.ComponentType<{
			value: unknown;
			row?: unknown;
			fieldDef?: FieldInstance;
		}>;
	}
	return DefaultCell;
}

/**
 * Renders a single table cell value using field definitions or custom renderers
 */
function TableCellRenderer({
	item,
	column,
	fields,
}: {
	item: any;
	column: TableWidgetColumnConfig;
	fields: Record<string, FieldInstance> | undefined;
}): React.ReactNode {
	const value = item[column.key];

	// Use custom renderer if provided in column config
	if (column.render) {
		return column.render(value, item);
	}

	// Get field definition and resolve cell component
	const fieldDef = fields?.[column.key];
	const CellComponent = resolveCellComponent(fieldDef);
	const fieldType = fieldDef?.name ?? "text";
	const needsFieldDef = FIELD_TYPES_NEEDING_FIELD_DEF.has(fieldType);

	return needsFieldDef ? (
		<CellComponent value={value} row={item} fieldDef={fieldDef} />
	) : (
		<CellComponent value={value} row={item} />
	);
}

/**
 * Table Widget Component
 *
 * Displays a mini table of collection items.
 * Uses field definitions from admin config for labels and cell rendering.
 */
export default function TableWidget({
	config,
	basePath = "/admin",
	navigate,
}: TableWidgetProps) {
	const resolveText = useResolveText();

	const {
		collection,
		columns: rawColumns,
		limit = 5,
		sortBy,
		sortOrder = "desc",
		filter,
		linkToDetail,
		emptyMessage,
		realtime,
	} = config;

	// Normalize columns (convert strings to objects)
	const columns = rawColumns.map(normalizeColumn);

	// Field definitions are not available from server config (schema-driven)
	const fields = undefined as Record<string, FieldInstance> | undefined;

	// Build query options
	const queryOptions: any = { limit };
	if (sortBy) {
		queryOptions.orderBy = { [sortBy]: sortOrder };
	}
	if (filter) {
		queryOptions.where = filter;
	}

	// Fetch collection data
	const { data, isLoading, error, refetch } = useCollectionList(
		collection as any,
		queryOptions,
		undefined,
		{ realtime },
	);

	const items = Array.isArray(data?.docs) ? data.docs : [];
	const title = config.title ? resolveText(config.title) : undefined;

	// Handle row click
	const handleRowClick = (item: any) => {
		if (linkToDetail && navigate) {
			navigate(`${basePath}/collections/${collection}/${item.id}`);
		}
	};

	// Empty state
	const emptyContent = (
		<div className="flex h-24 items-center justify-center text-muted-foreground">
			<p className="text-sm">
				{emptyMessage ? resolveText(emptyMessage) : "No data available"}
			</p>
		</div>
	);

	// Table content
	const tableContent =
		items.length === 0 ? (
			emptyContent
		) : (
			<div className="-mx-5 -mb-1">
				{/* Header */}
				<div className="flex items-center gap-2 px-5 py-2 border-b border-border text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-muted ">
					{columns.map((column) => {
						const fieldDef = fields?.[column.key];
						const label = getColumnLabel(column, fieldDef);

						return (
							<div
								key={column.key}
								className={cn(
									"flex-1 min-w-0",
									column.align === "center" && "text-center",
									column.align === "right" && "text-right",
								)}
								style={
									column.width
										? { width: column.width, flex: "none" }
										: undefined
								}
							>
								{resolveText(label)}
							</div>
						);
					})}
				</div>
				{/* Rows */}
				{items.map((item: any) =>
					linkToDetail ? (
						<button
							key={item.id}
							type="button"
							className="flex w-full items-center gap-2 px-5 py-2.5 border-b border-border last:border-0 transition-all cursor-pointer hover:bg-muted text-left"
							onClick={() => handleRowClick(item)}
						>
							{columns.map((column) => (
								<div
									key={column.key}
									className={cn(
										"flex-1 min-w-0 text-sm truncate",
										column.align === "center" && "text-center",
										column.align === "right" && "text-right",
									)}
									style={
										column.width
											? { width: column.width, flex: "none" }
											: undefined
									}
								>
									<TableCellRenderer
										item={item}
										column={column}
										fields={fields}
									/>
								</div>
							))}
						</button>
					) : (
						<div
							key={item.id}
							className="flex items-center gap-2 px-5 py-2.5 border-b border-border last:border-0"
						>
							{columns.map((column) => (
								<div
									key={column.key}
									className={cn(
										"flex-1 min-w-0 text-sm truncate",
										column.align === "center" && "text-center",
										column.align === "right" && "text-right",
									)}
									style={
										column.width
											? { width: column.width, flex: "none" }
											: undefined
									}
								>
									<TableCellRenderer
										item={item}
										column={column}
										fields={fields}
									/>
								</div>
							))}
						</div>
					),
				)}
			</div>
		);

	return (
		<WidgetCard
			title={title}
			isLoading={isLoading}
			className="qa-table-widget"
			loadingSkeleton={
				<TableWidgetSkeleton rows={limit} columns={columns.length} />
			}
			error={
				error instanceof Error ? error : error ? new Error(String(error)) : null
			}
			onRefresh={() => refetch()}
		>
			{tableContent}
		</WidgetCard>
	);
}
