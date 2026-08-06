/**
 * HTTP Request Parsers
 *
 * Utilities for parsing query parameters into CRUD options.
 */

import { ApiError } from "#questpie/server/errors/base.js";

import { getQueryParams, parseBoolean } from "./request.js";

/**
 * Safely parse a numeric query parameter.
 * Returns undefined if the value is not a valid non-negative integer.
 */
function parseIntParam(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const num = Number(value);
	if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) return undefined;
	return Math.floor(num);
}

/**
 * Parse a `columns` selection into the booleans the select builders compare by
 * identity (`=== true` / `=== false`).
 *
 * A query string carries `columns[title]=false` as the *string* `"false"`, which
 * is truthy, so forwarding the parsed query as-is is not the same fix as parsing
 * it: a collection would fall back to selecting every column, and a global would
 * select the very columns the caller asked it to drop.
 *
 * Returns undefined for anything that is not an object of flags, so junk widens
 * to "no projection" rather than an empty one.
 */
function parseColumnsParam(
	value: unknown,
): Record<string, boolean> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}

	const columns: Record<string, boolean> = {};
	for (const [key, flag] of Object.entries(value)) {
		columns[key] = parseBoolean(flag);
	}
	return Object.keys(columns).length > 0 ? columns : undefined;
}

export const parseFindOptions = (url: URL) => {
	const parsedQuery = getQueryParams(url);
	const options: any = {};

	const limit = parseIntParam(parsedQuery.limit);
	if (limit !== undefined) options.limit = limit;

	const offset = parseIntParam(parsedQuery.offset);
	if (offset !== undefined) options.offset = offset;

	// `page` is 1-based and is only meaningful against a page SIZE, so it is
	// translated into the `offset` the CRUD layer actually reads. It used to be
	// parsed onto an option nobody consumed, which made `?page=3` look supported
	// while silently returning page 1. Anything that cannot be translated is
	// refused rather than ignored.
	const page = parseIntParam(parsedQuery.page);
	if (page !== undefined) {
		if (offset !== undefined) {
			throw ApiError.badRequest(
				"Pass either 'page' or 'offset', not both — they set the same position.",
			);
		}
		if (page < 1) {
			throw ApiError.badRequest(
				"'page' is 1-based; the first page is 'page=1'.",
			);
		}
		if (limit === undefined || limit < 1) {
			throw ApiError.badRequest(
				"'page' requires a 'limit' of at least 1 to size the page.",
			);
		}
		options.offset = (page - 1) * limit;
	}

	if (parsedQuery.where) options.where = parsedQuery.where;
	if (parsedQuery.orderBy) options.orderBy = parsedQuery.orderBy;
	if (parsedQuery.groupBy) options.groupBy = parsedQuery.groupBy;
	if (parsedQuery.with) options.with = parsedQuery.with;

	const columns = parseColumnsParam(parsedQuery.columns);
	if (columns) options.columns = columns;

	if (parsedQuery.includeDeleted !== undefined) {
		options.includeDeleted = parseBoolean(parsedQuery.includeDeleted);
	}
	// Search by _title (for relation pickers, etc.)
	if (parsedQuery.search) options.search = parsedQuery.search;
	if (parsedQuery.locale) options.locale = parsedQuery.locale;
	if (parsedQuery.stage) options.stage = parsedQuery.stage;
	if (parsedQuery.localeFallback !== undefined) {
		options.localeFallback = parseBoolean(parsedQuery.localeFallback);
	}

	return options;
};

export const parseFindOneOptions = (url: URL, id: string) => {
	const parsedQuery = getQueryParams(url);
	const options: any = { where: { id } };

	if (parsedQuery.with) options.with = parsedQuery.with;

	const columns = parseColumnsParam(parsedQuery.columns);
	if (columns) options.columns = columns;

	if (parsedQuery.includeDeleted !== undefined) {
		options.includeDeleted = parseBoolean(parsedQuery.includeDeleted);
	}
	if (parsedQuery.locale) options.locale = parsedQuery.locale;
	if (parsedQuery.stage) options.stage = parsedQuery.stage;
	if (parsedQuery.localeFallback !== undefined) {
		options.localeFallback = parseBoolean(parsedQuery.localeFallback);
	}

	return options;
};

export const parseGlobalGetOptions = (url: URL) => {
	const parsedQuery = getQueryParams(url);
	const options: any = {};

	if (parsedQuery.with) options.with = parsedQuery.with;

	const columns = parseColumnsParam(parsedQuery.columns);
	if (columns) options.columns = columns;

	if (parsedQuery.locale) options.locale = parsedQuery.locale;
	if (parsedQuery.stage) options.stage = parsedQuery.stage;
	if (parsedQuery.localeFallback !== undefined) {
		options.localeFallback = parseBoolean(parsedQuery.localeFallback);
	}

	return options;
};

export const parseGlobalUpdateOptions = (url: URL) => {
	const parsedQuery = getQueryParams(url);
	const options: any = {};

	if (parsedQuery.with) options.with = parsedQuery.with;
	if (parsedQuery.stage) options.stage = parsedQuery.stage;
	if (parsedQuery.locale) options.locale = parsedQuery.locale;
	if (parsedQuery.localeFallback !== undefined) {
		options.localeFallback = parseBoolean(parsedQuery.localeFallback);
	}

	return options;
};
