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

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import * as React from "react";

import type { ColumnConfig } from "../../builder/types/collection-types";
import type {
	TableWidgetColumn,
	TableWidgetColumnConfig,
	TableWidgetConfig,
} from "../../builder/types/widget-types";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../components/ui/table";
import { useCollectionList } from "../../hooks/use-collection";
import { useCollectionFields } from "../../hooks/use-collection-fields";
import { useCollectionMeta } from "../../hooks/use-collection-meta";
import { useServerWidgetData } from "../../hooks/use-server-widget-data";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn, formatLabel } from "../../lib/utils";
import {
	autoExpandFields,
	hasFieldsToExpand,
} from "../../utils/auto-expand-fields";
import { buildColumns } from "../../views/collection/columns";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { WidgetEmptyState } from "./widget-empty-state";
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

function normalizeWidgetColumn(
	column: TableWidgetColumn,
): TableWidgetColumnConfig {
	return typeof column === "string" ? { key: column } : column;
}

function toListColumnConfig(column: TableWidgetColumn): ColumnConfig<string> {
	const normalized = normalizeWidgetColumn(column);
	const CustomCell = normalized.render
		? function TableWidgetCustomCell({
				value,
				row,
			}: {
				value: unknown;
				row?: unknown;
			}) {
				return normalized.render?.(value, (row as any)?.original ?? row);
			}
		: undefined;

	return {
		field: normalized.key,
		header: normalized.label as any,
		width: normalized.width,
		align: normalized.align,
		cell: CustomCell as any,
	};
}

function getColumnSizeStyle(column: unknown): React.CSSProperties {
	const size =
		typeof (column as any)?.getSize === "function"
			? (column as any).getSize()
			: 120;

	return { width: size, minWidth: size, maxWidth: size };
}

