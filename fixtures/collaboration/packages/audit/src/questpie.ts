import {
	defineCollectionAugmentation,
	defineService,
	field,
	index,
} from "questpie";

export const auditReader = defineService({
	name: "questpie.auditReader",
	lifetime: "execution",
	effect: "read",
	create: () => Object.freeze({ source: "audit" as const }),
});

export const messageAudit = defineCollectionAugmentation({
	name: "questpie.auditFieldsV1",
	fields: {
		auditId: field.uuid({ nullable: true }),
		auditedAt: field.timestamp({ nullable: true, withTimezone: true }),
	},
	indexes: {
		byAuditId: index({ fields: ["auditId"] }),
	},
});
