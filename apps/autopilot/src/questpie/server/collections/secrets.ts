import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const secrets = collection("secrets")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		scope: f.text().label({ en: "Scope" }),
		encryptedValue: f.text().label({ en: "Encrypted Value" }).outputFalse(),
		iv: f.text().label({ en: "IV" }).outputFalse(),
		authTag: f.text().label({ en: "Auth Tag" }).outputFalse(),
		description: f.textarea().label({ en: "Description" }),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Secrets" },
		icon: c.icon("ph:key"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			fields: [f.name, f.scope, f.description],
		}),
	)
	.indexes(({ table }) => [
		index("secrets_scope_idx").on(table.scope as any),
	]);
