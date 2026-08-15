import {
	constraint,
	defineCollection,
	defineSeed,
	field,
	seed,
} from "questpie";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <
		Value,
	>() => Value extends Right ? 1 : 2
		? true
		: false;

const messages = defineCollection({
	name: "messages",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		body: field.text({ nullable: false }),
		note: field.text({ nullable: true }),
		createdAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});

seed.insert(messages, { body: "hello" });
seed.insert(messages, {
	body: "hello",
	note: null,
	createdAt: "2026-08-14T12:00:00.000Z",
});
// @ts-expect-error timestamp values are canonical strings at every public boundary
seed.insert(messages, { body: "hello", createdAt: new Date(0) });
seed.update(messages, {
	key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
	values: { body: "updated", note: null },
});

// @ts-expect-error body is required and has no default
seed.insert(messages, {});
// @ts-expect-error a non-nullable Field does not accept null
seed.insert(messages, { body: null });
// @ts-expect-error values contain only declared Fields
seed.insert(messages, { body: "hello", unknown: true });
// @ts-expect-error timestamp Seed values are canonical strings
seed.insert(messages, { body: "hello", createdAt: 42 });
// @ts-expect-error a key contains the exact primary key only
seed.update(messages, { key: { id: "id", body: "extra" }, values: {} });

const memberships = defineCollection({
	name: "memberships",
	fields: {
		companyId: field.uuid({ nullable: false }),
		principalId: field.uuid({ nullable: false }),
		role: field.text({ nullable: false }),
	},
	constraints: {
		primary: constraint.primaryKey({
			fields: ["companyId", "principalId"],
		}),
	},
});

seed.delete(memberships, { companyId: "company", principalId: "principal" });
// @ts-expect-error every composite primary-key Field is required
seed.delete(memberships, { companyId: "company" });
// @ts-expect-error a primary-key Field cannot be null
seed.delete(memberships, { companyId: "company", principalId: null });
seed.upsert(memberships, {
	key: { companyId: "company", principalId: "principal" },
	create: { role: "member" },
	update: { role: "admin" },
});
seed.upsert(memberships, {
	key: { companyId: "company", principalId: "principal" },
	// @ts-expect-error upsert create cannot repeat a primary-key Field
	create: { companyId: "other", role: "member" },
	update: {},
});
seed.upsert(memberships, {
	key: { companyId: "company", principalId: "principal" },
	create: { role: "member" },
	// @ts-expect-error upsert update cannot repeat a primary-key Field
	update: { principalId: "other" },
});

const demo = defineSeed({
	name: "collaboration.demo.v1",
	dependsOn: ["collaboration.base.v1"],
	steps: [seed.insert(messages, { body: "hello" })],
});

const exactName: Equal<typeof demo.name, "collaboration.demo.v1"> = true;
const exactDependencies: Equal<
	typeof demo.dependsOn,
	readonly ["collaboration.base.v1"]
> = true;
const exactKind: Equal<(typeof demo.steps)[0]["kind"], "insert"> = true;
const exactCollection: Equal<
	(typeof demo.steps)[0]["collection"],
	"collection:messages"
> = true;

void [exactName, exactDependencies, exactKind, exactCollection];
