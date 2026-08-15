import { definePolicy, policy, query } from "questpie";

import { channels } from "./channels";
import { companies } from "./companies";
import { memberships } from "./memberships";
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
	fields: {
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

export const membershipPolicy = definePolicy(memberships, {
	name: "memberships.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ authority }) => authority.isSystem(),
	},
});
