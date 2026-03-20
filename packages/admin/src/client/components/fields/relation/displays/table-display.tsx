/**
 * Table Display - table with columns
 *
 * Uses the same cell components as TableView for consistent rendering.
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import { useTranslation } from "../../../../i18n/hooks";
import { CollectionEditLink } from "../../../admin-link";
import { Button } from "../../../ui/button";
import { Skeleton } from "../../../ui/skeleton";
import {
	formatColumnHeader,
	type RelationDisplayProps,
	resolveCellForColumn,
} from "./types";

function TableSkeleton({
	count = 3,
	columns = ["_title"],
	hasActions = false,
}: {
	count?: number;
	columns?: string[];
	hasActions?: boolean;
}) {
	const skeletonKeys = React.useMemo(
		() => Array.from({ length: count }, () => crypto.randomUUID()),
		[count],
	);

	return (
		<div className="rounded-md border">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-border bg-card border-b">
						{columns.map((col) => (
							<th key={col} className="px-3 py-2 text-left font-medium">
								{formatColumnHeader(col)}
							</th>
						))}
						{hasActions && <th className="w-20 px-3 py-2" />}
					</tr>
				</thead>
				<tbody>
					{skeletonKeys.map((key) => (
						<tr key={key} className="border-b last:border-0">
							{columns.map((col) => (
								<td key={col} className="px-3 py-2">
									<Skeleton className="h-4 w-24 rounded" />
								</td>
							))}
							{hasActions && (
								<td className="px-3 py-2">
									<div className="flex items-center justify-end gap-1">
										<Skeleton className="h-7 w-7 rounded" />
									</div>
								</td>
							)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/**
 * Cell renderer that uses resolved cell components from field registry
 */
function CellRenderer({
	item,
	column,
	collectionConfig,
}: {
	item: any;
	column: string;
	collectionConfig?: RelationDisplayProps["collectionConfig"];
}) {
	const resolved = React.useMemo(
		() => resolveCellForColumn(column, collectionConfig),
		[column, collectionConfig],
	);

	const value = item[resolved.accessorKey];
	const { component: CellComponent, fieldDef, needsFieldDef } = resolved;

	if (needsFieldDef) {
		return <CellComponent value={value} row={item} fieldDef={fieldDef} />;
	}

	return <CellComponent value={value} row={item} />;
}

export function TableDisplay({
	items,
	collection,
	actions,
	editable = false,
	columns = ["_title"],
	linkToDetail = false,
	collectionConfig,
	isLoading = false,
	loadingCount = 3,
}: RelationDisplayProps) {
	const { t } = useTranslation();
	const hasActions = editable || linkToDetail || !!actions?.onEdit;

	// Show skeleton when loading and no items
	if (isLoading && items.length === 0) {
		return (
			<TableSkeleton
				count={loadingCount}
				columns={columns}
				hasActions={hasActions}
			/>
		);
	}

	return (
		<div className="rounded-md border">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-border bg-card border-b">
						{columns.map((col) => (
							<th key={col} className="px-3 py-2 text-left font-medium">
								{formatColumnHeader(col)}
							</th>
						))}
						{hasActions && <th className="w-20 px-3 py-2" />}
					</tr>
				</thead>
				<tbody>
					{items.map((item) => (
						<tr key={item.id} className="border-b last:border-0">
							{columns.map((col) => (
								<td key={col} className="px-3 py-2">
									<CellRenderer
										item={item}
										column={col}
										collectionConfig={collectionConfig}
									/>
								</td>
							))}
							{hasActions && (
								<td className="px-3 py-2">
									<div className="flex items-center justify-end gap-1">
										{/* Edit button */}
										{actions?.onEdit && (
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-7 w-7"
												onClick={() => actions.onEdit?.(item)}
												aria-label={t("field.editItem")}
											>
												<Icon icon="ph:pencil" className="size-4" />
											</Button>
										)}

										{/* Remove button (editable mode) */}
										{editable && actions?.onRemove && (
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-7 w-7"
												onClick={() => actions.onRemove?.(item)}
												aria-label={t("field.removeItem")}
											>
												<Icon icon="ph:x" className="size-4" />
											</Button>
										)}

										{/* Link to detail (non-editable mode) */}
										{!editable && linkToDetail && !actions?.onEdit && (
											<CollectionEditLink
												collection={collection as any}
												id={item.id}
												className="text-primary hover:underline"
											>
												<Icon icon="ph:arrow-right" className="size-4" />
											</CollectionEditLink>
										)}
									</div>
								</td>
							)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
