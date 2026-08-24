import { canonicalBytes, compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { NormalizedResource } from "../types";

export { explainExecutionComposition } from "./explain";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			`${label} must be an object`,
		);
	return value as RecordValue;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string")
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			`${label} must be a string`,
		);
	return value;
}

function serviceIdentity(value: unknown): `service:${string}` {
	const dependency = record(value, "Service dependency");
	return `service:${string(dependency.name, "Service dependency name")}`;
}

export function compositionContract(
	kind: string,
	value: RecordValue,
): RecordValue {
	if (kind === "service") {
		const lifetime = string(value.lifetime, "Service lifetime");
		const effect = string(value.effect, "Service effect");
		if (lifetime !== "application" && lifetime !== "execution")
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				"Service lifetime must be application or execution",
			);
		if (effect !== "read" && effect !== "external")
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				"Service effect must be read or external",
			);
		const dependencies = Object.entries(
			record(value.dependencies, "Service dependencies"),
		)
			.map(([key, dependency]) => ({
				key,
				identity: serviceIdentity(dependency),
			}))
			.sort((left, right) => compareAscii(left.key, right.key));
		return {
			format: "questpie.service-definition-contract",
			version: 1,
			name: string(value.name, "Service name"),
			lifetime,
			effect,
			dependencies,
			executableSlots: value.executableSlots,
		};
	}
	if (kind === "context")
		return {
			format: "questpie.context-definition-contract",
			version: 1,
			name: string(value.name, "Context name"),
			input: record(value.input, "Context input codec"),
			executableSlots: value.executableSlots,
		};
	if (kind === "credentialResolver") {
		const service = record(value.service, "Credential resolver Service");
		const serviceBrand = record(
			service["__questpie"],
			"Credential resolver Service brand",
		);
		if (
			serviceBrand.resourceKind !== "service" ||
			service.lifetime !== "application" ||
			service.effect !== "external"
		)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				"Credential resolver requires one application external Service",
			);
		return {
			format: "questpie.credential-resolver-definition-contract",
			version: 1,
			name: string(value.name, "Credential resolver name"),
			service: serviceIdentity(service),
			executableSlots: ["resolve"],
		};
	}
	if (kind === "route") {
		const method = string(value.method, "Route method");
		if (
			!["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"].includes(
				method,
			)
		)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				"Route method is invalid",
			);
		const path = string(value.path, "Route path");
		if (!path.startsWith("/") || path.includes("?") || path.includes("#"))
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				"Route path must be an absolute pathname",
			);
		const credentials = string(value.credentials, "Route credentials");
		if (credentials !== "application" && credentials !== "none")
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				"Route credentials must be application or none",
			);
		const policy = record(value.policy, "Route policy");
		const admission = string(policy.operator, "Route policy operator");
		if (
			policy.kind !== "booleanExpression" ||
			!Array.isArray(policy.operands) ||
			policy.operands.length !== 0 ||
			(admission !== "authenticated" && admission !== "public")
		)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				"Route policy must be policy.authenticated() or policy.public()",
			);
		const limits = record(value.limits, "Route limits");
		for (const key of ["bodyBytes", "durationMs"])
			if (!Number.isSafeInteger(limits[key]) || Number(limits[key]) < 0)
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-013",
					"structuralTypeError",
					`Route limits.${key} must be a nonnegative safe integer`,
				);
		return {
			format: "questpie.route-definition-contract",
			version: 1,
			name: string(value.name, "Route name"),
			method,
			path,
			credentials,
			admission,
			limits: {
				bodyBytes: limits.bodyBytes,
				durationMs: limits.durationMs,
			},
			executableSlots: ["handler"],
		};
	}
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-013",
		"structuralTypeError",
		`${kind} is outside the composition contract`,
	);
}

