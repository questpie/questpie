import { expect, test } from "bun:test";

import {
	createQueryResourceScope,
	type QueryDelivery,
	type WatchFailure,
	type WatchOptions,
} from "./query-resource";

type Driver<Output> = Readonly<{
	deliver(output: Output, delivery?: QueryDelivery): void;
	fail(failure: WatchFailure): void;
	state(
		state: Readonly<
			{ kind: "connected" } | { kind: "reconnecting"; attempt: number }
		>,
	): void;
	inputs(): readonly unknown[];
	starts(): number;
	stops(): number;
	staleDeliver(output: Output): void;
	watch(
		input: unknown,
		callback: (output: Output, delivery: QueryDelivery) => void,
		options: WatchOptions,
	): () => void;
}>;

function driver<Output>(): Driver<Output> {
	let callback: ((output: Output, delivery: QueryDelivery) => void) | undefined;
	let options: WatchOptions = {};
	let startCount = 0;
	let stopCount = 0;
	const inputs: unknown[] = [];
	const callbacks: Array<(output: Output, delivery: QueryDelivery) => void> =
		[];
	return {
		deliver(output, delivery = { kind: "initial" }) {
			callback?.(output, delivery);
		},
		fail(failure) {
			options.onError?.(failure);
		},
		state(state) {
			options.onStateChange?.(state);
		},
		inputs: () => inputs,
		starts: () => startCount,
		stops: () => stopCount,
		staleDeliver(output) {
			callbacks[0]?.(output, { kind: "update" });
		},
		watch(input, next, nextOptions) {
			startCount += 1;
			inputs.push(structuredClone(input));
			callback = next;
			callbacks.push(next);
			options = nextOptions;
			let stopped = false;
			return () => {
				if (stopped) return;
				stopped = true;
				stopCount += 1;
			};
		},
	};
}

function method(
	scope: ReturnType<typeof createQueryResourceScope>,
	driver_: Driver<Readonly<{ value: string }>>,
) {
	return scope.watchable({
		identity: "query:messages.page",
		encode: (input: Readonly<{ first: number }>) => {
			if (!Number.isSafeInteger(input.first) || input.first < 1)
				throw new TypeError("invalid first");
			return JSON.stringify({ first: input.first });
		},
		call: async () => ({ value: "call" }),
		watch: driver_.watch,
	});
}

test("shares exact same-scope identity but isolates client Context scopes", () => {
	const firstDriver = driver<Readonly<{ value: string }>>();
	const first = method(createQueryResourceScope(), firstDriver);
	const second = method(createQueryResourceScope(), firstDriver);
	expect(first.observe({ first: 10 })).toBe(first.observe({ first: 10 }));
	expect(first.observe({ first: 10 })).not.toBe(first.observe({ first: 11 }));
	expect(first.observe({ first: 10 })).not.toBe(second.observe({ first: 10 }));
	expect(() => first.observe({ first: 0 })).toThrow("invalid first");
	expect(firstDriver.starts()).toBe(0);
});

test("watches only the canonical input snapshot captured by observe", () => {
	const controlled = driver<Readonly<{ value: string }>>();
	const query = method(createQueryResourceScope(), controlled);
	const input = { first: 10 };
	const resource = query.observe(input);
	input.first = 20;
	const stop = resource.subscribe(() => undefined);
	expect(controlled.inputs()).toEqual([{ first: 10 }]);
	stop();
});

test("starts lazily, shares one watch, and contains stale generations", () => {
	const controlled = driver<Readonly<{ value: string }>>();
	const query = method(createQueryResourceScope(), controlled);
	const resource = query.observe({ first: 10 });
	const seen: string[] = [];
	const firstStop = resource.subscribe(() =>
		seen.push(resource.getSnapshot().kind),
	);
	const secondStop = resource.subscribe(() => seen.push("second"));
	expect(controlled.starts()).toBe(1);
	expect(resource.getSnapshot()).toEqual({
		kind: "pending",
		connection: { kind: "connecting" },
	});
	controlled.deliver({ value: "first" });
	expect(resource.getSnapshot()).toEqual({
		kind: "ready",
		value: { value: "first" },
		delivery: { kind: "initial" },
		connection: { kind: "connected" },
	});
	firstStop();
	firstStop();
	expect(controlled.stops()).toBe(0);
	secondStop();
	expect(controlled.stops()).toBe(1);
	expect(resource.getSnapshot()).toMatchObject({
		kind: "ready",
		connection: { kind: "idle" },
	});
	controlled.staleDeliver({ value: "stale" });
	expect(resource.getSnapshot()).toMatchObject({ value: { value: "first" } });
	const thirdStop = resource.subscribe(() => undefined);
	expect(controlled.starts()).toBe(2);
	controlled.staleDeliver({ value: "older" });
	expect(resource.getSnapshot()).not.toMatchObject({
		value: { value: "older" },
	});
	thirdStop();
	expect(seen).toContain("ready");
});

