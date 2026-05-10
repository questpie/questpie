import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const joinTokens = collection("join_tokens")
	.fields(({ f }) => ({
		secretHash: f
			.text()
			.required()
			.outputFalse()
			.label({ en: "Secret Hash" }),
		description: f.text().label({ en: "Description" }),
		createdBy: f.text().label({ en: "Created By" }),
		expiresAt: f.datetime().label({ en: "Expires At" }),
		usedAt: f.datetime().label({ en: "Used At" }),
		usedByWorker: f.relation("workers").label({ en: "Used By Worker" }),
	}))
	.title(({ f }) => f.description)
	.indexes(({ table }) => [
		index("join_tokens_expires_at_idx").on(table.expiresAt as any),
	]);
