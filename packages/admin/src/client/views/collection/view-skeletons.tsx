/**
 * View Skeletons
 *
 * Loading skeletons for collection views (table, form).
 * Used with Suspense boundaries to show loading state.
 */

import { Skeleton } from "../../components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../components/ui/table";
import { AdminViewHeader, AdminViewLayout } from "../layout/admin-view-layout";

const TABLE_SKELETON_COLUMNS = [
	{ width: 40, header: "mx-auto h-4 w-4", cells: ["mx-auto h-4 w-4"] },
	{
		width: 360,
		header: "h-4 w-28",
		cells: ["h-4 w-52", "h-4 w-44", "h-4 w-56", "h-4 w-40"],
	},
	{
		width: 160,
		header: "h-4 w-20",
		cells: ["h-4 w-24", "h-4 w-20", "h-4 w-28", "h-4 w-16"],
	},
	{
		width: 140,
		header: "h-4 w-24",
		cells: ["h-4 w-20", "h-4 w-24", "h-4 w-16", "h-4 w-28"],
	},
	{
		width: 96,
		header: "ml-auto h-4 w-16",
		cells: ["ml-auto h-4 w-14", "ml-auto h-4 w-16", "ml-auto h-4 w-12"],
	},
] as const;

function getColumnSizeStyle(width: number) {
	return { width, minWidth: width, maxWidth: width };
}

function getSkeletonWidth(widths: readonly string[], rowIndex: number): string {
	return widths[rowIndex % widths.length] ?? widths[0] ?? "h-4 w-20";
}

function TableSkeletonRows({ rows = 8 }: { rows?: number }) {
	return (
		<>
			{Array.from({ length: rows }, (_, rowIndex) => (
				<TableRow key={rowIndex} className="hover:bg-transparent">
					{TABLE_SKELETON_COLUMNS.map((column, columnIndex) => {
						const stickyLeft =
							columnIndex === 0 ? 0 : columnIndex === 1 ? 40 : undefined;

						return (
							<TableCell
								key={columnIndex}
								stickyLeft={stickyLeft}
								showStickyBorder={columnIndex === 1}
								className={columnIndex === 0 ? "w-9 min-w-9 px-1.5" : ""}
								style={getColumnSizeStyle(column.width)}
							>
								<Skeleton
									variant="text"
									className={getSkeletonWidth(column.cells, rowIndex)}
								/>
							</TableCell>
						);
					})}
				</TableRow>
			))}
		</>
	);
}

function TableSkeletonShell() {
	const width = TABLE_SKELETON_COLUMNS.reduce(
		(total, column) => total + column.width,
		0,
	);

	return (
		<Table className="table-fixed" style={{ width }}>
			<colgroup>
				{TABLE_SKELETON_COLUMNS.map((column, index) => (
					<col key={index} style={{ width: column.width }} />
				))}
			</colgroup>
			<TableHeader>
				<TableRow className="hover:bg-transparent">
					{TABLE_SKELETON_COLUMNS.map((column, index) => {
						const stickyLeft = index === 0 ? 0 : index === 1 ? 40 : undefined;

						return (
							<TableHead
								key={index}
								stickyLeft={stickyLeft}
								showStickyBorder={index === 1}
								className={index === 0 ? "w-9 min-w-9 px-1.5" : ""}
								style={getColumnSizeStyle(column.width)}
							>
								<Skeleton variant="text" className={column.header} />
							</TableHead>
						);
					})}
				</TableRow>
			</TableHeader>
			<TableBody>
				<TableSkeletonRows />
			</TableBody>
		</Table>
	);
}

function FormFieldSkeleton() {
	return (
		<div className="space-y-2">
			<Skeleton variant="text" className="h-4 w-24" />
			<Skeleton className="h-10 w-full" />
		</div>
	);
}

/**
 * Skeleton for TableView
 *
 * Shows a loading state that mimics the table layout.
 */
export function TableViewSkeleton() {
	return (
		<AdminViewLayout
			header={
				<AdminViewHeader
					title={<Skeleton variant="text" className="h-7 w-44" />}
					description={
						<Skeleton variant="text" className="h-4 w-64 max-w-full" />
					}
					actions={
						<>
							<Skeleton className="size-8" />
							<Skeleton className="size-8" />
							<Skeleton className="h-8 w-24" />
						</>
					}
				/>
			}
			contentClassName="overflow-y-auto pb-3"
		>
			<div
				className="qa-table-view qa-table-view-skeleton min-w-0 space-y-4"
				aria-busy="true"
			>
				<span className="sr-only">Loading table view</span>
				<div className="qa-table-view__table-wrapper min-w-0">
					<TableSkeletonShell />
				</div>
				<div className="qa-table-view__pagination flex items-center justify-between gap-4 py-2">
					<div className="flex items-center gap-4">
						<Skeleton variant="text" className="h-4 w-20" />
						<div className="flex items-center gap-2">
							<Skeleton variant="text" className="h-4 w-10" />
							<Skeleton className="h-8 w-[70px]" />
						</div>
					</div>
					<div className="flex items-center gap-1">
						<Skeleton className="size-8" />
						<Skeleton className="size-8" />
						<Skeleton className="size-8" />
						<Skeleton className="size-8" />
					</div>
				</div>
			</div>
		</AdminViewLayout>
	);
}

/**
 * Skeleton for FormView
 *
 * Shows a loading state that mimics the form layout.
 */
export function FormViewSkeleton() {
	return (
		<div className="qa-form-view-skeleton container max-w-4xl py-6">
			<div className="space-y-6">
				{/* Header */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<Skeleton variant="text" className="h-8 w-8" /> {/* Back button */}
						<Skeleton variant="text" className="h-8 w-48" />
					</div>
					<div className="flex items-center gap-2">
						<Skeleton className="h-9 w-20" />
						<Skeleton className="h-9 w-24" />
					</div>
				</div>

				{/* Form fields */}
				<div className="space-y-6">
					<FormFieldSkeleton />
					<FormFieldSkeleton />
					<FormFieldSkeleton />
					<FormFieldSkeleton />

					{/* Textarea field */}
					<div className="space-y-2">
						<Skeleton variant="text" className="h-4 w-32" />
						<Skeleton className="h-32 w-full" />
					</div>
				</div>
			</div>
		</div>
	);
}
