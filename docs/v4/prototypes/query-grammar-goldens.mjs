import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Executable byte-level witness for docs/v4/data-model-and-query-grammar.md.
// It is intentionally throwaway evidence, not a production encoder.

const IDS = {
	appointments: "collection:appointments",
	tenants: "collection:tenants",
	appointmentId: "collection:appointments/field:id",
	tenantId: "collection:appointments/field:tenantId",
	customerName: "collection:appointments/field:customerName",
	startsAt: "collection:appointments/field:startsAt",
	endsAt: "collection:appointments/field:endsAt",
	status: "collection:appointments/field:status",
	tenant: "collection:appointments/relation:tenant",
	tenantPrimary: "collection:tenants/constraint:primary",
	tenantSlugUnique: "collection:tenants/constraint:slugUnique",
	appointmentPrimary: "collection:appointments/constraint:primary",
	tenantPk: "collection:tenants/field:id",
	tenantSlug: "collection:tenants/field:slug",
	tenantName: "collection:tenants/field:name",
	tenantAppointments: "collection:tenants/relation:appointments",
	customers: "collection:customers",
	customerPrimary: "collection:customers/constraint:primary",
	customerId: "collection:customers/field:id",
	customerCity: "collection:customers/field:address/field:city",
	customerPreferences: "collection:customers/field:preferences",
	customerTags: "collection:customers/field:tags",
	customerMetadata: "collection:customers/field:metadata",
};

const FIELD_PATHS = {
	[IDS.appointmentId]: ["id"],
	[IDS.tenantId]: ["tenantId"],
	[IDS.customerName]: ["customerName"],
	[IDS.startsAt]: ["startsAt"],
	[IDS.endsAt]: ["endsAt"],
	[IDS.status]: ["status"],
	[IDS.tenantPk]: ["id"],
	[IDS.tenantSlug]: ["slug"],
	[IDS.tenantName]: ["name"],
};

function canonicalValue(value) {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort(compareAscii)
				.map((key) => [key, canonicalValue(value[key])]),
		);
	}
	return value;
}

