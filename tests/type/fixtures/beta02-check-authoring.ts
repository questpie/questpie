import { constraint, defineCollection, field } from "questpie";

const appointmentFields = {
	id: field.uuid({ nullable: false }),
	startsAt: field.timestamp({ nullable: false, withTimezone: true }),
	endsAt: field.timestamp({ nullable: false, withTimezone: true }),
	sequence: field.integer({ nullable: false }),
	payload: field.json({ nullable: false }),
};

const appointments = defineCollection({
	name: "appointments",
	fields: appointmentFields,
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		validWindow: constraint.check<typeof appointmentFields>(({ fields }) =>
			fields.endsAt.greaterThan(fields.startsAt),
		),
	},
});

const exactKind: "check" = appointments.constraints.validWindow.kind;

constraint.check<typeof appointmentFields>(({ fields }) => {
	// @ts-expect-error check Fields preserve exact sibling names
	fields.missing.greaterThan(fields.startsAt);
	// @ts-expect-error ordered comparisons require the same scalar kind
	fields.endsAt.greaterThan(fields.sequence);
	// @ts-expect-error UUID Fields do not expose ordered comparison
	fields.id.greaterThan(fields.id);
	// @ts-expect-error open JSON Fields do not expose ordered comparison
	fields.payload.greaterThan(fields.payload);
	return fields.endsAt.greaterThan(fields.startsAt);
});

// @ts-expect-error the explicit Fields binding is required for exact inference
constraint.check(({ fields }) => fields.endsAt.greaterThan(fields.startsAt));

void exactKind;
