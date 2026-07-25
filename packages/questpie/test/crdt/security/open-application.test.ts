import { describe, expect, it } from "bun:test";

import type { CrdtAuthorizationSnapshot } from "../../../src/server/modules/core/integrated/crdt/authorization.js";
import {
	createCrdtOpenApplicationV1,
	type CrdtOpenApplicationConfigV1,
} from "../../../src/server/modules/core/integrated/crdt/open-application.js";

const TARGET = {
	openId: "00000000-0000-4000-8000-000000000010",
	owner: { kind: "collection", key: "articles", id: "article-1" },
	mode: "edit",
	edgeSessionId: "edge-session-1",
} as const;

describe("CRDT Fetch-native open security", () => {
	it("requires an allowed Origin for cookie authentication", async () => {
		let opened = 0;
		const app = application({
			authenticateBrowser: async () => userPrincipal(),
			openSession: async () => {
				opened++;
				return openedSession();
			},
		});

		expect(
			await responseShape(
				app.handle(
					request(TARGET, {
						cookie: "session=one",
					}),
				),
			),
		).toEqual(unavailable());
		expect(
			await responseShape(
				app.handle(
					request(TARGET, {
						cookie: "session=one",
						origin: "https://evil.example",
					}),
				),
			),
		).toEqual(unavailable());

		const success = await app.handle(
			request(TARGET, {
				cookie: "session=one",
				origin: "https://app.example",
			}),
		);
		expect(success.status).toBe(201);
		expect(opened).toBe(1);
	});

	it("rejects confused cookie plus bearer credentials before Agent verification", async () => {
		let agentCalls = 0;
		let browserCalls = 0;
		const app = application({
			authenticateBrowser: async () => {
				browserCalls++;
				return userPrincipal();
			},
			authenticateAgent: async () => {
				agentCalls++;
				return agentCredential();
			},
		});

		expect(
			await responseShape(
				app.handle(
					request(TARGET, {
						cookie: "session=one",
						authorization: "Bearer agent-token",
						origin: "https://app.example",
					}),
				),
			),
		).toEqual(unavailable());
		expect(browserCalls).toBe(0);
		expect(agentCalls).toBe(0);
	});

	it("keeps User, OAuth-Human and verified-Agent actor kinds distinct", async () => {
		const actorKinds: number[] = [];
		const origins: Array<string | null> = [];
		const browserPrincipals = [
			userPrincipal(),
			oauthPrincipal(),
			null,
		] as const;
		let browserIndex = 0;
		let agentCalls = 0;
		const app = application({
			authenticateBrowser: async () => browserPrincipals[browserIndex++]!,
			authenticateAgent: async () => {
				agentCalls++;
				return agentCredential();
			},
			authorize: async (input) => {
				origins.push(input.origin);
				return authorization(input.origin);
			},
			openSession: async (input) => {
				actorKinds.push(input.actorKind);
				return openedSession();
			},
		});

		expect(
			(
				await app.handle(
					request(TARGET, {
						cookie: "session=one",
						origin: "https://app.example",
					}),
				)
			).status,
		).toBe(201);
		expect(
			(
				await app.handle(
					request(
						{
							...TARGET,
							openId: "00000000-0000-4000-8000-000000000011",
						},
						{ authorization: "Bearer oauth-token" },
					),
				)
			).status,
		).toBe(201);
		expect(
			(
				await app.handle(
					request(
						{
							...TARGET,
							openId: "00000000-0000-4000-8000-000000000012",
						},
						{ authorization: "Bearer agent-token" },
					),
				)
			).status,
		).toBe(201);

		expect(actorKinds).toEqual([1, 2, 3]);
		expect(origins).toEqual(["https://app.example", null, null]);
		expect(agentCalls).toBe(1);
	});

	it("keeps authenticateAgent authoritative and requires crdt:edit", async () => {
		let opened = 0;
		const app = application({
			authenticateBrowser: async () => null,
			authenticateAgent: async () => ({
				...agentCredential(),
				scopes: ["crdt:read"],
			}),
			openSession: async () => {
				opened++;
				return openedSession();
			},
		});

		expect(
			await responseShape(
				app.handle(request(TARGET, { authorization: "Bearer agent-token" })),
			),
		).toEqual(unavailable());
		expect(opened).toBe(0);
	});

	it("rejects an OAuth principal without a stable credential id", async () => {
		let authorized = 0;
		const app = application({
			authenticateBrowser: async () => ({
				...oauthPrincipal(),
				tokenId: "",
			}),
			authorize: async (input) => {
				authorized++;
				return authorization(input.origin);
			},
		});

		expect(
			await responseShape(
				app.handle(request(TARGET, { authorization: "Bearer oauth-token" })),
			),
		).toEqual(unavailable());
		expect(authorized).toBe(0);
	});

	it("returns only the non-secret binding contract and initial pull descriptor", async () => {
		const response = await application().handle(
			request(TARGET, { authorization: "Bearer oauth-token" }),
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(201);
		expect(body).toMatchObject({
			protocol: "questpie-crdt-http",
			version: 1,
			namespace: "questpie-test",
			deploymentFingerprint: "deployment-test",
			bindingId: "00000000-0000-4000-8000-000000000021",
			sessionGeneration: "0",
			deliveryGeneration: "1",
			initialPull: { operation: "pull", continuation: null },
		});
		expect(body).not.toHaveProperty("sessionId");
		expect(body).not.toHaveProperty("ticket");
	});

	it("forwards only a valid previous binding as an atomic replacement hint", async () => {
		const openedInputs: Array<{ replacesBindingId?: string }> = [];
		const app = application({
			openSession: async (input) => {
				openedInputs.push({ replacesBindingId: input.replacesBindingId });
				return openedSession();
			},
		});
		const replacesBindingId = "00000000-0000-4000-8000-000000000022";

		expect(
			(
				await app.handle(
					request(
						{ ...TARGET, replacesBindingId },
						{ authorization: "Bearer oauth-token" },
					),
				)
			).status,
		).toBe(201);
		expect(openedInputs).toEqual([{ replacesBindingId }]);
		expect(
			await responseShape(
				app.handle(
					request(
						{ ...TARGET, replacesBindingId: "not-a-binding" },
						{ authorization: "Bearer oauth-token" },
					),
				),
			),
		).toEqual(unavailable());
		expect(openedInputs).toHaveLength(1);
	});

	it("uses one disclosure-safe shape for denied owner and invalid edge proof", async () => {
		const denied = application({
			authorize: async () => {
				throw new Error("secret owner did not exist");
			},
		});
		const badEdge = application({
			authorizeEdge: async () => null,
		});
		const input = request(TARGET, {
			authorization: "Bearer oauth-token",
		});

		expect(await responseShape(denied.handle(input.clone()))).toEqual(
			unavailable(),
		);
		expect(await responseShape(badEdge.handle(input.clone()))).toEqual(
			unavailable(),
		);
	});

	it("rejects compressed, oversized and open-key JSON without invoking authority", async () => {
		let browserCalls = 0;
		const app = application({
			authenticateBrowser: async () => {
				browserCalls++;
				return oauthPrincipal();
			},
		});
		const compressed = request(TARGET, {
			authorization: "Bearer oauth-token",
			contentEncoding: "gzip",
		});
		const oversized = new Request("https://app.example/realtime/crdt/open", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer oauth-token",
				"x-questpie-realtime-token": "edge-token",
			},
			body: JSON.stringify({ ...TARGET, padding: "x".repeat(20_000) }),
		});

		expect(await responseShape(app.handle(compressed))).toEqual(unavailable());
		expect(await responseShape(app.handle(oversized))).toEqual(unavailable());
		expect(browserCalls).toBe(0);
	});

	it("aborts a stalled open body before authentication", async () => {
		let browserCalls = 0;
		const app = application({
			authenticateBrowser: async () => {
				browserCalls++;
				return oauthPrincipal();
			},
		});
		const controller = new AbortController();
		const operation = app.handle(
			new Request("https://app.example/realtime/crdt/open", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: "Bearer oauth-token",
					"x-questpie-realtime-token": "edge-token",
				},
				body: new ReadableStream<Uint8Array>({
					pull: () => new Promise(() => {}),
				}),
				signal: controller.signal,
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		controller.abort(new DOMException("client left", "AbortError"));

		expect(
			await Promise.race([
				responseShape(operation),
				new Promise<never>((_resolve, reject) =>
					setTimeout(() => reject(new Error("open did not abort")), 100),
				),
			]),
		).toEqual(unavailable());
		expect(browserCalls).toBe(0);
	});

	it("bounds stalled open bodies before authentication", async () => {
		let browserCalls = 0;
		const app = application({
			maximumConcurrentRequests: 1,
			authenticateBrowser: async () => {
				browserCalls++;
				return oauthPrincipal();
			},
		});
		const controller = new AbortController();
		const stalled = app.handle(
			new Request("https://app.example/realtime/crdt/open", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: new ReadableStream<Uint8Array>({
					pull: () => new Promise(() => {}),
				}),
				signal: controller.signal,
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(
			await responseShape(
				app.handle(request(TARGET, { authorization: "Bearer oauth-token" })),
			),
		).toEqual(unavailable());
		expect(browserCalls).toBe(0);
		controller.abort();
		expect((await stalled).status).toBe(404);
	});
});

function application(overrides: Partial<CrdtOpenApplicationConfigV1> = {}) {
	return createCrdtOpenApplicationV1({
		namespace: "questpie-test",
		deploymentFingerprint: "deployment-test",
		appUrl: "https://app.example",
		allowedOrigins: [],
		audience: "https://app.example/realtime/crdt/open",
		authenticateBrowser: async () => oauthPrincipal(),
		authenticateAgent: async () => agentCredential(),
		authorize: async (input) => authorization(input.origin),
		authorizeEdge: async () => ({
			sessionKey: new Uint8Array(32).fill(0x81),
			ownerGeneration: 11n,
		}),
		openSession: async () => openedSession(),
		...overrides,
	});
}

function request(
	body: unknown,
	headers: {
		cookie?: string;
		origin?: string;
		authorization?: string;
		contentEncoding?: string;
	} = {},
): Request {
	return new Request("https://app.example/realtime/crdt/open", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-questpie-realtime-token": "edge-token",
			...(headers.cookie ? { cookie: headers.cookie } : {}),
			...(headers.origin ? { origin: headers.origin } : {}),
			...(headers.authorization
				? { authorization: headers.authorization }
				: {}),
			...(headers.contentEncoding
				? { "content-encoding": headers.contentEncoding }
				: {}),
		},
		body: JSON.stringify(body),
	});
}

