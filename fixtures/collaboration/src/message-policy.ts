import { definePolicy, policy, query } from "questpie";

import { channels } from "./channels";
import { companies } from "./companies";
import { memberships } from "./memberships";
import { messageEvents } from "./message-events";
import { messages } from "./messages";
import { spaces } from "./spaces";

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
			query.and(
				policy.exists(channels, ({ row: channel }) =>
					query.and(
						channel.id.equal(candidate.channelId),
						policy.exists(spaces, ({ row: space }) =>
							query.and(
								space.id.equal(channel.spaceId),
								space.companyId.equal(tenant.id),
							),
						),
					),
				),
				policy.exists(memberships, ({ row: membership }) =>
					query.and(
						membership.id.equal(candidate.authorMembershipId),
						membership.companyId.equal(tenant.id),
						membership.principalId.equal(principal.id),
						membership.scopeKey.equal("company"),
						membership.status.equal("active"),
					),
				),
			),
	},
	fields: {
		create: ({ candidate, principal, tenant }) => ({
			authorMembershipId: policy.exists(memberships, ({ row: membership }) =>
				query.and(
					membership.id.equal(candidate.authorMembershipId),
					membership.companyId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.scopeKey.equal("company"),
					membership.status.equal("active"),
				),
			),
			channelId: policy.exists(memberships, ({ row: membership }) =>
				query.and(
					membership.companyId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.scopeKey.equal("company"),
					membership.status.equal("active"),
					candidate.channelId.notEqual("00000000-0000-0000-0000-000000000000"),
				),
			),
			body: policy.exists(memberships, ({ row: membership }) =>
				query.and(
					membership.companyId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.scopeKey.equal("company"),
					membership.status.equal("active"),
				),
			),
		}),
		output: ({ row, principal, tenant }) => ({
			body: policy.exists(memberships, ({ row: membership }) =>
				query.and(
					membership.companyId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.scopeKey.equal("company"),
					membership.status.equal("active"),
					membership.role.in(["owner", "admin"]),
					row.channelId.notEqual("00000000-0000-0000-0000-000000000000"),
				),
			),
		}),
	},
});

export const channelPolicy = definePolicy(channels, {
	name: "channels.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row: channel, principal, tenant }) =>
			policy.exists(spaces, ({ row: space }) =>
				query.and(
					space.id.equal(channel.spaceId),
					space.companyId.equal(tenant.id),
					policy.exists(memberships, ({ row: membership }) =>
						query.and(
							membership.companyId.equal(tenant.id),
							membership.principalId.equal(principal.id),
							membership.scopeKey.equal("company"),
							membership.status.equal("active"),
						),
					),
				),
			),
	},
});

export const spacePolicy = definePolicy(spaces, {
	name: "spaces.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row: space, principal, tenant }) =>
			query.and(
				space.companyId.equal(tenant.id),
				policy.exists(memberships, ({ row: membership }) =>
					query.and(
						membership.companyId.equal(tenant.id),
						membership.principalId.equal(principal.id),
						membership.scopeKey.equal("company"),
						membership.status.equal("active"),
					),
				),
			),
	},
});

export const messageEventPolicy = definePolicy(messageEvents, {
	name: "messageEvents.default",
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, principal, tenant }) =>
			policy.exists(messages, ({ row: message }) =>
				query.and(
					message.id.equal(candidate.messageId),
					policy.exists(channels, ({ row: channel }) =>
						query.and(
							channel.id.equal(message.channelId),
							policy.exists(spaces, ({ row: space }) =>
								query.and(
									space.id.equal(channel.spaceId),
									space.companyId.equal(tenant.id),
									policy.exists(memberships, ({ row: membership }) =>
										query.and(
											membership.companyId.equal(tenant.id),
											membership.principalId.equal(principal.id),
											membership.scopeKey.equal("company"),
											membership.status.equal("active"),
										),
									),
								),
							),
						),
					),
				),
			),
	},
	fields: {
		create: ({ candidate, principal, tenant }) => ({
			messageId: policy.exists(memberships, ({ row: membership }) =>
				query.and(
					membership.companyId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.scopeKey.equal("company"),
					membership.status.equal("active"),
					candidate.messageId.notEqual("00000000-0000-0000-0000-000000000000"),
				),
			),
			kind: candidate.kind.equal("published"),
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
