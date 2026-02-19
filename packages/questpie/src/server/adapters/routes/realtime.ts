/**
 * Realtime Routes
 *
 * Unified SSE endpoint for multiplexed realtime updates.
 * Accepts multiple topics via POST and streams updates for all of them.
 */

import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
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

// ============================================================================
// Route Handler
// ============================================================================

export const createRealtimeRoutes = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(app: Questpie<TConfig>,
	config: AdapterConfig<TConfig> = {},
) => {
	const errorResponse = (
		error: unknown,
		request: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request, app, locale });
	};

	return {
		/**
		 * Unified SSE endpoint for multiplexed realtime subscriptions.
		 *
		 * POST /realtime
		 * Body: { topics: [{ id, resourceType, resource, where?, with?, limit?, offset?, orderBy? }] }
		 *
		 * Response: SSE stream with events:
		 * - snapshot: { topicId, seq, data }
		 * - error: { topicId, message }
		 * - ping: { ts }
		 */
		subscribe: async (
			request: Request,
			_params: Record<string, string>,
			context?: AdapterContext,
		): Promise<Response> => {
			// Only accept POST
			if (request.method !== "POST") {
				return errorResponse(
					ApiError.badRequest("Method not allowed. Use POST."),
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
					ApiError.badRequest("Invalid JSON body"),
					request,
					resolved.appContext.locale,
				);
			}

			const { topics } = body;

			// Validate topics
			if (!Array.isArray(topics) || topics.length === 0) {
				return errorResponse(
					ApiError.badRequest("Topics array is required and must not be empty"),
					request,
					resolved.appContext.locale,
				);
			}

			// Validate and resolve all topics upfront
			const validatedTopics: ValidatedTopic[] = [];
			const topicErrors: Array<{ id: string; message: string }> = [];

			for (const topic of topics) {
				if (!topic.id || typeof topic.id !== "string") {
					topicErrors.push({
						id: topic.id ?? "unknown",
						message: "Topic ID is required",
					});
					continue;
				}

				if (!topic.resourceType || !topic.resource) {
					topicErrors.push({
						id: topic.id,
						message: "resourceType and resource are required",
					});
					continue;
				}

				if (topic.resourceType === "collection") {
					const crud = app.api.collections[topic.resource as any];
					if (!crud) {
						topicErrors.push({
							id: topic.id,
							message: `Collection "${topic.resource}" not found`,
						});
						continue;
					}
					validatedTopics.push({ ...topic, type: "collection", crud });
				} else if (topic.resourceType === "global") {
					try {
						const globalConfig = app.getGlobalConfig(topic.resource as any);
						const crud = globalConfig.generateCRUD(resolved.appContext.db, app);
						validatedTopics.push({ ...topic, type: "global", crud });
					} catch {
						topicErrors.push({
							id: topic.id,
							message: `Global "${topic.resource}" not found`,
						});
					}
				} else {
					topicErrors.push({
						id: topic.id,
						message: `Invalid resourceType "${topic.resourceType}"`,
					});
				}
			}

			// If no valid topics, return error
			if (validatedTopics.length === 0) {
				return errorResponse(
					ApiError.badRequest(
						`No valid topics provided. Errors: ${topicErrors.map((e) => `${e.id}: ${e.message}`).join("; ")}`,
					),
					request,
					resolved.appContext.locale,
				);
			}

			// Create SSE stream
			const encoder = new TextEncoder();
			let closeStream: (() => void) | null = null;

			const stream = new ReadableStream({
				start: (controller) => {
					const unsubscribers: (() => void)[] = [];
					let closed = false;

					// Per-topic state
					const topicState = new Map<string, TopicState>();

					// Helper to send SSE event
					const send = (event: string, data: unknown) => {
						if (closed) return;
						try {
							controller.enqueue(
								encoder.encode(
									`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
								),
							);
						} catch {
							// Controller may be closed
						}
					};

					// Send per-topic error
					const sendTopicError = (topicId: string, message: string) => {
						send("error", { topicId, message });
					};

					// Refresh a single topic
					const refresh = async (topicId: string, seq?: number) => {
						const topic = validatedTopics.find((t) => t.id === topicId);
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
								let data: unknown;

								if (topic.type === "collection") {
									data = await topic.crud.find(
										{
											where: topic.where,
											with: topic.with,
											limit: topic.limit,
											offset: topic.offset,
											orderBy: topic.orderBy,
											locale: topic.locale,
										},
										topicContext,
									);
								} else {
									data = await topic.crud.get(
										{
											where: topic.where,
											with: topic.with,
											locale: topic.locale,
										},
										topicContext,
									);
								}

								send("snapshot", { topicId, seq: state.lastSeq, data });
							} while (state.refreshQueued && !closed);
						} catch (error) {
							sendTopicError(
								topicId,
								error instanceof Error ? error.message : "Unknown error",
							);
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
								void refresh(topic.id, event.seq);
							},
							{
								resourceType: topic.resourceType,
								resource: topic.resource,
								where: topic.where,
								with: topic.with,
							},
						);
						unsubscribers.push(unsub);
					}

					// Send initial errors for invalid topics
					for (const error of topicErrors) {
						sendTopicError(error.id, error.message);
					}

					// Ping timer to keep connection alive
					const pingTimer = setInterval(() => {
						send("ping", { ts: Date.now() });
					}, 25000);

					// Cleanup function
					const close = () => {
						if (closed) return;
						closed = true;
						clearInterval(pingTimer);
						for (const unsub of unsubscribers) {
							unsub();
						}
						try {
							controller.close();
						} catch {
							// Controller may already be closed
						}
					};
					closeStream = close;

					// Handle abort signal
					if (request.signal) {
						request.signal.addEventListener("abort", close);
					}

					// Send initial snapshots
					void (async () => {
						try {
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
						} catch (error) {
							send("error", {
								topicId: "*",
								message:
									error instanceof Error
										? error.message
										: "Failed to initialize",
							});
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
