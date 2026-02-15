/**
 * HTTP Route Handlers
 *
 * Re-exports all route handler modules.
 */

export { createAuthRoute } from "./auth.js";
export { createCollectionRoutes } from "./collections.js";
export { createGlobalRoutes, type GlobalRoutes } from "./globals.js";
export { createRealtimeRoutes } from "./realtime.js";
export { createRpcRoutes } from "./rpc.js";
export { createSearchRoutes } from "./search.js";
export { createStorageRoutes } from "./storage.js";
