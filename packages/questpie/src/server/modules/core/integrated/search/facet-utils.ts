import type {
	FacetFieldConfig,
	FacetIndexValue,
	FacetsConfig,
} from "./types.js";

function toFacetString(value: unknown): string | null {
	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return null;
}

function matchRangeBucket(
	value: number,
	config: Extract<FacetFieldConfig, { type: "range" }>,
): string | null {
	for (const bucket of config.buckets) {
		const minOk = bucket.min == null || value >= bucket.min;
		const maxOk = bucket.max == null || value < bucket.max;

		if (minOk && maxOk) {
			return bucket.label;
		}
	}

	return null;
}

function extractHierarchyValues(value: string, separator: string): string[] {
	const parts = value
		.split(separator)
		.map((part) => part.trim())
		.filter(Boolean);

	const result: string[] = [];
	let current = "";

	for (const part of parts) {
		current = current ? `${current}${separator}${part}` : part;
		result.push(current);
	}

	return result;
}

export function extractFacetValues(
	metadata: Record<string, unknown> | null | undefined,
	config: FacetsConfig | null | undefined,
): FacetIndexValue[] {
	if (!metadata || !config) {
		return [];
	}

	const facets: FacetIndexValue[] = [];

	for (const [fieldName, fieldConfig] of Object.entries(config)) {
		const value = metadata[fieldName];
		if (value == null) {
			continue;
		}

		if (fieldConfig === true) {
			const facetValue = toFacetString(value);
			if (facetValue != null) {
				facets.push({ name: fieldName, value: facetValue });
			}
			continue;
		}

		if (fieldConfig.type === "array") {
			if (!Array.isArray(value)) {
				continue;
			}

			for (const item of value) {
				const facetValue = toFacetString(item);
				if (facetValue != null) {
					facets.push({ name: fieldName, value: facetValue });
				}
			}
			continue;
		}

		if (fieldConfig.type === "range") {
			const numericValue =
				typeof value === "number" ? value : Number.parseFloat(String(value));
			if (Number.isNaN(numericValue)) {
				continue;
			}

			const bucketLabel = matchRangeBucket(numericValue, fieldConfig);
			if (bucketLabel != null) {
				facets.push({
					name: fieldName,
					value: bucketLabel,
					numericValue,
				});
			}
			continue;
		}

		if (fieldConfig.type === "hierarchy") {
			if (typeof value !== "string") {
				continue;
			}

			const separator = fieldConfig.separator ?? " > ";
			for (const hierarchyValue of extractHierarchyValues(value, separator)) {
				facets.push({ name: fieldName, value: hierarchyValue });
			}
		}
	}

	return facets;
}
