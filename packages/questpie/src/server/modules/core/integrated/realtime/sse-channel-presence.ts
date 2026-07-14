import { encodeSseEvent } from "./sse-client-transport.js";
import type { ClientSink } from "./transport.js";

type PresenceMember = {
	subscriptionId: string;
	sink: ClientSink;
	data: Record<string, unknown>;
};

/** App-instance-local coarse presence for the zero-infrastructure SSE tier. */
export class SseChannelPresenceRegistry {
	private readonly channels = new Map<string, Map<string, PresenceMember>>();

	async register(input: {
		channel: string;
		subscriptionId: string;
		sink: ClientSink;
		data: Record<string, unknown>;
	}): Promise<() => void> {
		const members = this.channels.get(input.channel) ?? new Map();
		members.set(input.subscriptionId, input);
		this.channels.set(input.channel, members);
		await this.broadcast(input.channel);
		let removed = false;
		return () => {
			if (removed) return;
			removed = true;
			const current = this.channels.get(input.channel);
			current?.delete(input.subscriptionId);
			if (current?.size === 0) this.channels.delete(input.channel);
			void this.broadcast(input.channel);
		};
	}

	private async broadcast(channel: string): Promise<void> {
		const members = [...(this.channels.get(channel)?.values() ?? [])];
		const frame = encodeSseEvent("channel_presence", {
			type: "channel_presence",
			channel,
			members: members.map((member) => member.data),
		});
		await Promise.all(
			members.map(async (member) => {
				try {
					await member.sink.write(frame, "latest-snapshot");
				} catch {
					this.channels.get(channel)?.delete(member.subscriptionId);
				}
			}),
		);
	}
}

const registries = new WeakMap<object, SseChannelPresenceRegistry>();

export function getSseChannelPresenceRegistry(
	owner: object,
): SseChannelPresenceRegistry {
	let registry = registries.get(owner);
	if (!registry) {
		registry = new SseChannelPresenceRegistry();
		registries.set(owner, registry);
	}
	return registry;
}
