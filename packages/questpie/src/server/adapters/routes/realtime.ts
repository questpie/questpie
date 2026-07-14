/**
 * Realtime Routes
 *
 * Unified SSE endpoint for multiplexed realtime updates.
 * Accepts multiple topics via POST and streams updates for all of them.
 */

import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import { computeRealtimeSnapshot } from "../../modules/core/integrated/realtime/snapshot.js";
import {
	encodeSseEvent,
	SseClientTransport,
} from "../../modules/core/integrated/realtime/sse-client-transport.js";
import type { AdapterConfig, AdapterContext } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { handleError, sseHeaders } from "../utils/response.js";

// ============================================================================
// Types
// ============================================================================

type TopicInput = {
	/** Unique topic ID */
	id: string;
	/** Resource type */
	resourceType: "collection" | "global";
	/** Resource name */
	resource: string;
	/** WHERE filters */
	where?: Record<string, unknown>;
	/** Relations to include */
	with?: Record<string, unknown>;
	/** Pagination limit */
	limit?: number;
	/** Pagination offset */
	offset?: number;
	/** Order by */
	orderBy?: Record<string, "asc" | "desc">;
	/** Content locale override */
	locale?: string;
};

type ValidatedTopic = TopicInput & {
	type: "collection" | "global";
	crud: any;
};

type TopicState = {
	refreshInFlight: boolean;
	refreshQueued: boolean;
	lastSeq: number;
};

