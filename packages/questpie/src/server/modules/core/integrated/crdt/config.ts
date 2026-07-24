import type { CrdtFieldEngine } from "#questpie/shared/crdt-engine.js";

export type CrdtRuntimeConfig = Readonly<{
	namespace: string;
	engines?: Readonly<{
		text?: CrdtFieldEngine<"text", string>;
	}>;
	allowedOrigins?: readonly string[];
	authenticateAgent?: (credential: unknown) => unknown | Promise<unknown>;
}>;
