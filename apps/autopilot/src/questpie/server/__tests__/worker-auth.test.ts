import { ApiError } from "questpie/errors";
import { describe, expect, it } from "vitest";

import {
	authenticatedWorker,
	authorizeWorkerOrSession,
	isLocalDevWorkerRequest,
	workerSecretFromRequest,
} from "../lib/worker-auth";

function ctxWithHeaders(
	headers: Record<string, string>,
	workerId = "worker-1",
) {
	return {
		request: new Request("http://autopilot.test/api/worker-poll", {
			headers,
		}),
		services: {
			workerManager: {
				requireWorker: async (value: string | null) => {
					if (!value) throw ApiError.unauthorized("missing worker secret");
					return { id: workerId };
				},
			},
		},
	} as any;
}

function ctxWithSecret(secret: string | null, workerId = "worker-1") {
	return ctxWithHeaders(secret ? { "x-worker-secret": secret } : {}, workerId);
}

describe("authenticatedWorker", () => {
	it("extracts worker secrets from machine and bearer auth headers", () => {
		expect(
			workerSecretFromRequest(
				new Request("http://autopilot.test", {
					headers: { "x-worker-secret": "machine-secret" },
				}),
			),
		).toBe("machine-secret");
		expect(
			workerSecretFromRequest(
				new Request("http://autopilot.test", {
					headers: { authorization: "Bearer bearer-secret" },
				}),
			),
		).toBe("bearer-secret");
	});

	it("resolves the authenticated worker from X-Worker-Secret", async () => {
		await expect(authenticatedWorker(ctxWithSecret("secret"))).resolves.toEqual(
			{
				id: "worker-1",
			},
		);
	});

	it("resolves the authenticated worker from Authorization bearer", async () => {
		await expect(
			authenticatedWorker(
				ctxWithHeaders({ authorization: "Bearer bearer-secret" }),
			),
		).resolves.toEqual({
			id: "worker-1",
		});
	});

	it("authorizes read calls from a user session or worker bearer", async () => {
		await expect(
			authorizeWorkerOrSession({
				request: new Request("http://autopilot.test"),
				session: { user: { id: "user-1" } },
			} as any),
		).resolves.toEqual({ kind: "session" });
		await expect(
			authorizeWorkerOrSession(
				ctxWithHeaders({ authorization: "Bearer bearer-secret" }),
			),
		).resolves.toMatchObject({ kind: "worker", worker: { id: "worker-1" } });
	});

	it("accepts local dev worker calls only from loopback", async () => {
		expect(
			isLocalDevWorkerRequest(
				new Request("http://localhost/api/worker-poll", {
					headers: { "x-local-dev": "true" },
				}),
			),
		).toBe(true);
		expect(
			isLocalDevWorkerRequest(
				new Request("http://autopilot.test/api/worker-poll", {
					headers: { "x-local-dev": "true" },
				}),
			),
		).toBe(false);
	});

	it("rejects body worker id mismatches", async () => {
		await expect(
			authenticatedWorker(ctxWithSecret("secret", "worker-1"), "worker-2"),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});
