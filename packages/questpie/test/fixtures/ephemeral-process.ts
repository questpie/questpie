import { pgNotifyEphemeralBroker } from "../../src/exports/adapters/pg-notify.js";
// Separate OS process used by the PostgreSQL contract and benchmark.
import { EphemeralChannels } from "../../src/server/channels/ephemeral.js";
import { parseCompatibleTypedEventWire } from "../../src/shared/typed-wire.js";

const runtime = new EphemeralChannels(
	{
		broker: pgNotifyEphemeralBroker({
			connectionString: process.env.QUESTPIE_EPHEMERAL_DATABASE_URL!,
			channel: process.env.EPHEMERAL_TEST_CHANNEL!,
		}),
		authorizationIntervalMs: 50,
		heartbeatMs: 100,
		leaseMs: 400,
	},
	(error) => process.send?.({ error: String(error) }),
);
let allowed = true;
const releases = new Map<string, () => Promise<void>>();
process.on("message", async (message: any) => {
	try {
		if (message.operation === "subscribe") {
			const sink = {
				sessionId: message.id,
				async write(frame: Uint8Array) {
					const lines = new TextDecoder().decode(frame).split("\n");
					process.send?.({
						frame: {
							type: lines[0]!.slice(7),
							data: parseCompatibleTypedEventWire(lines[1]!.slice(6)),
						},
						subscription: message.id,
					});
					return { status: "accepted" as const, bufferedBytes: 0 };
				},
				async close(reason: string) {
					process.send?.({ closed: message.id, reason });
				},
			};
			releases.set(
				message.id,
				await runtime.subscribe({
					subscriptionId: message.id,
					channel: message.channel,
					sink,
					reauthorize: async () => allowed,
					...(message.presence
						? {
								presence: {
									channel: message.channel,
									connectionId: message.id,
									principalId: message.id,
									data: { id: message.id },
									sink,
								},
							}
						: {}),
				}),
			);
		} else if (message.operation === "publish") {
			await runtime.publish(
				{ channel: message.channel, event: "cursor", data: message.data },
				{ coalesceMs: 100 },
				message.publisher ?? "a",
			);
		} else if (message.operation === "allow") allowed = message.allowed;
		else if (message.operation === "leave") {
			await releases.get(message.id)?.();
			releases.delete(message.id);
		} else if (message.operation === "stop") {
			await runtime.destroy();
			process.send?.({ request: message.request });
			process.exit(0);
		}
		process.send?.({ request: message.request });
	} catch (error) {
		process.send?.({ request: message.request, error: String(error) });
	}
});
process.send?.({ ready: true, pid: process.pid });
