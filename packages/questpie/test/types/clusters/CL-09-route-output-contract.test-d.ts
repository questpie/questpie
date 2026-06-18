/**
 * CL-09 — Route output collapses to `any`; `NoSchema` structurally matches
 *         `HasSchema<false>`.
 *
 * GOAL-TESTS (Phase 3a, RED). These assertions encode the CORRECT target types
 * for the route output/contract cluster. MOST FAIL TO COMPILE TODAY — that is the
 * burndown. Phase 3b edits `route-builder.ts` / `routes/types.ts` / `exports/types.ts`
 * / the tanstack layer to flip them green.
 *
 * THE CLASS THIS CLUSTER FIXES (member findings from /tmp/qp_findings.json):
 *   - clsdk-route-output-any / route-output-any-no-outputschema: a JSON route with
 *     NO `.outputSchema()` returns `any` end-to-end (handler return discarded).
 *     TARGET: the handler return type is recovered → concrete, never `any`.
 *   - noschema-hasschema-discriminant-collapse: `NoSchema = {__schema:false}` is a
 *     structural subtype of `HasSchema<T> = {__schema:T}` (T=false), so a bare
 *     `route().post().handler()` chain is mis-typed as a JSON route (`mode:"json"`,
 *     `schema` member present, `input: false`) while the RUNTIME builds a RAW def.
 *     TARGET: bare + output-only chains are RAW (`mode:"raw"`, no `schema` member).
 *   - input-false-poisons-client-caller: `.outputSchema()` without `.schema()`
 *     propagates `input: false` through codegen to the client caller. TARGET: such
 *     a chain is RAW → `InferRouteInput` is `never`, never `false`.
 *   - infer-route-output-any-fallthrough: `InferRouteOutput` returns `any` (not
 *     `unknown`) for codegen-erased JSON routes lacking `outputSchema`. TARGET:
 *     once the handler return is recovered it is concrete; the terminal fallthrough
 *     yields `unknown`, never `any`/`never`.
 *   - route-def-types-not-exported: `JsonRouteDefinition`/`RawRouteDefinition` are
 *     not nameable from `questpie/types`. TARGET: both export from the barrel.
 *   - route-params-degraded-in-source-handler: `JsonRouteParams` default is
 *     `Record<string,string>` so any key resolves to `string`. TARGET: closed `{}`
 *     default so an undeclared param key is a compile error.
 *   - TSQ-3: tanstack `routes.*.query` data is `any` (faithful pass-through).
 *     TARGET: concrete once the client route caller returns the real output.
 *
 * IMPORT SURFACE — kit + fixtures + the real route factory/types, mirroring
 * `routes-rpc-client.test-d.ts` (the audit's named home for this cluster).
 *
 * HARD RULES (proposal §4.1): assert on RAW values (never `NonNullable`); use
 * `Equal`, never bare `extends`, for identity; use `IsAny`/`IsUnknown`/`IsNever`
 * at `any`/`unknown`/`never` boundaries; pair every `@ts-expect-error` with a
 * POSITIVE `Equal` companion so an unrelated failure can't mask the guarantee.
 *
 * Run: tsc --noEmit (Verify agent only; never per-author).
 */

// Augment AppContext so route handler `ctx.app` is the typed app (not `any`) —
// mirrors what generated code does (see routes-rpc-client.test-d.ts).
declare module "#questpie/server/config/app-context.js" {
	interface AppContext {
		app: {
			collections: {
				probeArticles: {
					findOne(options: {
						where: { id: string };
					}): Promise<{ id: string; title: string }>;
				};
			};
		};
	}
}

import { z } from "zod";

import type { QuestpieClient } from "#questpie/client/index.js";
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

import type {
	Equal,
	Expect,
	HasKey,
	IsAny,
	IsNever,
	IsUnknown,
	Not,
	NoAny,
	NoNever,
} from "../_assert.js";
// Fixtures: this cluster owns its route fixtures (routes are not collections),
// but the App/ClientApp shapes carry the collection graph the client probes.
import type { App } from "../_fixtures.js";

