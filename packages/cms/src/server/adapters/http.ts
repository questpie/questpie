import qs from "qs";
import { ZodError } from "zod";
import type { QCMS } from "../config/cms";
import type { RequestContext } from "../config/context";
import type { AccessMode, CMSConfig } from "../config/types";
import type { FunctionDefinition, FunctionsMap } from "../functions/types";
import { executeJsonFunction } from "../functions/execute";
import { CMSError } from "../errors";

export type CMSAdapterConfig<TConfig extends CMSConfig = CMSConfig> = {
	basePath?: string;
	accessMode?: AccessMode;
	extendContext?: (params: {
		request: Request;
		cms: QCMS<TConfig>;
		context: CMSAdapterBaseContext;
	}) =>
		| Promise<Record<string, any> | undefined>
		| Record<string, any>
		| undefined;
	getLocale?: (request: Request, cms: QCMS<TConfig>) => string | undefined;
	getSession?: (
		request: Request,
		cms: QCMS<TConfig>,
	) => Promise<{ user?: any; session?: any } | null>;
};

export type CMSAdapterContext = {
	user: any;
	session?: any;
	locale?: string;
	cmsContext: RequestContext;
};

export type CMSAdapterBaseContext = {
	user: any;
	session?: any;
	locale?: string;
	accessMode: AccessMode;
};

export type CMSUploadFile = {
	name: string;
	type: string;
	size: number;
	arrayBuffer: () => Promise<ArrayBuffer>;
};

export type CMSAdapterRoutes = {
	auth: (request: Request) => Promise<Response>;
	storageUpload: (
		request: Request,
		context?: CMSAdapterContext,
		file?: CMSUploadFile | null,
	) => Promise<Response>;
	rpc: {
		root: (
			request: Request,
			params: { name: string },
			context?: CMSAdapterContext,
		) => Promise<Response>;
		collection: (
			request: Request,
			params: { collection: string; name: string },
			context?: CMSAdapterContext,
		) => Promise<Response>;
		global: (
			request: Request,
			params: { global: string; name: string },
			context?: CMSAdapterContext,
		) => Promise<Response>;
	};
	realtime: {
		subscribe: (
			request: Request,
			params: { collection: string },
			context?: CMSAdapterContext,
		) => Promise<Response>;
		subscribeGlobal: (
			request: Request,
			params: { global: string },
			context?: CMSAdapterContext,
		) => Promise<Response>;
	};
	collections: {
		find: (
			request: Request,
			params: { collection: string },
			context?: CMSAdapterContext,
		) => Promise<Response>;
		create: (
			request: Request,
			params: { collection: string },
			context?: CMSAdapterContext,
			input?: unknown,
		) => Promise<Response>;
		findOne: (
			request: Request,
			params: { collection: string; id: string },
			context?: CMSAdapterContext,
		) => Promise<Response>;
		update: (
			request: Request,
			params: { collection: string; id: string },
			context?: CMSAdapterContext,
			input?: unknown,
		) => Promise<Response>;
		remove: (
			request: Request,
			params: { collection: string; id: string },
			context?: CMSAdapterContext,
		) => Promise<Response>;
		restore: (
			request: Request,
			params: { collection: string; id: string },
			context?: CMSAdapterContext,
		) => Promise<Response>;
	};
	globals: {
		get: (
			request: Request,
			params: { global: string },
			context?: CMSAdapterContext,
		) => Promise<Response>;
		update: (
			request: Request,
			params: { global: string },
			context?: CMSAdapterContext,
			input?: unknown,
		) => Promise<Response>;
	};
};

export type CMSFetchHandler = (
	request: Request,
	context?: CMSAdapterContext,
) => Promise<Response | null>;

const jsonHeaders = {
	"Content-Type": "application/json",
};

const sseHeaders = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache",
	Connection: "keep-alive",
	"X-Accel-Buffering": "no",
};

const jsonResponse = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: jsonHeaders,
	});

/**
 * Detect if we're in development mode
 */
