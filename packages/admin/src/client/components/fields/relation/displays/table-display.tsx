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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../ui/table";
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
		<div className="panel-surface min-w-0 overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						{columns.map((col) => (
							<TableHead key={col}>{formatColumnHeader(col)}</TableHead>
						))}
						{hasActions && <TableHead className="w-20" />}
					</TableRow>
				</TableHeader>
				<TableBody>
					{skeletonKeys.map((key) => (
						<TableRow key={key}>
							{columns.map((col) => (
								<TableCell key={col}>
									<Skeleton variant="text" className="h-4 w-24" />
								</TableCell>
							))}
							{hasActions && (
								<TableCell>
									<div className="flex items-center justify-end gap-1">
										<Skeleton variant="text" className="h-6 w-6" />
									</div>
								</TableCell>
							)}
						</TableRow>
					))}
				</TableBody>
			</Table>
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
		<div className="panel-surface min-w-0 overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						{columns.map((col) => (
							<TableHead key={col}>{formatColumnHeader(col)}</TableHead>
						))}
						{hasActions && <TableHead className="w-20" />}
					</TableRow>
				</TableHeader>
				<TableBody>
					{items.map((item) => (
						<TableRow key={item.id}>
							{columns.map((col) => (
								<TableCell key={col}>
									<CellRenderer
										item={item}
										column={col}
										collectionConfig={collectionConfig}
									/>
								</TableCell>
							))}
							{hasActions && (
								<TableCell>
									<div className="flex items-center justify-end gap-1">
										{/* Edit button */}
										{actions?.onEdit && (
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
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
												size="icon-xs"
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
												className="item-surface text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground inline-flex min-h-10 min-w-10 items-center justify-center active:scale-[0.96]"
											>
												<Icon icon="ph:arrow-right" className="size-4" />
											</CollectionEditLink>
										)}
									</div>
								</TableCell>
							)}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