function getAlignClass(align: unknown): string | undefined {
	if (align === "center") return "text-center";
	if (align === "right") return "text-right";
	return undefined;
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
	const { t } = useTranslation();

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
	const useServerData = !!config.hasLoader;
	const serverQuery = useServerWidgetData<any>(config.id, {
		enabled: useServerData,
		refreshInterval: config.refreshInterval,
	});

	const listColumns = React.useMemo(
		() => rawColumns.map(toListColumnConfig),
		[rawColumns],
	);
	const listConfig = React.useMemo(
		() => ({ columns: listColumns }),
		[listColumns],
	);
	const {
		fields,
		isLoading: fieldsLoading,
		error: fieldsError,
	} = useCollectionFields(collection, {
		schemaQueryOptions: { enabled: !!collection },
	});
	const {
		data: collectionMeta,
		isLoading: metaLoading,
		error: metaError,
	} = useCollectionMeta(collection as any, { enabled: !!collection });

	const expandedFields = React.useMemo(
		() =>
			autoExpandFields({
				fields,
				list: listConfig,
				relations: collectionMeta?.relations,
			}),
		[fields, listConfig, collectionMeta?.relations],
	);

	// Build query options
	const queryOptions: any = { limit };
	if (sortBy) {
		queryOptions.orderBy = { [sortBy]: sortOrder };
	}
	if (filter) {
		queryOptions.where = filter;
	}
	if (hasFieldsToExpand(expandedFields)) {
		queryOptions.with = expandedFields;
	}

	// Fetch collection data
	const collectionQuery = useCollectionList(
		collection as any,
		queryOptions,
		{ enabled: !useServerData },
		{ realtime },
	);
	const { data, isLoading, error, refetch, isFetching } = useServerData
		? serverQuery
		: collectionQuery;

	const items = Array.isArray(data)
		? data
		: Array.isArray(data?.docs)
			? data.docs
			: [];
	const title = config.title ? resolveText(config.title) : undefined;
	const tableColumns = React.useMemo<ColumnDef<any>[]>(
		() =>
			buildColumns({
				config: {
					fields,
					list: listConfig as any,
				},
				fallbackColumns: listColumns.map((column) =>
					typeof column === "string" ? column : column.field,
				),
				meta: collectionMeta as any,
			}) as ColumnDef<any>[],
		[fields, listConfig, listColumns, collectionMeta],
	);
	const table = useReactTable({
		data: items,
		columns: tableColumns,
		getCoreRowModel: getCoreRowModel(),
		getRowId: (row: any, index) => String(row.id ?? row._id ?? index),
	});
	const visibleColumns = table.getVisibleLeafColumns();
	const rows = table.getRowModel().rows;
	const isSchemaLoading =
		(fieldsLoading && !fieldsError) || (metaLoading && !metaError);
	const isWidgetLoading = isLoading || isSchemaLoading;

	// Handle row click
	const handleRowClick = (item: any) => {
		if (linkToDetail && navigate) {
			navigate(`${basePath}/collections/${collection}/${item.id}`);
		}
	};

	const resolvedEmptyMessage = emptyMessage
		? resolveText(emptyMessage)
		: undefined;

	// Empty state
	const emptyContent = (
		<WidgetEmptyState
			iconName="ph:table"
			title={resolvedEmptyMessage ?? t("widget.table.emptyTitle")}
			description={
				resolvedEmptyMessage ? undefined : t("widget.table.emptyDescription")
			}
			className="min-h-32"
		/>
	);

	// Table content
	const tableContent =
		items.length === 0 ? (
			emptyContent
		) : (
			<div className="qa-table-widget__table -mx-4 -mb-4 min-h-0 min-w-0">
				<Table
					aria-label={title ?? `${formatLabel(collection)} table`}
					className="min-w-full table-fixed"
					style={{ minWidth: table.getTotalSize() }}
				>
					<colgroup>
						{visibleColumns.map((column) => (
							<col key={column.id} style={{ width: column.getSize() }} />
						))}
					</colgroup>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id} className="hover:bg-transparent">
								{headerGroup.headers.map((header) => {
									const meta = header.column.columnDef.meta as
										| { align?: string }
										| undefined;

									return (
										<TableHead
											key={header.id}
											className={getAlignClass(meta?.align)}
											style={getColumnSizeStyle(header.column)}
										>
											{header.isPlaceholder
												? null
												: flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
										</TableHead>
									);
								})}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{rows.map((row) => {
							const canNavigate =
								!!linkToDetail && !!navigate && !!row.original?.id;

							return (
								<TableRow
									key={row.id}
									role={canNavigate ? "link" : undefined}
									tabIndex={canNavigate ? 0 : undefined}
									className={cn(canNavigate && "cursor-pointer")}
									onClick={
										canNavigate ? () => handleRowClick(row.original) : undefined
									}
									onKeyDown={
										canNavigate
											? (event) => {
													if (event.key === "Enter" || event.key === " ") {
														event.preventDefault();
														handleRowClick(row.original);
													}
												}
											: undefined
									}
								>
									{row.getVisibleCells().map((cell) => {
										const meta = cell.column.columnDef.meta as
											| { align?: string; className?: string }
											| undefined;

										return (
											<TableCell
												key={cell.id}
												className={cn(
													getAlignClass(meta?.align),
													meta?.className,
												)}
												style={getColumnSizeStyle(cell.column)}
											>
												{flexRender(
													cell.column.columnDef.cell,
													cell.getContext(),
												)}
											</TableCell>
										);
									})}
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
		);

	return (
		<WidgetCard
			title={title}
			description={
				config.description ? resolveText(config.description) : undefined
			}
			variant={config.cardVariant}
			isLoading={isWidgetLoading}
			isRefreshing={isFetching && !isWidgetLoading}
			className={cn("qa-table-widget", config.className)}
			loadingSkeleton={
				<TableWidgetSkeleton rows={limit} columns={rawColumns.length} />
			}
			error={
				error instanceof Error ? error : error ? new Error(String(error)) : null
			}
			onRefresh={() => refetch()}
			actions={config.actions}
		>
			{tableContent}
		</WidgetCard>
	);
}
