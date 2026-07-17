/**
 * Realtime Routes
 *
 * Unified SSE endpoint for multiplexed realtime updates.
 * Accepts multiple topics via POST and streams updates for all of them.
 */

import type { RealtimeTopicRejectedPayload } from "#questpie/shared/realtime-error.js";

import {
	ChannelsService,
	type ChannelServiceContext,
} from "../../channels/service.js";
import { executeAccessRule } from "../../collection/crud/shared/access-control.js";
import type { RequestContext } from "../../config/context.js";
import type { Questpie } from "../../config/questpie.js";
import { ApiError } from "../../errors/index.js";
import {
	admitRealtimeTopic,
	createConcurrencyLimiter,
	getRealtimeAdmissionRegistry,
	RealtimeTopicAdmissionError,
	realtimeTopicRejectedPayload,
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
import type { RealtimeDesiredTopology } from "../../modules/core/integrated/realtime/topology-coordinator.js";
import type { ClientSink } from "../../modules/core/integrated/realtime/transport.js";
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
	/** Query operation; omitted values are normalized by resource type. */
	operation?: "find" | "count" | "get";
	/** Record id for a collection `get` topic. */
	recordId?: string;
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
	/** Last snapshot sequence applied by the reconnecting client. */
	sinceSeq?: number;
};

type NormalizedTopicInput =
	| (TopicInput & { resourceType: "collection"; operation: "find" })
	| (TopicInput & { resourceType: "collection"; operation: "count" })
	| (TopicInput & {
			resourceType: "collection";
			operation: "get";
			recordId: string;
	  })
	| (TopicInput & { resourceType: "global"; operation: "get" });

type ValidatedTopicMetadata = {
	crud: any;
	definition: any;
	accessWhere?: true | Record<string, unknown>;
	requestedWhere?: Record<string, unknown>;
	accessCacheKey?: (
		context: RealtimeRequestContext,
	) => string | null | undefined | Promise<string | null | undefined>;
};

type RealtimeRequestContext = RequestContext & {
	request?: Request;
	req?: Request;
};

type ValidatedTopic =
	| (Extract<NormalizedTopicInput, { resourceType: "collection" }> &
			ValidatedTopicMetadata & { type: "collection" })
	| (Extract<NormalizedTopicInput, { resourceType: "global" }> &
			ValidatedTopicMetadata & { type: "global" });

type ChannelSubscriptionInput = {
	id?: string;
	channel?: string;
	params?: Record<string, string>;
	lastEventId?: string;
};

type ValidatedChannelSubscription = {
	id: string;
	channel: string;
	params: Record<string, string>;
	resolvedName: string;
	lastEventId?: string;
	presence?: Record<string, unknown>;
};

function createInitialTopology(
	topics: TopicInput[],
	channels: ChannelSubscriptionInput[],
	validTopicIds: ReadonlySet<string>,
	validChannelIds: ReadonlySet<string>,
): RealtimeDesiredTopology {
	return {
		protocol: "questpie-realtime-topology",
		version: 1,
		revision: 0,
		topics: topics
			.filter((topic) => validTopicIds.has(topic.id))
			.map(({ id, sinceSeq, ...topic }) => ({
				id,
				topic,
				...(sinceSeq === undefined ? {} : { sinceSeq }),
			})),
		channels: channels
			.filter(
				(
					channel,
				): channel is Required<
					Pick<ChannelSubscriptionInput, "id" | "channel" | "params">
				> &
					ChannelSubscriptionInput =>
					Boolean(channel.id && validChannelIds.has(channel.id)),
			)
			.map(({ id, channel, params, lastEventId }) => ({
				id,
				channel,
				params,
				...(lastEventId === undefined ? {} : { lastEventId }),
			})),
	};
}

function normalizeTopicOperation(topic: TopicInput): NormalizedTopicInput {
	if (topic.resourceType !== "collection" && topic.resourceType !== "global") {
		throw new Error("Invalid realtime resource type");
	}
	const operation =
		topic.operation ?? (topic.resourceType === "global" ? "get" : "find");
	if (operation !== "find" && operation !== "count" && operation !== "get") {
		throw new Error("Invalid realtime topic operation");
	}
	if (topic.resourceType === "global") {
		if (operation !== "get") {
			throw new Error("Global realtime topics only support the get operation");
		}
		return { ...topic, resourceType: "global", operation: "get" };
	}
	if (operation === "get") {
		if (!topic.recordId || typeof topic.recordId !== "string") {
			throw new Error("Collection get topics require a record id");
		}
		if (
			topic.where ||
			topic.limit !== undefined ||
			topic.offset !== undefined ||
			topic.orderBy
		) {
			throw new Error(
				"Collection get topics accept only recordId, with, and locale",
			);
		}
		return {
			...topic,
			resourceType: "collection",
			operation: "get",
			recordId: topic.recordId,
		};
	}
	if (operation === "count") {
		if (
			topic.with ||
			topic.limit !== undefined ||
			topic.offset !== undefined ||
			topic.orderBy ||
			topic.recordId
		) {
			throw new Error("Collection count topics accept only where and locale");
		}
		return { ...topic, resourceType: "collection", operation: "count" };
	}
	return { ...topic, resourceType: "collection", operation: "find" };
}

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
	context: RealtimeRequestContext,
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

