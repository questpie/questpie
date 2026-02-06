/**
 * Facet Utilities
 *
 * Functions for extracting facet values from records based on facet configuration.
 * Used by adapters to transform metadata into indexable facet values.
 */

import type {
  FacetFieldConfig,
  FacetIndexValue,
  FacetsConfig,
} from "./types.js";

/**
 * Extract facet values from metadata based on facets configuration
 *
 * @param metadata - Record metadata containing facetable fields
 * @param facetsConfig - Facet field configurations from .searchable()
 * @returns Array of facet values to index
 *
 * @example
 * ```ts
 * const metadata = {
 *   status: "published",
 *   tags: ["react", "typescript"],
 *   price: 75,
 *   category: "Electronics > Phones > iPhone",
 * };
 *
 * const facetsConfig = {
 *   status: true,
 *   tags: { type: "array" },
 *   price: {
 *     type: "range",
 *     buckets: [
 *       { label: "Under $50", max: 50 },
 *       { label: "$50-$100", min: 50, max: 100 },
 *       { label: "$100+", min: 100 },
 *     ],
 *   },
 *   category: { type: "hierarchy", separator: " > " },
 * };
 *
 * const facets = extractFacetValues(metadata, facetsConfig);
 * // [
 * //   { name: "status", value: "published" },
 * //   { name: "tags", value: "react" },
 * //   { name: "tags", value: "typescript" },
 * //   { name: "price", value: "$50-$100", numericValue: 75 },
 * //   { name: "category", value: "Electronics" },
 * //   { name: "category", value: "Electronics > Phones" },
 * //   { name: "category", value: "Electronics > Phones > iPhone" },
 * // ]
 * ```
 */
export function extractFacetValues(
  metadata: Record<string, any>,
  facetsConfig: FacetsConfig,
): FacetIndexValue[] {
  const results: FacetIndexValue[] = [];

  for (const [field, config] of Object.entries(facetsConfig)) {
    const value = metadata[field];

    // Skip null/undefined values
    if (value === null || value === undefined) {
      continue;
    }

    const facetValues = extractSingleFacet(field, value, config);
    results.push(...facetValues);
  }

  return results;
}

/**
 * Extract facet values for a single field
 */
function extractSingleFacet(
  field: string,
  value: any,
  config: FacetFieldConfig,
): FacetIndexValue[] {
  // Simple string facet
  if (config === true) {
    return [{ name: field, value: String(value) }];
  }

  // Multi-value array facet
  if (config.type === "array") {
    return extractArrayFacet(field, value);
  }

  // Numeric range bucket facet
  if (config.type === "range") {
    return extractRangeFacet(field, value, config.buckets);
  }

  // Hierarchical facet
  if (config.type === "hierarchy") {
    return extractHierarchyFacet(field, value, config.separator);
  }

  return [];
}

/**
 * Extract multi-value array facet
 * Each array element becomes a separate facet value
 */
function extractArrayFacet(field: string, value: any): FacetIndexValue[] {
  const values = Array.isArray(value) ? value : [value];
  const results: FacetIndexValue[] = [];

  for (const v of values) {
    if (v !== null && v !== undefined) {
      results.push({ name: field, value: String(v) });
    }
  }

  return results;
}

/**
 * Extract numeric range facet with bucket labels
 * Returns the bucket label and original numeric value for stats
 */
function extractRangeFacet(
  field: string,
  value: any,
  buckets: Array<{ label: string; min?: number; max?: number }>,
): FacetIndexValue[] {
  const numValue = Number(value);

  if (Number.isNaN(numValue)) {
    return [];
  }

  const bucket = findBucket(numValue, buckets);

  if (bucket) {
    return [
      {
        name: field,
        value: bucket.label,
        numericValue: numValue,
      },
    ];
  }

  return [];
}

/**
 * Find the matching bucket for a numeric value
 */
function findBucket(
  value: number,
  buckets: Array<{ label: string; min?: number; max?: number }>,
): { label: string; min?: number; max?: number } | undefined {
  return buckets.find((bucket) => {
    const aboveMin = bucket.min === undefined || value >= bucket.min;
    const belowMax = bucket.max === undefined || value < bucket.max;
    return aboveMin && belowMax;
  });
}

/**
 * Extract hierarchical facet
 * Expands "A > B > C" into ["A", "A > B", "A > B > C"]
 * This allows counting at each level of the hierarchy
 */
function extractHierarchyFacet(
  field: string,
  value: any,
  separator?: string,
): FacetIndexValue[] {
  const sep = separator ?? " > ";
  const parts = String(value).split(sep);
  const results: FacetIndexValue[] = [];

  let path = "";
  for (const part of parts) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;

    path = path ? `${path}${sep}${trimmedPart}` : trimmedPart;
    results.push({ name: field, value: path });
  }

  return results;
}

/**
 * Validate that requested facet fields are defined in the config
 *
 * @param requestedFacets - Facet fields requested at query time
 * @param facetsConfig - Facet configuration from collection
 * @returns Array of invalid facet field names
 */
export function validateFacetFields(
  requestedFacets: string[],
  facetsConfig: FacetsConfig | undefined,
): string[] {
  if (!facetsConfig) {
    return requestedFacets; // All are invalid if no facets defined
  }

  const definedFacets = new Set(Object.keys(facetsConfig));
  return requestedFacets.filter((field) => !definedFacets.has(field));
}

/**
 * Check if a facet field is a range type (has numeric values)
 */
export function isRangeFacet(
  field: string,
  facetsConfig: FacetsConfig | undefined,
): boolean {
  if (!facetsConfig) return false;
  const config = facetsConfig[field];
  return typeof config === "object" && config.type === "range";
}
