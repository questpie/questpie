/**
 * Realtime Routes
 *
 * Unified SSE endpoint for multiplexed realtime updates.
 * Accepts multiple topics via POST and streams updates for all of them.
 */

import { Buffer } from "node:buffer";

import type { RealtimeTopicRejectedPayload } from "#questpie/shared/realtime-error.js";

import {
	ChannelsService,
	type ChannelServiceContext,
} from "../../channels/service.js";
import { executeAccessRule } from "../../collection/crud/shared/access-control.js";
import type { RequestContext } from "../../config/context.js";
import type { Questpie } from "../../config/questpie.js";
import { ApiError } from "../../errors/index.js";
import { CrdtRealtimeBindingRejectedError } from "../../modules/core/integrated/crdt/realtime-binding.js";
import {
	admitRealtimeTopic,
	admitRealtimeTopicPolicy,
	createConcurrencyLimiter,
	getRealtimeAdmissionRegistry,
	RealtimeTopicAdmissionError,
	realtimeTopicRejectedPayload,
	realtimePrincipalKey,
	resolveRealtimeAdmissionConfig,
} from "../../modules/core/integrated/realtime/admission.js";
import {
	classifyRealtimeDeliveryDecision,
	type RealtimeDeliveryMode,
} from "../../modules/core/integrated/realtime/delta.js";
import {
	RealtimeBindingOutputGate,
	type RealtimeEdgeBinding,
	RealtimeEdgeBindingStageError,
	RealtimeEdgeSession,
} from "../../modules/core/integrated/realtime/edge-session.js";
import { realtimeControlIdentity } from "../../modules/core/integrated/realtime/identity.js";
import {
	getRealtimeRefreshScheduler,
	resolveRealtimeAccessKey,
	resolveRealtimeSubscriptionScope,
} from "../../modules/core/integrated/realtime/refresh-scheduler.js";
import {
	captureRealtimeWatermark,
	computeRealtimeSnapshot,
	hydrateRealtimeRows,
} from "../../modules/core/integrated/realtime/snapshot.js";
import {
	encodeSseEvent,
	RealtimeDeltaBufferOverflowError,
	RealtimeSnapshotBufferOverflowError,
	SseClientTransport,
	SseLatestSnapshotWriter,
	SseOrderedDeltaWriter,
} from "../../modules/core/integrated/realtime/sse-client-transport.js";
import { sharedSseKeepAliveTicker } from "../../modules/core/integrated/realtime/sse-keep-alive.js";
import {
	MAX_REALTIME_TOPOLOGY_BYTES,
	MANAGED_PROVIDER_CLIENT_LEASE_MS,
	RealtimeTopologyApplyRejectedError,
	type RealtimeDesiredTopology,
	type RealtimeTopologyChannel,
	type RealtimeTopologyCrdt,
	type RealtimeTopologyQuery,
} from "../../modules/core/integrated/realtime/topology-coordinator.js";
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
	/** Projected columns */
	columns?: Record<string, boolean>;
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
	/** Native row deltas are explicit and still shape-gated by the server. */
	mode?: "snapshot" | "delta";
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

function collectionAccessCacheKey(definition: any) {
	const realtime = definition?.state?.options?.realtime;
	return realtime && realtime !== false ? realtime.accessCacheKey : undefined;
}

function enforceRowLiveQueryPolicy(
	app: Questpie<any>,
	topic: NormalizedTopicInput,
	definition?: any,
): void {
	const result = admitRealtimeTopicPolicy(topic, {
		rowLiveQueries: app.config?.realtime?.rowLiveQueries,
		collectionRealtime:
			topic.resourceType === "collection"
				? definition?.state?.options?.realtime !== false
				: undefined,
	});
	if (!result.accepted) {
		throw new RealtimeTopicAdmissionError(
			realtimeTopicRejectedPayload(topic, result),
		);
	}
}

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
		version: 2,
		revision: 0,
		subscriptions: [
			...topics
				.filter((topic) => validTopicIds.has(topic.id))
				.map(({ id, sinceSeq, ...topic }) => ({
					kind: "query" as const,
					id,
					topic,
					...(sinceSeq === undefined ? {} : { sinceSeq }),
				})),
			...channels
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
					kind: "channel" as const,
					id,
					channel,
					params,
					...(lastEventId === undefined ? {} : { lastEventId }),
				})),
		],
	};
}

function topologyQueries(
	topology: RealtimeDesiredTopology,
): RealtimeTopologyQuery[] {
	return topology.subscriptions.filter(
		(entry): entry is RealtimeTopologyQuery => entry.kind === "query",
	);
}

function topologyChannels(
	topology: RealtimeDesiredTopology,
): RealtimeTopologyChannel[] {
	return topology.subscriptions.filter(
		(entry): entry is RealtimeTopologyChannel => entry.kind === "channel",
	);
}

function topologyCrdt(
	topology: RealtimeDesiredTopology,
): RealtimeTopologyCrdt[] {
	return topology.subscriptions.filter(
		(entry): entry is RealtimeTopologyCrdt => entry.kind === "crdt",
	);
}

type ResolvedRealtimeTopologyCandidate = {
	queries: Map<
		string,
		{
			desired: RealtimeTopologyQuery;
			topic: ValidatedTopic;
			context: RealtimeRequestContext;
		}
	>;
	channels: Map<
		string,
		{
			desired: RealtimeTopologyChannel;
			channel: ValidatedChannelSubscription;
		}
	>;
	crdt: Map<string, RealtimeTopologyCrdt>;
};

