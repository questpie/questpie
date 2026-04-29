/**
 * Shared utilities for block renderers
 *
 * Common class mappings and helpers used across multiple blocks.
 */

// ============================================================================
// Grid Column Classes
// ============================================================================

const columnsClasses = {
	"2": "md:grid-cols-2",
	"3": "md:grid-cols-2 lg:grid-cols-3",
	"4": "md:grid-cols-2 lg:grid-cols-4",
} as const;

export function getColumnsClass(columns?: string | null): string {
	return (
		columnsClasses[(columns || "3") as keyof typeof columnsClasses] ??
		columnsClasses["3"]
	);
}

// ============================================================================
// Gap Classes
// ============================================================================

const gapClasses = {
	small: "gap-4",
	medium: "gap-6 md:gap-8",
	large: "gap-8 md:gap-12",
} as const;

export function getGapClass(gap?: string | null): string {
	return (
		gapClasses[(gap || "medium") as keyof typeof gapClasses] ??
		gapClasses.medium
	);
}

// ============================================================================
// Padding Classes
// ============================================================================

const paddingClasses = {
	none: "py-0",
	small: "py-8",
	medium: "py-16",
	large: "py-24",
} as const;

export function getPaddingClass(padding?: string | null): string {
	return (
		paddingClasses[(padding || "medium") as keyof typeof paddingClasses] ??
		paddingClasses.medium
	);
}

// ============================================================================
// Size Classes (for spacers, CTAs, etc.)
// ============================================================================

const sizeClasses = {
	small: "py-12",
	medium: "py-20",
	large: "py-28",
} as const;

function getSizeClass(size?: string | null): string {
	return (
		sizeClasses[(size || "medium") as keyof typeof sizeClasses] ??
		sizeClasses.medium
	);
}

// ============================================================================
// Spacer Size Classes
// ============================================================================

const spacerSizeClasses = {
	small: "h-8 md:h-12",
	medium: "h-12 md:h-20",
	large: "h-20 md:h-32",
	xlarge: "h-32 md:h-48",
} as const;

export function getSpacerSizeClass(size?: string | null): string {
	return (
		spacerSizeClasses[(size || "medium") as keyof typeof spacerSizeClasses] ??
		spacerSizeClasses.medium
	);
}

// ============================================================================
// Image Aspect Ratio Classes
// ============================================================================

const aspectClasses = {
	square: "aspect-square",
	portrait: "aspect-[3/4]",
	landscape: "aspect-[4/3]",
} as const;

function getAspectClass(aspect?: string | null): string {
	return (
		aspectClasses[(aspect || "square") as keyof typeof aspectClasses] ??
		aspectClasses.square
	);
}

// ============================================================================
// Text Alignment Classes
// ============================================================================

const alignClasses = {
	left: "text-left",
	center: "text-center",
	right: "text-right",
} as const;

function getAlignClass(align?: string | null): string {
	return (
		alignClasses[(align || "left") as keyof typeof alignClasses] ??
		alignClasses.left
	);
}

// ============================================================================
// Max Width Classes
// ============================================================================

const maxWidthClasses = {
	narrow: "max-w-xl",
	medium: "max-w-2xl",
	wide: "max-w-4xl",
	full: "max-w-none",
} as const;

function getMaxWidthClass(maxWidth?: string | null): string {
	return (
		maxWidthClasses[(maxWidth || "medium") as keyof typeof maxWidthClasses] ??
		maxWidthClasses.medium
	);
}

// ============================================================================
// Rich Text Styles (common configuration)
// ============================================================================

const defaultRichTextStyles = {
	doc: "max-w-none",
	paragraph: "text-muted-foreground leading-relaxed mb-4 last:mb-0",
	link: "text-highlight no-underline hover:underline",
	strong: "text-foreground font-semibold",
	blockquote: "border-l-highlight text-muted-foreground",
} as const;

// ============================================================================
// Price Formatter
// ============================================================================

function formatPrice(cents: number, currency = "EUR"): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
	}).format(cents / 100);
}

// ============================================================================
// Rating Stars Helper
// ============================================================================

function getRatingStars(rating: string | number): number {
	const parsed =
		typeof rating === "string" ? Number.parseInt(rating, 10) : rating;
	return Math.min(5, Math.max(0, parsed || 0));
}
