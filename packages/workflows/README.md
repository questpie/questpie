# @questpie/workflows

Durable, replay-based workflow engine for [QUESTPIE](https://questpie.dev). Define long-running processes that survive restarts, handle failures gracefully, and scale automatically.

## Features

- **Replay-based execution** — steps are cached and replayed on restart, ensuring exactly-once semantics
- **Step primitives** — `step.run()`, `step.sleep()`, `step.sleepUntil()`, `step.waitForEvent()`, `step.invoke()`, `step.sendEvent()`
- **Event-driven coordination** — JSONB-containment matching with retroactive event resolution
- **Saga-pattern compensation** — automatic reverse LIFO rollback on failure
- **Cron triggers** — recurring workflows with overlap control (`skip`, `allow`, `cancel-previous`)
- **Retention policies** — automatic cleanup of old instances, steps, events, and logs
- **Admin UI** — workflow list, step timeline, dashboard stats widget
- **Type-safe** — full TypeScript inference from schema to handler context

## Installation

```bash
bun add @questpie/workflows
```

## Quick Start

### Define a Workflow

```ts
// workflows/onboarding.ts
import { workflow } from "@questpie/workflows";
import z from "zod";

export default workflow({
	name: "user-onboarding",
	schema: z.object({ userId: z.string(), email: z.string() }),
	timeout: "7d",
	handler: async ({ input, step, ctx }) => {
		await step.run("send-welcome", async () => {
			await ctx.email.sendTemplate({
				template: "welcome",
				input: { userId: input.userId },
				to: input.email,
			});
		});

		await step.sleep("wait-before-tips", "24h");

		await step.run("send-tips", async () => {
			await ctx.email.sendTemplate({
				template: "gettingStarted",
				input: { userId: input.userId },
				to: input.email,
			});
		});

		const feedback = await step.waitForEvent("wait-feedback", {
			event: "user.feedback",
			match: { userId: input.userId },
			timeout: "5d",
		});

		return { completed: true, feedbackReceived: !!feedback };
	},
});
```

### Register the Module

```ts
// modules.ts
import { workflowsModule } from "@questpie/workflows/server";
export default [workflowsModule] as const;
```

`workflowsModule` carries the codegen plugin, so `questpie generate` discovers `workflows/*.ts` files without manually adding `workflowsPlugin()` to `questpie.config.ts`.

### Trigger from Application Code

```ts
const result = await ctx.workflows.trigger("user-onboarding", {
	userId: user.id,
	email: user.email,
});
```

## Exports

| Entry Point                  | Exports                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `@questpie/workflows`        | `workflow()` factory + all types                                                   |
| `@questpie/workflows/server` | `workflowsModule`, `workflowsPlugin()`, `createWorkflowClient()`, engine internals |
| `@questpie/workflows/client` | `workflowsClientModule`, admin UI pages and widgets                                |

## Documentation

Full documentation available at [questpie.dev/docs/backend/business-logic/workflows](https://questpie.dev/docs/backend/business-logic/workflows).

## License

MIT
