import { expect, test } from "bun:test";

import { principal } from "questpie";

import { createMcpCredentialPreflight } from "../../packages/runtime/src/application/mcp-authenticate";
import {
	RuntimeCredentialMalformed,
	RuntimeCredentialUnavailable,
} from "../../packages/runtime/src/execution";

const request = () => new Request("https://support.example/_questpie/mcp");
const signal = () => new AbortController().signal;

test("F1: an anonymous Principal is UNAUTHENTICATED once the gate is armed, not silently let through", async () => {
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => principal.anonymous(),
	});
	const outcome = await preflight(request(), signal());
	expect(outcome).toEqual({
		kind: "unauthenticated",
		wwwAuthenticate: undefined,
	});
});

test("F1: a resolved, non-anonymous Principal is authenticated and returned for reuse", async () => {
	const user = principal.user({ id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4" });
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => user,
	});
	const outcome = await preflight(request(), signal());
	expect(outcome).toEqual({ kind: "authenticated", principal: user });
});

test("F1: a service Principal is also authenticated (only anonymous counts as no credential)", async () => {
	const worker = principal.service({ name: "agent-1" });
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => worker,
	});
	const outcome = await preflight(request(), signal());
	expect(outcome).toEqual({ kind: "authenticated", principal: worker });
});

test("a malformed credential is unauthenticated with the app challenge attached", async () => {
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => {
			throw new RuntimeCredentialMalformed();
		},
		credentialChallenge: () => "Bearer",
	});
	const outcome = await preflight(request(), signal());
	expect(outcome).toEqual({
		kind: "unauthenticated",
		wwwAuthenticate: "Bearer",
	});
});

test("F3: a credential-provider outage never falls open — it is 'unavailable', not deferred to the public path", async () => {
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => {
			throw new RuntimeCredentialUnavailable();
		},
	});
	const outcome = await preflight(request(), signal());
	expect(outcome).toEqual({ kind: "unavailable" });
});

test("F3: an aborted resolution reports 'deadline', not authenticated or deferred", async () => {
	const controller = new AbortController();
	controller.abort();
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => {
			throw new Error("resolver ignored the abort");
		},
	});
	const outcome = await preflight(request(), controller.signal);
	expect(outcome).toEqual({ kind: "deadline" });
});

test("an unclassified resolver error defers to the existing execute-owned path, not a new status", async () => {
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => {
			throw new Error("unrelated bug");
		},
	});
	const outcome = await preflight(request(), signal());
	expect(outcome).toEqual({ kind: "deferred" });
});

test("F4: a throwing challenge function degrades to no header, never a thrown exception or leaked message", async () => {
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => principal.anonymous(),
		credentialChallenge: () => {
			throw new Error("credential secret leak attempt");
		},
	});
	const outcome = await preflight(request(), signal());
	expect(outcome).toEqual({
		kind: "unauthenticated",
		wwwAuthenticate: undefined,
	});
	expect(JSON.stringify(outcome)).not.toContain("credential secret");
});

test("F4: a CRLF-injecting challenge value is rejected, not forwarded as a header", async () => {
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => principal.anonymous(),
		credentialChallenge: () => "Bearer\r\nSet-Cookie: evil=1",
	});
	const outcome = await preflight(request(), signal());
	expect(outcome).toEqual({
		kind: "unauthenticated",
		wwwAuthenticate: undefined,
	});
});

test("F4: an empty-string challenge value is rejected as meaningless, not forwarded as a header", async () => {
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => principal.anonymous(),
		credentialChallenge: () => "",
	});
	const outcome = await preflight(request(), signal());
	expect(outcome).toEqual({
		kind: "unauthenticated",
		wwwAuthenticate: undefined,
	});
});

test("F2: a per-request challenge returning undefined still denies — arming never depends on the challenge return value", async () => {
	// Regression for the original bug: arming used to be keyed off whether
	// `challenge(request)` returned a defined string. An attacker-influenced
	// Request (Host/query the challenge function reads) could make it return
	// undefined and silently turn the whole gate off. It must not.
	const preflight = createMcpCredentialPreflight({
		resolvePrincipal: async () => principal.anonymous(),
		credentialChallenge: () => undefined,
	});
	const outcome = await preflight(request(), signal());
	expect(outcome.kind).toBe("unauthenticated");
});
