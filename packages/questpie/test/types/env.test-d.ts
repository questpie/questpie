/**
 * Env Primitive Type Tests
 *
 * Compile-time only — run with: tsc --noEmit
 *
 * Covers:
 * 1. Inferred `env.X` types (server, client, base preset, tightened base)
 * 2. Server keys with a public client prefix are a compile error
 * 3. `resolveClientEnv` raw-map completeness is type-enforced
 * 4. Server keys do not exist on the resolved client env
 */

import { z } from "zod";

import { resolveClientEnv } from "#questpie/client/env/resolve.js";
import { env } from "#questpie/server/env/define.js";
import { clientEnv } from "#questpie/shared/env/client-env.js";

import type { Equal, Expect } from "./type-test-utils.js";

// ============================================================================
// Fixtures — wrapped in functions so nothing executes at module load
// ============================================================================

const clientDef = clientEnv({
	consumers: ["expo", "vite"],
	vars: {
		APP_URL: z.url(),
		POSTHOG_KEY: z.string().optional(),
	},
});

function serverEnv() {
	return env({
		client: clientDef,
		server: {
			DATABASE_URL: z.url(), // tightens base var: optional → required
			BETTER_AUTH_SECRET: z.string().min(32),
			SMTP_PORT: z.coerce.number().optional(),
		},
		refine: (e) => {
			// refine receives the full resolved env (base + server + client)
			type _checks = [
				Expect<Equal<typeof e.DATABASE_URL, string>>,
				Expect<
					Equal<
						typeof e.NODE_ENV,
						"development" | "test" | "production" | undefined
					>
				>,
				Expect<Equal<typeof e.APP_URL, string>>,
			];
			return undefined;
		},
	});
}

// ============================================================================
// 1. Inferred env.X types
// ============================================================================

{
	const e = serverEnv();

	type _cases = [
		// Tightened base var — required string, not string | undefined
		Expect<Equal<typeof e.DATABASE_URL, string>>,
		// App-declared server vars
		Expect<Equal<typeof e.BETTER_AUTH_SECRET, string>>,
		Expect<Equal<typeof e.SMTP_PORT, number | undefined>>,
		// Client vars are typed on the server env (unprefixed logical names)
		Expect<Equal<typeof e.APP_URL, string>>,
		Expect<Equal<typeof e.POSTHOG_KEY, string | undefined>>,
		// Base preset stays typed when not re-declared
		Expect<Equal<typeof e.QUESTPIE_DB, string | undefined>>,
		Expect<
			Equal<
				typeof e.NODE_ENV,
				"development" | "test" | "production" | undefined
			>
		>,
	];

	// @ts-expect-error — undeclared vars do not exist on the env object
	e.TOTALLY_UNDECLARED;
}

// ============================================================================
// 2. Server keys must not use a client prefix
// ============================================================================

function _publicPrefixInServerBlockIsCompileError() {
	return env({
		server: {
			// @ts-expect-error — EXPO_PUBLIC_* belongs in env.client.ts vars
			EXPO_PUBLIC_API_KEY: z.string(),
		},
	});
}

function _vitePrefixInServerBlockIsCompileError() {
	return env({
		server: {
			// @ts-expect-error — VITE_* belongs in env.client.ts vars
			VITE_API_KEY: z.string(),
		},
	});
}

// ============================================================================
// 3. resolveClientEnv — raw-map literal coverage is type-enforced
// ============================================================================

function _rawMapMustCoverEveryVar() {
	// @ts-expect-error — POSTHOG_KEY is missing from the raw map
	resolveClientEnv(clientDef, {
		APP_URL: process.env.EXPO_PUBLIC_APP_URL,
	});
}

function clientResolved() {
	return resolveClientEnv(
		clientDef,
		{
			APP_URL: process.env.EXPO_PUBLIC_APP_URL,
			POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
		},
		"expo",
	);
}

// ============================================================================
// 4. Client env typing — server keys physically absent
// ============================================================================

{
	const e = clientResolved();

	type _cases = [
		Expect<Equal<typeof e.APP_URL, string>>,
		Expect<Equal<typeof e.POSTHOG_KEY, string | undefined>>,
	];

	// @ts-expect-error — server keys do not exist on the client env module
	e.DATABASE_URL;
}
