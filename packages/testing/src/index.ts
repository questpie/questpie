import type { RuntimeConfig } from "questpie/types";

/** A generated, singleton-free QUESTPIE application factory. */
export interface GeneratedAppFactory<TApp, TSession = unknown> {
	(runtime: RuntimeConfig): Promise<TApp>;
	readonly "~types"?: { session: TSession };
}

export {
	createTestApp,
	TestAppCleanupError,
	TestAppSetupError,
	type PGliteTestDatabaseOptions,
	type TestApp,
	type TestActor,
	type TestActorRunContext,
	type TestAppLifecycle,
	type TestAppOptions,
	type TestOAuthActorInput,
	type TestRuntimeOptions,
	type TestUserActorInput,
	type TestUserSeed,
} from "./test-app.js";
