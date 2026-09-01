export type QueryDelivery =
	| Readonly<{ kind: "initial" }>
	| Readonly<{ kind: "update" }>
	| Readonly<{
			kind: "reset";
			reason: "authority-changed" | "deployment-changed" | "resume-unavailable";
	  }>;

export type WatchFailure = Readonly<{
	code:
		| "AUTHORIZATION_FAILED"
		| "OUTPUT_INVALID"
		| "RESOURCE_LIMIT"
		| "TRANSPORT_FAILED"
		| "VERSION_INCOMPATIBLE";
}>;

export type QueryResourceConnection =
	| Readonly<{ kind: "idle" }>
	| Readonly<{ kind: "connecting" }>
	| Readonly<{ kind: "connected" }>
	| Readonly<{ kind: "reconnecting"; attempt: number }>;

export type QueryResourceSnapshot<Output> =
	| Readonly<{
			kind: "pending";
			connection: QueryResourceConnection;
	  }>
	| Readonly<{
			kind: "ready";
			value: Output;
			delivery: QueryDelivery;
			connection: QueryResourceConnection;
	  }>
	| Readonly<{ kind: "failed"; failure: WatchFailure }>;

export interface QueryResource<Output> {
	getSnapshot(): QueryResourceSnapshot<Output>;
	subscribe(notify: () => void): () => void;
}

export type WatchOptions = Readonly<{
	onStateChange?(
		state: Readonly<
			{ kind: "connected" } | { kind: "reconnecting"; attempt: number }
		>,
	): void;
	onError?(failure: WatchFailure): void;
}>;

export interface OneShotQueryMethod<Input, Output> {
	(input: Input): Promise<Output>;
}

export interface WatchableQueryMethod<Input, Output> extends OneShotQueryMethod<
	Input,
	Output
> {
	watch(
		input: Input,
		callback: (output: Output, delivery: QueryDelivery) => void,
		options?: WatchOptions,
	): () => void;
	observe(input: Input): QueryResource<Output>;
}

type RegistryEntry = Readonly<{
	key: string;
	resource: Resource<unknown>;
}>;

const idle = Object.freeze({ kind: "idle" as const });
const connecting = Object.freeze({ kind: "connecting" as const });
const connected = Object.freeze({ kind: "connected" as const });

function pending(
	connection: QueryResourceConnection,
): QueryResourceSnapshot<never> {
	return Object.freeze({ kind: "pending", connection });
}

function failed(failure: WatchFailure): QueryResourceSnapshot<never> {
	return Object.freeze({ kind: "failed", failure: Object.freeze(failure) });
}

