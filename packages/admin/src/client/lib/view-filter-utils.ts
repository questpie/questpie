import type {
	FilterRule,
	SortConfig,
} from "../../shared/types/saved-views.types.js";

export function filterValueEqual(
	a: FilterRule["value"],
	b: FilterRule["value"],
): boolean {
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		return a.every((value, index) => value === b[index]);
	}

	return a === b;
}

export function filtersEqual(
	a: FilterRule[] = [],
	b: FilterRule[] = [],
): boolean {
	if (a.length !== b.length) return false;
	return a.every((filter, index) => {
		const other = b[index];
		return (
			filter.id === other.id &&
			filter.field === other.field &&
			filter.operator === other.operator &&
			filterValueEqual(filter.value, other.value)
		);
	});
}

export function cloneFilters(filters: FilterRule[]): FilterRule[] {
	return filters.map((filter) => ({
		...filter,
		value: Array.isArray(filter.value) ? [...filter.value] : filter.value,
	}));
}

export function sortConfigEqual(
	a: SortConfig | null,
	b: SortConfig | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.field === b.field && a.direction === b.direction;
}
