import { CompilerDiagnosticError } from "../diagnostic";
import type { EvaluatedExport, NormalizedResource, SourceSpan } from "../types";

export {
	projectOperationProjection,
	projectOperationJsDoc,
	projectOperationCodecSchema,
	type OperationProjection,
	type OperationProjectionInput,
} from "./operation-projection";
export {
	projectOperationDocumentationEntries,
	type DocumentationEntry,
} from "./operation-metadata";

type RecordValue = Readonly<Record<string, unknown>>;

type RouteSegment =
	| Readonly<{ kind: "literal"; value: string }>
	| Readonly<{ kind: "parameter" }>
	| Readonly<{ kind: "wildcard" }>;

function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as RecordValue;
}

function staticallyBounded(codecValue: unknown): boolean {
	const codec = record(codecValue);
	if (codec.kind === "optional" || codec.kind === "nullable")
		return staticallyBounded(codec.codec);
	if (codec.kind === "text") return codec.maxLength !== undefined;
	if (codec.kind === "array")
		return codec.maximum !== undefined && staticallyBounded(codec.items);
	if (codec.kind === "object")
		return Object.values(record(codec.properties)).every(staticallyBounded);
	return codec.kind !== "json";
}

function routeSegments(path: string): readonly RouteSegment[] {
	if (path === "/") return [];
	return path
		.slice(1)
		.split("/")
		.map((segment) =>
			segment.startsWith(":")
				? { kind: "parameter" as const }
				: segment.startsWith("*")
					? { kind: "wildcard" as const }
					: { kind: "literal" as const, value: segment },
		);
}

function routeIntersection(
	routePath: string,
	canonicalPath: string,
):
	| "ambiguousParameterCollision"
	| "exactPathCollision"
	| "rawWildcardIntersection"
	| null {
	const route = routeSegments(routePath);
	const canonical = routeSegments(canonicalPath);
	const wildcard = route.findIndex(({ kind }) => kind === "wildcard");
	const compared = wildcard < 0 ? route.length : wildcard;
	for (let index = 0; index < compared; index += 1) {
		const left = route[index];
		const right = canonical[index];
		if (
			!left ||
			!right ||
			(left.kind === "literal" &&
				right.kind === "literal" &&
				left.value !== right.value)
		)
			return null;
	}
	if (wildcard >= 0)
		return canonical.length >= wildcard ? "rawWildcardIntersection" : null;
	if (route.length !== canonical.length) return null;
	return route.some(({ kind }) => kind === "parameter")
		? "ambiguousParameterCollision"
		: "exactPathCollision";
}

function originDetails(source: EvaluatedExport, span: SourceSpan | undefined) {
	return {
		origin: {
			module: source.logicalPath,
			line: span?.start.line ?? source.span?.start.line ?? 1,
			column: span?.start.column ?? source.span?.start.column ?? 1,
		},
	};
}

export function validateOperationHttpAuthoring(
	value: RecordValue,
	source?: EvaluatedExport,
): void {
	if (!Object.hasOwn(value, "http")) return;
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-028",
		"invalidHttpProjection",
		"Operations cannot author an HTTP method or path",
		{
			reason: "unexpectedHttpMember",
			rewrite:
				"remove http; method and path derive from Operation kind and name",
			...(source ? originDetails(source, source.memberSpans.http) : {}),
		},
	);
}

export function validateCanonicalHttpProjection(
	resources: readonly NormalizedResource[],
): void {
	for (const resource of resources) {
		if (resource.kind === "query" && resource.contract.exposure === "network") {
			const codec = record(resource.contract.input);
			if (codec.kind !== "object" || !staticallyBounded(codec))
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-028",
					"invalidHttpProjection",
					`${resource.identity} cannot use canonical GET encoding`,
					{
						reason: "queryHttpEncodingUnsupported",
						rewrite:
							"use one object input with bounded text/arrays and no arbitrary JSON branch",
						origins: [resource.origin],
					},
				);
		}
		if (
			(resource.kind !== "query" &&
				resource.kind !== "mutation" &&
				resource.kind !== "action") ||
			resource.contract.exposure !== "network"
		)
			continue;
		const method = resource.kind === "query" ? "GET" : "POST";
		const canonicalPath = `/_questpie/${resource.kind}/${resource.name}`;
		for (const route of resources.filter(
			(candidate) =>
				candidate.kind === "route" && candidate.contract.method === method,
		)) {
			const reason = routeIntersection(
				String(route.contract.path),
				canonicalPath,
			);
			if (!reason) continue;
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-029",
				"httpProjectionCollision",
				`${resource.identity} canonical endpoint collides with ${route.identity}`,
				{
					reason,
					rewrite: "move or narrow the raw Route; no precedence is selected",
					origins: [resource.origin, route.origin],
				},
			);
		}
	}
}
