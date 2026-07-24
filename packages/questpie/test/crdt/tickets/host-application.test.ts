import { describe, expect, it } from "bun:test";

import type { Principal } from "../../../src/server/config/context.js";
import {
	createCrdtHostApplicationV1,
	type CrdtHostAdmissionV1,
	type CrdtHostAuthorizationInputV1,
} from "../../../src/server/modules/core/integrated/crdt/host-application.js";
import type {
	CrdtAuthorizedTicketSnapshot,
	CrdtIssuedTicket,
	CrdtRedeemedTicket,
	CrdtTicketRedemptionClaim,
} from "../../../src/server/modules/core/integrated/crdt/ticket-store.js";
import { createCrdtTicketCredential } from "../../../src/server/modules/core/integrated/crdt/ticket.js";
import { encodeCrdtFrameV1 } from "../../../src/shared/crdt-protocol.js";

const TICKET_ID = "00000000-0000-4000-8000-000000000701";
const TICKET = createCrdtTicketCredential({
	ticketId: TICKET_ID,
	secretKey: "s".repeat(32),
	randomSecret: Buffer.alloc(32, 0x51),
}).token;

describe("CRDT host admission application", () => {
	it("issues browser tickets only for a fresh Human session and exact Origin", async () => {
		const authorizations: CrdtHostAuthorizationInputV1[] = [];
		const admission = fakeAdmission();
		const application = createApplication({
			admission,
			authorize: async (input) => {
				authorizations.push(input);
				return authorization();
			},
		});

		const response = await application.handleTicket(
			ticketRequest("/ticket", {
				origin: "https://ADMIN.example.com:443",
				body: {
					namespace: "acme-cms",
					owner: { kind: "collection", key: "articles", id: "article-1" },
					mode: "edit",
					fallback: "view",
				},
			}),
		);

		expect(response.status).toBe(201);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			ticket: TICKET,
			expiresAt: "2030-01-01T00:00:30.000Z",
			incarnationKey: "00000000-0000-4000-8000-000000000704",
			effectiveMode: "edit",
		});
		expect(authorizations).toHaveLength(1);
		expect(authorizations[0]).toMatchObject({
			purpose: "issue",
			origin: "https://admin.example.com",
			audience: "https://api.example.com/api/crdt/socket",
			target: {
				owner: { kind: "collection", key: "articles", id: "article-1" },
				mode: "edit",
				fallback: "view",
			},
			authentication: { actor: { kind: "human", subjectId: "user-1" } },
		});
		expect(admission.issued).toHaveLength(1);

		for (const request of [
			ticketRequest("/ticket", {
				body: {
					namespace: "wrong",
					owner: { kind: "global", key: "settings" },
					mode: "view",
				},
			}),
			ticketRequest("/ticket", {
				origin: "https://evil.example.com",
				body: {
					namespace: "acme-cms",
					owner: { kind: "global", key: "settings" },
					mode: "view",
				},
			}),
			ticketRequest("/ticket", {
				body: {
					namespace: "acme-cms",
					owner: { kind: "collection", key: "articles" },
					mode: "view",
				},
			}),
		]) {
			const rejected = await application.handleTicket(request);
			expect(rejected.status).toBe(404);
			expect(await rejected.text()).toBe("");
		}
	});

	it("keeps the Agent flow cookie-free, bearer-only, scoped, and origin-independent", async () => {
		const seen: CrdtHostAuthorizationInputV1[] = [];
		const application = createApplication({
			authorize: async (input) => {
				seen.push(input);
				return authorization({
					origin: null,
					requestedMode: "view",
					effectiveMode: "view",
				});
			},
		});
		const body = {
			namespace: "acme-cms",
			owner: { kind: "global", key: "settings" },
			mode: "view",
		};

		const response = await application.handleAgentTicket(
			ticketRequest("/agent-ticket", {
				origin: "https://untrusted.example.com",
				authorization: "Bearer verified-agent",
				body,
			}),
		);
		expect(response.status).toBe(201);
		expect(seen[0]).toMatchObject({
			purpose: "issue",
			origin: null,
			authentication: {
				principal: undefined,
				actor: {
					kind: "agent",
					issuer: "https://agents.example.com",
					subjectId: "agent-1",
					scopes: ["crdt:read"],
				},
			},
		});

		for (const request of [
			ticketRequest("/agent-ticket", {
				authorization: "Bearer verified-agent",
				cookie: "session=browser",
				body,
			}),
			ticketRequest("/agent-ticket", {
				authorization: "bearer verified-agent",
				body,
			}),
			ticketRequest("/agent-ticket", {
				authorization: "Bearer verified-agent trailing",
				body,
			}),
		]) {
			const rejected = await application.handleAgentTicket(request);
			expect(rejected.status).toBe(404);
			expect(await rejected.text()).toBe("");
		}
	});

	it("re-authenticates on AUTH redemption and releases the durable session on close", async () => {
		const admission = fakeAdmission();
		const events: string[] = [];
		const application = createApplication({
			admission,
			authorize: async (input) => {
				events.push(
					`${input.purpose}:${input.authentication.actor.kind}:${input.origin}`,
				);
				return authorization();
			},
			openAuthenticatedSession: async ({
				redemption,
				authorization,
				authRequestId,
			}) => {
				events.push(`open:${redemption.sessionId}`);
				expect(authorization.resourceId).toBe(
					"00000000-0000-4000-8000-000000000701",
				);
				expect(authRequestId).toBe(1n);
				return {
					message: async () => {
						events.push("message");
					},
					drain: async () => {
						events.push("drain");
					},
					close: async () => {
						events.push("close");
					},
				};
			},
		});
		const session = await application.openSocket({
			request: ticketRequest("/socket", {
				origin: "https://admin.example.com",
			}),
			clientIp: "127.0.0.1",
			peer: { send: () => true, close: () => {} },
		});

		expect(await session.message(authFrame(TICKET))).toEqual({
			authenticated: true,
		});
		await session.message(Uint8Array.of(1, 2, 3));
		await session.drain();
		await session.close(1000, "done");
		expect(events).toEqual([
			"redeem:human:https://admin.example.com",
			"open:00000000-0000-4000-8000-000000000706",
			"message",
			"drain",
			"close",
		]);
		expect(admission.released).toEqual([
			"00000000-0000-4000-8000-000000000706",
		]);
	});

	it("releases a redeemed session when downstream opening fails", async () => {
		const admission = fakeAdmission();
		const application = createApplication({
			admission,
			openAuthenticatedSession: async () => {
				throw new Error("sync kernel unavailable");
			},
		});
		const session = await application.openSocket({
			request: ticketRequest("/socket", {
				origin: "https://admin.example.com",
			}),
			clientIp: "127.0.0.1",
			peer: { send: () => true, close: () => {} },
		});

		await expect(session.message(authFrame(TICKET))).rejects.toThrow(
			"CRDT ticket rejected",
		);
		expect(admission.released).toEqual([
			"00000000-0000-4000-8000-000000000706",
		]);
	});
});

