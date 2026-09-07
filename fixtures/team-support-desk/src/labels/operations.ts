import { defineCollectionOperations } from "questpie";

import { labels } from "./index";
import { labelPolicy } from "./policy";

export const labelOperations = defineCollectionOperations(labels, {
	name: "labels",
	policy: labelPolicy,
	get: { select: { id: true, ticketId: true, name: true, color: true } },
});
