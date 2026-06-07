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

export const isFileLike = (value: unknown): value is UploadFile => {
	if (!value) return false;

	const file = value as UploadFile;
	return (
		typeof file.name === "string" &&
		typeof file.type === "string" &&
		typeof file.size === "number" &&
		Number.isFinite(file.size) &&
		file.size >= 0 &&
		(typeof file.stream === "function" ||
			typeof file.arrayBuffer === "function")
	);
};

/**
 * Resolve an uploaded file together with an optional destination `path` from the
 * same form-data parse (the body can only be read once). `path` is forwarded to
 * the collection's upload as additional record data so a blob upload can land
 * inside a folder (e.g. an `assets` row's required `path`). When the caller
 * supplies a pre-parsed `file`, the form-data is not consumed and `path` is
 * undefined.
 */
export const resolveUpload = async (
	request: Request,
	file?: UploadFile | null,
): Promise<{ file: UploadFile | null; path?: string }> => {
	if (file && isFileLike(file)) {
		return { file };
	}

	const formData = await request.formData();
	const formFile = formData.get("file");
	const formPath = formData.get("path");
	return {
		file: isFileLike(formFile) ? formFile : null,
		path: typeof formPath === "string" && formPath ? formPath : undefined,
	};
};

export const normalizeMimeType = (value: string) =>
	value.split(";")[0]?.trim() || value;

/**
 * Smart body parser that detects SuperJSON
 */
export const parseRouteBody = async (request: Request) => {
	const text = await request.text();
	if (!text) return undefined;

	const useSuperJSON = supportsSuperJSON(request);

	try {
		return useSuperJSON ? superjson.parse(text) : JSON.parse(text);
	} catch {
		return null;
	}
};
