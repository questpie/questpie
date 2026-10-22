import type { RequestContext } from "#questpie/server/config/context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import {
	isCollectionChangeCaptureEnabled,
	RealtimeTopicAdmissionError,
} from "#questpie/server/modules/core/integrated/realtime/admission.js";
import type { RealtimeTopics } from "#questpie/server/modules/core/integrated/realtime/types.js";
import { deserializeCompatibleTypedEventWire } from "#questpie/shared/typed-wire.js";

import { prepareJsonRoute } from "./execute.js";
import { introspectRoutes } from "./introspection.js";
import type { HttpMethod, RouteLiveDependencies } from "./types.js";

/** Transport identity uses the existing route catalog key, never a second URL registry. */
export type RouteQueryTopic = {
	resourceType: "route";
	resource: string;
	method: HttpMethod;
	operation: "query";
	input: unknown;
	params?: Record<string, string>;
	locale?: string;
};

export function routeTopicRejection(
	topic: { id: string; resource: string },
	reason:
		| "access"
		| "operation_shape"
		| "not_found"
		| "change_capture_disabled"
		| "collection_change_capture_disabled",
	message: string,
) {
	return new RealtimeTopicAdmissionError({
		code: "REALTIME_TOPIC_REJECTED",
		topicId: topic.id,
		resource: topic.resource,
		operation: "query",
		retryable: false,
		message,
		details: { reason },
	});
}

export function resolveRouteQueryTopic(
	app: Questpie<any>,
	wire: RouteQueryTopic & { id: string },
	context: RequestContext,
) {
	const topic = deserializeCompatibleTypedEventWire<
		RouteQueryTopic & { id: string }
	>(wire);
	if (
		topic.operation !== "query" ||
		typeof topic.method !== "string" ||
		topic.method !== topic.method.toUpperCase()
	)
		throw routeTopicRejection(
			topic,
			"operation_shape",
			"Route watches require a query and uppercase HTTP method",
		);
	const allowedKeys = new Set([
		"id",
		"resourceType",
		"resource",
		"method",
		"operation",
		"input",
		"params",
		"locale",
		"sinceSeq",
	]);
	if (Object.keys(topic).some((key) => !allowedKeys.has(key)))
		throw routeTopicRejection(
			topic,
			"operation_shape",
			"Route watches accept only server-declared dependencies and snapshots",
		);
	const entry = introspectRoutes(app).find(
		(entry) =>
			entry.key === topic.resource && entry.methods.includes(topic.method),
	);
	if (!entry)
		throw routeTopicRejection(topic, "not_found", "Route query not found");
	const definition = entry.definition;
	if (definition.mode !== "json" || !definition.query?.live)
		throw routeTopicRejection(
			topic,
			"operation_shape",
			"Only explicit LIVE JSON queries can be watched",
		);
	if (
		app.config.realtime?.clientTransport?.channelDeliveryScope ===
		"shared-provider"
	)
		throw routeTopicRejection(
			topic,
			"operation_shape",
			"Route watches require the SSE transport",
		);
	if (app.config.realtime?.changeCapture === false)
		throw routeTopicRejection(
			topic,
			"change_capture_disabled",
			"Route watches require change capture",
		);
	const params = topic.params ?? {};
	if (
		!params ||
		typeof params !== "object" ||
		Array.isArray(params) ||
		Object.values(params).some((value) => typeof value !== "string") ||
		entry.params.some((key) => !Object.hasOwn(params, key)) ||
		Object.keys(params).some((key) => !entry.params.includes(key))
	)
		throw routeTopicRejection(
			topic,
			"operation_shape",
			"Route watches require the route's string path parameters",
		);
	const sourceRequest = context.request;
	if (!(sourceRequest instanceof Request))
		throw new Error("Route watches require a verified request");
	const url = new URL(sourceRequest.url);
	const path = entry.path.replace(/[:*]([^/]+)/g, (_, key: string) =>
		encodeURIComponent(params[key]!),
	);
	url.pathname = url.pathname.replace(/\/realtime\/?$/, "") + path;
	url.search = "";
	if (topic.locale) url.searchParams.set("locale", topic.locale);
	const request = new Request(url, {
		method: topic.method,
		headers: sourceRequest.headers,
		signal: sourceRequest.signal,
	});
	return { topic, definition, live: definition.query.live, request, params };
}

export function prepareRouteQueryTopic(
	app: Questpie<any>,
	wire: RouteQueryTopic & { id: string },
	context: RequestContext,
) {
	const { topic, definition, live, request, params } = resolveRouteQueryTopic(
		app,
		wire,
		context,
	);

	const prepared = prepareJsonRoute(
		app,
		definition,
		topic.input,
		request,
		params,
	);
	const dependencies = new Map<
		string,
		{ topic: RealtimeTopics; authority: boolean }
	>();
	const collections = app.getCollections() as Record<string, unknown>;
	const add = (declared: RouteLiveDependencies, authority: boolean) => {
		if (!declared || typeof declared !== "object" || Array.isArray(declared))
			throw new Error("LIVE dependencies must be a collection record");
		for (const [resource, anchor] of Object.entries(declared)) {
			if (!Object.hasOwn(collections, resource))
				throw routeTopicRejection(
					topic,
					"not_found",
					"LIVE dependency collection not found",
				);
			if (!isCollectionChangeCaptureEnabled(collections[resource]))
				throw routeTopicRejection(
					topic,
					"collection_change_capture_disabled",
					"LIVE dependency has change capture disabled",
				);
			if (
				anchor !== true &&
				(!anchor ||
					typeof anchor !== "object" ||
					Array.isArray(anchor) ||
					Object.values(anchor).some(
						(value) =>
							!["string", "number", "boolean"].includes(typeof value) ||
							(typeof value === "number" && !Number.isFinite(value)),
					))
			)
				throw routeTopicRejection(
					topic,
					"operation_shape",
					"LIVE anchors must contain finite scalar equalities",
				);
			const fields =
				(
					collections[resource] as {
						state?: { fields?: Record<string, unknown> };
					}
				).state?.fields ?? {};
			if (
				anchor !== true &&
				Object.keys(anchor).some(
					(key) => key !== "id" && !Object.hasOwn(fields, key),
				)
			)
				throw routeTopicRejection(
					topic,
					"operation_shape",
					"LIVE equality anchors must name collection fields",
				);
			const where =
				anchor === true
					? undefined
					: Object.fromEntries(
							Object.entries(anchor).sort(([a], [b]) => a.localeCompare(b)),
						);
			const key = JSON.stringify([resource, where]);
			const previous = dependencies.get(key);
			dependencies.set(key, {
				topic: {
					resourceType: "collection",
					resource,
					...(where ? { where } : {}),
				},
				authority: authority || previous?.authority === true,
			});
		}
	};
	add(live.data(prepared.input), false);
	add(live.authority?.(prepared.input) ?? {}, true);
	// Dependency selection can use verified identity; DB-backed facts belong to the snapshot.
	add(
		app.config.realtime?.authority?.({
			session: context.session,
			principal: context.principal,
			actor: context.actor,
			locale: topic.locale ?? context.locale,
			accessMode: context.accessMode,
			request,
		}) ?? {},
		true,
	);
	const maxAgeMs = live.maxAgeMs ?? 60_000;
	return {
		topic,
		request,
		prepared,
		dependencies: [...dependencies.values()],
		maxAgeMs,
	};
}
