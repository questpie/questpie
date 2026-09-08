import type {
	DataTag,
	InfiniteData,
	MutationObserverOptions,
	QueryClient,
	QueryFunction,
} from "@tanstack/query-core";

import { createCacheIdentity, type QueryBootstrap } from "./cache-identity";
import { createLiveQueryOptions } from "./live-options";
import { createMutationLifetime } from "./mutation-lifetime";
import {
	projectionVersion,
	type ForwardReadDescriptor,
	type MutationDescriptor,
	type Projection,
	type ReadDescriptor,
} from "./projection-contract";
import { createScopeInvalidation } from "./scope-invalidation";

type InputOf<Descriptor> =
	Descriptor extends ReadDescriptor<infer Input, unknown, unknown>
		? Input
		: never;
type OutputOf<Descriptor> =
	Descriptor extends ReadDescriptor<never, infer Output, unknown>
		? Output
		: never;
type QueryFactory<Descriptor extends ReadDescriptor<never, unknown, unknown>> =
	Readonly<{
		options(input: InputOf<Descriptor>): {
			queryKey: DataTag<readonly string[], OutputOf<Descriptor>, unknown>;
			queryFn: QueryFunction<OutputOf<Descriptor>>;
			retry: false;
			staleTime?: number;
			refetchOnWindowFocus?: false;
			refetchOnReconnect?: false;
			refetchOnMount?: false;
		};
		isError: Descriptor["isError"];
	}> &
		(Descriptor extends {
			readonly forward: ForwardReadDescriptor<infer Input, infer Output>;
		}
			? Readonly<{
					infiniteOptions(input: Input): {
						queryKey: DataTag<
							readonly string[],
							InfiniteData<Output, string | null>,
							unknown
						>;
						queryFn: QueryFunction<Output, readonly string[], string | null>;
						initialPageParam: string | null;
						getNextPageParam: (page: Output) => string | undefined;
						select: (
							data: InfiniteData<Output, string | null>,
						) => InfiniteData<Output, string | null>;
						retry: false;
					};
				}>
			: unknown);
type MutationFactory<
	Descriptor extends MutationDescriptor<never, unknown, unknown>,
> = Readonly<{
	options(): MutationObserverOptions<
		Awaited<ReturnType<Descriptor["invoke"]>>,
		unknown,
		Parameters<Descriptor["invoke"]>[0]
	>;
	isError: Descriptor["isError"];
}>;

type Binding<Source extends Projection> = Readonly<{
	queries: {
		readonly [Name in keyof Source["queries"]]: QueryFactory<
			Source["queries"][Name]
		>;
	};
	mutations: {
		readonly [Name in keyof Source["mutations"]]: MutationFactory<
			Source["mutations"][Name]
		>;
	};
	dispose(): Promise<void>;
	dehydrate(): QueryBootstrap;
}>;
const bindings = new WeakMap<
	Projection,
	WeakMap<
		QueryClient,
		{ binding: unknown; ssr: boolean; ready?: Promise<void> }
	>
>();
const bootstrapOwners = new WeakMap<QueryClient, Map<string, Projection>>();
export type BindingOptions = Readonly<{
	hydrate?: QueryBootstrap;
	ssr?: boolean;
	ready?: Promise<void>;
}>;

