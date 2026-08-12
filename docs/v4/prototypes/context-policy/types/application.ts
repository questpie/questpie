import { context, defineContext, definePolicy, policy, query } from "questpie";

import {
	archiveRecords,
	archives,
	channels,
	companies,
	memberships,
	messages,
	researchPermits,
	spaces,
} from "./collections";

export const appContext = defineContext({
	name: "app.context",
	input: {
		companyId: context.uuid(),
	},
	resolve: async ({ input, principal, bootstrap }) => {
		if (principal.kind === "anonymous") {
			throw context.error.unauthenticated();
		}

		const membership = await bootstrap.get(memberships, {
			key: {
				companyId: input.companyId,
				principalId: principal.id,
				scopeKey: "company",
			},
			select: {
				companyId: true,
				principalId: true,
				scopeKey: true,
				status: true,
				role: true,
			},
		});

		if (membership === null || membership.status !== "active") {
			throw context.error.notFound("tenant");
		}

		return {
			tenant: context.tenant({ id: membership.companyId }),
			values: {
				selectedMembershipPrincipalId: membership.principalId,
				selectedMembershipScope: membership.scopeKey,
				selectedRole: membership.role,
			},
		};
	},
});

const readableMessageRows = policy.rows(
	messages,
	({ row: message, principal, tenant }) =>
		policy.exists(channels, ({ row: channel }) =>
			query.and(
				channel.id.equal(message.channelId),
				policy.exists(spaces, ({ row: space }) =>
					query.and(
						space.id.equal(channel.spaceId),
						policy.exists(companies, ({ row: company }) =>
							query.and(
								company.id.equal(space.companyId),
								company.id.equal(tenant.id),
								policy.exists(memberships, ({ row: membership }) =>
									query.and(
										membership.companyId.equal(company.id),
										membership.principalId.equal(principal.id),
										membership.scopeKey.equal("company"),
										membership.status.equal("active"),
									),
								),
							),
						),
					),
				),
				query.or(
					channel.visibility.equal("company"),
					policy.exists(memberships, ({ row: membership }) =>
						query.and(
							membership.companyId.equal(message.companyId),
							membership.principalId.equal(principal.id),
							membership.scopeKey.equal(channel.id),
							membership.status.equal("active"),
						),
					),
				),
			),
		),
);

export const messagePolicy = definePolicy(messages, {
	name: "messages.default",
	read: {
		admit: policy.authenticated(),
		rows: readableMessageRows,
	},
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, principal, tenant }) =>
			policy.exists(channels, ({ row: channel }) =>
				query.and(
					channel.id.equal(candidate.channelId),
					policy.exists(spaces, ({ row: space }) =>
						query.and(
							space.id.equal(channel.spaceId),
							space.companyId.equal(candidate.companyId),
							space.companyId.equal(tenant.id),
							policy.exists(memberships, ({ row: membership }) =>
								query.and(
									membership.companyId.equal(space.companyId),
									membership.principalId.equal(principal.id),
									membership.scopeKey.equal("company"),
									membership.status.equal("active"),
								),
							),
						),
					),
				),
			),
	},
	update: {
		admit: policy.authenticated(),
		rows: ({ current, principal, tenant }) =>
			query.and(
				current.companyId.equal(tenant.id),
				query.or(
					current.authorId.equal(principal.id),
					policy.exists(memberships, ({ row: membership }) =>
						query.and(
							membership.companyId.equal(current.companyId),
							membership.principalId.equal(principal.id),
							membership.scopeKey.equal("company"),
							membership.status.equal("active"),
							membership.role.in(["owner", "admin", "moderator"]),
						),
					),
				),
			),
		candidate: ({ current, candidate }) =>
			query.and(
				candidate.companyId.equal(current.companyId),
				candidate.channelId.equal(current.channelId),
				candidate.authorId.equal(current.authorId),
			),
	},
	delete: {
		admit: policy.authenticated(),
		rows: ({ current, principal, tenant }) =>
			query.and(
				current.companyId.equal(tenant.id),
				query.or(
					current.authorId.equal(principal.id),
					policy.exists(memberships, ({ row: membership }) =>
						query.and(
							membership.companyId.equal(current.companyId),
							membership.principalId.equal(principal.id),
							membership.scopeKey.equal("company"),
							membership.status.equal("active"),
							membership.role.in(["owner", "admin"]),
						),
					),
				),
			),
	},
	fields: {
		output: ({ row, principal }) => ({
			moderationNote: row.authorId.equal(principal.id),
		}),
		create: ({ authority }) => ({
			moderationNote: authority.isSystem(),
		}),
		update: ({ current, principal, authority }) => ({
			body: current.authorId.equal(principal.id),
			moderationNote: authority.isSystem(),
		}),
	},
});

export const membershipPolicy = definePolicy(memberships, {
	name: "memberships.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ authority }) => authority.isSystem(),
	},
});

// A materially different domain in the same application: natural composite
// keys and permit evidence, with no `id` or Tenant-equality shortcut.
export const archiveRecordPolicy = definePolicy(archiveRecords, {
	name: "archiveRecords.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row: record, principal }) =>
			query.or(
				record.visibility.equal("public"),
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
	fields: {
		output: ({ row: record, principal }) => ({
			sealedNote: policy.exists(researchPermits, ({ row: permit }) =>
				query.and(
					permit.programmeCode.equal("programme-linguistics"),
					permit.archiveCode.equal(record.archiveCode),
					permit.principalId.equal(principal.id),
					permit.status.equal("active"),
					permit.mayViewSealed.equal(true),
				),
			),
		}),
	},
});

void archives;

// Exact negative contracts.
definePolicy(messages, {
	name: "messages.negativeFields",
	read: {
		admit: policy.authenticated(),
		rows: ({ row }) => {
			// @ts-expect-error Message rows have no Space Field.
			void row.spaceId;
			// @ts-expect-error UUID/text and timestamp operands are incompatible.
			return row.channelId.equal(row.createdAt);
		},
	},
	fields: {
		// @ts-expect-error Exact Message Field maps reject unknown members.
		output: ({ row }) => ({
			secretThatDoesNotExist: row.id.equal("message-1"),
		}),
	},
});

definePolicy(channels, {
	name: "channels.wrongPredicate",
	// @ts-expect-error A Message predicate cannot attach to Channels.
	read: { admit: policy.authenticated(), rows: readableMessageRows },
});

policy.exists(channels, ({ row }) => {
	// @ts-expect-error Channel rows do not expose Membership Fields.
	void row.principalId;
	return row.id.equal("channel-1");
});

const booleanEvidence = policy.exists(memberships, ({ row }) =>
	row.status.equal("active"),
);
// @ts-expect-error Evidence expressions cannot disclose a matching row.
void booleanEvidence.row;

// @ts-expect-error A broad string is not a Collection target.
policy.exists("memberships", ({ row }) => row);
