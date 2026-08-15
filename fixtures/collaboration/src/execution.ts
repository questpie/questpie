import { codec, defineContext, defineService } from "questpie";

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
	resolve: ({ input, principal }) => ({
		tenant: { id: input.companyId },
		values: { principalId: principal.id },
	}),
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
