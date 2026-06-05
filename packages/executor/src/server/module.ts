import { module } from "questpie";

import { sandboxRpcRoute } from "./routes/sandbox-rpc.js";

/**
 * `@questpie/executor` — the OPT-IN host-side sandbox/executor capability module.
 *
 * The `executor` PRIMITIVE itself (`ctx.executor`, the `ExecutorService`, and the
 * capability broker) is core infrastructure (instantiated alongside `kv`/`storage`
 * from `app.config.executor`). What this module adds is the part that should NOT
 * be baked into every app: the `POST /api/sandbox/rpc` broker endpoint — the
 * TRUSTED host side of the untrusted sandbox bindings path. Registering this
 * module mounts that route; an app that never runs sandboxed mini-apps simply does
 * not register it and never exposes the endpoint.
 *
 * Register it next to `mcpModule`/`workflowsModule`:
 *   import { executorModule } from "@questpie/executor/modules/executor";
 *   export default [ executorModule, mcpModule, workflowsModule ] as const;
 */
export const executorModule = module({
	name: "questpie-executor",
	routes: {
		"sandbox/rpc": sandboxRpcRoute,
	},
});

export default executorModule;
