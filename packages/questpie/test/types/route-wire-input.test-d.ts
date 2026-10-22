/** Route callers send Zod input; server callbacks receive Zod output. */
import { z } from "zod";

import type { QuestpieClient } from "#questpie/client/index.js";
import type { InferRouteWireInput } from "#questpie/exports/client.js";
import { route } from "#questpie/server/routes/define-route.js";
import type {
	InferRouteInput,
	InferRouteOutput,
	InferRouteParams,
	RouteParamsFromKey,
	RouteWithParams,
} from "#questpie/server/routes/types.js";

import type { Equal, Expect } from "./type-test-utils.js";

const schema = z.object({
	at: z.iso.datetime().pipe(z.coerce.date()),
	size: z.string().transform(Number),
	limit: z.number().default(20),
	note: z.string().optional(),
});
type Wire = z.input<typeof schema>;
type Parsed = z.output<typeof schema>;

const live = route()
	.schema(schema)
	.outputSchema(z.object({ total: z.number() }))
	.access(({ input }) => {
		type _access = Expect<Equal<typeof input, Parsed>>;
		return input.at.getTime() > 0;
	})
	.query({
		live: {
			data: (input) => {
				type _data = Expect<Equal<typeof input, Parsed>>;
				return { tasks: { size: input.size } };
			},
			authority: (input) => {
				type _authority = Expect<Equal<typeof input, Parsed>>;
				return { memberships: { since: input.at.toISOString() } };
			},
		},
	})
	.meta({ title: "Work" })
	.params<{ companyId: string }>()
	.post()
	.handler(({ input, params }) => {
		type _handler = Expect<Equal<typeof input, Parsed>>;
		type _date = Expect<Equal<typeof input.at, Date>>;
		type _number = Expect<Equal<typeof input.size, number>>;
		type _default = Expect<Equal<typeof input.limit, number>>;
		type _params = Expect<Equal<keyof typeof params, "companyId">>;
		return { total: input.size + input.limit };
	});

// Mirrors codegen's handler erasure, including method suffix params inference.
type Generated = RouteWithParams<
	Omit<typeof live, "handler"> & { handler: (args: unknown) => unknown },
	RouteParamsFromKey<"companies/[companyId]/work:POST">
>;
type _wire = Expect<Equal<InferRouteWireInput<typeof live>, Wire>>;
type _parsed = Expect<Equal<InferRouteInput<typeof live>, Parsed>>;
type _generatedWire = Expect<Equal<InferRouteWireInput<Generated>, Wire>>;
type _generatedParsed = Expect<Equal<InferRouteInput<Generated>, Parsed>>;
type _generatedOutput = Expect<
	Equal<InferRouteOutput<Generated>, { total: number }>
>;
type _generatedParams = Expect<
	Equal<InferRouteParams<Generated>, { companyId: string }>
>;
type _generatedLive = Expect<
	Equal<Generated["query"]["live"], (typeof live)["query"]["live"]>
>;
type _rootExport = Expect<
	Equal<import("questpie").InferRouteWireInput<Generated>, Wire>
>;
type _servicesExport = Expect<
	Equal<import("questpie/services").InferRouteWireInput<Generated>, Wire>
>;

const plain = route()
	.schema(schema)
	.meta({ title: "Plain" })
	.handler(({ input }) => ({ at: input.at, total: input.size }));
const defaulted = route()
	.schema(z.string().default("10").transform(Number))
	.handler(({ input }) => {
		type _defaulted = Expect<Equal<typeof input, number>>;
		return input;
	});
const optional = route()
	.schema(z.string().transform(Number).optional())
	.handler(({ input }) => {
		type _optional = Expect<Equal<typeof input, number | undefined>>;
		return input ?? 0;
	});
const raw = route()
	.get()
	.handler(() => new Response("ok"));

declare const client: QuestpieClient<{
	collections: {};
	routes: {
		live: typeof live;
		"companies/[companyId]/work:POST": Generated;
		plain: typeof plain;
		defaulted: typeof defaulted;
		optional: typeof optional;
		raw: typeof raw;
	};
}>;

const wire = { at: "2026-10-22T10:00:00Z", size: "12" };
client.routes.live.post(wire);
client.routes.companies["[companyId]"].work.post(wire);
client.routes.plain.post(wire);
client.routes.defaulted.post(undefined);
client.routes.defaulted.post("12");
client.routes.optional.post(undefined);
client.routes.optional.post("12");
client.routes.raw.get();
// @ts-expect-error the wire schema accepts an ISO string, not a parsed Date
client.routes.live.post({ ...wire, at: new Date() });
// @ts-expect-error transforms accept the source string, not the parsed number
client.routes.plain.post({ ...wire, size: 12 });
// @ts-expect-error a default does not accept the transformed number on the wire
client.routes.defaulted.post(12);

type _clientWire = Expect<
	Equal<Parameters<typeof client.routes.live.post>[0], Wire>
>;
type _generatedClientWire = Expect<
	Equal<
		Parameters<
			(typeof client.routes.companies)["[companyId]"]["work"]["post"]
		>[0],
		Wire
	>
>;
type _defaultedClientWire = Expect<
	Equal<Parameters<typeof client.routes.defaulted.post>[0], string | undefined>
>;
type _optionalClientWire = Expect<
	Equal<Parameters<typeof client.routes.optional.post>[0], string | undefined>
>;
type _plainOutput = Expect<
	Equal<
		Awaited<ReturnType<typeof client.routes.plain.post>>,
		{ at: Date; total: number }
	>
>;
type _clientOutput = Expect<
	Equal<Awaited<ReturnType<typeof client.routes.live.post>>, { total: number }>
>;
type _rawWire = Expect<Equal<InferRouteWireInput<typeof raw>, never>>;

route()
	.schema(schema)
	.outputSchema(z.object({ total: z.number() }))
	// @ts-expect-error input typing must not weaken output validation
	.handler(() => ({ total: "12" }));

const snapshots = client.routes.live.post.watch(wire, {
	params: { companyId: "company-1" },
	locale: "sk",
});
type _snapshotOutput = Expect<
	Equal<typeof snapshots, AsyncIterable<{ total: number }>>
>;
client.routes.companies["[companyId]"].work.post.watch(wire, {
	params: { companyId: "company-1" },
});
// @ts-expect-error ordinary routes have no watch capability
client.routes.plain.post.watch(wire);
// @ts-expect-error LIVE uses the original wire input, not the parsed Date
client.routes.live.post.watch({ ...wire, at: new Date() });
// @ts-expect-error parameters use the registered route's names
client.routes.live.post.watch(wire, { params: { wrong: "company-1" } });