function validateServiceGraph(resources: readonly NormalizedResource[]): void {
	const services = resources.filter((resource) => resource.kind === "service");
	const byIdentity = new Map(
		services.map((service) => [service.identity, service]),
	);
	for (const service of services) {
		const dependencies = service.contract.dependencies as readonly Readonly<{
			key: string;
			identity: string;
		}>[];
		for (const dependency of dependencies) {
			const target = byIdentity.get(dependency.identity);
			if (!target)
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-004",
					"unknownReference",
					`${service.identity} references unknown ${dependency.identity}`,
				);
			if (
				service.contract.lifetime === "application" &&
				target.contract.lifetime === "execution"
			)
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-013",
					"structuralTypeError",
					`${service.identity} application lifetime cannot depend on ${target.identity} execution lifetime`,
				);
			if (
				service.contract.effect === "read" &&
				target.contract.effect === "external"
			)
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-013",
					"structuralTypeError",
					`${service.identity} read effect cannot depend on ${target.identity} external effect`,
				);
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (identity: string): void => {
		if (visited.has(identity)) return;
		if (visiting.has(identity))
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				`Service dependency cycle includes ${identity}`,
			);
		visiting.add(identity);
		const resource = byIdentity.get(identity);
		for (const dependency of (resource?.contract.dependencies ??
			[]) as readonly Readonly<{
			identity: string;
		}>[])
			visit(dependency.identity);
		visiting.delete(identity);
		visited.add(identity);
	};
	for (const identity of [...byIdentity.keys()].sort(compareAscii))
		visit(identity);
}

function validateRouteComposition(
	resources: readonly NormalizedResource[],
): void {
	const resolvers = resources.filter(
		(resource) => resource.kind === "credentialResolver",
	);
	if (resolvers.length > 1)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"an Application may define at most one credential resolver",
		);
	const services = new Map(
		resources
			.filter((resource) => resource.kind === "service")
			.map((resource) => [resource.identity, resource]),
	);
	for (const resolver of resolvers) {
		const service = services.get(String(resolver.contract.service));
		if (
			!service ||
			service.contract.lifetime !== "application" ||
			service.contract.effect !== "external"
		)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-004",
				"unknownReference",
				`${resolver.identity} requires application external ${String(resolver.contract.service)}`,
			);
	}
	const mounts = new Map<string, NormalizedResource>();
	for (const route of resources.filter(
		(resource) => resource.kind === "route",
	)) {
		const mount = `${route.contract.method} ${route.contract.path}`;
		const prior = mounts.get(mount);
		if (prior)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-002",
				"duplicateResourceIdentity",
				`${mount} is owned by both ${prior.identity} and ${route.identity}`,
				{ origins: [prior.origin, route.origin] },
			);
		mounts.set(mount, route);
	}
}

export function projectExecutionComposition(
	resources: readonly NormalizedResource[],
): Readonly<{
	services: RecordValue;
	context: RecordValue;
}> {
	validateServiceGraph(resources);
	validateRouteComposition(resources);
	const contexts = resources.filter((resource) => resource.kind === "context");
	if (contexts.length > 1)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"an Application may define at most one Context",
		);
	const serviceProjection = {
		format: "questpie.service-projection",
		version: 1,
		services: resources
			.filter((resource) => resource.kind === "service")
			.map((resource) => ({
				identity: resource.identity,
				owner: resource.origin.packageId
					? { kind: "package", packageId: resource.origin.packageId }
					: { kind: "application" },
				lifetime: resource.contract.lifetime,
				effect: resource.contract.effect,
				dependencies: (
					resource.contract.dependencies as readonly Readonly<{
						identity: string;
					}>[]
				).map((dependency) => dependency.identity),
				executableSlots: resource.contract.executableSlots,
			})),
	};
	const contextResource = contexts[0];
	const contextProjection = {
		format: "questpie.context-projection",
		version: 1,
		context: contextResource
			? {
					identity: contextResource.identity,
					owner: { kind: "application" },
					input: contextResource.contract.input,
					immutable: true,
					resolution: {
						frequency: "oncePerRootExecution",
						concurrentConsumers: "coalesced",
						failureOrder: "beforePolicyAndHandler",
						nested: "inheritExactResolvedContext",
						services: "executionScopedSeparateLifetime",
					},
				}
			: null,
	};
	canonicalBytes(serviceProjection);
	canonicalBytes(contextProjection);
	return { services: serviceProjection, context: contextProjection };
}