function realtimeControlIdentity(context: RealtimeRequestContext): string {
	const principal = context.principal;
	if (principal?.kind === "user" && principal.session?.id) {
		return `user-session:${principal.session.id}`;
	}
	if (principal?.kind === "oauth" && principal.tokenId) {
		return `oauth:${principal.tokenId}`;
	}
	if (principal?.kind === "system") return "system";
	const sessionId = context.session?.session?.id;
	return sessionId ? `user-session:${sessionId}` : "anonymous";
}

async function resolveIncrementalTopic(
	app: Questpie<any>,
	rawTopic: TopicInput,
	context: RealtimeRequestContext,
	admission: ReturnType<typeof resolveRealtimeAdmissionConfig>,
): Promise<ValidatedTopic> {
	if (!rawTopic.id || typeof rawTopic.id !== "string") {
		throw new Error("Topic id is required");
	}
	if (!rawTopic.resourceType || !rawTopic.resource) {
		throw new Error("Topic resource is required");
	}
	if (
		rawTopic.sinceSeq !== undefined &&
		(!Number.isSafeInteger(rawTopic.sinceSeq) || rawTopic.sinceSeq < 0)
	) {
		throw new Error("Topic sinceSeq must be a non-negative safe integer");
	}
	const normalizedTopic = normalizeTopicOperation(rawTopic);
	const topicAdmission = admitRealtimeTopic(normalizedTopic, admission);
	if (!topicAdmission.accepted) {
		throw new RealtimeTopicAdmissionError(
			realtimeTopicRejectedPayload(normalizedTopic, topicAdmission),
		);
	}
	const topic = topicAdmission.topic;

	if (topic.resourceType === "collection") {
		const crud = (app.collections as Record<string, any>)[topic.resource];
		const definition = (app.getCollections() as Record<string, any>)[
			topic.resource
		];
		if (!crud || !definition) throw new Error("Collection not found");
		return evaluateTopicAccess(
			app,
			{
				...topic,
				type: "collection",
				crud,
				definition,
				requestedWhere: topic.where,
				accessCacheKey: definition.state.options.realtime?.accessCacheKey,
			},
			context,
		);
	}

	if (topic.resourceType === "global") {
		const crud = (app.globals as Record<string, any>)[topic.resource];
		const definition = (app.getGlobals() as Record<string, any>)[
			topic.resource
		];
		if (!crud || !definition) throw new Error("Global not found");
		return evaluateTopicAccess(
			app,
			{
				...topic,
				type: "global",
				crud,
				definition,
				requestedWhere: topic.where,
				accessCacheKey: definition.state.options.realtime?.accessCacheKey,
			},
			context,
		);
	}

	throw new Error("Invalid resource type");
}

async function resolveChannelSubscription(
	app: Questpie<any>,
	input: ChannelSubscriptionInput,
	context: RealtimeRequestContext,
): Promise<ValidatedChannelSubscription> {
	if (!input.id || typeof input.id !== "string") {
		throw new Error("Channel subscription id is required");
	}
	if (!input.channel || typeof input.channel !== "string") {
		throw new Error("Channel registry key is required");
	}
	if (
		input.lastEventId !== undefined &&
		typeof input.lastEventId !== "string"
	) {
		throw new Error("Channel lastEventId must be a string");
	}
	const params = input.params ?? {};
	if (
		!params ||
		typeof params !== "object" ||
		Array.isArray(params) ||
		Object.values(params).some((value) => typeof value !== "string")
	) {
		throw new Error("Channel params must be a string record");
	}
	const channels = new ChannelsService(
		app.config.channels ?? {},
		app.realtime,
		{ ...context, accessMode: "user" } as ChannelServiceContext,
		app.config.realtime?.channelSecurity,
	);
	const definition = channels.getDefinition(input.channel);
	const resolvedName = channels.resolveName(input.channel, params);
	let presence: Record<string, unknown> | undefined;
	if (definition.visibility === "presence") {
		const value = await channels.resolvePresence(input.channel, params);
		if (value && typeof value === "object") {
			presence = value as Record<string, unknown>;
		}
	} else if (!(await channels.authorize(input.channel, params, "subscribe"))) {
		throw new Error("Channel subscription is denied");
	}
	return {
		id: input.id,
		channel: input.channel,
		params,
		resolvedName,
		...(input.lastEventId ? { lastEventId: input.lastEventId } : {}),
		...(presence ? { presence } : {}),
	};
}

