/**
 * `resolveClientEnv()` — browser-safe resolver for generated client env modules.
 *
 * Called only from codegen-emitted `.generated/env.client.<consumer>.ts`
 * files, which pass every var as a **literal** prefixed reference
 * (`process.env.EXPO_PUBLIC_APP_URL`, `import.meta.env.VITE_APP_URL`) so the
 * bundler can inline it. Validation runs at import of the generated module
 * and is always on — skip flags cannot be read dynamically post-inline.
 */

import { resolveConsumer } from "#questpie/shared/env/client-env.js";
import type {
	AnyClientEnvDefinition,
	InferShape,
	StandardSchemaV1,
} from "#questpie/shared/env/types.js";

/**
 * Validate the inlined raw values against the `clientEnv()` definition and
 * return the frozen, typed client env object.
 *
 * @param def - The `env.client.ts` default export.
 * @param raw - Literal map of every declared var (type-enforced coverage).
 * @param consumerName - Name of the consumer the generated module targets;
 *   aggregate errors then name the **physical** var (`EXPO_PUBLIC_APP_URL`)
 *   so the fix is obvious in EAS/Vite config.
 */
export function resolveClientEnv<TDef extends AnyClientEnvDefinition>(
	def: TDef,
	raw: { [K in keyof TDef["vars"]]: string | undefined },
	consumerName?: string,
): Readonly<InferShape<TDef["vars"]>> {
	const prefix = consumerName
		? (def.consumers
				.map((consumer) => resolveConsumer(consumer))
				.find((consumer) => consumer.name === consumerName)?.prefix ?? "")
		: "";

	const values: Record<string, unknown> = {};
	const failures: string[] = [];

	for (const [key, schema] of Object.entries(
		def.vars as Record<string, StandardSchemaV1>,
	)) {
		let value = (raw as Record<string, string | undefined>)[key];
		if (value === "") value = undefined;
		const result = schema["~standard"].validate(value);
		if (result instanceof Promise) {
			throw new Error(
				`[questpie/env] Async validation is not supported — client var "${key}" ` +
					"returned a Promise. Use synchronous schemas in env.client.ts.",
			);
		}
		if (result.issues) {
			const message =
				result.issues.map((issue) => issue.message).join("; ") || "invalid";
			failures.push(`  ✖ ${prefix}${key}: ${message}`);
		} else {
			values[key] = result.value;
		}
	}

	if (failures.length > 0) {
		throw new Error(
			`[questpie/env] Invalid client environment:\n${failures.join("\n")}\n` +
				"(These vars must be present, with their public prefix, in the build environment.)",
		);
	}

	return Object.freeze(values) as Readonly<InferShape<TDef["vars"]>>;
}
