/**
 * Storage Routes
 *
 * File upload and serving route handlers.
 */

import type { Files } from "files-sdk";

import type { Questpie } from "../../config/questpie.js";
import type { StorageVisibility } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import { verifySignedUrlToken } from "../../modules/core/integrated/storage/signed-url.js";
import type { AdapterConfig, AdapterContext, UploadFile } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { resolveUploadFile } from "../utils/request.js";
import { handleError, smartResponse } from "../utils/response.js";

// ============================================================================
// Standalone Handlers
// ============================================================================

type ByteRange = {
	start: number;
	end: number;
	length: number;
};

type StorageRouteContext = {
	storage: Files;
};

const getStorageFromContext = (
	context: AdapterContext["appContext"],
	app: Questpie<any>,
): Files => {
	const storage =
		(context as AdapterContext["appContext"] & Partial<StorageRouteContext>)
			.storage ?? app.storage;
	if (!storage) {
		throw ApiError.internal("Storage not configured");
	}
	return storage as Files;
};

const toUint8Array = (chunk: unknown): Uint8Array => {
	if (chunk instanceof Uint8Array) return chunk;
	if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
	if (ArrayBuffer.isView(chunk)) {
		return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	}
	return new TextEncoder().encode(String(chunk));
};

const parseByteRange = (
	rangeHeader: string,
	totalSize: number,
): ByteRange | "unsatisfiable" | null => {
	const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) return null;

	const [, rawStart, rawEnd] = match;
	if (rawStart === "" && rawEnd === "") return null;
	if (totalSize <= 0) return "unsatisfiable";

	let start: number;
	let end: number;

	if (rawStart === "") {
		const suffixLength = Number.parseInt(rawEnd, 10);
		if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
		start = Math.max(totalSize - suffixLength, 0);
		end = totalSize - 1;
	} else {
		start = Number.parseInt(rawStart, 10);
		end = rawEnd === "" ? totalSize - 1 : Number.parseInt(rawEnd, 10);
	}

	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	if (start > end || start >= totalSize) return "unsatisfiable";

	end = Math.min(end, totalSize - 1);
	return { start, end, length: end - start + 1 };
};

const createRangeStream = (
	stream: ReadableStream<Uint8Array>,
	start: number,
	end: number,
): ReadableStream<Uint8Array> => {
	const reader = stream.getReader();
	let offset = 0;
	let closed = false;

	const close = async () => {
		if (closed) return;
		closed = true;
		await reader.cancel();
	};

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (closed) {
				controller.close();
				return;
			}

			try {
				while (true) {
					const next = await reader.read();
					if (next.done) {
						closed = true;
						controller.close();
						return;
					}

					const chunk = toUint8Array(next.value);
					const chunkStart = offset;
					const chunkEnd = offset + chunk.byteLength - 1;
					offset += chunk.byteLength;

					if (chunkEnd < start) continue;
					if (chunkStart > end) {
						await close();
						controller.close();
						return;
					}

					const sliceStart = Math.max(start - chunkStart, 0);
					const sliceEnd = Math.min(end - chunkStart + 1, chunk.byteLength);
					if (sliceEnd > sliceStart) {
						controller.enqueue(chunk.subarray(sliceStart, sliceEnd));
					}

					if (chunkEnd >= end) {
						await close();
						controller.close();
					}
					return;
				}
			} catch (error) {
				await close().catch(() => {});
				controller.error(error);
			}
		},
		async cancel() {
			await close();
		},
	});
};

/**
 * Upload a file to a collection.
 * POST /:collection/upload
 */
export async function storageCollectionUpload(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
	file?: UploadFile | null,
): Promise<Response> {
	const errorResponse = (
		error: unknown,
		req: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request: req, app, locale });
	};
	const resolved = await resolveContext(app, request, config, context);

	if (request.method !== "POST") {
		return errorResponse(
			ApiError.badRequest(
				"Method not allowed",
				undefined,
				"error.methodNotAllowed",
			),
			request,
			resolved.appContext.locale,
		);
	}

	const { collection } = params;

	// Check if collection exists and has upload configured
	let collectionConfig: any;
	try {
		collectionConfig = app.getCollectionConfig(collection as any);
	} catch {
		return errorResponse(
			ApiError.notFound("Collection", collection),
			request,
			resolved.appContext.locale,
		);
	}

	// Check if upload is enabled for this collection
	if (!collectionConfig.state?.upload) {
		return errorResponse(
			ApiError.badRequest(
				`Collection "${collection}" does not support file uploads. Use .upload() to enable.`,
				undefined,
				"upload.collectionNotSupported",
				{ collection },
			),
			request,
			resolved.appContext.locale,
		);
	}

	const uploadFile = await resolveUploadFile(request, file);

	if (!uploadFile) {
		return errorResponse(
			ApiError.badRequest(
				"No file uploaded. Send 'file' in form-data.",
				undefined,
				"upload.noFileUploaded",
			),
			request,
			resolved.appContext.locale,
		);
	}

	try {
		// Use the collection's upload method which handles validation and storage
		const crud = app.collections[collection as any] as any;
		if (!crud?.upload) {
			return errorResponse(
				ApiError.badRequest(
					`Collection "${collection}" upload method not available`,
					undefined,
					"upload.methodNotAvailable",
					{ collection },
				),
				request,
				resolved.appContext.locale,
			);
		}

		const result = await crud.upload(uploadFile, resolved.appContext);
		return smartResponse(result, request);
	} catch (error) {
		return errorResponse(error, request, resolved.appContext.locale);
	}
}

