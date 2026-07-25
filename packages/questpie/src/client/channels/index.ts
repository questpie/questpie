import type { ChannelDefinitions } from "#questpie/server/channels/channel-builder.js";

import type { GetAuthHeaders } from "../auth.js";
import {
	type PusherConnectionManager,
	type PusherRealtimeConfig,
} from "../realtime/pusher-connection.js";
import type { SseConnectionManager } from "../realtime/sse-connection.js";
import {
	BoundedChannelQueue,
	channelSlowConsumerError,
} from "./ordered-events.js";
import { PusherChannelTransport } from "./pusher.js";
import { SseChannelTransport } from "./sse.js";
import {
	resolveChannelClientName,
	type ChannelClientDescriptor,
	type ChannelClientTransport,
	type ChannelClientTransportConfig,
	type ChannelConnectionInput,
	type ChannelPublishReceipt,
	type ChannelsClient,
	type ChannelSubscribeOptions,
	type ChannelTransportMessage,
} from "./types.js";

export type {
	ChannelClient,
	ChannelClientDescriptor,
	ChannelMessage,
	ChannelPublishInput,
	ChannelPublishReceipt,
	ChannelsClient,
	ChannelSubscribeOptions,
} from "./types.js";

function normalizedError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

async function* channelIterator<TMessage>(
	subscribe: (
		callback: (message: TMessage) => void,
		onError: (error: Error) => void,
	) => Promise<() => void>,
	signal?: AbortSignal,
): AsyncGenerator<TMessage, void, unknown> {
	if (signal?.aborted) return;
	const queue = new BoundedChannelQueue<TMessage>();
	let resolveNext: (() => void) | undefined;
	let terminalError: Error | undefined;
	let stop: (() => void) | undefined;
	let closed = false;
	const fail = (error: Error) => {
		if (terminalError || closed) return;
		terminalError = error;
		queue.clear();
		stop?.();
		resolveNext?.();
	};
	stop = await subscribe((message) => {
		if (!queue.push(message)) {
			fail(channelSlowConsumerError());
			return;
		}
		resolveNext?.();
	}, fail);
	const abort = () => {
		closed = true;
		stop?.();
		resolveNext?.();
	};
	signal?.addEventListener("abort", abort, { once: true });
	try {
		while (true) {
			if (terminalError) throw terminalError;
			if (closed || signal?.aborted) break;
			while (queue.length) {
				yield queue.shift()!;
				if (terminalError) throw terminalError;
			}
			if (closed || signal?.aborted) break;
			await new Promise<void>((resolve) => {
				resolveNext = resolve;
			});
			resolveNext = undefined;
		}
	} finally {
		signal?.removeEventListener("abort", abort);
		stop?.();
	}
}

/** Build the typed framework-channel surface attached to the main client. */
export function createChannelsAPI<
	TChannels extends ChannelDefinitions,
