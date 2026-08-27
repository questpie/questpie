import { describe, expect, test } from "bun:test";

import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import {
	dataQueryTemplateDigest,
	normalizeDataQueryTemplate,
	normalizePolicyPrograms,
	policyProgramDigest,
	selectDefaultPolicy,
} from "../../packages/compiler/src/relational";

const membershipPolicy = {
	identity: "policy:memberships.default",
	target: "collection:memberships",
	attachment: { kind: "default", requiredForNormalDataAccess: true },
	operations: {
		read: {
			admission: { kind: "authenticated" },
			rows: {
				kind: "equal",
				left: {
					kind: "executionFact",
					source: "authority",
					path: ["kind"],
					codec: "authority",
				},
				right: { kind: "literal", codec: "authority", value: "system" },
			},
		},
	},
	evidenceUse: {
		allowedAsBooleanOnly: true,
		targetDisclosurePolicyApplied: false,
	},
	disclosureUse: {
		targetDisclosurePolicyApplied: true,
		ordinaryAuthorityRows: "none",
	},
} as const;

const ids = {
	appointments: "collection:appointments",
	appointmentId: "collection:appointments/field:id",
	tenantId: "collection:appointments/field:tenantId",
	customerName: "collection:appointments/field:customerName",
	startsAt: "collection:appointments/field:startsAt",
	status: "collection:appointments/field:status",
	tenant: "collection:appointments/relation:tenant",
	tenantPk: "collection:tenants/field:id",
	tenantSlug: "collection:tenants/field:slug",
	tenantName: "collection:tenants/field:name",
	appointmentPrimary: "collection:appointments/constraint:primary",
} as const;

const uuid = { kind: "uuid" } as const;
const text80 = {
	kind: "text",
	minLength: null,
	maxLength: 80,
	collation: "questpie.binary",
} as const;
const text24 = {
	kind: "text",
	minLength: null,
	maxLength: 24,
	collation: "questpie.binary",
} as const;

function queryInput() {
	return {
		from: ids.appointments,
		parameters: [
			{ kind: "scalar", name: "tenantSlug", codec: text80, nullable: false },
			{ kind: "scalar", name: "tenantId", codec: uuid, nullable: false },
			{
				kind: "list",
				name: "statuses",
				codec: text24,
				maximumItems: 50,
				nullable: false,
				semantics: "set",
			},
			{
				kind: "scalar",
				name: "first",
				codec: { kind: "integer", minimum: 1, maximum: 100 },
				nullable: false,
			},
			{ kind: "cursor", name: "after", nullable: true },
		],
		select: [
			{
				kind: "toOne",
				key: "tenant",
				relation: ids.tenant,
				select: [
					{ kind: "field", key: "slug", field: ids.tenantSlug },
					{ kind: "field", key: "name", field: ids.tenantName },
				],
			},
			{ kind: "field", key: "status", field: ids.status },
			{ kind: "field", key: "startsAt", field: ids.startsAt },
			{ kind: "field", key: "id", field: ids.appointmentId },
			{ kind: "field", key: "customerName", field: ids.customerName },
		],
		filter: {
			kind: "and",
			expressions: [
				{
					kind: "equal",
					field: ids.tenantId,
					operand: { kind: "parameter", parameter: "tenantId" },
				},
				{
					kind: "in",
					field: ids.status,
					set: { kind: "parameter", parameter: "statuses" },
				},
				{
					kind: "relationExists",
					relation: ids.tenant,
					filter: {
						kind: "equal",
						field: ids.tenantSlug,
						operand: { kind: "parameter", parameter: "tenantSlug" },
					},
				},
			],
		},
		order: [
			{ field: ids.startsAt, direction: "asc", nulls: "last" },
			{ field: ids.appointmentId, direction: "asc", nulls: "last" },
		],
		page: {
			kind: "forwardCursor",
			first: { kind: "parameter", parameter: "first" },
			after: { kind: "parameter", parameter: "after" },
			uniqueConstraint: ids.appointmentPrimary,
		},
	} as const;
}