async function resolveRealtimeTopologyCandidate(
	app: Questpie<any>,
	topology: RealtimeDesiredTopology,
	baseContext: RealtimeRequestContext,
	admission: ReturnType<typeof resolveRealtimeAdmissionConfig>,
): Promise<ResolvedRealtimeTopologyCandidate> {
	const candidate: ResolvedRealtimeTopologyCandidate = {
		queries: new Map(),
		channels: new Map(),
		crdt: new Map(topologyCrdt(topology).map((entry) => [entry.id, entry])),
	};
	const errors: Array<{
		id: string;
		kind: string;
		code: string;
		message: string;
	}> = [];
	if (topology.subscriptions.length > admission.maxTopicsPerConnection) {
		for (const subscription of topology.subscriptions.slice(
			admission.maxTopicsPerConnection,
		)) {
			errors.push({
				id: subscription.id,
				kind: subscription.kind,
				code: "REALTIME_SUBSCRIPTION_LIMIT_EXCEEDED",
				message: `Connection accepts at most ${admission.maxTopicsPerConnection} subscriptions`,
			});
		}
	}
	for (const desired of topologyQueries(topology)) {
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
				rawTopic.locale && rawTopic.locale !== baseContext.locale
					? { ...baseContext, locale: rawTopic.locale }
					: baseContext;
			candidate.queries.set(desired.id, {
				desired,
				topic: await resolveIncrementalTopic(
					app,
					rawTopic,
					topicContext,
					admission,
				),
				context: topicContext,
			});
		} catch (error) {
			errors.push({
				id: desired.id,
				kind: desired.kind,
				code:
					error instanceof RealtimeTopicAdmissionError
						? error.payload.code
						: "REALTIME_SUBSCRIPTION_REJECTED",
				message:
					error instanceof Error ? error.message : "Realtime query rejected",
			});
		}
	}
	for (const desired of topologyChannels(topology)) {
		try {
			candidate.channels.set(desired.id, {
				desired,
				channel: await resolveChannelSubscription(
					app,
					{
						id: desired.id,
						channel: desired.channel,
						params: desired.params,
						lastEventId: desired.lastEventId,
					},
					baseContext,
				),
			});
		} catch (error) {
			errors.push({
				id: desired.id,
				kind: desired.kind,
				code: "REALTIME_SUBSCRIPTION_REJECTED",
				message:
					error instanceof Error ? error.message : "Realtime channel rejected",
			});
		}
	}
	if (errors.length > 0) {
		throw new RealtimeTopologyApplyRejectedError(errors);
	}
	return candidate;
}

function createFencedClientSink(
	sink: ClientSink,
	isActive: () => boolean,
): ClientSink {
	return {
		sessionId: sink.sessionId,
		...(sink.clientChannel ? { clientChannel: sink.clientChannel } : {}),
		write: (frame, delivery) =>
			isActive()
				? sink.write(frame, delivery)
				: Promise.resolve({ status: "accepted", bufferedBytes: null }),
		close: (reason) => (isActive() ? sink.close(reason) : Promise.resolve()),
	};
}

