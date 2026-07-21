import { describe, expect, it } from "bun:test";

import { createAnthropicCommercialAdapter } from "../exports/index.js";

describe("Anthropic commercial Provider Adapter", () => {
	it("publishes one credential-free pinned Phase 0 offering", () => {
		const adapter = createAnthropicCommercialAdapter();

		expect({
			definition: adapter.definition,
			catalog: adapter.catalog,
		}).toEqual({
			definition: {
				id: "anthropic",
				label: "Anthropic API",
				authMethods: ["api_key"],
				discovery: "live",
				runtime: "direct_messages",
				apiVersion: "2023-06-01",
			},
			catalog: {
				version: "anthropic-2026-07-19",
				models: [
					{
						id: "claude-sonnet-5",
						displayName: "Claude Sonnet 5",
						lifecycle: "active",
						selection: "pinned",
						maxOutputTokens: 128_000,
					},
				],
			},
		});
	});

	it("qualifies the pinned offering through live discovery and a bounded probe", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const adapter = createAnthropicCommercialAdapter({
			fetch: async (input, init) => {
				const url = input.toString();
				requests.push({ url, init });
				if (url.endsWith("/v1/models?limit=100")) {
					return Response.json(
						{
							data: [
								{
									id: "claude-sonnet-5",
									type: "model",
									display_name: "Claude Sonnet 5",
									created_at: "2026-05-20T00:00:00Z",
								},
							],
							has_more: false,
							first_id: "claude-sonnet-5",
							last_id: "claude-sonnet-5",
						},
						{ headers: { "request-id": "req_models" } },
					);
				}

				return Response.json(
					{
						id: "msg_probe",
						type: "message",
						role: "assistant",
						model: "claude-sonnet-5",
						content: [{ type: "text", text: "QUESTPIE_OK" }],
						stop_reason: "end_turn",
						usage: { input_tokens: 12, output_tokens: 4 },
					},
					{ headers: { "request-id": "req_probe" } },
				);
			},
		});

		const result = await adapter.verifyConnection({
			apiKey: "sk-ant-qualification-secret",
		});

		expect(result).toEqual({
			status: "verified",
			reason: null,
			selectedModelId: "claude-sonnet-5",
			offerings: [
				{
					id: "claude-sonnet-5",
					displayName: "Claude Sonnet 5",
					providerCreatedAt: "2026-05-20T00:00:00Z",
					eligible: true,
				},
			],
			evidence: {
				apiVersion: "2023-06-01",
				catalogVersion: "anthropic-2026-07-19",
				discoveryRequestId: "req_models",
				probeRequestId: "req_probe",
				probeMaxOutputTokens: 64,
				fallbackUsed: false,
			},
		});
		expect(
			requests.map(({ url, init }) => ({
				url,
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(init.body.toString()) : null,
			})),
		).toEqual([
			{
				url: "https://api.anthropic.com/v1/models?limit=100",
				method: "GET",
				body: null,
			},
			{
				url: "https://api.anthropic.com/v1/messages",
				method: "POST",
				body: {
					model: "claude-sonnet-5",
					max_tokens: 64,
					thinking: { type: "disabled" },
					messages: [
						{ role: "user", content: "Reply with exactly QUESTPIE_OK." },
					],
				},
			},
		]);
	});

	it("fails closed when live discovery returns an incomplete model entry", async () => {
		let requestCount = 0;
		const adapter = createAnthropicCommercialAdapter({
			fetch: async () => {
				requestCount += 1;
				return Response.json(
					{ data: [{ id: "claude-sonnet-5" }] },
					{ headers: { "request-id": "req_incomplete_models" } },
				);
			},
		});

		const result = await adapter.verifyConnection({ apiKey: "sk-ant-valid" });

		expect(result).toEqual({
			status: "unavailable",
			reason: "provider_unavailable",
			selectedModelId: null,
			offerings: [],
			evidence: {
				apiVersion: "2023-06-01",
				catalogVersion: "anthropic-2026-07-19",
				discoveryRequestId: "req_incomplete_models",
				probeRequestId: null,
				probeMaxOutputTokens: 64,
				fallbackUsed: false,
			},
		});
		expect(requestCount).toBe(1);
	});

	it("returns secret-safe invalid evidence for a rejected credential", async () => {
		const secret = "sk-ant-must-never-leak";
		const adapter = createAnthropicCommercialAdapter({
			fetch: async () =>
				Response.json(
					{
						type: "error",
						error: {
							type: "authentication_error",
							message: `Rejected credential ${secret}`,
						},
						request_id: "req_invalid",
					},
					{ status: 401, headers: { "request-id": "req_invalid" } },
				),
		});

		const result = await adapter.verifyConnection({ apiKey: secret });

		expect(result).toEqual({
			status: "invalid",
			reason: "authentication_failed",
			selectedModelId: null,
			offerings: [],
			evidence: {
				apiVersion: "2023-06-01",
				catalogVersion: "anthropic-2026-07-19",
				discoveryRequestId: "req_invalid",
				probeRequestId: null,
				probeMaxOutputTokens: 64,
				fallbackUsed: false,
			},
		});
		expect(JSON.stringify(result)).not.toContain(secret);
	});

	it("normalizes discovery rate limiting without probing or fallback", async () => {
		let requestCount = 0;
		const adapter = createAnthropicCommercialAdapter({
			fetch: async () => {
				requestCount += 1;
				return Response.json(
					{
						type: "error",
						error: { type: "rate_limit_error", message: "Try later" },
						request_id: "req_discovery_rate_limited",
					},
					{
						status: 429,
						headers: { "request-id": "req_discovery_rate_limited" },
					},
				);
			},
		});

		const result = await adapter.verifyConnection({ apiKey: "sk-ant-valid" });

		expect(result).toEqual({
			status: "unavailable",
			reason: "rate_limited",
			selectedModelId: null,
			offerings: [],
			evidence: {
				apiVersion: "2023-06-01",
				catalogVersion: "anthropic-2026-07-19",
				discoveryRequestId: "req_discovery_rate_limited",
				probeRequestId: null,
				probeMaxOutputTokens: 64,
				fallbackUsed: false,
			},
		});
		expect(requestCount).toBe(1);
	});

	it("normalizes discovery overload without probing or fallback", async () => {
		let requestCount = 0;
		const adapter = createAnthropicCommercialAdapter({
			fetch: async () => {
				requestCount += 1;
				return Response.json(
					{
						type: "error",
						error: { type: "overloaded_error", message: "Try later" },
						request_id: "req_discovery_overloaded",
					},
					{
						status: 529,
						headers: { "request-id": "req_discovery_overloaded" },
					},
				);
			},
		});

		const result = await adapter.verifyConnection({ apiKey: "sk-ant-valid" });

		expect(result).toEqual({
			status: "unavailable",
			reason: "provider_overloaded",
			selectedModelId: null,
			offerings: [],
			evidence: {
				apiVersion: "2023-06-01",
				catalogVersion: "anthropic-2026-07-19",
				discoveryRequestId: "req_discovery_overloaded",
				probeRequestId: null,
				probeMaxOutputTokens: 64,
				fallbackUsed: false,
			},
		});
		expect(requestCount).toBe(1);
	});

	it("bounds delayed verification and reports timeout without a fake offering", async () => {
		const adapter = createAnthropicCommercialAdapter({
			verificationTimeoutMs: 5,
			fetch: async (_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("aborted", "AbortError")),
						{ once: true },
					);
				}),
		});

		const result = await adapter.verifyConnection({ apiKey: "sk-ant-delayed" });

		expect(result).toEqual({
			status: "unavailable",
			reason: "verification_timed_out",
			selectedModelId: null,
			offerings: [],
			evidence: {
				apiVersion: "2023-06-01",
				catalogVersion: "anthropic-2026-07-19",
				discoveryRequestId: null,
				probeRequestId: null,
				probeMaxOutputTokens: 64,
				fallbackUsed: false,
			},
		});
	});

	it("keeps the connection unavailable when the pinned model is retired or undiscovered", async () => {
		let requestCount = 0;
		const adapter = createAnthropicCommercialAdapter({
			fetch: async () => {
				requestCount += 1;
				return Response.json(
					{
						data: [
							{
								id: "claude-opus-4-8",
								type: "model",
								display_name: "Claude Opus 4.8",
								created_at: "2026-05-01T00:00:00Z",
							},
						],
						has_more: false,
					},
					{ headers: { "request-id": "req_no_pinned_model" } },
				);
			},
		});

		const result = await adapter.verifyConnection({ apiKey: "sk-ant-valid" });

		expect(result).toEqual({
			status: "unavailable",
			reason: "pinned_model_not_available",
			selectedModelId: null,
			offerings: [
				{
					id: "claude-sonnet-5",
					displayName: "Claude Sonnet 5",
					providerCreatedAt: null,
					eligible: false,
				},
			],
			evidence: {
				apiVersion: "2023-06-01",
				catalogVersion: "anthropic-2026-07-19",
				discoveryRequestId: "req_no_pinned_model",
				probeRequestId: null,
				probeMaxOutputTokens: 64,
				fallbackUsed: false,
			},
		});
		expect(requestCount).toBe(1);
	});

	it("does not fall back when the pinned model probe is overloaded", async () => {
		let requestCount = 0;
		const adapter = createAnthropicCommercialAdapter({
			fetch: async () => {
				requestCount += 1;
				if (requestCount === 1) {
					return Response.json(
						{
							data: [
								{
									id: "claude-sonnet-5",
									type: "model",
									display_name: "Claude Sonnet 5",
									created_at: "2026-05-20T00:00:00Z",
								},
							],
							has_more: false,
						},
						{ headers: { "request-id": "req_models" } },
					);
				}

				return Response.json(
					{
						type: "error",
						error: { type: "overloaded_error", message: "Try later" },
						request_id: "req_overloaded",
					},
					{ status: 529, headers: { "request-id": "req_overloaded" } },
				);
			},
		});

		const result = await adapter.verifyConnection({ apiKey: "sk-ant-valid" });

		expect(result).toEqual({
			status: "unavailable",
			reason: "provider_overloaded",
			selectedModelId: null,
			offerings: [
				{
					id: "claude-sonnet-5",
					displayName: "Claude Sonnet 5",
					providerCreatedAt: "2026-05-20T00:00:00Z",
					eligible: false,
				},
			],
			evidence: {
				apiVersion: "2023-06-01",
				catalogVersion: "anthropic-2026-07-19",
				discoveryRequestId: "req_models",
				probeRequestId: "req_overloaded",
				probeMaxOutputTokens: 64,
				fallbackUsed: false,
			},
		});
		expect(requestCount).toBe(2);
	});

	it("does not qualify a 200 response that fails the bounded probe contract", async () => {
		let requestCount = 0;
		const adapter = createAnthropicCommercialAdapter({
			fetch: async () => {
				requestCount += 1;
				if (requestCount === 1) {
					return Response.json(
						{
							data: [
								{
									id: "claude-sonnet-5",
									display_name: "Claude Sonnet 5",
									created_at: "2026-05-20T00:00:00Z",
								},
							],
						},
						{ headers: { "request-id": "req_models" } },
					);
				}
				return Response.json(
					{
						model: "claude-sonnet-5",
						content: [{ type: "text", text: "unexpected" }],
					},
					{ headers: { "request-id": "req_bad_probe" } },
				);
			},
		});

		const result = await adapter.verifyConnection({ apiKey: "sk-ant-valid" });

		expect(result.status).toBe("unavailable");
		expect(result.reason).toBe("probe_contract_failed");
		expect(result.selectedModelId).toBeNull();
	});
});