class Resource<Output> implements QueryResource<Output> {
	readonly #input: unknown;
	readonly #listeners = new Set<() => void>();
	readonly #remove: () => void;
	readonly #reportSubscriberError: (error: unknown) => void;
	readonly #startWatch: (
		input: unknown,
		callback: (output: Output, delivery: QueryDelivery) => void,
		options: WatchOptions,
	) => () => void;
	readonly #touch: () => void;
	#generation = 0;
	#snapshot: QueryResourceSnapshot<Output> = pending(idle);
	#stop: (() => void) | undefined;

	constructor(
		input: Readonly<{
			operationInput: unknown;
			remove(): void;
			reportSubscriberError(error: unknown): void;
			startWatch(
				operationInput: unknown,
				callback: (output: Output, delivery: QueryDelivery) => void,
				options: WatchOptions,
			): () => void;
			touch(): void;
		}>,
	) {
		this.#input = structuredClone(input.operationInput);
		this.#remove = input.remove;
		this.#reportSubscriberError = input.reportSubscriberError;
		this.#startWatch = input.startWatch;
		this.#touch = input.touch;
	}

	get subscribed(): boolean {
		return this.#listeners.size > 0;
	}

	getSnapshot(): QueryResourceSnapshot<Output> {
		return this.#snapshot;
	}

	subscribe(notify: () => void): () => void {
		this.#touch();
		this.#listeners.add(notify);
		if (this.#listeners.size === 1) this.#open();
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.#listeners.delete(notify);
			if (this.#listeners.size === 0) this.#idle();
		};
	}

	#publish(snapshot: QueryResourceSnapshot<Output>): void {
		if (Object.is(this.#snapshot, snapshot)) return;
		this.#snapshot = snapshot;
		const listeners = Array.from(this.#listeners);
		for (const listener of listeners) {
			try {
				listener();
			} catch (error) {
				this.#reportSubscriberError(error);
			}
		}
	}

	#open(): void {
		const generation = ++this.#generation;
		const prior = this.#snapshot;
		this.#publish(
			prior.kind === "ready"
				? Object.freeze({ ...prior, connection: connecting })
				: pending(connecting),
		);
		let stopAfterStart = false;
		const stop = this.#startWatch(
			this.#input,
			(output, delivery) => {
				if (generation !== this.#generation || this.#listeners.size === 0)
					return;
				this.#publish(
					Object.freeze({
						kind: "ready",
						value: output,
						delivery: Object.freeze(delivery),
						connection: connected,
					}),
				);
			},
			{
				onStateChange: (state) => {
					if (generation !== this.#generation) return;
					const connection =
						state.kind === "connected"
							? connected
							: Object.freeze({
									kind: "reconnecting" as const,
									attempt: state.attempt,
								});
					const current = this.#snapshot;
					this.#publish(
						current.kind === "ready"
							? Object.freeze({ ...current, connection })
							: pending(connection),
					);
				},
				onError: (failure) => {
					if (generation !== this.#generation) return;
					this.#generation += 1;
					this.#remove();
					this.#publish(failed(failure));
					if (this.#stop === undefined) stopAfterStart = true;
					else {
						const activeStop = this.#stop;
						this.#stop = undefined;
						activeStop();
					}
				},
			},
		);
		if (stopAfterStart) stop();
		else this.#stop = stop;
	}

	#idle(): void {
		this.#generation += 1;
		const stop = this.#stop;
		this.#stop = undefined;
		stop?.();
		const current = this.#snapshot;
		if (current.kind === "ready")
			this.#snapshot = Object.freeze({ ...current, connection: idle });
		else if (current.kind === "pending") this.#snapshot = pending(idle);
	}
}

function terminalResource<Output>(
	failure: WatchFailure,
): QueryResource<Output> {
	const snapshot = failed(failure) as QueryResourceSnapshot<Output>;
	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe: () => () => undefined,
	});
}

export function createQueryResourceScope(
	input?: Readonly<{
		capacity?: number;
		reportSubscriberError?(error: unknown): void;
	}>,
) {
	const capacity = input?.capacity ?? 128;
	if (!Number.isSafeInteger(capacity) || capacity < 1)
		throw new TypeError("Query Resource capacity must be positive");
	const entries = new Map<string, RegistryEntry>();
	const touch = (key: string) => {
		const entry = entries.get(key);
		if (entry === undefined) return;
		entries.delete(key);
		entries.set(key, entry);
	};
	const admit = (): boolean => {
		if (entries.size < capacity) return true;
		for (const [key, entry] of entries) {
			if (entry.resource.subscribed) continue;
			entries.delete(key);
			return true;
		}
		return false;
	};

	return Object.freeze({
		watchable<Input, Output>(
			definition: Readonly<{
				identity: string;
				encode(input: Input): string;
				call(input: Input): Promise<Output>;
				watch(
					input: Input,
					callback: (output: Output, delivery: QueryDelivery) => void,
					options: WatchOptions,
				): () => void;
			}>,
		): WatchableQueryMethod<Input, Output> {
			const method = (async (operationInput: Input) =>
				await definition.call(operationInput)) as WatchableQueryMethod<
				Input,
				Output
			>;
			method.watch = definition.watch;
			method.observe = (operationInput) => {
				const key = `${definition.identity}\0${definition.encode(operationInput)}`;
				const existing = entries.get(key);
				if (existing !== undefined) {
					touch(key);
					return existing.resource as QueryResource<Output>;
				}
				if (!admit()) return terminalResource({ code: "RESOURCE_LIMIT" });
				const resource = new Resource<Output>({
					operationInput,
					remove: () => entries.delete(key),
					reportSubscriberError:
						input?.reportSubscriberError ?? (() => undefined),
					startWatch: (_input, callback, options) =>
						definition.watch(operationInput, callback, options),
					touch: () => touch(key),
				});
				entries.set(key, Object.freeze({ key, resource }));
				return resource;
			};
			return Object.freeze(method);
		},
	});
}

export type UseQueryResource = <Output>(
	resource: QueryResource<Output>,
) => QueryResourceSnapshot<Output>;