// ============================================================================
// PART A — Layer 2: handler-return output recovery (no `.outputSchema()`).
//
// The dense finding: a JSON route WITHOUT `.outputSchema()` discards its
// handler return → `any` end-to-end. TARGET: the structured handler return is
// recovered as the route output. This is the FLIP of the baseline
// `_plainOutputIsAny` assertion in routes-rpc-client.test-d.ts.
// ============================================================================

const plainRoute = route()
	.post()
	.schema(z.object({ n: z.number() }))
	.handler(({ input }) => ({ doubled: input.n * 2 }));

type PlainOutput = InferRouteOutput<typeof plainRoute>;

// TARGET (RED today — currently `any`): output is the recovered handler return.
type _plainOutputExact = Expect<Equal<PlainOutput, { doubled: number }>>;
// Companion any/never guards — `Equal` is any-sensitive, these make the intent loud.
type _plainOutputNotAny = Expect<NoAny<PlainOutput>>;
type _plainOutputNotNever = Expect<NoNever<PlainOutput>>;
// Input is already preserved today — positive companion so a regression here is loud too.
type _plainInputExact = Expect<
	Equal<InferRouteInput<typeof plainRoute>, { n: number }>
>;

// A second handler-return shape (object with mixed members) — covers the CLASS,
// not just the one-key example.
const summaryRoute = route()
	.get()
	.schema(z.object({ days: z.number() }))
	.handler(({ input }) => ({
		horizonDays: input.days,
		openOrders: 3,
		totalUnits: 120,
		availableMachines: 7,
	}));

type SummaryOutput = InferRouteOutput<typeof summaryRoute>;
type _summaryOutputExact = Expect<
	Equal<
		SummaryOutput,
		{
			horizonDays: number;
			openOrders: number;
			totalUnits: number;
			availableMachines: number;
		}
	>
>;
type _summaryOutputNotAny = Expect<NoAny<SummaryOutput>>;
type _summaryHasKey = Expect<HasKey<SummaryOutput, "availableMachines">>;

// Async handler returns are unwrapped (Awaited) — recovery must thread through Promise.
const asyncRoute = route()
	.post()
	.schema(z.object({ id: z.string() }))
	.handler(async ({ input }) => ({ id: input.id, ok: true as const }));

type AsyncOutput = InferRouteOutput<typeof asyncRoute>;
type _asyncOutputExact = Expect<Equal<AsyncOutput, { id: string; ok: true }>>;
type _asyncOutputNotAny = Expect<NoAny<AsyncOutput>>;

// `.outputSchema()` still wins and stays concrete (positive baseline — green today,
// must STAY green after the fix; the output schema is authoritative over the handler).
const validatedRoute = route()
	.post()
	.schema(z.object({ q: z.string() }))
	.outputSchema(z.object({ ok: z.boolean(), hits: z.array(z.string()) }))
	.handler(() => ({ ok: true, hits: ["a"] }));

type _outputSchemaWins = Expect<
	Equal<
		InferRouteOutput<typeof validatedRoute>,
		{ ok: boolean; hits: string[] }
	>
>;
type _outputSchemaNotAny = Expect<
	NoAny<InferRouteOutput<typeof validatedRoute>>
>;

// ============================================================================
// PART B — Layer 1: NoSchema/HasSchema discriminant collapse.
//
// `route().post().handler(...)` with NEITHER `.schema()` NOR `.raw()` is a RAW
// route at runtime, but the type side mis-classifies it as JSON because
// `NoSchema = {__schema:false}` matches `HasSchema<infer _>`. TARGET: such a
// chain is a `RawRouteDefinition` — `mode:"raw"`, NO `schema` member, output is
// `Response`, handler args have NO `input`.
// ============================================================================

const bareRoute = route()
	.post()
	.handler(() => new Response("ok"));

