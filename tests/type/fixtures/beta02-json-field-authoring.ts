import { constraint, defineCollection, field, seed, value } from "questpie";

const profiles = defineCollection({
	name: "profiles",
	fields: {
		id: field.uuid({ nullable: false }),
		preferences: field.object({
			nullable: false,
			properties: {
				locale: value.text({ nullable: false, maxLength: 16 }),
				marketingEmail: value.boolean({ nullable: true }),
				aliases: value.array({
					nullable: false,
					items: value.text({ nullable: false }),
					maximumItems: 10,
				}),
			},
		}),
		tags: field.array({
			nullable: false,
			items: value.text({ nullable: false }),
			maximumItems: 100,
		}),
		metadata: field.json({ nullable: true }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

seed.insert(profiles, {
	id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	preferences: {
		locale: "sk",
		marketingEmail: null,
		aliases: ["domo", "drepkovsky"],
	},
	tags: ["owner"],
	metadata: { kind: "json", value: null },
});
seed.insert(profiles, {
	id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1",
	preferences: { locale: "en", marketingEmail: true, aliases: [] },
	tags: [],
	metadata: null,
});

seed.insert(profiles, {
	id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
	// @ts-expect-error every closed object property is present
	preferences: { locale: "sk", aliases: [] },
	tags: [],
});
seed.insert(profiles, {
	id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
	preferences: {
		locale: "sk",
		marketingEmail: true,
		aliases: [],
		// @ts-expect-error closed objects reject undeclared properties
		unknown: true,
	},
	tags: [],
});
seed.insert(profiles, {
	id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	preferences: { locale: "sk", marketingEmail: true, aliases: [] },
	tags: [],
	// @ts-expect-error open JSON requires its public tag
	metadata: { arbitrary: true },
});
// @ts-expect-error embedded values cannot own PostgreSQL names
value.text({ nullable: false, postgres: { name: "bad" } });
// @ts-expect-error JSON-backed Fields have no schema defaults in v1
field.json({ nullable: false, default: { kind: "json", value: null } });
