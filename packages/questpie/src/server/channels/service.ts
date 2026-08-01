import type { z } from "zod";

import {
	FRAMEWORK_CONTEXT_KEYS,
	SERVICE_CONTEXT_VIRTUAL_KEYS,
	type AppContext,
} from "#questpie/server/config/app-context.js";
import type { Principal } from "#questpie/server/config/context.js";
import type { AuthorityActor } from "#questpie/server/modules/core/integrated/crdt/authority.js";
import type {
	AppendChannelEventInput,
	AppendChannelEventOptions,
	ChannelEventReceipt,
} from "#questpie/server/modules/core/integrated/realtime/channel-event-ledger.js";

import type { ChannelAuthoritySubject } from "./authority.js";
import {
	type AnyChannelDefinition,
	type ChannelAuthorizationRule,
	type ChannelDefinitions,
	type ChannelEventsOf,
	type ChannelParamsOf,
	type ChannelPresenceOf,
} from "./channel-builder.js";
import {
	assertChannelPayloadSize,
	assertUniqueResolvedChannelName,
	type ChannelSecurityConfig,
} from "./security.js";

export type { ChannelAuthoritySubject } from "./authority.js";

export type ChannelRuntimeErrorCode =
	| "channel_not_found"
	| "channel_publish_denied"
	| "channel_subscribe_denied"
	| "channel_event_not_found"
	| "channel_event_invalid"
	| "channel_presence_unavailable";

export class ChannelRuntimeError extends Error {
	constructor(
		readonly code: ChannelRuntimeErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "ChannelRuntimeError";
	}
}

export interface ChannelPublisher {
	appendChannelEvent(
		input: AppendChannelEventInput,
		options?: AppendChannelEventOptions,
	): Promise<ChannelEventReceipt>;
	revokeChannelAuthority?(
		input: ChannelAuthorityRevocation,
		options?: AppendChannelEventOptions,
	): Promise<ChannelAuthorityRevocationReceipt>;
}

export type ChannelAuthorityRevocation = Readonly<{
	channel: string;
	subject: ChannelAuthoritySubject;
	idempotencyKey: string;
}>;

export type ChannelAuthorityRevocationReceipt = Readonly<{
	scope: "exact-subscription" | "principal-connections";
	generation: number;
}>;

export type ChannelServiceContext = AppContext & {
	accessMode?: string;
	actor?: AuthorityActor;
	db?: AppendChannelEventOptions["db"];
	principal?: Principal;
};

type StoredChannelServiceContext = AppContext & {
	accessMode?: string;
	actor?: AuthorityActor;
	db?: AppendChannelEventOptions["db"];
	principal?: Principal;
	session?: unknown;
};

type ChannelContextSnapshot = Readonly<{
	context: StoredChannelServiceContext;
	virtualKeys: readonly string[];
}>;

type EventInput<TDefinition extends AnyChannelDefinition> = {
	[TEvent in keyof ChannelEventsOf<TDefinition> & string]: {
		event: TEvent;
		data: z.input<ChannelEventsOf<TDefinition>[TEvent]>;
	};
}[keyof ChannelEventsOf<TDefinition> & string];

type ParamsInput<TDefinition extends AnyChannelDefinition> =
	keyof ChannelParamsOf<TDefinition> extends never
		? { params?: never }
		: { params: ChannelParamsOf<TDefinition> };

export type ChannelPublishInput<TDefinition extends AnyChannelDefinition> =
	EventInput<TDefinition> & ParamsInput<TDefinition>;

export type ChannelAuthorityRevocationInput<
	TDefinition extends AnyChannelDefinition,
> = Readonly<{
	subject: ChannelAuthoritySubject;
	idempotencyKey: string;
}> &
	ParamsInput<TDefinition>;

export type ChannelPublishRequest<TChannels extends ChannelDefinitions> = {
	[TChannel in keyof TChannels & string]: {
		channel: TChannel;
	} & ChannelPublishInput<TChannels[TChannel]>;
}[keyof TChannels & string];

export type ChannelPublishReceipt = Readonly<{
	eventId: string;
}>;

