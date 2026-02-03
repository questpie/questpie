/**
 * HTTP Adapter Types
 *
 * Type definitions for the HTTP adapter.
 */

import type { Questpie } from "../config/cms.js";
import type { RequestContext } from "../config/context.js";
import type { AccessMode, QuestpieConfig } from "../config/types.js";

export type AdapterConfig<TConfig extends QuestpieConfig = QuestpieConfig> = {
	basePath?: string;
	accessMode?: AccessMode;
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
			params: { name: string },
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
		subscribe: (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		) => Promise<Response>;
		subscribeGlobal: (
			request: Request,
			params: { global: string },
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