/**
 * Serve a file from a collection's storage.
 * GET /:collection/files/:key
 */
export async function storageCollectionServe(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
): Promise<Response> {
	const errorResponse = (
		error: unknown,
		req: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request: req, app, locale });
	};
	const resolved = await resolveContext(app, request, config, context);

	if (request.method !== "GET") {
		return errorResponse(
			ApiError.badRequest(
				"Method not allowed",
				undefined,
				"error.methodNotAllowed",
			),
			request,
			resolved.appContext.locale,
		);
	}

	const { collection, key } = params;

	// Check if collection exists and has upload configured
	let collectionConfig: any;
	try {
		collectionConfig = app.getCollectionConfig(collection as any);
	} catch {
		return errorResponse(
			ApiError.notFound("Collection", collection),
			request,
			resolved.appContext.locale,
		);
	}

	// Check if upload is enabled for this collection
	if (!collectionConfig.state?.upload) {
		return errorResponse(
			ApiError.badRequest(
				`Collection "${collection}" does not support file serving. Use .upload() to enable.`,
				undefined,
				"upload.collectionServeNotSupported",
				{ collection },
			),
			request,
			resolved.appContext.locale,
		);
	}

	const url = new URL(request.url);
	const token = url.searchParams.get("token");

	try {
		const storage = getStorageFromContext(resolved.appContext, app);

		// The upload row is the authorization anchor for storage objects. Do not
		// serve orphaned keys, or keys hidden by collection read access.
		const crud = app.collections[collection as any];
		const record = await crud.findOne(
			{
				where: { key } as any,
			},
			resolved.appContext,
		);

		if (!record) {
			return errorResponse(
				ApiError.notFound("File", key),
				request,
				resolved.appContext.locale,
			);
		}

		const visibility: StorageVisibility =
			(record as any).visibility ||
			collectionConfig.state.upload?.visibility ||
			app.config.storage?.defaultVisibility ||
			"public";

		// For private files, verify the signed token after row access succeeds.
		if (visibility === "private") {
			if (!token) {
				return errorResponse(
					ApiError.unauthorized(
						"Token required for private files",
						"upload.tokenRequired",
					),
					request,
					resolved.appContext.locale,
				);
			}

			const secret = app.config.secret;
			if (!secret) {
				return errorResponse(
					ApiError.internal(
						"Storage secret not configured. Set 'secret' in your app config to serve private files.",
					),
					request,
					resolved.appContext.locale,
				);
			}
			const payload = await verifySignedUrlToken(token, secret);

			if (!payload) {
				return errorResponse(
					ApiError.unauthorized(
						"Invalid or expired token",
						"upload.tokenInvalid",
					),
					request,
					resolved.appContext.locale,
				);
			}

			if (payload.key !== key) {
				return errorResponse(
					ApiError.unauthorized(
						"Token does not match requested file",
						"upload.tokenMismatch",
					),
					request,
					resolved.appContext.locale,
				);
			}
		}

		const exists = await storage.exists(key);
		if (!exists) {
			return errorResponse(
				ApiError.notFound("File", key),
				request,
				resolved.appContext.locale,
			);
		}

		const metadata = await storage.head(key);

		const contentType =
			metadata.type || (record as any)?.mimeType || "application/octet-stream";

		// Sanitize filename to prevent header injection
		const rawFilename = (record as any)?.filename;
		const sanitizedFilename = rawFilename
			? rawFilename.replace(/[\r\n"\\]/g, "_")
			: null;

		// Security headers for SVG files — prevent embedded script execution
		const isSvg = contentType.includes("svg");
		const recordSize = Number((record as any)?.size);
		const metadataSize = Number(metadata.size);
		const totalSize = Number.isFinite(metadataSize) ? metadataSize : recordSize;
		const hasKnownSize = Number.isFinite(totalSize) && totalSize >= 0;
		const commonHeaders = {
			"Content-Type": contentType,
			"Accept-Ranges": "bytes",
			"Cache-Control":
				visibility === "public"
					? "public, max-age=31536000, immutable"
					: "private, no-cache",
			...(isSvg && {
				"Content-Security-Policy": "script-src 'none'",
			}),
		};
		const filenameHeaders = sanitizedFilename
			? { "Content-Disposition": `inline; filename="${sanitizedFilename}"` }
			: {};

		// HTTP Range request support (for video/audio seeking)
		const rangeHeader = request.headers.get("range");
		if (rangeHeader && hasKnownSize) {
			const range = parseByteRange(rangeHeader, totalSize);
			if (range === "unsatisfiable") {
				return new Response(null, {
					status: 416,
					headers: {
						"Content-Range": `bytes */${totalSize}`,
					},
				});
			}

			if (range) {
				const file = await storage.download(key, { as: "stream" });
				const stream = file.stream();
				return new Response(createRangeStream(stream, range.start, range.end), {
					status: 206,
					headers: {
						...commonHeaders,
						...filenameHeaders,
						"Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
						"Content-Length": String(range.length),
					},
				});
			}
		}

		const file = await storage.download(key, { as: "stream" });
		return new Response(file.stream(), {
			status: 200,
			headers: {
				...commonHeaders,
				...filenameHeaders,
				...(hasKnownSize ? { "Content-Length": String(totalSize) } : {}),
			},
		});
	} catch (error) {
		return errorResponse(error, request, resolved.appContext.locale);
	}
}
