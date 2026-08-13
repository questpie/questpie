import { operation } from "./framework";
import { defineQuery } from "./generated-package";

export const auditEvent = defineQuery({
	name: "acme.audit.event",
	input: operation.object<{ id: string }>(),
	handler: async ({ input, ctx }) => {
		const event = await ctx.data.auditEvents.get({ key: input });

		// @ts-expect-error A reusable Package cannot see host-only Collections.
		ctx.data.messages;
		return event;
	},
});