>(options: {
	baseUrl: string;
	withCredentials: boolean;
	fetcher: typeof fetch;
	getAuthHeaders?: GetAuthHeaders;
	pusherConnection?: PusherConnectionManager;
	sseConnection?: SseConnectionManager;
}): ChannelsClient<TChannels> {
	let transport: ChannelClientTransport | null = null;
	let config: ChannelClientTransportConfig | null = null;
	let transportPromise: Promise<ChannelClientTransport> | null = null;
	let generation = 0;
	const handles = new Map<string, object>();
	const pending = new Set<object>();

	const getTransport = async (): Promise<ChannelClientTransport> => {
		if (transport) return transport;
		if (!transportPromise) {
			const selectedGeneration = generation;
			transportPromise = (async () => {
				const authHeaders = await options.getAuthHeaders?.();
				const response = await options.fetcher(
					`${options.baseUrl}/channels/config`,
					{
						headers: authHeaders,
						credentials: options.withCredentials ? "include" : "omit",
					},
				);
				if (!response.ok) {
					throw new Error(`Channel config failed: ${response.status}`);
				}
				const selected =
					(await response.json()) as ChannelClientTransportConfig;
				if (!selected.channels || typeof selected.channels !== "object") {
					throw new Error("Invalid channel client config");
				}
				config = selected;
				if (
					selected.transport === "shared-provider" &&
					selected.config.provider === "pusher" &&
					typeof selected.config.key === "string"
				) {
					return new PusherChannelTransport({
						baseUrl: options.baseUrl,
						fetcher: options.fetcher,
						getAuthHeaders: options.getAuthHeaders,
						config: selected.config as PusherRealtimeConfig,
						connection: options.pusherConnection,
					});
				}
				if (selected.transport !== "sse") {
					throw new Error("Unsupported channel client transport");
				}
				return new SseChannelTransport({
					...options,
					connection: options.sseConnection,
				});
			})()
				.then((selected) => {
					if (selectedGeneration !== generation) selected.destroy();
					else transport = selected;
					return selected;
				})
				.catch((error) => {
					if (selectedGeneration === generation) {
						transportPromise = null;
						config = null;
					}
					throw error;
				});
		}
		return transportPromise;
	};

	const connectionInput = (
		registryKey: string,
		descriptor: ChannelClientDescriptor,
		params: Record<string, string>,
	): ChannelConnectionInput => ({
		registryKey,
		params,
		resolvedName: resolveChannelClientName(descriptor, params),
		visibility: descriptor.visibility,
	});

	const descriptorFor = (registryKey: string): ChannelClientDescriptor => {
		const descriptor = config?.channels[registryKey];
		if (!descriptor) throw new Error(`Unknown channel "${registryKey}"`);
		return descriptor;
	};

	const getHandle = (registryKey: string) => {
		let handle = handles.get(registryKey);
		if (handle) return handle;
		handle = {
			subscribe: (...args: unknown[]) => {
				const hasParams = typeof args[0] !== "function";
				const params = (hasParams ? args[0] : {}) as Record<string, string>;
				const callback = (hasParams ? args[1] : args[0]) as (
					message: ChannelTransportMessage,
				) => void;
				const subscribeOptions = (hasParams ? args[2] : args[1]) as
					| ChannelSubscribeOptions
					| undefined;
				const marker = {};
				const subscriptionGeneration = generation;
				pending.add(marker);
				let stopped = false;
				let stopInner: (() => void) | undefined;
				void getTransport()
					.then((selected) => {
						pending.delete(marker);
						if (stopped || subscriptionGeneration !== generation) return;
						const descriptor = descriptorFor(registryKey);
						stopInner = selected.subscribe(
							connectionInput(registryKey, descriptor, params),
							callback,
							subscribeOptions,
						);
					})
					.catch((error) => {
						pending.delete(marker);
						subscribeOptions?.onError?.(normalizedError(error));
					});
				return () => {
					stopped = true;
					pending.delete(marker);
					stopInner?.();
				};
			},
			publish: async (input: Record<string, unknown>) => {
				await getTransport();
				descriptorFor(registryKey);
				const authHeaders = await options.getAuthHeaders?.();
				const response = await options.fetcher(
					`${options.baseUrl}/channels/publish`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json", ...authHeaders },
						body: JSON.stringify({
							channel: registryKey,
							params: input.params ?? {},
							event: input.event,
							data: input.data,
						}),
						credentials: options.withCredentials ? "include" : "omit",
					},
				);
				if (!response.ok) {
					throw new Error(`Channel publish failed: ${response.status}`);
				}
				const receipt =
					(await response.json()) as Partial<ChannelPublishReceipt>;
				if (typeof receipt.eventId !== "string") {
					throw new Error("Invalid channel publish receipt");
				}
				return { eventId: receipt.eventId };
			},
			iter: (...args: unknown[]) => {
				const last = args.at(-1) as ChannelSubscribeOptions | undefined;
				const signal =
					last?.signal && typeof last.signal.addEventListener === "function"
						? last.signal
						: undefined;
				return channelIterator<ChannelTransportMessage>(
					async (callback, onError) => {
						await getTransport();
						const hasParams = descriptorFor(registryKey).pattern.includes("[");
						const params = (hasParams ? args[0] : {}) as Record<string, string>;
						const iterOptions = (hasParams ? args[1] : args[0]) as
							| ChannelSubscribeOptions
							| undefined;
						return (
							handle as { subscribe: (...args: unknown[]) => () => void }
						).subscribe(...(hasParams ? [params] : []), callback, {
							...iterOptions,
							onError,
						});
					},
					signal,
				);
			},
			presence: async (...args: unknown[]) => {
				const selected = await getTransport();
				const descriptor = descriptorFor(registryKey);
				const hasParams = descriptor.pattern.includes("[");
				const params = (hasParams ? args[0] : {}) as Record<string, string>;
				const presenceOptions = (hasParams ? args[1] : args[0]) as
					| ChannelSubscribeOptions
					| undefined;
				return selected.presence(
					connectionInput(registryKey, descriptor, params),
					presenceOptions,
				);
			},
			subscribePresence: (...args: unknown[]) => {
				const hasParams = typeof args[0] !== "function";
				const params = (hasParams ? args[0] : {}) as Record<string, string>;
				const callback = (hasParams ? args[1] : args[0]) as (
					members: readonly unknown[],
				) => void;
				const subscribeOptions = (hasParams ? args[2] : args[1]) as
					| ChannelSubscribeOptions
					| undefined;
				const marker = {};
				const subscriptionGeneration = generation;
				pending.add(marker);
				let stopped = false;
				let stopInner: (() => void) | undefined;
				void getTransport()
					.then((selected) => {
						pending.delete(marker);
						if (stopped || subscriptionGeneration !== generation) return;
						const descriptor = descriptorFor(registryKey);
						stopInner = selected.subscribePresence(
							connectionInput(registryKey, descriptor, params),
							callback,
							subscribeOptions,
						);
					})
					.catch((error) => {
						pending.delete(marker);
						subscribeOptions?.onError?.(normalizedError(error));
					});
				return () => {
					stopped = true;
					pending.delete(marker);
					stopInner?.();
				};
			},
			presenceIter: (...args: unknown[]) => {
				const last = args.at(-1) as ChannelSubscribeOptions | undefined;
				const signal =
					last?.signal && typeof last.signal.addEventListener === "function"
						? last.signal
						: undefined;
				return channelIterator<readonly unknown[]>(
					async (callback, onError) => {
						await getTransport();
						const hasParams = descriptorFor(registryKey).pattern.includes("[");
						const params = (hasParams ? args[0] : {}) as Record<string, string>;
						const iterOptions = (hasParams ? args[1] : args[0]) as
							| ChannelSubscribeOptions
							| undefined;
						return (
							handle as {
								subscribePresence: (...args: unknown[]) => () => void;
							}
						).subscribePresence(...(hasParams ? [params] : []), callback, {
							...iterOptions,
							onError,
						});
					},
					signal,
				);
			},
		};
		handles.set(registryKey, handle);
		return handle;
	};

	const control = {
		destroy() {
			generation += 1;
			pending.clear();
			transport?.destroy();
			transport = null;
			transportPromise = null;
			config = null;
		},
		get channelCount() {
			return transport?.channelCount ?? pending.size;
		},
		get subscriberCount() {
			return transport?.subscriberCount ?? pending.size;
		},
	};

	return new Proxy(control, {
		get(target, property, receiver) {
			if (property in target) return Reflect.get(target, property, receiver);
			if (typeof property !== "string") return undefined;
			return getHandle(property);
		},
	}) as ChannelsClient<TChannels>;
}