export type PreparedChannelPublish = Readonly<AppendChannelEventInput>;

type RuntimeChannelPublishInput = {
	params?: Record<string, string>;
	event: string;
	data: unknown;
};

function isSystemContext(context: StoredChannelServiceContext): boolean {
	if (context.accessMode === "system") return true;
	if (context.accessMode === "user") return false;
	if (context.principal?.kind === "system") return true;
	return !context.session && !context.principal;
}

function cloneAuthorityValue<T>(
	value: T,
	seen: WeakMap<object, unknown> = new WeakMap(),
): T {
	if (value instanceof Date) return new Date(value.getTime()) as T;
	if (Array.isArray(value)) {
		const cached = seen.get(value);
		if (cached) return cached as T;
		const clone: unknown[] = [];
		seen.set(value, clone);
		for (const item of value) clone.push(cloneAuthorityValue(item, seen));
		return Object.freeze(clone) as T;
	}
	if (!value || typeof value !== "object") return value;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return value;
	const cached = seen.get(value);
	if (cached) return cached as T;
	const clone = Object.create(prototype) as Record<PropertyKey, unknown>;
	seen.set(value, clone);
	for (const property of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, property);
		if (!descriptor) continue;
		Object.defineProperty(clone, property, {
			...descriptor,
			...("value" in descriptor
				? { value: cloneAuthorityValue(descriptor.value, seen) }
				: {}),
		});
	}
	return Object.freeze(clone) as T;
}

function snapshotChannelContext(
	context: ChannelServiceContext,
): ChannelContextSnapshot {
	const source = context;
	const snapshot = { ...context } as StoredChannelServiceContext &
		Record<PropertyKey, unknown>;
	for (const key of FRAMEWORK_CONTEXT_KEYS) {
		// Resolving the service currently under construction would recurse.
		// It is injected as `channels: this` in each operation context below.
		if (key === "channels" || Object.hasOwn(snapshot, key)) continue;
		const value = Reflect.get(source, key);
		if (value !== undefined) snapshot[key] = value;
	}
	snapshot.session = cloneAuthorityValue(snapshot.session);
	snapshot.principal = cloneAuthorityValue(snapshot.principal);
	snapshot.actor = cloneAuthorityValue(snapshot.actor);
	const virtualKeys = Reflect.get(
		source,
		SERVICE_CONTEXT_VIRTUAL_KEYS,
	) as unknown;

	/*
	 * Authority-bearing framework fields must be fixed for the lifetime of this
	 * request-bound facade. Unknown application namespaces may remain lazy, but
	 * must never become a back door for later mutation of session/principal/db.
	 */
	return {
		context: new Proxy(snapshot, {
			get(target, property, receiver) {
				if (Reflect.has(target, property)) {
					return Reflect.get(target, property, receiver);
				}
				if (
					typeof property === "string" &&
					FRAMEWORK_CONTEXT_KEYS.has(property)
				) {
					return undefined;
				}
				return Reflect.get(source, property);
			},
			has(target, property) {
				if (Reflect.has(target, property)) return true;
				if (
					typeof property === "string" &&
					FRAMEWORK_CONTEXT_KEYS.has(property)
				) {
					return false;
				}
				return Reflect.has(source, property);
			},
		}),
		virtualKeys: Array.isArray(virtualKeys)
			? virtualKeys.filter((key): key is string => typeof key === "string")
			: [],
	};
}

/** Request-bound typed facade over the shared realtime client transport. */
export class ChannelsService<
	TChannels extends ChannelDefinitions = ChannelDefinitions,
