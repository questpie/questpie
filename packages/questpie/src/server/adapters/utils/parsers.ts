/**
 * HTTP Request Parsers
 *
 * Utilities for parsing query parameters into CRUD options.
 */

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

export const parseFindOptions = (url: URL) => {
  const parsedQuery = getQueryParams(url);
  const options: any = {};

  const limit = parseIntParam(parsedQuery.limit);
  if (limit !== undefined) options.limit = limit;

  const offset = parseIntParam(parsedQuery.offset);
  if (offset !== undefined) options.offset = offset;

  const page = parseIntParam(parsedQuery.page);
  if (page !== undefined) options.page = page;

  if (parsedQuery.where) options.where = parsedQuery.where;
  if (parsedQuery.orderBy) options.orderBy = parsedQuery.orderBy;
  if (parsedQuery.with) options.with = parsedQuery.with;
  if (parsedQuery.includeDeleted !== undefined) {
    options.includeDeleted = parseBoolean(parsedQuery.includeDeleted);
  }
  // Search by _title (for relation pickers, etc.)
  if (parsedQuery.search) options.search = parsedQuery.search;
  if (parsedQuery.locale) options.locale = parsedQuery.locale;
  if (parsedQuery.localeFallback !== undefined) {
    options.localeFallback = parseBoolean(parsedQuery.localeFallback);
  }

  return options;
};

export const parseFindOneOptions = (url: URL, id: string) => {
  const parsedQuery = getQueryParams(url);
  const options: any = { where: { id } };

  if (parsedQuery.with) options.with = parsedQuery.with;
  if (parsedQuery.includeDeleted !== undefined) {
    options.includeDeleted = parseBoolean(parsedQuery.includeDeleted);
  }
  if (parsedQuery.locale) options.locale = parsedQuery.locale;
  if (parsedQuery.localeFallback !== undefined) {
    options.localeFallback = parseBoolean(parsedQuery.localeFallback);
  }

  return options;
};

export const parseGlobalGetOptions = (url: URL) => {
  const parsedQuery = getQueryParams(url);
  const options: any = {};

  if (parsedQuery.with) options.with = parsedQuery.with;
  if (parsedQuery.columns) options.columns = parsedQuery.columns;
  if (parsedQuery.locale) options.locale = parsedQuery.locale;
  if (parsedQuery.localeFallback !== undefined) {
    options.localeFallback = parseBoolean(parsedQuery.localeFallback);
  }

  return options;
};

export const parseGlobalUpdateOptions = (url: URL) => {
  const parsedQuery = getQueryParams(url);
  const options: any = {};

  if (parsedQuery.with) options.with = parsedQuery.with;
  if (parsedQuery.locale) options.locale = parsedQuery.locale;
  if (parsedQuery.localeFallback !== undefined) {
    options.localeFallback = parseBoolean(parsedQuery.localeFallback);
  }

  return options;
};
