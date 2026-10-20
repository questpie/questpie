/**
 * Zod schema inference — `route().schema()`, `.outputSchema()`, `job()` and
 * `email()` are generic over the schema itself and read it through
 * `z.output`. Inferring `T` from `z.ZodSchema<T>` gave the same types but
 * compared every schema with `ZodType<T>` member by member, tens of thousands
 * of instantiations each. These assertions pin that the types did not move.
 *
 * Compile-time only — run with: tsc --noEmit
 */

import { z } from "zod";

import type { EmailTemplateDefinition } from "#questpie/server/modules/core/integrated/mailer/template.js";
import { email } from "#questpie/server/modules/core/integrated/mailer/template.js";
import { job } from "#questpie/server/modules/core/integrated/queue/job.js";
import type { JobDefinition } from "#questpie/server/modules/core/integrated/queue/types.js";
import { route } from "#questpie/server/routes/define-route.js";
import type {
	InferRouteInput,
	InferRouteOutput,
} from "#questpie/server/routes/types.js";

import type { Equal, Expect } from "./type-test-utils.js";

const inputSchema = z.object({
	id: z.string(),
	limit: z.number().int().default(20),
	at: z.string().transform((value) => new Date(value)),
	tags: z.array(z.enum(["a", "b"])).optional(),
});
type Parsed = z.output<typeof inputSchema>;

// Route input is the schema's OUTPUT (after defaults and transforms).
const inputRoute = route()
	.post()
	.schema(inputSchema)
	.handler(async ({ input }) => {
		type _handlerInput = Expect<Equal<typeof input, Parsed>>;
		return { ok: true as const };
	});
type _routeInput = Expect<Equal<InferRouteInput<typeof inputRoute>, Parsed>>;
type _routeOutputFromHandler = Expect<
	Equal<InferRouteOutput<typeof inputRoute>, { ok: true }>
>;

// An output schema sets the route output and constrains the handler.
const outputRoute = route()
	.post()
	.schema(inputSchema)
	.outputSchema(z.object({ count: z.number() }))
	.handler(async () => ({ count: 1 }));
type _routeOutputFromSchema = Expect<
	Equal<InferRouteOutput<typeof outputRoute>, { count: number }>
>;

route()
	.post()
	.schema(inputSchema)
	.outputSchema(z.object({ count: z.number() }))
	// @ts-expect-error — handler result must match the output schema
	.handler(async () => ({ count: "1" }));

// Job payload is the schema's output.
const syncJob = job({
	name: "sync",
	schema: inputSchema,
	handler: async ({ payload }) => {
		type _jobPayload = Expect<Equal<typeof payload, Parsed>>;
	},
});
type _jobDefinition = Expect<
	Equal<typeof syncJob, JobDefinition<Parsed, void, "sync">>
>;

// Email input is the schema's output.
const welcome = email({
	name: "welcome",
	schema: z.object({ name: z.string() }),
	handler: ({ input }) => {
		type _emailInput = Expect<Equal<typeof input, { name: string }>>;
		return { subject: `Hi ${input.name}`, html: "" };
	},
});
type _emailDefinition = Expect<
	Equal<typeof welcome, EmailTemplateDefinition<{ name: string }, "welcome">>
>;

// Intentional differences from the old `z.ZodSchema<T>` inference, which
// took a common supertype of `_zod.output` and the unbranded `parse` return:
// a branded schema now keeps its brand, and an `any` schema gives `any`.
const branded = z.string().brand<"UserId">();
const brandedJob = job({
	name: "branded",
	schema: branded,
	handler: async () => {},
});
type _brandKept = Expect<
	Equal<
		typeof brandedJob,
		JobDefinition<z.output<typeof branded>, void, "branded">
	>
>;
declare const untyped: any;
const anyJob = job({ name: "any", schema: untyped, handler: async () => {} });
type _anyPayload = Expect<
	Equal<typeof anyJob, JobDefinition<any, void, "any">>
>;