> {
	constructor(
		private readonly definitions: TChannels,
		private readonly publisher: ChannelPublisher,
		context: ChannelServiceContext,
		private readonly security: ChannelSecurityConfig = {},
	) {
		const snapshot = snapshotChannelContext(context);
		this.context = snapshot.context;
		this.virtualContextKeys = snapshot.virtualKeys;
	}

	private readonly context: StoredChannelServiceContext;
	private readonly virtualContextKeys: readonly string[];

	getDefinition<TChannel extends keyof TChannels & string>(
		channel: TChannel,
	): TChannels[TChannel] {
		const definition = this.definitions[channel];
		if (!definition) {
			throw new ChannelRuntimeError(
				"channel_not_found",
				`Unknown channel "${channel}"`,
			);
		}
		return definition;
	}

	resolveName<TChannel extends keyof TChannels & string>(
		channel: TChannel,
		params: ChannelParamsOf<TChannels[TChannel]>,
	): string {
		this.getDefinition(channel);
		return assertUniqueResolvedChannelName(
			this.definitions,
			channel,
			params as Record<string, string>,
		);
	}

	async authorize<TChannel extends keyof TChannels & string>(
		channel: TChannel,
		params: ChannelParamsOf<TChannels[TChannel]>,
		verb: "subscribe" | "publish",
	): Promise<boolean> {
		const definition = this.getDefinition(channel);
		assertUniqueResolvedChannelName(
			this.definitions,
			channel,
			params as Record<string, string>,
		);

		if (verb === "publish" && isSystemContext(this.context)) return true;
		const authorization = definition.authorization;
		if (!authorization) return verb === "subscribe";
		const rule =
			verb === "publish"
				? (authorization.publish ?? authorization.subscribe)
				: authorization.subscribe;
		return this.evaluateRule(rule, params);
	}

	async resolvePresence<TChannel extends keyof TChannels & string>(
		channel: TChannel,
		params: ChannelParamsOf<TChannels[TChannel]>,
	): Promise<ChannelPresenceOf<TChannels[TChannel]>> {
		const definition = this.getDefinition(channel);
		if (!definition.presenceResolver) {
			throw new ChannelRuntimeError(
				"channel_presence_unavailable",
				`Channel "${channel}" does not define presence`,
			);
		}
		if (!(await this.authorize(channel, params, "subscribe"))) {
			throw new ChannelRuntimeError(
				"channel_subscribe_denied",
				`Subscription to channel "${channel}" is denied`,
			);
		}
		return definition.presenceResolver(
			this.operationContext(params),
		) as ChannelPresenceOf<TChannels[TChannel]>;
	}

	/**
	 * Publish a framework-validated server event.
	 *
	 * In collection/global hooks, use the injected `{ channels }` argument.
	 * Contextless update/delete calls do not establish an ALS scope, so resolving
	 * the service later through ambient `getContext()` is not reliable there.
	 */
	async publish<TChannel extends keyof TChannels & string>(
		channel: TChannel,
		input: ChannelPublishInput<TChannels[TChannel]>,
	): Promise<ChannelPublishReceipt> {
		const prepared = await this.preparePublish(channel, input);
		return this.publishPrepared(prepared);
	}

	/**
	 * Revoke current delivery authority for one subject on one channel identity.
	 *
	 * The provider-neutral receipt documents whether the configured transport
	 * closed the exact logical subscription or conservatively terminated all
	 * physical connections for that principal.
	 */
	revokeAuthority<TChannel extends keyof TChannels & string>(
		channel: TChannel,
		input: ChannelAuthorityRevocationInput<TChannels[TChannel]>,
	): Promise<ChannelAuthorityRevocationReceipt> {
		if (!input.subject.id || input.subject.id.length > 256) {
			throw new Error("Channel authority subject is invalid");
		}
		const params = (input.params ?? {}) as ChannelParamsOf<TChannels[TChannel]>;
		const resolvedName = this.resolveName(channel, params);
		if (!this.publisher.revokeChannelAuthority) {
			throw new Error("Channel authority revocation is unavailable");
		}
		return this.publisher.revokeChannelAuthority(
			{
				channel: resolvedName,
				subject: input.subject,
				idempotencyKey: input.idempotencyKey,
			},
			{ db: this.context.db },
		);
	}

	/** Validate a client publish completely without allocating a ledger event id. */
	async preparePublish<TChannel extends keyof TChannels & string>(
		channel: TChannel,
		input: ChannelPublishInput<TChannels[TChannel]>,
	): Promise<PreparedChannelPublish> {
		return this.prepareRuntimePublish(
			channel,
			input as RuntimeChannelPublishInput,
		);
	}

	/** @internal Schema-validating route boundary for runtime string input. */
	preparePublishRequest<TChannel extends keyof TChannels & string>(
		channel: TChannel,
		input: RuntimeChannelPublishInput,
	): Promise<PreparedChannelPublish> {
		return this.prepareRuntimePublish(channel, input);
	}

	private async prepareRuntimePublish<
		TChannel extends keyof TChannels & string,
	>(
		channel: TChannel,
		input: RuntimeChannelPublishInput,
	): Promise<PreparedChannelPublish> {
		const definition = this.getDefinition(channel);
		const params = (input.params ?? {}) as ChannelParamsOf<TChannels[TChannel]>;
		const resolvedName = assertUniqueResolvedChannelName(
			this.definitions,
			channel,
			params as Record<string, string>,
		);
		if (!(await this.authorize(channel, params, "publish"))) {
			throw new ChannelRuntimeError(
				"channel_publish_denied",
				`Publishing to channel "${channel}" is denied`,
			);
		}

		const event = input.event;
		const schema = definition.eventSchemas[event];
		if (!schema) {
			throw new ChannelRuntimeError(
				"channel_event_not_found",
				`Unknown event "${event}" on channel "${channel}"`,
			);
		}
		const parsed = await schema.safeParseAsync(input.data);
		if (!parsed.success) {
			throw new ChannelRuntimeError(
				"channel_event_invalid",
				`Invalid event "${event}" on channel "${channel}"`,
				{ cause: parsed.error },
			);
		}
		assertChannelPayloadSize(parsed.data);

		return {
			channel: resolvedName,
			event,
			schemaIdentity: `${String(channel)}:${event}`,
			data: parsed.data,
		};
	}

	/** Append a previously validated publish after route-level admission checks. */
	publishPrepared(
		prepared: PreparedChannelPublish,
	): Promise<ChannelPublishReceipt> {
		return this.publisher.appendChannelEvent(prepared, {
			db: this.context.db,
		});
	}

	async publishBatch(
		requests: readonly ChannelPublishRequest<TChannels>[],
	): Promise<ChannelPublishReceipt[]> {
		const receipts: ChannelPublishReceipt[] = [];
		for (const request of requests) {
			const { channel, ...input } =
				request as ChannelPublishRequest<TChannels> & Record<string, unknown>;
			receipts.push(await this.publish(channel as any, input as any));
		}
		return receipts;
	}

	private async evaluateRule(
		rule: ChannelAuthorizationRule<string>,
		params: Record<string, string>,
	): Promise<boolean> {
		if (typeof rule === "boolean") return rule;
		const timeoutMs = this.security.authorizationTimeoutMs ?? 5_000;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const result = await Promise.race([
				Promise.resolve(rule(this.operationContext(params))),
				new Promise<false>((resolve) => {
					timer = setTimeout(() => resolve(false), timeoutMs);
				}),
			]);
			return result === true;
		} catch {
			return false;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private operationContext(
		params: Record<string, string>,
	): ChannelServiceContext & { params: Record<string, string> } {
		const source = this.context;
		const snapshot = {
			...this.context,
			session: cloneAuthorityValue(this.context.session),
			principal: cloneAuthorityValue(this.context.principal),
			actor: cloneAuthorityValue(this.context.actor),
			params,
		};
		Object.defineProperty(snapshot, "channels", {
			configurable: true,
			enumerable: true,
			value: this,
			writable: false,
		});
		const virtualKeys = this.virtualContextKeys;
		for (const key of virtualKeys) {
			if (Object.hasOwn(snapshot, key)) continue;
			Object.defineProperty(snapshot, key, {
				configurable: true,
				enumerable: true,
				get: () => Reflect.get(source, key),
			});
		}
		return new Proxy(snapshot, {
			get(target, property, receiver) {
				if (Reflect.has(target, property)) {
					return Reflect.get(target, property, receiver);
				}
				return Reflect.get(source, property);
			},
			has(target, property) {
				return Reflect.has(target, property) || Reflect.has(source, property);
			},
		});
	}
}
