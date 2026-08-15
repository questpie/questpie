import { expect, test } from "bun:test";

import { context, principal, type ContextBootstrap } from "questpie";

import { collaborationContext } from "../../fixtures/collaboration/src/execution";
import { createApplicationRuntime } from "../../packages/runtime/src";

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const foreignCompanyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61ff";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";

type Membership = Readonly<{
	companyId: string;
	principalId: string;
	role: string;
	scopeKey: string;
	status: string;
}>;

function membershipBootstrap(membership: Membership | null): Readonly<{
	bootstrap: ContextBootstrap;
	reads: Array<Readonly<Record<string, unknown>>>;
}> {
	const reads: Array<Readonly<Record<string, unknown>>> = [];
	return {
		reads,
		bootstrap: {
			get: async (collection, input) => {
				reads.push({
					collection: collection.name,
					key: input.key,
					select: input.select,
				});
				if (
					membership === null ||
					membership.companyId !== input.key.companyId ||
					membership.principalId !== input.key.principalId ||
					membership.scopeKey !== input.key.scopeKey
				)
					return null;
				return membership as never;
			},
		},
	};
}

test("Context authorizes only a current active company Membership", async () => {
	const tenant = context.tenant({ id: companyId });
	expect(tenant).toEqual({ id: companyId });
	expect(Object.isFrozen(tenant)).toBe(true);
	expect(context.error.notFound("tenant")).toMatchObject({
		code: "notFound",
		message: "notFound",
		resource: "tenant",
	});

	const membership: Membership = {
		companyId,
		principalId,
		role: "member",
		scopeKey: "company",
		status: "active",
	};
	const active = membershipBootstrap(membership);
	let projectCalls = 0;
	const runtime = createApplicationRuntime({
		services: [],
		context: collaborationContext,
		bootstrap: active.bootstrap,
		project: ({ facts }) => {
			projectCalls += 1;
			return facts;
		},
	});
	const facts = await runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
		},
		(value) => value,
	);
	expect(facts.tenant).toEqual({ id: companyId });
	expect(facts.values).toEqual({
		selectedMembershipPrincipalId: principalId,
		selectedMembershipScope: "company",
		selectedRole: "member",
	});
	expect(active.reads).toEqual([
		{
			collection: "memberships",
			key: { companyId, principalId, scopeKey: "company" },
			select: {
				companyId: true,
				principalId: true,
				role: true,
				scopeKey: true,
				status: true,
			},
		},
	]);
	expect(projectCalls).toBe(1);
	await runtime.close();

	for (const hostile of [
		{
			bootstrap: membershipBootstrap(membership),
			contextCompanyId: foreignCompanyId,
			principal: principal.user({ id: principalId }),
			error: "notFound",
		},
		{
			bootstrap: membershipBootstrap({ ...membership, status: "revoked" }),
			contextCompanyId: companyId,
			principal: principal.user({ id: principalId }),
			error: "notFound",
		},
		{
			bootstrap: membershipBootstrap(membership),
			contextCompanyId: companyId,
			principal: principal.anonymous(),
			error: "unauthenticated",
		},
	] as const) {
		let hostileProjectCalls = 0;
		let callbackCalls = 0;
		const hostileRuntime = createApplicationRuntime({
			services: [],
			context: collaborationContext,
			bootstrap: hostile.bootstrap.bootstrap,
			project: ({ facts: hostileFacts }) => {
				hostileProjectCalls += 1;
				return hostileFacts;
			},
		});
		await expect(
			hostileRuntime.execution(
				{
					principal: hostile.principal,
					context: { companyId: hostile.contextCompanyId },
				},
				() => {
					callbackCalls += 1;
				},
			),
		).rejects.toThrow(hostile.error);
		expect({ callbackCalls, hostileProjectCalls }).toEqual({
			callbackCalls: 0,
			hostileProjectCalls: 0,
		});
		await hostileRuntime.close();
	}
});