const isDevelopment = () => {
	try {
		return process?.env?.NODE_ENV === "development";
	} catch {
		return false;
	}
};

/**
 * Handle errors and convert to HTTP Response
 * Supports CMSError, ZodError, and generic Error
 */
const handleError = (error: unknown, isDev = isDevelopment()): Response => {
	// If it's our CMSError, use it directly
	if (error instanceof CMSError) {
		return new Response(JSON.stringify({ error: error.toJSON(isDev) }), {
			status: error.getHTTPStatus(),
			headers: jsonHeaders,
		});
	}

	// If it's ZodError, convert to CMSError
	if (error instanceof ZodError) {
		const cmsError = CMSError.fromZodError(error);
		return new Response(JSON.stringify({ error: cmsError.toJSON(isDev) }), {
			status: cmsError.getHTTPStatus(),
			headers: jsonHeaders,
		});
	}

	// Unknown error - wrap it as INTERNAL_SERVER_ERROR
	const message = error instanceof Error ? error.message : "Unknown error";
	const wrappedError = CMSError.internal(message, error);

	return new Response(JSON.stringify({ error: wrappedError.toJSON(isDev) }), {
		status: wrappedError.getHTTPStatus(),
		headers: jsonHeaders,
	});
};

/**
 * @deprecated Use handleError instead
 */
const jsonError = (message: string, status = 500) =>
	jsonResponse({ error: message }, status);

const parseBoolean = (value: unknown) =>
	value === true || value === "true" || value === 1 || value === "1";

const normalizeBasePath = (basePath: string) => {
	const prefixed = basePath.startsWith("/") ? basePath : `/${basePath}`;
	if (prefixed.length > 1 && prefixed.endsWith("/")) {
		return prefixed.slice(0, -1);
	}
	return prefixed;
};

const getQueryParams = (url: URL) =>
	qs.parse(url.search.slice(1), { allowDots: true, comma: true });

const isFileLike = (value: unknown): value is CMSUploadFile =>
	!!value &&
	typeof (value as CMSUploadFile).name === "string" &&
	typeof (value as CMSUploadFile).arrayBuffer === "function";

const resolveUploadFile = async (
	request: Request,
	file?: CMSUploadFile | null,
): Promise<CMSUploadFile | null> => {
	if (file && isFileLike(file)) {
		return file;
	}

	const formData = await request.formData();
	const formFile = formData.get("file");
	return isFileLike(formFile) ? formFile : null;
};

const normalizeMimeType = (value: string) =>
	value.split(";")[0]?.trim() || value;

const resolveSession = async <TConfig extends CMSConfig = CMSConfig>(
	cms: QCMS<TConfig>,
	request: Request,
	config: CMSAdapterConfig<TConfig>,
) => {
	if (config.getSession) {
		return config.getSession(request, cms);
	}

	if (!cms.auth) {
		return null;
	}

	try {
		const session = await cms.auth.api.getSession({
			headers: request.headers,
		});
		return session ? { user: session.user, session } : null;
	} catch {
		return null;
	}
};

const resolveLocale = async <TConfig extends CMSConfig = CMSConfig>(
	cms: QCMS<TConfig>,
	request: Request,
	config: CMSAdapterConfig<TConfig>,
) => {
	if (config.getLocale) {
		return config.getLocale(request, cms);
	}

	const header = request.headers.get("accept-language");
	return header?.split(",")[0]?.trim() || undefined;
};

export const createCMSAdapterContext = async <
	TConfig extends CMSConfig = CMSConfig,
>(
	cms: QCMS<TConfig>,
	request: Request,
	config: CMSAdapterConfig<TConfig> = {},
): Promise<CMSAdapterContext> => {
	const [sessionInfo, locale] = await Promise.all([
		resolveSession(cms, request, config),
		resolveLocale(cms, request, config),
	]);

	const baseContext: CMSAdapterBaseContext = {
		user: sessionInfo?.user ?? null,
		session: sessionInfo?.session,
		locale,
		accessMode: config.accessMode ?? "user",
	};

	const extension = config.extendContext
		? await config.extendContext({ request, cms, context: baseContext })
		: undefined;

	const cmsContext = await cms.createContext({
		...baseContext,
		...(extension ?? {}),
	});

	return {
		user: baseContext.user,
		session: baseContext.session,
		locale: cmsContext.locale,
		cmsContext,
	};
};

