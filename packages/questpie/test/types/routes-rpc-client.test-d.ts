/**
 * Routes / RPC / client type tests — route outputs, key safety, typed ctx.app,
 * and the ServiceCreateContext fallback.
 *
 * Covers:
 * - `.outputSchema()` types the route's output and constrains the handler return
 * - outputs survive the codegen handler erasure (phantom `outputSchema` member)
 * - `client.routes` expands flat keys into nested literal-keyed callers;
 *   phantom route names are compile errors
 * - route handler `ctx.app` comes from the AppContext augmentation (not `any`)
 * - `ServiceCreateContext` has no index signature; typos are compile errors
 *
 * Run with: tsc --noEmit
 */

// Augment AppContext for type tests — simulates what generated code does
declare module "#questpie/server/config/app-context.js" {
	interface AppContext {
		app: {
			collections: {
				probeApps: {
					findOne(options: {
						where: { id: string };
					}): Promise<{ id: string; name: string }>;
				};
			};
		};
	}
}

import { z } from "zod";

import type { QuestpieClient } from "#questpie/client/index.js";
import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import { route } from "#questpie/server/routes/define-route.js";
import type {
	InferRouteInput,
	InferRouteOutput,
	InferRouteParams,
	JsonRouteDefinition,
	JsonRouteHandlerArgs,
	RawRouteDefinition,
	RouteParamsFromKey,
	RouteWithParams,
} from "#questpie/server/routes/types.js";
import {
	service,
	type ServiceCreateContext,
} from "#questpie/server/services/define-service.js";

import type {
	Equal,
	Expect,
	Extends,
	IsAny,
	IsUnknown,
	Not,
} from "./type-test-utils.js";

// ============================================================================
// Route outputs — `.outputSchema()` drives the route's output type
// ============================================================================

// NOTE: handler-RETURN inference is deliberately not captured — a generic
// `.handler<TResult>()` makes `typeof routeConst` depend on the handler arrow,
// which cycles through the app's module type graph (TS2456). Outputs come
// from `.outputSchema()` until codegen emits resolved route signatures.

const echoRoute = route()
	.post()
	.schema(z.object({ message: z.string() }))
	.outputSchema(z.object({ echoed: z.string(), length: z.number() }))
	.handler(async ({ input }) => ({
		echoed: input.message,
		length: input.message.length,
	}));

type EchoOutput = InferRouteOutput<typeof echoRoute>;
type _echoOutput = Expect<Equal<EchoOutput, { echoed: string; length: number }>>;
type _echoOutputNotAny = Expect<Not<IsAny<EchoOutput>>>;
type _echoInput = Expect<
	Equal<InferRouteInput<typeof echoRoute>, { message: string }>
>;

// Without an output schema the output stays `any` (status quo — see NOTE)
const plainRoute = route()
	.post()
	.schema(z.object({ n: z.number() }))
	.handler(({ input }) => ({ doubled: input.n * 2 }));

type _plainOutputIsAny = Expect<IsAny<InferRouteOutput<typeof plainRoute>>>;

// Raw routes still infer `Response`
const rawRoute = route()
	.get()
	.raw()
	.handler(async () => new Response("ok"));

type _rawIsRawDefinition = Expect<Extends<typeof rawRoute, RawRouteDefinition>>;
type _rawOutput = Expect<Equal<InferRouteOutput<typeof rawRoute>, Response>>;

// ============================================================================
// F5 — `.outputSchema()` constrains the handler return
// ============================================================================

route()
	.post()
	.schema(z.object({ q: z.string() }))
	.outputSchema(z.object({ ok: z.boolean() }))
	// @ts-expect-error handler return must match the declared output schema
	.handler(async () => ({ totallyDifferent: 123 }));

// Sync returns are accepted against the schema type
const validatedRoute = route()
	.post()
	.schema(z.object({ q: z.string() }))
	.outputSchema(z.object({ ok: z.boolean(), hits: z.array(z.string()) }))
	.handler(() => ({ ok: true, hits: ["a"] }));

type _outputSchemaWins = Expect<
	Equal<InferRouteOutput<typeof validatedRoute>, { ok: boolean; hits: string[] }>
>;

// ============================================================================
// Codegen erasure survival — outputs ride the phantom `outputSchema` member
// ============================================================================

// Mirrors `_RouteDefinitionWithoutHandler` emitted by codegen (template.ts):
// the handler is erased for heterogeneous route-map assignability.
type ErasedByCodegen<T> = T extends { mode: "raw" }
	? Omit<T, "handler"> & {
			handler: (args: unknown) => Response | Promise<Response>;
		}
	: Omit<T, "handler"> & {
			handler: (args: unknown) => unknown | Promise<unknown>;
		};

type EchoThroughCodegen = RouteWithParams<
	ErasedByCodegen<typeof echoRoute>,
	RouteParamsFromKey<"echo">
>;

