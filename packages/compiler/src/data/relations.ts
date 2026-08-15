import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { NormalizedResource } from "../types";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("expected an internal Relation record");
	return value as RecordValue;
}

function relations(value: unknown): [string, RecordValue][] {
	return Object.entries(record(value))
		.map(([key, relation]) => [key, record(relation)] as [string, RecordValue])
		.sort(([left], [right]) => compareAscii(left, right));
}

export function projectDataRelations(
	collections: readonly NormalizedResource[],
	schemaCollections: readonly unknown[],
): ReadonlyMap<string, readonly RecordValue[]> {
	const schemas = schemaCollections.map(record);
	const schemaByIdentity = new Map(
		schemas.map((collection) => [String(collection.identity), collection]),
	);
	const owningRelations = new Map<string, RecordValue>(
		schemas.flatMap((collection) =>
			(collection.relations as readonly unknown[]).map((relation) => {
				const value = record(relation);
				return [String(value.identity), value] as const;
			}),
		),
	);
	const relationMembers = new Map<string, RecordValue>(
		collections.flatMap((resource) =>
			relations(resource.value.relations).map(
				([key, relation]) =>
					[`${resource.identity}/relation:${key}`, relation] as const,
			),
		),
	);

	return new Map(
		collections.map((resource) => {
			const schema = schemaByIdentity.get(resource.identity);
			const schemaRelations = (schema?.relations ?? []) as readonly unknown[];
			const projected = relations(resource.value.relations).map(
				([key, relation]) => {
					const identity = `${resource.identity}/relation:${key}`;
					if (relation.kind === "toOne") {
						const owning = schemaRelations
							.map(record)
							.find((candidate) => candidate.identity === identity);
						if (!owning)
							throw new CompilerDiagnosticError(
								"QP-DATA-003",
								"invalidRelationReference",
								`${identity} has no owning Schema Relation`,
							);
						return {
							kind: "toOne",
							identity,
							target: owning.target,
							fields: owning.fields,
							references: owning.references,
						};
					}

					const inverseOf = String(relation.inverseOf);
					const owning = owningRelations.get(inverseOf);
					if (!relationMembers.has(inverseOf))
						throw new CompilerDiagnosticError(
							"QP-COMPOSE-004",
							"unresolvedReference",
							`${identity} references missing ${inverseOf}`,
						);
					if (!owning)
						throw new CompilerDiagnosticError(
							"QP-DATA-003",
							"invalidRelationReference",
							`${inverseOf} is not an owning toOne Relation`,
						);
					if (owning.target !== resource.identity)
						throw new CompilerDiagnosticError(
							"QP-DATA-003",
							"invalidRelationReference",
							`${inverseOf} does not target ${resource.identity}`,
						);
					return {
						kind: "toMany",
						identity,
						inverseOf,
						target: inverseOf.slice(0, inverseOf.lastIndexOf("/relation:")),
					};
				},
			);
			return [resource.identity, projected] as const;
		}),
	);
}
