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
					postgresName: "appointments_pkey",
					fields: [IDS.appointmentId],
				},
			],
			indexes: [],
			relations: [
				{
					kind: "toOne",
					identity: IDS.tenant,
					target: IDS.tenants,
					fields: [IDS.tenantId],
					references: [IDS.tenantPk],
					constraintPostgresName: "appointments_tenant_fkey",
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
					postgresName: "tenants_pkey",
					fields: [IDS.tenantPk],
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
	application: "application:barbershop",
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
					relatedCollection: IDS.appointments,
				},
			],
		},
	],
};

const dataContractProjectionDigest = digest(
	"questpie-data-contract-projection-v1\0",
	dataContractProjection,
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

// This is a real accepted SchemaProjectionV1 value. A Data-only inverse cannot
// enter it, while the exact Collection Definition Contract digest does change.
const schemaProjectionBeforeInverse = structuredClone(schemaProjection);
const schemaProjectionAfterInverse = structuredClone(schemaProjection);
assert.equal(
	digest("questpie-schema-projection-v1\0", schemaProjectionBeforeInverse),
	digest("questpie-schema-projection-v1\0", schemaProjectionAfterInverse),
);

const encodedCursor = Buffer.from(bytes(cursor)).toString("base64url");

const expected = {
	schemaProjectionDigest:
		"982d619b7271113c8ef587ec0ea98d5b3be8119d31678eedd48847412bbd8267",
	dataContractProjectionDigest:
		"064dff8993af88bd04aa8fe9bf419687e4b918d7bedc8a48857bb2efb8e0e7f4",
	queryTemplateDigest:
		"62c7f7329c10594cc38f6732066d80857f33f3d1303fa641438f5035e2ce8a34",
	scopeDigest:
		"6c3581dba2abd8c4c4a56c7289e20df5cd84dc60b167bf15dfdd9c1bd1590763",
	encodedCursor:
		"eyJmb3JtYXQiOiJxdWVzdHBpZS5kYXRhLWN1cnNvciIsIm9yZGVyIjpbeyJmaWVsZCI6ImNvbGxlY3Rpb246YXBwb2ludG1lbnRzL2ZpZWxkOnN0YXJ0c0F0IiwidmFsdWUiOiIyMDI2LTA4LTEyVDA5OjAwOjAwLjAwMFoifSx7ImZpZWxkIjoiY29sbGVjdGlvbjphcHBvaW50bWVudHMvZmllbGQ6aWQiLCJ2YWx1ZSI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMiJ9XSwic2NvcGVEaWdlc3QiOiI2YzM1ODFkYmEyYWJkOGM0YzRhNTZjNzI4OWUyMGRmNWNkODRkYzYwYjE2N2JmMTVkZmRkOWMxYmQxNTkwNzYzIiwidGVtcGxhdGVEaWdlc3QiOiI2MmM3ZjczMjljMTA1OTRjYzM4ZjY3MzIwNjZkODA4NTdmMzNmM2QxMzAzZmE2NDE0MzhmNTAzNWUyY2U4YTM0IiwidmVyc2lvbiI6MX0K",
	dependencyDigest:
		"01da685ab49b021d0513c00a000b6cffa8f4e8bf78edc2db56975aacc9851fe8",
	inverseDependencyDigest:
		"4c976afe07288ba433d9ae9c1a51758af8e157285dc39b42d565af6dd4f068ae",
	packageContractDigestWithoutInverse:
		"dc4f61167f6ef63c27ca79d2519f166f356273a261e64de4eab75aef4275e61a",
	packageContractDigestWithInverse:
		"eb94448e54da9e32b728e265e69f3fb828bb343e841f8d5a1e322682bae2d30d",
};

const actual = {
	schemaProjectionDigest,
	dataContractProjectionDigest,
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