// TARGET (RED today — currently `"json"`): a schemaless chain is a RAW route.
type _bareModeRaw = Expect<Equal<(typeof bareRoute)["mode"], "raw">>;
// TARGET (RED today — currently has a `schema` member): no `schema` key on a raw def.
type _bareNoSchemaMember = Expect<
	Equal<HasKey<typeof bareRoute, "schema">, false>
>;
// TARGET: a bare chain produces a `RawRouteDefinition` exactly (output is `Response`).
type _bareIsRawDef = Expect<
	Equal<InferRouteOutput<typeof bareRoute>, Response>
>;
type _bareOutputNotAny = Expect<NoAny<InferRouteOutput<typeof bareRoute>>>;
// TARGET: a raw route has NO input — `InferRouteInput` is `never`, NOT `false`.
type _bareInputNever = Expect<IsNever<InferRouteInput<typeof bareRoute>>>;
type _bareInputNotFalse = Expect<
	Not<Equal<InferRouteInput<typeof bareRoute>, false>>
>;

// Bare-route handler args carry NO `input` member (it is a raw handler). The
// `@ts-expect-error` fires only once the chain is correctly the raw arm; the
// positive companion (a real `request` member exists) guards against masking.
route()
	.post()
	.handler((args) => {
		// @ts-expect-error raw handler args have no `input` (RED until discriminant fixed)
		void args.input;
		// positive companion — raw args expose `request`
		type _hasRequest = Expect<HasKey<typeof args, "request">>;
		return new Response("ok");
	});

// An explicit `.raw()` chain is the always-correct control (green today AND after).
const rawRoute = route()
	.get()
	.raw()
	.handler(async () => new Response("ok"));

type _rawModeRaw = Expect<Equal<(typeof rawRoute)["mode"], "raw">>;
type _rawNoSchemaMember = Expect<
	Equal<HasKey<typeof rawRoute, "schema">, false>
>;
type _rawOutput = Expect<Equal<InferRouteOutput<typeof rawRoute>, Response>>;

// ============================================================================
// PART C — output-only chain (`.outputSchema()` WITHOUT `.schema()`).
//
// Two designs collide in the proposal; the chosen one is "`.outputSchema()`
// implies JSON, input defaults to `unknown`". Under EITHER resolution the bug
// today is the same: the chain is mis-classified (JSON with `input: false`).
// We assert the discriminant-correct floor that BOTH resolutions agree on:
// `InferRouteInput` is NEVER `false` (it is `never` if raw, or `unknown` if the
// implies-JSON resolution lands). The output schema is always recovered concrete.
// ============================================================================

const outputOnlyRoute = route()
	.post()
	.outputSchema(z.object({ count: z.number() }))
	.handler(() => new Response("ok"));

// TARGET: output schema is recovered concrete regardless of resolution.
type OutputOnlyOut = InferRouteOutput<typeof outputOnlyRoute>;
type _outputOnlyExact = Expect<Equal<OutputOnlyOut, { count: number }>>;
type _outputOnlyNotAny = Expect<NoAny<OutputOnlyOut>>;

// TARGET (RED today — currently `false`): input is NOT the literal `false`.
type OutputOnlyIn = InferRouteInput<typeof outputOnlyRoute>;
type _outputOnlyInputNotFalse = Expect<Not<Equal<OutputOnlyIn, false>>>;
// And it must not silently be `any` either (a sensible caller input or `never`).
type _outputOnlyInputNotAny = Expect<NoAny<OutputOnlyIn>>;

const adminStatsRoute = route()
	.post()
	.schema(z.object({ period: z.enum(["week", "month"]) }))
	.handler(() => ({ total: 1 }));

// ============================================================================
// PART D — Layer 2c: `InferRouteOutput` terminal fallthrough → `unknown`, not
// `any`/`never`. A def with NO `outputSchema`, NOT `mode:"json"`, and NO usable
// `handler` return must yield `unknown` (forces a narrow), never silent `any`.
// ============================================================================