const parseFindOptions = (url: URL) => {
	const parsedQuery = getQueryParams(url);
	const options: any = {};

	if (parsedQuery.limit !== undefined)
		options.limit = Number(parsedQuery.limit);
	if (parsedQuery.offset !== undefined)
		options.offset = Number(parsedQuery.offset);
	if (parsedQuery.page !== undefined) options.page = Number(parsedQuery.page);
	if (parsedQuery.where) options.where = parsedQuery.where;
	if (parsedQuery.orderBy) options.orderBy = parsedQuery.orderBy;
	if (parsedQuery.with) options.with = parsedQuery.with;
	if (parsedQuery.includeDeleted !== undefined) {
		options.includeDeleted = parseBoolean(parsedQuery.includeDeleted);
	}

	return options;
};

const parseFindOneOptions = (url: URL, id: string) => {
	const parsedQuery = getQueryParams(url);
	const options: any = { where: { id } };

	if (parsedQuery.with) options.with = parsedQuery.with;
	if (parsedQuery.includeDeleted !== undefined) {
		options.includeDeleted = parseBoolean(parsedQuery.includeDeleted);
	}

	return options;
};

const parseGlobalGetOptions = (url: URL) => {
	const parsedQuery = getQueryParams(url);
	const options: any = {};

	if (parsedQuery.with) options.with = parsedQuery.with;
	if (parsedQuery.columns) options.columns = parsedQuery.columns;

	return options;
};

const parseGlobalUpdateOptions = (url: URL) => {
	const parsedQuery = getQueryParams(url);
	const options: any = {};

	if (parsedQuery.with) options.with = parsedQuery.with;

	return options;
};

const resolveContext = async <TConfig extends CMSConfig = CMSConfig>(
	cms: QCMS<TConfig>,
	request: Request,
	config: CMSAdapterConfig<TConfig>,
	context?: CMSAdapterContext,
) => {
	if (context?.cmsContext) {
		return context;
	}

	return createCMSAdapterContext(cms, request, config);
};

const parseJsonBody = async (request: Request) => {
	try {
		return await request.json();
	} catch {
		return null;
	}
};