function compareAscii(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function chooseUniqueConstraint(orderFields, candidates, nonNullableFields) {
	return candidates
		.filter(
			(candidate) =>
				candidate.fields.every((field) => nonNullableFields.has(field)) &&
				candidate.fields.every(
					(field, index) =>
						orderFields[
							orderFields.length - candidate.fields.length + index
						] === field,
				),
		)
		.sort((left, right) => compareAscii(left.identity, right.identity))[0];
}

assert.equal(
	chooseUniqueConstraint(
		[IDS.startsAt, IDS.appointmentId],
		[
			{
				identity: "collection:appointments/constraint:zAlternateId",
				fields: [IDS.appointmentId],
			},
			{ identity: IDS.appointmentPrimary, fields: [IDS.appointmentId] },
		],
		new Set([IDS.startsAt, IDS.appointmentId]),
	).identity,
	IDS.appointmentPrimary,
);

function bytes(value) {
	return JSON.stringify(canonicalValue(value)) + "\n";
}

function digest(prefix, value) {
	return createHash("sha256").update(prefix).update(bytes(value)).digest("hex");
}

function normalizeSetBinding(values, maximumItems) {
	assert.ok(Array.isArray(values));
	assert.ok(values.length <= maximumItems);
	assert.ok(values.every((value) => value !== null));
	return [...new Set(values)].sort(compareAscii);
}

function requireExactlyOnePrimaryKey(collection) {
	const primaryKeys = collection.constraints.filter(
		(constraint) => constraint.kind === "primaryKey",
	);
	assert.equal(primaryKeys.length, 1);
	return primaryKeys[0];
}

assert.deepEqual(
	normalizeSetBinding(["scheduled", "confirmed", "scheduled"], 50),
	["confirmed", "scheduled"],
);
assert.deepEqual(normalizeSetBinding([], 50), []);
assert.throws(() => normalizeSetBinding(["scheduled", null], 50));
assert.throws(() => normalizeSetBinding(Array.from({ length: 51 }, () => "x"), 50));

const nestedPath = {
	identity: IDS.customerCity,
	path: ["address", "city"],
};
assert.notDeepEqual(nestedPath.path, ["address.city"]);
assert.notEqual(bytes(nestedPath), bytes({ ...nestedPath, path: ["address.city"] }));

const uuid = { kind: "uuid" };
const text80 = {
	kind: "text",
	minLength: null,
	maxLength: 80,
	collation: "questpie.binary",
};
const text160 = {
	kind: "text",
	minLength: null,
	maxLength: 160,
	collation: "questpie.binary",
};
const text24 = {
	kind: "text",
	minLength: null,
	maxLength: 24,
	collation: "questpie.binary",
};
const timestamptz = { kind: "timestamp", withTimezone: true };

const schemaProjection = {
	format: "questpie.schema-projection",
	version: 1,
	application: { name: "barbershop", postgresSchema: "barbershop" },
	requiredPostgres: {
		minimumMajor: 16,
		databaseCollation: "C.UTF-8",
		databaseCType: "C.UTF-8",
		extensions: [],
	},
	collections: [
		{
			identity: IDS.appointments,
			postgresName: "appointments",
			fields: [
				[
					IDS.customerName,
					"customer_name",
					text160,
					false,
					null,
					"questpie.binary",
				],
				[IDS.endsAt, "ends_at", timestamptz, false, null, null],
				[IDS.appointmentId, "id", uuid, false, { kind: "randomUuid" }, null],
				[IDS.startsAt, "starts_at", timestamptz, false, null, null],
				[
					IDS.status,
					"status",
					text24,
					false,
					{ kind: "literal", value: "scheduled" },
					"questpie.binary",
				],
				[IDS.tenantId, "tenant_id", uuid, false, null, null],
			].map(
				([
					identity,
					postgresName,
					type,
					nullable,
					fieldDefault,
					collation,
				]) => ({
					identity,
					path: FIELD_PATHS[identity],
					postgresName,
					type,
					nullable,
					default: fieldDefault,
					collation,
				}),
			),
			constraints: [
				{
					kind: "primaryKey",
					identity: IDS.appointmentPrimary,
					postgresName: "qp_pk_appointments_primary",
					fields: [IDS.appointmentId],
				},
				{
					kind: "check",
					identity: "collection:appointments/constraint:validWindow",
					postgresName: "qp_ck_appointments_valid_window",
					expression: {
						kind: "compare",
						operator: "greaterThan",
						left: { kind: "field", field: IDS.endsAt },
						right: { kind: "field", field: IDS.startsAt },
					},
				},
				{
					kind: "check",
					identity:
						"collection:appointments/field:customerName/invariant:maxLength",
					postgresName: "qp_ck_appointments_customer_name_max_length",
					expression: {
						kind: "compare",
						operator: "lessThanOrEqual",
						left: {
							kind: "textLength",
							expression: { kind: "field", field: IDS.customerName },
						},
						right: { kind: "literal", value: 160 },
					},
				},
				{
					kind: "check",
					identity: "collection:appointments/field:status/invariant:maxLength",
					postgresName: "qp_ck_appointments_status_max_length",
					expression: {
						kind: "compare",
						operator: "lessThanOrEqual",
						left: {
							kind: "textLength",
							expression: { kind: "field", field: IDS.status },
						},
						right: { kind: "literal", value: 24 },
					},
				},
			],
			indexes: [
				{
					kind: "btree",
					identity: "collection:appointments/index:byTenantAndStart",
					postgresName: "qp_ix_appointments_by_tenant_and_start",
					fields: [
						{
							field: IDS.tenantId,
							order: "asc",
							nulls: "last",
							operatorClass: "typeDefault",
							collation: null,
						},
						{
							field: IDS.startsAt,
							order: "asc",
							nulls: "last",
							operatorClass: "typeDefault",
							collation: null,
						},
					],
				},
			],
			relations: [
				{
					kind: "toOne",
					identity: IDS.tenant,
					target: IDS.tenants,
					fields: [IDS.tenantId],
					references: [IDS.tenantPk],
					constraintPostgresName: "qp_fk_appointments_tenant",
					onDelete: "cascade",
					onUpdate: "restrict",
				},
			],
		},
		{
			identity: IDS.tenants,
			postgresName: "tenants",
			fields: [
				[IDS.tenantPk, "id", uuid, false, { kind: "randomUuid" }, null],
				[IDS.tenantName, "name", text160, false, null, "questpie.binary"],
				[IDS.tenantSlug, "slug", text80, false, null, "questpie.binary"],
			].map(
				([
					identity,
					postgresName,
					type,
					nullable,
					fieldDefault,
					collation,
				]) => ({
					identity,
					path: FIELD_PATHS[identity],
					postgresName,
					type,
					nullable,
					default: fieldDefault,
					collation,
				}),
			),
			constraints: [
				{
					kind: "primaryKey",
					identity: IDS.tenantPrimary,
					postgresName: "qp_pk_tenants_primary",
					fields: [IDS.tenantPk],
				},
				{
					kind: "unique",
					identity: "collection:tenants/constraint:slugUnique",
					postgresName: "qp_uq_tenants_slug_unique",
					fields: [IDS.tenantSlug],
				},
				{
					kind: "check",
					identity: "collection:tenants/field:name/invariant:maxLength",
					postgresName: "qp_ck_tenants_name_max_length",
					expression: {
						kind: "compare",
						operator: "lessThanOrEqual",
						left: {
							kind: "textLength",
							expression: { kind: "field", field: IDS.tenantName },
						},
						right: { kind: "literal", value: 160 },
					},
				},
				{
					kind: "check",
					identity: "collection:tenants/field:slug/invariant:maxLength",
					postgresName: "qp_ck_tenants_slug_max_length",
					expression: {
						kind: "compare",
						operator: "lessThanOrEqual",
						left: {
							kind: "textLength",
							expression: { kind: "field", field: IDS.tenantSlug },
						},
						right: { kind: "literal", value: 80 },
					},
				},
			],
			indexes: [],
			relations: [],
		},
	],
};

for (const collection of schemaProjection.collections) {
	requireExactlyOnePrimaryKey(collection);
}
assert.throws(() =>
	requireExactlyOnePrimaryKey({ identity: "collection:keyless", constraints: [] }),
);
assert.throws(() =>
	requireExactlyOnePrimaryKey({
		identity: "collection:ambiguous",
		constraints: [{ kind: "primaryKey" }, { kind: "primaryKey" }],
	}),
);

const nestedSchemaProjection = {
	format: "questpie.schema-projection",
	version: 1,
	application: { name: "nested-proof", postgresSchema: "nested_proof" },
	requiredPostgres: {
		minimumMajor: 16,
		databaseCollation: "C.UTF-8",
		databaseCType: "C.UTF-8",
		extensions: [],
	},
	collections: [
		{
			identity: IDS.customers,
			postgresName: "customers",
			fields: [
				{
					identity: IDS.customerCity,
					path: ["address", "city"],
					postgresName: "address_city",
					type: text160,
					nullable: false,
					default: null,
					collation: "questpie.binary",
				},
				{
					identity: IDS.customerId,
					path: ["id"],
					postgresName: "id",
					type: uuid,
					nullable: false,
					default: { kind: "randomUuid" },
					collation: null,
				},
				{
					identity: IDS.customerMetadata,
					path: ["metadata"],
					postgresName: "metadata",
					type: { kind: "json" },
					nullable: true,
					default: null,
					collation: null,
				},
				{
					identity: IDS.customerPreferences,
					path: ["preferences"],
					postgresName: "preferences",
					type: {
						kind: "object",
						properties: [
							{
								key: "locale",
								codec: { ...text24, nullable: false },
							},
							{
								key: "marketingEmail",
								codec: { kind: "boolean", nullable: false },
							},
						],
					},
					nullable: false,
					default: null,
					collation: null,
				},
				{
					identity: IDS.customerTags,
					path: ["tags"],
					postgresName: "tags",
					type: {
						kind: "array",
						maximumItems: 100,
						items: { ...text24, nullable: false },
					},
					nullable: false,
					default: null,
					collation: null,
				},
			].sort((left, right) => compareAscii(left.identity, right.identity)),
			constraints: [
				{
					kind: "primaryKey",
					identity: IDS.customerPrimary,
					postgresName: "qp_pk_customers_primary",
					fields: [IDS.customerId],
				},
			],
			indexes: [],
			relations: [],
		},
	],
};
requireExactlyOnePrimaryKey(nestedSchemaProjection.collections[0]);
assert.equal(nestedSchemaProjection.collections.length, 1);
assert.ok(
	nestedSchemaProjection.collections[0].fields.every(({ path }) =>
		path.every((segment) => !segment.includes(".")),
	),
);
const sqlNull = null;
const topLevelJsonNull = { kind: "json", value: null };
assert.notDeepEqual(sqlNull, topLevelJsonNull);
const nestedSchemaProjectionDigest = digest(
	"questpie-schema-projection-v1\0",
	nestedSchemaProjection,
);

const schemaProjectionDigest = digest(
	"questpie-schema-projection-v1\0",
	schemaProjection,
);

const dataContractProjection = {
	format: "questpie.data-contract-projection",
	version: 1,
	applicationIdentity: "application:barbershop",
	collections: [
		{
			identity: IDS.appointments,
			primaryKey: {
				identity: IDS.appointmentPrimary,
				fields: [IDS.appointmentId],
			},
			fields: [
				{
					identity: IDS.customerName,
					path: FIELD_PATHS[IDS.customerName],
					codec: text160,
					nullable: false,
					hasDefault: false,
				},
				{
					identity: IDS.endsAt,
					path: FIELD_PATHS[IDS.endsAt],
					codec: timestamptz,
					nullable: false,
					hasDefault: false,
				},
				{
					identity: IDS.appointmentId,
					path: FIELD_PATHS[IDS.appointmentId],
					codec: uuid,
					nullable: false,
					hasDefault: true,
				},
				{
					identity: IDS.startsAt,
					path: FIELD_PATHS[IDS.startsAt],
					codec: timestamptz,
					nullable: false,
					hasDefault: false,
				},
				{
					identity: IDS.status,
					path: FIELD_PATHS[IDS.status],
					codec: text24,
					nullable: false,
					hasDefault: true,
				},
				{
					identity: IDS.tenantId,
					path: FIELD_PATHS[IDS.tenantId],
					codec: uuid,
					nullable: false,
					hasDefault: false,
				},
			].sort((left, right) => compareAscii(left.identity, right.identity)),
			relations: [
				{
					kind: "toOne",
					identity: IDS.tenant,
					target: IDS.tenants,
					fields: [IDS.tenantId],
					references: [IDS.tenantPk],
				},
			],
		},
		{
			identity: IDS.tenants,
			primaryKey: {
				identity: IDS.tenantPrimary,
				fields: [IDS.tenantPk],
			},
			fields: [
				{
					identity: IDS.tenantPk,
					path: FIELD_PATHS[IDS.tenantPk],
					codec: uuid,
					nullable: false,
					hasDefault: true,
				},
				{
					identity: IDS.tenantName,
					path: FIELD_PATHS[IDS.tenantName],
					codec: text160,
					nullable: false,
					hasDefault: false,
				},
				{
					identity: IDS.tenantSlug,
					path: FIELD_PATHS[IDS.tenantSlug],
					codec: text80,
					nullable: false,
					hasDefault: false,
				},
			].sort((left, right) => compareAscii(left.identity, right.identity)),
			relations: [
				{
					kind: "toMany",
					identity: IDS.tenantAppointments,
					inverseOf: IDS.tenant,
					target: IDS.appointments,
				},
			],
		},
	],
};

const dataContractProjectionDigest = digest(
	"questpie-data-contract-projection-v1\0",
	dataContractProjection,
);
const dataContractProjectionWithoutInverse = structuredClone(
	dataContractProjection,
);
dataContractProjectionWithoutInverse.collections.find(
	(collection) => collection.identity === IDS.tenants,
).relations = [];
const dataContractProjectionDigestWithoutInverse = digest(
	"questpie-data-contract-projection-v1\0",
	dataContractProjectionWithoutInverse,
);
assert.notEqual(
	dataContractProjectionDigestWithoutInverse,
	dataContractProjectionDigest,
);

const queryTemplate = {
	format: "questpie.data-query-template",
	version: 1,
	from: IDS.appointments,
	schemaProjectionDigest,
	dataContractProjectionDigest,
	parameters: [
		{ kind: "cursor", name: "after", nullable: true },
		{
			kind: "scalar",
			name: "first",
			codec: { kind: "integer", minimum: 1, maximum: 100 },
			nullable: false,
		},
		{
			kind: "list",
			name: "statuses",
			codec: text24,
			maximumItems: 50,
			nullable: false,
			semantics: "set",
		},
		{ kind: "scalar", name: "tenantId", codec: uuid, nullable: false },
		{ kind: "scalar", name: "tenantSlug", codec: text80, nullable: false },
	],
	select: [
		{ kind: "field", key: "customerName", field: IDS.customerName },
		{ kind: "field", key: "id", field: IDS.appointmentId },
		{ kind: "field", key: "startsAt", field: IDS.startsAt },
		{ kind: "field", key: "status", field: IDS.status },
		{
			kind: "toOne",
			key: "tenant",
			relation: IDS.tenant,
			select: [
				{ kind: "field", key: "name", field: IDS.tenantName },
				{ kind: "field", key: "slug", field: IDS.tenantSlug },
			],
		},
	],
	filter: {
		kind: "and",
		expressions: [
			{
				kind: "equal",
				field: IDS.tenantId,
				operand: { kind: "parameter", parameter: "tenantId" },
			},
			{
				kind: "in",
				field: IDS.status,
				set: { kind: "parameter", parameter: "statuses" },
			},
			{
				kind: "relationExists",
				relation: IDS.tenant,
				filter: {
					kind: "equal",
					field: IDS.tenantSlug,
					operand: { kind: "parameter", parameter: "tenantSlug" },
				},
			},
		],
	},
	order: [
		{ field: IDS.startsAt, direction: "asc", nulls: "last" },
		{ field: IDS.appointmentId, direction: "asc", nulls: "last" },
	],
	page: {
		kind: "forwardCursor",
		first: { kind: "parameter", parameter: "first" },
		after: { kind: "parameter", parameter: "after" },
		uniqueConstraint: IDS.appointmentPrimary,
	},
};

const queryTemplateDigest = digest(
	"questpie-data-query-template-v1\0",
	queryTemplate,
);

const scope = {
	format: "questpie.data-query-scope",
	version: 1,
	templateDigest: queryTemplateDigest,
	values: [
		{
			parameter: "statuses",
			value: normalizeSetBinding(
				["scheduled", "confirmed", "scheduled"],
				50,
			),
		},
		{
			parameter: "tenantId",
			value: "11111111-1111-4111-8111-111111111111",
		},
		{ parameter: "tenantSlug", value: "old-town" },
	],
};

const scopeDigest = digest("questpie-data-query-scope-v1\0", scope);

const cursor = {
	format: "questpie.data-cursor",
	version: 1,
	templateDigest: queryTemplateDigest,
	scopeDigest,
	order: [
		{ field: IDS.startsAt, value: "2026-08-12T09:00:00.000Z" },
		{
			field: IDS.appointmentId,
			value: "00000000-0000-4000-8000-000000000002",
		},
	],
};

// Text cursor ordering delegates every comparison to the fixed
// questpie.binary capability, lowered as explicit PostgreSQL COLLATE "C".
const tenantNameQueryTemplate = {
	format: "questpie.data-query-template",
	version: 1,
	from: IDS.tenants,
	schemaProjectionDigest,
	dataContractProjectionDigest,
	parameters: [
		{ kind: "cursor", name: "after", nullable: true },
		{
			kind: "scalar",
			name: "first",
			codec: { kind: "integer", minimum: 1, maximum: 100 },
			nullable: false,
		},
	],
	select: [
		{ kind: "field", key: "id", field: IDS.tenantPk },
		{ kind: "field", key: "slug", field: IDS.tenantSlug },
	],
	filter: null,
	order: [
		{ field: IDS.tenantSlug, direction: "asc", nulls: "last" },
		{ field: IDS.tenantPk, direction: "asc", nulls: "last" },
	],
	page: {
		kind: "forwardCursor",
		first: { kind: "parameter", parameter: "first" },
		after: { kind: "parameter", parameter: "after" },
		uniqueConstraint: IDS.tenantPrimary,
	},
};
const tenantNameQueryTemplateDigest = digest(
	"questpie-data-query-template-v1\0",
	tenantNameQueryTemplate,
);
const tenantNameCursor = {
	format: "questpie.data-cursor",
	version: 1,
	templateDigest: tenantNameQueryTemplateDigest,
	scopeDigest: digest("questpie-data-query-scope-v1\0", {
		format: "questpie.data-query-scope",
		version: 1,
		templateDigest: tenantNameQueryTemplateDigest,
		values: [],
	}),
	order: [
		{ field: IDS.tenantSlug, value: "old-town" },
		{ field: IDS.tenantPk, value: "00000000-0000-4000-8000-000000000001" },
	],
};
assert.equal(tenantNameCursor.order[0].field, IDS.tenantSlug);

function fieldRead(field, roles) {
	return { field, roles: [...new Set(roles)].sort(compareAscii) };
}

const dependencyTemplate = {
	format: "questpie.data-query-dependency-template",
	version: 1,
	queryTemplateDigest,
	reads: [
		{
			kind: "collection",
			collection: IDS.appointments,
			fields: [
				fieldRead(IDS.appointmentId, ["cursor", "order", "output"]),
				fieldRead(IDS.customerName, ["output"]),
				fieldRead(IDS.startsAt, ["cursor", "order", "output"]),
				fieldRead(IDS.status, ["filter", "output"]),
				fieldRead(IDS.tenantId, ["filter", "joinLocal"]),
			].sort((left, right) => compareAscii(left.field, right.field)),
		},
		{
			kind: "collection",
			collection: IDS.tenants,
			fields: [
				fieldRead(IDS.tenantPk, ["joinReferenced"]),
				fieldRead(IDS.tenantName, ["output"]),
				fieldRead(IDS.tenantSlug, ["filter", "output"]),
			].sort((left, right) => compareAscii(left.field, right.field)),
		},
		{
			kind: "page",
			collection: IDS.appointments,
			orderFields: [IDS.startsAt, IDS.appointmentId],
			uniqueConstraint: IDS.appointmentPrimary,
			direction: "forward",
		},
		{
			kind: "relation",
			relation: IDS.tenant,
			source: IDS.appointments,
			target: IDS.tenants,
			fields: [IDS.tenantId],
			references: [IDS.tenantPk],
		},
	],
};

function relationRead(relationIdentity) {
	if (relationIdentity === IDS.tenant) {
		return {
			kind: "relation",
			relation: IDS.tenant,
			source: IDS.appointments,
			target: IDS.tenants,
			fields: [IDS.tenantId],
			references: [IDS.tenantPk],
		};
	}
	if (relationIdentity === IDS.tenantAppointments) {
		return {
			kind: "relation",
			relation: IDS.tenantAppointments,
			source: IDS.tenants,
			target: IDS.appointments,
			fields: [IDS.tenantPk],
			references: [IDS.tenantId],
		};
	}
	throw new Error(`unknown Relation ${relationIdentity}`);
}

const inverseDependencyTemplate = {
	format: "questpie.data-query-dependency-template",
	version: 1,
	queryTemplateDigest: "inverse-query-template-witness",
	reads: [
		{
			kind: "collection",
			collection: IDS.appointments,
			fields: [
				fieldRead(IDS.status, ["filter"]),
				fieldRead(IDS.tenantId, ["joinReferenced"]),
			].sort((left, right) => compareAscii(left.field, right.field)),
		},
		{
			kind: "collection",
			collection: IDS.tenants,
			fields: [
				fieldRead(IDS.tenantPk, ["cursor", "joinLocal", "order", "output"]),
			],
		},
		{
			kind: "page",
			collection: IDS.tenants,
			orderFields: [IDS.tenantPk],
			uniqueConstraint: IDS.tenantPrimary,
			direction: "forward",
		},
		relationRead(IDS.tenantAppointments),
	].sort((left, right) => {
		const kind = compareAscii(left.kind, right.kind);
		if (kind) return kind;
		return compareAscii(
			left.collection ?? left.relation,
			right.collection ?? right.relation,
		);
	}),
};

assert.deepEqual(relationRead(IDS.tenantAppointments), {
	kind: "relation",
	relation: IDS.tenantAppointments,
	source: IDS.tenants,
	target: IDS.appointments,
	fields: [IDS.tenantPk],
	references: [IDS.tenantId],
});

function compareTerm(rowValue, boundaryValue, term) {
	if (rowValue === null && boundaryValue === null) return 0;
	if (rowValue === null) return term.nulls === "first" ? -1 : 1;
	if (boundaryValue === null) return term.nulls === "first" ? 1 : -1;
	const ordered = compareAscii(rowValue, boundaryValue);
	return term.direction === "desc" ? -ordered : ordered;
}

function compareTuple(row, boundary, order) {
	for (const term of order) {
		const compared = compareTerm(row[term.key], boundary[term.key], term);
		if (compared) return compared;
	}
	return 0;
}

const nullableRows = [
	{ id: "1", startsAt: null },
	{ id: "2", startsAt: "2026-08-12T09:00:00.000Z" },
	{ id: "3", startsAt: null },
	{ id: "4", startsAt: "2026-08-12T10:00:00.000Z" },
];
const nullsLastOrder = [
	{ key: "startsAt", direction: "asc", nulls: "last" },
	{ key: "id", direction: "asc", nulls: "last" },
];
const nullsFirstOrder = [
	{ key: "startsAt", direction: "asc", nulls: "first" },
	{ key: "id", direction: "asc", nulls: "last" },
];
assert.deepEqual(
	nullableRows
		.filter(
			(row) =>
				compareTuple(row, { id: "1", startsAt: null }, nullsLastOrder) > 0,
		)
		.sort((left, right) => compareTuple(left, right, nullsLastOrder))
		.map((row) => row.id),
	["3"],
);
assert.deepEqual(
	nullableRows
		.filter(
			(row) =>
				compareTuple(row, { id: "1", startsAt: null }, nullsFirstOrder) > 0,
		)
		.sort((left, right) => compareTuple(left, right, nullsFirstOrder))
		.map((row) => row.id),
	["3", "2", "4"],
);

const tenantContractWithoutInverse = {
	format: "questpie.collection-definition-contract",
	version: 1,
	name: "tenants",
	postgresName: null,
	fields: [
		{
			path: ["id"],
			contract: {
				type: uuid,
				nullable: false,
				default: { kind: "randomUuid" },
				postgresName: null,
			},
		},
		{
			path: ["name"],
			contract: {
				type: text160,
				nullable: false,
				default: null,
				postgresName: null,
			},
		},
		{
			path: ["slug"],
			contract: {
				type: text80,
				nullable: false,
				default: null,
				postgresName: null,
			},
		},
	],
	constraints: [
		{
			key: "primary",
			contract: {
				kind: "primaryKey",
				fields: ["id"],
				postgresName: null,
			},
		},
		{
			key: "slugUnique",
			contract: {
				kind: "unique",
				fields: ["slug"],
				postgresName: null,
			},
		},
	],
	indexes: [],
	relations: [],
	augmentations: [],
};
const tenantContractWithInverse = structuredClone(tenantContractWithoutInverse);
tenantContractWithInverse.relations.push({
	key: "appointments",
	contract: { kind: "toMany", inverseOf: IDS.tenant },
});
const packageContractDigestWithoutInverse = digest(
	"questpie-structural-contract-v1\0",
	tenantContractWithoutInverse,
);
const packageContractDigestWithInverse = digest(
	"questpie-structural-contract-v1\0",
	tenantContractWithInverse,
);
assert.notEqual(
	packageContractDigestWithoutInverse,
	packageContractDigestWithInverse,
);

// This is a real accepted SchemaProjectionV1 value. Its closed Relation union
// has only toOne, so an inverse cannot be represented here; invariance is by
// construction rather than a differential runtime assertion.

const encodedCursor = Buffer.from(bytes(cursor)).toString("base64url");

const expected = {
	nestedSchemaProjectionDigest:
		"8b5d0008a746caa3ae3f3a21a2b7452af9374b2d1cb86b72841aef7062f38182",
	schemaProjectionDigest:
		"9d757239d4033d042b741b410df593420e14216ae1147173e0f75b2afd5a7033",
	dataContractProjectionDigest:
		"0d5af01332f05f1c4a02cf543c0d242f450adfd378ac455f218df876038c9b4f",
	dataContractProjectionDigestWithoutInverse:
		"61b4c2cd703ae57dc86fd785e6060dedfaec84d7d2cb466f8267edb883ec3a55",
	queryTemplateDigest:
		"a8512fb577f3c4dd653d714f5191f1311788237e9f5d81813bd24c7452f57ac1",
	scopeDigest:
		"89eddbbbe23f6791c5b43acb25aed79c46dbbdc9f8307bf3bf79da8628762215",
	encodedCursor:
		"eyJmb3JtYXQiOiJxdWVzdHBpZS5kYXRhLWN1cnNvciIsIm9yZGVyIjpbeyJmaWVsZCI6ImNvbGxlY3Rpb246YXBwb2ludG1lbnRzL2ZpZWxkOnN0YXJ0c0F0IiwidmFsdWUiOiIyMDI2LTA4LTEyVDA5OjAwOjAwLjAwMFoifSx7ImZpZWxkIjoiY29sbGVjdGlvbjphcHBvaW50bWVudHMvZmllbGQ6aWQiLCJ2YWx1ZSI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMiJ9XSwic2NvcGVEaWdlc3QiOiI4OWVkZGJiYmUyM2Y2NzkxYzViNDNhY2IyNWFlZDc5YzQ2ZGJiZGM5ZjgzMDdiZjNiZjc5ZGE4NjI4NzYyMjE1IiwidGVtcGxhdGVEaWdlc3QiOiJhODUxMmZiNTc3ZjNjNGRkNjUzZDcxNGY1MTkxZjEzMTE3ODgyMzdlOWY1ZDgxODEzYmQyNGM3NDUyZjU3YWMxIiwidmVyc2lvbiI6MX0K",
	tenantNameQueryTemplateDigest:
		"26760166c633b97035223b7c2128e143ee5c4e28eb56fb5c06fb55290210bffb",
	dependencyDigest:
		"210dbd260d5e9597b93e3c5d3168e685267574e3bf4aae37758ea41ba73aeb89",
	inverseDependencyDigest:
		"36b3d95acafe74a371cd19d781b9b39ff67c8fa15c2d239740ff9dcfb48d1ac4",
	packageContractDigestWithoutInverse:
		"a1058368accd86e26bd49d8cef3352a1b1684d9f79276cfaf9567374aa59bbc3",
	packageContractDigestWithInverse:
		"9edfb1e99500008fb321c238f2d993eecf567d737dc4fb28213d7195b2fded25",
};

const actual = {
	nestedSchemaProjectionDigest,
	schemaProjectionDigest,
	dataContractProjectionDigest,
	dataContractProjectionDigestWithoutInverse,
	queryTemplateDigest,
	scopeDigest,
	encodedCursor,
	tenantNameQueryTemplateDigest,
	dependencyDigest: digest(
		"questpie-data-query-dependency-template-v1\0",
		dependencyTemplate,
	),
	inverseDependencyDigest: digest(
		"questpie-data-query-dependency-template-v1\0",
		inverseDependencyTemplate,
	),
	packageContractDigestWithoutInverse,
	packageContractDigestWithInverse,
};

// Semantic-set members normalize; authored sequences remain significant.
const permuted = structuredClone(queryTemplate);
permuted.parameters.reverse();
permuted.select.reverse();
permuted.parameters.sort((left, right) => compareAscii(left.name, right.name));
permuted.select.sort((left, right) => compareAscii(left.key, right.key));
assert.equal(bytes(permuted), bytes(queryTemplate));
const reorderedBoolean = structuredClone(queryTemplate);
reorderedBoolean.filter.expressions.reverse();
assert.notEqual(bytes(reorderedBoolean), bytes(queryTemplate));
const reorderedTerms = structuredClone(queryTemplate);
reorderedTerms.order.reverse();
assert.notEqual(bytes(reorderedTerms), bytes(queryTemplate));

if (process.argv.includes("--print")) {
	console.log(
		JSON.stringify(
			{
				actual,
				bytes: {
					schemaProjection: bytes(schemaProjection),
					nestedSchemaProjection: bytes(nestedSchemaProjection),
					dataContractProjection: bytes(dataContractProjection),
					dataContractProjectionWithoutInverse: bytes(
						dataContractProjectionWithoutInverse,
					),
					queryTemplate: bytes(queryTemplate),
					scope: bytes(scope),
					cursor: bytes(cursor),
					dependencyTemplate: bytes(dependencyTemplate),
					inverseDependencyTemplate: bytes(inverseDependencyTemplate),
					tenantContractWithoutInverse: bytes(tenantContractWithoutInverse),
					tenantContractWithInverse: bytes(tenantContractWithInverse),
				},
			},
			null,
			2,
		),
	);
	process.exit(0);
}

assert.deepEqual(actual, expected);
console.log("query grammar goldens: pass");
