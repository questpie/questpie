/**
 * Type-safe check for nullish values (null or undefined)
 */
export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 *
 * @returns Array with unique items based on the key returned by getKey function. The first occurrence is kept.
 */
export function dedupeBy<T, K>(array: T[], getKey: (item: T) => K): T[] {
  const seen = new Set<K>();
  const result: T[] = [];

  for (const item of array) {
    const key = getKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

/**
 * Check if a value is a plain object (not an array, Date, RegExp, etc.)
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }

  // Check if it's a plain object (not an array, Date, RegExp, etc.)
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep merge utility that recursively merges objects.
 *
 * Behavior:
 * - Plain objects are merged recursively
 * - Arrays from source replace target arrays (no concatenation)
 * - Primitive values from source replace target values
 * - null/undefined sources are skipped
 * - Special objects (Date, RegExp, etc.) from source replace target values
 *
 * @param target - The target object to merge into
 * @param sources - One or more source objects to merge from
 * @returns A new object with merged values
 *
 * @example
 * ```ts
 * const target = { a: 1, b: { c: 2 } };
 * const source = { b: { d: 3 }, e: 4 };
 * const result = deepMerge(target, source);
 * // { a: 1, b: { c: 2, d: 3 }, e: 4 }
 * ```
 */
export function deepMerge<T extends Record<string, any> = Record<string, any>>(
  target: T,
  ...sources: Array<Record<string, any> | null | undefined>
): any {
  // Return a copy of target if no sources provided
  if (sources.length === 0) {
    return structuredClone(target);
  }

  // Start with a clone of the target
  const result: any = structuredClone(target);

  for (const source of sources) {
    // Skip nullish sources
    if (isNullish(source)) {
      continue;
    }

    // Merge each key from source into result
    for (const key in source) {
      // biome-ignore lint/suspicious/noPrototypeBuiltins: ES2021 compatibility
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        continue;
      }

      const sourceValue = source[key];
      const targetValue = result[key];

      // If source value is nullish, skip it
      if (isNullish(sourceValue)) {
        continue;
      }

      // If both are plain objects, merge recursively
      if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
        result[key] = deepMerge(
          targetValue as Record<string, any>,
          sourceValue as Record<string, any>,
        );
      } else {
        // Otherwise, source value replaces target value (including arrays)
        result[key] = structuredClone(sourceValue);
      }
    }
  }

  return result;
}
