import type {
	FieldIdentity,
	PolicyIdentity,
	PolicyProgramV1,
	RootQuerySelectionV1,
} from "./types";

export type RelationalGeneratedSelectionV1 =
	| Readonly<{
			kind: "field";
			key: string;
			field: FieldIdentity;
			optional: boolean;
	  }>
	| Readonly<{
			kind: "toOne";
			key: string;
			select: readonly Readonly<{
				kind: "field";
				key: string;
				field: FieldIdentity;
				optional: false;
			}>[];
	  }>;

export interface RelationalGeneratedContractV1 {
	readonly queries: readonly Readonly<{
		origin: Readonly<{ path: string; exportName: string }>;
		select: readonly RelationalGeneratedSelectionV1[];
	}>[];
}

function fieldPath(identity: FieldIdentity): string {
	return identity.slice(identity.indexOf("/field:") + 7);
}

export function projectRelationalGeneratedContract(
	input: Readonly<{
		policies: readonly PolicyProgramV1[];
		queries: readonly Readonly<{
			policy: PolicyIdentity;
			origin: Readonly<{ path: string; exportName: string }>;
			select: readonly RootQuerySelectionV1[];
		}>[];
	}>,
): RelationalGeneratedContractV1 {
	const policies = new Map(
		input.policies.map((program) => [program.identity, program] as const),
	);
	return Object.freeze({
		queries: Object.freeze(
			input.queries.map((query) => {
				const optionalPaths = new Set(
					policies
						.get(query.policy)
						?.fields?.selectedOutput.map((rule) => rule.path.join("/")) ?? [],
				);
				return Object.freeze({
					origin: Object.freeze({
						path: query.origin.path,
						exportName: query.origin.exportName,
					}),
					select: Object.freeze(
						query.select.map((selection): RelationalGeneratedSelectionV1 => {
							if (selection.kind === "field")
								return Object.freeze({
									kind: "field",
									key: selection.key,
									field: selection.field,
									optional: optionalPaths.has(fieldPath(selection.field)),
								});
							return Object.freeze({
								kind: "toOne",
								key: selection.key,
								select: Object.freeze(
									selection.select.map((field) =>
										Object.freeze({
											kind: "field" as const,
											key: field.key,
											field: field.field,
											optional: false as const,
										}),
									),
								),
							});
						}),
					),
				});
			}),
		),
	});
}