async function waitForReady(
	ready: Promise<void>,
	signal: AbortSignal,
): Promise<void> {
	signal.throwIfAborted();
	const cancelled = Promise.withResolvers<never>();
	const abort = () => cancelled.reject(signal.reason);
	signal.addEventListener("abort", abort, { once: true });
	try {
		await Promise.race([ready, cancelled.promise]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
	signal.throwIfAborted();
}

/** Native initial hydration may still settle after an authority scope retires. */
function fenceRetiredHydration(
	client: QueryClient,
	prefix: readonly string[],
	ready: Promise<void>,
) {
	const clearing = new WeakSet<object>();
	const unsubscribe = client.getQueryCache().subscribe(({ type, query }) => {
		if (
			(type !== "added" && type !== "updated") ||
			query.queryKey[0] !== prefix[0] ||
			query.queryKey[1] !== prefix[1] ||
			clearing.has(query)
		)
			return;
		clearing.add(query);
		try {
			query.setState({
				data: undefined,
				error: new Error("SCOPE_RETIRED"),
				status: "error",
				fetchStatus: "idle",
			});
			client.removeQueries({ queryKey: query.queryKey, exact: true });
		} finally {
			clearing.delete(query);
		}
	});
	void ready.then(unsubscribe, unsubscribe);
}

export function bindProjection<Source extends Projection>(
	source: Source,
	client: QueryClient,
	options: BindingOptions = {},
): Binding<Source> {
	if (
		source.version !== projectionVersion ||
		typeof source.canonicalScope !== "string"
	)
		throw new Error("CLIENT_PROJECTION_INCOMPATIBLE");
	if (
		Object.keys(options).some(
			(key) => key !== "hydrate" && key !== "ssr" && key !== "ready",
		) ||
		(options.ssr !== undefined && typeof options.ssr !== "boolean") ||
		(options.ready !== undefined &&
			(typeof options.ready?.then !== "function" ||
				typeof options.ready?.catch !== "function" ||
				options.ssr === true))
	)
		throw new Error("QUERY_BINDING_INVALID");
	const ssr = options.ssr === true;
	const ready = options.ready;
	// Host rejection is observed even if no Query is executed. A Query that
	// does execute still receives the original failure; no timeout bypass.
	void ready?.catch(() => {});
	let owners = bindings.get(source);
	if (!owners) {
		owners = new WeakMap();
		bindings.set(source, owners);
	}
	const existing = owners.get(client);
	const identityOwner = createCacheIdentity(
		source.canonicalScope,
		options.hydrate,
	);
	if (existing) {
		if (existing.ssr !== ssr || existing.ready !== ready)
			throw new Error("QUERY_BINDING_MISMATCH");
		const binding = existing.binding as Binding<Source>;
		if (
			options.hydrate &&
			binding.dehydrate().scope !== identityOwner.bootstrap.scope
		)
			throw new Error("QUERY_BOOTSTRAP_MISMATCH");
		return binding;
	}
	let active = bootstrapOwners.get(client);
	if (!active) {
		active = new Map();
		bootstrapOwners.set(client, active);
	}
	if (active.has(identityOwner.bootstrap.scope))
		throw new Error("QUERY_BOOTSTRAP_IN_USE");
	active.set(identityOwner.bootstrap.scope, source);
	let retired = false;
	const prefix = identityOwner.prefix;
	const invalidation = createScopeInvalidation(client, prefix, source, ssr);
	const mutationLifetime = createMutationLifetime(
		client,
		prefix,
		invalidation.committed,
	);
	const liveEntries = new Map<
		string,
		ReturnType<typeof createLiveQueryOptions<unknown>> | "retired"
	>();
	const liveFunctions = new WeakSet<object>();
	const unsubscribeCache = client.getQueryCache().subscribe((event) => {
		if (
			event.query.queryKey[0] !== prefix[0] ||
			event.query.queryKey[1] !== prefix[1]
		)
			return;
		const key = JSON.stringify(event.query.queryKey);
		if (event.type === "removed") {
			const entry = liveEntries.get(key);
			if (entry === "retired") return;
			// A terminal failure fences all equivalent options, including ones
			// created before the failed execution. Retain only its opaque key.
			if (entry?.retired) liveEntries.set(key, "retired");
			else liveEntries.delete(key);
			entry?.detach();
		}
		if (
			!retired &&
			(event.type === "observerAdded" ||
				event.type === "observerOptionsUpdated") &&
			event.query.isActive() &&
			event.query.state.status === "success" &&
			!liveEntries.has(key) &&
			typeof event.query.options.queryFn === "function" &&
			liveFunctions.has(event.query.options.queryFn)
		) {
			void client.refetchQueries({
				queryKey: event.query.queryKey,
				exact: true,
				type: "active",
			});
		}
	});
	const queries = Object.fromEntries(
		Object.entries(source.queries).map(([name, descriptor]) => [
			name,
			Object.freeze({
				isError: descriptor.isError,
				...(descriptor.forward
					? {
							infiniteOptions(input: never) {
								if (retired) throw new Error("SCOPE_RETIRED");
								const forward = descriptor.forward!;
								const captured = forward.capture(input);
								return {
									queryKey: identityOwner.key(
										descriptor.identity,
										"infinite",
										captured.canonical,
									),
									retry: false,
									initialPageParam: null,
									getNextPageParam: forward.next,
									// Native hooks otherwise default pageParams to unknown[].
									// Identity selection preserves the generated cursor type.
									select: (data: InfiniteData<unknown, string | null>) => data,
									queryFn: async ({
										signal,
										pageParam,
									}: {
										signal: AbortSignal;
										pageParam: string | null;
									}) => {
										if (retired) throw new Error("SCOPE_RETIRED");
										if (ready) await waitForReady(ready, signal);
										if (retired) throw new Error("SCOPE_RETIRED");
										return captured.call(pageParam, { signal });
									},
								};
							},
						}
					: {}),
				options(input: never) {
					if (retired) throw new Error("SCOPE_RETIRED");
					const captured = descriptor.capture(input);
					const key = identityOwner.key(
						descriptor.identity,
						"query",
						captured.canonical,
					);
					let live:
						| ReturnType<typeof createLiveQueryOptions<unknown>>
						| undefined;
					const queryFn = async ({ signal }: { signal: AbortSignal }) => {
						if (retired) throw new Error("SCOPE_RETIRED");
						if (ready) await waitForReady(ready, signal);
						if (retired) throw new Error("SCOPE_RETIRED");
						if (!captured.watch || ssr) return captured.call({ signal });
						const identity = JSON.stringify(key);
						if (live && !live.retired && liveEntries.get(identity) !== live)
							live = undefined;
						const retained = liveEntries.get(identity);
						if (retained === "retired") throw new Error("SCOPE_RETIRED");
						live ??= retained;
						if (!live) {
							live = createLiveQueryOptions({
								client,
								key,
								watch: captured.watch,
							});
							liveEntries.set(identity, live);
						}
						return live.options.queryFn({ signal });
					};
					if (captured.watch && !ssr) liveFunctions.add(queryFn);
					return {
						queryKey: key,
						retry: false,
						...(captured.watch
							? {
									staleTime: Infinity,
									refetchOnWindowFocus: false,
									refetchOnReconnect: false,
									refetchOnMount: false,
								}
							: {}),
						queryFn,
					};
				},
			}),
		]),
	) as unknown as {
		readonly [Name in keyof Source["queries"]]: QueryFactory<
			Source["queries"][Name]
		>;
	};
	const mutations = Object.fromEntries(
		Object.entries(source.mutations).map(([name, descriptor]) => [
			name,
			Object.freeze({
				isError: descriptor.isError,
				options() {
					if (retired) throw new Error("SCOPE_RETIRED");
					return {
						mutationKey: Object.freeze([...prefix, descriptor.identity]),
						retry: false,
						mutationFn: (input: never) => {
							return mutationLifetime.invoke(descriptor, input);
						},
					};
				},
			}),
		]),
	) as unknown as {
		readonly [Name in keyof Source["mutations"]]: MutationFactory<
			Source["mutations"][Name]
		>;
	};
	const binding = Object.freeze({
		queries: Object.freeze(queries),
		mutations: Object.freeze(mutations),
		dehydrate() {
			if (retired) throw new Error("SCOPE_RETIRED");
			return identityOwner.bootstrap;
		},
		async dispose() {
			if (retired) return;
			retired = true;
			if (ready) fenceRetiredHydration(client, prefix, ready);
			const invalidationClosed = invalidation.retire();
			let mutationFailure: unknown;
			try {
				mutationLifetime.dispose();
			} catch (error) {
				mutationFailure = error;
			}
			active.delete(identityOwner.bootstrap.scope);
			unsubscribeCache();
			const liveClosures = [...liveEntries.values()].map((entry) =>
				entry === "retired" ? undefined : entry.dispose(),
			);
			const cancelled = client.cancelQueries(
				{ queryKey: prefix },
				{ revert: false },
			);
			for (const query of client.getQueryCache().findAll({ queryKey: prefix }))
				query.setState({
					data: undefined,
					error: new Error("SCOPE_RETIRED"),
					status: "error",
					fetchStatus: "idle",
				});
			client.removeQueries({ queryKey: prefix });
			liveEntries.clear();
			await cancelled;
			await Promise.all(liveClosures);
			await invalidationClosed;
			if (mutationFailure !== undefined) throw mutationFailure;
		},
	});
	owners.set(client, { binding, ssr, ready });
	return binding;
}