function isPermanentAccessError(error: unknown): boolean {
	return (
		error instanceof ApiError &&
		(error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED")
	);
}

// ============================================================================
// Standalone Handler
// ============================================================================

/**
 * Standalone realtime subscribe handler.
 *
 * POST /realtime
 * Body: { topics: [{ id, resourceType, resource, where?, with?, limit?, offset?, orderBy? }] }
 *
 * Response: SSE stream with events:
 * - snapshot: { topicId, seq, data }
 * - error: { topicId, message }
 * - ping: { ts }
 */
export async function realtimeSubscribe(
	app: Questpie<any>,
	request: Request,
	_params: Record<string, string>,
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

	// Only accept POST
	if (request.method !== "POST") {
		return errorResponse(
			ApiError.badRequest(
				"Method not allowed. Use POST.",
				undefined,
				"error.methodNotAllowed.useMethod",
				{ method: "POST" },
			),
			request,
		);
	}

	// Check if realtime is available
	if (!app.realtime) {
		return errorResponse(ApiError.notImplemented("Realtime"), request);
	}

	// Resolve context (auth, locale, etc.)
	const resolved = await resolveContext(app, request, config, context);

	// Parse request body
	let body: { topics?: TopicInput[] };
	try {
		body = await request.json();
	} catch {
		return errorResponse(
			ApiError.badRequest(
				"Invalid JSON body",
				undefined,
				"error.invalidJsonBody",
			),
			request,
			resolved.appContext.locale,
		);
	}

	const { topics } = body;

	// Validate topics
	if (!Array.isArray(topics) || topics.length === 0) {
		return errorResponse(
			ApiError.badRequest(
				"Topics array is required and must not be empty",
				undefined,
				"realtime.topicsRequired",
			),
			request,
			resolved.appContext.locale,
		);
	}

	// Validate and resolve all topics upfront
	const validatedTopics: ValidatedTopic[] = [];
	const topicErrors: Array<{ id: string; message: string }> = [];
	const collectionCruds = new Map<string, any>();
	const globalCruds = new Map<string, any>();
	const collectionApi = app.collections as Record<string, any>;
	const globalApi = app.globals as Record<string, any>;

	for (const topic of topics) {
		if (!topic.id || typeof topic.id !== "string") {
			topicErrors.push({
				id: topic.id ?? "unknown",
				message: app.t(
					"realtime.topicIdRequired",
					undefined,
					resolved.appContext.locale,
				),
			});
			continue;
		}

		if (!topic.resourceType || !topic.resource) {
			topicErrors.push({
				id: topic.id,
				message: app.t(
					"realtime.resourceRequired",
					undefined,
					resolved.appContext.locale,
				),
			});
			continue;
		}

		if (topic.resourceType === "collection") {
			const crud =
				collectionCruds.get(topic.resource) ?? collectionApi[topic.resource];
			if (!crud) {
				topicErrors.push({
					id: topic.id,
					message: app.t(
						"realtime.collectionNotFound",
						{ collection: topic.resource },
						resolved.appContext.locale,
					),
				});
				continue;
			}
			collectionCruds.set(topic.resource, crud);
			validatedTopics.push({ ...topic, type: "collection", crud });
		} else if (topic.resourceType === "global") {
			try {
				const crud =
					globalCruds.get(topic.resource) ?? globalApi[topic.resource];
				if (!crud) throw new Error("Global not found");
				globalCruds.set(topic.resource, crud);
				validatedTopics.push({ ...topic, type: "global", crud });
			} catch {
				topicErrors.push({
					id: topic.id,
					message: app.t(
						"realtime.globalNotFound",
						{ global: topic.resource },
						resolved.appContext.locale,
					),
				});
			}
		} else {
			topicErrors.push({
				id: topic.id,
				message: app.t(
					"realtime.invalidResourceType",
					{ resourceType: topic.resourceType },
					resolved.appContext.locale,
				),
			});
		}
	}

	// If no valid topics, return error
	if (validatedTopics.length === 0) {
		const errors = topicErrors.map((e) => `${e.id}: ${e.message}`).join("; ");
		return errorResponse(
			ApiError.badRequest(
				`No valid topics provided. Errors: ${errors}`,
				undefined,
				"realtime.noValidTopics",
				{ errors },
			),
			request,
			resolved.appContext.locale,
		);
	}

	const validatedTopicsById = new Map<string, ValidatedTopic>();
	for (const topic of validatedTopics) {
		// Preserve the existing first-match behavior for duplicate topic ids.
		if (!validatedTopicsById.has(topic.id)) {
			validatedTopicsById.set(topic.id, topic);
		}
	}

	// Create SSE stream
	let closeStream: (() => void) | null = null;

	const stream = new ReadableStream({
		start: async (controller) => {
			const topicUnsubscribers = new Map<string, () => void>();
			let closed = false;
			let closeRequested = false;

			// Per-topic state
			const topicState = new Map<string, TopicState>();
			const requestClose = () => {
				closeRequested = true;
				closeStream?.();
			};
			const transport = new SseClientTransport(controller);
			await transport.start({ onError: requestClose });
			const sink = await transport.openSession({
				sessionId: globalThis.crypto.randomUUID(),
				principal: resolved.appContext.principal ?? null,
				resolvePrincipal: async () => resolved.appContext.principal ?? null,
			});

			// Helper to send SSE event
			const send = async (event: string, data: unknown) => {
				if (closed) return;
				await sink.write(encodeSseEvent(event, data), "latest-snapshot");
			};

			// Send per-topic error
			const sendTopicError = (topicId: string, message: string) => {
				return send("error", { topicId, message });
			};

			const teardownTopic = (topicId: string) => {
				const unsubscribe = topicUnsubscribers.get(topicId);
				if (!unsubscribe) return;

				topicUnsubscribers.delete(topicId);
				topicState.delete(topicId);
				unsubscribe();
				if (topicUnsubscribers.size === 0) requestClose();
			};

			// Refresh a single topic
			const refresh = async (topicId: string, seq?: number) => {
				const topic = validatedTopicsById.get(topicId);
				const state = topicState.get(topicId);
				if (!topic || !state || closed) return;

				if (typeof seq === "number") {
					state.lastSeq = Math.max(state.lastSeq, seq);
				}

				if (state.refreshInFlight) {
					state.refreshQueued = true;
					return;
				}

				state.refreshInFlight = true;

				// Use topic-specific locale if provided, otherwise fall back to request locale
				const topicContext =
					topic.locale && topic.locale !== resolved.appContext.locale
						? { ...resolved.appContext, locale: topic.locale }
						: resolved.appContext;

				try {
					do {
						state.refreshQueued = false;
						const data = await computeRealtimeSnapshot(topic, topicContext);

						await send("snapshot", { topicId, seq: state.lastSeq, data });
					} while (state.refreshQueued && !closed);
				} catch (error) {
					await sendTopicError(
						topicId,
						error instanceof Error ? error.message : "Unknown error",
					);
					if (isPermanentAccessError(error)) teardownTopic(topicId);
				} finally {
					state.refreshInFlight = false;
				}
			};

			// Subscribe to each topic
			for (const topic of validatedTopics) {
				topicState.set(topic.id, {
					refreshInFlight: false,
					refreshQueued: false,
					lastSeq: 0,
				});

				const unsub = app.realtime!.subscribe(
					(event) => {
						void refresh(topic.id, event.seq).catch((error) => {
							void sendTopicError(
								topic.id,
								error instanceof Error ? error.message : "Refresh failed",
							).catch(requestClose);
						});
					},
					{
						resourceType: topic.resourceType,
						resource: topic.resource,
						where: topic.where,
						with: topic.with,
					},
					(error) => {
						void send("error", {
							topicId: "*",
							message:
								error instanceof Error
									? error.message
									: "Realtime transport failed",
						})
							.catch(() => {})
							.finally(requestClose);
					},
				);
				topicUnsubscribers.set(topic.id, unsub);
			}

			// Send initial errors for invalid topics
			for (const error of topicErrors) {
				await sendTopicError(error.id, error.message);
			}

			// Ping timer to keep the connection alive. Default 8s — strictly under
			// Bun's default 10s idleTimeout and typical proxy timeouts of 30-60s.
			const keepAliveIntervalMs =
				app.config?.realtime?.keepAliveIntervalMs ?? 8000;
			const pingTimer = setInterval(() => {
				void send("ping", { ts: Date.now() }).catch(requestClose);
			}, keepAliveIntervalMs);

			// Cleanup function
			const close = () => {
				if (closed) return;
				closed = true;
				clearInterval(pingTimer);
				request.signal.removeEventListener("abort", close);
				for (const unsub of topicUnsubscribers.values()) {
					unsub();
				}
				topicUnsubscribers.clear();
				topicState.clear();
				void transport.stop().catch(() => {});
			};
			closeStream = close;
			if (closeRequested) close();

			// Handle abort signal
			if (request.signal) {
				request.signal.addEventListener("abort", close);
			}

			// Send initial snapshots
			void (async () => {
				const latestSeq = (await app.realtime?.getLatestSeq()) ?? 0;

				// Initialize all topic states with latest seq
				for (const topic of validatedTopics) {
					const state = topicState.get(topic.id);
					if (state) {
						state.lastSeq = latestSeq;
					}
				}

				// Fetch initial snapshots for all topics
				await Promise.all(
					validatedTopics.map((topic) => refresh(topic.id, latestSeq)),
				);
			})().catch((error) => {
				void send("error", {
					topicId: "*",
					message:
						error instanceof Error ? error.message : "Failed to initialize",
				}).catch(requestClose);
			});
		},
		cancel: () => {
			closeStream?.();
		},
	});

	return new Response(stream, {
		headers: sseHeaders,
	});
}

// ============================================================================
// Legacy closure factory (deprecated)
// ============================================================================

/**
 * @deprecated Use standalone `realtimeSubscribe` instead.
 */
export const createRealtimeRoutes = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	config: AdapterConfig<TConfig> = {},
) => {
	return {
		subscribe: async (
			request: Request,
			_params: Record<string, string>,
			context?: AdapterContext,
		): Promise<Response> => {
			return realtimeSubscribe(app, request, _params, context, config);
		},
	};
};
