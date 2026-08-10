/**
 * Routes and Jobs Type Tests
 *
 * These tests verify that TypeScript correctly infers types for
 * route definitions (route()) and background jobs (job()).
 *
 * Run with: tsc --noEmit
 */

import { z } from "zod";

import { job } from "#questpie/server/modules/core/integrated/queue/job.js";
import type { JobDefinition } from "#questpie/server/modules/core/integrated/queue/types.js";
import { route } from "#questpie/server/routes/define-route.js";
import type {
	InferRouteParams,
	JsonRouteDefinition,
	RouteParamsFromKey,
	RawRouteDefinition,
	RouteWithParams,
} from "#questpie/server/routes/types.js";
import { isJsonRoute, isRawRoute } from "#questpie/server/routes/types.js";

// Augment AppContext for type tests — simulates what generated code does
declare module "#questpie/server/config/app-context.js" {
	interface AppContext {
		session: { user: { id: string } } | null;
		db: any;
	}
}

import type { Equal, Expect, Extends, HasKey } from "./type-test-utils.js";

// ============================================================================
// route() - JSON route type tests
// ============================================================================

// Route with input schema should infer input type correctly
const pingRoute = route()
	.post()
	.schema(
		z.object({
			message: z.string(),
			count: z.number().optional(),
		}),
	)
	.handler(async ({ input }) => {
		// input should have correct types
		const msg: string = input.message;
		const cnt: number | undefined = input.count;
		return { received: msg, count: cnt };
	});

type PingRouteType = typeof pingRoute;
type _pingIsJsonRoute = Expect<
	Extends<PingRouteType, JsonRouteDefinition<any, any>>
>;

// Route output type should be inferred from handler return
const addRoute = route()
	.post()
	.schema(z.object({ a: z.number(), b: z.number() }))
	.handler(async ({ input }) => {
		return { sum: input.a + input.b, timestamp: new Date() };
	});

type AddRouteType = typeof addRoute;
type AddHandlerReturn = Awaited<ReturnType<AddRouteType["handler"]>>;
type _addHasSumInOutput = Expect<Equal<HasKey<AddHandlerReturn, "sum">, true>>;
type _addHasTimestamp = Expect<
	Equal<HasKey<AddHandlerReturn, "timestamp">, true>
>;

// Route with explicit output schema
const validateRoute = route()
	.post()
	.schema(z.object({ data: z.string() }))
	.outputSchema(
		z.object({
			valid: z.boolean(),
			errors: z.array(z.string()),
		}),
	)
	.handler(async ({ input: _input }) => {
		return { valid: true, errors: [] };
	});

type ValidateRouteType = typeof validateRoute;
type _validateHasOutputSchema = Expect<
	Equal<HasKey<ValidateRouteType, "outputSchema">, true>
>;

// Route with session context
const _protectedRoute = route()
	.post()
	.schema(z.object({ action: z.string() }))
	.handler(async ({ input: _input, session }) => {
		const _userId = session?.user?.id;
		return { success: true, userId: _userId };
	});

// Complex input schema should preserve nested types
const _complexRoute = route()
	.post()
	.schema(
		z.object({
			user: z.object({
				name: z.string(),
				email: z.string().email(),
				preferences: z.object({
					theme: z.enum(["light", "dark"]),
					notifications: z.boolean(),
				}),
			}),
			tags: z.array(z.string()),
			metadata: z.record(z.string(), z.unknown()).optional(),
		}),
	)
	.handler(async ({ input }) => {
		const _theme = input.user.preferences.theme;
		const _tags = input.tags;
		return { processed: true };
	});

// GET route should work
const getRoute = route()
	.get()
	.schema(z.object({ id: z.string() }))
	.handler(async ({ input }) => {
		return { id: input.id, found: true };
	});

type GetRouteType = typeof getRoute;
// Method literal is not preserved in the definition type (runtime value only)
type _getRouteHasMethod = Expect<Equal<HasKey<GetRouteType, "method">, true>>;

// Raw route should have correct type
const rawRoute = route()
	.post()
	.raw()
	.handler(async ({ request: _request }) => {
		return new Response("ok");
	});

type RawRouteType = typeof rawRoute;
type _rawIsRawRoute = Expect<Extends<RawRouteType, RawRouteDefinition>>;

const rawRouteWithTypedParams = route()
	.params<RouteParamsFromKey<"apps/[appId]/install">>()
	.post()
	.raw()
	.handler(async ({ params }) => {
		const appId: string = params.appId;
		return new Response(appId);
	});

type RawRouteWithTypedParamsType = typeof rawRouteWithTypedParams;
type _rawRouteParams = Expect<
	Equal<InferRouteParams<RawRouteWithTypedParamsType>, { appId: string }>
>;

const jsonRouteWithRequestAndParams = route<
	RouteParamsFromKey<"pairing/[tokenId]">
>()
	.post()
	.schema(z.object({ ok: z.boolean() }))
	.handler(async ({ input, request, params }) => {
		const requestUrl: string | undefined = request?.url;
		const tokenId: string = params.tokenId;
		return { ok: input.ok, requestUrl, tokenId };
	});

type JsonRouteWithRequestAndParamsType = typeof jsonRouteWithRequestAndParams;
type _jsonRouteParams = Expect<
	Equal<
		InferRouteParams<JsonRouteWithRequestAndParamsType>,
		{ tokenId: string }
	>
>;

type _wrappedRouteParams = Expect<
	Equal<
		InferRouteParams<
			RouteWithParams<
				typeof rawRoute,
				RouteParamsFromKey<"apps/[appId]/install">
			>
		>,
		{ appId: string }
	>
>;

// ============================================================================
// job() - Background jobs type tests
// ============================================================================

