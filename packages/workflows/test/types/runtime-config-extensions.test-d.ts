import { expectTypeOf } from "bun:test";

import type { Questpie, RuntimeConfigExtensions } from "questpie";
import { runtimeConfig } from "questpie/app";

import {
	workflowsConfig,
	type WorkflowsConfigInput,
} from "../../src/server/config.js";

const runtime = runtimeConfig({
	app: { url: "http://localhost:3000" },
	db: { url: "postgres://localhost/test" },
	workflowsRuntime: workflowsConfig({
		executionLock: { leaseSeconds: 120 },
	}),
});

expectTypeOf(runtime.workflowsRuntime).toMatchTypeOf<WorkflowsConfigInput>();
expectTypeOf<RuntimeConfigExtensions["workflowsRuntime"]>().toEqualTypeOf<
	WorkflowsConfigInput | undefined
>();

declare const app: Questpie<any>;
expectTypeOf(app.state?.workflowsRuntime).toEqualTypeOf<
	WorkflowsConfigInput | undefined
>();
