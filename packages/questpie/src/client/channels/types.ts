import type { z } from "zod";

import type {
	AnyChannelDefinition,
	ChannelDefinitions,
	ChannelEventsOf,
	ChannelParamsOf,
	ChannelPresenceOf,
	ChannelVisibility,
} from "#questpie/server/channels/channel-builder.js";

type EventOutput<TDefinition extends AnyChannelDefinition> = {
	[TEvent in keyof ChannelEventsOf<TDefinition> & string]: {
		event: TEvent;
		eventId: string;
		data: z.output<ChannelEventsOf<TDefinition>[TEvent]>;
	};
}[keyof ChannelEventsOf<TDefinition> & string];

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

export type ChannelMessage<TDefinition extends AnyChannelDefinition> =
	EventOutput<TDefinition>;

export type ChannelPublishInput<TDefinition extends AnyChannelDefinition> =
	EventInput<TDefinition> & ParamsInput<TDefinition>;

export type ChannelPublishReceipt = Readonly<{ eventId: string }>;

export type ChannelSubscribeOptions = {
	signal?: AbortSignal;
	onError?: (error: Error) => void;
	/** Authorized and caught up for the current transport subscription epoch. */
	onReady?: () => void;
	/** The admitted epoch ended; a reconnect may later call `onReady` again. */
	onNotReady?: () => void;
};

export type ChannelPresenceOptions = Omit<
	ChannelSubscribeOptions,
	"onReady" | "onNotReady"
>;

type SubscribeMethod<TDefinition extends AnyChannelDefinition> =
	keyof ChannelParamsOf<TDefinition> extends never
		? (
				callback: (message: ChannelMessage<TDefinition>) => void,
				options?: ChannelSubscribeOptions,
			) => () => void
		: (
				params: ChannelParamsOf<TDefinition>,
				callback: (message: ChannelMessage<TDefinition>) => void,
				options?: ChannelSubscribeOptions,
			) => () => void;

type IterMethod<TDefinition extends AnyChannelDefinition> =
	keyof ChannelParamsOf<TDefinition> extends never
		? (
				options?: ChannelSubscribeOptions,
			) => AsyncGenerator<ChannelMessage<TDefinition>, void, unknown>
		: (
				params: ChannelParamsOf<TDefinition>,
				options?: ChannelSubscribeOptions,
			) => AsyncGenerator<ChannelMessage<TDefinition>, void, unknown>;

type PresenceMethod<TDefinition extends AnyChannelDefinition> = [
	ChannelPresenceOf<TDefinition>,
] extends [never]
	? never
	: keyof ChannelParamsOf<TDefinition> extends never
		? (
				options?: ChannelPresenceOptions,
			) => Promise<readonly ChannelPresenceOf<TDefinition>[]>
		: (
				params: ChannelParamsOf<TDefinition>,
				options?: ChannelPresenceOptions,
			) => Promise<readonly ChannelPresenceOf<TDefinition>[]>;

type SubscribePresenceMethod<TDefinition extends AnyChannelDefinition> = [
	ChannelPresenceOf<TDefinition>,
] extends [never]
	? never
	: keyof ChannelParamsOf<TDefinition> extends never
		? (
				callback: (members: readonly ChannelPresenceOf<TDefinition>[]) => void,
				options?: ChannelSubscribeOptions,
			) => () => void
		: (
				params: ChannelParamsOf<TDefinition>,
				callback: (members: readonly ChannelPresenceOf<TDefinition>[]) => void,
				options?: ChannelSubscribeOptions,
			) => () => void;

type PresenceIterMethod<TDefinition extends AnyChannelDefinition> = [
	ChannelPresenceOf<TDefinition>,
] extends [never]
	? never
	: keyof ChannelParamsOf<TDefinition> extends never
		? (
				options?: ChannelSubscribeOptions,
			) => AsyncGenerator<
				readonly ChannelPresenceOf<TDefinition>[],
				void,
				unknown
			>
		: (
				params: ChannelParamsOf<TDefinition>,
				options?: ChannelSubscribeOptions,
			) => AsyncGenerator<
				readonly ChannelPresenceOf<TDefinition>[],
				void,
				unknown
			>;

export type ChannelClient<TDefinition extends AnyChannelDefinition> = {
	subscribe: SubscribeMethod<TDefinition>;
	publish: (
		input: ChannelPublishInput<TDefinition>,
	) => Promise<ChannelPublishReceipt>;
	iter: IterMethod<TDefinition>;
	presence: PresenceMethod<TDefinition>;
	subscribePresence: SubscribePresenceMethod<TDefinition>;
	presenceIter: PresenceIterMethod<TDefinition>;
};

export type ChannelsClient<TChannels extends ChannelDefinitions> = {
	[TChannel in keyof TChannels]: ChannelClient<TChannels[TChannel]>;
} & {
	destroy(): void;
	readonly channelCount: number;
	readonly subscriberCount: number;
};

export type ChannelClientDescriptor = Readonly<{
	pattern: string;
	visibility: ChannelVisibility;
}>;

export type ChannelClientTransportConfig =
	| {
			transport: "sse";
			channels: Record<string, ChannelClientDescriptor>;
	  }
	| {
			transport: "shared-provider";
			config: Record<string, unknown> & { provider?: unknown; key?: unknown };
			channels: Record<string, ChannelClientDescriptor>;
	  };

export type ChannelConnectionInput = Readonly<{
	registryKey: string;
	params: Record<string, string>;
	resolvedName: string;
	visibility: ChannelVisibility;
}>;

export type ChannelTransportMessage = Readonly<{
	event: string;
	eventId: string;
	data: unknown;
}>;

export interface ChannelClientTransport {
	subscribe(
		input: ChannelConnectionInput,
		callback: (message: ChannelTransportMessage) => void,
		options?: ChannelSubscribeOptions,
	): () => void;
	presence(
		input: ChannelConnectionInput,
		options?: ChannelPresenceOptions,
	): Promise<readonly unknown[]>;
	subscribePresence(
		input: ChannelConnectionInput,
		callback: (members: readonly unknown[]) => void,
		options?: ChannelSubscribeOptions,
	): () => void;
	destroy(): void;
	readonly channelCount: number;
	readonly subscriberCount: number;
}

const CHANNEL_NAME_PATTERN = /^[A-Za-z0-9_\-=@,.;]+$/;

export function resolveChannelClientName(
	descriptor: ChannelClientDescriptor,
	params: Record<string, string>,
): string {
	const expected = [...descriptor.pattern.matchAll(/\[([^\]]+)\]/g)].map(
		(match) => match[1] as string,
	);
	if (
		expected.length !== Object.keys(params).length ||
		expected.some((key) => !Object.hasOwn(params, key))
	) {
		throw new Error("Channel params do not match the wire pattern");
	}
	const applicationName = descriptor.pattern.replace(
		/\[([^\]]+)\]/g,
		(_match, key: string) => {
			const value = params[key];
			if (!value || !CHANNEL_NAME_PATTERN.test(value)) {
				throw new Error(`Invalid channel param "${key}"`);
			}
			return value;
		},
	);
	const prefix =
		descriptor.visibility === "private"
			? "private-"
			: descriptor.visibility === "presence"
				? "presence-"
				: "";
	const resolved = `${prefix}${applicationName}`;
	if (
		resolved.length === 0 ||
		resolved.length > 164 ||
		!CHANNEL_NAME_PATTERN.test(resolved)
	) {
		throw new Error("Resolved channel name is not transport-safe");
	}
	return resolved;
}
