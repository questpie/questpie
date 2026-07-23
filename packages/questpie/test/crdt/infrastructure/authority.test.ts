import { describe, expect, it } from "bun:test";

import {
	createFieldAccessContext,
	executeAccessRule,
} from "../../../src/server/collection/crud/shared/access-control.js";
import { normalizeContext } from "../../../src/server/collection/crud/shared/context.js";
import {
	runWithContext,
	tryGetContext,
} from "../../../src/server/config/context.js";
import type { Principal } from "../../../src/server/config/context.js";
import {
	authoritySubject,
	createAgentCrdtAuthentication,
	createFreshCrdtContextResolver,
	createHumanCrdtAuthentication,
} from "../../../src/server/modules/core/integrated/crdt/authority.js";

const userPrincipal = {
	kind: "user",
	user: { id: "user-1" },
	session: { id: "session-1" },
} as Principal;

describe("CRDT authority infrastructure", () => {
	it("keeps the legacy principal discriminant and derives a human actor", () => {
		const authentication = createHumanCrdtAuthentication(userPrincipal);
		expect(authentication).toEqual({
			principal: userPrincipal,
			actor: { kind: "human", subjectId: "user-1" },
		});
		expect(authoritySubject(authentication)).toEqual({
			kind: "human",
			subjectId: "user-1",
		});
		expect(userPrincipal.kind).toBe("user");
	});

	it("keeps Agent credentials separate from its stable authority subject", () => {
		const authentication = createAgentCrdtAuthentication({
			credentialId: "credential-1",
			subjectId: "build-agent",
			issuer: "https://agents.example.com",
			scopes: ["crdt:read", "crdt:edit"],
			expiresAt: new Date("2030-01-01T00:00:00.000Z"),
		});

		expect(authentication.principal).toBeUndefined();
		expect(authentication.actor).toMatchObject({
			kind: "agent",
			subjectId: "build-agent",
			issuer: "https://agents.example.com",
			credentialId: "credential-1",
		});
		expect(authoritySubject(authentication)).toEqual({
			kind: "agent",
			issuer: "https://agents.example.com",
			subjectId: "build-agent",
		});
	});

	it("rebuilds authentication and app context for every decision", async () => {
		let authenticationCount = 0;
		let contextCount = 0;
		const resolve = createFreshCrdtContextResolver({
			authenticate: async () => {
				authenticationCount += 1;
				return createHumanCrdtAuthentication(userPrincipal);
			},
			createContext: async (authentication) => ({
				id: ++contextCount,
				actor: authentication.actor,
			}),
		});

		const first = await resolve();
		const second = await resolve();

		expect(authenticationCount).toBe(2);
		expect(first.context).not.toBe(second.context);
		expect(first.context.id).toBe(1);
		expect(second.context.id).toBe(2);
	});

	it("propagates the actor through ALS, owner access, and field access", async () => {
		const authentication = createHumanCrdtAuthentication(userPrincipal);
		await runWithContext(
			{
				app: {},
				principal: authentication.principal,
				actor: authentication.actor,
			},
			async () => {
				expect(tryGetContext()?.actor).toEqual(authentication.actor);
				expect(normalizeContext({}).actor).toEqual(authentication.actor);
			},
		);

		const ownerActor = await executeAccessRule(
			({ actor }) => actor?.kind === "human",
			{
				db: {},
				principal: authentication.principal,
				actor: authentication.actor,
			},
		);
		expect(ownerActor).toBe(true);
		expect(
			createFieldAccessContext({
				context: {
					principal: authentication.principal,
					actor: authentication.actor,
				},
				operation: "update",
			}),
		).toMatchObject({
			principal: authentication.principal,
			actor: authentication.actor,
		});
	});

	it("rechecks Agent credential expiry on every fresh decision", async () => {
		let now = new Date("2029-01-01T00:00:00.000Z");
		const authentication = createAgentCrdtAuthentication(
			{
				credentialId: "credential-1",
				subjectId: "build-agent",
				issuer: "https://agents.example.com",
				scopes: ["crdt:read"],
				expiresAt: new Date("2030-01-01T00:00:00.000Z"),
			},
			now,
		);
		const resolve = createFreshCrdtContextResolver({
			authenticate: async () => authentication,
			createContext: async () => ({}),
			now: () => now,
		});
		await expect(resolve()).resolves.toBeDefined();
		now = new Date("2031-01-01T00:00:00.000Z");
		await expect(resolve()).rejects.toThrow("fresh");
	});

	it("rejects a fresh context that would bypass access rules", async () => {
		const resolve = createFreshCrdtContextResolver({
			authenticate: async () => createHumanCrdtAuthentication(userPrincipal),
			createContext: async () => ({ accessMode: "system" as const }),
		});
		await expect(resolve()).rejects.toThrow("system");
	});

	it("rejects system principals and expired or malformed Agent envelopes", () => {
		expect(() => createHumanCrdtAuthentication({ kind: "system" })).toThrow(
			"human",
		);
		expect(() =>
			createAgentCrdtAuthentication(
				{
					credentialId: "credential-1",
					subjectId: "build-agent",
					issuer: "https://agents.example.com/path",
					scopes: ["crdt:read"],
					expiresAt: new Date("2020-01-01T00:00:00.000Z"),
				},
				new Date("2025-01-01T00:00:00.000Z"),
			),
		).toThrow();
	});
});
