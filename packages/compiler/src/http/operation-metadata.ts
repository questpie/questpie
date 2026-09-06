import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import {
	projectOperationDocumentationEntries,
	projectOperationJsDoc,
	type DocumentationEntry,
} from "../operation-projection";

type JsonRecord = Readonly<Record<string, unknown>>;
type OperationIdentity = Readonly<{ identity: string }>;

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
		jsdoc: projectOperationJsDoc(input),
	};
}
