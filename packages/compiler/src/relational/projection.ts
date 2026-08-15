import { compareAscii, digest } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { EvaluatedExport, NormalizedResource } from "../types";
import { normalizeBoundPolicy } from "./binding";
import { projectRelationalGeneratedContract } from "./generated-contract";
import { selectDefaultPolicy } from "./normalize-policy";
import { normalizeDataQueryTemplate } from "./normalize-query";

type ProjectionOrigin = Readonly<{
	packageId: string | null;
	path: string;
	exportName: string;
	span: EvaluatedExport["span"];
}>;

export function projectRelationalCompilation(
	input: Readonly<{
		exports: readonly EvaluatedExport[];
		resources: readonly NormalizedResource[];
		schema: unknown;
		data: unknown;
	}>,
): Readonly<{
	policy: Readonly<Record<string, unknown>>;
	query: Readonly<Record<string, unknown>>;
	explain: Readonly<Record<string, unknown>>;
	declarations: import("./generated-contract").RelationalGeneratedContractV1;
	structuralOrigins: readonly Readonly<Record<string, unknown>>[];
	hasRelationalArtifacts: boolean;
}> {
	const collections = new Set(
		input.resources
			.filter((resource) => resource.kind === "collection")
			.map((resource) => resource.identity),
	);
	const policies = input.resources
		.filter((resource) => resource.kind === "policy")
		.map((resource) => {
			const bound = normalizeBoundPolicy(resource.value);
			for (const scope of bound.scopes)
				if (!collections.has(scope.collection))
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-013",
						"structuralTypeError",
						`Policy ${resource.identity} references unknown ${scope.collection}`,
					);
			return {
				program: bound.program,
				scopeBindings: bound.scopes,
				origin: {
					packageId: resource.origin.packageId,
					path: resource.origin.logicalPath,
					exportName: resource.origin.exportName,
					span: resource.origin.span,
				},
			};
		});
	const digests = {
		schemaProjectionDigest: digest(
			"questpie-schema-projection-v1",
			input.schema,
		),
		dataContractProjectionDigest: digest(
			"questpie-data-contract-projection-v1",
			input.data,
		),
	};
	const queries = input.exports
		.filter(
			(item) =>
				item.value.kind === "dataQuery" &&
				item.value["__questpie"] === undefined,
		)
		.map((item) => {
			const template = normalizeDataQueryTemplate(
				item.value.templateInput,
				digests,
			);
			if (!collections.has(template.from))
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-013",
					"structuralTypeError",
					`dataQuery references unknown ${template.from}`,
				);
			const selectedPolicy = selectDefaultPolicy(
				template.from,
				policies.map(({ program }) => program),
			);
			const origin: ProjectionOrigin = {
				packageId: item.packageId,
				path: item.logicalPath,
				exportName: item.exportName,
				span: item.span,
			};
			return {
				digest: digest("questpie-data-query-template-v1", template),
				policy: selectedPolicy.identity,
				template,
				origin,
			};
		})
		.sort((left, right) =>
			compareAscii(
				`${left.origin.path}\0${left.origin.exportName}`,
				`${right.origin.path}\0${right.origin.exportName}`,
			),
		);
	const structuralOrigins = queries.map((query) => ({
		kind: "dataQuery",
		digest: query.digest,
		establishedAt: { kind: "export", ...query.origin },
	}));
	return {
		declarations: projectRelationalGeneratedContract({
			policies: policies.map(({ program }) => program),
			queries: queries.map(({ policy, origin, template }) => ({
				policy,
				origin,
				select: template.select,
			})),
		}),
		policy: {
			format: "questpie.policy-projection",
			version: 1,
			policies,
		},
		query: {
			format: "questpie.query-projection",
			version: 1,
			queries,
		},
		explain: {
			format: "questpie.relational-explain",
			version: 1,
			policies: policies.map(({ program, scopeBindings, origin }) => ({
				identity: program.identity,
				target: program.target,
				scopeBindings,
				origin,
			})),
			dataQueries: structuralOrigins,
		},
		structuralOrigins,
		hasRelationalArtifacts: policies.length > 0 || queries.length > 0,
	};
}
