import { describe, expect, it } from "bun:test";

import {
	SandboxWorkloadReplayCache,
	assertSandboxWorkloadAdmissionKey,
	sealSandboxWorkloadAdmission,
	verifySandboxWorkloadAdmission,
	type SandboxWorkloadAdmissionKey,
} from "../src/workload-admission.js";

const KEY: SandboxWorkloadAdmissionKey = {
	keyId: "sandbox-workload-v1",
	secret: new TextEncoder().encode(
		"questpie-sandbox-workload-admission-secret-32-bytes",
	),
	instanceId: "sandbox_instance_a",
};

const body = JSON.stringify({
	mode: "workload",
	source: "export default async () => 42",
	input: null,
	capabilities: { net: [], import: [], timeoutMs: 1_000, memoryMb: 64 },
});

function claims(expiresAt = new Date(Date.now() + 4_000).toISOString()) {
	return {
		kind: "sandbox_workload_admission" as const,
		version: 1 as const,
		admissionId: crypto.randomUUID(),
		supervisorInstanceId: KEY.instanceId,
		expiresAt,
	};
}

describe("sandbox workload transport admission", () => {
	it("binds a short-lived admission to one exact body and supervisor instance", async () => {
		const envelope = await sealSandboxWorkloadAdmission(KEY, claims(), body);

		expect(await verifySandboxWorkloadAdmission(KEY, envelope, body)).toEqual({
			ok: true,
			claims: expect.objectContaining({
				kind: "sandbox_workload_admission",
				supervisorInstanceId: "sandbox_instance_a",
			}),
		});
		expect(
			await verifySandboxWorkloadAdmission(
				KEY,
				envelope,
				body.replace("42", "43"),
			),
		).toEqual({
			ok: false,
			reason: "body_mismatch",
			claims: expect.any(Object),
		});
		expect(
			await verifySandboxWorkloadAdmission(
				{ ...KEY, instanceId: "sandbox_instance_b" },
				envelope,
				body,
			),
		).toEqual({
			ok: false,
			reason: "wrong_instance",
			claims: expect.any(Object),
		});
	});

	it("fails closed for malformed, expired, and overlong admissions", async () => {
		expect(await verifySandboxWorkloadAdmission(KEY, "forged", body)).toEqual({
			ok: false,
			reason: "invalid",
		});

		const expired = await sealSandboxWorkloadAdmission(
			KEY,
			claims(new Date(Date.now() - 1).toISOString()),
			body,
		);
		expect(await verifySandboxWorkloadAdmission(KEY, expired, body)).toEqual({
			ok: false,
			reason: "expired",
			claims: expect.any(Object),
		});

		const tooLong = await sealSandboxWorkloadAdmission(
			KEY,
			claims(new Date(Date.now() + 60_000).toISOString()),
			body,
		);
		expect(await verifySandboxWorkloadAdmission(KEY, tooLong, body)).toEqual({
			ok: false,
			reason: "expired",
			claims: expect.any(Object),
		});
	});

	it("keeps replay cleanup bounded while preserving single-use admissions", () => {
		const cache = new SandboxWorkloadReplayCache(3);
		const now = Date.now();
		const admission = (
			admissionId: string,
			expiresAt: number,
		): Parameters<SandboxWorkloadReplayCache["consume"]>[0] => ({
			kind: "sandbox_workload_admission",
			version: 1,
			admissionId,
			supervisorInstanceId: KEY.instanceId,
			expiresAt: new Date(expiresAt).toISOString(),
			requestSha256: "a".repeat(64),
		});

		expect(cache.consume(admission("a", now + 10), now)).toBe(true);
		expect(cache.consume(admission("b", now + 20), now)).toBe(true);
		expect(cache.consume(admission("c", now + 30), now)).toBe(true);
		expect(cache.consume(admission("a", now + 10), now)).toBe(false);
		expect(cache.consume(admission("full", now + 40), now)).toBe(false);
		expect(cache.consume(admission("after-expiry", now + 50), now + 11)).toBe(
			true,
		);
	});

	it("hard-fails an enabled admission configuration without a process instance", () => {
		expect(() =>
			assertSandboxWorkloadAdmissionKey({ ...KEY, instanceId: "" }),
		).toThrow("Invalid sandbox workload admission configuration.");
	});
});
