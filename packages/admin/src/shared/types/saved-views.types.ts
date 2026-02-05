/**
 * Saved Views Types
 *
 * Shared types used by both server and client code.
 * This file must NOT import any server-only dependencies like drizzle-orm.
 */

/**
 * Filter operator types supported by the saved views filter builder
 */
export type FilterOperator =
	| "equals"
	| "not_equals"
	| "contains"
	| "not_contains"
	| "starts_with"
	| "ends_with"
	| "greater_than"
	| "less_than"
	| "greater_than_or_equal"
	| "less_than_or_equal"
	| "in"
	| "not_in"
	| "some"
	| "every"
	| "none"
	| "is_empty"
	| "is_not_empty";

/**
 * Filter value type
 */
export type FilterValue =
	| string
	| number
	| boolean
	| Array<string | number | boolean>
	| null;

/**
 * A single filter rule configuration
 */
export interface FilterRule {
	id: string;
	field: string;
	operator: FilterOperator;
	value: FilterValue;
}

/**
 * Sort configuration for a view
 */
export interface SortConfig {
	field: string;
	direction: "asc" | "desc";
}

/**
 * Complete view configuration stored in the database
 */
export interface ViewConfiguration {
	filters: FilterRule[];
	sortConfig: SortConfig | null;
	visibleColumns: string[];
	realtime?: boolean;
}
