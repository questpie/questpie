import {
	principal,
	type ServiceDefinition,
	type ServiceDependencyMap,
	type ServiceInstance,
} from "questpie";

import { canonicalJsonLine, CanonicalJsonError } from "../canonical-json";
import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	type RuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import {
	type ExecutionFacts,
	isRuntimeExecutionFacts,
	isRuntimeExecutionScope,
	type RuntimeExecutionScope,
} from "../execution";
import {
	assertOperationAdmission,
	DeclaredOperationError,
	isOperationCallId,
	OperationFailure,
	type OperationAdmission,
	type RuntimeDeclaredErrorContract,
} from "../operation";
import {
	actionMonotonicNow,
	createActionControl,
	type RuntimeActionClock,
	type RuntimeActionLimits,
	validActionLimits,
} from "./control";
import { deriveOrdinaryEffectIdentity, resourceIdentity } from "./identity";

type MaybePromise<Value> = Value | Promise<Value>;

type ActionExecutionFacts = ExecutionFacts<
	Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
>;

type ActionExecutionScope = RuntimeExecutionScope<
	Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
>;

type ExternalEffectService = ServiceDefinition<
	string,
	"execution",
	"external",
	ServiceDependencyMap,
	unknown
>;

export type RuntimeActionProjectionScope = ActionExecutionFacts &
	Readonly<{
		facts: ActionExecutionFacts;
		service<Definition extends ExternalEffectService>(
			definition: Definition,
		): Promise<ServiceInstance<Definition>>;
	}>;

export type RuntimeActionBinding<Context> = Readonly<{
	identity: `action:${string}`;
	admission: OperationAdmission;
	limits: RuntimeActionLimits;
	input: RuntimeCodec;
	output: RuntimeCodec;
	declaredErrors: readonly RuntimeDeclaredErrorContract[];
	execute(
		input: Readonly<{
			input: unknown;
			ctx: Context;
			effect: Readonly<{ id: string }>;
			errors: Readonly<
				Record<string, (payload?: unknown) => DeclaredOperationError>
			>;
		}>,
	): unknown | Promise<unknown>;
}>;

export interface RuntimeActionExecutor {
	invoke(
		identity: string,
		invocation: Readonly<{
			callId?: string;
			input: unknown;
			effectKey: string;
			scope: ActionExecutionScope;
			timeoutMilliseconds?: number;
		}>,
	): Promise<unknown>;
}

export class RuntimeActionPostHandlerResourceLimit extends OperationFailure {
	readonly phase = "postHandler";
	readonly provesProviderNonacceptance = false;
	readonly replayAuthorized = false;

	constructor() {
		super("RESOURCE_LIMIT", false);
		this.name = "RuntimeActionPostHandlerResourceLimit";
	}
}

function decodeInput(codec: RuntimeCodec, value: unknown): unknown {
	try {
		return decodeRuntimeCodec(codec, value, "$action.input");
	} catch (error) {
		if (error instanceof RuntimeCodecError)
			throw new OperationFailure("PROTOCOL_UNSUPPORTED");
		throw error;
	}
}

function decodeOutput(codec: RuntimeCodec, value: unknown): unknown {
	try {
		return decodeRuntimeCodec(codec, value, "$action.output");
	} catch (error) {
		if (error instanceof RuntimeCodecError)
			throw new OperationFailure("INTERNAL");
		throw error;
	}
}

function encodedValue(
	codec: RuntimeCodec,
	value: unknown,
	path: string,
	failure: "INTERNAL" | "PROTOCOL_UNSUPPORTED",
): unknown {
	try {
		return encodeRuntimeCodec(codec, value, path);
	} catch (error) {
		if (error instanceof RuntimeCodecError) throw new OperationFailure(failure);
		throw error;
	}
}

function semanticBytes(
	value: unknown,
	failure: "INTERNAL" | "PROTOCOL_UNSUPPORTED",
): number {
	try {
		return canonicalJsonLine(value).byteLength;
	} catch (error) {
		if (error instanceof CanonicalJsonError)
			throw new OperationFailure(failure);
		throw error;
	}
}

