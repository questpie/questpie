import { codec, context, defineContext, defineService } from "questpie";

import { memberships } from "./memberships";

const lifecycle: string[] = [];
let applicationCreates = 0;
let executionCreates = 0;

export const auditConnection = defineService({
	name: "audit.connection",
	lifetime: "application",
	effect: "read",
	create: () => {
		applicationCreates += 1;
		lifecycle.push(`create:application:${applicationCreates}`);
		return Object.freeze({ id: applicationCreates });
	},
	dispose: (instance) => {
		lifecycle.push(`dispose:application:${instance.id}`);
	},
});

export const executionAudit = defineService({
	name: "audit.execution",
	lifetime: "execution",
	effect: "read",
	dependencies: { connection: auditConnection },
	create: ({ services }) => {
		executionCreates += 1;
		lifecycle.push(`create:execution:${executionCreates}`);
		return Object.freeze({
			connectionId: services.connection.id,
			id: executionCreates,
		});
	},
	dispose: (instance) => {
		lifecycle.push(`dispose:execution:${instance.id}`);
	},
});

export const collaborationContext = defineContext({
	name: "app.context",
	input: codec.object({ companyId: codec.uuid() }),
	resolve: async ({ input, principal, bootstrap }) => {
		if (principal.kind === "anonymous") throw context.error.unauthenticated();
		const membership = await bootstrap.get(memberships, {
			key: {
				companyId: input.companyId,
				principalId: principal.id,
				scopeKey: "company",
			},
			select: {
				id: true,
				companyId: true,
				principalId: true,
				role: true,
				scopeKey: true,
				status: true,
			},
		});
		if (membership === null || membership.status !== "active")
			throw context.error.notFound("tenant");
		return {
			tenant: context.tenant({ id: membership.companyId }),
			values: {
				selectedMembershipId: membership.id,
				selectedMembershipPrincipalId: membership.principalId,
				selectedMembershipScope: membership.scopeKey,
				selectedRole: membership.role,
			},
		};
	},
});

export function resetExecutionFixture(): void {
	lifecycle.length = 0;
	applicationCreates = 0;
	executionCreates = 0;
}

export function executionFixtureState(): Readonly<{
	applicationCreates: number;
	executionCreates: number;
	lifecycle: readonly string[];
}> {
	return {
		applicationCreates,
		executionCreates,
		lifecycle: [...lifecycle],
	};
}
