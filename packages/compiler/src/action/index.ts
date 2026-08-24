import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import { normalizeDeclaredErrors } from "../operation-errors";
import { renderCodecType } from "../runtime";
import { renderServerOperationType } from "../server-operation-map";
import type { NormalizedResource } from "../types";

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

function exactKeys(
	value: RecordValue,
	expected: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort(compareAscii);
	const sortedExpected = [...expected].sort(compareAscii);
	if (
		actual.length !== sortedExpected.length ||
		actual.some((key, index) => key !== sortedExpected[index])
	)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			`${label} must contain exactly ${sortedExpected.join(", ")}`,
		);
}

export function normalizeActionContract(
	value: RecordValue,
	normalizeCodec: (value: unknown) => unknown,
): RecordValue {
	exactKeys(
		value,
		[
			"__questpie",
			"errors",
			"executableSlots",
			"input",
			"limits",
			"name",
			"network",
			"output",
			"policy",
		],
		"Action Definition",
	);
	if (
		!Array.isArray(value.executableSlots) ||
		value.executableSlots.length !== 1 ||
		value.executableSlots[0] !== "handler"
	)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"Action executable slots must contain exactly handler",
		);
	if (typeof value.network !== "boolean")
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"Action network exposure must be boolean",
		);
	const policy = record(value.policy, "Action policy");
	const admission = string(policy.operator, "Action policy operator");
	if (
		policy.kind !== "booleanExpression" ||
		!Array.isArray(policy.operands) ||
		policy.operands.length !== 0 ||
		(admission !== "authenticated" && admission !== "public")
	)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"Action policy must be policy.authenticated() or policy.public()",
		);
	const limits = record(value.limits, "Action limits");
	exactKeys(
		limits,
		["durationMilliseconds", "inputBytes", "resultBytes"],
		"Action limits",
	);
	for (const key of ["inputBytes", "resultBytes"] as const)
		if (!Number.isSafeInteger(limits[key]) || Number(limits[key]) <= 0)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				`Action limits.${key} must be a positive safe integer`,
			);
	if (
		!Number.isSafeInteger(limits.durationMilliseconds) ||
		Number(limits.durationMilliseconds) < 0
	)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"Action limits.durationMilliseconds must be a nonnegative safe integer",
		);
	return {
		format: "questpie.action-definition-contract",
		version: 1,
		name: string(value.name, "Action name"),
		input: normalizeCodec(value.input),
		output: normalizeCodec(value.output),
		admission,
		declaredErrors: normalizeDeclaredErrors(
			value.errors,
			"action",
			normalizeCodec,
		),
		limits: {
			inputBytes: limits.inputBytes,
			resultBytes: limits.resultBytes,
			durationMilliseconds: limits.durationMilliseconds,
		},
		exposure: value.network ? "network" : "server",
		executableSlots: ["handler"],
	};
}

function actions(resources: readonly NormalizedResource[]) {
	return resources.filter((resource) => resource.kind === "action");
}

export function actionServiceResources(
	resources: readonly NormalizedResource[],
): readonly NormalizedResource[] {
	const services = resources.filter((resource) => resource.kind === "service");
	const byIdentity = new Map(
		services.map((service) => [service.identity, service]),
	);
	const eligible = (service: NormalizedResource): boolean => {
		const pending = [service];
		const seen = new Set<string>();
		while (pending.length > 0) {
			const member = pending.pop();
			if (!member || seen.has(member.identity)) continue;
			seen.add(member.identity);
			if (member.contract.lifetime !== "execution") return false;
			for (const dependency of member.contract
				.dependencies as readonly Readonly<{ identity: string }>[]) {
				const target = byIdentity.get(dependency.identity);
				if (!target) return false;
				pending.push(target);
			}
		}
		return true;
	};
	return services.filter(
		(service) =>
			service.origin.packageId === null &&
			service.contract.effect === "external" &&
			eligible(service),
	);
}

export function executionServiceResources(
	resources: readonly NormalizedResource[],
): readonly NormalizedResource[] {
	const actionServices = new Set(
		actionServiceResources(resources).map((service) => service.identity),
	);
	return resources.filter(
		(resource) =>
			resource.kind === "service" &&
			resource.origin.packageId === null &&
			!actionServices.has(resource.identity),
	);
}

export function renderActionDeclarations(
	resources: readonly NormalizedResource[],
): string {
	const definitions = actions(resources)
		.map((resource) => {
			const contract = resource.contract;
			return `${JSON.stringify(resource.name)}: Readonly<{ input: ${renderCodecType(contract.input)}; output: ${renderCodecType(contract.output)}; handlerOutput: ${renderCodecType(contract.output)}; }>;`;
		})
		.join("\n\t");
	const operations = renderServerOperationType(
		"Action",
		actions(resources).map((resource) => ({
			name: resource.name,
			origin: resource.origin,
			value: `(input: ${renderCodecType(resource.contract.input)}, options: Readonly<{ readonly effectKey: string; readonly callId?: string; readonly timeoutMilliseconds?: number }>) => Promise<${renderCodecType(resource.contract.output)}>`,
		})),
	);
	return `export interface GeneratedActions {
	${definitions}
}

export type GeneratedActionOperations = ${operations};

export type ActionLimits = Readonly<{
	readonly inputBytes: number;
	readonly resultBytes: number;
	readonly durationMilliseconds: number;
}>;

export type ActionDefinition<Name extends keyof GeneratedActions, Errors extends OperationErrorMap> = Readonly<{
	readonly kind: "action";
	readonly identity: \`action:\${Name & string}\`;
	readonly name: Name;
	readonly network: boolean;
	readonly input: Codec<GeneratedActions[Name]["input"]>;
	readonly output: Codec<GeneratedActions[Name]["output"]>;
	readonly policy: object;
	readonly errors: Errors;
	readonly limits: ActionLimits;
	readonly handler: (input: Readonly<{
		input: GeneratedActions[Name]["input"];
		ctx: ActionContext;
		effect: Readonly<{ readonly id: string }>;
		errors: OperationErrorFactories<Errors>;
	}>) => GeneratedActions[Name]["handlerOutput"] | Promise<GeneratedActions[Name]["handlerOutput"]>;
}>;

export type ActionFactory = <const Name extends keyof GeneratedActions, const Errors extends OperationErrorMap>(
	definition: Readonly<{
		name: Name;
		network?: boolean;
		input: Codec<GeneratedActions[Name]["input"]>;
		output: Codec<GeneratedActions[Name]["output"]>;
		policy: object;
		errors: Errors;
		limits: ActionLimits;
		handler(input: Readonly<{
			input: GeneratedActions[Name]["input"];
			ctx: ActionContext;
			effect: Readonly<{ readonly id: string }>;
			errors: OperationErrorFactories<Errors>;
		}>): GeneratedActions[Name]["handlerOutput"] | Promise<GeneratedActions[Name]["handlerOutput"]>;
	}>,
) => ActionDefinition<Name, Errors>;`;
}

export function renderActionFactory(): string {
	return `export const defineAction: ActionFactory = ((definition) => Object.freeze({
	...definition,
	kind: "action" as const,
	identity: \`action:\${definition.name}\` as const,
	network: Object.hasOwn(definition, "network") ? definition.network : false,
})) as ActionFactory;`;
}