test("tracks duplicate callback subscriptions independently on one watch", () => {
	const controlled = driver<Readonly<{ value: string }>>();
	const query = method(createQueryResourceScope(), controlled);
	const resource = query.observe({ first: 10 });
	const notify = () => undefined;
	const firstStop = resource.subscribe(notify);
	const secondStop = resource.subscribe(notify);
	expect(controlled.starts()).toBe(1);

	firstStop();
	expect(controlled.stops()).toBe(0);
	expect(resource.getSnapshot()).toMatchObject({
		connection: { kind: "connecting" },
	});

	secondStop();
	expect(controlled.stops()).toBe(1);
	expect(resource.getSnapshot()).toMatchObject({
		connection: { kind: "idle" },
	});
});

test("exposes stable callables for the exact useSyncExternalStore invocation", () => {
	const controlled = driver<Readonly<{ value: string }>>();
	const query = method(createQueryResourceScope(), controlled);
	const resource = query.observe({ first: 10 });
	const subscribe = resource.subscribe;
	const getSnapshot = resource.getSnapshot;
	const stop = subscribe(() => undefined);
	expect(getSnapshot()).toEqual({
		kind: "pending",
		connection: { kind: "connecting" },
	});
	expect(resource.subscribe).toBe(subscribe);
	expect(resource.getSnapshot).toBe(getSnapshot);
	stop();
});

test("retains complete data on reconnect and clears it on terminal failure", () => {
	const controlled = driver<Readonly<{ value: string }>>();
	const query = method(createQueryResourceScope(), controlled);
	const resource = query.observe({ first: 10 });
	const stop = resource.subscribe(() => undefined);
	controlled.deliver({ value: "authorized" });
	controlled.state({ kind: "reconnecting", attempt: 2 });
	expect(resource.getSnapshot()).toEqual({
		kind: "ready",
		value: { value: "authorized" },
		delivery: { kind: "initial" },
		connection: { kind: "reconnecting", attempt: 2 },
	});
	controlled.fail({ code: "AUTHORIZATION_FAILED" });
	expect(resource.getSnapshot()).toEqual({
		kind: "failed",
		failure: { code: "AUTHORIZATION_FAILED" },
	});
	expect(controlled.stops()).toBe(1);
	expect(query.observe({ first: 10 })).not.toBe(resource);
	stop();
});

test("keeps a failed resource terminal and recovers only through fresh observe", () => {
	const controlled = driver<Readonly<{ value: string }>>();
	const query = method(createQueryResourceScope(), controlled);
	const failedResource = query.observe({ first: 10 });
	const stop = failedResource.subscribe(() => undefined);
	controlled.fail({ code: "TRANSPORT_FAILED" });
	stop();

	const staleStop = failedResource.subscribe(() => undefined);
	expect(controlled.starts()).toBe(1);
	expect(failedResource.getSnapshot()).toEqual({
		kind: "failed",
		failure: { code: "TRANSPORT_FAILED" },
	});
	staleStop();

	const freshResource = query.observe({ first: 10 });
	expect(freshResource).not.toBe(failedResource);
	const freshStop = freshResource.subscribe(() => undefined);
	expect(controlled.starts()).toBe(2);
	freshStop();
});

test("bounds retained identities, evicts idle LRU, and refuses all-pinned excess", () => {
	const controlled = driver<Readonly<{ value: string }>>();
	const query = method(createQueryResourceScope({ capacity: 2 }), controlled);
	const first = query.observe({ first: 1 });
	const second = query.observe({ first: 2 });
	query.observe({ first: 1 });
	const third = query.observe({ first: 3 });
	expect(query.observe({ first: 1 })).toBe(first);
	expect(query.observe({ first: 3 })).toBe(third);
	expect(query.observe({ first: 2 })).not.toBe(second);

	const pinnedScope = createQueryResourceScope({ capacity: 1 });
	const pinnedQuery = method(pinnedScope, controlled);
	const stop = pinnedQuery.observe({ first: 1 }).subscribe(() => undefined);
	expect(pinnedQuery.observe({ first: 2 }).getSnapshot()).toEqual({
		kind: "failed",
		failure: { code: "RESOURCE_LIMIT" },
	});
	stop();
});

test("isolates a subscriber fault and continues notifying peers", () => {
	const failures: unknown[] = [];
	const controlled = driver<Readonly<{ value: string }>>();
	const query = method(
		createQueryResourceScope({
			reportSubscriberError: (error) => failures.push(error),
		}),
		controlled,
	);
	const resource = query.observe({ first: 1 });
	let peerNotifications = 0;
	const firstStop = resource.subscribe(() => {
		if (resource.getSnapshot().kind === "ready")
			throw new Error("component failed");
	});
	const secondStop = resource.subscribe(() => {
		peerNotifications += 1;
	});
	controlled.deliver({ value: "complete" });
	expect(failures).toHaveLength(1);
	expect(peerNotifications).toBe(1);
	expect(resource.getSnapshot().kind).toBe("ready");
	firstStop();
	secondStop();
});
