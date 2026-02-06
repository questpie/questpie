import type * as React from "react";

import { cn } from "../../lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto scrollbar-thin"
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom text-xs border-separate border-spacing-0",
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
        "[&_tr]:border-b [&_tr]:border-border/40 bg-muted/80 sticky top-0 z-10",
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
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-card/10 backdrop-blur-sm border-t border-border/40 font-medium [&>tr]:last:border-b-0",
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
        // Alternating row colors (zebra striping) with solid backgrounds
        // Using group/row for sticky cells to match
        "group/row bg-background hover:bg-muted data-[state=selected]:bg-accent border-b border-border/30 transition-colors",
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
        "text-foreground bg-card h-10 px-2 text-left align-middle whitespace-nowrap [&:has([role=checkbox])]:px-2 font-mono text-[10px] font-black uppercase tracking-[0.1em] min-w-[100px]",
        // Sticky column styles - solid background
        isSticky && "sticky z-20 min-w-0",
        // Only show border on last sticky column
        showStickyBorder &&
          "after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-border",
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
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:px-2 min-w-[100px]",
        // Sticky column styles - inherit row background for zebra/hover/selected
        isSticky && "sticky bg-inherit z-10 min-w-0",
        // Only show border on last sticky column
        showStickyBorder &&
          "after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-border",
        className,
      )}
      style={{
        ...style,
        ...(isSticky ? { left: stickyLeft } : {}),
      }}
      {...props}
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
      className={cn("text-muted-foreground mt-4 text-xs", className)}
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

export type { TableHeadProps, TableCellProps };