// ============================================================================
// Standalone Handler
// ============================================================================

/**
 * Standalone realtime subscribe handler.
 *
 * POST /realtime
 * Initial body: { topics: [{ id, resourceType, resource, where?, with?, limit?, offset?, orderBy?, sinceSeq? }] }
 * Control body: { sessionId, token, topology: { protocol, version, revision, topics, channels } }
 *
 * Response: SSE stream with events:
 * - session: { sessionId, token }
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
	const observeAdmission = (
		reason:
			| "connection_limit"
			| "subscription_limit"
			| "query_limit"
			| "relation_depth"
			| "snapshot_bytes"
			| "access",
		details: Partial<
			Pick<RealtimeTopicRejectedPayload, "resource" | "operation"> & {
				requestedLimit?: number;
				configuredLimit?: number;
			}
		> = {},
	) =>
		app.realtime!.record({
			type: "admission.rejected",
			reason,
			...details,
			rolloutMode: "v2",
		});
	const observeTopicRejection = (error: RealtimeTopicAdmissionError) =>
		observeAdmission(error.payload.details.reason, {
			resource: error.payload.resource,
			operation: error.payload.operation,
			requestedLimit: error.payload.details.requestedLimit,
			configuredLimit: error.payload.details.configuredLimit,
		});

	// Resolve context (auth, locale, etc.)
	const resolved = await resolveContext(app, request, config, context);

	// Parse request body
	let body: {
		topics?: TopicInput[];
		channels?: ChannelSubscriptionInput[];
		transport?: "shared-provider";
		sessionId?: string;
		token?: string;
		topology?: RealtimeDesiredTopology;
	};
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

	const { channels: channelInputs, topics } = body;
	const admission = resolveRealtimeAdmissionConfig(
		app.config?.realtime?.admission,
	);
	if (body.topology !== undefined) {
		if (
			!body.sessionId ||
			!body.token ||
			body.topology.protocol !== "questpie-realtime-topology" ||
			!Number.isSafeInteger(body.topology.revision) ||
			body.topology.revision < 1 ||
			!Array.isArray(body.topology.topics) ||
			!Array.isArray(body.topology.channels) ||
			body.topology.topics.length + body.topology.channels.length >
				admission.maxTopicsPerConnection
		) {
			return Response.json(
				{
					error: {
						code: "REALTIME_TOPOLOGY_INVALID",
						message: "Invalid realtime topology request",
					},
				},
				{ status: 400 },
			);
		}
		try {
			for (const desired of body.topology.topics) {
				await resolveIncrementalTopic(
					app,
					{
						...desired.topic,
						id: desired.id,
						sinceSeq: desired.sinceSeq,
					} as TopicInput,
					resolved.appContext,
					admission,
				);
			}
			for (const desired of body.topology.channels) {
				await resolveChannelSubscription(
					app,
					{
						id: desired.id,
						channel: desired.channel,
						params: desired.params,
						lastEventId: desired.lastEventId,
					},
					resolved.appContext,
				);
			}
			let result;
			try {
				result = await app.realtime.submitTopology({
					sessionId: body.sessionId,
					token: body.token,
					identity: realtimeControlIdentity(resolved.appContext),
					topology: body.topology,
				});
			} catch {
				return Response.json(
					{
						error: {
							code: "REALTIME_TOPOLOGY_STORAGE_UNAVAILABLE",
							message: "Realtime topology storage is unavailable",
						},
					},
					{ status: 503 },
				);
			}
			if (result.status === "unavailable") {
				return Response.json(
					{
						error: {
							code: "REALTIME_CONTROL_UNAVAILABLE",
							message: "Realtime control session is unavailable",
						},
					},
					{ status: 404 },
				);
			}
			if (result.status !== "accepted" && result.status !== "duplicate") {
				const code =
					result.status === "stale"
						? "REALTIME_TOPOLOGY_STALE"
						: result.status === "conflict"
							? "REALTIME_TOPOLOGY_REVISION_CONFLICT"
							: result.status === "unsupported"
								? "REALTIME_TOPOLOGY_VERSION_UNSUPPORTED"
								: "REALTIME_TOPOLOGY_INVALID";
				return Response.json(
					{ error: { code, message: "Realtime topology was rejected" } },
					{
						status:
							result.status === "unsupported" || result.status === "invalid"
								? 400
								: 409,
					},
				);
			}
			return Response.json(
				{
					protocol: "questpie-realtime-topology",
					version: 1,
					...result,
				},
				{ status: result.status === "accepted" ? 202 : 200 },
			);
		} catch (error) {
			if (error instanceof RealtimeTopicAdmissionError) {
				observeTopicRejection(error);
				return Response.json({ error: error.payload }, { status: 400 });
			}
			return Response.json(
				{
					error: {
						code: "REALTIME_TOPOLOGY_INVALID",
						message: "Invalid realtime topology request",
					},
				},
				{ status: 400 },
			);
		}
	}
	if (body.sessionId || body.token) {
		return Response.json(
			{
				error: {
					code: "REALTIME_TOPOLOGY_INVALID",
					message: "Realtime control requires desired topology protocol v1",
				},
			},
			{ status: 400 },
		);
	}

	// Initial sessions may carry live-query topics, framework channels, or both.
	if (
		(topics !== undefined && !Array.isArray(topics)) ||
		(channelInputs !== undefined && !Array.isArray(channelInputs)) ||
		((topics?.length ?? 0) === 0 && (channelInputs?.length ?? 0) === 0)
	) {
		return errorResponse(
			ApiError.badRequest(
				"At least one realtime topic or channel is required",
				undefined,
				"realtime.topicsRequired",
			),
			request,
			resolved.appContext.locale,
		);
	}

	// Validate and resolve all topics upfront
	const validatedTopics: ValidatedTopic[] = [];
	const topicErrors: Array<{
		id: string;
		message: string;
		rejection?: RealtimeTopicRejectedPayload;
	}> = [];
	const collectionCruds = new Map<string, any>();
	const globalCruds = new Map<string, any>();
	const collectionApi = app.collections as Record<string, any>;
	const globalApi = app.globals as Record<string, any>;
	const collectionDefinitions = app.getCollections() as Record<string, any>;
	const globalDefinitions = app.getGlobals() as Record<string, any>;

	for (const [topicIndex, rawTopic] of (topics ?? []).entries()) {
		if (!rawTopic || typeof rawTopic !== "object" || Array.isArray(rawTopic)) {
			topicErrors.push({ id: "unknown", message: "Topic must be an object" });
			continue;
		}
		let topic: NormalizedTopicInput;
		if (topicIndex >= admission.maxTopicsPerConnection) {
			observeAdmission("subscription_limit");
			topicErrors.push({
				id: rawTopic.id ?? "unknown",
				message: `Connection accepts at most ${admission.maxTopicsPerConnection} topics`,
			});
			continue;
		}
		if (!rawTopic.id || typeof rawTopic.id !== "string") {
			topicErrors.push({
				id: rawTopic.id ?? "unknown",
				message: app.t(
					"realtime.topicIdRequired",
					undefined,
					resolved.appContext.locale,
				),
			});
			continue;
		}

		if (!rawTopic.resourceType || !rawTopic.resource) {
			topicErrors.push({
				id: rawTopic.id,
				message: app.t(
					"realtime.resourceRequired",
					undefined,
					resolved.appContext.locale,
				),
			});
			continue;
		}
		if (
			rawTopic.sinceSeq !== undefined &&
			(!Number.isSafeInteger(rawTopic.sinceSeq) || rawTopic.sinceSeq < 0)
		) {
			topicErrors.push({
				id: rawTopic.id,
				message: "Topic sinceSeq must be a non-negative safe integer",
			});
			continue;
		}
		try {
			topic = normalizeTopicOperation(rawTopic);
		} catch (error) {
			topicErrors.push({
				id: rawTopic.id,
				message: error instanceof Error ? error.message : "Invalid operation",
			});
			continue;
		}

		const topicAdmission = admitRealtimeTopic(topic, admission);
		if (!topicAdmission.accepted) {
			const rejection = realtimeTopicRejectedPayload(topic, topicAdmission);
			observeAdmission(rejection.details.reason, {
				resource: rejection.resource,
				operation: rejection.operation,
				requestedLimit: rejection.details.requestedLimit,
				configuredLimit: rejection.details.configuredLimit,
			});
			topicErrors.push({
				id: topic.id,
				message: topicAdmission.message,
				rejection,
			});
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
		}
	}

	const validatedChannelsById = new Map<string, ValidatedChannelSubscription>();
	const channelErrors: Array<{ id: string; message: string }> = [];
	for (const [index, input] of (channelInputs ?? []).entries()) {
		const id = input?.id ?? "unknown";
		if (index + validatedTopics.length >= admission.maxTopicsPerConnection) {
			observeAdmission("subscription_limit");
			channelErrors.push({
				id,
				message: `Connection accepts at most ${admission.maxTopicsPerConnection} subscriptions`,
			});
			continue;
		}
		try {
			const channel = await resolveChannelSubscription(
				app,
				input,
				resolved.appContext,
			);
			if (validatedChannelsById.has(channel.id)) {
				throw new Error("Channel subscription id is already used");
			}
			validatedChannelsById.set(channel.id, channel);
		} catch (error) {
			channelErrors.push({
				id,
				message: error instanceof Error ? error.message : "Channel rejected",
			});
		}
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
			observeAdmission("access");
			topicErrors.push({
				id: topic.id,
				message: error instanceof Error ? error.message : "Access denied",
			});
		}
	}

	if (accessValidatedTopics.length === 0 && validatedChannelsById.size === 0) {
		const rejectionErrors = topicErrors.flatMap((error) =>
			error.rejection ? [error.rejection] : [],
		);
		if (
			rejectionErrors.length > 0 &&
			rejectionErrors.length === topicErrors.length &&
			channelErrors.length === 0
		) {
			return Response.json({ errors: rejectionErrors }, { status: 400 });
		}
		const errors = [...topicErrors, ...channelErrors]
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
	const pacingMs = app.config?.realtime?.connectionAcceptPacingMs;
	if (Number.isFinite(pacingMs) && (pacingMs as number) > 0) {
		await new Promise((resolve) =>
			setTimeout(resolve, Math.random() * Math.min(pacingMs as number, 30_000)),
		);
	}

	const admissionRegistry = getRealtimeAdmissionRegistry(
		app,
		admission.maxConnectionsPerPrincipal,
	);
	const releaseConnection = admissionRegistry.acquire(
		realtimePrincipalKey(resolved.appContext),
	);
	if (!releaseConnection) {
		observeAdmission("connection_limit");
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

	if (body.transport === "shared-provider") {
		if (validatedChannelsById.size > 0 || validatedTopicsById.size === 0) {
			releaseConnection();
			return errorResponse(
				ApiError.badRequest(
					"Shared-provider session bootstrap only accepts live-query topics",
				),
				request,
				resolved.appContext.locale,
			);
		}
		const transportConfig = await app.realtime.getClientTransportConfig({
			request,
		});
		if (transportConfig.transport !== "shared-provider") {
			releaseConnection();
			return errorResponse(
				ApiError.badRequest("Shared-provider realtime is not configured"),
				request,
				resolved.appContext.locale,
			);
		}

		const edgeSessionId = globalThis.crypto.randomUUID();
		const controlToken = globalThis.crypto.randomUUID();
		const topicUnsubscribers = new Map<string, () => void>();
		let unregisterControl = () => {};
		let sink: ClientSink | null = null;
		let closed = false;
		let applyingTopology = false;
		let appliedTopology = createInitialTopology(
			topics ?? [],
			[],
			new Set(validatedTopicsById.keys()),
			new Set(),
		);
		try {
			sink = await app.realtime.openClientSession({
				sessionId: edgeSessionId,
				principal: resolved.appContext.principal ?? null,
				resolvePrincipal: async () => resolved.appContext.principal ?? null,
			});
			if (!sink.clientChannel) {
				throw new Error(
					"Shared-provider session did not expose a client channel",
				);
			}
			const activeSink = sink;
			const refreshScheduler = getRealtimeRefreshScheduler(app, app.realtime);
			const limitSnapshotConcurrency = createConcurrencyLimiter(
				admission.initialSnapshotConcurrency,
			);
			const close = () => {
				if (closed) return;
				closed = true;
				releaseConnection();
				unregisterControl();
				for (const unsubscribe of topicUnsubscribers.values()) unsubscribe();
				topicUnsubscribers.clear();
				void activeSink.close("normal").catch(() => {});
			};
			const teardownTopic = (topicId: string) => {
				const unsubscribe = topicUnsubscribers.get(topicId);
				if (!unsubscribe) return;
				topicUnsubscribers.delete(topicId);
				unsubscribe();
				if (topicUnsubscribers.size === 0 && !applyingTopology) close();
			};
			const subscribeTopic = async (
				topic: ValidatedTopic,
				baseContext: RealtimeRequestContext,
			) => {
				if (closed) throw new Error("Realtime session is closed");
				if (topicUnsubscribers.has(topic.id)) {
					throw new Error("Topic id is already subscribed");
				}
				const topicContext =
					topic.locale && topic.locale !== baseContext.locale
						? { ...baseContext, locale: topic.locale }
						: baseContext;
				const accessKey = await resolveRealtimeAccessKey(
					edgeSessionId,
					topicContext,
					topic.accessCacheKey,
				);
				const unsubscribe = refreshScheduler.subscribe({
					key: schedulerKey(topic, accessKey),
					topicId: topic.id,
					topics: {
						resourceType: topic.resourceType,
						resource: topic.resource,
						operation: topic.operation,
						where: topic.where,
						with: topic.with,
					},
					sinceSeq: topic.sinceSeq,
					compute: () =>
						limitSnapshotConcurrency(async () => {
							const admitted = await evaluateTopicAccess(
								app,
								topic,
								topicContext,
							);
							return computeRealtimeSnapshot(admitted, topicContext);
						}),
					onFrame: async (frame) => {
						if (frame.byteLength > admission.maxBufferedSnapshotBytes) {
							teardownTopic(topic.id);
							return;
						}
						await activeSink.write(frame, "latest-snapshot");
					},
					onError: (error) => {
						if (
							isPermanentAccessError(error) ||
							error instanceof RealtimeSnapshotBufferOverflowError
						) {
							teardownTopic(topic.id);
						}
					},
					onTransportError: close,
				});
				topicUnsubscribers.set(topic.id, unsubscribe);
			};

			const originalIdentity = realtimeControlIdentity(resolved.appContext);
			const topologySession = await app.realtime.openTopologySession({
				sessionId: edgeSessionId,
				token: controlToken,
				identity: originalIdentity,
				topology: appliedTopology,
				apply: async (topology) => {
					if (closed) throw new Error("Realtime session is closed");
					applyingTopology = true;
					const current = new Map(
						appliedTopology.topics.map((topic) => [topic.id, topic]),
					);
					const desiredIds = new Set(topology.topics.map((topic) => topic.id));
					for (const topicId of topicUnsubscribers.keys()) {
						const desired = topology.topics.find(
							(topic) => topic.id === topicId,
						);
						if (
							!desiredIds.has(topicId) ||
							JSON.stringify(current.get(topicId)) !== JSON.stringify(desired)
						) {
							teardownTopic(topicId);
						}
					}
					for (const desired of topology.topics) {
						if (topicUnsubscribers.has(desired.id)) continue;
						if (topicUnsubscribers.size >= admission.maxTopicsPerConnection) {
							observeAdmission("subscription_limit");
							throw new Error(
								`Connection accepts at most ${admission.maxTopicsPerConnection} topics`,
							);
						}
						const rawTopic = {
							...desired.topic,
							...(desired.topic.resourceType === "collection" &&
							desired.topic.operation === "get"
								? { recordId: desired.topic.id }
								: {}),
							id: desired.id,
							sinceSeq: desired.sinceSeq,
						} as TopicInput;
						const topic = await resolveIncrementalTopic(
							app,
							rawTopic,
							resolved.appContext,
							admission,
						);
						await subscribeTopic(topic, resolved.appContext);
					}
					appliedTopology = topology;
					applyingTopology = false;
					if (topicUnsubscribers.size === 0) close();
				},
				onClose: close,
			});
			unregisterControl = () => void topologySession.close();
			for (const topic of validatedTopicsById.values()) {
				await subscribeTopic(topic, resolved.appContext);
			}

			return Response.json(
				{
					transport: "shared-provider",
					sessionId: edgeSessionId,
					token: controlToken,
					channel: activeSink.clientChannel,
					control: {
						protocol: "questpie-realtime-topology",
						versions: [1],
					},
					...(topicErrors.length ? { errors: topicErrors } : {}),
				},
				{ headers: { "Cache-Control": "no-store" } },
			);
		} catch (error) {
			if (!closed) releaseConnection();
			unregisterControl();
			for (const unsubscribe of topicUnsubscribers.values()) unsubscribe();
			if (sink) void sink.close("transport_error").catch(() => {});
			return errorResponse(error, request, resolved.appContext.locale);
		}
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
				const channelUnsubscribers = new Map<string, () => void>();
				let closed = false;
				let closeRequested = false;
				let applyingTopology = false;
				let appliedTopology = createInitialTopology(
					topics ?? [],
					channelInputs ?? [],
					new Set(validatedTopicsById.keys()),
					new Set(validatedChannelsById.keys()),
				);

				const requestClose = () => {
					closeRequested = true;
					closeStream?.();
				};
				transport = new SseClientTransport(
					controller,
					highWaterMarkBytes,
					app.realtime!,
				);
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
				let unregisterControl = () => {};
				flushPending = () => {
					void snapshotWriter.flush().catch(requestClose);
				};
				const close = () => {
					if (closed) return;
					closed = true;
					releaseConnection();
					removeKeepAlive();
					unregisterControl();
					flushPending = null;
					snapshotWriter.clear();
					request.signal.removeEventListener("abort", close);
					for (const unsub of topicUnsubscribers.values()) {
						unsub();
					}
					topicUnsubscribers.clear();
					for (const unsub of channelUnsubscribers.values()) {
						unsub();
					}
					channelUnsubscribers.clear();
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
				const sendTopicError = (
					topicId: string,
					message: string,
					rejection?: RealtimeTopicRejectedPayload,
				) => {
					return send("error", rejection ?? { topicId, message });
				};
				const sendChannelError = (subscriptionId: string, message: string) =>
					send("error", { channelSubscriptionId: subscriptionId, message });

				const closeIfEmpty = () => {
					if (applyingTopology) return;
					if (
						topicUnsubscribers.size === 0 &&
						channelUnsubscribers.size === 0
					) {
						requestClose();
					}
				};

				const teardownTopic = (topicId: string) => {
					const unsubscribe = topicUnsubscribers.get(topicId);
					if (!unsubscribe) return;

					topicUnsubscribers.delete(topicId);
					unsubscribe();
					closeIfEmpty();
				};

				const teardownChannel = (subscriptionId: string) => {
					const unsubscribe = channelUnsubscribers.get(subscriptionId);
					if (!unsubscribe) return;
					channelUnsubscribers.delete(subscriptionId);
					unsubscribe();
					closeIfEmpty();
				};

				const subscribeChannel = async (
					channel: ValidatedChannelSubscription,
				) => {
					if (closed) return;
					if (channelUnsubscribers.has(channel.id)) {
						await sendChannelError(
							channel.id,
							"Channel subscription id is already used",
						);
						return;
					}
					let unsubscribeLedger: (() => void) | undefined;
					let unsubscribePresence: (() => Promise<void>) | undefined;
					try {
						unsubscribeLedger = await app.realtime!.subscribeChannel({
							subscriptionId: `${edgeSessionId}:${channel.id}`,
							channel: channel.resolvedName,
							sink,
							lastEventId: channel.lastEventId,
							encodeFrame: (frame) => transport!.encodeChannelFrame(frame),
						});
						if (channel.presence) {
							const principalId = realtimePrincipalKey(resolved.appContext);
							if (!principalId) {
								throw new Error(
									"Presence channel subscription requires a principal",
								);
							}
							unsubscribePresence = await app.realtime!.registerChannelPresence(
								{
									channel: channel.resolvedName,
									connectionId: `${edgeSessionId}:${channel.id}`,
									principalId,
									sink,
									data: channel.presence,
								},
							);
						}
						channelUnsubscribers.set(channel.id, () => {
							void unsubscribePresence?.().catch(requestClose);
							unsubscribeLedger?.();
						});
					} catch (error) {
						await unsubscribePresence?.();
						unsubscribeLedger?.();
						throw error;
					}
				};

				const subscribeTopic = async (
					topic: ValidatedTopic,
					baseContext: RealtimeRequestContext,
				) => {
					if (closed) return;
					if (topicUnsubscribers.has(topic.id)) {
						await sendTopicError(topic.id, "Topic id is already subscribed");
						return;
					}
					const topicContext =
						topic.locale && topic.locale !== baseContext.locale
							? { ...baseContext, locale: topic.locale }
							: baseContext;
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
							operation: topic.operation,
							where: topic.where,
							with: topic.with,
						},
						sinceSeq: topic.sinceSeq,
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
								observeAdmission("snapshot_bytes");
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
				};

				const originalIdentity = realtimeControlIdentity(resolved.appContext);
				const controlToken = globalThis.crypto.randomUUID();
				const topologySession = await app.realtime.openTopologySession({
					sessionId: edgeSessionId,
					token: controlToken,
					identity: originalIdentity,
					topology: appliedTopology,
					apply: async (topology) => {
						if (closed) throw new Error("Realtime session is closed");
						applyingTopology = true;
						const currentTopics = new Map(
							appliedTopology.topics.map((topic) => [topic.id, topic]),
						);
						const currentChannels = new Map(
							appliedTopology.channels.map((channel) => [channel.id, channel]),
						);
						const desiredTopicIds = new Set(
							topology.topics.map((topic) => topic.id),
						);
						const desiredChannelIds = new Set(
							topology.channels.map((channel) => channel.id),
						);
						for (const topicId of topicUnsubscribers.keys()) {
							const desired = topology.topics.find(
								(topic) => topic.id === topicId,
							);
							if (
								!desiredTopicIds.has(topicId) ||
								JSON.stringify(currentTopics.get(topicId)) !==
									JSON.stringify(desired)
							) {
								teardownTopic(topicId);
							}
						}
						for (const channelId of channelUnsubscribers.keys()) {
							const desired = topology.channels.find(
								(channel) => channel.id === channelId,
							);
							if (
								!desiredChannelIds.has(channelId) ||
								JSON.stringify(currentChannels.get(channelId)) !==
									JSON.stringify(desired)
							) {
								teardownChannel(channelId);
							}
						}

						for (const desired of topology.channels) {
							if (channelUnsubscribers.has(desired.id)) continue;
							if (
								topicUnsubscribers.size + channelUnsubscribers.size >=
								admission.maxTopicsPerConnection
							) {
								observeAdmission("subscription_limit");
								await sendChannelError(
									desired.id,
									`Connection accepts at most ${admission.maxTopicsPerConnection} subscriptions`,
								);
								throw new Error(
									`Connection accepts at most ${admission.maxTopicsPerConnection} subscriptions`,
								);
							}
							try {
								const channel = await resolveChannelSubscription(
									app,
									{
										id: desired.id,
										channel: desired.channel,
										params: desired.params,
										lastEventId: desired.lastEventId,
									},
									resolved.appContext,
								);
								await subscribeChannel(channel);
							} catch (error) {
								await sendChannelError(
									desired.id,
									error instanceof Error ? error.message : "Channel rejected",
								);
								throw error;
							}
						}
						for (const desired of topology.topics) {
							if (topicUnsubscribers.has(desired.id)) continue;
							if (
								topicUnsubscribers.size + channelUnsubscribers.size >=
								admission.maxTopicsPerConnection
							) {
								observeAdmission("subscription_limit");
								await sendTopicError(
									desired.id,
									`Connection accepts at most ${admission.maxTopicsPerConnection} topics`,
								);
								throw new Error(
									`Connection accepts at most ${admission.maxTopicsPerConnection} topics`,
								);
							}
							try {
								const rawTopic = {
									...desired.topic,
									...(desired.topic.resourceType === "collection" &&
									desired.topic.operation === "get"
										? { recordId: desired.topic.id }
										: {}),
									id: desired.id,
									sinceSeq: desired.sinceSeq,
								} as TopicInput;
								const topicContext =
									rawTopic.locale &&
									rawTopic.locale !== resolved.appContext.locale
										? { ...resolved.appContext, locale: rawTopic.locale }
										: resolved.appContext;
								const topic = await resolveIncrementalTopic(
									app,
									rawTopic,
									topicContext,
									admission,
								);
								await subscribeTopic(topic, topicContext);
							} catch (error) {
								if (error instanceof RealtimeTopicAdmissionError) {
									observeTopicRejection(error);
									await sendTopicError(
										error.payload.topicId,
										error.message,
										error.payload,
									);
									throw error;
								}
								await sendTopicError(
									desired.id,
									error instanceof Error ? error.message : "Topic rejected",
								);
								throw error;
							}
						}
						appliedTopology = topology;
						applyingTopology = false;
						closeIfEmpty();
					},
					onClose: requestClose,
				});
				unregisterControl = () => void topologySession.close();
				await send("session", {
					sessionId: edgeSessionId,
					token: controlToken,
					control: {
						protocol: "questpie-realtime-topology",
						versions: [1],
					},
				});

				// Subscribe to each initial topic.
				for (const topic of validatedTopicsById.values()) {
					await subscribeTopic(topic, resolved.appContext);
				}
				for (const channel of validatedChannelsById.values()) {
					try {
						await subscribeChannel(channel);
					} catch (error) {
						await sendChannelError(
							channel.id,
							error instanceof Error ? error.message : "Channel rejected",
						);
					}
				}

				// Send initial errors for invalid topics
				for (const error of topicErrors) {
					await sendTopicError(error.id, error.message, error.rejection);
				}
				for (const error of channelErrors) {
					await sendChannelError(error.id, error.message);
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
