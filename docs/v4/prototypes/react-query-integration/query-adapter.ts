import type {
	DataTag,
	MutationObserverOptions,
	QueryClient,
	QueryFunction,
} from "@tanstack/query-core";

import { createLiveQueryOptions } from "./live-options";
import {
	projectionVersion,
	type CapturedRead,
	type MutationDescriptor,
	type Projection,
	type ReadDescriptor,
} from "./projection-contract";

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
	}>;
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

const proofCaptureLimit = 128;
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
}>;
const bindings = new WeakMap<Projection, WeakMap<QueryClient, unknown>>();

export function bindProjection<Source extends Projection>(
	source: Source,
	client: QueryClient,
): Binding<Source> {
	if (source.version !== projectionVersion)
		throw new Error("CLIENT_PROJECTION_INCOMPATIBLE");
	let owners = bindings.get(source);
	if (!owners) {
		owners = new WeakMap();
		bindings.set(source, owners);
	}
	const existing = owners.get(client);
	if (existing) return existing as Binding<Source>;
	let retired = false;
	let ordinal = 0;
	const prefix = ["questpie", source.scopeId, crypto.randomUUID()] as const;
	const captures = new Map<
		string,
		{
			key: readonly string[];
			captured: CapturedRead<unknown>;
			live?: ReturnType<typeof createLiveQueryOptions<unknown>>;
		}
	>();
	const queries = Object.fromEntries(
		Object.entries(source.queries).map(([name, descriptor]) => [
			name,
			Object.freeze({
				isError: descriptor.isError,
				options(input: never) {
					if (retired) throw new Error("SCOPE_RETIRED");
					const captured = descriptor.capture(input);
					const identity = JSON.stringify([
						descriptor.identity,
						captured.canonical,
					]);
					let retained = captures.get(identity);
					if (!retained) {
						if (captures.size >= proofCaptureLimit)
							throw new Error("PROOF_CAPTURE_LIMIT");
						retained = {
							key: Object.freeze([
								...prefix,
								descriptor.identity,
								String(++ordinal),
							]),
							captured,
						};
						captures.set(identity, retained);
						if (captured.watch)
							retained.live = createLiveQueryOptions({
								client,
								key: retained.key,
								watch: captured.watch,
							});
					}
					const entry = retained;
					if (entry.live) return entry.live.options;
					return {
						queryKey: entry.key,
						retry: false,
						queryFn: ({ signal }: { signal: AbortSignal }) => {
							if (retired) throw new Error("SCOPE_RETIRED");
							return entry.captured.call({ signal });
						},
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
							if (retired) throw new Error("SCOPE_RETIRED");
							return descriptor.invoke(input);
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
		async dispose() {
			if (retired) return;
			retired = true;
			const liveClosures = [...captures.values()].map((entry) =>
				entry.live?.dispose(),
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
			captures.clear();
			await cancelled;
			await Promise.all(liveClosures);
		},
	});
	owners.set(client, binding);
	return binding;
}
