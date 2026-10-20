/**
 * `workflow()` is generic over the Zod schema and reads it through
 * `z.output`, like `job()` in questpie. Pins that the handler input and the
 * returned definition carry the schema's output type.
 */

import { expectTypeOf } from "bun:test";

import { z } from "zod";

import { workflow } from "../../src/server/workflow/define-workflow.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";

const schema = z.object({
	userId: z.string(),
	limit: z.number().int().default(20),
	at: z.string().transform((value) => new Date(value)),
});
type Parsed = z.output<typeof schema>;

const onboarding = workflow({
	name: "onboarding",
	schema,
	handler: async ({ input }) => {
		expectTypeOf(input).toEqualTypeOf<Parsed>();
		return { status: "done" as const };
	},
	onFailure: async ({ input }) => {
		expectTypeOf(input).toEqualTypeOf<Parsed>();
	},
});

expectTypeOf(onboarding).toEqualTypeOf<
	WorkflowDefinition<Parsed, { status: "done" }, "onboarding">
>();
