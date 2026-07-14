import { describe, expect, it } from "bun:test";

import { sseHeaders } from "../../src/server/adapters/utils/response.js";
import type { RealtimeAdapter } from "../../src/server/modules/core/integrated/realtime/adapter.js";
import { RealtimeService } from "../../src/server/modules/core/integrated/realtime/service.js";
import type {
	ChangeBroker,
	ChangeWake,
	ClientSink,
	ClientTransportConfig,
	EdgeSessionInput,
	LocalSessionClientTransport,
} from "../../src/server/modules/core/integrated/realtime/transport.js";
import type {
	RealtimeChangeEvent,
	RealtimeDualRunComparison,
	RealtimeNotice,
} from "../../src/server/modules/core/integrated/realtime/types.js";

const change: RealtimeChangeEvent = {
	seq: 7,
	resourceType: "collection",
	resource: "posts",
	operation: "update",
	recordId: "post-1",
	locale: null,
	payload: {},
	createdAt: new Date("2026-07-14T00:00:00.000Z"),
};

class EmptyRealtimeDb {
	select() {
		const query = {
			from: () => query,
			where: () => query,
			orderBy: () => query,
			limit: async () => [],
		};
		return query;
	}
}

class RecordingAdapter implements RealtimeAdapter {
	publisherStarts = 0;
	starts = 0;
	stops = 0;
	notifications: RealtimeChangeEvent[] = [];
	failNotify = false;

	async startPublisher(): Promise<void> {
		this.publisherStarts += 1;
	}

	async start(): Promise<void> {
		this.starts += 1;
	}

	async stop(): Promise<void> {
		this.stops += 1;
	}

	async notify(event: RealtimeChangeEvent): Promise<void> {
		this.notifications.push(event);
		if (this.failNotify) throw new Error("legacy unavailable");
	}

	subscribe(_handler: (notice: RealtimeNotice) => void): () => void {
		return () => {};
	}
}

class RecordingBroker implements ChangeBroker {
	starts = 0;
	stops = 0;
	wakes: ChangeWake[] = [];
	failPublish = false;

	async start(): Promise<void> {
		this.starts += 1;
	}

	async publish(wake: ChangeWake): Promise<void> {
		this.wakes.push(wake);
		if (this.failPublish) throw new Error("v2 unavailable");
	}

	async stop(): Promise<void> {
		this.stops += 1;
	}
}

class RecordingClientTransport implements LocalSessionClientTransport {
	readonly channelDeliveryScope = "local-sessions" as const;
	starts = 0;
	stops = 0;

	async start(): Promise<void> {
		this.starts += 1;
	}

	async openSession(_input: EdgeSessionInput): Promise<ClientSink> {
		throw new Error("not used by rollout tests");
	}

	async getClientConfig(): Promise<ClientTransportConfig> {
		return { transport: "sse" };
	}

	async stop(): Promise<void> {
		this.stops += 1;
	}
}

function createService(
	config: ConstructorParameters<typeof RealtimeService>[1],
) {
	return new RealtimeService(new EmptyRealtimeDb() as never, {
		pollIntervalMs: 0,
		retentionDays: 0,
		...config,
	});
}

describe("realtime compatibility rollout", () => {
	it("keeps adapter-only config working as the v2 compatibility fallback", async () => {
		const adapter = new RecordingAdapter();
		const realtime = createService({ adapter });
		try {
			await realtime.notify(change);
			expect(adapter.publisherStarts).toBe(1);
			expect(adapter.notifications).toEqual([change]);
			expect(await realtime.getClientTransportConfig({})).toEqual({
				transport: "sse",
			});
		} finally {
			await realtime.destroy();
		}
	});

	it("legacy rollback starts only the adapter and preserves SSE protocol v1", async () => {
		const adapter = new RecordingAdapter();
		const broker = new RecordingBroker();
		const clientTransport = new RecordingClientTransport();
		const realtime = createService({
			adapter,
			changeBroker: broker,
			clientTransport,
			rollout: { mode: "legacy" },
		});
		try {
			await realtime.notify(change);
			expect(adapter.notifications).toEqual([change]);
			expect(broker.starts).toBe(0);
			expect(broker.wakes).toEqual([]);
			expect(clientTransport.starts).toBe(0);
			expect(await realtime.getClientTransportConfig({})).toEqual({
				transport: "sse",
			});
			expect(sseHeaders["X-Questpie-Realtime-Protocol"]).toBe("1");
		} finally {
			await realtime.destroy();
		}
	});

	it("v2 mode selects the new seams when legacy and v2 transports coexist", async () => {
		const adapter = new RecordingAdapter();
		const broker = new RecordingBroker();
		const clientTransport = new RecordingClientTransport();
		const realtime = createService({
			adapter,
			changeBroker: broker,
			clientTransport,
			rollout: { mode: "v2" },
		});
		try {
			await realtime.notify(change);
			expect(adapter.publisherStarts).toBe(0);
			expect(adapter.notifications).toEqual([]);
			expect(broker.wakes).toEqual([
				{
					kind: "outbox-maybe-advanced",
					highWaterSeq: 7,
					reason: "publish",
				},
			]);
			expect(clientTransport.starts).toBe(1);
		} finally {
			await realtime.destroy();
		}
	});

	it("dual mode compares both publish paths without failing over a one-sided canary error", async () => {
		const adapter = new RecordingAdapter();
		adapter.failNotify = true;
		const broker = new RecordingBroker();
		const comparisons: RealtimeDualRunComparison[] = [];
		const realtime = createService({
			adapter,
			changeBroker: broker,
			rollout: {
				mode: "dual",
				onComparison: (comparison) => comparisons.push(comparison),
			},
		});
		try {
			await expect(realtime.notify(change)).resolves.toBeUndefined();
			expect(adapter.notifications).toEqual([change]);
			expect(broker.wakes).toHaveLength(1);
			expect(comparisons).toHaveLength(1);
			expect(comparisons[0]).toMatchObject({
				seq: 7,
				legacy: "rejected",
				v2: "accepted",
				equivalent: false,
			});
		} finally {
			await realtime.destroy();
		}
	});

	it("rejects dual mode unless both comparable paths are explicit", () => {
		expect(() =>
			createService({
				adapter: new RecordingAdapter(),
				rollout: { mode: "dual" },
			}),
		).toThrow(/dual.*adapter.*changeBroker/i);
	});
});
