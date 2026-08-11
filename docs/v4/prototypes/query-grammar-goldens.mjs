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

const dataContractProjection = {
	format: "questpie.data-contract-projection",
	version: 1,
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
		{ field: IDS.startsAt, direction: "ascending", nulls: "last" },
		{ field: IDS.appointmentId, direction: "ascending", nulls: "last" },
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

const encodedCursor = Buffer.from(bytes(cursor)).toString("base64url");

const expected = {
	dataContractProjectionDigest:
		"525e95c0758ec854764c6dfd9c5e4d86a53cebedab1c54c3eb439d04410b1bbd",
	queryTemplateDigest:
		"554f1fdcf5e5654441d107972e242beb3e58552318dded0207f68a5fc029ad1c",
	scopeDigest:
		"4f50f67d245cbfd8e215be09eb339ea2cb3732a40a96c85e4a2ab6a24e5e6fe4",
	encodedCursor:
		"eyJmb3JtYXQiOiJxdWVzdHBpZS5kYXRhLWN1cnNvciIsIm9yZGVyIjpbeyJmaWVsZCI6ImNvbGxlY3Rpb246YXBwb2ludG1lbnRzL2ZpZWxkOnN0YXJ0c0F0IiwidmFsdWUiOiIyMDI2LTA4LTEyVDA5OjAwOjAwLjAwMFoifSx7ImZpZWxkIjoiY29sbGVjdGlvbjphcHBvaW50bWVudHMvZmllbGQ6aWQiLCJ2YWx1ZSI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMiJ9XSwic2NvcGVEaWdlc3QiOiI0ZjUwZjY3ZDI0NWNiZmQ4ZTIxNWJlMDllYjMzOWVhMmNiMzczMmE0MGE5NmM4NWU0YTJhYjZhMjRlNWU2ZmU0IiwidGVtcGxhdGVEaWdlc3QiOiI1NTRmMWZkY2Y1ZTU2NTQ0NDFkMTA3OTcyZTI0MmJlYjNlNTg1NTIzMThkZGVkMDIwN2Y2OGE1ZmMwMjlhZDFjIiwidmVyc2lvbiI6MX0K",
	dependencyDigest:
		"df168dd53514479e01ea07add9f0b8be87545c4c60ae691d0b1d59ed5cea17ec",
};

const actual = {
	dataContractProjectionDigest,
	queryTemplateDigest,
	scopeDigest,
	encodedCursor,
	dependencyDigest: digest(
		"questpie-data-query-dependency-template-v1\0",
		dependencyTemplate,
	),
};

// A target-owned inverse changes Data Contract bytes but not the schema view.
const definitionWithoutInverse = structuredClone(dataContractProjection);
definitionWithoutInverse.collections[1].relations = [];
function schemaView(projection) {
	return {
		collections: projection.collections.map((collection) => ({
			identity: collection.identity,
			fields: collection.fields,
			relations: collection.relations.filter(
				(relation) => relation.kind === "toOne",
			),
		})),
	};
}
assert.equal(
	bytes(schemaView(definitionWithoutInverse)),
	bytes(schemaView(dataContractProjection)),
);
assert.notEqual(bytes(definitionWithoutInverse), bytes(dataContractProjection));

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
					dataContractProjection: bytes(dataContractProjection),
					queryTemplate: bytes(queryTemplate),
					scope: bytes(scope),
					cursor: bytes(cursor),
					dependencyTemplate: bytes(dependencyTemplate),
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
