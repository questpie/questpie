/**
 * `env()` — schema-declared, boot-validated environment for `env.ts`.
 *
 * The `env.ts` file convention (beside `questpie.config.ts`) default-exports
 * the result of `env()`. Validation runs **at module evaluation** — and the
 * generated `.generated/index.ts` imports `../env` before the runtime config,
 * so a misconfigured environment fails boot before `runtimeConfig()`
 * resolution, before `new Questpie()`, and before any adapter/auth/db init.
 *
 * @example
 * ```ts
 * // env.ts
 * import { env } from "questpie/env";
 * import { z } from "zod";
 * import client from "./env.client";
 *
 * export default env({
 *   client,
 *   server: {
 *     DATABASE_URL: z.url(),               // tightens the optional base var
 *     BETTER_AUTH_SECRET: z.string().min(32),
 *   },
 *   refine: (e) => {
 *     if (e.NODE_ENV === "production" && e.BETTER_AUTH_SECRET === "dev-secret")
 *       return "BETTER_AUTH_SECRET must not be the dev default in production";
 *   },
 * });
 * ```
 */

import { z } from "zod";

import { getEnv } from "#questpie/server/utils/env.js";
import { resolveConsumer } from "#questpie/shared/env/client-env.js";
import type {
	AnyClientEnvDefinition,
	InferShape,
	StandardSchemaV1,
	ValidateServerKeys,
} from "#questpie/shared/env/types.js";

// ============================================================================
// Framework base preset
// ============================================================================

/**
 * Framework base vars — merged *under* the app schema (app keys win).
 *
 * All optional: presence cannot be statically required (Cloud injects
 * `QUESTPIE_DB`, self-host uses `DATABASE_URL`, explicit `db: { url }` needs
 * neither) — presence enforcement stays in the runtime resolvers. Apps
 * *tighten* a base var by re-declaring it in their `server` block.
 */
const QUESTPIE_BASE_ENV = {
	NODE_ENV: z.enum(["development", "test", "production"]).optional(),
	QUESTPIE_DB: z.string().optional(),
	DATABASE_URL: z.string().optional(),
	QUESTPIE_APP_URL: z.string().optional(),
	APP_URL: z.string().optional(),
	QUESTPIE_SECRET: z.string().optional(),
	BETTER_AUTH_SECRET: z.string().optional(),
	QUESTPIE_STORAGE_ENDPOINT: z.string().optional(),
	QUESTPIE_STORAGE_BUCKET: z.string().optional(),
	QUESTPIE_STORAGE_REGION: z.string().optional(),
	QUESTPIE_STORAGE_ACCESS_KEY: z.string().optional(),
	QUESTPIE_STORAGE_SECRET_KEY: z.string().optional(),
};

/** Typed output of the framework base preset. */
export type QuestpieBaseEnv = InferShape<typeof QUESTPIE_BASE_ENV>;

// ============================================================================
// Types
// ============================================================================

type ClientVarsOf<TClient extends AnyClientEnvDefinition | undefined> =
	TClient extends AnyClientEnvDefinition ? TClient["vars"] : {};

/**
 * The fully resolved env object type: base preset overlaid by app-declared
 * server + client vars (app declarations win over base keys).
 */
export type ResolvedEnv<
	TServer extends Record<string, StandardSchemaV1>,
	TClient extends AnyClientEnvDefinition | undefined,
> = Readonly<
	Omit<QuestpieBaseEnv, keyof TServer | keyof ClientVarsOf<TClient>> &
		InferShape<TServer> &
		InferShape<ClientVarsOf<TClient>>
>;

export interface EnvOptions<
	TServer extends Record<string, StandardSchemaV1>,
	TClient extends AnyClientEnvDefinition | undefined,
> {
	/**
	 * Server-only vars. Keys with a public client prefix (`EXPO_PUBLIC_`,
	 * `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_`) are a compile error — a server
	 * secret must never use a client-inlined spelling.
	 */
	server: TServer & ValidateServerKeys<TServer>;
	/**
	 * Client env definition from `./env.client`. Client vars are also
	 * validated server-side under the unprefixed logical name, with prefixed
	 * fallback per declared consumer (`APP_URL ?? EXPO_PUBLIC_APP_URL ?? …`,
	 * unprefixed wins) — a single-`.env` dev setup works on both sides.
	 */
	client?: TClient;
	/**
	 * Cross-field boot guard, run after per-var validation. Return (or throw)
	 * an error message to fail boot.
	 */
	refine?: (env: ResolvedEnv<TServer, TClient>) => string | undefined | void;
	/**
	 * Skip validation entirely (values are read raw, no schema runs).
	 * @default Boolean(process.env.QUESTPIE_SKIP_ENV_VALIDATION)
	 */
	skipValidation?: boolean;
	/**
	 * Treat empty-string values as undefined before validation.
	 * @default true
	 */
	emptyStringAsUndefined?: boolean;
	/**
	 * Override server-runtime detection. `env.ts` is server-only — client
	 * code imports the generated `env.client.<consumer>` module instead.
	 * @default detected (browser-like context → false)
	 */
	isServer?: boolean;
}

