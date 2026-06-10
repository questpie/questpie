/**
 * `questpie/env-client` — browser-safe client env resolver (tiny).
 *
 * Imported only by codegen-emitted `.generated/env.client.<consumer>.ts`
 * modules, which pass literal prefixed env references for bundler inlining.
 */

export { resolveClientEnv } from "#questpie/client/env/resolve.js";
export type {
	AnyClientEnvDefinition,
	ClientEnvDefinition,
	InferShape,
	StandardSchemaV1,
} from "#questpie/shared/env/types.js";
