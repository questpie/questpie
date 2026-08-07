import type { z } from "zod";

import type { AppContext } from "#questpie/server/config/app-context.js";
import type { Principal } from "#questpie/server/config/context.js";
import {
	type AppendChannelEventInput,
	type AppendChannelEventOptions,
	type ChannelEventReceipt,
	hashResolvedChannel,
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
	| "channel_presence_unavailable"
	/**
	 * The authorization rule THREW. Not a denial — a bug in the rule, or a
	 * context the rule was handed that is missing something it declares. Fails
	 * closed like a denial, and is reported separately so the two stop looking
	 * the same from outside.
	 */
	| "channel_rule_failed";

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
	db?: AppendChannelEventOptions["db"];
	principal?: Principal;
};

type StoredChannelServiceContext = AppContext & {
	accessMode?: string;
	db?: AppendChannelEventOptions["db"];
	principal?: Principal;
	session?: unknown;
};

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
		this.context = { ...context };
	}

	private readonly context: StoredChannelServiceContext;

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
		return this.evaluateRule(channel, verb, rule, params);
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
		return definition.presenceResolver({
			...this.context,
			params,
		}) as ChannelPresenceOf<TChannels[TChannel]>;
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

	/**
	 * Publish to several channels with a deterministic lock order.
	 *
	 * Each append takes a row lock on its channel's sequence head and holds it
	 * until the caller's transaction commits. Two concurrent batches touching
	 * the same channels in opposite orders therefore deadlock — a real
	 * `40P01` from Postgres, not a theoretical one. Appending in resolved-hash
	 * order gives every caller the same order, so they queue instead.
	 *
	 * Validation for the whole batch runs before the first append, so an
	 * invalid request no longer leaves the earlier ones published.
	 */
	async publishBatch(
		requests: readonly ChannelPublishRequest<TChannels>[],
	): Promise<ChannelPublishReceipt[]> {
		const prepared = await Promise.all(
			requests.map(async (request, index) => {
				const { channel, ...input } =
					request as ChannelPublishRequest<TChannels> & Record<string, unknown>;
				const publish = await this.preparePublish(channel as any, input as any);
				return {
					index,
					publish,
					lockKey: hashResolvedChannel(publish.channel),
				};
			}),
		);
		// A stable sort keeps same-channel events in the order the caller wrote
		// them, which is the only ordering the ledger promises.
		const ordered = [...prepared].sort((a, b) =>
			a.lockKey < b.lockKey ? -1 : a.lockKey > b.lockKey ? 1 : 0,
		);
		const receipts: ChannelPublishReceipt[] = Array.from({
			length: requests.length,
		});
		for (const entry of ordered) {
			receipts[entry.index] = await this.publishPrepared(entry.publish);
		}
		return receipts;
	}

	private async evaluateRule(
		channel: string,
		verb: "subscribe" | "publish",
		rule: ChannelAuthorizationRule<string>,
		params: Record<string, string>,
	): Promise<boolean> {
		if (typeof rule === "boolean") return rule;
		const timeoutMs = this.security.authorizationTimeoutMs ?? 5_000;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const result = await Promise.race([
				Promise.resolve(rule({ ...this.context, params })),
				new Promise<false>((resolve) => {
					timer = setTimeout(() => resolve(false), timeoutMs);
				}),
			]);
			return result === true;
		} catch (error) {
			/* A rule that THREW and a rule that returned false are different
			   facts. Both fail closed — that part is deliberate and unchanged —
			   but a bare `return false` here made a TypeError, a typo and a
			   genuine "you may not subscribe" indistinguishable from outside,
			   which is how a missing `context.collections` on the SSE path spent
			   two investigations wearing a denial's clothes.

			   Logged at the source because the callers upstream of this (the
			   ledger's reauthorize loops) fail closed silently by design, so the
			   throw below does not always reach an operator on its own. */
			this.logRuleFailure(channel, verb, error);
			throw new ChannelRuntimeError(
				"channel_rule_failed",
				`Channel "${channel}" ${verb} rule failed`,
				{ cause: error },
			);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private logRuleFailure(
		channel: string,
		verb: "subscribe" | "publish",
		error: unknown,
	): void {
		const logger = (this.context as { logger?: unknown }).logger as
			| { error?: (message: string, ...args: unknown[]) => void }
			| undefined;
		logger?.error?.(
			`[questpie] channel "${channel}" ${verb} rule threw; failing closed`,
			error,
		);
	}
}
