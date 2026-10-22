import superjson from "superjson";

import { stringifyTypedWire } from "#questpie/shared/typed-wire.js";

export const EPHEMERAL_MAX_PACKET_BYTES = 7900;

const encodedEntries = new WeakMap<object, { part: string; length: number }>();

/** Entries are independent typed values, so packing never re-serializes a growing batch. */
export function encodeEphemeralPackets<T extends object>(
	channel: string,
	entries: readonly T[],
): string[] {
	const prefix = `{"channel":${JSON.stringify(channel)},"entries":[`;
	const suffix = "]}";
	const overhead = Buffer.byteLength(prefix + suffix);
	const packets: string[] = [];
	let parts: string[] = [];
	let size = overhead;
	for (const entry of entries) {
		let encoded = encodedEntries.get(entry);
		if (!encoded) {
			const part = stringifyTypedWire(entry);
			encoded = { part, length: Buffer.byteLength(part) };
			encodedEntries.set(entry, encoded);
		}
		const { part, length } = encoded;
		if (overhead + length > EPHEMERAL_MAX_PACKET_BYTES)
			throw new Error("Ephemeral envelope exceeds limit");
		if (parts.length && size + 1 + length > EPHEMERAL_MAX_PACKET_BYTES) {
			packets.push(prefix + parts.join(",") + suffix);
			parts = [];
			size = overhead;
		}
		size += (parts.length ? 1 : 0) + length;
		parts.push(part);
	}
	if (parts.length) packets.push(prefix + parts.join(",") + suffix);
	return packets;
}

export function decodeEphemeralPacket<T>(message: string): {
	channel: string;
	entries: T[];
} {
	const packet = JSON.parse(message) as {
		channel: string;
		entries: ReturnType<typeof superjson.serialize>[];
	};
	return {
		channel: packet.channel,
		entries: packet.entries.map((entry) => superjson.deserialize<T>(entry)),
	};
}