function createApplication(
	overrides: Partial<Parameters<typeof createCrdtHostApplicationV1>[0]> = {},
) {
	return createCrdtHostApplicationV1({
		namespace: "acme-cms",
		appUrl: "https://api.example.com",
		audience: "https://api.example.com/api/crdt/socket",
		allowedOrigins: ["https://admin.example.com"],
		admission: fakeAdmission(),
		authenticateBrowser: async () => humanPrincipal(),
		authenticateAgent: async ({ bearerToken }) =>
			bearerToken === "verified-agent"
				? {
						credentialId: "credential-1",
						subjectId: "agent-1",
						issuer: "https://agents.example.com",
						scopes: ["crdt:read"],
						expiresAt: new Date("2030-01-01T00:01:00.000Z"),
					}
				: null,
		authorize: async () => authorization(),
		openAuthenticatedSession: async () => ({
			message: async () => {},
			drain: async () => {},
			close: async () => {},
		}),
		...overrides,
	});
}

function fakeAdmission(): CrdtHostAdmissionV1 & {
	issued: CrdtAuthorizedTicketSnapshot[];
	released: string[];
} {
	const issued: CrdtAuthorizedTicketSnapshot[] = [];
	const released: string[] = [];
	return {
		issued,
		released,
		issue: async (snapshot) => {
			issued.push(snapshot);
			return issuedTicket();
		},
		inspect: async () => claim(),
		redeem: async () => redeemedTicket(),
		release: async (sessionId) => {
			released.push(sessionId);
		},
	};
}

