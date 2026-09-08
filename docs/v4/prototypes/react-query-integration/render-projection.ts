import { renderCodecType } from "../../../../packages/compiler/src/runtime/client";
import type { NormalizedResource } from "../../../../packages/compiler/src/types";

type ProjectionResource = Pick<
	NormalizedResource,
	"kind" | "name" | "identity" | "contract"
>;

function errorType(resource: ProjectionResource): string {
	const errors = resource.contract.declaredErrors as Record<
		string,
		{ code: string; status: number; payload: unknown }
	>;
	return (
		Object.values(errors)
			.map(
				(error) =>
					`Error & Readonly<{ code: ${JSON.stringify(error.code)}; status: ${error.status}; payload: ${error.payload === null ? "null" : renderCodecType(error.payload)} }>`,
			)
			.join(" | ") || "never"
	);
}

/** Throwaway instrumentation: reuses the unchanged renderer's codecs/transport. */
export function instrumentClient(
	source: string,
	resources: readonly ProjectionResource[],
	watchable: readonly string[] = [],
	pages: readonly { identity: string; after: string }[] = [],
): string {
	const start = "return Object.freeze({ context, queries: Object.freeze({";
	const end = "}), withContext: scope });";
	if (source.split(start).length !== 2 || source.split(end).length !== 2)
		throw new Error("PROOF_RENDERER_SEAM_CHANGED");
	const declarations = (kind: "query" | "mutation") =>
		resources
			.filter(
				(resource) =>
					resource.kind === kind && resource.contract.exposure === "network",
			)
			.map((resource) => {
				const method = `GeneratedClientScope[${JSON.stringify(kind === "query" ? "queries" : "mutations")}][${JSON.stringify(resource.name)}]`;
				const page =
					kind === "query"
						? pages.find((page) => page.identity === resource.identity)
						: undefined;
				return `${JSON.stringify(resource.name)}: ${kind === "query" ? "ReadDescriptor" : "MutationDescriptor"}<Parameters<${method}>[0], Awaited<ReturnType<${method}>>, ${errorType(resource)}>${page ? ` & { readonly forward: ForwardReadDescriptor<Omit<Parameters<${method}>[0], ${JSON.stringify(page.after)}>, Awaited<ReturnType<${method}>>> }` : ""};`;
			})
			.join("\n");
	const members = (kind: "query" | "mutation") =>
		resources
			.filter(
				(resource) =>
					resource.kind === kind && resource.contract.exposure === "network",
			)
			.map((resource) => {
				const id = JSON.stringify(resource.identity);
				const method = `scope.${kind === "query" ? "queries" : "mutations"}[${JSON.stringify(resource.name)}]`;
				const page =
					kind === "query"
						? pages.find((page) => page.identity === resource.identity)
						: undefined;
				const forward = page
					? `, forward: Object.freeze({ capture: (input: Omit<Parameters<typeof ${method}>[0], ${JSON.stringify(page.after)}>) => captureForwardRead(${id}, ${method}, input, ${JSON.stringify(page.after)}), next: (page: Awaited<ReturnType<typeof ${method}>>) => page.pageInfo.hasNextPage ? page.pageInfo.endCursor ?? undefined : undefined })`
					: "";
				return `${JSON.stringify(resource.name)}: Object.freeze({ identity: ${id}, ${kind === "query" ? `capture: (input: Parameters<typeof ${method}>[0]) => captureClientRead(${id}, ${method}, input${watchable.includes(resource.identity) ? `, ${method}.watch` : ""})` : `invoke: ${method}`}, isError: (error: unknown): error is ${errorType(resource)} => matchesClientError(${id}, error)${forward} }),`;
			})
			.join("\n");
	return (
		`import type { CapturedRead, ReadDescriptor, MutationDescriptor, ProjectionWatchFailure, CapturedForwardRead, ForwardReadDescriptor } from "../projection-contract";\n` +
		source
			.replace(
				start,
				"const generatedScope = Object.freeze({ context, queries: Object.freeze({",
			)
			.replace(
				end,
				"}), withContext: scope });\n\t\tclientProjections.set(generatedScope, undefined);\n\t\treturn generatedScope;",
			) +
		`

export interface ClientProjection {
	readonly version: "questpie.client-projection.prototype.v1";
	readonly scopeId: string;
	readonly queries: Readonly<{ ${declarations("query")} }>;
	readonly mutations: Readonly<{ ${declarations("mutation")} }>;
}

const clientProjections = new WeakMap<GeneratedClientScope, ClientProjection | undefined>();

function captureForwardRead<Input, Output>(identity: string, call: (input: Input, options?: CallOptions) => Promise<Output>, input: unknown, after: string): CapturedForwardRead<Output> {
	const base = wireRecord(input);
	if (Object.hasOwn(base, after)) return protocolFailure();
	const canonical = encode(inputCodecs[identity], { ...base, [after]: null });
	return Object.freeze({
		canonical: JSON.stringify(canonical),
		call: (pageParam: string | null, options?: CallOptions) => call({ ...wireRecord(decode(inputCodecs[identity], canonical)), [after]: pageParam } as Input, options),
	});
}

function captureClientRead<Input, Output>(identity: string, call: (input: Input, options?: CallOptions) => Promise<Output>, input: Input, watch?: (input: Input, callback: (value: Output) => void, options?: { onError?: (failure: ProjectionWatchFailure) => void }) => () => void): CapturedRead<Output> {
	const canonical = encode(inputCodecs[identity], input);
	return Object.freeze({
		canonical: JSON.stringify(canonical),
		call: (options?: CallOptions) => call(decode(inputCodecs[identity], canonical) as Input, options),
		...(watch ? { watch: (callback: (value: Output) => void, onError: (failure: ProjectionWatchFailure) => void) => watch(decode(inputCodecs[identity], canonical) as Input, callback, { onError }) } : {}),
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

/** Proof-only generated sibling seam, not a public descriptor API. */
export function getClientProjection(scope: GeneratedClientScope): ClientProjection {
	if (!clientProjections.has(scope)) throw new Error("CLIENT_SCOPE_MISMATCH");
	const retained = clientProjections.get(scope);
	if (retained) return retained;
	const projection: ClientProjection = Object.freeze({
		version: "questpie.client-projection.prototype.v1",
		scopeId: crypto.randomUUID(),
		queries: Object.freeze({ ${members("query")} }),
		mutations: Object.freeze({ ${members("mutation")} }),
	});
	clientProjections.set(scope, projection);
	return projection;
}
`
	);
}
