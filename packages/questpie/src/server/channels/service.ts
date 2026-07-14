import type { z } from "zod";

import type { AppContext } from "#questpie/server/config/app-context.js";
import type { Principal } from "#questpie/server/config/context.js";
import type {
	AppendChannelEventInput,
	AppendChannelEventOptions,
	ChannelEventReceipt,
} from "#questpie/server/modules/core/integrated/realtime/channel-event-ledger.js";

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
}

export type ChannelServiceContext = AppContext & {
	accessMode?: string;
	principal?: Principal;
};

type StoredChannelServiceContext = Record<string, unknown> & {
	accessMode?: string;
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

export type ChannelPublishRequest<TChannels extends ChannelDefinitions> = {
	[TChannel in keyof TChannels & string]: {
		channel: TChannel;
	} & ChannelPublishInput<TChannels[TChannel]>;
}[keyof TChannels & string];

export type ChannelPublishReceipt = Readonly<{
	eventId: string;
}>;

export type PreparedChannelPublish = Readonly<AppendChannelEventInput>;

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
		this.context = context as unknown as StoredChannelServiceContext;
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
		return definition.presenceResolver({
			...this.context,
			params,
		} as any) as ChannelPresenceOf<TChannels[TChannel]>;
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

	/** Validate a client publish completely without allocating a ledger event id. */
	async preparePublish<TChannel extends keyof TChannels & string>(
		channel: TChannel,
		input: ChannelPublishInput<TChannels[TChannel]>,
	): Promise<PreparedChannelPublish> {
		const definition = this.getDefinition(channel);
		const params = ((input as { params?: Record<string, string> }).params ??
			{}) as ChannelParamsOf<TChannels[TChannel]>;
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

		const event = (input as { event: string }).event;
		const schema = definition.eventSchemas[event];
		if (!schema) {
			throw new ChannelRuntimeError(
				"channel_event_not_found",
				`Unknown event "${event}" on channel "${channel}"`,
			);
		}
		const parsed = await schema.safeParseAsync(
			(input as { data: unknown }).data,
		);
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
			db: this.context.db as AppendChannelEventOptions["db"],
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
		rule: ChannelAuthorizationRule<any>,
		params: Record<string, string>,
	): Promise<boolean> {
		if (typeof rule === "boolean") return rule;
		const timeoutMs = this.security.authorizationTimeoutMs ?? 5_000;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const result = await Promise.race([
				Promise.resolve(rule({ ...this.context, params } as any)),
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
}