function humanPrincipal(): Extract<Principal, { kind: "user" }> {
	return {
		kind: "user",
		user: { id: "user-1" } as never,
		session: { id: "session-1" } as never,
	};
}

function ticketRequest(
	path: string,
	input: {
		origin?: string;
		authorization?: string;
		cookie?: string;
		body?: unknown;
	} = {},
): Request {
	const headers = new Headers();
	if (input.origin) headers.set("origin", input.origin);
	if (input.authorization) headers.set("authorization", input.authorization);
	if (input.cookie) headers.set("cookie", input.cookie);
	if (input.body !== undefined) headers.set("content-type", "application/json");
	return new Request(`https://api.example.com/api/crdt${path}`, {
		method: "POST",
		headers,
		body: input.body === undefined ? undefined : JSON.stringify(input.body),
	});
}

function authFrame(ticket: string): Uint8Array {
	return encodeCrdtFrameV1({
		major: 1,
		minor: 0,
		opcode: 0x01,
		connectionSeq: 1n,
		requestId: 1n,
		payload: { ticket },
	});
}

function claim(): CrdtTicketRedemptionClaim {
	return {
		resourceId: "00000000-0000-4000-8000-000000000701",
		requestedMode: "edit",
		effectiveMode: "edit",
		origin: "https://admin.example.com",
		audience: "https://api.example.com/api/crdt/socket",
	};
}

function issuedTicket(): CrdtIssuedTicket {
	return {
		ticket: TICKET,
		expiresAt: new Date("2030-01-01T00:00:30.000Z"),
		incarnationKey: "00000000-0000-4000-8000-000000000704",
		effectiveMode: "edit",
	};
}

function redeemedTicket(): CrdtRedeemedTicket {
	return {
		sessionId: "00000000-0000-4000-8000-000000000706",
		leaseExpiresAt: new Date("2030-01-01T00:00:30.000Z"),
		incarnationKey: "00000000-0000-4000-8000-000000000704",
		effectiveMode: "edit",
	};
}

function authorization(
	overrides: Partial<CrdtAuthorizedTicketSnapshot> = {},
): CrdtAuthorizedTicketSnapshot {
	return {
		resourceId: "00000000-0000-4000-8000-000000000701",
		resourceEpochId: "00000000-0000-4000-8000-000000000702",
		definitionId: "00000000-0000-4000-8000-000000000703",
		schemaId: "00000000-0000-4000-8000-000000000705",
		incarnationKey: "00000000-0000-4000-8000-000000000704",
		subjectId: "00000000-0000-4000-8000-000000000708",
		credentialFingerprint: Buffer.alloc(32, 1),
		audience: "https://api.example.com/api/crdt/socket",
		origin: "https://admin.example.com",
		requestedMode: "edit",
		effectiveMode: "edit",
		resourceReadFence: 0n,
		resourceEditFence: 0n,
		ownerPolicyRevision: 0n,
		subjectReadFence: 0n,
		subjectEditFence: 0n,
		sessionGeneration: 0n,
		authorityExpiresAt: new Date("2030-01-01T00:01:00.000Z"),
		headCommitSeq: 0n,
		bindings: [],
		grants: [],
		...overrides,
	};
}
