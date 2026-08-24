import { codec, defineService, operation, policy } from "questpie";

import { defineAction } from "#questpie/app";
import type {
	ActionServices,
	ExecutionServices,
	GeneratedActionOperations,
} from "#questpie/app";

import { deliverMessage } from "./delivery";

let deliveryAttempts = 0;
let deliveryDisposals = 0;

function assertOperationMap(value: object, namespace: object): void {
	if (
		Object.getPrototypeOf(value) !== null ||
		!Object.isFrozen(value) ||
		Object.getPrototypeOf(namespace) !== null ||
		!Object.isFrozen(namespace)
	)
		throw new TypeError("generated server Operation map is not sealed");
}

export const deliveryProvider = defineService({
	name: "delivery.provider",
	lifetime: "execution",
	effect: "external",
	create: ({ signal }) =>
		Object.freeze({
			send: async (input: Readonly<{ effectId: string; message: string }>) => {
				deliveryAttempts += 1;
				if (input.message === "delivery-blocked") {
					if (signal.aborted) throw signal.reason;
					await new Promise<never>((_resolve, reject) =>
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						}),
					);
				}
				const receipt = await deliverMessage({
					attempt: deliveryAttempts,
					body: input.message,
					effectId: input.effectId,
				});
				return Object.freeze({
					attempt: deliveryAttempts,
					disposals: deliveryDisposals,
					receipt,
				});
			},
		}),
	dispose: () => {
		deliveryDisposals += 1;
	},
});

export const publishDelivery = defineAction({
	name: "delivery.publish",
	input: codec.object({
		message: codec.text(),
		// Domain data with this name is deliberately not Effect Identity material.
		effectKey: codec.text(),
	}),
	output: codec.object({
		attempt: codec.integer(),
		disposals: codec.integer(),
		receipt: codec.text(),
	}),
	policy: policy.authenticated(),
	errors: {
		providerRejected: operation.error({
			code: "PROVIDER_REJECTED",
			status: 502,
		}),
		outcomeUnknown: operation.error({
			code: "OUTCOME_UNKNOWN",
			status: 503,
			payload: codec.object({ reason: codec.text() }),
		}),
	},
	limits: {
		inputBytes: 4_096,
		resultBytes: 4_096,
		durationMilliseconds: 1_000,
	},
	handler: async ({ input, ctx, effect, errors }) => {
		try {
			assertOperationMap(ctx.queries, ctx.queries.messages);
			assertOperationMap(ctx.mutations, ctx.mutations.message);
			return await ctx.services["delivery.provider"].send({
				effectId: effect.id,
				message: input.message,
			});
		} catch (error) {
			if (ctx.signal.aborted && error === ctx.signal.reason) throw error;
			if (input.message.startsWith("delivery-lost"))
				throw errors.outcomeUnknown({ reason: "provider response was lost" });
			throw errors.providerRejected();
		}
	},
});

function actionHandlerCapabilityContract(
	input: Parameters<typeof publishDelivery.handler>[0],
): void {
	const { ctx, effect } = input;
	void ctx.queries.messages.page;
	void ctx.mutations.message.publish;
	// @ts-expect-error Action cannot call another Action recursively
	void ctx.actions;
	// @ts-expect-error Action has no relational data facade
	void ctx.data;
	// @ts-expect-error Action has no raw database or transaction
	void ctx.database;
	// @ts-expect-error Action has no durable controls
	void ctx.durable;
	// @ts-expect-error Action cannot elevate to System
	void ctx.system;
	// @ts-expect-error application-lifetime Services are not Action capability
	void ctx.services["collaboration.demo-auth"];
	// @ts-expect-error top-level read Services are not Action capability
	void ctx.services["audit.execution"];
	// @ts-expect-error Effect Identity is readonly handler metadata
	effect.id = "forged";
}

function actionCapabilityContract(
	actions: GeneratedActionOperations,
): Promise<unknown> {
	void publishDelivery.handler({
		input: { effectKey: "domain-only", message: "hello" },
		ctx: null as never,
		effect: { id: "00000000-0000-5000-a000-000000000000" },
		errors: null as never,
	});
	const valid = actions.delivery.publish(
		{ effectKey: "domain-only", message: "hello" },
		{
			effectKey: "provider-request",
			callId: "direct-correlation",
			timeoutMilliseconds: 1_000,
		},
	);
	// @ts-expect-error direct Action never invents stable Effect material
	void actions.delivery.publish({ message: "hello", effectKey: "domain" });
	void actions.delivery.publish(
		{ message: "hello", effectKey: "domain" },
		// @ts-expect-error Mutation callId cannot replace required Effect material
		{
			callId: "mutation-alias",
		},
	);
	void actions.delivery.publish(
		{ message: "hello", effectKey: "domain" },
		{
			effectKey: "provider-request",
			// @ts-expect-error direct Action never accepts an automatic retry option
			retry: true,
		},
	);
	void actions.delivery.publish(
		{ message: "hello", effectKey: "domain" },
		{
			effectKey: "provider-request",
			// @ts-expect-error caller cannot supply the derived Effect Identity
			effectId: "forged",
		},
	);
	return valid;
}

void actionCapabilityContract;
void actionHandlerCapabilityContract;

function actionServiceTypePartition(
	action: ActionServices,
	execution: ExecutionServices,
): void {
	void action["delivery.provider"];
	// @ts-expect-error Action-owned provider cannot bypass Action through root execution
	void execution["delivery.provider"];
	void execution["audit.execution"];
	void execution["collaboration.demo-auth"];
}

void actionServiceTypePartition;
