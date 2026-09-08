import type { NormalizedResource } from "../types";

type RecordValue = Readonly<Record<string, unknown>>;
function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("Invalid generated client projection input");
	return value as RecordValue;
}

/** Render the neutral capability directly from the compiler's existing facts. */
export function renderClientProjection(
	resources: readonly NormalizedResource[],
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		httpContractDigest: string;
		watchable: ReadonlySet<string>;
		queryProjection?: Readonly<Record<string, unknown>>;
	}>,
	renderType: (codec: unknown) => string,
) {
	const pages = new Map<string, string>();
	const queries = input.queryProjection?.queries;
	if (queries !== undefined) {
		if (!Array.isArray(queries))
			throw new TypeError("Invalid Query projection");
		for (const entry of queries) {
			const query = record(entry);
			if (typeof query.identity !== "string") continue;
			const page = record(record(query.template).page);
			if (page.kind !== "forwardCursor") continue;
			const after = record(page.after).parameter;
			if (typeof after !== "string")
				throw new TypeError("Invalid forward cursor parameter");
			pages.set(query.identity, after);
		}
	}
	const selected = (kind: "query" | "mutation") =>
		resources.filter(
			(resource) =>
				resource.kind === kind && resource.contract.exposure === "network",
		);
	const errorType = (resource: NormalizedResource) =>
		Object.values(record(resource.contract.declaredErrors ?? {}))
			.map((value) => {
				const error = record(value);
				return `Error & Readonly<{ code: ${JSON.stringify(error.code)}; status: ${error.status}; payload: ${error.payload === null ? "null" : renderType(error.payload)} }>`;
			})
			.join(" | ") || "never";
	const declarations = (kind: "query" | "mutation") =>
		selected(kind)
			.map((resource) => {
				const method = `GeneratedClientScope[${JSON.stringify(kind === "query" ? "queries" : "mutations")}][${JSON.stringify(resource.name)}]`;
				const after =
					kind === "query" ? pages.get(resource.identity) : undefined;
				return `${JSON.stringify(resource.name)}: ${kind === "query" ? "ReadDescriptor" : "MutationDescriptor"}<Parameters<${method}>[0], Awaited<ReturnType<${method}>>, ${errorType(resource)}>${after === undefined ? "" : ` & { readonly forward: ForwardReadDescriptor<Omit<Parameters<${method}>[0], ${JSON.stringify(after)}>, Awaited<ReturnType<${method}>>> }`};`;
			})
			.join("\n");
	const members = (kind: "query" | "mutation") =>
		selected(kind)
			.map((resource) => {
				const identity = JSON.stringify(resource.identity);
				const method = `scope.${kind === "query" ? "queries" : "mutations"}[${JSON.stringify(resource.name)}]`;
				const watchable = input.watchable.has(resource.identity);
				const after =
					kind === "query" ? pages.get(resource.identity) : undefined;
				const forward =
					after === undefined
						? ""
						: `, forward: Object.freeze({ capture: (input: Omit<Parameters<typeof ${method}>[0], ${JSON.stringify(after)}>) => captureForwardRead(${identity}, ${method}, input, ${JSON.stringify(after)}), next: (page: Awaited<ReturnType<typeof ${method}>>) => page.pageInfo.hasNextPage ? page.pageInfo.endCursor ?? undefined : undefined })`;
				return `${JSON.stringify(resource.name)}: Object.freeze({ identity: ${identity}, ${kind === "query" ? `watchable: ${watchable}, capture: (input: Parameters<typeof ${method}>[0]) => captureClientRead(${identity}, ${method}, input${watchable ? `, ${method}.watch` : ""})` : `invoke: ${method}, failure: (error: unknown) => decodedMutationFailure(${identity}, error)`}, isError: (error: unknown): error is ${errorType(resource)} => matchesClientError(${identity}, error)${forward} }),`;
			})
			.join("\n");
	return {
		imports: `import { attachClientScope, type ClientScope, type CapturedRead, type ReadDescriptor, type MutationDescriptor, type DecodedMutationFailure, type ProjectionWatchFailure, type CapturedForwardRead, type ForwardReadDescriptor } from "questpie/internal/client-projection";`,
		declarations: `interface ClientProjection {
	readonly version: "questpie.client-projection.v1";
	readonly canonicalScope: string;
	readonly queries: Readonly<{ ${declarations("query")} }>;
	readonly mutations: Readonly<{ ${declarations("mutation")} }>;
}`,
		runtime: `
function captureForwardRead<Input, Output>(identity: string, call: (input: Input, options?: CallOptions) => Promise<Output>, input: unknown, after: string): CapturedForwardRead<Output> {
	const base = wireRecord(input);
	if (Object.hasOwn(base, after)) return protocolFailure();
	const canonical = encode(inputCodecs[identity], { ...base, [after]: null });
	return Object.freeze({
		canonical: JSON.stringify(canonical),
		call: (pageParam: string | null, options?: CallOptions) => call({ ...wireRecord(transform(inputCodecs[identity], canonical, "restoreInput")), [after]: pageParam } as Input, options),
	});
}
function captureClientRead<Input, Output>(identity: string, call: (input: Input, options?: CallOptions) => Promise<Output>, input: Input, watch?: (input: Input, callback: (value: Output) => void, options?: { onError?: (failure: ProjectionWatchFailure) => void }) => () => void): CapturedRead<Output> {
	const canonical = encode(inputCodecs[identity], input);
	return Object.freeze({
		canonical: JSON.stringify(canonical),
		call: (options?: CallOptions) => call(transform(inputCodecs[identity], canonical, "restoreInput") as Input, options),
		...(watch ? { watch: (callback: (value: Output) => void, onError: (failure: ProjectionWatchFailure) => void) => watch(transform(inputCodecs[identity], canonical, "restoreInput") as Input, callback, { onError }) } : {}),
	});
}
function matchesClientError(identity: string, value: unknown): boolean {
	try {
		if (!(value instanceof Error)) return false;
		const error = value as unknown as WireRecord;
		exactKeys(error, ["code", "payload", "status"]);
		const allowed = declaredErrorContracts[identity];
		if (!Array.isArray(allowed)) return false;
		const contract = allowed.map(wireRecord).find((candidate) => candidate.code === error.code && candidate.status === error.status);
		if (!contract) return false;
		if (contract.payload === null) return error.payload === null;
		encode(contract.payload, error.payload);
		return true;
	} catch { return false; }
}
function projectClientScope(scope: GeneratedClientScope): ClientProjection {
	return Object.freeze({
		version: "questpie.client-projection.v1",
		canonicalScope: JSON.stringify([${JSON.stringify([input.application, input.clientContractDigest, input.httpContractDigest])}, encode(contextCodec, scope.context)]),
		queries: Object.freeze({ ${members("query")} }),
		mutations: Object.freeze({ ${members("mutation")} }),
	});
}`,
	};
}
