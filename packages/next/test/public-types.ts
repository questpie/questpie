import {
	questpieNextRouteHandlers,
	type NextAdapterConfig,
} from "../src/server.js";

const safeConfig = {
	basePath: "/api",
	requestLogging: false,
	search: { reindexAccess: false },
	getSession: async () => null,
	getLocale: () => "en",
	extendContext: () => ({ organizationId: "org" }),
} satisfies NextAdapterConfig;

const trustedHostCompatibility: NextAdapterConfig = { accessMode: "system" };
void trustedHostCompatibility;

// Generated apps can come from a separately installed copy of `questpie`.
// The adapter follows the core Fetch seam and accepts that runtime value
// without imposing the nominal Questpie class identity on consumers.
const handlers = questpieNextRouteHandlers({}, safeConfig);
void handlers.GET;
void handlers.POST;
void handlers.PUT;
void handlers.PATCH;
void handlers.DELETE;
void handlers.OPTIONS;
void handlers.HEAD;
// @ts-expect-error Only the seven supported App Router exports exist.
void handlers.TRACE;