const parseRpcBody = async (request: Request) => {
	const text = await request.text();
	if (!text) return undefined;

	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

export const createCMSAdapterRoutes = <TConfig extends CMSConfig = CMSConfig>(
	cms: QCMS<TConfig>,
	config: CMSAdapterConfig<TConfig> = {},
): CMSAdapterRoutes => {
	const executeFunction = async (
		definition: FunctionDefinition,
		request: Request,
		context?: CMSAdapterContext,
	) => {
		if (definition.mode === "raw") {
			if (request.method !== "POST") {
				return handleError(
					CMSError.badRequest("Method not allowed for raw function"),
				);
			}

			const resolved = await resolveContext(cms, request, config, context);
			try {
				return await definition.handler({
					request,
					context: resolved.cmsContext,
				});
			} catch (error) {
				return handleError(error);
			}
		}

		if (request.method !== "POST") {
			return handleError(CMSError.badRequest("Method not allowed"));
		}

		const resolved = await resolveContext(cms, request, config, context);
		const body = await parseRpcBody(request);

		if (body === null) {
			return handleError(CMSError.badRequest("Invalid JSON body"));
		}

		try {
			const result = await executeJsonFunction(
				cms,
				definition,
				body,
				resolved.cmsContext,
			);
			return jsonResponse(result);
		} catch (error) {
			return handleError(error);
		}
	};

	return {
		auth: async (request) => {
			if (!cms.auth) {
				return handleError(CMSError.notImplemented("Authentication"));
			}
			return cms.auth.handler(request);
		},
		storageUpload: async (request, context, file) => {
			if (request.method !== "POST") {
				return handleError(CMSError.badRequest("Method not allowed"));
			}

			const resolved = await resolveContext(cms, request, config, context);
			const uploadFile = await resolveUploadFile(request, file);

			if (!uploadFile) {
				return handleError(
					CMSError.badRequest("No file uploaded. Send 'file' in form-data."),
				);
			}

			try {
				const key = `${crypto.randomUUID()}-${uploadFile.name}`;
				const buffer = await uploadFile.arrayBuffer();
				await cms.storage.use().put(key, new Uint8Array(buffer));

				const url = await cms.storage.use().getUrl(key);
				const mimeType = normalizeMimeType(uploadFile.type);
				// Core collections (including assets) are always available
				const asset = await (cms.api.collections as any).assets.create(
					{
						key,
						url,
						filename: uploadFile.name,
						mimeType,
						size: uploadFile.size,
					},
					resolved.cmsContext,
				);

				return jsonResponse(asset);
			} catch (error) {
				return handleError(error);
			}
		},
		rpc: {
			root: async (request, params, context) => {
				const functions = cms.getFunctions() as FunctionsMap;
				const definition = functions[params.name];
				if (!definition) {
					return handleError(CMSError.notFound("Function", params.name));
				}

				return executeFunction(definition, request, context);
			},
			collection: async (request, params, context) => {
				let collectionInstance: any;
				try {
					collectionInstance = cms.getCollectionConfig(
						params.collection as any,
					);
				} catch {
					return handleError(
						CMSError.notFound("Collection", params.collection),
					);
				}

				const functions = (collectionInstance.state?.functions ||
					{}) as FunctionsMap;
				const definition = functions[params.name];
				if (!definition) {
					return handleError(
						CMSError.notFound(
							`Function on collection "${params.collection}"`,
							params.name,
						),
					);
				}

				return executeFunction(definition, request, context);
			},
			global: async (request, params, context) => {
				let globalInstance: any;
				try {
					globalInstance = cms.getGlobalConfig(params.global as any);
				} catch {
					return handleError(CMSError.notFound("Global", params.global));
				}

				const functions = (globalInstance.state?.functions ||
					{}) as FunctionsMap;
				const definition = functions[params.name];
				if (!definition) {
					return handleError(
						CMSError.notFound(
							`Function on global "${params.global}"`,
							params.name,
						),
					);
				}

				return executeFunction(definition, request, context);
			},
		},
		realtime: {
			subscribe: async (request, params, context) => {
				if (request.method !== "GET") {
					return handleError(CMSError.badRequest("Method not allowed"));
				}

				if (!cms.realtime) {
					return handleError(CMSError.notImplemented("Realtime"));
				}

				const resolved = await resolveContext(cms, request, config, context);
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					return jsonError(`Collection "${params.collection}" not found`, 404);
				}

				const options = parseFindOptions(new URL(request.url));

				const encoder = new TextEncoder();
				let closeStream: (() => void) | null = null;
				const stream = new ReadableStream({
					start: (controller) => {
						let closed = false;
						let refreshInFlight = false;
						let refreshQueued = false;
						let lastSeq = 0;

						const send = (event: string, data: unknown) => {
							if (closed) return;
							controller.enqueue(
								encoder.encode(
									`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`,
								),
							);
						};

						const sendError = (error: unknown) => {
							const message =
								error instanceof Error ? error.message : "Unknown error";
							send("error", { message });
						};

						const refresh = async (seq?: number) => {
							if (closed) return;
							if (typeof seq === "number") {
								lastSeq = Math.max(lastSeq, seq);
							}
							if (refreshInFlight) {
								refreshQueued = true;
								return;
							}
							refreshInFlight = true;

							try {
								do {
									refreshQueued = false;
									const data = await crud.find(options, resolved.cmsContext);
									send("snapshot", { seq: lastSeq, data });
								} while (refreshQueued && !closed);
							} catch (error) {
								sendError(error);
							} finally {
								refreshInFlight = false;
							}
						};

						// Service handles topic routing + dependency tracking
						const unsubscribe = cms.realtime.subscribe(
							(event) => {
								void refresh(event.seq);
							},
							{
								resourceType: "collection",
								resource: params.collection,
								where: options.where,
								with: options.with,
							},
						);

						const pingTimer = setInterval(() => {
							send("ping", { ts: Date.now() });
						}, 25000);

						const close = () => {
							if (closed) return;
							closed = true;
							clearInterval(pingTimer);
							unsubscribe();
							controller.close();
						};
						closeStream = close;

						if (request.signal) {
							request.signal.addEventListener("abort", close);
						}

						void (async () => {
							try {
								lastSeq = await cms.realtime?.getLatestSeq();
								await refresh(lastSeq);
							} catch (error) {
								sendError(error);
							}
						})();
					},
					cancel: () => {
						closeStream?.();
					},
				});

				return new Response(stream, {
					headers: sseHeaders,
				});
			},
			subscribeGlobal: async (request, params, context) => {
				if (request.method !== "GET") {
					return jsonError("Method not allowed", 405);
				}

				if (!cms.realtime) {
					return jsonError("Realtime not configured", 500);
				}

				const resolved = await resolveContext(cms, request, config, context);
				let globalInstance: any;

				try {
					globalInstance = cms.getGlobalConfig(params.global as any);
				} catch {
					return jsonError(`Global "${params.global}" not found`, 404);
				}

				const crud = globalInstance.generateCRUD(resolved.cmsContext.db, cms);
				const options = parseFindOptions(new URL(request.url));

				const encoder = new TextEncoder();
				let closeStream: (() => void) | null = null;
				const stream = new ReadableStream({
					start: (controller) => {
						let closed = false;
						let refreshInFlight = false;
						let refreshQueued = false;
						let lastSeq = 0;

						const send = (event: string, data: unknown) => {
							if (closed) return;
							controller.enqueue(
								encoder.encode(
									`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`,
								),
							);
						};

						const sendError = (error: unknown) => {
							const message =
								error instanceof Error ? error.message : "Unknown error";
							send("error", { message });
						};

						const refresh = async (seq?: number) => {
							if (closed) return;
							if (typeof seq === "number") {
								lastSeq = Math.max(lastSeq, seq);
							}
							if (refreshInFlight) {
								refreshQueued = true;
								return;
							}
							refreshInFlight = true;

							try {
								do {
									refreshQueued = false;
									const data = await crud.get(options, resolved.cmsContext);
									send("snapshot", { seq: lastSeq, data });
								} while (refreshQueued && !closed);
							} catch (error) {
								sendError(error);
							} finally {
								refreshInFlight = false;
							}
						};

						// Service handles topic routing + dependency tracking
						const unsubscribe = cms.realtime.subscribe(
							(event) => {
								void refresh(event.seq);
							},
							{
								resourceType: "global",
								resource: params.global,
								where: options.where,
								with: options.with,
							},
						);

						const pingTimer = setInterval(() => {
							send("ping", { ts: Date.now() });
						}, 25000);

						const close = () => {
							if (closed) return;
							closed = true;
							clearInterval(pingTimer);
							unsubscribe();
							controller.close();
						};
						closeStream = close;

						if (request.signal) {
							request.signal.addEventListener("abort", close);
						}

						void (async () => {
							try {
								lastSeq = await cms.realtime?.getLatestSeq();
								await refresh(lastSeq);
							} catch (error) {
								sendError(error);
							}
						})();
					},
					cancel: () => {
						closeStream?.();
					},
				});

				return new Response(stream, {
					headers: sseHeaders,
				});
			},
		},
		collections: {
			find: async (request, params, context) => {
				const resolved = await resolveContext(cms, request, config, context);
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					return handleError(
						CMSError.notFound("Collection", params.collection),
					);
				}

				try {
					const options = parseFindOptions(new URL(request.url));
					const result = await crud.find(options, resolved.cmsContext);
					return jsonResponse(result);
				} catch (error) {
					return handleError(error);
				}
			},
			create: async (request, params, context, input) => {
				const resolved = await resolveContext(cms, request, config, context);
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					return handleError(
						CMSError.notFound("Collection", params.collection),
					);
				}

				const body = input !== undefined ? input : await parseJsonBody(request);
				if (body === null) {
					return handleError(CMSError.badRequest("Invalid JSON body"));
				}

				try {
					const result = await crud.create(body, resolved.cmsContext);
					return jsonResponse(result);
				} catch (error) {
					return handleError(error);
				}
			},
			findOne: async (request, params, context) => {
				const resolved = await resolveContext(cms, request, config, context);
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					return handleError(
						CMSError.notFound("Collection", params.collection),
					);
				}

				try {
					const options = parseFindOneOptions(new URL(request.url), params.id);
					const result = await crud.findOne(options, resolved.cmsContext);
					if (!result) {
						return handleError(CMSError.notFound("Record", params.id));
					}
					return jsonResponse(result);
				} catch (error) {
					return handleError(error);
				}
			},
			update: async (request, params, context, input) => {
				const resolved = await resolveContext(cms, request, config, context);
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					return handleError(
						CMSError.notFound("Collection", params.collection),
					);
				}

				const body = input !== undefined ? input : await parseJsonBody(request);
				if (body === null) {
					return handleError(CMSError.badRequest("Invalid JSON body"));
				}

				try {
					const result = await crud.updateById(
						{ id: params.id, data: body },
						resolved.cmsContext,
					);
					return jsonResponse(result);
				} catch (error) {
					return handleError(error);
				}
			},
			remove: async (request, params, context) => {
				const resolved = await resolveContext(cms, request, config, context);
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					return handleError(
						CMSError.notFound("Collection", params.collection),
					);
				}

				try {
					await crud.deleteById({ id: params.id }, resolved.cmsContext);
					return jsonResponse({ success: true });
				} catch (error) {
					return handleError(error);
				}
			},
			restore: async (request, params, context) => {
				const resolved = await resolveContext(cms, request, config, context);
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					return handleError(
						CMSError.notFound("Collection", params.collection),
					);
				}

				try {
					const result = await crud.restoreById(
						{ id: params.id },
						resolved.cmsContext,
					);
					return jsonResponse(result);
				} catch (error) {
					return handleError(error);
				}
			},
		},
		globals: {
			get: async (request, params, context) => {
				const resolved = await resolveContext(cms, request, config, context);

				try {
					const options = parseGlobalGetOptions(new URL(request.url));
					const globalInstance = cms.getGlobalConfig(params.global as any);
					const crud = globalInstance.generateCRUD(resolved.cmsContext.db, cms);
					const result = await crud.get(options, resolved.cmsContext);
					return jsonResponse(result);
				} catch (error) {
					return handleError(error);
				}
			},
			update: async (request, params, context, input) => {
				const resolved = await resolveContext(cms, request, config, context);
				const body = input !== undefined ? input : await parseJsonBody(request);
				if (body === null) {
					return handleError(CMSError.badRequest("Invalid JSON body"));
				}

				try {
					const options = parseGlobalUpdateOptions(new URL(request.url));
					const globalInstance = cms.getGlobalConfig(params.global as any);
					const crud = globalInstance.generateCRUD(resolved.cmsContext.db, cms);
					const result = await crud.update(body, resolved.cmsContext, options);
					return jsonResponse(result);
				} catch (error) {
					return handleError(error);
				}
			},
		},
	};
};

