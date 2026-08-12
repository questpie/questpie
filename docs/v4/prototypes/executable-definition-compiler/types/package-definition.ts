import { operation } from "questpie";

import { defineQuery } from "#questpie/package";

export const auditEvent = defineQuery({
	name: "acme.audit.event",
	input: operation.object({ sequence: operation.integer() }),
	handler: async ({ ctx }) => {
		const event = await ctx.data.auditEvents.get({
			key: { sequence: 1 },
			select: { sequence: true, subject: true },
		});

		// @ts-expect-error A Package cannot see the host-only Messages Collection.
		ctx.data.messages;
		return event;
	},
});
