import { describe, expect, it } from "bun:test";

import { createAuthenticatedAgentWorkloadTransport } from "../exports/index.js";
import { resolverFor } from "./agent-workload-fixture.js";

describe("Agent workload principal internal transport", () => {
	it("rejects ordinary JSON serialization", async () => {
		const principal = await resolverFor().resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});

		expect(() => JSON.stringify(principal)).toThrow(
			expect.objectContaining({
				code: "internal_transport_required",
			}),
		);
	});

	it("round-trips only through a signed internal envelope", async () => {
		const resolver = resolverFor();
		const principal = await resolver.resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});
		const transport = createAuthenticatedAgentWorkloadTransport({
			keyId: "worker-control-plane-v1",
			secret: new TextEncoder().encode(
				"hreben-test-workload-transport-key-32-bytes-minimum",
			),
		});

		const sealed = transport.seal(principal);
		const opened = transport.open(sealed);

		expect(sealed.startsWith("qpaw1.")).toBe(true);
		expect(opened.kind).toBe("authenticated_agent_workload_envelope");
		expect(opened.version).toBe(1);
		expect(Object.keys(opened)).toEqual(["kind", "version"]);
		const authorized = await resolver.validate(opened);
		expect(authorized).toEqual(principal);
		expect(authorized).not.toBe(opened);
	});

	it("rejects tampered envelopes and untrusted principal objects", async () => {
		const principal = await resolverFor().resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});
		const transport = createAuthenticatedAgentWorkloadTransport({
			keyId: "worker-control-plane-v1",
			secret: new TextEncoder().encode(
				"hreben-test-workload-transport-key-32-bytes-minimum",
			),
		});
		const sealed = transport.seal(principal);
		const parts = sealed.split(".");
		parts[2] = `${parts[2]}A`;

		expect(() => transport.open(parts.join("."))).toThrow(
			expect.objectContaining({
				code: "invalid_principal",
			}),
		);
		expect(() => transport.seal({ ...principal })).toThrow(
			expect.objectContaining({
				code: "invalid_principal",
			}),
		);
	});

	it("keeps credentials, prompts, filesystem paths, and tool arguments out of the envelope", async () => {
		const transport = createAuthenticatedAgentWorkloadTransport({
			keyId: "worker-control-plane-v1",
			secret: new TextEncoder().encode(
				"hreben-test-workload-transport-key-32-bytes-minimum",
			),
		});
		const principal = await resolverFor().resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});
		const payload = Buffer.from(
			transport.seal(principal).split(".")[2],
			"base64url",
		).toString("utf8");

		expect(payload).not.toContain("credential");
		expect(payload).not.toContain("prompt");
		expect(payload).not.toContain("cwd");
		expect(payload).not.toContain("HOME");
		expect(payload).not.toContain("toolArguments");
	});
});