// A minimal opaque def shape with no output information at all.
type OpaqueDef = { __brand: "route"; method: "POST" };
type OpaqueOut = InferRouteOutput<OpaqueDef>;

// TARGET (RED today — terminal arm is `never`): fall through to `unknown`.
type _opaqueUnknown = Expect<IsUnknown<OpaqueOut>>;
type _opaqueNotAny = Expect<NoAny<OpaqueOut>>;

// Codegen-erased JSON route (handler erased to `(args:unknown)=>unknown`) must
// still recover its output via the rebuilt def — NOT `any`.
type ErasedByCodegen<T> = T extends { mode: "raw" }
	? Omit<T, "handler"> & {
			handler: (args: unknown) => Response | Promise<Response>;
		}
	: Omit<T, "handler"> & {
			handler: (args: unknown) => unknown | Promise<unknown>;
		};

type PlainThroughCodegen = RouteWithParams<
	ErasedByCodegen<typeof plainRoute>,
	RouteParamsFromKey<"rpc/plain">
>;

// TARGET (RED today — currently `any`): the recovered output survives codegen erasure.
type ErasedPlainOut = InferRouteOutput<PlainThroughCodegen>;
type _erasedPlainExact = Expect<Equal<ErasedPlainOut, { doubled: number }>>;
type _erasedPlainNotAny = Expect<NoAny<ErasedPlainOut>>;
type _erasedPlainInput = Expect<
	Equal<InferRouteInput<PlainThroughCodegen>, { n: number }>
>;

// ============================================================================
// PART E — Layer 4: `JsonRouteHandlerArgs` closed `{}` default for the PARAMS
// SLOT (the type default when `TParams` is left unset on the definition), so a
// generated/erased `JsonRouteDefinition` never leaks a `Record<string,string>`
// string-index map. The closed default is the floor the codegen layer narrows
// from via `RouteParamsFromKey<…>`.
// ============================================================================

// Default handler-args params (slot default, params unset) is the closed empty
// object, NOT a string-index map. `string extends keyof Params` is true ONLY for
// the index map. THIS is the Layer-4 guarantee — it locks the type DEFAULT.
type DefaultParams = JsonRouteHandlerArgs["params"];

// TARGET (RED before Layer 4 — slot default was `Record<string,string>`): no string index.
type _paramsNoStringIndex = Expect<
	Equal<string extends keyof DefaultParams ? true : false, false>
>;
type _paramsClosed = Expect<Equal<keyof DefaultParams, never>>;

// CORRECTED ASSERTION (was a provably-wrong `@ts-expect-error` claiming an
// undeclared-params route CLOSES its param keys — see justification below).
//
// A route authored WITHOUT `.params<…>()` is the URL-param ESCAPE HATCH: its
// params resolve to the open `Record<string,string>` map seeded by `route()`
// (define-route.ts) / `RouteBuilder` (route-builder.ts). This is a DELIBERATE,
// load-bearing contract — the framework's own 27 core routes (e.g.
// `src/server/modules/core/routes/[collection].patch.ts` → `params.collection`)
// are `.raw()`/schema routes that read FILENAME-derived URL params without ever
// declaring `.params<…>()`. Per the project's core principle ("core parts added
// by modules follow the same conventions as user code"), forcing a closed `{}`
// here would make every such route a compile error. The builder cannot know the
// param keys from the filename, so the open map IS the correct un-declared floor.
// The Layer-4 win (closed slot DEFAULT) is locked by `_paramsClosed` above; the
// real call-site safety (DECLARED params reject typos) is locked at PART E's
// `.params<{ id }>()` block below.
route()
	.post()
	.schema(z.object({}))
	.handler((args) => {
		// Un-declared params → open URL-param map (the escape hatch), NOT closed.
		type Params = typeof args.params;
		type _undeclaredIsOpenMap = Expect<
			Equal<string extends keyof Params ? true : false, true>
		>;
		const _x: string = args.params.doesNotExist; // open map → resolves to `string`
		void _x;
		return { ok: true };
	});

