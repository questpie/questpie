import {
	principal,
	type ServiceDefinition,
	type ServiceDependencyMap,
	type ServiceInstance,
	type ServiceLifetime,
} from "questpie";

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
	OperationFailure,
	type OperationAdmission,
	type RuntimeDeclaredErrorContract,
} from "../operation";

type MaybePromise<Value> = Value | Promise<Value>;

type ActionExecutionFacts = ExecutionFacts<
	Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
>;

type ActionExecutionScope = RuntimeExecutionScope<
	Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
>;

type ExternalEffectService = ServiceDefinition<
	string,
	ServiceLifetime,
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

export interface RuntimeActionExecutor<Effect> {
	invoke(
		identity: string,
		invocation: Readonly<{
			input: unknown;
			effect: Effect;
		}> &
			(
				| Readonly<{ scope: ActionExecutionScope }>
				| Readonly<{ facts: ActionExecutionFacts }>
			),
	): Promise<unknown>;
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
	contracts: readonly RuntimeDeclaredErrorContract[],
	error: DeclaredOperationError,
): void {
	const contract = contracts.find(
		(candidate) =>
			candidate.code === error.code && candidate.status === error.status,
	);
	if (!contract) throw new OperationFailure("INTERNAL");
	try {
		if (contract.payload === null) {
			if (error.payload !== null) throw new OperationFailure("INTERNAL");
			return;
		}
		encodeRuntimeCodec(
			contract.payload,
			error.payload,
			`$declaredError.${contract.key}.payload`,
		);
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
				binding.identity.length > "action:".length &&
				new Set(binding.declaredErrors.map(({ key }) => key)).size ===
					binding.declaredErrors.length &&
				new Set(binding.declaredErrors.map(({ code }) => code)).size ===
					binding.declaredErrors.length,
		)
	);
}

export function createRuntimeActionExecutor<Context, Effect>(
	input: Readonly<{
		bindings: readonly RuntimeActionBinding<Context>[];
		project(scope: RuntimeActionProjectionScope): MaybePromise<Context>;
		readEffectIdentity(effect: Effect): string;
	}>,
): RuntimeActionExecutor<Effect> {
	if (!validBindingInventory(input.bindings))
		throw new TypeError("Runtime Action binding inventory is invalid");
	const bindings = new Map(
		input.bindings.map((binding) => [binding.identity, Object.freeze(binding)]),
	);

	return Object.freeze({
		invoke: async (
			identity: string,
			invocation: Readonly<{
				input: unknown;
				effect: Effect;
			}> &
				(
					| Readonly<{ scope: ActionExecutionScope }>
					| Readonly<{ facts: ActionExecutionFacts }>
				),
		) => {
			const binding = bindings.get(identity as `action:${string}`);
			if (!binding) throw new OperationFailure("NOT_FOUND");
			const executionScope = "scope" in invocation ? invocation.scope : null;
			const facts =
				"scope" in invocation ? invocation.scope.facts : invocation.facts;
			if (
				(executionScope
					? !isRuntimeExecutionScope(executionScope)
					: !isRuntimeExecutionFacts(facts)) ||
				!principal.is(facts.principal)
			)
				throw new OperationFailure("INTERNAL");
			assertOperationAdmission(binding.admission, facts);
			facts.signal.throwIfAborted();
			let effectIdentity: string;
			try {
				effectIdentity = input.readEffectIdentity(invocation.effect);
				if (typeof effectIdentity !== "string")
					throw new TypeError(
						"Effect Identity owner returned a non-string value",
					);
			} catch {
				throw new OperationFailure("INTERNAL");
			}
			const decodedInput = decodeInput(binding.input, invocation.input);
			let context: Context;
			try {
				context = await input.project(
					Object.freeze({
						...facts,
						facts,
						service: <Definition extends ExternalEffectService>(
							definition: Definition,
						) => {
							if (definition.effect !== "external")
								return Promise.reject(new OperationFailure("INTERNAL"));
							if (!executionScope)
								return Promise.reject(new OperationFailure("INTERNAL"));
							return executionScope.service(definition);
						},
					}),
				);
			} catch (error) {
				if (facts.signal.aborted && error === facts.signal.reason) throw error;
				throw new OperationFailure("INTERNAL");
			}
			facts.signal.throwIfAborted();
			try {
				const raw = await binding.execute({
					input: decodedInput,
					ctx: context,
					effect: Object.freeze({ id: effectIdentity }),
					errors: errorFactories(binding.declaredErrors),
				});
				return decodeOutput(binding.output, raw);
			} catch (error) {
				if (error instanceof DeclaredOperationError) {
					validateDeclaredError(binding.declaredErrors, error);
					throw error;
				}
				if (facts.signal.aborted && error === facts.signal.reason) throw error;
				throw new OperationFailure("INTERNAL");
			}
		},
	});
}
