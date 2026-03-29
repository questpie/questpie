import type { z } from "zod";

import type { JobDefinition, JobHandlerArgs } from "./types.js";

/**
 * Arguments passed to workflow steps
 * Same structure as JobHandlerArgs for consistency
 * @template TInput - The step input type
 */
export type WorkflowStepArgs<TInput = any> = JobHandlerArgs<TInput>;

/**
 * Workflow step - a job that can be chained with other jobs
 * @template TInput - The step input type
 * @template TOutput - The step output type
 */
export interface WorkflowStep<TInput = any, TOutput = any> {
	name: string;
	execute: (args: WorkflowStepArgs<TInput>) => Promise<TOutput>;
}

/**
 * Workflow builder for creating multi-step job pipelines
 *
 * @template TInput - The workflow initial input type
 * @template TCurrentOutput - The current step output type (evolves through chaining)
 * @template TName - The workflow name (literal string type)
 *
 * @example
 * ```ts
 * const imageProcessingWorkflow = workflow('process-uploaded-image')
 *   .step('validate', async ({ payload }) => {
 *     // Validate image
 *     const valid = await validateImage(payload.url);
 *     return { url: payload.url, valid };
 *   })
 *   .step('resize', async ({ payload }) => {
 *     // Resize image
 *     const resized = await resizeImage(payload.url);
 *     return { ...payload, resized };
 *   })
 *   .step('optimize', async ({ payload }) => {
 *     // Optimize image
 *     const optimized = await optimizeImage(payload.resized);
 *     return { ...payload, optimized };
 *   })
 *   .build();
 * ```
 */
export class WorkflowBuilder<
	TInput,
	TCurrentOutput = TInput,
	TName extends string = string,
> {
	private steps: WorkflowStep<any, any>[] = [];

	constructor(private workflowName: TName) {}

	/**
	 * Add a step to the workflow
	 */
	step<TStepOutput>(
		name: string,
		execute: (args: WorkflowStepArgs<TCurrentOutput>) => Promise<TStepOutput>,
	): WorkflowBuilder<TInput, TStepOutput, TName> {
		this.steps.push({ name, execute });
		return this as any;
	}

	/**
	 * Build the workflow into a job definition
	 */
	build(
		schema: z.ZodSchema<TInput>,
	): JobDefinition<TInput, TCurrentOutput, TName> {
		return {
			name: this.workflowName,
			schema,
			handler: async (args) => {
				let currentOutput: any = args.payload;

				for (const step of this.steps) {
					try {
						console.log(
							`[Workflow: ${this.workflowName}] Executing step: ${step.name}`,
						);
						currentOutput = await step.execute({
							...args,
							payload: currentOutput,
						});
					} catch (error) {
						console.error(
							`[Workflow: ${this.workflowName}] Step "${step.name}" failed:`,
							error,
						);
						throw new Error(
							`Workflow step "${step.name}" failed: ${error instanceof Error ? error.message : "Unknown error"}`,
						);
					}
				}

				return currentOutput as TCurrentOutput;
			},
		};
	}
}

/**
 * Create a workflow builder.
 *
 * @example Basic usage (uses any from module augmentation)
 * ```ts
 * const processOrderWorkflow = workflow('process-order')
 *   .step('validate', async ({ payload }) => {
 *     // Validate order
 *     return { ...payload, validated: true };
 *   })
 *   .step('charge', async ({ payload }) => {
 *     // Charge payment
 *     const payment = await chargeCustomer(payload);
 *     return { ...payload, payment };
 *   })
 *   .step('fulfill', async ({ payload }) => {
 *     // Send to fulfillment
 *     await sendToWarehouse(payload);
 *     return { ...payload, fulfilled: true };
 *   })
 *   .step('notify', async ({ payload, queue }) => {
 *     // Send confirmation email
 *     await queue.sendEmail.publish({
 *       to: payload.customerEmail,
 *       subject: 'Order confirmed',
 *       body: `Your order #${payload.id} is confirmed!`
 *     });
 *     return payload;
 *   })
 *   .build(orderSchema);
 * ```
 *
 */
export function workflow<TInput, TName extends string>(
	name: TName,
): WorkflowBuilder<TInput, TInput, TName>;

/**
 * @deprecated TApp generic removed; use flat context properties (db, queue, email, ...) instead.
 */
export function workflow(): <TInput, TName extends string>(
	name: TName,
) => WorkflowBuilder<TInput, TInput, TName>;

export function workflow<TInputOrApp, TName extends string = string>(
	name?: TName,
): unknown {
	// Overload 2: workflow() returns a curried function
	if (name === undefined) {
		return <TInput, TN extends string>(n: TN) =>
			new WorkflowBuilder<TInput, TInput, TN>(n);
	}

	// Overload 1: workflow('name') - direct name
	return new WorkflowBuilder<TInputOrApp, TInputOrApp, TName>(name);
}