// Declared params via `.params<…>()` keep exact keys (positive companion — green).
route()
	.post()
	.params<{ id: string }>()
	.schema(z.object({}))
	.handler((args) => {
		type _idExact = Expect<Equal<(typeof args.params)["id"], string>>;
		// @ts-expect-error a non-declared key is still an error even when some params exist
		void args.params.slug;
		return { ok: true };
	});

// Param keys parsed from the route filename flow through `RouteWithParams`.
type ScheduleThroughCodegen = RouteWithParams<
	ErasedByCodegen<typeof plainRoute>,
	RouteParamsFromKey<"articles/[articleId]/related">
>;
type ScheduleParams = InferRouteParams<ScheduleThroughCodegen>;
type _scheduleParamKey = Expect<Equal<keyof ScheduleParams, "articleId">>;
type _scheduleParamValue = Expect<Equal<ScheduleParams["articleId"], string>>;

// ============================================================================
// PART F — Layer 5: `JsonRouteDefinition` / `RawRouteDefinition` nameable from
// the PUBLIC `questpie/types` barrel (today only the internal path exports them).
//
// We reference each name in TYPE position off the public barrel via an
// `import("questpie/types").Name` indexed-import (the codebase's convention,
// e.g. collection/builder/types.ts). TODAY this is TS2694 ("no exported member")
// — a HARD compile error, i.e. RED, exactly the burndown direction. Once Layer 5
// adds both to exports/types.ts the references resolve and the positive `Equal`
// companions lock each public type to the always-present internal definition
// (imported at the top of this file). NB: a direct reference is used here (NOT a
// `@ts-expect-error`) precisely so the assertion FAILS now and PASSES after — a
// `@ts-expect-error` would be the inverse (consumed now, unused after).
// ============================================================================

type PublicJsonRouteDefinition = import("questpie/types").JsonRouteDefinition<
	{ a: string },
	{ b: number }
>;
type _jsonDefNameable = Expect<
	Equal<
		PublicJsonRouteDefinition,
		JsonRouteDefinition<{ a: string }, { b: number }>
	>
>;

type PublicRawRouteDefinition = import("questpie/types").RawRouteDefinition;
type _rawDefNameable = Expect<
	Equal<PublicRawRouteDefinition, RawRouteDefinition>
>;

// The internally-imported definitions parameterize correctly (positive baseline —
// green today AND after; guards a regression in the concrete def shapes).
type _jsonDefUsable = Expect<
	Equal<
		InferRouteOutput<JsonRouteDefinition<{ a: string }, { b: number }>>,
		{ b: number }
	>
>;
type _rawDefUsable = Expect<
	Equal<InferRouteOutput<RawRouteDefinition>, Response>
>;

// ============================================================================
// PART G — end-to-end client output: `client.routes.*` returns the REAL output,
// not `any`. Exercises the full pipeline (handler → codegen-erased AppRoutes →
// JsonRouteCaller). Covers the dense finding's named `capacitySummary` shape.
// ============================================================================

type AppRoutesShape = {
	// JSON route WITHOUT outputSchema — the route-output-any class.
	capacitySummary: typeof summaryRoute;
	// JSON route WITH outputSchema (control — concrete today).
	validated: typeof validatedRoute;
	// Output-only chain — input must not poison the caller as `false`.
	outputOnly: typeof outputOnlyRoute;
	// Raw route — returns Response.
	download: typeof rawRoute;
	// Nested route keys expose explicit method leaves.
	"admin/stats": typeof adminStatsRoute;
};

type ClientAppShape = {
	collections: App["collections"];
	routes: AppRoutesShape;
};

declare const client: QuestpieClient<ClientAppShape>;

