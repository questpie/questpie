import {
	constraint,
	defineCollection,
	field,
	relation,
	relationRef,
	type RelationReference,
} from "questpie";

const companies = defineCollection({
	name: "companies",
	fields: {
		id: field.uuid(),
		slug: field.text(),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		slugUnique: constraint.unique({ fields: ["slug"] }),
	},
});

const spaces = defineCollection({
	name: "spaces",
	fields: {
		id: field.uuid(),
		companyId: field.uuid(),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	relations: {
		company: relation.toOne({
			target: companies,
			fields: ["companyId"],
			references: ["id"],
		}),
	},
});

const inverse = relationRef("spaces", "company");
const exactInverse: RelationReference<"spaces", "company"> = inverse;
const exactTarget: "collection:companies" = spaces.relations.company.target;

relation.toOne({
	// @ts-expect-error owning Relations accept the target Definition, not a string
	target: "collection:companies",
	fields: ["id"],
	// @ts-expect-error an invalid target cannot supply referenced Fields
	references: ["id"],
});
// @ts-expect-error one-argument collection references are not public authoring
relationRef("companies");
relation.toOne({
	target: companies,
	fields: ["companyId"],
	// @ts-expect-error referenced Fields must exist on the target Collection
	references: ["missing"],
});

void exactInverse;
void exactTarget;
