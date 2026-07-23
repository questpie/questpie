# Anthropic Phase 0 Qualification

Status: **Adapter contract qualified; each Provider Connection still requires a live credential probe**  
Research date: **2026-07-19**

## Ownership boundary

`@questpie/ai` owns the commercial Provider Adapter contract. Autopilot owns credential capture commands, Company connection state, Agent activation, and UI projections; it must not reproduce provider HTTP behavior.

The linked `@questpie/ai` 3.16.0 source had Claude Code and Codex Harness execution but no commercial Anthropic Provider Adapter. `createAnthropicCommercialAdapter` adds only the Phase 0 qualification seam. It does not add durable Runs, credentials, RBAC, scheduling, persistence, or fallback policy.

## Official API contract

The implementation is grounded in Anthropic's current primary documentation:

- [List Models](https://platform.claude.com/docs/en/api/models/list) defines `GET /v1/models`, cursor pagination, and connection-visible model discovery.
- [Create a Message](https://platform.claude.com/docs/en/api/messages/create) defines `POST /v1/messages` and the required bounded `max_tokens` request field.
- [API versioning](https://platform.claude.com/docs/en/api/versioning) requires `anthropic-version`; this Adapter pins `2023-06-01`.
- [Model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) states that 4.6-and-later canonical model IDs identify pinned snapshots rather than evergreen aliases.
- [Claude Sonnet 5](https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5) names `claude-sonnet-5`, documents its 128k maximum output, permits disabling adaptive thinking, and rejects non-default sampling parameters.
- [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) states that retired models fail and recommends migration before retirement.
- [API errors](https://platform.claude.com/docs/en/api/errors) defines authentication, permission, rate-limit, timeout, server, and overloaded responses plus the safe `request-id` evidence field.

## Pinned offering

The versioned Adapter catalog contains exactly one Phase 0 offering:

| Field                             | Value                  |
| --------------------------------- | ---------------------- |
| Provider                          | `anthropic`            |
| Authentication                    | commercial API key     |
| Runtime                           | `direct_messages`      |
| Model ID                          | `claude-sonnet-5`      |
| Catalog version                   | `anthropic-2026-07-19` |
| Maximum provider output           | 128,000 tokens         |
| Verification probe output ceiling | 64 tokens              |

The catalog is credential-free and indicates Adapter support, not connection eligibility. A Provider Connection is eligible only when its own live Models response contains the exact model ID and that same ID passes the bounded generation probe. Convenience aliases, free-form model names, subscription OAuth, environment fallback, and server-side Messages API fallbacks are outside the contract.

## Verification behavior

1. Send one bounded `GET /v1/models?limit=100` request using `x-api-key` and `anthropic-version`.
2. Runtime-validate the `200` Models payload and every model entry before reading provider metadata. An incomplete or malformed response fails closed as provider unavailable and never produces a partially populated offering.
3. Require the exact `claude-sonnet-5` ID. Discovery of another Claude model never changes the target.
4. Send one `POST /v1/messages` probe to the exact model with `max_tokens: 64`, adaptive thinking disabled, no sampling parameters, and no `fallbacks` field.
5. Require a `200` response from the same model containing the fixed probe marker.
6. Return only normalized state, model metadata, catalog/API versions, request IDs, the bound, and `fallbackUsed: false`.

The whole operation has a 30-second default wall-clock bound. The caller can lower it for an environment-specific verification command. Authentication failure is `invalid`; permission, rate limit, overload, network failure, malformed discovery, timeout, a missing/retired pinned model, or an invalid probe is `unavailable`. HTTP 429 and 529 normalize to `rate_limited` and `provider_overloaded` at both discovery and probe stages. No failure promotes an offering or selects another model.

Credential material, provider error messages, prompts, response text, and arbitrary response bodies are absent from verification results. `request-id` is retained for provider support and audit correlation without exposing the API key.

## Qualification evidence and remaining live gate

Public-seam contract tests cover the static catalog, live discovery normalization, malformed `200` discovery payloads, discovery rate limiting and overload, exact request body, invalid-key redaction, delayed verification abort, missing/retired model behavior, overloaded-probe behavior, invalid `200` probe content, and no fallback.

The repository test suite uses deterministic external-boundary responses; it does not contain or read a real Anthropic credential. Consequently this source qualification cannot mark any Company Provider Connection or Agent as available. The product gate opens only when an authorized operator stores a credential through the SecretStore task and the deployed Adapter records a successful live verification attempt for that connection.
