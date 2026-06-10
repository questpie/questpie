/**
 * `questpie/env` — the env primitive (server + definition factories).
 *
 * - `env()` — `env.ts` file convention: schema-declared, boot-validated env.
 * - `clientEnv()` — `env.client.ts` file convention: client-safe var
 *   definition consumed by codegen to emit per-consumer client env modules.
 *
 * Browser code never imports this entry — it imports the generated
 * `.generated/env.client.<consumer>.ts` module (see `questpie/env-client`).
 */

export {
	env,
	type EnvOptions,
	type QuestpieBaseEnv,
	type ResolvedEnv,
} from "#questpie/server/env/define.js";
export { clientEnv } from "#questpie/shared/env/client-env.js";
export type {
	AnyClientEnvDefinition,
	ClientConsumer,
	ClientConsumerConfig,
	ClientConsumerPreset,
	ClientEnvDefinition,
	InferShape,
	PublicVarPrefix,
	StandardSchemaV1,
	ValidateServerKeys,
} from "#questpie/shared/env/types.js";