// Job name should be inferred as literal type
const sendEmailJob = job({
	name: "send-email",
	schema: z.object({
		to: z.string().email(),
		subject: z.string(),
		body: z.string(),
	}),
	handler: async ({ payload: _payload }) => {
		// payload should have correct types
		const _to: string = _payload.to;
		const _subject: string = _payload.subject;
	},
});

type SendEmailJobType = typeof sendEmailJob;
type SendEmailJobName = SendEmailJobType["name"];
type _sendEmailNameIsLiteral = Expect<Equal<SendEmailJobName, "send-email">>;

// Job payload type should be inferred from schema
const processImageJob = job({
	name: "process-image",
	schema: z.object({
		imageId: z.string(),
		operations: z.array(
			z.object({
				type: z.enum(["resize", "crop", "rotate"]),
				params: z.record(z.string(), z.number()),
			}),
		),
	}),
	handler: async ({ payload }) => {
		const _imageId: string = payload.imageId;
		const ops = payload.operations;
		return { processed: true, operationCount: ops.length };
	},
});

type ProcessImageJobType = typeof processImageJob;
type _processImageIsJobDef = Expect<
	Extends<ProcessImageJobType, JobDefinition<any, any, any>>
>;

// Job result type should be inferred from handler return
const calculateJob = job({
	name: "calculate-stats",
	schema: z.object({ datasetId: z.string() }),
	handler: async ({ payload: _payload }) => {
		return {
			mean: 0,
			median: 0,
			standardDeviation: 0,
			count: 100,
		};
	},
});

type CalculateJobType = typeof calculateJob;
type _calculateHasHandler = Expect<
	Extends<
		CalculateJobType,
		{
			handler: (...args: any[]) => Promise<{ mean: number; count: number }>;
		}
	>
>;

// Job with app in handler context
const _notifyJob = job({
	name: "notify-users",
	schema: z.object({ userIds: z.array(z.string()), message: z.string() }),
	handler: async ({ payload, db: _db }) => {
		const users = payload.userIds;
		return { notified: users.length };
	},
});

// Job with optional fields in schema
const _syncJob = job({
	name: "sync-data",
	schema: z.object({
		source: z.string(),
		destination: z.string(),
		options: z.object({ force: z.boolean(), dryRun: z.boolean() }).optional(),
	}),
	handler: async ({ payload }) => {
		const _force = payload.options?.force;
		const _dryRun = payload.options?.dryRun;
		return { synced: true };
	},
});

// ============================================================================
// Type inference edge cases
// ============================================================================

// Void return in job handler
const _logJob = job({
	name: "log-event",
	schema: z.object({ event: z.string() }),
	handler: async ({ payload }) => {
		console.log(payload.event);
	},
});

// Union types in schema
const _actionRoute = route()
	.post()
	.schema(
		z.object({
			action: z.union([
				z.object({ type: z.literal("create"), data: z.string() }),
				z.object({ type: z.literal("delete"), id: z.string() }),
			]),
		}),
	)
	.handler(async ({ input }) => {
		if (input.action.type === "create") {
			return { created: input.action.data };
		}
		return { deleted: input.action.id };
	});

// Discriminated unions
const _webhookJob = job({
	name: "process-webhook",
	schema: z.discriminatedUnion("type", [
		z.object({
			type: z.literal("payment"),
			amount: z.number(),
			currency: z.string(),
		}),
		z.object({
			type: z.literal("subscription"),
			planId: z.string(),
			action: z.enum(["created", "cancelled"]),
		}),
	]),
	handler: async ({ payload }) => {
		if (payload.type === "payment") {
			return { processed: "payment", amount: payload.amount };
		}
		return { processed: "subscription", plan: payload.planId };
	},
});

// Nullable schema fields
const _updateRoute = route()
	.post()
	.schema(
		z.object({
			id: z.string(),
			name: z.string().nullable(),
			description: z.string().nullish(),
		}),
	)
	.handler(async ({ input }) => {
		const _name: string | null = input.name;
		const _desc: string | null | undefined = input.description;
		return { updated: true };
	});

// ============================================================================
// Route/Job definition structure tests
// ============================================================================

// JsonRouteDefinition structure
const testRoute = route()
	.post()
	.schema(z.object({ x: z.number() }))
	.handler(async ({ input }) => ({ doubled: input.x * 2 }));

type TestRouteType = typeof testRoute;
type _testRouteHasSchema = Expect<Equal<HasKey<TestRouteType, "schema">, true>>;
type _testRouteHasHandler = Expect<
	Equal<HasKey<TestRouteType, "handler">, true>
>;
type _testRouteHasMethod = Expect<Equal<HasKey<TestRouteType, "method">, true>>;
type _testRouteHasBrand = Expect<Equal<HasKey<TestRouteType, "__brand">, true>>;

// JobDefinition structure
const testJob = job({
	name: "test-job",
	schema: z.object({ data: z.string() }),
	handler: async ({ payload: _payload }) => {},
});

type TestJobType = typeof testJob;
type _testJobHasName = Expect<Equal<HasKey<TestJobType, "name">, true>>;
type _testJobHasSchema = Expect<Equal<HasKey<TestJobType, "schema">, true>>;
type _testJobHasHandler = Expect<Equal<HasKey<TestJobType, "handler">, true>>;

// ============================================================================
// Route type guards
// ============================================================================

const someRoute = testRoute;
if (isJsonRoute(someRoute)) {
	type _isJson = Expect<
		Extends<typeof someRoute, JsonRouteDefinition<any, any>>
	>;
}
if (isRawRoute(someRoute)) {
	type _isRaw = Expect<Extends<typeof someRoute, RawRouteDefinition>>;
}