function enforceInputBytes(
	binding: RuntimeActionBinding<unknown>,
	encoded: unknown,
): void {
	if (
		semanticBytes(encoded, "PROTOCOL_UNSUPPORTED") > binding.limits.inputBytes
	)
		throw new OperationFailure("RESOURCE_LIMIT");
}

function enforceResultBytes(
	binding: RuntimeActionBinding<unknown>,
	encoded: unknown,
): void {
	if (semanticBytes(encoded, "INTERNAL") > binding.limits.resultBytes)
		throw new RuntimeActionPostHandlerResourceLimit();
}

function errorFactories(
	contracts: readonly RuntimeDeclaredErrorContract[],
): Readonly<Record<string, (payload?: unknown) => DeclaredOperationError>> {
	return Object.freeze(
		Object.fromEntries(
			contracts.map((contract) => [
				contract.key,
				(payload: unknown = null) =>
					new DeclaredOperationError(contract.code, contract.status, payload),
			]),
		),
	);
}

function validateDeclaredError(
	binding: RuntimeActionBinding<unknown>,
	error: DeclaredOperationError,
): void {
	const contract = binding.declaredErrors.find(
		(candidate) =>
			candidate.code === error.code && candidate.status === error.status,
	);
	if (!contract) throw new OperationFailure("INTERNAL");
	try {
		if (contract.payload === null) {
			if (error.payload !== null) throw new OperationFailure("INTERNAL");
			enforceResultBytes(binding, null);
			return;
		}
		const encoded = encodeRuntimeCodec(
			contract.payload,
			error.payload,
			`$declaredError.${contract.key}.payload`,
		);
		enforceResultBytes(binding, encoded);
	} catch (caught) {
		if (caught instanceof OperationFailure) throw caught;
		if (caught instanceof RuntimeCodecError)
			throw new OperationFailure("INTERNAL");
		throw caught;
	}
}

function validBindingInventory<Context>(
	bindings: readonly RuntimeActionBinding<Context>[],
): boolean {
	return (
		new Set(bindings.map(({ identity }) => identity)).size ===
			bindings.length &&
		bindings.every(
			(binding) =>
				resourceIdentity(binding.identity, "action").length >
					"action:".length &&
				validActionLimits(binding.limits) &&
				new Set(binding.declaredErrors.map(({ key }) => key)).size ===
					binding.declaredErrors.length &&
				new Set(binding.declaredErrors.map(({ code }) => code)).size ===
					binding.declaredErrors.length,
		)
	);
}

