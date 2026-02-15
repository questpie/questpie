/**
 * HTTP Adapter Types
 *
 * Type definitions for the HTTP adapter.
 */

import type { Questpie } from "../config/cms.js";
import type { RequestContext } from "../config/context.js";
import type { AccessMode, QuestpieConfig } from "../config/types.js";
import type { RpcRouterTree } from "../rpc/types.js";

export type ReindexAccessContext<
	TConfig extends QuestpieConfig = QuestpieConfig,
> = {
	request: Request;
	cms: Questpie<TConfig>;
	session?: { user: any; session: any } | null;
	db: unknown;
	locale?: string;
	collection: string;
};

export type ReindexAccessRule<TConfig extends QuestpieConfig = QuestpieConfig> =
	| boolean
	| ((ctx: ReindexAccessContext<TConfig>) => boolean | Promise<boolean>);

export type AdapterConfig<TConfig extends QuestpieConfig = QuestpieConfig> = {
	basePath?: string;
	accessMode?: AccessMode;
	rpc?: RpcRouterTree<any>;
	/**
	 * Search route options.
	 */
	search?: {
		/**
		 * Access policy for `POST /search/reindex/:collection`.
		 *
		 * When omitted, reindex access is derived from the target collection's
		 * `update` access rule.
		 */
		reindexAccess?: ReindexAccessRule<TConfig>;
	};

	/**
	 * Storage route options.
	 */
	storage?: {
		/**
		 * Collection used by the legacy `/storage/files/:key` alias route.
		 * If omitted, the adapter derives it from registered upload collections.
		 */
		collection?: string;
	};
	extendContext?: (params: {
		request: Request;
		cms: Questpie<TConfig>;
		context: AdapterBaseContext;
	}) =>
		| Promise<Record<string, any> | undefined>
		| Record<string, any>
		| undefined;
	getLocale?: (request: Request, cms: Questpie<TConfig>) => string | undefined;
	/**
	 * Custom session resolver. Returns the session object from Better Auth
	 * containing both user and session data.
	 */
	getSession?: (
		request: Request,
		cms: Questpie<TConfig>,
	) => Promise<{ user: any; session: any } | null>;
};

export type AdapterContext = {
	/** Auth session (user + session) from Better Auth */
	session?: { user: any; session: any } | null;
	locale?: string;
	localeFallback?: boolean;
	cmsContext: RequestContext;
};

export type AdapterBaseContext = {
	/** Auth session (user + session) from Better Auth */
	session?: { user: any; session: any } | null;
	locale?: string;
	localeFallback?: boolean;
	accessMode: AccessMode;
};

export type UploadFile = {
	name: string;
	type: string;
	size: number;
	arrayBuffer: () => Promise<ArrayBuffer>;
};

export type AdapterRoutes = {
	auth: (request: Request) => Promise<Response>;
	collectionUpload: (
		request: Request,
		params: { collection: string },
		context?: AdapterContext,
		file?: UploadFile | null,
	) => Promise<Response>;
	collectionServe: (
		request: Request,
		params: { collection: string; key: string },
		context?: AdapterContext,
	) => Promise<Response>;
	rpc: {
		root: (
			request: Request,
			params: { path: string[] },
			context?: AdapterContext,
		) => Promise<Response>;
		collection: (
			request: Request,
			params: { collection: string; name: string },
			context?: AdapterContext,
		) => Promise<Response>;
		global: (
			request: Request,
			params: { global: string; name: string },
			context?: AdapterContext,
		) => Promise<Response>;
	};
	realtime: {
		/**
		 * Unified SSE endpoint for multiplexed realtime subscriptions.
		 *
		 * POST /realtime
		 * Body: { topics: [{ id, resourceType, resource, where?, with?, limit?, offset?, orderBy? }] }
		 */
		subscribe: (
			request: Request,
			params: Record<string, string>,
			context?: AdapterContext,
		) => Promise<Response>;
	};
	collections: {
		find: (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		) => Promise<Response>;
		count: (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		) => Promise<Response>;
		meta: (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		) => Promise<Response>;
		/**
		 * Get introspected collection schema with fields, access, validation.
		 * Used by admin UI to auto-generate forms and tables.
		 */
		schema: (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		) => Promise<Response>;
		create: (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
			input?: unknown,
		) => Promise<Response>;
		findOne: (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		) => Promise<Response>;
		update: (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
			input?: unknown,
		) => Promise<Response>;
		remove: (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		) => Promise<Response>;
		restore: (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		) => Promise<Response>;
		updateMany: (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
			input?: unknown,
		) => Promise<Response>;
		deleteMany: (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
			input?: unknown,
		) => Promise<Response>;
	};
	globals: {
		get: (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		) => Promise<Response>;
		/**
		 * Get introspected global schema with fields, access, validation.
		 * Used by admin UI to auto-generate forms.
		 */
		schema: (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		) => Promise<Response>;
		update: (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
			input?: unknown,
		) => Promise<Response>;
		/**
		 * Get global metadata (timestamps, versioning, localized fields).
		 * Used by admin UI to determine field behaviors.
		 */
		meta: (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		) => Promise<Response>;
	};
	search: {
		search: (
			request: Request,
			params: Record<string, never>,
			context?: AdapterContext,
		) => Promise<Response>;
		reindex: (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		) => Promise<Response>;
	};
};

export type FetchHandler = (
	request: Request,
	context?: AdapterContext,
) => Promise<Response | null>;
