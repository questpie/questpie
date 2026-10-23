/**
 * HTTP Response Utilities
 *
 * Utilities for creating HTTP responses with proper serialization.
 */

import { stringifyTypedWire } from "#questpie/shared/typed-wire.js";

import type { Questpie } from "../../config/questpie.js";
import { ApiError } from "../../errors/base.js";
import { getHTTPStatusFromCode } from "../../errors/codes.js";
import { formatPublicError } from "../../errors/public.js";

export const jsonHeaders = {
	"Content-Type": "application/json",
};

export const superjsonHeaders = {
	"Content-Type": "application/superjson+json",
};

export const sseHeaders = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache",
	Connection: "keep-alive",
	"X-Accel-Buffering": "no",
	"X-Questpie-Realtime-Protocol": "1",
};

/**
 * Detect if client supports SuperJSON serialization
 */
export const supportsSuperJSON = (request: Request): boolean => {
	const xSuperJSON = request.headers.get("X-SuperJSON");
	const accept = request.headers.get("Accept");
	const contentType = request.headers.get("Content-Type");

	return (
		xSuperJSON === "1" ||
		accept?.includes("application/superjson+json") ||
		contentType?.includes("application/superjson+json") ||
		false
	);
};

/**
 * Smart response that uses SuperJSON when client supports it
 */
export const smartResponse = (
	data: unknown,
	request: Request,
	status = 200,
	extraHeaders?: HeadersInit,
) => {
	const useSuperJSON = supportsSuperJSON(request);

	const body = useSuperJSON ? stringifyTypedWire(data) : JSON.stringify(data);
	const headers = new Headers(useSuperJSON ? superjsonHeaders : jsonHeaders);
	if (extraHeaders) {
		for (const [name, value] of new Headers(extraHeaders)) {
			headers.set(name, value);
		}
	}

	return new Response(body, { status, headers });
};

/**
 * Error for a denied schema/meta introspection request.
 * 401 when anonymous, 403 when authenticated (matches CRUD conventions).
 */
export const introspectionDeniedError = (
	resource: string,
	session: unknown,
): ApiError => {
	return session
		? ApiError.forbidden({
				operation: "read",
				resource,
				reason: "User does not have permission to introspect this resource",
			})
		: ApiError.unauthorized();
};

/**
 * Detect development mode for callers. Public error redaction is environment-independent.
 */
export const isDevelopment = () => {
	try {
		return process?.env?.NODE_ENV === "development";
	} catch {
		return false;
	}
};

/**
 * Options for handleError function
 */
export type HandleErrorOptions = {
	request?: Request;
	/** @deprecated Public responses always redact diagnostics; retained for compatibility. */
	isDev?: boolean;
	app?: Questpie<any>;
	locale?: string;
};

/**
 * Handle errors and convert to HTTP Response
 * Supports ApiError, ZodError, and generic Error
 * Optionally translates error messages when app and locale are provided
 */
export const handleError = (
	error: unknown,
	options: HandleErrorOptions = {},
): Response => {
	const { request, app, locale } = options;
	const errorData = { error: formatPublicError(error, { t: app?.t, locale }) };
	const status = getHTTPStatusFromCode(errorData.error.code);
	if (request) return smartResponse(errorData, request, status);
	return new Response(JSON.stringify(errorData), {
		status,
		headers: jsonHeaders,
	});
};
