/**
 * Functions and Jobs Type Tests
 *
 * These tests verify that TypeScript correctly infers types for
 * RPC functions (q.fn) and background jobs (q.job).
 *
 * Run with: tsc --noEmit
 */

import { z } from "zod";
import { fn } from "#questpie/server/functions/define-function.js";
import type {
  FunctionDefinition,
  JsonFunctionDefinition,
} from "#questpie/server/functions/types.js";
import { job } from "#questpie/server/integrated/queue/job.js";
import type { JobDefinition } from "#questpie/server/integrated/queue/types.js";
import type {
  Equal,
  Expect,
  Extends,
  HasKey,
  IsNever,
} from "./type-test-utils.js";

// ============================================================================
// q.fn() - RPC functions type tests
// ============================================================================

// Function with input schema should infer input type correctly
const pingFn = fn({
  schema: z.object({
    message: z.string(),
    count: z.number().optional(),
  }),
  handler: async ({ input }) => {
    // input should have correct types
    const msg: string = input.message;
    const cnt: number | undefined = input.count;
    return { received: msg, count: cnt };
  },
});

type PingFnType = typeof pingFn;
type _pingIsJsonFn = Expect<
  Extends<PingFnType, JsonFunctionDefinition<any, any>>
>;

// Function output type should be inferred from handler return
const addFn = fn({
  schema: z.object({ a: z.number(), b: z.number() }),
  handler: async ({ input }) => {
    return { sum: input.a + input.b, timestamp: new Date() };
  },
});

type AddFnType = typeof addFn;
type AddHandlerReturn = Awaited<ReturnType<AddFnType["handler"]>>;
type _addHasSumInOutput = Expect<Equal<HasKey<AddHandlerReturn, "sum">, true>>;
type _addHasTimestamp = Expect<
  Equal<HasKey<AddHandlerReturn, "timestamp">, true>
>;

// Function with explicit output schema
const validateFn = fn({
  schema: z.object({ data: z.string() }),
  outputSchema: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
  }),
  handler: async ({ input }) => {
    return { valid: true, errors: [] };
  },
});

type ValidateFnType = typeof validateFn;
type _validateHasOutputSchema = Expect<
  Equal<HasKey<ValidateFnType, "outputSchema">, true>
>;

// Function with app and session context
const protectedFn = fn({
  schema: z.object({ action: z.string() }),
  handler: async ({ input, app, session }) => {
    // session should be available
    const userId = session?.user?.id;
    return { success: true, userId };
  },
});

// Complex input schema should preserve nested types
const complexFn = fn({
  schema: z.object({
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
  handler: async ({ input }) => {
    // All nested types should be inferred
    const theme = input.user.preferences.theme; // "light" | "dark"
    const tags = input.tags; // string[]
    return { processed: true };
  },
});

// ============================================================================
// q.job() - Background jobs type tests
// ============================================================================

// Job name should be inferred as literal type
const sendEmailJob = job({
  name: "send-email",
  schema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  handler: async ({ payload }) => {
    // payload should have correct types
    const to: string = payload.to;
    const subject: string = payload.subject;
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
    const imageId: string = payload.imageId;
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
  handler: async ({ payload }) => {
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
const notifyJob = job({
  name: "notify-users",
  schema: z.object({
    userIds: z.array(z.string()),
    message: z.string(),
  }),
  handler: async ({ payload, app }) => {
    // app should be available for accessing other services
    const users = payload.userIds;
    return { notified: users.length };
  },
});

// Job with optional fields in schema
const syncJob = job({
  name: "sync-data",
  schema: z.object({
    source: z.string(),
    destination: z.string(),
    options: z
      .object({
        force: z.boolean(),
        dryRun: z.boolean(),
      })
      .optional(),
  }),
  handler: async ({ payload }) => {
    const force = payload.options?.force;
    const dryRun = payload.options?.dryRun;
    return { synced: true };
  },
});

// ============================================================================
// Type inference edge cases
// ============================================================================

// Void return in job handler
const logJob = job({
  name: "log-event",
  schema: z.object({ event: z.string() }),
  handler: async ({ payload }) => {
    // No return - void
    console.log(payload.event);
  },
});

// Union types in schema
const actionFn = fn({
  schema: z.object({
    action: z.union([
      z.object({ type: z.literal("create"), data: z.string() }),
      z.object({ type: z.literal("delete"), id: z.string() }),
    ]),
  }),
  handler: async ({ input }) => {
    if (input.action.type === "create") {
      return { created: input.action.data };
    }
    return { deleted: input.action.id };
  },
});

// Discriminated unions
const webhookJob = job({
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
const updateFn = fn({
  schema: z.object({
    id: z.string(),
    name: z.string().nullable(),
    description: z.string().nullish(),
  }),
  handler: async ({ input }) => {
    const name: string | null = input.name;
    const desc: string | null | undefined = input.description;
    return { updated: true };
  },
});

// ============================================================================
// Function/Job definition structure tests
// ============================================================================

// JsonFunctionDefinition structure
const testFn = fn({
  schema: z.object({ x: z.number() }),
  handler: async ({ input }) => ({ doubled: input.x * 2 }),
});

type TestFnType = typeof testFn;
type _testFnHasSchema = Expect<Equal<HasKey<TestFnType, "schema">, true>>;
type _testFnHasHandler = Expect<Equal<HasKey<TestFnType, "handler">, true>>;

// JobDefinition structure
const testJob = job({
  name: "test-job",
  schema: z.object({ data: z.string() }),
  handler: async ({ payload }) => {},
});

type TestJobType = typeof testJob;
type _testJobHasName = Expect<Equal<HasKey<TestJobType, "name">, true>>;
type _testJobHasSchema = Expect<Equal<HasKey<TestJobType, "schema">, true>>;
type _testJobHasHandler = Expect<Equal<HasKey<TestJobType, "handler">, true>>;
