import type * as React from "react";
import { cn } from "../../lib/utils";

// ============================================================================
// Toolbar
// ============================================================================

interface ToolbarProps extends React.ComponentProps<"div"> {
	/**
	 * Children elements
	 */
	children: React.ReactNode;
}

/**
 * Toolbar - Container for toolbar elements with glass effect
 *
 * @example
 * ```tsx
 * <Toolbar>
 *   <ToolbarSection className="flex-1">
 *     <SearchInput value={search} onChange={setSearch} />
 *   </ToolbarSection>
 *   <ToolbarSeparator />
 *   <ToolbarSection>
 *     <Button variant="outline" size="sm">Options</Button>
 *   </ToolbarSection>
 * </Toolbar>
 * ```
 */
export function Toolbar({
	children,
	className,
	...props
}: ToolbarProps): React.ReactElement {
	return (
		<div
			data-slot="toolbar"
			className={cn(
				"bg-card/10 backdrop-blur-sm border border-border/40",
				"p-1 flex items-center gap-2",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

// ============================================================================
// ToolbarSection
// ============================================================================

interface ToolbarSectionProps extends React.ComponentProps<"div"> {
	/**
	 * Children elements
	 */
	children: React.ReactNode;
}

/**
 * ToolbarSection - Group of related toolbar elements
 */
export function ToolbarSection({
	children,
	className,
	...props
}: ToolbarSectionProps): React.ReactElement {
	return (
		<div
			data-slot="toolbar-section"
			className={cn("flex items-center gap-1", className)}
			{...props}
		>
			{children}
		</div>
	);
}

// ============================================================================
// ToolbarSeparator
// ============================================================================

interface ToolbarSeparatorProps extends React.ComponentProps<"div"> {}

/**
 * ToolbarSeparator - Vertical separator between toolbar sections
 */
export function ToolbarSeparator({
	className,
	...props
}: ToolbarSeparatorProps): React.ReactElement {
	return (
		<div
			data-slot="toolbar-separator"
			className={cn("h-4 w-px bg-border/40", className)}
			{...props}
		/>
	);
}

// ============================================================================
// ToolbarGroup
// ============================================================================

interface ToolbarGroupProps extends React.ComponentProps<"div"> {
	/**
	 * Children elements
	 */
	children: React.ReactNode;
}

/**
 * ToolbarGroup - Tightly grouped toolbar buttons (no gap)
 */
function ToolbarGroup({
	children,
	className,
	...props
}: ToolbarGroupProps): React.ReactElement {
	return (
		<div
			data-slot="toolbar-group"
			className={cn("flex items-center", className)}
			{...props}
		>
			{children}
		</div>
	);
}
