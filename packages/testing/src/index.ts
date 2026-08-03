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
	type TestAppLifecycle,
	type TestAppOptions,
	type TestRuntimeOptions,
} from "./test-app.js";