describe("BETA-04 relational normalization", () => {
	test("reproduces the accepted P2 Policy Program bytes", () => {
		const [program] = normalizePolicyPrograms([membershipPolicy]);
		expect(program).toMatchObject({
			format: "questpie.policy-program",
			version: 1,
			identity: "policy:memberships.default",
		});
		expect(policyProgramDigest(program!)).toBe(
			"1e6013e7f682862d5c6a91a6666c4512a267353e37c58db419fa1399c8b92b1c",
		);
	});

	test("reproduces the accepted foundational Query Template bytes", () => {
		const template = normalizeDataQueryTemplate(queryInput(), {
			schemaProjectionDigest:
				"9d757239d4033d042b741b410df593420e14216ae1147173e0f75b2afd5a7033",
			dataContractProjectionDigest:
				"0d5af01332f05f1c4a02cf543c0d242f450adfd378ac455f218df876038c9b4f",
		});
		expect(template.parameters.map(({ name }) => name)).toEqual([
			"after",
			"first",
			"statuses",
			"tenantId",
			"tenantSlug",
		]);
		expect(template.select.map(({ key }) => key)).toEqual([
			"customerName",
			"id",
			"startsAt",
			"status",
			"tenant",
		]);
		expect(dataQueryTemplateDigest(template)).toBe(
			"a8512fb577f3c4dd653d714f5191f1311788237e9f5d81813bd24c7452f57ac1",
		);
	});

	test("normalizes object-authored selections recursively through four to-one hops", () => {
		const input = queryInput() as unknown as Record<string, unknown>;
		input.select = [
			{
				kind: "toOne",
				key: "team",
				relation: "collection:tickets/relation:team",
				select: [
					{
						kind: "toOne",
						key: "organization",
						relation: "collection:teams/relation:organization",
						select: [
							{
								kind: "toOne",
								key: "region",
								relation: "collection:organizations/relation:region",
								select: [
									{
										kind: "toOne",
										key: "country",
										relation: "collection:regions/relation:country",
										select: [
											{
												kind: "field",
												key: "name",
												field: "collection:countries/field:name",
											},
										],
									},
								],
							},
						],
					},
				],
			},
		];
		const template = normalizeDataQueryTemplate(input, {
			schemaProjectionDigest: "a".repeat(64),
			dataContractProjectionDigest: "b".repeat(64),
		});
		const team = template.select[0];
		expect(team?.kind).toBe("toOne");
		if (team?.kind !== "toOne") throw new Error("expected team Relation");
		const organization = team.select[0];
		expect(organization?.kind).toBe("toOne");
		if (organization?.kind !== "toOne")
			throw new Error("expected organization Relation");
		const region = organization.select[0];
		expect(region?.kind).toBe("toOne");
		if (region?.kind !== "toOne") throw new Error("expected region Relation");
		const country = region.select[0];
		expect(country?.kind).toBe("toOne");
		if (country?.kind !== "toOne") throw new Error("expected country Relation");
		expect(country.select).toEqual([
			{
				kind: "field",
				key: "name",
				field: "collection:countries/field:name",
			},
		]);

		const tooDeep = structuredClone(input) as Record<string, unknown>;
		const teamInput = (tooDeep.select as Array<Record<string, unknown>>)[0]!;
		const organizationInput = (
			teamInput.select as Array<Record<string, unknown>>
		)[0]!;
		const regionInput = (
			organizationInput.select as Array<Record<string, unknown>>
		)[0]!;
		const countryInput = (
			regionInput.select as Array<Record<string, unknown>>
		)[0]!;
		countryInput.select = [
			{
				kind: "toOne",
				key: "continent",
				relation: "collection:countries/relation:continent",
				select: [
					{
						kind: "field",
						key: "id",
						field: "collection:continents/field:id",
					},
				],
			},
		];
		let diagnostic: unknown;
		try {
			normalizeDataQueryTemplate(
				tooDeep,
				{
					schemaProjectionDigest: "a".repeat(64),
					dataContractProjectionDigest: "b".repeat(64),
				},
				{ path: "src/ticket-query.ts", exportName: "ticketQueue" },
			);
		} catch (error) {
			diagnostic = error;
		}
		expect(diagnostic).toBeInstanceOf(CompilerDiagnosticError);
		expect(diagnostic).toMatchObject({
			code: "QP-DATA-022",
			diagnosticClass: "relationDepthExceeded",
			details: {
				path: "team.organization.region.country.continent",
				origin: {
					path: "src/ticket-query.ts",
					exportName: "ticketQueue",
				},
			},
		});
	});

	test("selects one default Policy and reports zero or two deterministically", () => {
		const [only] = normalizePolicyPrograms([membershipPolicy]);
		expect(
			selectDefaultPolicy("collection:memberships", [only!]).identity,
		).toBe("policy:memberships.default");
		const programs = normalizePolicyPrograms([
			membershipPolicy,
			{
				...membershipPolicy,
				identity: "policy:memberships.alternate",
			},
		]);
		try {
			selectDefaultPolicy("collection:messages", programs);
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({
				code: "QP-POLICY-001",
				diagnosticClass: "missingDefaultPolicy",
				details: {
					collection: "collection:messages",
					candidates: [],
					failClosed: true,
				},
			});
		}
		try {
			selectDefaultPolicy("collection:memberships", programs);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect(error).toMatchObject({
				code: "QP-POLICY-002",
				diagnosticClass: "ambiguousDefaultPolicy",
				details: {
					collection: "collection:memberships",
					candidates: [
						"policy:memberships.alternate",
						"policy:memberships.default",
					],
					failClosed: true,
				},
			});
		}
	});

	test("rejects an unknown relational operator with QP-DATA-005", () => {
		const input = queryInput() as unknown as Record<string, unknown>;
		input.filter = {
			kind: "contains",
			field: ids.status,
			operand: { kind: "literal", codec: text24, value: "scheduled" },
		};
		try {
			normalizeDataQueryTemplate(input, {
				schemaProjectionDigest: "a".repeat(64),
				dataContractProjectionDigest: "b".repeat(64),
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect(error).toMatchObject({
				code: "QP-DATA-005",
				diagnosticClass: "invalidOperator",
			});
		}
	});
});
