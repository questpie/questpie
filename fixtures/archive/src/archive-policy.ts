import { definePolicy, expr, policy } from "questpie";

import { embargoes } from "./embargoes";
import { provenance } from "./provenance";
import { records } from "./records";
import { researchPermits } from "./research-permits";

export const recordPolicy = definePolicy(records, {
	name: "records.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row: record, principal }) =>
			expr.or(
				expr.and(
					record.visibility.equal("public"),
					expr.not(
						expr.exists(embargoes, ({ row: embargo }) =>
							expr.and(
								embargo.archiveCode.equal(record.archiveCode),
								embargo.catalogueNumber.equal(record.catalogueNumber),
								embargo.status.equal("active"),
							),
						),
					),
				),
				expr.exists(researchPermits, ({ row: permit }) =>
					expr.and(
						permit.programmeCode.equal("programme-linguistics"),
						permit.archiveCode.equal(record.archiveCode),
						permit.principalId.equal(principal.id),
						permit.status.equal("active"),
					),
				),
			),
	},
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, principal }) =>
			expr.exists(researchPermits, ({ row: permit }) =>
				expr.and(
					permit.programmeCode.equal("programme-linguistics"),
					permit.archiveCode.equal(candidate.archiveCode),
					permit.principalId.equal(principal.id),
					permit.status.equal("active"),
					permit.mayDeposit.equal(true),
				),
			),
	},
	fields: {
		create: () => ({
			archiveCode: expr.always(),
			catalogueNumber: expr.always(),
			visibility: expr.always(),
			title: expr.always(),
			body: expr.always(),
		}),
		output: ({ row: record, principal }) => ({
			body: expr.exists(researchPermits, ({ row: permit }) =>
				expr.and(
					permit.programmeCode.equal("programme-linguistics"),
					permit.archiveCode.equal(record.archiveCode),
					permit.principalId.equal(principal.id),
					permit.status.equal("active"),
					permit.mayViewRestricted.equal(true),
				),
			),
		}),
	},
});

export const provenancePolicy = definePolicy(provenance, {
	name: "provenance.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, principal }) =>
			expr.exists(researchPermits, ({ row: permit }) =>
				expr.and(
					permit.programmeCode.equal("programme-linguistics"),
					permit.archiveCode.equal(row.archiveCode),
					permit.principalId.equal(principal.id),
					permit.status.equal("active"),
				),
			),
	},
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, principal }) =>
			expr.exists(researchPermits, ({ row: permit }) =>
				expr.and(
					permit.programmeCode.equal("programme-linguistics"),
					permit.archiveCode.equal(candidate.archiveCode),
					permit.principalId.equal(principal.id),
					permit.status.equal("active"),
				),
			),
	},
	fields: {
		create: () => ({
			archiveCode: expr.always(),
			catalogueNumber: expr.always(),
			sequence: expr.always(),
			kind: expr.always(),
			note: expr.always(),
		}),
	},
});
