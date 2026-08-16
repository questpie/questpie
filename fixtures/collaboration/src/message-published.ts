import { codec } from "questpie";

import { defineReaction } from "#questpie/app";

export const messagePublished = defineReaction({
	name: "messagePublished",
	input: codec.object({
		companyId: codec.uuid(),
		messageId: codec.uuid(),
	}),
});
