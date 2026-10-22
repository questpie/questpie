import { encodeEphemeralPackets } from "../src/server/channels/ephemeral-wire.ts";
import { stringifyTypedWire } from "../src/shared/typed-wire.ts";
function old(channel: string, ready: object[]) {
	let entries: object[] = [];
	const packets: string[] = [];
	for (const entry of ready) {
		const candidate = [...entries, entry];
		if (
			entries.length &&
			Buffer.byteLength(stringifyTypedWire({ channel, entries: candidate })) >
				7900
		) {
			packets.push(stringifyTypedWire({ channel, entries }));
			entries = [];
		}
		entries.push(entry);
	}
	if (entries.length) packets.push(stringifyTypedWire({ channel, entries }));
	return packets;
}
function fixture() {
	return Array.from({ length: 100 }, (_, topic) => ({
		channel: `page-${topic}`,
		entries: Array.from({ length: 100 }, (_, i) => ({
			kind: "event",
			key: String(i),
			event: "cursor",
			eventId: crypto.randomUUID(),
			data: { x: i, text: "x".repeat(60) },
		})),
	}));
}
const results = [];
for (let round = 0; round < 5; round++) {
	const topics = fixture();
	const sample: Record<
		string,
		number | { ms: number; bytes: number; packets: number }
	> = { round };
	for (const [name, encode] of [
		["old", old],
		["linearCold", encodeEphemeralPackets],
		["linearCached", encodeEphemeralPackets],
	] as const) {
		const start = performance.now();
		let bytes = 0,
			packets = 0;
		for (const topic of topics) {
			const encoded = encode(topic.channel, topic.entries);
			packets += encoded.length;
			bytes += encoded.reduce(
				(sum, packet) => sum + Buffer.byteLength(packet),
				0,
			);
		}
		sample[name] = { ms: performance.now() - start, bytes, packets };
	}
	results.push(sample);
}
console.log(
	JSON.stringify(
		{
			date: new Date().toISOString(),
			bun: Bun.version,
			topics: 100,
			keysPerTopic: 100,
			payloadTextBytes: 60,
			method:
				"Same event metadata and entries; old candidate reserialization vs independent typed-entry packing. Cold includes encoding, cached models entries validated at publish.",
			results,
		},
		null,
		2,
	),
);
