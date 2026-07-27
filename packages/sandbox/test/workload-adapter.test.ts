import { describe, expect, it } from "bun:test";

import {
	httpSandboxAdapter,
	type SandboxWorkloadAuthorizer,
	type SandboxWorkloadPolicy,
} from "../src/exports/index.js";
import { WORKLOAD_ADMISSION_HEADER } from "../src/types.js";

const admission = {
	keyId: "sandbox-workload-v1",
	secret: new TextEncoder().encode(
		"questpie-sandbox-workload-admission-secret-32-bytes",
	),
	instanceId: "sandbox_instance_a",
};

const policy: SandboxWorkloadPolicy = {
	source: "export default async (input) => input.answer",
	input: { answer: 42 },
	capabilities: {
		net: [],
		import: [],
		timeoutMs: 1_000,
		memoryMb: 64,
	},
	secrets: {},
};

function response(output: unknown = 42): Response {
	return new Response(JSON.stringify({ ok: true, output, logs: [] }), {
		headers: { "content-type": "application/json" },
	});
}

describe("generic workload sandbox admission", () => {
	it("uses only a freshly authorized policy and never caller-authored execution controls", async () => {
		const phases: string[] = [];
		const requests: Array<{ body: unknown; header: string | null }> = [];
		const authorize: SandboxWorkloadAuthorizer = async (_envelope, context) => {
			phases.push(context.phase);
			return policy;
		};
		const adapter = httpSandboxAdapter({
			url: "https://sandbox.example",
			workload: { authorize, admission },
			fetch: (async (_input, init) => {
				const headers = new Headers(init?.headers);
				requests.push({
					body: JSON.parse(String(init?.body)),
					header: headers.get(WORKLOAD_ADMISSION_HEADER),
				});
				return response();
			}) as typeof fetch,
		});

		const result = await adapter.runWorkload({
			envelope: {
				consumer: "fixture",
				source: "export default async () => 'forged'",
				capabilities: { net: ["attacker.example:443"] },
				secrets: { token: "stolen" },
			},
		});

		expect(result).toEqual(
			expect.objectContaining({ ok: true, output: 42, logs: [] }),
		);
		expect(phases).toEqual(["prepare", "dispatch"]);
		expect(requests).toHaveLength(1);
		expect(requests[0]!.body).toEqual({
			mode: "workload",
			...policy,
		});
		expect(requests[0]!.header).toMatch(/^qpsw1\./);
		expect(JSON.stringify(requests[0]!.body)).not.toContain("attacker.example");
		expect(JSON.stringify(requests[0]!.body)).not.toContain("stolen");
	});

	it("binds a stable custom-tool envelope host-side without serializing it", async () => {
		const envelope = { opaque: "tool-consumer-secret" };
		let sentBody: Record<string, unknown> | undefined;
		const adapter = httpSandboxAdapter({
			url: "https://sandbox.example",
			validateEgress: false,
			fetch: (async (_input, init) => {
				sentBody = JSON.parse(String(init?.body));
				return response();
			}) as typeof fetch,
			workload: {
				admission,
				authorize: async () => ({
					...policy,
					bindings: {
						url: "https://app.example/api/sandbox/rpc",
						token: "workload-tools-token",
					},
					sandboxTools: { envelope },
				}),
			},
		});

		await adapter.runWorkload({ envelope: { consumer: "fixture" } });

		expect(sentBody).not.toHaveProperty("sandboxTools");
		expect(JSON.stringify(sentBody)).not.toContain("tool-consumer-secret");
	});

	it("fails closed without an authorizer or for malformed/changing policy", async () => {
		let fetches = 0;
		const fetch = (async () => {
			fetches += 1;
			return response();
		}) as typeof globalThis.fetch;

		const missing = httpSandboxAdapter({
			url: "https://sandbox.example",
			fetch,
		});
		await expect(
			missing.runWorkload({ envelope: { consumer: "fixture" } }),
		).rejects.toEqual(
			expect.objectContaining({ code: "sandbox_authority_denied" }),
		);

		const malformed = httpSandboxAdapter({
			url: "https://sandbox.example",
			fetch,
			workload: {
				admission,
				authorize: async () => ({ ...policy, source: "" }),
			},
		});
		await expect(
			malformed.runWorkload({ envelope: { consumer: "fixture" } }),
		).rejects.toEqual(
			expect.objectContaining({ code: "sandbox_authority_denied" }),
		);

		let calls = 0;
		const changing = httpSandboxAdapter({
			url: "https://sandbox.example",
			fetch,
			workload: {
				admission,
				authorize: async () => ({
					...policy,
					input: { answer: ++calls },
				}),
			},
		});
		await expect(
			changing.runWorkload({ envelope: { consumer: "fixture" } }),
		).rejects.toEqual(
			expect.objectContaining({ code: "sandbox_authority_denied" }),
		);
		expect(fetches).toBe(0);
	});

	it("rejects a policy whose combined egress host set exceeds the bound", async () => {
		let fetches = 0;
		const adapter = httpSandboxAdapter({
			url: "https://sandbox.example",
			validateEgress: false,
			fetch: (async () => {
				fetches += 1;
				return response();
			}) as typeof globalThis.fetch,
			workload: {
				admission,
				authorize: async () => ({
					...policy,
					capabilities: {
						...policy.capabilities,
						net: Array.from(
							{ length: 33 },
							(_, index) => `host-${index}.example:443`,
						),
					},
				}),
			},
		});

		await expect(
			adapter.runWorkload({ envelope: { consumer: "fixture" } }),
		).rejects.toEqual(
			expect.objectContaining({ code: "sandbox_authority_denied" }),
		);
		expect(fetches).toBe(0);
	});

	it("bounds policy input depth and total secret bytes before transport", async () => {
		let deepInput: Record<string, unknown> = {};
		for (let depth = 0; depth < 40; depth += 1) {
			deepInput = { nested: deepInput };
		}
		for (const candidate of [
			{ ...policy, input: deepInput },
			{
				...policy,
				secrets: Object.fromEntries(
					Array.from({ length: 5 }, (_, index) => [
						`secret_${index}`,
						"x".repeat(65_000),
					]),
				),
			},
		]) {
			let fetches = 0;
			const adapter = httpSandboxAdapter({
				url: "https://sandbox.example",
				validateEgress: false,
				fetch: (async () => {
					fetches += 1;
					return response();
				}) as typeof globalThis.fetch,
				workload: {
					admission,
					authorize: async () => candidate,
				},
			});

			await expect(
				adapter.runWorkload({ envelope: { consumer: "fixture" } }),
			).rejects.toEqual(
				expect.objectContaining({ code: "sandbox_authority_denied" }),
			);
			expect(fetches).toBe(0);
		}
	});

	it("preserves JSON keys without prototype mutation", async () => {
		let sentBody: Record<string, unknown> | undefined;
		const input = JSON.parse(
			'{"__proto__":{"safe":true},"constructor":"guest-value"}',
		);
		const adapter = httpSandboxAdapter({
			url: "https://sandbox.example",
			validateEgress: false,
			fetch: (async (_input, init) => {
				sentBody = JSON.parse(String(init?.body));
				return response();
			}) as typeof globalThis.fetch,
			workload: {
				admission,
				authorize: async () => ({ ...policy, input }),
			},
		});

		await adapter.runWorkload({ envelope: { consumer: "fixture" } });

		expect(sentBody?.input).toEqual(input);
		expect(
			Object.prototype.hasOwnProperty.call(sentBody?.input, "__proto__"),
		).toBe(true);
	});

	it("rejects accessors and hostile proxies without invoking policy getters", async () => {
		let fetches = 0;
		let getterReads = 0;
		const fetch = (async () => {
			fetches += 1;
			return response();
		}) as typeof globalThis.fetch;
		const accessorPolicy = {
			get source() {
				getterReads += 1;
				return policy.source;
			},
			capabilities: policy.capabilities,
		};
		const accessor = httpSandboxAdapter({
			url: "https://sandbox.example",
			fetch,
			workload: {
				admission,
				authorize: async () => accessorPolicy as never,
			},
		});
		await expect(
			accessor.runWorkload({ envelope: { consumer: "fixture" } }),
		).rejects.toEqual(
			expect.objectContaining({ code: "sandbox_authority_denied" }),
		);
		expect(getterReads).toBe(0);

		const revoked = Proxy.revocable({}, {});
		revoked.revoke();
		const hostile = httpSandboxAdapter({
			url: "https://sandbox.example",
			fetch,
			workload: {
				admission,
				authorize: async () => revoked.proxy as never,
			},
		});
		await expect(
			hostile.runWorkload({ envelope: { consumer: "fixture" } }),
		).rejects.toEqual(
			expect.objectContaining({ code: "sandbox_authority_denied" }),
		);
		expect(fetches).toBe(0);
	});

	it("bounds authorization and honors caller cancellation before dispatch", async () => {
		let fetches = 0;
		const audit: unknown[] = [];
		const fetch = (async () => {
			fetches += 1;
			return response();
		}) as typeof globalThis.fetch;
		const slow = httpSandboxAdapter({
			url: "https://sandbox.example",
			fetch,
			workload: {
				admission,
				authorizationTimeoutMs: 25,
				authorize: async () => new Promise(() => {}),
				audit: (event) => {
					audit.push(event);
				},
			},
		});
		await expect(
			slow.runWorkload({ envelope: { consumer: "fixture" } }),
		).rejects.toEqual(
			expect.objectContaining({ code: "sandbox_authority_denied" }),
		);
		expect(audit).toContainEqual(
			expect.objectContaining({ reason: "authorization_timed_out" }),
		);

		const failed = httpSandboxAdapter({
			url: "https://sandbox.example",
			fetch,
			workload: {
				admission,
				authorize: async () => {
					throw new Error("consumer detail must not escape");
				},
				audit: (event) => {
					audit.push(event);
				},
			},
		});
		await expect(
			failed.runWorkload({ envelope: { consumer: "fixture" } }),
		).rejects.toEqual(
			expect.objectContaining({
				code: "sandbox_authority_denied",
				message: "The workload is not authorized for this sandbox operation.",
			}),
		);
		expect(audit).toContainEqual(
			expect.objectContaining({ reason: "authorization_failed" }),
		);
		expect(JSON.stringify(audit)).not.toContain("consumer detail");

		const controller = new AbortController();
		controller.abort();
		const cancelled = httpSandboxAdapter({
			url: "https://sandbox.example",
			fetch,
			workload: { admission, authorize: async () => policy },
		});
		const result = await cancelled.runWorkload({
			envelope: { consumer: "fixture" },
			signal: controller.signal,
		});
		expect(result).toEqual({
			ok: false,
			error: "sandbox request cancelled",
			logs: [],
		});
		expect(fetches).toBe(0);
	});

	it("audits authorization separately from terminal transport and sanitizes failures", async () => {
		const events: unknown[] = [];
		const successful = httpSandboxAdapter({
			url: "https://sandbox.example",
			validateEgress: false,
			fetch: (async () => response()) as typeof globalThis.fetch,
			workload: {
				admission,
				authorize: async () => policy,
				audit: (event) => {
					events.push(event);
				},
			},
		});

		await successful.runWorkload({ envelope: { consumer: "fixture" } });

		expect(events).toContainEqual({
			boundary: "sandbox.workload",
			phase: "dispatch",
			decision: "allowed",
			reason: "authorization_succeeded",
		});
		expect(events).toContainEqual({
			boundary: "sandbox.workload",
			phase: "transport",
			decision: "allowed",
			reason: "transport_completed",
		});

		const failed = httpSandboxAdapter({
			url: "https://sandbox.example",
			validateEgress: false,
			fetch: (async () => {
				throw new Error("internal host and credential detail");
			}) as typeof globalThis.fetch,
			workload: {
				admission,
				authorize: async () => policy,
				audit: (event) => {
					events.push(event);
				},
			},
		});
		const result = await failed.runWorkload({
			envelope: { consumer: "fixture" },
		});

		expect(result).toEqual({
			ok: false,
			error: "sandbox transport failed",
			logs: [],
		});
		expect(events).toContainEqual({
			boundary: "sandbox.workload",
			phase: "transport",
			decision: "denied",
			reason: "transport_failed",
		});
		expect(JSON.stringify(events)).not.toContain("credential detail");
	});

	it("fails closed when the required authorization audit misses its deadline", async () => {
		let fetches = 0;
		let auditWasCancelled = false;
		const adapter = httpSandboxAdapter({
			url: "https://sandbox.example",
			validateEgress: false,
			fetch: (async () => {
				fetches += 1;
				return response();
			}) as typeof globalThis.fetch,
			workload: {
				admission,
				authorize: async () => policy,
				auditTimeoutMs: 20,
				audit: async (event, { signal }) => {
					if (event.phase !== "dispatch" || event.decision !== "allowed") {
						return;
					}
					await new Promise<void>((resolve) => {
						signal.addEventListener(
							"abort",
							() => {
								auditWasCancelled = true;
								resolve();
							},
							{ once: true },
						);
					});
				},
			},
		});

		await expect(
			adapter.runWorkload({ envelope: { consumer: "fixture" } }),
		).rejects.toEqual(
			expect.objectContaining({ code: "sandbox_authority_denied" }),
		);
		expect(auditWasCancelled).toBe(true);
		expect(fetches).toBe(0);
	});

	it("audits a supervisor admission rejection as denied transport", async () => {
		const events: unknown[] = [];
		const adapter = httpSandboxAdapter({
			url: "https://sandbox.example",
			validateEgress: false,
			fetch: (async () =>
				Response.json(
					{
						ok: true,
						output: "must not pass through a non-2xx response",
						logs: [],
					},
					{ status: 403 },
				)) as typeof globalThis.fetch,
			workload: {
				admission,
				authorize: async () => policy,
				audit: (event) => {
					events.push(event);
				},
			},
		});

		const result = await adapter.runWorkload({
			envelope: { consumer: "fixture" },
		});

		expect(result).toEqual({
			ok: false,
			error: "sandbox transport failed",
			logs: [],
		});
		expect(events).toContainEqual({
			boundary: "sandbox.workload",
			phase: "transport",
			decision: "denied",
			reason: "transport_denied",
		});
	});

	it("audits an exact-schema runtime parse failure as invalid transport", async () => {
		const events: unknown[] = [];
		const adapter = httpSandboxAdapter({
			url: "https://sandbox.example",
			validateEgress: false,
			fetch: (async () =>
				Response.json({
					ok: true,
					logs: [],
					unexpected: "field",
				})) as typeof fetch,
			workload: {
				admission,
				authorize: async () => policy,
				audit: (event) => events.push(event),
			},
		});

		const result = await adapter.runWorkload({
			envelope: { consumer: "fixture" },
		});
		expect(result).toEqual({
			ok: false,
			error: "sandbox transport returned invalid response",
			logs: [],
		});
		expect(events).toContainEqual({
			boundary: "sandbox.workload",
			phase: "transport",
			decision: "denied",
			reason: "transport_invalid_response",
		});
	});
});
