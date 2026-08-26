import { defineCollectionOperations } from "questpie";

import { organizations } from "../organizations";
import { organizationPolicy } from "./policy";

export const organizationOperations = defineCollectionOperations(
	organizations,
	{
		name: "organizations",
		policy: organizationPolicy,
		get: { select: { id: true, name: true, createdAt: true, updatedAt: true } },
	},
);
