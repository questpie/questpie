// @questpie/executor — the opt-in host-side sandbox/executor capability module.
//
// The `executor` primitive (`ctx.executor`, `ExecutorService`, the capability
// broker) lives in `questpie` core (`questpie/executor`). This package adds the
// OPT-IN `POST /api/sandbox/rpc` broker route as `executorModule`, so the sandbox
// capability — including its security endpoint — is enabled explicitly rather
// than baked into every app.

export { executorModule } from "../server/modules/executor/index.js";
export { sandboxRpcRoute } from "../server/modules/executor/routes/sandbox/rpc.js";
