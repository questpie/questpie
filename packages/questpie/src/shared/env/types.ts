/**
 * Env primitive — shared types.
 *
 * Shared between the server factory (`env()` in `questpie/env`), the client
 * definition factory (`clientEnv()`), and the browser-safe resolver
 * (`resolveClientEnv()` in `questpie/env-client`).
 *
 * Validation is constrained to Standard Schema (https://standardschema.dev) —
 * zod, valibot, arktype, and typia all implement it.
 *
 */

// ============================================================================
// Standard Schema v1 — vendored spec interface
// ============================================================================

/**
 * The Standard Schema v1 interface.
 *
 * Vendored verbatim from https://standardschema.dev — the spec is a
 * types-only contract explicitly designed to be copied into projects
 * instead of depended on.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	/** The Standard Schema properties. */
	readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
	/** The Standard Schema properties interface. */
	export interface Props<Input = unknown, Output = Input> {
		/** The version number of the standard. */
		readonly version: 1;
		/** The vendor name of the schema library. */
		readonly vendor: string;
		/** Validates unknown input values. */
		readonly validate: (
			value: unknown,
		) => Result<Output> | Promise<Result<Output>>;
		/** Inferred types associated with the schema. */
		readonly types?: Types<Input, Output> | undefined;
	}

	/** The result interface of the validate function. */
	export type Result<Output> = SuccessResult<Output> | FailureResult;

	/** The result interface if validation succeeds. */
	export interface SuccessResult<Output> {
		/** The typed output value. */
		readonly value: Output;
		/** The non-existent issues. */
		readonly issues?: undefined;
	}

	/** The result interface if validation fails. */
	export interface FailureResult {
		/** The issues of failed validation. */
		readonly issues: ReadonlyArray<Issue>;
	}

	/** The issue interface of the failure output. */
	export interface Issue {
		/** The error message of the issue. */
		readonly message: string;
		/** The path of the issue, if any. */
		readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
	}

	/** The path segment interface of the issue. */
	export interface PathSegment {
		/** The key representing a path segment. */
		readonly key: PropertyKey;
	}

	/** The Standard Schema types interface. */
	export interface Types<Input = unknown, Output = Input> {
		/** The input type of the schema. */
		readonly input: Input;
		/** The output type of the schema. */
		readonly output: Output;
	}

	/** Infers the input type of a Standard Schema. */
	export type InferInput<TSchema extends StandardSchemaV1> = NonNullable<
		TSchema["~standard"]["types"]
	>["input"];

	/** Infers the output type of a Standard Schema. */
	export type InferOutput<TSchema extends StandardSchemaV1> = NonNullable<
		TSchema["~standard"]["types"]
	>["output"];
}

// ============================================================================
// Client consumers
// ============================================================================

/** Built-in client env consumer presets. */
export type ClientConsumerPreset = "expo" | "vite" | "next";

/**
 * A client env consumer described explicitly.
 * Use for bundlers without a built-in preset.
 */
export interface ClientConsumerConfig {
	/** Consumer name — becomes the generated file suffix (`env.client.<name>.ts`). */
	name: string;
	/** Physical var prefix the bundler inlines (e.g. `"EXPO_PUBLIC_"`). */
	prefix: string;
	/**
	 * Env object the bundler statically replaces member expressions on.
	 * Expo/Next inline `process.env.*`; Vite inlines `import.meta.env.*`.
	 */
	envObject: "process.env" | "import.meta.env";
}

/** A client env consumer — preset name or explicit config. */
export type ClientConsumer = ClientConsumerPreset | ClientConsumerConfig;

// ============================================================================
// Definitions + inference
// ============================================================================

/**
 * Frozen client env definition returned by `clientEnv()`.
 * Logical var names are unprefixed (`APP_URL`); the physical prefixed
 * spelling (`EXPO_PUBLIC_APP_URL`) is a per-consumer build-time concern.
 */
export interface ClientEnvDefinition<
	TVars extends Record<string, StandardSchemaV1> = Record<
		string,
		StandardSchemaV1
	>,
	TConsumers extends readonly ClientConsumer[] = readonly ClientConsumer[],
> {
	/** Bundlers that consume these vars — drives codegen emission. */
	consumers: TConsumers;
	/** Client-safe vars keyed by unprefixed logical name. */
	vars: TVars;
}

/** Loosest client env definition — use for generic constraints. */
export type AnyClientEnvDefinition = ClientEnvDefinition;

/**
 * Output shape of a schema record — one shallow mapped type, no recursion.
 */
export type InferShape<T extends Record<string, StandardSchemaV1>> = {
	[K in keyof T]: StandardSchemaV1.InferOutput<T[K]>;
};

/** Public prefixes that must never appear on server var names. */
export type PublicVarPrefix =
	| "EXPO_PUBLIC_"
	| "VITE_"
	| "NEXT_PUBLIC_"
	| "PUBLIC_";

/**
 * Compile-time guard: a server var declared with a client prefix is an
 * inversion (it would be inlined into client bundles). Maps offending keys
 * to an error tuple so the schema value no longer type-checks.
 */
export type ValidateServerKeys<T extends Record<string, StandardSchemaV1>> = {
	[K in keyof T]: K extends `${PublicVarPrefix}${string}`
		? ["server var must not use a client prefix", K]
		: T[K];
};
