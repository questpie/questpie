import { definePolicy, policy, query } from "questpie";

import { embargoes } from "./embargoes";
import { provenance } from "./provenance";
import { records } from "./records";
import { researchPermits } from "./research-permits";

export const recordPolicy = definePolicy(records, {
	name: "records.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row: record, principal }) =>
			query.or(
				query.and(
					record.visibility.equal("public"),
					query.not(
						policy.exists(embargoes, ({ row: embargo }) =>
							query.and(
								embargo.archiveCode.equal(record.archiveCode),
								embargo.catalogueNumber.equal(record.catalogueNumber),
								embargo.status.equal("active"),
							),
						),
					),
				),
				policy.exists(researchPermits, ({ row: permit }) =>
					query.and(
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
			policy.exists(researchPermits, ({ row: permit }) =>
				query.and(
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
			archiveCode: query.always(),
			catalogueNumber: query.always(),
			visibility: query.always(),
			title: query.always(),
			body: query.always(),
		}),
		output: ({ row: record, principal }) => ({
			body: policy.exists(researchPermits, ({ row: permit }) =>
				query.and(
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
			policy.exists(researchPermits, ({ row: permit }) =>
				query.and(
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
			policy.exists(researchPermits, ({ row: permit }) =>
				query.and(
					permit.programmeCode.equal("programme-linguistics"),
					permit.archiveCode.equal(candidate.archiveCode),
					permit.principalId.equal(principal.id),
					permit.status.equal("active"),
				),
			),
	},
	fields: {
		create: () => ({
			archiveCode: query.always(),
			catalogueNumber: query.always(),
			sequence: query.always(),
			kind: query.always(),
			note: query.always(),
		}),
	},
});