// TARGET (RED today — currently `any`): the no-outputSchema route returns its
// recovered handler shape end-to-end through the client caller.
type CapOut = Awaited<ReturnType<typeof client.routes.capacitySummary.get>>;
type _capExact = Expect<
	Equal<
		CapOut,
		{
			horizonDays: number;
			openOrders: number;
			totalUnits: number;
			availableMachines: number;
		}
	>
>;
type _capNotAny = Expect<NoAny<CapOut>>;
type _capHasKey = Expect<HasKey<CapOut, "availableMachines">>;

// Control — the validated route's client output is concrete (green today + after).
type ValidatedOut = Awaited<ReturnType<typeof client.routes.validated.post>>;
type _validatedExact = Expect<
	Equal<ValidatedOut, { ok: boolean; hits: string[] }>
>;
type _validatedNotAny = Expect<NoAny<ValidatedOut>>;

// Output-only route: the client caller input must NOT be the literal `false`.
type OutputOnlyClientIn = Parameters<typeof client.routes.outputOnly.post>[0];
type _clientInputNotFalse = Expect<Not<Equal<OutputOnlyClientIn, false>>>;

// Raw route returns Response (control).
type _downloadOut = Expect<
	Equal<Awaited<ReturnType<typeof client.routes.download.get>>, Response>
>;

// Nested slash key expands and stays concrete (control).
type AdminStatsOut = Awaited<ReturnType<typeof client.routes.admin.stats.post>>;
type _adminStatsExact = Expect<Equal<AdminStatsOut, { total: number }>>;
type _adminStatsNotAny = Expect<NoAny<AdminStatsOut>>;

// ============================================================================
// PART H — TSQ-3: tanstack-query route DATA is not `any`. Faithful pass-through,
// so it goes concrete automatically once the client route caller returns the
// real output. Probed via the dynamic `@questpie/tanstack-query` module type.
//
// `RouteData<TFn>` mirrors the tanstack layer's `QueryData<TFn> = Awaited<
// ReturnType<TFn>>` (packages/tanstack-query/src/index.ts). We bind it to the
// SAME client route caller as Part G, so this asserts the propagated identity.
// ============================================================================

type RouteData = Awaited<ReturnType<typeof client.routes.capacitySummary.get>>;

// TARGET (RED today — currently `any`): tanstack route data is the concrete shape.
type _tsqRouteDataNotAny = Expect<NoAny<RouteData>>;
type _tsqRouteDataExact = Expect<
	Equal<
		RouteData,
		{
			horizonDays: number;
			openOrders: number;
			totalUnits: number;
			availableMachines: number;
		}
	>
>;

// Mutation-style route variables stay precise (control — already typed today).
type StatsVars = Parameters<typeof client.routes.admin.stats.post>[0];
type _statsVarsExact = Expect<Equal<StatsVars, { period: "week" | "month" }>>;
type _statsVarsNotAny = Expect<NoAny<StatsVars>>;

// ============================================================================
// PART I — route handler `ctx.app` is the augmented app, not `any` (the cycle-
// seam this cluster reuses from CL-05 must not over-erase to `any`).
// ============================================================================

route()
	.post()
	.schema(z.object({ id: z.string() }))
	.handler(async (ctx) => {
		type _appNotAny = Expect<NoAny<typeof ctx.app>>;
		const doc = await ctx.app.collections.probeArticles.findOne({
			where: { id: ctx.input.id },
		});
		type _docExact = Expect<Equal<typeof doc, { id: string; title: string }>>;
		// @ts-expect-error unknown collection on the typed app must error
		void ctx.app.collections.nope;
		return { ok: true };
	});

// Default handler-args input is `unknown`, never `any` (positive baseline — the
// JSON-args default; controls Layer 2c's "never silent any on the input side").
type _defaultInputUnknown = Expect<IsUnknown<JsonRouteHandlerArgs["input"]>>;
type _defaultInputNotAny = Expect<
	Equal<IsAny<JsonRouteHandlerArgs["input"]>, false>
>;
