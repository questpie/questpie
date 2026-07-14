/**
 * Realtime Routes
 *
 * Unified SSE endpoint for multiplexed realtime updates.
 * Accepts multiple topics via POST and streams updates for all of them.
 */

import { executeAccessRule } from "../../collection/crud/shared/access-control.js";
import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import {
	admitRealtimeTopic,
	createConcurrencyLimiter,
	getRealtimeAdmissionRegistry,
	realtimePrincipalKey,
	resolveRealtimeAdmissionConfig,
} from "../../modules/core/integrated/realtime/admission.js";
import {
	getRealtimeRefreshScheduler,
	resolveRealtimeAccessKey,
} from "../../modules/core/integrated/realtime/refresh-scheduler.js";
import { computeRealtimeSnapshot } from "../../modules/core/integrated/realtime/snapshot.js";
import {
	encodeSseEvent,
	RealtimeSnapshotBufferOverflowError,
	SseClientTransport,
	SseLatestSnapshotWriter,
} from "../../modules/core/integrated/realtime/sse-client-transport.js";
import { sharedSseKeepAliveTicker } from "../../modules/core/integrated/realtime/sse-keep-alive.js";
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
	definition: any;
	accessWhere?: true | Record<string, unknown>;
	requestedWhere?: Record<string, unknown>;
	accessCacheKey?: (
		context: any,
	) => string | null | undefined | Promise<string | null | undefined>;
};

function mergeAccessWhere(
	where: Record<string, unknown> | undefined,
	access: true | Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (access === true) return where;
	return where ? { AND: [access, where] } : access;
}

async function evaluateTopicAccess(
	app: Questpie<any>,
	topic: ValidatedTopic,
	context: any,
): Promise<ValidatedTopic> {
	if (context.accessMode === "system") return topic;
	const rule = topic.definition.state.access?.read ?? app.defaultAccess?.read;
	const result = await executeAccessRule(rule, {
		app,
		db: context.db,
		session: context.session,
		locale: context.locale,
		row: null,
		input: {
			where: topic.requestedWhere,
			with: topic.with,
			limit: topic.limit,
			offset: topic.offset,
			orderBy: topic.orderBy,
		},
		request: context.request ?? context.req,
		contextExtensions: context["~contextExtensions"],
	});
	if (result === false) {
		throw ApiError.forbidden({
			operation: "read",
			resource: topic.resource,
			reason: "User does not have permission to subscribe",
		});
	}
	if (topic.type === "global" && result !== true) {
		throw ApiError.forbidden({
			operation: "read",
			resource: topic.resource,
			reason: "Global access rules must admit the topic explicitly",
		});
	}
	return {
		...topic,
		accessWhere: result,
		where: mergeAccessWhere(topic.requestedWhere, result),
	};
}

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, stableValue(entry)]),
	);
}

