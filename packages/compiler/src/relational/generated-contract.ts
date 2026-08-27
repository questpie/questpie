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
			select: readonly RelationalGeneratedSelectionV1[];
	  }>;

export interface RelationalGeneratedContractV1 {
	readonly queries: readonly Readonly<{
		identity: string | null;
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
			identity: string | null;
			policy: PolicyIdentity;
			origin: Readonly<{ path: string; exportName: string }>;
			select: readonly RootQuerySelectionV1[];
		}>[];
	}>,
): RelationalGeneratedContractV1 {
	const policies = new Map(
		input.policies.map((program) => [program.identity, program] as const),
	);
	const defaultPolicies = new Map(
		input.policies
			.filter((program) => program.attachment.kind === "default")
			.map((program) => [program.target, program] as const),
	);
	const nestedOptionalPaths = (field: FieldIdentity): ReadonlySet<string> => {
		const collection = field.slice(0, field.indexOf("/field:"));
		return new Set(
			defaultPolicies
				.get(collection as PolicyProgramV1["target"])
				?.fields?.selectedOutput.map((rule) => rule.path.join("/")) ?? [],
		);
	};
	const projectSelection = (
		selection: RootQuerySelectionV1,
		optionalPaths: ReadonlySet<string>,
		nested = false,
	): RelationalGeneratedSelectionV1 => {
		if (selection.kind === "field") {
			const paths = nested
				? nestedOptionalPaths(selection.field)
				: optionalPaths;
			return Object.freeze({
				kind: "field",
				key: selection.key,
				field: selection.field,
				optional: paths.has(fieldPath(selection.field)),
			});
		}
		return Object.freeze({
			kind: "toOne",
			key: selection.key,
			select: Object.freeze(
				selection.select.map((child) =>
					projectSelection(child, new Set(), true),
				),
			),
		});
	};
	return Object.freeze({
		queries: Object.freeze(
			input.queries.map((query) => {
				const optionalPaths = new Set(
					policies
						.get(query.policy)
						?.fields?.selectedOutput.map((rule) => rule.path.join("/")) ?? [],
				);
				return Object.freeze({
					identity: query.identity,
					origin: Object.freeze({
						path: query.origin.path,
						exportName: query.origin.exportName,
					}),
					select: Object.freeze(
						query.select.map((selection) =>
							projectSelection(selection, optionalPaths),
						),
					),
				});
			}),
		),
	});
}
