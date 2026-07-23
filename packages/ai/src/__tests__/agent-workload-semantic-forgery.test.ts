import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";

import { createAuthenticatedAgentWorkloadTransport } from "../exports/index.js";
import { resolverFor } from "./agent-workload-fixture.js";

const KEY_ID = "worker-control-plane-v1";
const SECRET = new TextEncoder().encode(
	"hreben-test-workload-transport-key-32-bytes-minimum",
);

interface MutablePrincipalPayload {
	issuedAt: string;
	expiresAt: string;
	disclosure: { anchorSpaceId: string };
	execution: { workerLeaseExpiresAt: string };
	run: { workRequestId: string };
}

function forgeSignedEnvelope(
	envelope: string,
	mutate: (payload: MutablePrincipalPayload) => void,
): string {
	const [version, encodedKeyId, encodedPayload] = envelope.split(".");
	const payload = JSON.parse(
		Buffer.from(encodedPayload, "base64url").toString("utf8"),
	) as MutablePrincipalPayload;
	mutate(payload);
	const forgedPayload = Buffer.from(JSON.stringify(payload)).toString(
		"base64url",
	);
	const signed = `${version}.${encodedKeyId}.${forgedPayload}`;
	const signature = createHmac("sha256", SECRET)
		.update(signed)
		.digest("base64url");
	return `${signed}.${signature}`;
}

async function sealedPrincipal() {
	const resolver = resolverFor();
	const transport = createAuthenticatedAgentWorkloadTransport({
		keyId: KEY_ID,
		secret: SECRET,
	});
	const principal = await resolver.resolve({
		runId: "run_marketing_launch",
		attemptId: "attempt_01",
	});
	return { resolver, transport, sealed: transport.seal(principal) };
}

describe("Agent workload signed semantic forgery resistance", () => {
	it("does not expose principal claims before current persisted authorization", async () => {
		const { resolver, transport, sealed } = await sealedPrincipal();

		const authenticatedEnvelope = transport.open(sealed);

		expect(authenticatedEnvelope.kind).toBe(
			"authenticated_agent_workload_envelope",
		);
		expect(authenticatedEnvelope.version).toBe(1);
		expect(Object.keys(authenticatedEnvelope)).toEqual(["kind", "version"]);
		expect(authenticatedEnvelope).not.toHaveProperty("scope");
		const authorized = await resolver.validate(authenticatedEnvelope);
		expect(authorized.scope.anchorSpaceId).toBe("space_marketing");
	});

	it("rejects a signed disclosure boundary that differs from persisted scope", async () => {
		const { resolver, transport, sealed } = await sealedPrincipal();
		const forged = forgeSignedEnvelope(sealed, (payload) => {
			payload.disclosure.anchorSpaceId = "space_finance";
		});

		await expect(resolver.validate(transport.open(forged))).rejects.toEqual(
			expect.objectContaining({ code: "invalid_principal" }),
		);
	});

	it("rejects signed future issuance, overlong lifetime, and incoherent dates", async () => {
		const { resolver, transport, sealed } = await sealedPrincipal();
		const cases = [
			forgeSignedEnvelope(sealed, (payload) => {
				payload.issuedAt = "2099-01-01T00:00:00.000Z";
				payload.expiresAt = "2099-01-01T00:05:00.000Z";
			}),
			forgeSignedEnvelope(sealed, (payload) => {
				payload.expiresAt = "2026-07-19T09:09:00.000Z";
			}),
			forgeSignedEnvelope(sealed, (payload) => {
				payload.expiresAt = payload.issuedAt;
			}),
		];

		for (const forged of cases) {
			await expect(resolver.validate(transport.open(forged))).rejects.toEqual(
				expect.objectContaining({ code: "invalid_principal" }),
			);
		}
	});

	it("rejects signed widening of persisted Run or Worker lease bindings", async () => {
		const { resolver, transport, sealed } = await sealedPrincipal();
		const cases = [
			forgeSignedEnvelope(sealed, (payload) => {
				payload.run.workRequestId = "request_finance_export";
			}),
			forgeSignedEnvelope(sealed, (payload) => {
				payload.execution.workerLeaseExpiresAt = "2026-07-19T09:30:00.000Z";
			}),
		];

		for (const forged of cases) {
			await expect(resolver.validate(transport.open(forged))).rejects.toEqual(
				expect.objectContaining({ code: "authority_epoch_stale" }),
			);
		}
	});
});
