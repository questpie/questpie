/**
 * `route().query()` types — access receives the parsed input, the definition
 * carries a query (and live) marker that survives the codegen handler erasure
 * and params rebuild, and invalid query chains are compile errors.
 *
 * Run with: tsc --noEmit
 */

import { z } from "zod";

import { route } from "#questpie/server/routes/define-route.js";
import type {
	JsonRouteDefinition,
	RouteAccessContext,
	RouteAccessRule,
	RouteLiveOptions,
	RouteWithParams,
} from "#questpie/server/routes/types.js";

import type {
	Equal,
	Expect,
	Extends,
	IsUnknown,
	Not,
} from "./type-test-utils.js";

type WorkInput = { companyId: string; size: number };

const workInput = z.object({
	companyId: z.string(),
	size: z.string().transform((value) => value.length),
});
const workOutput = z.object({ total: z.number() });

const work = route()
	.post()
	.schema(workInput)
	.outputSchema(workOutput)
	.access(({ input }) => {
		type _parsedInput = Expect<Equal<typeof input, WorkInput>>;
		return input.companyId.length > 0;
	})
	.query({
		live: {
			data: (parsed) => {
				type _parsedLiveInput = Expect<Equal<typeof parsed, WorkInput>>;
				return { tasks: { company: parsed.companyId } };
			},
			maxAgeMs: 30_000,
		},
	})
	.handler(({ input }) => ({ total: input.size }));

const once = route()
	.post()
	.schema(workInput)
	.outputSchema(workOutput)
	.access(true)
	.query()
	.handler(({ input }) => ({ total: input.size }));

const plain = route()
	.post()
	.schema(workInput)
	.handler(({ input }) => ({ total: input.size }));

// ============================================================================
// Definition markers
// ============================================================================

type _workIsJsonRoute = Expect<
	Extends<typeof work, JsonRouteDefinition<WorkInput, { total: number }, any>>
>;
type _workIsLive = Expect<
	Extends<typeof work, { query: { live: RouteLiveOptions<WorkInput> } }>
>;
type _onceIsQuery = Expect<Extends<typeof once, { query: object }>>;
type _onceIsNotLive = Expect<
	Not<Extends<typeof once, { query: { live: object } }>>
>;
type _plainIsNotQuery = Expect<Not<Extends<typeof plain, { query: object }>>>;

// Codegen erases `handler`, then rebuilds the route with its URL params.
type Generated<T> = RouteWithParams<
	Omit<T, "handler"> & { handler: (args: unknown) => unknown },
	{}
>;
type _generatedWorkIsLive = Expect<
	Extends<Generated<typeof work>, { query: { live: object } }>
>;
type _generatedOnceIsNotLive = Expect<
	Not<Extends<Generated<typeof once>, { query: { live: object } }>>
>;
type _generatedPlainIsNotQuery = Expect<
	Not<Extends<Generated<typeof plain>, { query: object }>>
>;

// ============================================================================
// Access context
// ============================================================================

type _legacyContextHasNoInput = Expect<
	Not<Extends<"input", keyof RouteAccessContext>>
>;
type _typedContextInput = Expect<
	Equal<RouteAccessContext<WorkInput>["input"], WorkInput>
>;

// A rule written without input still fits a schema route.
const localized: RouteAccessRule = (ctx) => ctx.locale !== undefined;
route()
	.post()
	.schema(workInput)
	.outputSchema(workOutput)
	.access(localized)
	.query()
	.handler(({ input }) => ({ total: input.size }));

// Before `.schema()` the input is not known yet.
route()
	.post()
	.access(({ input }) => {
		type _unknownInput = Expect<IsUnknown<typeof input>>;
		return true;
	})
	.schema(workInput)
	.handler(({ input }) => ({ total: input.size }));

// ============================================================================
// Invalid query chains
// ============================================================================

route()
	.post()
	.schema(workInput)
	.access(true)
	.query()
	// @ts-expect-error a query route must declare its output schema
	.handler(({ input }) => ({ total: input.size }));

route()
	.post()
	.raw()
	.query()
	// @ts-expect-error raw routes cannot be queries
	.handler(() => ({ total: 0 }));

route()
	.post()
	.query()
	.raw()
	// @ts-expect-error query routes cannot be raw
	.handler(() => new Response("ok"));

const filterAnchor: RouteLiveOptions<{ ids: string[] }> = {
	// @ts-expect-error equality anchors take scalar values, not filters
	data: ({ ids }) => ({ tasks: { id: { in: ids } } }),
};
void filterAnchor;
