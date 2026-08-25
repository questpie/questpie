import { codec, context, defineContext } from "questpie";

import { memberships } from "./memberships";

export const supportContext = defineContext({
	name: "app.context",
	input: codec.object({
		organizationId: codec.uuid(),
		membershipId: codec.uuid(),
	}),
	resolve: async ({ input, principal, bootstrap }) => {
		if (principal.kind === "anonymous") throw context.error.unauthenticated();
		const membership = await bootstrap.get(memberships, {
			key: { id: input.membershipId },
			select: {
				id: true,
				organizationId: true,
				principalId: true,
				role: true,
				status: true,
			},
		});
		if (
			membership === null ||
			membership.organizationId !== input.organizationId ||
			membership.principalId !== principal.id ||
			membership.status !== "active"
		)
			throw context.error.notFound("tenant");
		return {
			tenant: context.tenant({ id: membership.organizationId }),
			values: {
				membershipId: membership.id,
				role: membership.role,
			},
		};
	},
});
