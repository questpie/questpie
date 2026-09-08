import type {
	DataTag,
	MutationObserverOptions,
	QueryClient,
	QueryObserverOptions,
} from "@tanstack/query-core";

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
		options(input: InputOf<Descriptor>): QueryObserverOptions<
			OutputOf<Descriptor>,
			unknown
		> & {
			queryKey: DataTag<readonly string[], OutputOf<Descriptor>, unknown>;
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
	const prefix = ["questpie", source.scopeId] as const;
	const captures = new Map<
		string,
		{ key: readonly string[]; captured: CapturedRead<unknown> }
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
					}
					const entry = retained;
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
		},
	});
	owners.set(client, binding);
	return binding;
}