function edgeStageRejection(
	error: unknown,
): RealtimeTopologyApplyRejectedError | null {
	if (!(error instanceof RealtimeEdgeBindingStageError)) return null;
	return new RealtimeTopologyApplyRejectedError([
		{
			id: error.subscription.id,
			kind: error.subscription.kind,
			code: "REALTIME_SUBSCRIPTION_ACTIVATION_REJECTED",
			message:
				error.cause instanceof Error
					? error.cause.message
					: "Realtime subscription activation failed",
		},
	]);
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

function classifyValidatedTopic(topic: ValidatedTopic) {
	const relationNames = new Set(
		Object.keys(topic.definition.state.relations ?? {}),
	);
	return classifyRealtimeDeliveryDecision(
		{ ...topic, where: topic.requestedWhere },
		relationNames,
	);
}

function stampValidatedTopicMode(
	topic: ValidatedTopic,
	mode: RealtimeDeliveryMode,
	snapshotDefaultLimit: number,
): ValidatedTopic {
	if (
		mode === "snapshot" &&
		topic.resourceType === "collection" &&
		topic.operation === "find" &&
		topic.limit === undefined
	) {
		return { ...topic, mode, limit: snapshotDefaultLimit };
	}
	return { ...topic, mode };
}

function deltaBootstrapSize(data: unknown): number {
	if (Array.isArray(data)) return data.length;
	if (data && typeof data === "object") {
		const docs = (data as { docs?: unknown }).docs;
		if (Array.isArray(docs)) return docs.length;
	}
	return 0;
}

function deltaBootstrapLimitError(
	topic: ValidatedTopic,
	configuredLimit: number,
	requestedLimit: number,
): RealtimeTopicAdmissionError {
	return new RealtimeTopicAdmissionError({
		code: "REALTIME_TOPIC_REJECTED",
		message: `Delta bootstrap exceeds ${configuredLimit} rows`,
		topicId: topic.id,
		resource: topic.resource,
		operation: topic.operation,
		retryable: false,
		details: {
			reason: "query_limit",
			requestedLimit,
			configuredLimit,
		},
	});
}

function deltaBootstrapBytesError(
	topic: ValidatedTopic,
	configuredLimit: number,
	requestedLimit: number,
): RealtimeTopicAdmissionError {
	return new RealtimeTopicAdmissionError({
		code: "REALTIME_TOPIC_REJECTED",
		message: `Delta bootstrap exceeds ${configuredLimit} serialized bytes`,
		topicId: topic.id,
		resource: topic.resource,
		operation: topic.operation,
		retryable: false,
		details: {
			reason: "snapshot_bytes",
			requestedLimit,
			configuredLimit,
		},
	});
}

function isPermanentAccessError(error: unknown): boolean {
	return (
		error instanceof ApiError &&
		(error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED")
	);
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
		enforceRowLiveQueryPolicy(app, topic, definition);
		return evaluateTopicAccess(
			app,
			{
				...topic,
				type: "collection",
				crud,
				definition,
				requestedWhere: topic.where,
				accessCacheKey: collectionAccessCacheKey(definition),
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
		enforceRowLiveQueryPolicy(app, topic, definition);
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
 * Control body: { sessionId, token, topology: { protocol, version, revision, subscriptions } }
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
			| "row_live_queries_disabled"
			| "collection_realtime_disabled"
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
	let frozenSubscriptionScope: Promise<string | null> | undefined;
	const getFrozenSubscriptionScope = () =>
		(frozenSubscriptionScope ??= resolveRealtimeSubscriptionScope(
			resolved.appContext,
			app.config?.realtime?.subscriptionScope,
		));

	// Parse request body
	let body: {
		topics?: TopicInput[];
		channels?: ChannelSubscriptionInput[];
		transport?: "shared-provider";
		crdtHold?: true;
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
	const crdtHold = body.crdtHold === true;
	const admission = resolveRealtimeAdmissionConfig(
		app.config?.realtime?.admission,
	);
	if (body.topology !== undefined) {
		if ((body.topology as { version?: unknown }).version !== 2) {
			return Response.json(
				{
					error: {
						code: "REALTIME_TOPOLOGY_VERSION_UNSUPPORTED",
						message: "Realtime topology was rejected",
					},
				},
				{ status: 400 },
			);
		}
		if (
			!body.sessionId ||
			!body.token ||
			body.topology.protocol !== "questpie-realtime-topology" ||
			!Number.isSafeInteger(body.topology.revision) ||
			body.topology.revision < 1 ||
			!Array.isArray(body.topology.subscriptions) ||
			body.topology.subscriptions.length > admission.maxTopicsPerConnection
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
			const entryErrors: Array<{
				id: string;
				kind: string;
				code: string;
				message: string;
				rejection?: RealtimeTopicRejectedPayload;
			}> = [];
			const crdtSubscriptions: RealtimeTopologyCrdt[] = [];
			for (const desired of body.topology.subscriptions) {
				try {
					if (desired.kind === "query") {
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
					} else if (desired.kind === "channel") {
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
					} else if (
						desired.kind !== "crdt" ||
						typeof desired.bindingId !== "string" ||
						desired.bindingId.length === 0
					) {
						throw new Error("Invalid realtime subscription");
					} else {
						crdtSubscriptions.push(desired);
					}
				} catch (error) {
					entryErrors.push({
						id: typeof desired.id === "string" ? desired.id : "unknown",
						kind: typeof desired.kind === "string" ? desired.kind : "unknown",
						code:
							error instanceof RealtimeTopicAdmissionError
								? error.payload.code
								: "REALTIME_SUBSCRIPTION_REJECTED",
						message:
							error instanceof Error
								? error.message
								: "Realtime subscription rejected",
						...(error instanceof RealtimeTopicAdmissionError
							? { rejection: error.payload }
							: {}),
					});
				}
			}
			if (entryErrors.length === 0 && crdtSubscriptions.length > 0) {
				let capability;
				try {
					capability = await app.realtime.authorizeTopologySession({
						sessionId: body.sessionId,
						token: body.token,
						identity: realtimeControlIdentity(resolved.appContext),
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
				if (!capability) {
					for (const desired of crdtSubscriptions) {
						entryErrors.push({
							id: desired.id,
							kind: desired.kind,
							code: "REALTIME_SUBSCRIPTION_REJECTED",
							message: "CRDT realtime binding unavailable",
						});
					}
				} else {
					for (const desired of crdtSubscriptions) {
						try {
							await app.crdtOperations.assertRealtimeBinding({
								bindingId: desired.bindingId,
								edgeSessionKey: Buffer.from(capability.sessionKey, "hex"),
								edgeOwnerGeneration: BigInt(capability.ownerGeneration),
							});
						} catch (error) {
							if (!(error instanceof CrdtRealtimeBindingRejectedError)) {
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
							entryErrors.push({
								id: desired.id,
								kind: desired.kind,
								code: "REALTIME_SUBSCRIPTION_REJECTED",
								message: "CRDT realtime binding unavailable",
							});
						}
					}
				}
			}
			if (entryErrors.length > 0) {
				return Response.json(
					{
						error: {
							code: "REALTIME_TOPOLOGY_ENTRIES_REJECTED",
							message: "Realtime topology entries were rejected",
							entries: entryErrors,
						},
					},
					{ status: 400 },
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
					version: 2,
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
					message: "Realtime control requires desired topology protocol v2",
				},
			},
			{ status: 400 },
		);
	}

	// Initial sessions may carry live-query topics, framework channels, or both.
	if (
		(body.crdtHold !== undefined && body.crdtHold !== true) ||
		(topics !== undefined && !Array.isArray(topics)) ||
		(channelInputs !== undefined && !Array.isArray(channelInputs)) ||
		(crdtHold &&
			((topics?.length ?? 0) !== 0 || (channelInputs?.length ?? 0) !== 0)) ||
		(!crdtHold &&
			(topics?.length ?? 0) === 0 &&
			(channelInputs?.length ?? 0) === 0)
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
			try {
				enforceRowLiveQueryPolicy(app, topic, definition);
			} catch (error) {
				if (!(error instanceof RealtimeTopicAdmissionError)) throw error;
				observeTopicRejection(error);
				topicErrors.push({
					id: topic.id,
					message: error.message,
					rejection: error.payload,
				});
				continue;
			}
			validatedTopics.push({
				...topic,
				type: "collection",
				crud,
				definition,
				requestedWhere: topic.where,
				accessCacheKey: collectionAccessCacheKey(definition),
			});
		} else if (topic.resourceType === "global") {
			try {
				const crud =
					globalCruds.get(topic.resource) ?? globalApi[topic.resource];
				if (!crud) throw new Error("Global not found");
				globalCruds.set(topic.resource, crud);
				const definition = globalDefinitions[topic.resource];
				enforceRowLiveQueryPolicy(app, topic, definition);
				validatedTopics.push({
					...topic,
					type: "global",
					crud,
					definition,
					requestedWhere: topic.where,
					accessCacheKey: definition?.state.options.realtime?.accessCacheKey,
				});
			} catch (error) {
				if (error instanceof RealtimeTopicAdmissionError) {
					observeTopicRejection(error);
					topicErrors.push({
						id: topic.id,
						message: error.message,
						rejection: error.payload,
					});
					continue;
				}
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

	if (
		!crdtHold &&
		accessValidatedTopics.length === 0 &&
		validatedChannelsById.size === 0
	) {
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
		if (
			validatedChannelsById.size > 0 ||
			(validatedTopicsById.size === 0 && !crdtHold)
		) {
			releaseConnection();
			return errorResponse(
				ApiError.badRequest(
					"Shared-provider session bootstrap accepts live-query topics or an explicit CRDT hold",
				),
				request,
				resolved.appContext.locale,
			);
		}
		const edgeSessionId = globalThis.crypto.randomUUID();
		const controlToken = globalThis.crypto.randomUUID();
		let unregisterControl = () => {};
		let sink: ClientSink | null = null;
		let edge: RealtimeEdgeSession | null = null;
		let closed = false;
		let provisionalCrdtHold = crdtHold;
		let activeOwnerGeneration = 0;
		let ownerSignal: AbortSignal | null = null;
		let closeFromTransport = () => {};
		let retainAdmission = false;
		const ownerIsActive = (generation: number) =>
			!closed &&
			generation === activeOwnerGeneration &&
			ownerSignal !== null &&
			!ownerSignal.aborted;
		const initialTopology = createInitialTopology(
			topics ?? [],
			[],
			new Set(validatedTopicsById.keys()),
			new Set(),
		);
		try {
			const transportConfig = await app.realtime.getClientTransportConfig({
				request,
			});
			if (transportConfig.transport !== "shared-provider") {
				return errorResponse(
					ApiError.badRequest("Shared-provider realtime is not configured"),
					request,
					resolved.appContext.locale,
				);
			}
			sink = await app.realtime.openClientSession({
				sessionId: edgeSessionId,
				principal: resolved.appContext.principal ?? null,
				resolvePrincipal: async () => resolved.appContext.principal ?? null,
				onClose: () => closeFromTransport(),
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
			const heartbeatIntervalMs =
				app.config?.realtime?.keepAliveIntervalMs ?? 8000;
			const originalIdentity = realtimeControlIdentity(resolved.appContext);
			const close = () => {
				if (closed) return;
				closed = true;
				releaseConnection();
				unregisterControl();
				void edge?.close().catch(() => {});
				void activeSink.close("normal").catch(() => {});
			};
			closeFromTransport = close;
			const closeIfEmpty = () => {
				if (edge?.size && provisionalCrdtHold) provisionalCrdtHold = false;
				if (edge?.size === 0 && !provisionalCrdtHold) close();
			};
			const teardownTopic = (topicId: string) => {
				void edge?.drop(topicId).then(closeIfEmpty).catch(close);
			};
			const subscribeTopic = async (
				topic: ValidatedTopic,
				baseContext: RealtimeRequestContext,
			): Promise<RealtimeEdgeBinding> => {
				if (closed) throw new Error("Realtime session is closed");
				const bindingGeneration = activeOwnerGeneration;
				if (!ownerIsActive(bindingGeneration)) {
					throw new Error("Realtime owner is fenced");
				}
				const topicContext =
					topic.locale && topic.locale !== baseContext.locale
						? { ...baseContext, locale: topic.locale }
						: baseContext;
				const accessKey = await resolveRealtimeAccessKey(
					edgeSessionId,
					topicContext,
					topic.accessCacheKey,
					await getFrozenSubscriptionScope(),
				);
				if (!ownerIsActive(bindingGeneration)) {
					throw new Error("Realtime owner is fenced");
				}
				const snapshotTopic = stampValidatedTopicMode(
					topic,
					"snapshot",
					admission.maxFindLimit,
				);
				const shapeDecision = classifyValidatedTopic(topic);
				app.realtime!.record({
					type: "delivery.classified",
					mode: "snapshot",
					reason:
						shapeDecision.mode === "snapshot"
							? shapeDecision.reason
							: "transport_snapshot",
				});
				const output = new RealtimeBindingOutputGate(activeSink, {
					maximumOrderedEvents: admission.maxBufferedDeltaEvents,
					maximumBufferedBytes: admission.maxBufferedSnapshotBytes,
					onError: close,
				});
				const unsubscribe = refreshScheduler.subscribe({
					key: schedulerKey(snapshotTopic, accessKey),
					topicId: topic.id,
					topics: {
						resourceType: topic.resourceType,
						resource: topic.resource,
						operation: topic.operation,
						where: topic.where,
						with: topic.with,
					},
					sinceSeq: topic.sinceSeq,
					mode: "snapshot",
					captureWatermark: topicContext.db
						? () => captureRealtimeWatermark(topicContext)
						: undefined,
					heartbeatIntervalMs,
					compute: () =>
						limitSnapshotConcurrency(async () => {
							if (!ownerIsActive(bindingGeneration)) {
								throw new Error("Realtime owner is fenced");
							}
							const admitted = await evaluateTopicAccess(
								app,
								snapshotTopic,
								topicContext,
							);
							const snapshot = await computeRealtimeSnapshot(
								admitted,
								topicContext,
							);
							if (!ownerIsActive(bindingGeneration)) {
								throw new Error("Realtime owner is fenced");
							}
							return snapshot;
						}),
					onFrame: async (frame) => {
						if (!ownerIsActive(bindingGeneration)) return;
						if (frame.byteLength > admission.maxBufferedSnapshotBytes) {
							const error = new Error(
								`Snapshot exceeds ${admission.maxBufferedSnapshotBytes} bytes`,
							);
							if (!output.active) {
								output.reject(error);
								return;
							}
							teardownTopic(topic.id);
							return;
						}
						await output.write(frame, "latest-snapshot");
					},
					onError: (error) => {
						if (!ownerIsActive(bindingGeneration)) return;
						if (
							isPermanentAccessError(error) ||
							error instanceof RealtimeSnapshotBufferOverflowError
						) {
							if (output.active) teardownTopic(topic.id);
							else output.reject(error);
						}
					},
					onTransportError: (error) => {
						if (output.active) close();
						else output.reject(error);
					},
				});
				if (output.error) {
					unsubscribe();
					await output.dispose();
					throw output.error;
				}
				return {
					activate: () => output.activate(),
					assertReady: () => output.assertReady(),
					close: async () => {
						unsubscribe();
						await output.dispose();
					},
				};
			};

			const subscribeCrdt = async (
				subscription: RealtimeTopologyCrdt,
			): Promise<RealtimeEdgeBinding> => {
				const bindingGeneration = activeOwnerGeneration;
				if (!ownerIsActive(bindingGeneration)) {
					throw new Error("Realtime owner is fenced");
				}
				const capability = await app.realtime.authorizeTopologySession({
					sessionId: edgeSessionId,
					token: controlToken,
					identity: originalIdentity,
				});
				if (
					!capability ||
					capability.ownerGeneration !== bindingGeneration ||
					!ownerIsActive(bindingGeneration)
				) {
					throw new Error("Realtime owner is fenced");
				}
				const output = new RealtimeBindingOutputGate(activeSink, {
					maximumOrderedEvents: 0,
					maximumBufferedBytes: admission.maxBufferedSnapshotBytes,
					onError: close,
				});
				let release: (() => Promise<void>) | undefined;
				try {
					release = await app.crdtOperations.subscribeRealtimeBinding({
						bindingId: subscription.bindingId,
						edgeSessionKey: Buffer.from(capability.sessionKey, "hex"),
						edgeOwnerGeneration: BigInt(bindingGeneration),
						signal: ownerSignal!,
						onDirty: async () => {
							await output.write(
								encodeSseEvent("crdt_dirty", {
									topologyEntryId: subscription.id,
								}),
								"latest-snapshot",
							);
						},
						onError: (error) => {
							if (output.active) close();
							else output.reject(error);
						},
					});
					if (output.error) throw output.error;
					return {
						activate: () => output.activate(),
						assertReady: () => output.assertReady(),
						close: async () => {
							await release?.();
							await output.dispose();
						},
					};
				} catch (error) {
					await release?.();
					await output.dispose();
					throw error;
				}
			};

			const topologySession = await app.realtime.openTopologySession({
				sessionId: edgeSessionId,
				token: controlToken,
				identity: originalIdentity,
				topology: initialTopology,
				clientLeaseMs: MANAGED_PROVIDER_CLIENT_LEASE_MS,
				apply: async ({ topology, ownerGeneration, signal }) => {
					if (closed) throw new Error("Realtime session is closed");
					if (signal.aborted) throw new Error("Realtime owner is fenced");
					if (ownerGeneration !== activeOwnerGeneration) {
						throw new Error("Realtime owner generation mismatch");
					}
					const candidate = await resolveRealtimeTopologyCandidate(
						app,
						topology,
						resolved.appContext,
						admission,
					);
					if (candidate.channels.size > 0) {
						throw new RealtimeTopologyApplyRejectedError(
							[...candidate.channels.keys()].map((id) => ({
								id,
								kind: "channel",
								code: "REALTIME_SUBSCRIPTION_REJECTED",
								message:
									"Shared-provider topology accepts queries and CRDT bindings only",
							})),
						);
					}
					if (signal.aborted) throw new Error("Realtime owner is fenced");
					try {
						await edge!.apply(
							{ topology, ownerGeneration, signal },
							async (subscription) => {
								if (subscription.kind === "query") {
									const resolvedQuery = candidate.queries.get(subscription.id)!;
									return subscribeTopic(
										resolvedQuery.topic,
										resolvedQuery.context,
									);
								}
								if (subscription.kind === "crdt") {
									return subscribeCrdt(candidate.crdt.get(subscription.id)!);
								}
								return { activate: () => {}, close: () => {} };
							},
						);
					} catch (error) {
						throw edgeStageRejection(error) ?? error;
					}
					closeIfEmpty();
				},
				onClose: close,
			});
			activeOwnerGeneration = topologySession.generation;
			ownerSignal = topologySession.signal;
			unregisterControl = () => void topologySession.close();
			edge = new RealtimeEdgeSession({
				...initialTopology,
				subscriptions: [],
			});
			await edge.apply(
				{
					topology: initialTopology,
					ownerGeneration: topologySession.generation,
					signal: topologySession.signal,
				},
				async (subscription) => {
					if (subscription.kind !== "query") {
						if (subscription.kind === "crdt") {
							return subscribeCrdt(subscription);
						}
						return { activate: () => {}, close: () => {} };
					}
					return subscribeTopic(
						validatedTopicsById.get(subscription.id)!,
						resolved.appContext,
					);
				},
			);
			closeIfEmpty();

			retainAdmission = true;
			return Response.json(
				{
					transport: "shared-provider",
					sessionId: edgeSessionId,
					token: controlToken,
					channel: activeSink.clientChannel,
					control: {
						protocol: "questpie-realtime-topology",
						versions: [2],
					},
					...(topicErrors.length ? { errors: topicErrors } : {}),
				},
				{ headers: { "Cache-Control": "no-store" } },
			);
		} catch (error) {
			unregisterControl();
			await edge?.close().catch(() => {});
			if (sink) void sink.close("transport_error").catch(() => {});
			return errorResponse(error, request, resolved.appContext.locale);
		} finally {
			if (!retainAdmission) releaseConnection();
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
				let edge: RealtimeEdgeSession | null = null;
				let closed = false;
				let closeRequested = false;
				let provisionalCrdtHold = crdtHold;
				let activeOwnerGeneration = 0;
				let ownerSignal: AbortSignal | null = null;
				const ownerIsActive = (generation: number) =>
					!closed &&
					generation === activeOwnerGeneration &&
					ownerSignal !== null &&
					!ownerSignal.aborted;
				const initialTopology = createInitialTopology(
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
				const sessionSink = createFencedClientSink(sink, () =>
					ownerIsActive(activeOwnerGeneration),
				);
				const snapshotWriter = new SseLatestSnapshotWriter(
					sessionSink,
					admission.maxBufferedSnapshotBytes,
				);
				const writerObservationKey = globalThis.crypto.randomUUID();
				const crdtDirtyWriter = new SseLatestSnapshotWriter(
					sessionSink,
					Math.min(
						admission.maxBufferedSnapshotBytes,
						MAX_REALTIME_TOPOLOGY_BYTES,
					),
					{ includeTransportBufferedBytesInLimit: false },
				);
				const deltaWriter = new SseOrderedDeltaWriter(sessionSink, {
					maximumBufferedEvents: admission.maxBufferedDeltaEvents,
					maximumBufferedBytes: admission.maxBufferedDeltaBytes,
					onBuffer: (events, bytes) =>
						app.realtime!.record({
							type: "delta.buffer",
							scope: "writer",
							key: writerObservationKey,
							events,
							bytes,
						}),
				});
				const refreshScheduler = getRealtimeRefreshScheduler(
					app,
					app.realtime!,
				);
				const limitSnapshotConcurrency = createConcurrencyLimiter(
					admission.initialSnapshotConcurrency,
				);
				const limitDeltaHydration = createConcurrencyLimiter(
					admission.deltaHydrationConcurrency,
				);
				const heartbeatIntervalMs =
					app.config?.realtime?.keepAliveIntervalMs ?? 8000;
				const originalIdentity = realtimeControlIdentity(resolved.appContext);
				const controlToken = globalThis.crypto.randomUUID();
				let removeKeepAlive = () => {};
				let unregisterControl = () => {};
				flushPending = () => {
					void snapshotWriter.flush().catch(requestClose);
					void crdtDirtyWriter.flush().catch(requestClose);
				};
				const close = () => {
					if (closed) return;
					closed = true;
					releaseConnection();
					removeKeepAlive();
					unregisterControl();
					flushPending = null;
					snapshotWriter.clear();
					crdtDirtyWriter.clear();
					deltaWriter.clear();
					request.signal.removeEventListener("abort", close);
					void edge?.close().catch(() => {});
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
					if (!ownerIsActive(activeOwnerGeneration)) return;
					await sessionSink.write(
						encodeSseEvent(event, data),
						"latest-snapshot",
					);
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
					if (edge?.size && provisionalCrdtHold) provisionalCrdtHold = false;
					if (edge?.size === 0 && !provisionalCrdtHold) requestClose();
				};

				const teardownTopic = (topicId: string) => {
					void edge?.drop(topicId).then(closeIfEmpty).catch(requestClose);
				};

				const subscribeChannel = async (
					channel: ValidatedChannelSubscription,
				): Promise<RealtimeEdgeBinding> => {
					const bindingGeneration = activeOwnerGeneration;
					if (!ownerIsActive(bindingGeneration)) {
						throw new Error("Realtime owner is fenced");
					}
					let unsubscribeLedger: (() => void) | undefined;
					let unsubscribePresence: (() => Promise<void>) | undefined;
					const bindingInstanceId = globalThis.crypto.randomUUID();
					const fencedSink = createFencedClientSink(sink, () =>
						ownerIsActive(bindingGeneration),
					);
					const subscriptionSink = new RealtimeBindingOutputGate(fencedSink, {
						maximumOrderedEvents: admission.maxBufferedDeltaEvents,
						maximumBufferedBytes: admission.maxBufferedDeltaBytes,
						onError: requestClose,
					});
					try {
						unsubscribeLedger = await app.realtime!.subscribeChannel({
							subscriptionId: `${edgeSessionId}:${channel.id}:${bindingInstanceId}`,
							channel: channel.resolvedName,
							sink: subscriptionSink,
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
									connectionId: `${edgeSessionId}:${channel.id}:${bindingInstanceId}`,
									principalId,
									sink: subscriptionSink,
									data: channel.presence,
								},
							);
						}
						if (!ownerIsActive(bindingGeneration)) {
							throw new Error("Realtime owner is fenced");
						}
						if (subscriptionSink.error) throw subscriptionSink.error;
						return {
							activate: () => subscriptionSink.activate(),
							assertReady: () => subscriptionSink.assertReady(),
							close: async () => {
								await unsubscribePresence?.().catch(requestClose);
								unsubscribeLedger?.();
								await subscriptionSink.dispose();
							},
						};
					} catch (error) {
						await unsubscribePresence?.();
						unsubscribeLedger?.();
						await subscriptionSink.dispose();
						throw error;
					}
				};

				const subscribeTopic = async (
					topic: ValidatedTopic,
					baseContext: RealtimeRequestContext,
				): Promise<RealtimeEdgeBinding> => {
					const bindingGeneration = activeOwnerGeneration;
					if (!ownerIsActive(bindingGeneration)) {
						throw new Error("Realtime owner is fenced");
					}
					const topicContext =
						topic.locale && topic.locale !== baseContext.locale
							? { ...baseContext, locale: topic.locale }
							: baseContext;
					const accessKey = await resolveRealtimeAccessKey(
						edgeSessionId,
						topicContext,
						topic.accessCacheKey,
						await getFrozenSubscriptionScope(),
					);
					if (!ownerIsActive(bindingGeneration)) {
						throw new Error("Realtime owner is fenced");
					}
					const shapeDecision = classifyValidatedTopic(topic);
					const deliveryDecision =
						shapeDecision.mode === "delta" &&
						app.config.realtime?.nativeDeltas !== true
							? {
									mode: "snapshot" as const,
									reason: "native_deltas_disabled" as const,
								}
							: shapeDecision;
					const deliveryMode = deliveryDecision.mode;
					app.realtime!.record({
						type: "delivery.classified",
						...deliveryDecision,
					});
					const deliveryTopic = stampValidatedTopicMode(
						topic,
						deliveryMode,
						admission.maxFindLimit,
					);
					const topicSink: ClientSink = {
						sessionId: sessionSink.sessionId,
						write: (frame, delivery) => {
							if (delivery === "row-delta") {
								return deltaWriter.write(frame);
							}
							if (delivery === "latest-snapshot") {
								return snapshotWriter.write(topic.id, frame);
							}
							return sessionSink.write(frame, delivery);
						},
						close: (reason) => sessionSink.close(reason),
					};
					const output = new RealtimeBindingOutputGate(topicSink, {
						maximumOrderedEvents: admission.maxBufferedDeltaEvents,
						maximumBufferedBytes: Math.max(
							admission.maxBufferedSnapshotBytes,
							admission.maxBufferedDeltaBytes,
						),
						onError: requestClose,
					});
					const unsub = refreshScheduler.subscribe({
						key: schedulerKey(deliveryTopic, accessKey),
						topicId: topic.id,
						topics: {
							resourceType: topic.resourceType,
							resource: topic.resource,
							operation: topic.operation,
							where: topic.where,
							with: topic.with,
						},
						sinceSeq: topic.sinceSeq,
						mode: deliveryMode,
						captureWatermark:
							deliveryMode === "delta" || topicContext.db
								? () => captureRealtimeWatermark(topicContext)
								: undefined,
						heartbeatIntervalMs,
						compute: () =>
							limitSnapshotConcurrency(async () => {
								if (!ownerIsActive(bindingGeneration)) {
									throw new Error("Realtime owner is fenced");
								}
								const admittedTopic = await evaluateTopicAccess(
									app,
									deliveryTopic,
									topicContext,
								);
								const data = await computeRealtimeSnapshot(
									deliveryMode === "delta"
										? {
												...admittedTopic,
												limit: admission.maxDeltaFindLimit + 1,
											}
										: admittedTopic,
									topicContext,
								);
								if (deliveryMode === "delta") {
									const rowCount = deltaBootstrapSize(data);
									if (rowCount > admission.maxDeltaFindLimit) {
										throw deltaBootstrapLimitError(
											deliveryTopic,
											admission.maxDeltaFindLimit,
											rowCount,
										);
									}
								}
								if (!ownerIsActive(bindingGeneration)) {
									throw new Error("Realtime owner is fenced");
								}
								return data;
							}),
						hydrateRows:
							deliveryMode === "delta"
								? (recordIds) =>
										limitDeltaHydration(async () => {
											if (!ownerIsActive(bindingGeneration)) {
												throw new Error("Realtime owner is fenced");
											}
											const admittedTopic = await evaluateTopicAccess(
												app,
												deliveryTopic,
												topicContext,
											);
											const rows = await hydrateRealtimeRows(
												admittedTopic as Extract<
													ValidatedTopic,
													{
														type: "collection";
														operation: "find";
													}
												>,
												recordIds,
												topicContext,
											);
											if (!ownerIsActive(bindingGeneration)) {
												throw new Error("Realtime owner is fenced");
											}
											return rows;
										})
								: undefined,
						maxDeltaQueueEvents: admission.maxBufferedDeltaEvents,
						maxDeltaQueueBytes: admission.maxBufferedDeltaBytes,
						maxDeltaRows: admission.maxDeltaFindLimit,
						deltaRebootstrapIntervalMs:
							deliveryMode === "delta"
								? admission.deltaRebootstrapIntervalMs
								: undefined,
						onFrame: async (frame, frameKind) => {
							if (!ownerIsActive(bindingGeneration)) return;
							if (deliveryMode === "delta") {
								const maximumBootstrapBytes = Math.min(
									admission.maxBufferedSnapshotBytes,
									admission.maxBufferedDeltaBytes,
								);
								if (
									frameKind === "snapshot" &&
									frame.byteLength > maximumBootstrapBytes
								) {
									throw deltaBootstrapBytesError(
										deliveryTopic,
										maximumBootstrapBytes,
										frame.byteLength,
									);
								}
								await output.write(frame, "row-delta");
								return;
							}
							if (frame.byteLength > admission.maxBufferedSnapshotBytes) {
								observeAdmission("snapshot_bytes");
								const error = new Error(
									`Snapshot exceeds ${admission.maxBufferedSnapshotBytes} bytes`,
								);
								if (!output.active) {
									output.reject(error);
									return;
								}
								await sendTopicError(topic.id, error.message);
								teardownTopic(topic.id);
								return;
							}
							await output.write(frame, "latest-snapshot");
						},
						onError: (error) => {
							if (!ownerIsActive(bindingGeneration)) return;
							if (error instanceof RealtimeTopicAdmissionError) {
								observeTopicRejection(error);
							}
							const errorPayload =
								error instanceof RealtimeTopicAdmissionError
									? error.payload
									: {
											topicId: topic.id,
											message:
												error instanceof Error
													? error.message
													: "Refresh failed",
										};
							const permanent =
								isPermanentAccessError(error) ||
								error instanceof RealtimeSnapshotBufferOverflowError ||
								error instanceof RealtimeDeltaBufferOverflowError ||
								error instanceof RealtimeTopicAdmissionError;
							if (permanent && !output.active) {
								output.reject(error);
								return;
							}
							void output
								.write(encodeSseEvent("error", errorPayload), "latest-snapshot")
								.catch(requestClose)
								.finally(() => {
									// Transient compute/hydration failures remain subscribed so a
									// later change can drive the delta group through recovery.
									if (permanent) {
										teardownTopic(topic.id);
									}
								});
						},
						onTransportError: (error) => {
							if (!ownerIsActive(bindingGeneration)) return;
							if (!output.active) {
								output.reject(error);
								return;
							}
							void output
								.write(
									encodeSseEvent("error", {
										topicId: "*",
										message:
											error instanceof Error
												? error.message
												: "Realtime transport failed",
									}),
									"latest-snapshot",
								)
								.catch(() => {})
								.finally(requestClose);
						},
					});
					if (output.error) {
						unsub();
						await output.dispose();
						throw output.error;
					}
					return {
						activate: () => output.activate(),
						assertReady: () => output.assertReady(),
						close: async () => {
							unsub();
							await output.dispose();
						},
					};
				};

				const subscribeCrdt = async (
					subscription: RealtimeTopologyCrdt,
				): Promise<RealtimeEdgeBinding> => {
					const bindingGeneration = activeOwnerGeneration;
					if (!ownerIsActive(bindingGeneration)) {
						throw new Error("Realtime owner is fenced");
					}
					const capability = await app.realtime!.authorizeTopologySession({
						sessionId: edgeSessionId,
						token: controlToken,
						identity: originalIdentity,
					});
					if (
						!capability ||
						capability.ownerGeneration !== bindingGeneration ||
						!ownerIsActive(bindingGeneration)
					) {
						throw new Error("Realtime owner is fenced");
					}
					const crdtSink: ClientSink = {
						sessionId: sessionSink.sessionId,
						write: (frame, delivery) =>
							delivery === "latest-snapshot"
								? crdtDirtyWriter.write(subscription.id, frame)
								: sessionSink.write(frame, delivery),
						close: (reason) => sessionSink.close(reason),
					};
					const output = new RealtimeBindingOutputGate(crdtSink, {
						maximumOrderedEvents: 0,
						maximumBufferedBytes: admission.maxBufferedSnapshotBytes,
						onError: requestClose,
					});
					let release: (() => Promise<void>) | undefined;
					try {
						release = await app.crdtOperations.subscribeRealtimeBinding({
							bindingId: subscription.bindingId,
							edgeSessionKey: Buffer.from(capability.sessionKey, "hex"),
							edgeOwnerGeneration: BigInt(bindingGeneration),
							signal: ownerSignal!,
							onDirty: async () => {
								await output.write(
									encodeSseEvent("crdt_dirty", {
										topologyEntryId: subscription.id,
									}),
									"latest-snapshot",
								);
							},
							onError: (error) => {
								if (output.active) requestClose();
								else output.reject(error);
							},
						});
						if (output.error) throw output.error;
						return {
							activate: () => output.activate(),
							assertReady: () => output.assertReady(),
							close: async () => {
								await release?.();
								await output.dispose();
							},
						};
					} catch (error) {
						await release?.();
						await output.dispose();
						throw error;
					}
				};

				const topologySession = await app.realtime.openTopologySession({
					sessionId: edgeSessionId,
					token: controlToken,
					identity: originalIdentity,
					topology: initialTopology,
					apply: async ({ topology, ownerGeneration, signal }) => {
						if (closed) throw new Error("Realtime session is closed");
						if (signal.aborted) throw new Error("Realtime owner is fenced");
						if (ownerGeneration !== activeOwnerGeneration) {
							throw new Error("Realtime owner generation mismatch");
						}
						let candidate: ResolvedRealtimeTopologyCandidate;
						try {
							candidate = await resolveRealtimeTopologyCandidate(
								app,
								topology,
								resolved.appContext,
								admission,
							);
						} catch (error) {
							if (error instanceof RealtimeTopologyApplyRejectedError) {
								for (const entry of error.entries) {
									await send("error", {
										topologyEntryId: entry.id,
										kind: entry.kind,
										code: entry.code,
										message: entry.message,
									});
								}
							}
							throw error;
						}
						if (signal.aborted) throw new Error("Realtime owner is fenced");
						try {
							await edge!.apply(
								{ topology, ownerGeneration, signal },
								async (subscription) => {
									if (subscription.kind === "query") {
										const resolvedQuery = candidate.queries.get(
											subscription.id,
										)!;
										return subscribeTopic(
											resolvedQuery.topic,
											resolvedQuery.context,
										);
									}
									if (subscription.kind === "channel") {
										return subscribeChannel(
											candidate.channels.get(subscription.id)!.channel,
										);
									}
									if (subscription.kind === "crdt") {
										return subscribeCrdt(candidate.crdt.get(subscription.id)!);
									}
									return { activate: () => {}, close: () => {} };
								},
							);
						} catch (error) {
							const rejection = edgeStageRejection(error);
							if (rejection) {
								for (const entry of rejection.entries) {
									await send("error", {
										topologyEntryId: entry.id,
										kind: entry.kind,
										code: entry.code,
										message: entry.message,
									});
								}
								throw rejection;
							}
							throw error;
						}
						closeIfEmpty();
					},
					onClose: requestClose,
				});
				activeOwnerGeneration = topologySession.generation;
				ownerSignal = topologySession.signal;
				unregisterControl = () => void topologySession.close();
				edge = new RealtimeEdgeSession({
					...initialTopology,
					subscriptions: [],
				});
				await send("session", {
					sessionId: edgeSessionId,
					token: controlToken,
					control: {
						protocol: "questpie-realtime-topology",
						versions: [2],
					},
				});
				await edge.apply(
					{
						topology: initialTopology,
						ownerGeneration: topologySession.generation,
						signal: topologySession.signal,
					},
					async (subscription) => {
						if (subscription.kind === "query") {
							return subscribeTopic(
								validatedTopicsById.get(subscription.id)!,
								resolved.appContext,
							);
						}
						if (subscription.kind === "channel") {
							return subscribeChannel(
								validatedChannelsById.get(subscription.id)!,
							);
						}
						if (subscription.kind === "crdt") {
							return subscribeCrdt(subscription);
						}
						return { activate: () => {}, close: () => {} };
					},
				);

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
				removeKeepAlive = sharedSseKeepAliveTicker.register(
					heartbeatIntervalMs,
					(frame) => {
						void sessionSink
							.write(frame, "latest-snapshot")
							.catch(requestClose);
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