function schedulerKey(topic: ValidatedTopic, accessKey: string): string {
	const {
		crud: _crud,
		definition: _definition,
		accessWhere: _accessWhere,
		accessCacheKey: _accessCacheKey,
		requestedWhere: _requestedWhere,
		type: _type,
		...input
	} = topic;
	return `${JSON.stringify(stableValue(input))}:${accessKey}`;
}

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
 * Keepalive frames are SSE comments and are intentionally invisible to clients.
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
	const admission = resolveRealtimeAdmissionConfig(
		app.config?.realtime?.admission,
	);

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
	const collectionDefinitions = app.getCollections() as Record<string, any>;
	const globalDefinitions = app.getGlobals() as Record<string, any>;

	for (const [topicIndex, rawTopic] of topics.entries()) {
		if (!rawTopic || typeof rawTopic !== "object" || Array.isArray(rawTopic)) {
			topicErrors.push({ id: "unknown", message: "Topic must be an object" });
			continue;
		}
		let topic = rawTopic;
		if (topicIndex >= admission.maxTopicsPerConnection) {
			topicErrors.push({
				id: topic.id ?? "unknown",
				message: `Connection accepts at most ${admission.maxTopicsPerConnection} topics`,
			});
			continue;
		}
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

		const topicAdmission = admitRealtimeTopic(topic, admission);
		if (!topicAdmission.accepted) {
			topicErrors.push({ id: topic.id, message: topicAdmission.message });
			continue;
		}
		topic = topicAdmission.topic;

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
			const definition = collectionDefinitions[topic.resource];
			validatedTopics.push({
				...topic,
				type: "collection",
				crud,
				definition,
				requestedWhere: topic.where,
				accessCacheKey: definition?.state.options.realtime?.accessCacheKey,
			});
		} else if (topic.resourceType === "global") {
			try {
				const crud =
					globalCruds.get(topic.resource) ?? globalApi[topic.resource];
				if (!crud) throw new Error("Global not found");
				globalCruds.set(topic.resource, crud);
				const definition = globalDefinitions[topic.resource];
				validatedTopics.push({
					...topic,
					type: "global",
					crud,
					definition,
					requestedWhere: topic.where,
					accessCacheKey: definition?.state.options.realtime?.accessCacheKey,
				});
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

	const accessValidatedTopics: ValidatedTopic[] = [];
	for (const topic of validatedTopics) {
		const topicContext =
			topic.locale && topic.locale !== resolved.appContext.locale
				? { ...resolved.appContext, locale: topic.locale }
				: resolved.appContext;
		try {
			accessValidatedTopics.push(
				await evaluateTopicAccess(app, topic, topicContext),
			);
		} catch (error) {
			topicErrors.push({
				id: topic.id,
				message: error instanceof Error ? error.message : "Access denied",
			});
		}
	}

	if (accessValidatedTopics.length === 0) {
		const errors = topicErrors
			.map((error) => `${error.id}: ${error.message}`)
			.join("; ");
		return errorResponse(
			ApiError.badRequest(
				`No topics admitted. Errors: ${errors}`,
				undefined,
				"realtime.noAdmittedTopics",
				{ errors },
			),
			request,
			resolved.appContext.locale,
		);
	}

	const validatedTopicsById = new Map<string, ValidatedTopic>();
	for (const topic of accessValidatedTopics) {
		// Preserve the existing first-match behavior for duplicate topic ids.
		if (!validatedTopicsById.has(topic.id)) {
			validatedTopicsById.set(topic.id, topic);
		}
	}

	const admissionRegistry = getRealtimeAdmissionRegistry(
		app,
		admission.maxConnectionsPerPrincipal,
	);
	const releaseConnection = admissionRegistry.acquire(
		realtimePrincipalKey(resolved.appContext),
	);
	if (!releaseConnection) {
		return errorResponse(
			ApiError.badRequest(
				"Realtime connection limit exceeded",
				undefined,
				"realtime.connectionLimitExceeded",
			),
			request,
			resolved.appContext.locale,
		);
	}

	// Create SSE stream
	let closeStream: (() => void) | null = null;
	let flushPending: (() => void) | null = null;
	let streamCancelled = false;
	const highWaterMarkBytes = admission.maxBufferedSnapshotBytes;

	const streamSource: UnderlyingDefaultSource<Uint8Array> = {
		start: async (controller) => {
			let transport: SseClientTransport | null = null;
			try {
				const topicUnsubscribers = new Map<string, () => void>();
				let closed = false;
				let closeRequested = false;

				const requestClose = () => {
					closeRequested = true;
					closeStream?.();
				};
				transport = new SseClientTransport(controller, highWaterMarkBytes);
				await transport.start({ onError: requestClose });
				const edgeSessionId = globalThis.crypto.randomUUID();
				const sink = await transport.openSession({
					sessionId: edgeSessionId,
					principal: resolved.appContext.principal ?? null,
					resolvePrincipal: async () => resolved.appContext.principal ?? null,
				});
				const snapshotWriter = new SseLatestSnapshotWriter(
					sink,
					admission.maxBufferedSnapshotBytes,
				);
				const refreshScheduler = getRealtimeRefreshScheduler(
					app,
					app.realtime!,
				);
				const limitSnapshotConcurrency = createConcurrencyLimiter(
					admission.initialSnapshotConcurrency,
				);
				let removeKeepAlive = () => {};
				flushPending = () => {
					void snapshotWriter.flush().catch(requestClose);
				};
				const close = () => {
					if (closed) return;
					closed = true;
					releaseConnection();
					removeKeepAlive();
					flushPending = null;
					snapshotWriter.clear();
					request.signal.removeEventListener("abort", close);
					for (const unsub of topicUnsubscribers.values()) {
						unsub();
					}
					topicUnsubscribers.clear();
					void transport?.stop().catch(() => {});
				};
				closeStream = close;
				if (closeRequested || streamCancelled || request.signal.aborted) {
					close();
					return;
				}
				request.signal.addEventListener("abort", close);

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
					unsubscribe();
					if (topicUnsubscribers.size === 0) requestClose();
				};

				// Subscribe to each topic
				for (const topic of validatedTopicsById.values()) {
					if (closed) break;
					const topicContext =
						topic.locale && topic.locale !== resolved.appContext.locale
							? { ...resolved.appContext, locale: topic.locale }
							: resolved.appContext;
					const accessKey = await resolveRealtimeAccessKey(
						edgeSessionId,
						topicContext,
						topic.accessCacheKey,
					);
					const unsub = refreshScheduler.subscribe({
						key: schedulerKey(topic, accessKey),
						topicId: topic.id,
						topics: {
							resourceType: topic.resourceType,
							resource: topic.resource,
							where: topic.where,
							with: topic.with,
						},
						compute: () =>
							limitSnapshotConcurrency(async () => {
								const admittedTopic = await evaluateTopicAccess(
									app,
									topic,
									topicContext,
								);
								return computeRealtimeSnapshot(admittedTopic, topicContext);
							}),
						onFrame: async (frame) => {
							if (frame.byteLength > admission.maxBufferedSnapshotBytes) {
								await sendTopicError(
									topic.id,
									`Snapshot exceeds ${admission.maxBufferedSnapshotBytes} bytes`,
								);
								teardownTopic(topic.id);
								return;
							}
							await snapshotWriter.write(topic.id, frame);
						},
						onError: (error) => {
							void sendTopicError(
								topic.id,
								error instanceof Error ? error.message : "Refresh failed",
							)
								.catch(requestClose)
								.finally(() => {
									if (
										isPermanentAccessError(error) ||
										error instanceof RealtimeSnapshotBufferOverflowError
									) {
										teardownTopic(topic.id);
									}
								});
						},
						onTransportError: (error) => {
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
					});
					topicUnsubscribers.set(topic.id, unsub);
				}

				// Send initial errors for invalid topics
				for (const error of topicErrors) {
					await sendTopicError(error.id, error.message);
				}
				if (closed) return;

				// Shared ping ticker keeps the connection alive. Default 8s — strictly under
				// Bun's default 10s idleTimeout and typical proxy timeouts of 30-60s.
				const keepAliveIntervalMs =
					app.config?.realtime?.keepAliveIntervalMs ?? 8000;
				removeKeepAlive = sharedSseKeepAliveTicker.register(
					keepAliveIntervalMs,
					(frame) => {
						void sink.write(frame, "latest-snapshot").catch(requestClose);
					},
				);

				if (closeRequested || streamCancelled) close();
			} catch (error) {
				closeStream?.();
				releaseConnection();
				void transport?.stop().catch(() => {});
				try {
					controller.error(error);
				} catch {
					// The controller can already be errored by the runtime.
				}
			}
		},
		pull: () => {
			flushPending?.();
		},
		cancel: () => {
			streamCancelled = true;
			releaseConnection();
			closeStream?.();
		},
	};
	const stream = new ReadableStream<Uint8Array>(streamSource, {
		highWaterMark: highWaterMarkBytes,
		size: (frame) => frame?.byteLength ?? 0,
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