async function responseShape(responseInput: Response | Promise<Response>) {
	const response = await responseInput;
	return {
		status: response.status,
		body: await response.json(),
		cache: response.headers.get("cache-control"),
	};
}

function unavailable() {
	return {
		status: 404,
		body: {
			error: { code: "CRDT_UNAVAILABLE", message: "CRDT unavailable" },
		},
		cache: "no-store",
	};
}

function userPrincipal() {
	return {
		kind: "user" as const,
		user: { id: "user-1" },
		session: { id: "session-1" },
	} as any;
}

function oauthPrincipal() {
	return {
		kind: "oauth" as const,
		user: { id: "user-1" },
		tokenId: "oauth-token-1",
		scopes: ["collections:articles:read", "collections:articles:write"],
	} as any;
}

function agentCredential() {
	return {
		credentialId: "agent-credential-1",
		subjectId: "agent-1",
		issuer: "https://issuer.example",
		scopes: ["crdt:read", "crdt:edit"] as const,
		expiresAt: new Date(Date.now() + 60_000),
	};
}

function authorization(origin: string | null): CrdtAuthorizationSnapshot {
	return {
		resourceId: "00000000-0000-4000-8000-000000000001",
		resourceEpochId: "00000000-0000-4000-8000-000000000002",
		definitionId: "00000000-0000-4000-8000-000000000003",
		schemaId: "00000000-0000-4000-8000-000000000004",
		incarnationKey: "00000000-0000-4000-8000-000000000005",
		subjectId: "00000000-0000-4000-8000-000000000006",
		credentialFingerprint: new Uint8Array(32).fill(0x71),
		audience: "https://app.example/realtime/crdt/open",
		origin,
		requestedMode: "edit",
		effectiveMode: "edit",
		resourceReadFence: 0n,
		resourceEditFence: 0n,
		ownerPolicyRevision: 0n,
		subjectReadFence: 0n,
		subjectEditFence: 0n,
		sessionGeneration: 0n,
		authorityExpiresAt: new Date(Date.now() + 60_000),
		headCommitSeq: 0n,
		offlineSubjectKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		clientManifest: {
			schemaVersion: 1,
			schemaFingerprint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA",
			awarenessEnabled: true,
			fields: {},
		},
		bindings: [],
		grants: [],
	};
}

function openedSession() {
	return {
		sessionId: "00000000-0000-4000-8000-000000000020",
		bindingId: "00000000-0000-4000-8000-000000000021",
		deliveryGeneration: 1n,
		edgeOwnerGeneration: 11n,
		leaseExpiresAt: new Date("2026-07-25T12:00:00.000Z"),
		incarnationKey: "00000000-0000-4000-8000-000000000005",
		effectiveMode: "edit" as const,
		offlineSubjectKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		manifest: {
			schemaVersion: 1,
			schemaFingerprint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA",
			awarenessEnabled: true,
			fields: {},
		},
		sessionGeneration: 0n,
	};
}
