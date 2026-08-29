import { definePolicy, expr, policy } from "questpie";

import { channels } from "./channels";
import { companies } from "./companies";
import { memberships } from "./memberships";
import { messageEvents } from "./message-events";
import { messages } from "./messages";
import { spaces } from "./spaces";

const readableMessageRows = policy.rows(
	messages,
	({ row: message, principal, tenant }) =>
		expr.exists(channels, ({ row: channel }) =>
			expr.and(
				channel.id.equal(message.channelId),
				expr.exists(spaces, ({ row: space }) =>
					expr.and(
						space.id.equal(channel.spaceId),
						expr.exists(companies, ({ row: company }) =>
							expr.and(
								company.id.equal(space.companyId),
								company.id.equal(tenant.id),
								expr.exists(memberships, ({ row: membership }) =>
									expr.and(
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
			expr.exists(memberships, ({ row: membership }) =>
				expr.and(
					membership.id.equal(candidate.authorMembershipId),
					membership.companyId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.scopeKey.equal("company"),
					membership.status.equal("active"),
				),
			),
	},
	fields: {
		create: ({ candidate, principal, tenant }) => ({
			authorMembershipId: expr.exists(memberships, ({ row: membership }) =>
				expr.and(
					membership.id.equal(candidate.authorMembershipId),
					membership.companyId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.scopeKey.equal("company"),
					membership.status.equal("active"),
				),
			),
			channelId: expr.exists(memberships, ({ row: membership }) =>
				expr.and(
					membership.companyId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.scopeKey.equal("company"),
					membership.status.equal("active"),
					candidate.channelId.notEqual("00000000-0000-0000-0000-000000000000"),
				),
			),
			body: expr.exists(memberships, ({ row: membership }) =>
				expr.and(
					membership.companyId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.scopeKey.equal("company"),
					membership.status.equal("active"),
				),
			),
		}),
		output: ({ row, principal, tenant }) => ({
			body: expr.exists(memberships, ({ row: membership }) =>
				expr.and(
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
			expr.exists(spaces, ({ row: space }) =>
				expr.and(
					space.id.equal(channel.spaceId),
					space.companyId.equal(tenant.id),
					expr.exists(memberships, ({ row: membership }) =>
						expr.and(
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
			expr.and(
				space.companyId.equal(tenant.id),
				expr.exists(memberships, ({ row: membership }) =>
					expr.and(
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
			expr.exists(messages, ({ row: message }) =>
				expr.and(
					message.id.equal(candidate.messageId),
					expr.exists(channels, ({ row: channel }) =>
						expr.and(
							channel.id.equal(message.channelId),
							expr.exists(spaces, ({ row: space }) =>
								expr.and(
									space.id.equal(channel.spaceId),
									space.companyId.equal(tenant.id),
									expr.exists(memberships, ({ row: membership }) =>
										expr.and(
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
			messageId: expr.exists(memberships, ({ row: membership }) =>
				expr.and(
					membership.companyId.equal(tenant.id),
					membership.principalId.equal(principal.id),
					membership.scopeKey.equal("company"),
					membership.status.equal("active"),
					candidate.messageId.notEqual("00000000-0000-0000-0000-000000000000"),
				),
			),
			kind: candidate.kind.in(["delivered", "published"]),
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
