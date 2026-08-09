import type { Questpie } from "questpie";

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

const handlers = questpieNextRouteHandlers({} as Questpie<any>, safeConfig);
void handlers.GET;
void handlers.POST;
void handlers.PUT;
void handlers.PATCH;
void handlers.DELETE;
void handlers.OPTIONS;
void handlers.HEAD;
// @ts-expect-error Only the seven supported App Router exports exist.
void handlers.TRACE;