type _erasedOutputSurvives = Expect<
	Equal<InferRouteOutput<EchoThroughCodegen>, { echoed: string; length: number }>
>;
type _erasedInputSurvives = Expect<
	Equal<InferRouteInput<EchoThroughCodegen>, { message: string }>
>;

// Param keys flow through RouteWithParams
type ScheduleThroughCodegen = RouteWithParams<
	ErasedByCodegen<typeof echoRoute>,
	RouteParamsFromKey<"barbers/[barberId]/schedule">
>;
type ScheduleParams = InferRouteParams<ScheduleThroughCodegen>;
type _paramKey = Expect<Equal<keyof ScheduleParams, "barberId">>;
type _paramValue = Expect<Equal<ScheduleParams["barberId"], string>>;

// Raw routes survive erasure as raw definitions
type RawThroughCodegen = RouteWithParams<
	ErasedByCodegen<typeof rawRoute>,
	RouteParamsFromKey<"download">
>;
type _rawSurvives = Expect<
	Equal<InferRouteOutput<RawThroughCodegen>, Response>
>;

// ============================================================================
// F2/F3 — client.routes: nested literal keys, typed I/O, phantom keys error
// ============================================================================

const users = collection("users").fields(({ f }) => ({
	name: f.text(255).required(),
}));

type MockRoutes = {
	getSlots: typeof echoRoute;
	"admin/stats": JsonRouteDefinition<
		{ period: "week" | "month" },
		{ total: number },
		{}
	>;
	"admin/users:GET": JsonRouteDefinition<{ q?: string }, { users: string[] }, {}>;
	download: RawRouteDefinition;
};

type ClientApp = {
	collections: { users: typeof users };
	routes: MockRoutes;
};

declare const client: QuestpieClient<ClientApp>;

// Flat camelCase keys are direct callers with typed input AND output
type GetSlots = typeof client.routes.getSlots;
type _slotsInput = Expect<Equal<Parameters<GetSlots>[0], { message: string }>>;
type _slotsOutput = Expect<
	Equal<Awaited<ReturnType<GetSlots>>, { echoed: string; length: number }>
>;

// Slash keys expand into nested namespaces — the documented call style
type AdminStats = typeof client.routes.admin.stats;
type _statsInput = Expect<
	Equal<Parameters<AdminStats>[0], { period: "week" | "month" }>
>;
type _statsOutput = Expect<
	Equal<Awaited<ReturnType<AdminStats>>, { total: number }>
>;

// `:METHOD`-suffixed keys expose only that method as a leaf caller
type AdminUsersGet = typeof client.routes.admin.users.get;
type _usersGetOutput = Expect<
	Equal<Awaited<ReturnType<AdminUsersGet>>, { users: string[] }>
>;

// Raw routes return the raw Response
type _downloadOutput = Expect<
	Equal<Awaited<ReturnType<typeof client.routes.download>>, Response>
>;

// Phantom route names are compile errors (no index-signature poisoning)
// @ts-expect-error unknown route name must not typecheck
void client.routes.thisRouteDoesNotExist;
// @ts-expect-error unknown nested route name must not typecheck
void client.routes.admin.nope;

// Apps without routes get an empty routes surface
type NoRoutesApp = { collections: { users: typeof users } };
type _noRoutes = Expect<Equal<QuestpieClient<NoRoutesApp>["routes"], {}>>;

// ============================================================================
// F4 — route handler ctx.app is the augmented app, not `any`
// ============================================================================

route()
	.post()
	.schema(z.object({ id: z.string() }))
	.handler(async (ctx) => {
		type _appNotAny = Expect<Not<IsAny<typeof ctx.app>>>;

		const doc = await ctx.app.collections.probeApps.findOne({
			where: { id: ctx.input.id },
		});
		type _docTyped = Expect<Equal<typeof doc, { id: string; name: string }>>;

		// @ts-expect-error unknown collection on the typed app must error
		void ctx.app.collections.nope;

		return { ok: true };
	});

// Raw handlers see the same augmented app
route()
	.get()
	.raw()
	.handler(async (ctx) => {
		type _appNotAny = Expect<Not<IsAny<typeof ctx.app>>>;
		return new Response("ok");
	});

// Handler args default input to `unknown`, not `any`
type _defaultInputUnknown = Expect<IsUnknown<JsonRouteHandlerArgs["input"]>>;

// ============================================================================
// F5 — ServiceCreateContext: no index signature, typed app fallback
// ============================================================================

service({
	create: (ctx) => {
		// @ts-expect-error unknown context keys are compile errors, not silent any
		void ctx.totallyMadeUpKey;

		type _serviceAppNotAny = Expect<Not<IsAny<typeof ctx.app>>>;
		return { ok: true };
	},
});

// The resolved context always carries the app instance pre-codegen
type _serviceCtxHasApp = Expect<Extends<ServiceCreateContext, { app: unknown }>>;
