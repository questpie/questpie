import { getTxid, QUESTPIE_TXID_HEADER } from "#questpie/shared/txid.js";

import type { Questpie } from "../../config/questpie.js";
import { ApiError } from "../../errors/index.js";
import { handleError } from "../utils/response.js";

export function optimisticErrorResponse(
	app: Questpie<any>,
	error: unknown,
	request: Request,
	locale?: string,
): Response {
	const responseError =
		request.headers.has("if-match") &&
		error instanceof ApiError &&
		error.code === "CONFLICT"
			? ApiError.preconditionFailed(error.message)
			: error;
	return handleError(responseError, { request, app, locale });
}

export function revisionHeaders(
	result: unknown,
	optimisticConcurrency: boolean,
): HeadersInit | undefined {
	const headers = txidHeaders(result);
	if (
		!optimisticConcurrency ||
		!result ||
		typeof result !== "object" ||
		typeof (result as { revision?: unknown }).revision !== "number"
	) {
		return headers;
	}
	return {
		...(headers ?? {}),
		ETag: `"${(result as { revision: number }).revision}"`,
	};
}

export function txidHeaders(result: unknown): HeadersInit | undefined {
	const txid = getTxid(result);
	return txid ? { [QUESTPIE_TXID_HEADER]: txid } : undefined;
}

export function expectedRevisionFromRequest(
	request: Request,
	bodyRevision: number | undefined,
	optimisticConcurrency: boolean,
): number | undefined {
	const ifMatch = request.headers.get("if-match");
	if (!optimisticConcurrency) {
		if (ifMatch) {
			throw ApiError.badRequest("If-Match requires optimistic concurrency");
		}
		return undefined;
	}
	if (!ifMatch) return bodyRevision;
	const match = /^"([0-9]+)"$/.exec(ifMatch.trim());
	const headerRevision = match ? Number(match[1]) : undefined;
	if (
		headerRevision === undefined ||
		(bodyRevision !== undefined && bodyRevision !== headerRevision)
	) {
		throw ApiError.preconditionFailed(
			"Optimistic concurrency precondition failed",
		);
	}
	return headerRevision;
}
