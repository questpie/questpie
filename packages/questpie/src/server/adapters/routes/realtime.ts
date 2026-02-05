/**
 * Realtime Routes
 *
 * Server-sent events (SSE) route handlers for realtime updates.
 */

import type { Questpie } from "../../config/cms.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import type { AdapterConfig, AdapterContext } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { parseFindOptions, parseGlobalGetOptions } from "../utils/parsers.js";
import { handleError, sseHeaders } from "../utils/response.js";

export const createRealtimeRoutes = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	cms: Questpie<TConfig>,
	config: AdapterConfig<TConfig> = {},
) => {
	const errorResponse = (
		error: unknown,
		request: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request, cms, locale });
	};

	return {
		subscribe: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		): Promise<Response> => {
			if (request.method !== "GET") {
				return errorResponse(
					ApiError.badRequest("Method not allowed"),
					request,
				);
			}

			if (!cms.realtime) {
				return errorResponse(ApiError.notImplemented("Realtime"), request);
			}

			const resolved = await resolveContext(cms, request, config, context);
			const crud = cms.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.cmsContext.locale,
				);
			}

			const options = parseFindOptions(new URL(request.url));

			const encoder = new TextEncoder();
			let closeStream: (() => void) | null = null;
			const stream = new ReadableStream({
				start: (controller) => {
					let closed = false;
					let refreshInFlight = false;
					let refreshQueued = false;
					let lastSeq = 0;

					const send = (event: string, data: unknown) => {
						if (closed) return;
						controller.enqueue(
							encoder.encode(
								`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`,
							),
						);
					};

					const sendError = (error: unknown) => {
						const message =
							error instanceof Error ? error.message : "Unknown error";
						send("error", { message });
					};

					const refresh = async (seq?: number) => {
						if (closed) return;
						if (typeof seq === "number") {
							lastSeq = Math.max(lastSeq, seq);
						}
						if (refreshInFlight) {
							refreshQueued = true;
							return;
						}
						refreshInFlight = true;

						try {
							do {
								refreshQueued = false;
								const data = await crud.find(options, resolved.cmsContext);
								send("snapshot", { seq: lastSeq, data });
							} while (refreshQueued && !closed);
						} catch (error) {
							sendError(error);
						} finally {
							refreshInFlight = false;
						}
					};

					// Service handles topic routing + dependency tracking
					const unsubscribe = cms.realtime!.subscribe(
						(event) => {
							void refresh(event.seq);
						},
						{
							resourceType: "collection",
							resource: params.collection,
							where: options.where,
							with: options.with,
						},
					);

					const pingTimer = setInterval(() => {
						send("ping", { ts: Date.now() });
					}, 25000);

					const close = () => {
						if (closed) return;
						closed = true;
						clearInterval(pingTimer);
						unsubscribe();
						controller.close();
					};
					closeStream = close;

					if (request.signal) {
						request.signal.addEventListener("abort", close);
					}

					void (async () => {
						try {
							lastSeq = await cms.realtime?.getLatestSeq();
							await refresh(lastSeq);
						} catch (error) {
							sendError(error);
						}
					})();
				},
				cancel: () => {
					closeStream?.();
				},
			});

			return new Response(stream, {
				headers: sseHeaders,
			});
		},

		subscribeGlobal: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		): Promise<Response> => {
			if (request.method !== "GET") {
				return errorResponse(
					ApiError.badRequest("Method not allowed"),
					request,
				);
			}

			if (!cms.realtime) {
				return errorResponse(ApiError.notImplemented("Realtime"), request);
			}

			const resolved = await resolveContext(cms, request, config, context);
			let globalInstance: any;

			try {
				globalInstance = cms.getGlobalConfig(params.global as any);
			} catch {
				return errorResponse(
					ApiError.notFound("Global", params.global),
					request,
					resolved.cmsContext.locale,
				);
			}

			const crud = globalInstance.generateCRUD(resolved.cmsContext.db, cms);
			const options = parseGlobalGetOptions(new URL(request.url));

			const encoder = new TextEncoder();
			let closeStream: (() => void) | null = null;
			const stream = new ReadableStream({
				start: (controller) => {
					let closed = false;
					let refreshInFlight = false;
					let refreshQueued = false;
					let lastSeq = 0;

					const send = (event: string, data: unknown) => {
						if (closed) return;
						controller.enqueue(
							encoder.encode(
								`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`,
							),
						);
					};

					const sendError = (error: unknown) => {
						const message =
							error instanceof Error ? error.message : "Unknown error";
						send("error", { message });
					};

					const refresh = async (seq?: number) => {
						if (closed) return;
						if (typeof seq === "number") {
							lastSeq = Math.max(lastSeq, seq);
						}
						if (refreshInFlight) {
							refreshQueued = true;
							return;
						}
						refreshInFlight = true;

						try {
							do {
								refreshQueued = false;
								const data = await crud.get(options, resolved.cmsContext);
								send("snapshot", { seq: lastSeq, data });
							} while (refreshQueued && !closed);
						} catch (error) {
							sendError(error);
						} finally {
							refreshInFlight = false;
						}
					};

					// Service handles topic routing + dependency tracking
					const unsubscribe = cms.realtime!.subscribe(
						(event) => {
							void refresh(event.seq);
						},
						{
							resourceType: "global",
							resource: params.global,
							where: options.where,
							with: options.with,
						},
					);

					const pingTimer = setInterval(() => {
						send("ping", { ts: Date.now() });
					}, 25000);

					const close = () => {
						if (closed) return;
						closed = true;
						clearInterval(pingTimer);
						unsubscribe();
						controller.close();
					};
					closeStream = close;

					if (request.signal) {
						request.signal.addEventListener("abort", close);
					}

					void (async () => {
						try {
							lastSeq = await cms.realtime?.getLatestSeq();
							await refresh(lastSeq);
						} catch (error) {
							sendError(error);
						}
					})();
				},
				cancel: () => {
					closeStream?.();
				},
			});

			return new Response(stream, {
				headers: sseHeaders,
			});
		},
	};
};
