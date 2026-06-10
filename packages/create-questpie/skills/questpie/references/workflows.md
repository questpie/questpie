---
name: questpie-core/workflows
description:
  QUESTPIE durable workflows long-running business processes replay steps sleep waitForEvent invoke compensation cron admin UI workflow service
  - questpie-core
---

# Durable Workflows

Use `@questpie/workflows` when business logic spans multiple steps, waits on time or external events, needs retry-safe side effects, or should survive process restarts.

## Install And Register

```bash
bun add @questpie/workflows
```

```ts title="modules.ts"
import { workflowsModule } from "@questpie/workflows/modules/workflows";
export default [workflowsModule] as const;
```

`workflowsModule` carries its codegen plugin. Do not also add `workflowsPlugin()` to `questpie.config.ts` unless you are doing a custom module setup that deliberately omits `workflowsModule`.

Runtime options (route access rule — default admin-only — and execution-lease settings) go in plugin-discovered `config/workflows.ts` using the `workflowsConfig()` factory from `@questpie/workflows/server`.

For admin UI pages/widgets, register the client module:

```ts title="questpie/admin/modules.ts"
import adminClientModule from "@questpie/admin/client-module";
import { workflowsClientModule } from "@questpie/workflows/client/modules/workflows";
export default {
	name: "app-admin" as const,
	views: { ...adminClientModule.views, ...workflowsClientModule.views },
	components: {
		...adminClientModule.components,
		...workflowsClientModule.components,
	},
	fields: { ...adminClientModule.fields, ...workflowsClientModule.fields },
	pages: { ...adminClientModule.pages, ...workflowsClientModule.pages },
	widgets: { ...adminClientModule.widgets, ...workflowsClientModule.widgets },
	blocks: { ...adminClientModule.blocks, ...workflowsClientModule.blocks },
};
```

## Define A Workflow

Put workflow definitions in `workflows/*.ts`:

```ts title="workflows/production-order.ts"
import { workflow } from "@questpie/workflows";
import { z } from "zod";

export default workflow({
	name: "production-order",
	schema: z.object({
		orderId: z.string(),
	}),
	timeout: "7d",
	handler: async ({ input, step, ctx, log }) => {
		const order = await step.run("load-order", async () => {
			return ctx.collections.productionOrders.findOne({
				where: { id: input.orderId },
				with: { toy: true },
			});
		});
		if (!order) throw new Error("Production order not found");

		await step.run("reserve-materials", async () => {
			await ctx.queue.recalculateMaterialPlan.publish({
				orderId: input.orderId,
			});
		});

		await step.waitForEvent("materials-ready", {
			event: "materials.available",
			match: { orderId: input.orderId },
			timeout: "2d",
		});

		await step.run("notify-scheduled", async () => {
			await ctx.email.sendTemplate({
				template: "productionScheduled",
				input: { orderId: input.orderId },
				to: order.ownerEmail,
			});
		});

		log.info("Production order workflow completed");
		return { status: "scheduled" };
	},
});
```

Run codegen after adding workflow files:

```bash
bun questpie generate
```

## Trigger And Signal

Use injected `workflows` from route, job, hook, or service context:

```ts title="routes/start-production.ts"
import { route } from "questpie/services";
import { z } from "zod";

export default route()
	.post()
	.schema(z.object({ orderId: z.string() }))
	.handler(async ({ input, workflows }) => {
		const result = await workflows.trigger("production-order", {
			orderId: input.orderId,
		});
		return { instanceId: result.instanceId };
	});
```

Signal waiting workflows:

```ts
await workflows.sendEvent(
	"materials.available",
	{ receivedAt: new Date().toISOString() },
	{ orderId },
);
```

## Cron Workflows

Use workflow-level `cron` for recurring long-running processes:

```ts
export default workflow({
	name: "nightly-material-plan",
	schema: z.object({}),
	cron: { schedule: "0 2 * * *", overlap: "skip" },
	handler: async ({ step, ctx }) => {
		await step.run("recalculate", async () => {
			await ctx.queue.recalculateMaterialPlan.publish({});
		});
	},
});
```

On Node/Bun workers, `app.queue.listen()` runs workflow jobs and maintenance. On Cloudflare Workers, use `cloudflareQueuesAdapter`, export `createCloudflareWorkerHandlers(app)`, and configure a Cron Trigger for workflow maintenance.

## Rules

- Keep external side effects inside `step.run()` so replay does not repeat them.
- Use stable step names. Renaming a step changes replay identity.
- Use idempotency keys when calling external APIs.
- Use `step.waitForEvent()` for durable waits instead of polling loops.
- Keep workflow definitions in `workflows/`; do not define them inside route/job files.