// ============================================================================
// Runtime
// ============================================================================

function detectServerRuntime(): boolean {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return true;
	}
	// Browser-like globals present — still a server when running on Node/Bun
	// (e.g. happy-dom/jsdom test environments, Electron main).
	const proc = (globalThis as { process?: { versions?: { node?: string } } })
		.process;
	return Boolean(proc?.versions?.node);
}

interface SchemaEntry {
	key: string;
	schema: StandardSchemaV1;
	isClientVar: boolean;
}

function formatIssues(issues: ReadonlyArray<StandardSchemaV1.Issue>): string {
	const message = issues.map((issue) => issue.message).join("; ");
	return message || "invalid";
}

/**
 * Declare + validate the app environment. Validates at call time (= module
 * evaluation of `env.ts`) and returns the frozen, typed env object.
 *
 * - Failures aggregate into one error listing every offending **name**
 *   (never values — secrets stay out of logs).
 * - The framework base preset (`NODE_ENV`, `QUESTPIE_*`, `DATABASE_URL`,
 *   `APP_URL`, `BETTER_AUTH_SECRET`) is merged under the app schema, so
 *   `env.DATABASE_URL` is always typed and exactly as strict as the app chose.
 * - `QUESTPIE_SKIP_ENV_VALIDATION=1` skips validation (codegen and build
 *   steps set this — they must never require a populated env).
 */
export function env<
	TServer extends Record<string, StandardSchemaV1>,
	TClient extends AnyClientEnvDefinition | undefined = undefined,
>(options: EnvOptions<TServer, TClient>): ResolvedEnv<TServer, TClient> {
	const {
		server,
		client,
		refine,
		emptyStringAsUndefined = true,
		skipValidation = Boolean(getEnv("QUESTPIE_SKIP_ENV_VALIDATION")),
		isServer = detectServerRuntime(),
	} = options;

	if (!isServer) {
		throw new Error(
			"[questpie/env] env.ts is server-only; client code imports the generated " +
				"env.client.<consumer> module (.generated/env.client.*.ts).",
		);
	}

	const clientPrefixes = (client?.consumers ?? []).map(
		(consumer) => resolveConsumer(consumer).prefix,
	);

	const readRaw = (name: string, isClientVar: boolean): string | undefined => {
		const candidates = isClientVar
			? [name, ...clientPrefixes.map((prefix) => `${prefix}${name}`)]
			: [name];
		for (const candidate of candidates) {
			const value = getEnv(candidate);
			if (emptyStringAsUndefined && value === "") continue;
			if (value !== undefined) return value;
		}
		return undefined;
	};

	// Merge order: base preset under server vars; client vars win last.
	// (A key declared in both `server` and `client.vars` is validated once,
	// with the client read path — its prefixed fallbacks are a superset.)
	const entries = new Map<string, SchemaEntry>();
	for (const [key, schema] of Object.entries(QUESTPIE_BASE_ENV)) {
		entries.set(key, { key, schema, isClientVar: false });
	}
	for (const [key, schema] of Object.entries(
		server as Record<string, StandardSchemaV1>,
	)) {
		entries.set(key, { key, schema, isClientVar: false });
	}
	for (const [key, schema] of Object.entries(client?.vars ?? {})) {
		entries.set(key, { key, schema, isClientVar: true });
	}

	if (skipValidation) {
		const raw: Record<string, unknown> = {};
		for (const entry of entries.values()) {
			raw[entry.key] = readRaw(entry.key, entry.isClientVar);
		}
		return Object.freeze(raw) as ResolvedEnv<TServer, TClient>;
	}

	const values: Record<string, unknown> = {};
	const failures: string[] = [];

	for (const entry of entries.values()) {
		const result = entry.schema["~standard"].validate(
			readRaw(entry.key, entry.isClientVar),
		);
		if (result instanceof Promise) {
			throw new Error(
				`[questpie/env] Async validation is not supported — var "${entry.key}" ` +
					"returned a Promise. Use synchronous schemas in env.ts.",
			);
		}
		if (result.issues) {
			failures.push(`  ✖ ${entry.key}: ${formatIssues(result.issues)}`);
		} else {
			values[entry.key] = result.value;
		}
	}

	if (failures.length > 0) {
		throw new Error(
			`[questpie/env] Invalid environment:\n${failures.join("\n")}\n` +
				"(Variable names only — values are never logged. " +
				"Set QUESTPIE_SKIP_ENV_VALIDATION=1 for env-less build/codegen steps.)",
		);
	}

	const frozen = Object.freeze(values) as ResolvedEnv<TServer, TClient>;

	if (refine) {
		const message = refine(frozen);
		if (typeof message === "string" && message.length > 0) {
			throw new Error(`[questpie/env] Invalid environment:\n  ✖ ${message}`);
		}
	}

	return frozen;
}
