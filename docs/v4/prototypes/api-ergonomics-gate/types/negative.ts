import { codec } from "./core";
import {
	defineMutation,
	defineQuery,
	defineReaction,
	defineJob,
	defineRoute,
	defineWorkflow,
	type GeneratedActions,
	type GeneratedMutations,
} from "./generated-app";
import type { PackageContext } from "./generated-package";

declare const actions: GeneratedActions;
declare const mutations: GeneratedMutations;
declare const packageContext: PackageContext;

// @ts-expect-error exact flat names are canonical identities, not a second public call surface
actions["delivery.sendMessage"]({ message: { id: "1", body: "hello" } });

// @ts-expect-error exact flat names are not public Mutation members
mutations["messages.recordDelivery"]({
	messageId: "1",
	providerMessageId: "provider-1",
});

// @ts-expect-error a Package contract cannot see host application Operations
packageContext.actions.delivery.sendMessage({
	message: { id: "1", body: "hello" },
});

defineReaction({
	name: "negative.reaction",
	input: codec.uuid(),
	handler({ ctx }) {
		// @ts-expect-error Reaction has no ambient dispatch idempotency capability
		return ctx.idempotencyKey;
	},
});

defineWorkflow({
	name: "negative.workflow",
	input: codec.uuid(),
	async handler({ step }) {
		// @ts-expect-error Workflow exposes only named Mutation and Action steps
		await step.run({ name: "untyped" });
	},
});

defineJob({
	name: "negative.job",
	input: codec.uuid(),
	handler({ ctx }) {
		// @ts-expect-error durable Job attempts never receive an HTTP Request
		return ctx.request;
	},
});

defineQuery({
	name: "negative.query",
	input: codec.uuid(),
	handler({ ctx }) {
		// @ts-expect-error Query does not own durable retry policy
		return ctx.retry;
	},
});

defineMutation({
	name: "negative.mutation",
	input: codec.uuid(),
	handler({ ctx }) {
		// @ts-expect-error Mutation cannot perform external byte-store effects
		return ctx.byteStore;
	},
});

defineRoute({
	name: "negative.route",
	input: codec.uuid(),
	handler({ ctx }) {
		// @ts-expect-error Route transport context is not a data authority
		return ctx.data;
	},
});
