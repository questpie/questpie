/**
 * HTTP Request Utilities
 *
 * Utilities for parsing HTTP requests.
 */

import qs from "qs";
import superjson from "superjson";
import type { UploadFile } from "../types.js";
import { supportsSuperJSON } from "./response.js";

export const parseBoolean = (value: unknown) =>
  value === true || value === "true" || value === 1 || value === "1";

export const normalizeBasePath = (basePath: string) => {
  const prefixed = basePath.startsWith("/") ? basePath : `/${basePath}`;
  if (prefixed.length > 1 && prefixed.endsWith("/")) {
    return prefixed.slice(0, -1);
  }
  return prefixed;
};

export const getQueryParams = (url: URL) =>
  qs.parse(url.search.slice(1), { allowDots: true, comma: true });

export const isFileLike = (value: unknown): value is UploadFile =>
  !!value &&
  typeof (value as UploadFile).name === "string" &&
  typeof (value as UploadFile).arrayBuffer === "function";

export const resolveUploadFile = async (
  request: Request,
  file?: UploadFile | null,
): Promise<UploadFile | null> => {
  if (file && isFileLike(file)) {
    return file;
  }

  const formData = await request.formData();
  const formFile = formData.get("file");
  return isFileLike(formFile) ? formFile : null;
};

export const normalizeMimeType = (value: string) =>
  value.split(";")[0]?.trim() || value;

/**
 * Smart body parser that detects SuperJSON
 */
export const parseRpcBody = async (request: Request) => {
  const text = await request.text();
  if (!text) return undefined;

  const useSuperJSON = supportsSuperJSON(request);

  try {
    return useSuperJSON ? superjson.parse(text) : JSON.parse(text);
  } catch {
    return null;
  }
};
