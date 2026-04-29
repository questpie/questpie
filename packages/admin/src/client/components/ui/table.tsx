import * as React from "react";

import { cn } from "../../lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
	return (
		<div
			data-slot="table-container"
			className="qa-table-container scrollbar-thin relative w-full min-w-0 overflow-x-auto"
		>
			<table
				data-slot="table"
				className={cn(
					"qa-table w-full caption-bottom border-separate border-spacing-0 text-sm",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
	return (
		<thead
			data-slot="table-header"
			className={cn(
				"qa-table__header bg-background sticky top-0 z-10",
				className,
			)}
			{...props}
		/>
	);
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
	return (
		<tbody
			data-slot="table-body"
			className={cn("qa-table__body", className)}
			{...props}
		/>
	);
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
	return (
		<tfoot
			data-slot="table-footer"
			className={cn("qa-table__footer bg-background font-medium", className)}
			{...props}
		/>
	);
}

const TableRow = React.forwardRef<
	HTMLTableRowElement,
	React.ComponentProps<"tr">
>(({ className, ...props }, ref) => (
	<tr
		ref={ref}
		data-slot="table-row"
		className={cn(
			"qa-table__row group/row hover:bg-accent data-[state=selected]:bg-muted h-10 bg-transparent transition-colors",
			className,
		)}
		{...props}
	/>
));
TableRow.displayName = "TableRow";

interface TableHeadProps extends React.ComponentProps<"th"> {
	stickyLeft?: number;
	showStickyBorder?: boolean;
}

function TableHead({
	className,
	stickyLeft,
	showStickyBorder,
	style,
	...props
}: TableHeadProps) {
	const isSticky = stickyLeft !== undefined;
	return (
		<th
			data-slot="table-head"
			data-sticky-left={isSticky ? "" : undefined}
			className={cn(
				"qa-table__head font-chrome text-muted-foreground bg-background chrome-meta h-9 min-w-[100px] overflow-hidden px-3 text-left align-middle text-[11px] font-medium text-ellipsis whitespace-nowrap [&:has([role=checkbox])]:px-2",
				isSticky && "sticky z-20 min-w-0",
				showStickyBorder &&
					"after:bg-border-subtle after:absolute after:top-0 after:right-0 after:bottom-0 after:w-px",
				showStickyBorder && !isSticky && "relative",
				className,
			)}
			style={{
				...style,
				...(isSticky ? { left: stickyLeft } : {}),
			}}
			{...props}
		/>
	);
}

interface TableCellProps extends React.ComponentProps<"td"> {
	stickyLeft?: number;
	showStickyBorder?: boolean;
}

function TableCell({
	className,
	stickyLeft,
	showStickyBorder,
	style,
	...props
}: TableCellProps) {
	const isSticky = stickyLeft !== undefined;
	return (
		<td
			data-slot="table-cell"
			data-sticky-left={isSticky ? "" : undefined}
			className={cn(
				"qa-table__cell min-w-[100px] overflow-hidden px-3 py-2 align-middle text-ellipsis whitespace-nowrap tabular-nums transition-colors [&:has([role=checkbox])]:px-2",
				isSticky &&
					"group-data-[state=selected]/row:bg-muted group-hover/row:bg-accent bg-background sticky z-10 min-w-0",
				showStickyBorder &&
					"after:bg-border-subtle after:absolute after:top-0 after:right-0 after:bottom-0 after:w-px",
				showStickyBorder && !isSticky && "relative",
				className,
			)}
			style={{
				...style,
				...(isSticky ? { left: stickyLeft } : {}),
			}}
			{...props}
		/>
	);
}

function TableCaption({
	className,
	...props
}: React.ComponentProps<"caption">) {
	return (
		<caption
			data-slot="table-caption"
			className={cn(
				"qa-table__caption text-muted-foreground mt-4 text-xs",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Table,
	TableHeader,
	TableBody,
	TableFooter,
	TableHead,
	TableRow,
	TableCell,
	TableCaption,
};
