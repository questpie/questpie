/**
 * HTTP Route Handlers
 *
 * Re-exports all route handler modules.
 */

// Legacy closure factories (deprecated — kept for backwards compat)
export { createAuthRoute } from "./auth.js";
export { createCollectionRoutes } from "./collections.js";
export { createGlobalRoutes, type GlobalRoutes } from "./globals.js";
export { createRealtimeRoutes } from "./realtime.js";
export { createSearchRoutes } from "./search.js";
export { createStorageRoutes } from "./storage.js";

// Standalone handlers
export { authHandler } from "./auth.js";
export {
	collectionFind,
	collectionCount,
	collectionCreate,
	collectionFindOne,
	collectionUpdate,
	collectionRemove,
	collectionVersions,
	collectionRevert,
	collectionTransition,
	collectionRestore,
	collectionUpdateMany,
	collectionUpdateBatch,
	collectionDeleteMany,
	collectionAudit,
	collectionMeta,
	collectionSchema,
} from "./collections.js";
export {
	globalGet,
	globalVersions,
	globalRevert,
	globalTransition,
	globalSchema,
	globalUpdate,
	globalMeta,
	globalAudit,
} from "./globals.js";
export { realtimeSubscribe } from "./realtime.js";
export { searchSearch, searchReindex } from "./search.js";
export { storageCollectionUpload, storageCollectionServe } from "./storage.js";
