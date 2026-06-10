/**
 * `clientEnv()` — client env definition factory + consumer preset resolution.
 *
 * The definition file (`env.client.ts`, beside `questpie.config.ts`) is a
 * client-safe leaf: it may import only `questpie/env` and a Standard Schema
 * validator. No validation and no env reads happen here — codegen emits a
 * `.generated/env.client.<consumer>.ts` module per declared consumer that
 * resolves the physical (prefixed) vars at bundle time.
 */

import type {
	ClientConsumer,
	ClientConsumerConfig,
	ClientConsumerPreset,
	ClientEnvDefinition,
	StandardSchemaV1,
} from "#questpie/shared/env/types.js";

/**
 * Built-in consumer presets — prefix + inlinable env object per bundler.
 *
 * Bundlers replace **literal member expressions only** (`process.env.X`,
 * `import.meta.env.X`), which is why generated client env modules spell out
 * every var instead of looping.
 */
export const CLIENT_CONSUMER_PRESETS: Record<
	ClientConsumerPreset,
	ClientConsumerConfig
> = {
	expo: { name: "expo", prefix: "EXPO_PUBLIC_", envObject: "process.env" },
	vite: { name: "vite", prefix: "VITE_", envObject: "import.meta.env" },
	next: { name: "next", prefix: "NEXT_PUBLIC_", envObject: "process.env" },
};

/** Resolve a consumer (preset name or explicit config) to its full config. */
export function resolveConsumer(
	consumer: ClientConsumer,
): ClientConsumerConfig {
	if (typeof consumer === "string") {
		const preset = CLIENT_CONSUMER_PRESETS[consumer];
		if (!preset) {
			throw new Error(
				`[questpie/env] Unknown client env consumer "${consumer}". ` +
					`Built-in consumers: ${Object.keys(CLIENT_CONSUMER_PRESETS).join(", ")}. ` +
					"Pass { name, prefix, envObject } for a custom bundler.",
			);
		}
		return preset;
	}
	return consumer;
}

/**
 * Define client-safe env vars in `env.client.ts` (beside `questpie.config.ts`).
 *
 * Pure frozen definition — no validation, no env reads. Server code consumes
 * it via `env({ client })` (validated at boot under the unprefixed name, with
 * prefixed fallback per consumer); client code imports the generated
 * `.generated/env.client.<consumer>.ts` module where server keys are
 * physically absent.
 *
 * @example
 * ```ts
 * // env.client.ts
 * import { clientEnv } from "questpie/env";
 * import { z } from "zod";
 *
 * export default clientEnv({
 *   consumers: ["expo", "vite"],
 *   vars: {
 *     APP_URL: z.url(),
 *     POSTHOG_KEY: z.string().optional(),
 *   },
 * });
 * ```
 */
export function clientEnv<
	TVars extends Record<string, StandardSchemaV1>,
	const TConsumers extends readonly ClientConsumer[],
>(def: {
	consumers: TConsumers;
	vars: TVars;
}): ClientEnvDefinition<TVars, TConsumers> {
	for (const consumer of def.consumers) {
		// Fail fast on typo'd preset names at definition time.
		resolveConsumer(consumer);
	}
	return Object.freeze({ consumers: def.consumers, vars: def.vars });
}
