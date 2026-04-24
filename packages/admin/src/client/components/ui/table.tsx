import type * as React from "react";

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
				"qa-table__header [&_tr]:border-border/60 bg-background sticky top-0 z-10 [&_tr]:border-b",
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
			className={cn("qa-table__body [&_tr:last-child]:border-0", className)}
			{...props}
		/>
	);
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
	return (
		<tfoot
			data-slot="table-footer"
			className={cn(
				"qa-table__footer bg-background border-border/60 border-t font-medium [&>tr]:last:border-b-0",
				className,
			)}
			{...props}
		/>
	);
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
	return (
		<tr
			data-slot="table-row"
			className={cn(
				"qa-table__row group/row hover:bg-muted/40 data-[state=selected]:bg-muted border-border/60 h-9 border-b bg-transparent transition-colors",
				className,
			)}
			{...props}
		/>
	);
}

interface TableHeadProps extends React.ComponentProps<"th"> {
	/** Make this column sticky on the left. Value is the left offset in pixels. */
	stickyLeft?: number;
	/** Show separator border on the right (for last sticky column) */
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
				"qa-table__head font-chrome text-muted-foreground bg-background chrome-meta h-8 min-w-[100px] px-3 text-left align-middle text-[11px] font-medium whitespace-nowrap [&:has([role=checkbox])]:px-2",
				isSticky && "sticky z-20 min-w-0",
				// Only show border on last sticky column
				showStickyBorder &&
					"after:bg-border after:absolute after:top-0 after:right-0 after:bottom-0 after:w-px",
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
	/** Make this column sticky on the left. Value is the left offset in pixels. */
	stickyLeft?: number;
	/** Show separator border on the right (for last sticky column) */
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
				"qa-table__cell min-w-[100px] px-3 py-1.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:px-2",
				isSticky &&
					"group-hover/row:bg-muted/40 group-data-[state=selected]/row:bg-muted bg-background sticky z-10 min-w-0",
				// Only show border on last sticky column
				showStickyBorder &&
					"after:bg-border after:absolute after:top-0 after:right-0 after:bottom-0 after:w-px",
				className,
			)}
			style={{
				...style,
				...(isSticky ? { left: stickyLeft } : {}),
			}}
		>
			{props.children}
		</td>
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

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell };
