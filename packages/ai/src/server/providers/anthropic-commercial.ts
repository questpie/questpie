export const ANTHROPIC_API_VERSION = "2023-06-01" as const;
export const ANTHROPIC_PHASE_0_MODEL_ID = "claude-sonnet-5" as const;
const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const PROBE_MAX_OUTPUT_TOKENS = 64;

export interface AnthropicModelOffering {
	readonly id: typeof ANTHROPIC_PHASE_0_MODEL_ID;
	readonly displayName: string;
	readonly providerCreatedAt: string | null;
	readonly eligible: boolean;
}

export interface AnthropicVerificationEvidence {
	readonly apiVersion: typeof ANTHROPIC_API_VERSION;
	readonly catalogVersion: "anthropic-2026-07-19";
	readonly discoveryRequestId: string | null;
	readonly probeRequestId: string | null;
	readonly probeMaxOutputTokens: 64;
	readonly fallbackUsed: false;
}

export type AnthropicVerificationResult =
	| {
			readonly status: "verified";
			readonly reason: null;
			readonly selectedModelId: typeof ANTHROPIC_PHASE_0_MODEL_ID;
			readonly offerings: readonly AnthropicModelOffering[];
			readonly evidence: AnthropicVerificationEvidence;
	  }
	| {
			readonly status: "invalid" | "unavailable";
			readonly reason:
				| "authentication_failed"
				| "permission_denied"
				| "pinned_model_not_available"
				| "probe_contract_failed"
				| "provider_overloaded"
				| "rate_limited"
				| "provider_unavailable"
				| "verification_timed_out";
			readonly selectedModelId: null;
			readonly offerings: readonly AnthropicModelOffering[];
			readonly evidence: AnthropicVerificationEvidence;
	  };

export interface AnthropicCommercialAdapterOptions {
	readonly fetch?: AnthropicFetch;
	readonly verificationTimeoutMs?: number;
}

export type AnthropicFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

interface AnthropicDiscoveredModel {
	readonly id: string;
	readonly display_name: string;
	readonly created_at: string;
}

type AnthropicProviderFailureReason =
	| "authentication_failed"
	| "permission_denied"
	| "provider_overloaded"
	| "rate_limited"
	| "provider_unavailable";

function normalizeProviderHttpFailure(statusCode: number): {
	readonly status: "invalid" | "unavailable";
	readonly reason: AnthropicProviderFailureReason;
} {
	switch (statusCode) {
		case 401:
			return { status: "invalid", reason: "authentication_failed" };
		case 403:
			return { status: "unavailable", reason: "permission_denied" };
		case 429:
			return { status: "unavailable", reason: "rate_limited" };
		case 529:
			return { status: "unavailable", reason: "provider_overloaded" };
		default:
			return { status: "unavailable", reason: "provider_unavailable" };
	}
}

function parseModelDiscovery(
	value: unknown,
): readonly AnthropicDiscoveredModel[] | null {
	if (typeof value !== "object" || value === null || !("data" in value)) {
		return null;
	}

	const { data } = value as { data?: unknown };
	if (!Array.isArray(data)) return null;

	const models: AnthropicDiscoveredModel[] = [];
	for (const entry of data) {
		if (
			typeof entry !== "object" ||
			entry === null ||
			!("id" in entry) ||
			!("display_name" in entry) ||
			!("created_at" in entry)
		) {
			return null;
		}

		const { id, display_name, created_at } = entry as {
			id?: unknown;
			display_name?: unknown;
			created_at?: unknown;
		};
		if (
			typeof id !== "string" ||
			typeof display_name !== "string" ||
			typeof created_at !== "string"
		) {
			return null;
		}

		models.push({ id, display_name, created_at });
	}

	return models;
}

export interface AnthropicCommercialAdapter {
	readonly definition: {
		readonly id: "anthropic";
		readonly label: "Anthropic API";
		readonly authMethods: readonly ["api_key"];
		readonly discovery: "live";
		readonly runtime: "direct_messages";
		readonly apiVersion: typeof ANTHROPIC_API_VERSION;
	};
	readonly catalog: {
		readonly version: "anthropic-2026-07-19";
		readonly models: readonly [
			{
				readonly id: typeof ANTHROPIC_PHASE_0_MODEL_ID;
				readonly displayName: "Claude Sonnet 5";
				readonly lifecycle: "active";
				readonly selection: "pinned";
				readonly maxOutputTokens: 128_000;
			},
		];
	};
	verifyConnection(input: {
		readonly apiKey: string;
	}): Promise<AnthropicVerificationResult>;
}

export function createAnthropicCommercialAdapter(
	options: AnthropicCommercialAdapterOptions = {},
): AnthropicCommercialAdapter {
	const request = options.fetch ?? globalThis.fetch;
	const catalog = {
		version: "anthropic-2026-07-19",
		models: [
			{
				id: ANTHROPIC_PHASE_0_MODEL_ID,
				displayName: "Claude Sonnet 5",
				lifecycle: "active",
				selection: "pinned",
				maxOutputTokens: 128_000,
			},
		],
	} as const;
	const evidence = (
		discoveryRequestId: string | null,
		probeRequestId: string | null,
	): AnthropicVerificationEvidence => ({
		apiVersion: ANTHROPIC_API_VERSION,
		catalogVersion: catalog.version,
		discoveryRequestId,
		probeRequestId,
		probeMaxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
		fallbackUsed: false,
	});

	return {
		definition: {
			id: "anthropic",
			label: "Anthropic API",
			authMethods: ["api_key"],
			discovery: "live",
			runtime: "direct_messages",
			apiVersion: ANTHROPIC_API_VERSION,
		},
		catalog,
		async verifyConnection({ apiKey }) {
			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort("verification-timeout"),
				options.verificationTimeoutMs ?? 30_000,
			);

			try {
				const headers = {
					"anthropic-version": ANTHROPIC_API_VERSION,
					"x-api-key": apiKey,
				};
				const discoveryResponse = await request(
					`${ANTHROPIC_BASE_URL}/v1/models?limit=100`,
					{ method: "GET", headers, signal: controller.signal },
				);
				const discoveryRequestId = discoveryResponse.headers.get("request-id");
				if (!discoveryResponse.ok) {
					const failure = normalizeProviderHttpFailure(
						discoveryResponse.status,
					);
					return {
						...failure,
						selectedModelId: null,
						offerings: [],
						evidence: evidence(discoveryRequestId, null),
					};
				}
				const discoveredModels = parseModelDiscovery(
					await discoveryResponse.json(),
				);
				if (!discoveredModels) {
					return {
						status: "unavailable",
						reason: "provider_unavailable",
						selectedModelId: null,
						offerings: [],
						evidence: evidence(discoveryRequestId, null),
					};
				}
				const model = discoveredModels.find(
					({ id }) => id === ANTHROPIC_PHASE_0_MODEL_ID,
				);
				if (!model) {
					return {
						status: "unavailable",
						reason: "pinned_model_not_available",
						selectedModelId: null,
						offerings: [
							{
								id: ANTHROPIC_PHASE_0_MODEL_ID,
								displayName: catalog.models[0].displayName,
								providerCreatedAt: null,
								eligible: false,
							},
						],
						evidence: evidence(discoveryRequestId, null),
					};
				}
				const probeResponse = await request(
					`${ANTHROPIC_BASE_URL}/v1/messages`,
					{
						method: "POST",
						headers: { ...headers, "content-type": "application/json" },
						signal: controller.signal,
						body: JSON.stringify({
							model: ANTHROPIC_PHASE_0_MODEL_ID,
							max_tokens: PROBE_MAX_OUTPUT_TOKENS,
							thinking: { type: "disabled" },
							messages: [
								{
									role: "user",
									content: "Reply with exactly QUESTPIE_OK.",
								},
							],
						}),
					},
				);
				const probeRequestId = probeResponse.headers.get("request-id");
				if (!probeResponse.ok) {
					const failure = normalizeProviderHttpFailure(probeResponse.status);
					return {
						...failure,
						selectedModelId: null,
						offerings: [
							{
								id: ANTHROPIC_PHASE_0_MODEL_ID,
								displayName: model.display_name,
								providerCreatedAt: model.created_at,
								eligible: false,
							},
						],
						evidence: evidence(discoveryRequestId, probeRequestId),
					};
				}
				const probe = (await probeResponse.json()) as {
					model?: unknown;
					content?: unknown;
				};
				const probeText = Array.isArray(probe.content)
					? probe.content.find(
							(part): part is { type: "text"; text: string } =>
								typeof part === "object" &&
								part !== null &&
								(part as { type?: unknown }).type === "text" &&
								typeof (part as { text?: unknown }).text === "string",
						)?.text
					: undefined;
				if (
					probe.model !== ANTHROPIC_PHASE_0_MODEL_ID ||
					probeText?.trim() !== "QUESTPIE_OK"
				) {
					return {
						status: "unavailable",
						reason: "probe_contract_failed",
						selectedModelId: null,
						offerings: [
							{
								id: ANTHROPIC_PHASE_0_MODEL_ID,
								displayName: model.display_name,
								providerCreatedAt: model.created_at,
								eligible: false,
							},
						],
						evidence: evidence(discoveryRequestId, probeRequestId),
					};
				}

				return {
					status: "verified",
					reason: null,
					selectedModelId: ANTHROPIC_PHASE_0_MODEL_ID,
					offerings: [
						{
							id: ANTHROPIC_PHASE_0_MODEL_ID,
							displayName: model.display_name,
							providerCreatedAt: model.created_at,
							eligible: true,
						},
					],
					evidence: evidence(discoveryRequestId, probeRequestId),
				};
			} catch {
				return {
					status: "unavailable",
					reason: controller.signal.aborted
						? "verification_timed_out"
						: "provider_unavailable",
					selectedModelId: null,
					offerings: [],
					evidence: evidence(null, null),
				};
			} finally {
				clearTimeout(timeout);
			}
		},
	};
}