export function createRuntimeActionExecutor<Context>(
	input: Readonly<{
		application: `application:${string}`;
		bindings: readonly RuntimeActionBinding<Context>[];
		clock?: RuntimeActionClock;
		project(scope: RuntimeActionProjectionScope): MaybePromise<Context>;
	}>,
): RuntimeActionExecutor {
	const application = resourceIdentity(input.application, "application");
	const clock: RuntimeActionClock =
		input.clock ??
		Object.freeze({
			cancel: (timer: unknown) =>
				clearTimeout(timer as ReturnType<typeof setTimeout>),
			monotonicNow: performance.now.bind(performance),
			rootRemainingMilliseconds: (facts: ActionExecutionFacts) =>
				facts.deadline === null
					? null
					: Math.max(0, facts.deadline - Date.now()),
			schedule: (callback: () => void, delayMilliseconds: number) =>
				setTimeout(callback, delayMilliseconds),
		});
	if (!validBindingInventory(input.bindings))
		throw new TypeError("Runtime Action binding inventory is invalid");
	const bindings = new Map(
		input.bindings.map((binding) => [binding.identity, Object.freeze(binding)]),
	);

	return Object.freeze({
		invoke: async (
			identity: string,
			invocation: Readonly<{
				callId?: string;
				input: unknown;
				effectKey: string;
				scope: ActionExecutionScope;
				timeoutMilliseconds?: number;
			}>,
		) => {
			const binding = bindings.get(identity as `action:${string}`);
			if (!binding) throw new OperationFailure("NOT_FOUND");
			const executionScope = invocation.scope;
			const facts = executionScope.facts;
			if (
				!isRuntimeExecutionScope(executionScope) ||
				!isRuntimeExecutionFacts(facts) ||
				!principal.is(facts.principal)
			)
				throw new OperationFailure("INTERNAL");
			let startedAt = 0;
			let clockFailure: OperationFailure | undefined;
			try {
				startedAt = actionMonotonicNow(clock);
			} catch (error) {
				clockFailure =
					error instanceof OperationFailure
						? error
						: new OperationFailure("INTERNAL");
			}
			assertOperationAdmission(binding.admission, facts);
			const invocationKeys = Object.keys(invocation).sort();
			if (
				invocationKeys.length < 3 ||
				invocationKeys.length > 5 ||
				!invocationKeys.includes("effectKey") ||
				!invocationKeys.includes("input") ||
				!invocationKeys.includes("scope") ||
				invocationKeys.some(
					(key) =>
						!(
							[
								"callId",
								"effectKey",
								"input",
								"scope",
								"timeoutMilliseconds",
							] as const
						).includes(key as never),
				) ||
				(invocation.callId !== undefined &&
					!isOperationCallId(invocation.callId)) ||
				(invocation.timeoutMilliseconds !== undefined &&
					(!Number.isSafeInteger(invocation.timeoutMilliseconds) ||
						invocation.timeoutMilliseconds <= 0))
			)
				throw new OperationFailure("PROTOCOL_UNSUPPORTED");
			if (clockFailure) throw clockFailure;
			const control = createActionControl(
				facts,
				Math.min(
					binding.limits.durationMilliseconds,
					invocation.timeoutMilliseconds ?? Number.MAX_SAFE_INTEGER,
				),
				startedAt,
				clock,
			);
			try {
				control.throwIfExpired();
				let effectIdentity: string;
				try {
					effectIdentity = deriveOrdinaryEffectIdentity(
						application,
						binding.identity,
						facts,
						invocation.effectKey,
					);
				} catch (error) {
					if (error instanceof OperationFailure) throw error;
					throw new OperationFailure("INTERNAL");
				}
				const decodedInput = decodeInput(binding.input, invocation.input);
				const encodedInput = encodedValue(
					binding.input,
					decodedInput,
					"$action.input",
					"PROTOCOL_UNSUPPORTED",
				);
				enforceInputBytes(binding, encodedInput);
				control.throwIfExpired();
				const actionFacts = Object.freeze({
					...facts,
					signal: control.signal,
					deadline: facts.deadline,
				}) as ActionExecutionFacts;
				const execute = async (
					child: Readonly<{
						signal: AbortSignal;
						executionService<Definition extends ExternalEffectService>(
							definition: Definition,
						): Promise<ServiceInstance<Definition>>;
					}>,
				): Promise<unknown> => {
					let context: Context;
					try {
						context = await input.project(
							Object.freeze({
								...actionFacts,
								facts: actionFacts,
								service: <Definition extends ExternalEffectService>(
									definition: Definition,
								) => {
									if (
										definition.effect !== "external" ||
										definition.lifetime !== "execution"
									)
										return Promise.reject(new OperationFailure("INTERNAL"));
									return child.executionService(definition);
								},
							}),
						);
					} catch (error) {
						if (control.signal.aborted && error === control.signal.reason)
							throw error;
						throw new OperationFailure("INTERNAL");
					}
					control.throwIfExpired();
					let raw: unknown;
					try {
						raw = await binding.execute({
							input: decodedInput,
							ctx: context,
							effect: Object.freeze({ id: effectIdentity }),
							errors: errorFactories(binding.declaredErrors),
						});
					} catch (error) {
						if (error instanceof DeclaredOperationError) {
							validateDeclaredError(binding, error);
							throw error;
						}
						if (control.signal.aborted && error === control.signal.reason)
							throw error;
						throw new OperationFailure("INTERNAL");
					}
					const result = decodeOutput(binding.output, raw);
					const encoded = encodedValue(
						binding.output,
						result,
						"$action.output",
						"INTERNAL",
					);
					enforceResultBytes(binding, encoded);
					return result;
				};

				return await executionScope.child(
					{
						detachedTerminalCleanup: true,
						signal: control.signal,
						settledUseWinsAbort: true,
					},
					execute,
				);
			} finally {
				control.close();
			}
		},
	});
}
