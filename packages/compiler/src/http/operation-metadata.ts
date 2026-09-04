import { compareAscii, digest } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";

type JsonRecord = Readonly<Record<string, unknown>>;

export type DocumentationEntry = Readonly<{
	identity: string;
	summary: string;
	description?: string;
	examples?: readonly Readonly<{ input: unknown; output?: unknown }>[];
}>;

type OperationIdentity = Readonly<{ identity: string }>;

function invalid(message: string): never {
	throw new TypeError(message);
}

function record(value: unknown): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return invalid("invalid operation projection artifact");
	return value as JsonRecord;
}

export function projectOperationDocumentationEntries(input: {
	readonly documentationBytes: string;
	readonly documentationDigest: string;
}): DocumentationEntry[] {
	const artifact = record(JSON.parse(input.documentationBytes));
	if (
		artifact.format !== "questpie.operation-documentation" ||
		artifact.version !== 1 ||
		!Array.isArray(artifact.operations) ||
		digest("questpie-operation-documentation-v1", artifact) !==
			input.documentationDigest
	)
		return invalid("operation documentation digest mismatch");
	return (artifact.operations as DocumentationEntry[]).toSorted((left, right) =>
		compareAscii(left.identity, right.identity),
	);
}

function escapeJsDoc(value: string): string {
	return value
		.replaceAll("*/", "*\\/")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

function renderJsDoc(entry: DocumentationEntry): string {
	const lines = [
		entry.summary,
		...(entry.description ? ["", entry.description] : []),
	]
		.flatMap((line) => escapeJsDoc(line).split("\n"))
		.map((line) => {
			const inert = line.replace(/^(\s*)@/u, "$1\\@");
			return inert.length === 0 ? " *" : " * " + inert;
		});
	return ["/**", ...lines, " */"].join("\n");
}

export function projectOperationJsDoc(input: {
	readonly documentationBytes: string;
	readonly documentationDigest: string;
}): Readonly<Record<string, string>> {
	return Object.fromEntries(
		projectOperationDocumentationEntries(input).map((entry) => [
			entry.identity,
			renderJsDoc(entry),
		]),
	);
}

function operationName(identity: string): string {
	return identity.slice(identity.indexOf(":") + 1);
}

function assertUniqueOperationIds(
	operations: readonly OperationIdentity[],
	origins: readonly Readonly<{
		identity: string;
		establishedAt: JsonRecord;
	}>[],
): void {
	const byName = new Map<string, OperationIdentity>();
	for (const operation of operations) {
		const name = operationName(operation.identity);
		const existing = byName.get(name);
		if (!existing) {
			byName.set(name, operation);
			continue;
		}
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-029",
			"httpProjectionCollision",
			`${existing.identity} and ${operation.identity} share OpenAPI operationId ${name}`,
			{
				reason: "openApiOperationIdCollision",
				rewrite: "rename one Operation; OpenAPI never suffixes identities",
				origins: [existing.identity, operation.identity].map(
					(identity) =>
						origins.find((resource) => resource.identity === identity)
							?.establishedAt ?? { identity },
				),
			},
		);
	}
}

export function projectOperationMetadata(input: {
	readonly documentationBytes: string;
	readonly documentationDigest: string;
	readonly httpContractDigest: string;
	readonly operationContracts: readonly OperationIdentity[];
	readonly networkOperations: readonly OperationIdentity[];
	readonly origins: readonly Readonly<{
		identity: string;
		establishedAt: JsonRecord;
	}>[];
}): Readonly<{
	documentationByIdentity: ReadonlyMap<string, DocumentationEntry>;
	explain: JsonRecord & Readonly<{ operations: readonly JsonRecord[] }>;
	jsdoc: Readonly<Record<string, string>>;
}> {
	const documentation = projectOperationDocumentationEntries(input);
	assertUniqueOperationIds(input.networkOperations, input.origins);
	const networkIdentities = new Set(
		input.networkOperations.map(({ identity }) => identity),
	);
	const directIdentities = new Set(
		input.operationContracts.map(({ identity }) => identity),
	);
	const operations = input.origins
		.filter(
			({ identity }) =>
				directIdentities.has(identity) || identity.startsWith("route:"),
		)
		.map(({ identity, establishedAt }) =>
			networkIdentities.has(identity)
				? { identity, disposition: "included", origin: establishedAt }
				: {
						identity,
						disposition: "omitted",
						reason: identity.startsWith("route:")
							? "rawRouteUnsupported"
							: "directOnly",
						origin: establishedAt,
					},
		)
		.sort((left, right) =>
			compareAscii(String(left.identity), String(right.identity)),
		);
	return {
		documentationByIdentity: new Map(
			documentation.map((entry) => [entry.identity, entry]),
		),
		explain: {
			format: "questpie.operation-projection-explain",
			version: 1,
			documentationDigest: input.documentationDigest,
			httpContractDigest: input.httpContractDigest,
			operations,
		},
		jsdoc: Object.fromEntries(
			documentation.map((entry) => [entry.identity, renderJsDoc(entry)]),
		),
	};
}
