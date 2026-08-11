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
	appointmentPrimary: "collection:appointments/constraint:primary",
	tenantPk: "collection:tenants/field:id",
	tenantSlug: "collection:tenants/field:slug",
	tenantName: "collection:tenants/field:name",
	tenantAppointments: "collection:tenants/relation:appointments",
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

function bytes(value) {
	return JSON.stringify(canonicalValue(value)) + "\n";
}

function digest(prefix, value) {
	return createHash("sha256").update(prefix).update(bytes(value)).digest("hex");
}

const uuid = { kind: "uuid" };
const text80 = { kind: "text", minLength: null, maxLength: 80 };
const text160 = { kind: "text", minLength: null, maxLength: 160 };
const text24 = { kind: "text", minLength: null, maxLength: 24 };
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
					"databaseDefault",
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
					"databaseDefault",
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
				[IDS.tenantName, "name", text160, false, null, "databaseDefault"],
				[IDS.tenantSlug, "slug", text80, false, null, "databaseDefault"],
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
			fields: [
				{
					identity: IDS.customerName,
					codec: text160,
					nullable: false,
					hasDefault: false,
				},
				{
					identity: IDS.endsAt,
					codec: timestamptz,
					nullable: false,
					hasDefault: false,
				},
				{
					identity: IDS.appointmentId,
					codec: uuid,
					nullable: false,
					hasDefault: true,
				},
				{
					identity: IDS.startsAt,
					codec: timestamptz,
					nullable: false,
					hasDefault: false,
				},
				{
					identity: IDS.status,
					codec: text24,
					nullable: false,
					hasDefault: true,
				},
				{
					identity: IDS.tenantId,
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
			fields: [
				{
					identity: IDS.tenantPk,
					codec: uuid,
					nullable: false,
					hasDefault: true,
				},
				{
					identity: IDS.tenantName,
					codec: text160,
					nullable: false,
					hasDefault: false,
				},
				{
					identity: IDS.tenantSlug,
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
				operands: ["scheduled", "confirmed"].map((value) => ({
					kind: "literal",
					codec: text24,
					value,
				})),
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
			fields: [fieldRead(IDS.tenantPk, ["joinLocal", "output"])],
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
			key: "id",
			contract: {
				type: uuid,
				nullable: false,
				default: { kind: "randomUuid" },
				postgresName: null,
			},
		},
		{
			key: "name",
			contract: {
				type: text160,
				nullable: false,
				default: null,
				postgresName: null,
			},
		},
		{
			key: "slug",
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
	schemaProjectionDigest:
		"f480aa0a422b0413f77d42d23775bdff61673a531207d5f1a73d66c3ce77eb51",
	dataContractProjectionDigest:
		"f67e5385caa5d12238a8002ff7a74f0c72d29dbcbcfa387c4b8c84917e70846e",
	dataContractProjectionDigestWithoutInverse:
		"5428aed4288392396e3aaccce381bd172af358d4ccb32e19e082e31e07efa096",
	queryTemplateDigest:
		"5c95f7128eb114795238ec0f4a1915565158f76868e66c4649ab6300b5f764c0",
	scopeDigest:
		"9f7bdeacaa6501682175742feedd00e6f23f74983f56af1306a43d91348eb2e8",
	encodedCursor:
		"eyJmb3JtYXQiOiJxdWVzdHBpZS5kYXRhLWN1cnNvciIsIm9yZGVyIjpbeyJmaWVsZCI6ImNvbGxlY3Rpb246YXBwb2ludG1lbnRzL2ZpZWxkOnN0YXJ0c0F0IiwidmFsdWUiOiIyMDI2LTA4LTEyVDA5OjAwOjAwLjAwMFoifSx7ImZpZWxkIjoiY29sbGVjdGlvbjphcHBvaW50bWVudHMvZmllbGQ6aWQiLCJ2YWx1ZSI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMiJ9XSwic2NvcGVEaWdlc3QiOiI5ZjdiZGVhY2FhNjUwMTY4MjE3NTc0MmZlZWRkMDBlNmYyM2Y3NDk4M2Y1NmFmMTMwNmE0M2Q5MTM0OGViMmU4IiwidGVtcGxhdGVEaWdlc3QiOiI1Yzk1ZjcxMjhlYjExNDc5NTIzOGVjMGY0YTE5MTU1NjUxNThmNzY4NjhlNjZjNDY0OWFiNjMwMGI1Zjc2NGMwIiwidmVyc2lvbiI6MX0K",
	dependencyDigest:
		"8af767ea2590d2bc268f501ee9f1118024d1c9331d3421ee16f1d697f92a6f70",
	inverseDependencyDigest:
		"4c976afe07288ba433d9ae9c1a51758af8e157285dc39b42d565af6dd4f068ae",
	packageContractDigestWithoutInverse:
		"8485be44dab1547a7d42eda65c0a2098a5d64e0bdeee466d671598fd6c2afb88",
	packageContractDigestWithInverse:
		"6bc7c94182da534eefd44dcdf5e79388f5f0e54bf0f48e577220be8e0116bb34",
};

const actual = {
	schemaProjectionDigest,
	dataContractProjectionDigest,
	dataContractProjectionDigestWithoutInverse,
	queryTemplateDigest,
	scopeDigest,
	encodedCursor,
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
