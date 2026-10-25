import { describe, expect, it } from "bun:test";

import {
	RealtimeRefreshScheduler,
	type RefreshSubscriptionInput,
} from "../../src/server/modules/core/integrated/realtime/refresh-scheduler.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const source = () => ({
	getLatestSeq: async () => 4,
	subscribe: () => () => {},
});

type Kind = "query" | "snapshot" | "delta";
type Rows = { docs: Array<{ id: string }> };
const rows = (): Rows => ({ docs: [{ id: "one" }] });

function input(
	kind: Kind,
	key: string,
	compute: () => Promise<Rows>,
	onFrame: () => void,
	onError: (error: unknown) => void,
): RefreshSubscriptionInput {
	const common = { key, topicId: key, onFrame, onError };
	const topic = { resourceType: "collection" as const, resource: "posts" };
	if (kind === "query") {
		return {
			...common,
			kind: "coherent",
			dependencies: [{ topic, authority: false }],
			compute: async () => ({ data: await compute(), upToDate: "1" }),
			onInvalidate: () => {},
		};
	}
	return {
		...common,
		topics: topic,
		compute,
		...(kind === "delta"
			? { mode: "delta" as const, hydrateRows: async () => rows() }
			: {}),
	};
}

describe("realtime compute queue cancellation", () => {
	it.each(["query", "snapshot", "delta"] as const)(
		"does not start a queued %s computation after its last subscriber closes",
		async (kind) => {
			const queued = deferred<void>();
			let routed = 0;
			const scheduler = new RealtimeRefreshScheduler(source(), 1, {
				record: (event) => {
					if (event.type === "routing.authoritative_db" && ++routed === 2)
						queued.resolve();
				},
			});
			const started = deferred<void>();
			const release = deferred<void>();
			const delivered = deferred<void>();
			const errors: unknown[] = [];
			let canceledCalls = 0;
			let canceledFrames = 0;
			const close = [
				scheduler.subscribe(
					input(
						"query",
						"blocker",
						async () => {
							started.resolve();
							await release.promise;
							return rows();
						},
						() => {},
						(error) => errors.push(error),
					),
				),
			];
			try {
				await started.promise;
				const closeCanceled = scheduler.subscribe(
					input(
						kind,
						"canceled",
						async () => {
							canceledCalls++;
							return rows();
						},
						() => canceledFrames++,
						(error) => errors.push(error),
					),
				);
				close.push(closeCanceled);
				await queued.promise;
				closeCanceled();
				close.push(
					scheduler.subscribe(
						input(
							"query",
							"survivor",
							async () => rows(),
							() => delivered.resolve(),
							(error) => errors.push(error),
						),
					),
				);
				release.resolve();
				await delivered.promise;
				expect(canceledCalls).toBe(0);
				expect(canceledFrames).toBe(0);
				expect(errors).toEqual([]);
			} finally {
				for (const stop of close) stop();
				release.resolve();
			}
		},
	);

	it("frees a full waiting queue immediately when its subscribers close", async () => {
		const scheduler = new RealtimeRefreshScheduler(source(), 1);
		const started = deferred<void>();
		const release = deferred<void>();
		const overflow = deferred<unknown>();
		const outcome = deferred<"frame" | "error">();
		const errors: unknown[] = [];
		let canceledCalls = 0;
		const closeBlocker = scheduler.subscribe(
			input(
				"query",
				"blocker",
				async () => {
					started.resolve();
					await release.promise;
					return rows();
				},
				() => {},
				(error) => errors.push(error),
			),
		);
		const close: Array<() => void> = [closeBlocker];
		try {
			await started.promise;
			for (let index = 0; index < 1024; index++) {
				close.push(
					scheduler.subscribe(
						input(
							"query",
							`canceled-${index}`,
							async () => {
								canceledCalls++;
								return rows();
							},
							() => {},
							(error) => errors.push(error),
						),
					),
				);
			}
			const closeOverflow = scheduler.subscribe(
				input(
					"query",
					"overflow",
					async () => rows(),
					() => {},
					overflow.resolve,
				),
			);
			close.push(closeOverflow);
			expect(await overflow.promise).toEqual(
				new Error("Realtime compute queue is full"),
			);
			for (const stop of close.slice(1)) stop();
			close.push(
				scheduler.subscribe(
					input(
						"query",
						"survivor",
						async () => rows(),
						() => outcome.resolve("frame"),
						() => outcome.resolve("error"),
					),
				),
			);
			release.resolve();
			expect(await outcome.promise).toBe("frame");
			expect(canceledCalls).toBe(0);
			expect(errors).toEqual([]);
		} finally {
			for (const stop of close) stop();
			release.resolve();
		}
	});

	it("keeps queued shared work while another subscriber is still listening", async () => {
		const queued = deferred<void>();
		let routed = 0;
		const scheduler = new RealtimeRefreshScheduler(source(), 1, {
			record: (event) => {
				if (event.type === "routing.authoritative_db" && ++routed === 2)
					queued.resolve();
			},
		});
		const started = deferred<void>();
		const release = deferred<void>();
		const delivered = deferred<void>();
		const errors: unknown[] = [];
		let creatorCalls = 0;
		let survivorCalls = 0;
		const close = [
			scheduler.subscribe(
				input(
					"query",
					"blocker",
					async () => {
						started.resolve();
						await release.promise;
						return rows();
					},
					() => {},
					(error) => errors.push(error),
				),
			),
		];
		try {
			await started.promise;
			const closeCreator = scheduler.subscribe(
				input(
					"snapshot",
					"shared",
					async () => {
						creatorCalls++;
						return rows();
					},
					() => {},
					(error) => errors.push(error),
				),
			);
			close.push(closeCreator);
			await queued.promise;
			close.push(
				scheduler.subscribe(
					input(
						"snapshot",
						"shared",
						async () => {
							survivorCalls++;
							return rows();
						},
						() => delivered.resolve(),
						(error) => errors.push(error),
					),
				),
			);
			closeCreator();
			release.resolve();
			await delivered.promise;
			expect(creatorCalls).toBe(0);
			expect(survivorCalls).toBe(1);
			expect(errors).toEqual([]);
		} finally {
			for (const stop of close) stop();
			release.resolve();
		}
	});
});
