import { renderCodecType } from "../../../../packages/compiler/src/runtime/client";
import type { NormalizedResource } from "../../../../packages/compiler/src/types";
import { projectionVersion } from "./projection-contract";

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
	// Stamp only validated decoder outcomes, never public constructors or catches.
	const decoderThrows = [
		[
			"throw new CommittedResultUnavailable(input.callId, detail.transactionId);",
			"throw recordDecodedMutationFailure(input, new CommittedResultUnavailable(input.callId, detail.transactionId), detail.transactionId);",
		],
		[
			"throw publicError({ code: detail.code, status: contract.status, payload });",
			"throw recordDecodedMutationFailure(input, publicError({ code: detail.code, status: contract.status, payload }));",
		],
	] as const;
	for (const [before, after] of decoderThrows) {
		if (source.split(before).length !== 2)
			throw new Error("PROOF_RENDERER_SEAM_CHANGED");
		source = source.replace(before, after);
	}
	// Proof-only extraction from the unchanged renderer's existing identity.
	// Production projection must use those renderer inputs directly.
	const contract = [
		"Questpie-Application",
		"Questpie-Client-Contract",
		"Questpie-Wire-Digest",
	].map((header) => {
		const match = source.match(
			new RegExp(`"${header}": ("(?:[^"\\\\]|\\\\.)*")`),
		);
		if (!match?.[1]) throw new Error("PROOF_RENDERER_SEAM_CHANGED");
		return JSON.parse(match[1]);
	});
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
				return `${JSON.stringify(resource.name)}: Object.freeze({ identity: ${id}, ${kind === "query" ? `watchable: ${watchable.includes(resource.identity)}, capture: (input: Parameters<typeof ${method}>[0]) => captureClientRead(${id}, ${method}, input${watchable.includes(resource.identity) ? `, ${method}.watch` : ""})` : `invoke: ${method}, failure: (error: unknown) => decodedMutationFailure(${id}, error)`}, isError: (error: unknown): error is ${errorType(resource)} => matchesClientError(${id}, error)${forward} }),`;
			})
			.join("\n");
	return (
		`import type { CapturedRead, ReadDescriptor, MutationDescriptor, DecodedMutationFailure, ProjectionWatchFailure, CapturedForwardRead, ForwardReadDescriptor } from "../projection-contract";\n` +
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
	readonly version: ${JSON.stringify(projectionVersion)};
	readonly canonicalScope: string;
	readonly queries: Readonly<{ ${declarations("query")} }>;
	readonly mutations: Readonly<{ ${declarations("mutation")} }>;
}

const clientProjections = new WeakMap<GeneratedClientScope, ClientProjection | undefined>();

const decodedMutationFailures = new WeakMap<Error, Readonly<{ operation: string; outcome: DecodedMutationFailure }>>();

function recordDecodedMutationFailure(input: Readonly<{ operation: string; callId: string; kind: string }>, error: Error, transactionId?: string): Error {
	if (input.kind === "mutation") decodedMutationFailures.set(error, Object.freeze({
		operation: input.operation,
		outcome: Object.freeze(transactionId === undefined
			? { kind: "rejected", callId: input.callId }
			: { kind: "committed", callId: input.callId, transactionId }),
	}));
	return error;
}

function decodedMutationFailure(operation: string, error: unknown): DecodedMutationFailure | undefined {
	if (!(error instanceof Error)) return undefined;
	const decoded = decodedMutationFailures.get(error);
	return decoded?.operation === operation ? decoded.outcome : undefined;
}

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
		version: ${JSON.stringify(projectionVersion)},
		canonicalScope: JSON.stringify([${JSON.stringify(contract)}, encode(contextCodec, scope.context)]),
		queries: Object.freeze({ ${members("query")} }),
		mutations: Object.freeze({ ${members("mutation")} }),
	});
	clientProjections.set(scope, projection);
	return projection;
}
`
	);
}