export const createCMSFetchHandler = (
	cms: QCMS<any>,
	config: CMSAdapterConfig = {},
): CMSFetchHandler => {
	const routes = createCMSAdapterRoutes(cms, config);
	const basePath = normalizeBasePath(config.basePath ?? "/cms");

	return async (request, context) => {
		const url = new URL(request.url);
		const pathname = url.pathname;

		const matchesBase =
			basePath === "/"
				? true
				: pathname === basePath || pathname.startsWith(`${basePath}/`);
		if (!matchesBase) {
			return null;
		}

		const relativePath =
			basePath === "/" ? pathname : pathname.slice(basePath.length);
		let segments = relativePath.split("/").filter(Boolean);

		if (segments.length === 0) {
			return handleError(CMSError.notFound("Route"));
		}

		if (segments[0] === "cms") {
			segments = segments.slice(1);
		}

		if (segments.length === 0) {
			return handleError(CMSError.notFound("Route"));
		}

		if (segments[0] === "auth") {
			return routes.auth(request);
		}

		if (segments[0] === "storage" && segments[1] === "upload") {
			return routes.storageUpload(request, context);
		}

		if (segments[0] === "rpc") {
			const functionName = segments[1];
			if (!functionName) {
				return handleError(CMSError.badRequest("Function not specified"));
			}

			return routes.rpc.root(request, { name: functionName }, context);
		}

		if (segments[0] === "collections" && segments[2] === "rpc") {
			const collectionName = segments[1];
			const functionName = segments[3];
			if (!collectionName) {
				return handleError(CMSError.badRequest("Collection not specified"));
			}
			if (!functionName) {
				return handleError(CMSError.badRequest("Function not specified"));
			}

			return routes.rpc.collection(
				request,
				{ collection: collectionName, name: functionName },
				context,
			);
		}

		if (segments[0] === "globals" && segments[2] === "rpc") {
			const globalName = segments[1];
			const functionName = segments[3];
			if (!globalName) {
				return handleError(CMSError.badRequest("Global not specified"));
			}
			if (!functionName) {
				return handleError(CMSError.badRequest("Function not specified"));
			}

			return routes.rpc.global(
				request,
				{ global: globalName, name: functionName },
				context,
			);
		}

		if (segments[0] === "realtime") {
			const maybeGlobals = segments[1];
			if (!maybeGlobals) {
				return handleError(CMSError.badRequest("Collection not specified"));
			}

			if (maybeGlobals === "globals") {
				const globalName = segments[2];
				if (!globalName) {
					return handleError(CMSError.badRequest("Global not specified"));
				}

				if (request.method === "GET") {
					return routes.realtime.subscribeGlobal(
						request,
						{ global: globalName },
						context,
					);
				}

				return handleError(CMSError.badRequest("Method not allowed"));
			}

			if (request.method === "GET") {
				return routes.realtime.subscribe(
					request,
					{ collection: maybeGlobals },
					context,
				);
			}

			return handleError(CMSError.badRequest("Method not allowed"));
		}

		if (segments[0] === "globals") {
			const globalName = segments[1];
			if (!globalName) {
				return handleError(CMSError.badRequest("Global not specified"));
			}

			if (request.method === "GET") {
				return routes.globals.get(request, { global: globalName }, context);
			}

			if (request.method === "PATCH") {
				return routes.globals.update(request, { global: globalName }, context);
			}

			return handleError(CMSError.badRequest("Method not allowed"));
		}

		const collection = segments[0];
		const id = segments[1];
		const action = segments[2];

		if (!id) {
			if (request.method === "GET") {
				return routes.collections.find(request, { collection }, context);
			}

			if (request.method === "POST") {
				return routes.collections.create(request, { collection }, context);
			}

			return handleError(CMSError.badRequest("Method not allowed"));
		}

		if (action === "restore") {
			if (request.method === "POST") {
				return routes.collections.restore(request, { collection, id }, context);
			}

			return handleError(CMSError.badRequest("Method not allowed"));
		}

		if (request.method === "GET") {
			return routes.collections.findOne(request, { collection, id }, context);
		}

		if (request.method === "PATCH") {
			return routes.collections.update(request, { collection, id }, context);
		}

		if (request.method === "DELETE") {
			return routes.collections.remove(request, { collection, id }, context);
		}

		return handleError(CMSError.badRequest("Method not allowed"));
	};
};
