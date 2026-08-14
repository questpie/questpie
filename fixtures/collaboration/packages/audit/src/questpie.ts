import { defineCollectionAugmentation, field, index } from "questpie";

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
