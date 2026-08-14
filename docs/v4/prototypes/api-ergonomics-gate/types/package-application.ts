import { codec } from "./core";
import { defineReaction } from "./generated-package";

export const auditDelivery = defineReaction({
	name: "audit.delivery",
	input: codec.uuid(),
	handler: ({ input, ctx }) => ctx.actions.audit.write({ messageId: input }),
});
