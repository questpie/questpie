export function renderClientQueryResource(enabled: boolean): Readonly<{
	types: string;
	runtime: string;
	scope: string;
}> {
	if (!enabled) return Object.freeze({ types: "", runtime: "", scope: "" });
	return Object.freeze({
		types: `
export type QueryResourceConnection =
	| Readonly<{ readonly kind: "idle" }>
	| Readonly<{ readonly kind: "connecting" }>
	| Readonly<{ readonly kind: "connected" }>
	| Readonly<{ readonly kind: "reconnecting"; readonly attempt: number }>;

export type QueryResourceSnapshot<Output> =
	| Readonly<{ readonly kind: "pending"; readonly connection: QueryResourceConnection }>
	| Readonly<{ readonly kind: "ready"; readonly value: Output; readonly delivery: QueryDelivery; readonly connection: QueryResourceConnection }>
	| Readonly<{ readonly kind: "failed"; readonly failure: WatchFailure }>;

export interface QueryResource<Output> {
	getSnapshot(): QueryResourceSnapshot<Output>;
	subscribe(notify: () => void): () => void;
}
`,
		runtime: `
const queryResourceIdle = Object.freeze({ kind: "idle" as const });
const queryResourceConnecting = Object.freeze({ kind: "connecting" as const });
const queryResourceConnected = Object.freeze({ kind: "connected" as const });
const pendingQueryResource = (connection: QueryResourceConnection): QueryResourceSnapshot<never> => Object.freeze({ kind: "pending", connection });
const failedQueryResource = (failure: WatchFailure): QueryResourceSnapshot<never> => Object.freeze({ kind: "failed", failure: Object.freeze(failure) });
type QueryResourceEntry = Readonly<{ readonly resource: GeneratedQueryResource<unknown> }>;
type QueryResourceWatchStarter = (query: string, input: unknown, callback: (output: unknown, delivery: QueryDelivery) => void, options: WatchOptions) => () => void;
class GeneratedQueryResource<Output> implements QueryResource<Output> {
	readonly #input: unknown;
	readonly #listeners = new Map<symbol, () => void>();
	readonly #remove: () => void;
	readonly #startWatch: (input: unknown, callback: (output: Output, delivery: QueryDelivery) => void, options: WatchOptions) => () => void;
	readonly #touch: () => void;
	#generation = 0;
	#snapshot: QueryResourceSnapshot<Output> = pendingQueryResource(queryResourceIdle);
	#stop: (() => void) | undefined;
	constructor(input: Readonly<{
		canonicalInput: unknown;
		remove(): void;
		startWatch(input: unknown, callback: (output: Output, delivery: QueryDelivery) => void, options: WatchOptions): () => void;
		touch(): void;
	}>) {
		this.#input = structuredClone(input.canonicalInput);
		this.#remove = input.remove;
		this.#startWatch = input.startWatch;
		this.#touch = input.touch;
		Object.freeze(this);
	}
	get subscribed(): boolean { return this.#listeners.size > 0; }
	readonly getSnapshot = (): QueryResourceSnapshot<Output> => this.#snapshot;
	readonly subscribe = (notify: () => void): (() => void) => {
		if (this.#snapshot.kind === "failed") return () => undefined;
		this.#touch();
		const token = Symbol();
		this.#listeners.set(token, notify);
		if (this.#listeners.size === 1) this.#open();
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.#listeners.delete(token);
			if (this.#listeners.size === 0) this.#idle();
		};
	};
	evict(): boolean {
		if (this.subscribed) return false;
		this.#generation += 1;
		const stop = this.#stop;
		this.#stop = undefined;
		stop?.();
		this.#remove();
		this.#publish(failedQueryResource({ code: "RESOURCE_LIMIT" }));
		return true;
	}
	#publish(snapshot: QueryResourceSnapshot<Output>): void {
		if (Object.is(this.#snapshot, snapshot)) return;
		this.#snapshot = snapshot;
		for (const listener of Array.from(this.#listeners.values())) {
			try { listener(); }
			catch (error) { globalThis.reportError(error); }
		}
	}
	#open(): void {
		const generation = ++this.#generation;
		const prior = this.#snapshot;
		this.#publish(prior.kind === "ready" ? Object.freeze({ ...prior, connection: queryResourceConnecting }) : pendingQueryResource(queryResourceConnecting));
		let stopAfterStart = false;
		const stop = this.#startWatch(this.#input, (output, delivery) => {
			if (generation !== this.#generation || this.#listeners.size === 0) return;
			this.#publish(Object.freeze({ kind: "ready", value: output, delivery: Object.freeze(delivery), connection: queryResourceConnected }));
		}, {
			onStateChange: (state) => {
				if (generation !== this.#generation) return;
				const connection = state.kind === "connected" ? queryResourceConnected : Object.freeze({ kind: "reconnecting" as const, attempt: state.attempt });
				const current = this.#snapshot;
				this.#publish(current.kind === "ready" ? Object.freeze({ ...current, connection }) : pendingQueryResource(connection));
			},
			onError: (failure) => {
				if (generation !== this.#generation) return;
				this.#generation += 1;
				this.#remove();
				this.#publish(failedQueryResource(failure));
				if (this.#stop === undefined) stopAfterStart = true;
				else {
					const activeStop = this.#stop;
					this.#stop = undefined;
					activeStop();
				}
			},
		});
		if (stopAfterStart) stop();
		else this.#stop = stop;
	}
	#idle(): void {
		this.#generation += 1;
		const stop = this.#stop;
		this.#stop = undefined;
		stop?.();
		const current = this.#snapshot;
		if (current.kind === "ready") this.#snapshot = Object.freeze({ ...current, connection: queryResourceIdle });
		else if (current.kind === "pending") this.#snapshot = pendingQueryResource(queryResourceIdle);
	}
}
function terminalQueryResource<Output>(): QueryResource<Output> {
	const snapshot = failedQueryResource({ code: "RESOURCE_LIMIT" }) as QueryResourceSnapshot<Output>;
	return Object.freeze({ getSnapshot: () => snapshot, subscribe: () => () => undefined });
}
function createQueryResourceRegistry(startWatch: QueryResourceWatchStarter) {
	const entries = new Map<string, QueryResourceEntry>();
	const touch = (key: string): void => {
		const entry = entries.get(key);
		if (entry === undefined) return;
		entries.delete(key);
		entries.set(key, entry);
	};
	const admit = (): boolean => {
		if (entries.size < 128) return true;
		for (const entry of entries.values()) if (entry.resource.evict()) return true;
		return false;
	};
	return Object.freeze({
		observe<Output>(query: string, canonicalInput: unknown): QueryResource<Output> {
			const key = query + "\\0" + JSON.stringify(canonicalInput);
			const existing = entries.get(key);
			if (existing !== undefined) {
				touch(key);
				return existing.resource as QueryResource<Output>;
			}
			if (!admit()) return terminalQueryResource<Output>();
			let resource!: GeneratedQueryResource<Output>;
			resource = new GeneratedQueryResource<Output>({
				canonicalInput,
				remove: () => {
					if (entries.get(key)?.resource === resource) entries.delete(key);
				},
				startWatch: (input, callback, options) => startWatch(query, input, callback as (output: unknown, delivery: QueryDelivery) => void, options),
				touch: () => touch(key),
			});
			entries.set(key, Object.freeze({ resource: resource as GeneratedQueryResource<unknown> }));
			return resource;
		},
	});
}
`,
		scope: `
		const queryResources = createQueryResourceRegistry((query, encodedInput, callback, options) => watchEncodedBinding(query, encodedInput, callback, options));`,
	});
}
