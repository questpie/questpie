import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";

type JsonRecord = Readonly<Record<string, unknown>>;

type OriginResource = Readonly<{
	identity: string;
	establishedAt: JsonRecord;
}>;

function originResources(originMap: JsonRecord): readonly OriginResource[] {
	if (!Array.isArray(originMap.resources))
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"Origin Map resources must be an array",
		);
	return originMap.resources as readonly OriginResource[];
}

export function explainExecutionComposition(
	projection: Readonly<{ services: JsonRecord; context: JsonRecord }>,
	originMap: JsonRecord,
): JsonRecord {
	const origins = new Map<string, JsonRecord>();
	for (const resource of originResources(originMap)) {
		if (origins.has(resource.identity))
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				`Origin Map contains duplicate ${resource.identity}`,
			);
		origins.set(resource.identity, resource.establishedAt);
	}
	const join = (resource: JsonRecord): JsonRecord => {
		const identity = String(resource.identity);
		const origin = origins.get(identity);
		if (!origin)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-004",
				"unknownReference",
				`${identity} has no Origin Map entry`,
			);
		return { ...resource, origin };
	};
	const services = Array.isArray(projection.services.services)
		? (projection.services.services as readonly JsonRecord[])
				.map(join)
				.sort((left, right) =>
					compareAscii(String(left.identity), String(right.identity)),
				)
		: [];
	const context = projection.context.context;
	return {
		format: "questpie.execution-composition-explain",
		version: 1,
		services,
		context:
			context && typeof context === "object"
				? join(context as JsonRecord)
				: null,
	};
}
