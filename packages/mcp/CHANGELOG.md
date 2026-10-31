# @questpie/mcp

## 3.42.0

### Patch Changes

- Updated dependencies [[`d39a5e7`](https://github.com/questpie/questpie/commit/d39a5e77cc14ca21182f919277b3b4eb9ad06a16), [`d39a5e7`](https://github.com/questpie/questpie/commit/d39a5e77cc14ca21182f919277b3b4eb9ad06a16)]:
  - questpie@3.42.0

## 3.41.0

### Patch Changes

- [#443](https://github.com/questpie/questpie/pull/443) [`3dd9f33`](https://github.com/questpie/questpie/commit/3dd9f3352cf614aa5ece1662226e54f21f107ee5) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Align the opt-in route schema resource with tool discovery. Route resources now use the same draft-07 schema conversion and tool input envelopes as the listed tools. Functional product access runs only when invoking the route with parsed input and real parameters; resource discovery keeps MCP policy/scope checks and hides statically denied routes.

- [#444](https://github.com/questpie/questpie/pull/444) [`45ba3e2`](https://github.com/questpie/questpie/commit/45ba3e264b88d29e66153da85f6863eca4961cd5) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Require Zod 4.6.6 or newer for its bounded-collection validation security fix. Update dependency and peer minimums, examples, and generated-project templates so an existing vulnerable Zod 4 version cannot satisfy the declared contract.

  Upgrade shadcn to 4.22.1 and env-core to 0.13.11 so their supported dependency ranges accept Zod 4, removing the private Zod 3 copy. Existing shadcn CSS imports stay the same. The admin package and generated projects now declare Node 20.18.1 or newer to match shadcn's supported runtime; this does not change the core framework's Node requirement. Regenerate project lockfiles when upgrading these dependencies.

  Repository and generated-project roots pin Azure Identity to 4.13.0, whose supported MSAL 3 LTS dependency avoids GHSA-xcx6-jx8p-x3h5. The pin satisfies the existing Tedious, files-sdk and unstorage ranges. They also pin body-parser 2.4.0 and Undici 7.30.1 for their denial-of-service fixes. Package-manager overrides are application-root configuration and do not propagate from published libraries: existing applications should add these three pins to their own Bun/npm `overrides`, pnpm `pnpm.overrides`, or Yarn `resolutions`, then regenerate the lockfile. No audit allowlist or release-age exemption is added.

- Updated dependencies [[`3dd9f33`](https://github.com/questpie/questpie/commit/3dd9f3352cf614aa5ece1662226e54f21f107ee5), [`3dd9f33`](https://github.com/questpie/questpie/commit/3dd9f3352cf614aa5ece1662226e54f21f107ee5), [`7996485`](https://github.com/questpie/questpie/commit/7996485771c2d7e7fa8f803d9ff4e9cf1ebc4619), [`3dd9f33`](https://github.com/questpie/questpie/commit/3dd9f3352cf614aa5ece1662226e54f21f107ee5), [`3dd9f33`](https://github.com/questpie/questpie/commit/3dd9f3352cf614aa5ece1662226e54f21f107ee5), [`45ba3e2`](https://github.com/questpie/questpie/commit/45ba3e264b88d29e66153da85f6863eca4961cd5), [`3dd9f33`](https://github.com/questpie/questpie/commit/3dd9f3352cf614aa5ece1662226e54f21f107ee5)]:
  - questpie@3.41.0

## 3.40.0

### Minor Changes

- [#432](https://github.com/questpie/questpie/pull/432) [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Breaking behavior change: the previously unbounded MCP tools catalog must now be strictly less than 100,000 UTF-8 bytes, including the complete result wrapper, schemas, and metadata after visibility and schema projection. Oversized catalogs fail explicitly with their largest contributors. No tools or required input/output schemas are silently removed, and pagination cannot bypass the limit. This applies to HTTP, workload, trusted-maintenance stdio discovery, and the in-process workload port’s listCustomTools result.

  Migration: measure your complete tools/list response and target less than 85,000 UTF-8 bytes to leave headroom. Reduce verbose descriptions or explicitly configure which tools your release exposes if it exceeds the limit. Set execution.maxCatalogBytes to 85,000 (or a stricter threshold) to enforce that margin; the 100,000-byte ceiling cannot be raised.

  Generated CRUD discovery uses cached schema projections with shared references to reduce catalog size. Input schemas preserve optional defaults, including recursive block children. Workload server and in-process port discovery now advertise custom-tool defaults as optional, matching human discovery. Tool schemas explicitly declare their non-default draft-07 dialect, as required when differing from MCP’s 2020-12 default. Tool tuple schemas remain compatible with the MCP SDK’s default draft-07 validator, including output validation after a client lists tools. Server-side Zod validation, the complete visible tool set, and output schemas remain intact. Principals with zero visible tools receive an empty list and can still use authorized resources and prompts. Schema-diet installation fails closed in every environment if SDK internals prevent budget enforcement, and unsupported tools/list cursors return InvalidParams (-32602).

- [#432](https://github.com/questpie/questpie/pull/432) [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Explicit query({ live }) routes can stream complete authorized projections over the existing shared SSE connection. Declare data and authority dependencies on captured collections with optional scalar equality anchors. Evaluations refresh identity and request-derived context facts, run access and data in one read-only repeatable-read snapshot, and capture the visibility watermark inside it. Authority events discard in-flight and queued results; maximum-age refresh and existing outbox reconciliation cover expiry and missed notifications. This is bounded reauthorization, not a linearizable revocation fence.

  Typed route method callers gain watch(input, { signal, params, locale }) only for explicitly LIVE definitions. HTTP calls accept the same path params and locale options. Wire input types remain distinct from parsed handler input, and Date snapshots retain their typed encoding. The TanStack factory adds query(input, { realtime: true }) on these routes; the initial value comes from SSE, snapshots replace data, and access denial clears only that watch's cached data. Ordinary routes remain non-realtime. Route LIVE requires native SSE; collection delta delivery remains unchanged.

  Once a transaction is acquired, its LIVE evaluation callback has a 30-second deadline and PostgreSQL statements have a 30-second timeout. Queueing, identity refresh, pool acquisition and cleanup can add time; application JavaScript must honor request.signal. Read query guidance for dependency coverage, context/transaction ownership, bounded relation loading, authorization batching, indexing and SQL-growth tests before adopting LIVE projections. No database migration is required.

  MCP derives readOnlyHint from a declared query route while preserving explicit delegation/handoff requirements. Recursive route schemas are converted with their protocol envelope so root references retain their meaning beneath input or value.

- [#432](https://github.com/questpie/questpie/pull/432) [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010) Thanks [@drepkovsky](https://github.com/drepkovsky)! - This minor changes existing HTTP and MCP error contracts and MCP route schemas.
  Apply the upgrade notes below before switching existing clients to the release;
  the new query APIs do not make these changes opt-in.

  Use one safe public error shape for HTTP and MCP product operations. MCP product failures now return canonical `{ error }` JSON in a text content block, with the same uppercase product code in `questpie/error` metadata; protocol refusals retain their existing carrier codes. Error responses omit `structuredContent` so SDK clients do not validate them against the success output schema after tool discovery. Responses in every environment omit causes, stack traces, database/hook internals, and invalid field values. Unknown exceptions remain opaque. Internal and hook diagnostic messages, including custom internal translation keys, serialize as generic public errors; the original error retains its diagnostic data server-side.

  Route tools preserve original wire input for one shared validation/execution pass and advertise input schemas without applying transforms twice. Product access runs once at invocation with real route parameters. Exposed schemas that cannot describe JSON wire input now fail explicitly; use a representable input schema such as an ISO string piped into date coercion.

  The MCP package now requires Zod 4.6.2 or newer for strict JSON Schema conversion with the explicit ISO encoding of Date outputs. Older unsupported schema conversions continue to fail closed.

  Upgrade notes: MCP route discovery no longer evaluates functional route access rules with placeholder input or parameters. Statically denied routes remain hidden; credential scopes and delegation policy still filter discovery. Functional product access runs once on the actual invocation, so an advertised tool can still reject a particular input. Keep product policy in the route instead of copying it into transport policy.

  Non-object route inputs (including root unions) use the advertised `{ input: ... }` MCP wrapper; non-object outputs use `{ value: ... }`. Update callers to the advertised schema. Unrepresentable input or output schemas now fail registration explicitly instead of advertising an empty schema. Date inputs need an explicit JSON wire schema, such as ISO text piped into date coercion; Date outputs advertise ISO text. Arbitrary output transforms require a representable output contract.

  Public HTTP handleError now treats an unwrapped ZodError as an internal 500. Convert errors from application-owned input parsing with ApiError.fromZodError; do not convert handler or output errors. HOOK_ERROR is exposed as INTERNAL_SERVER_ERROR, and validation details are limited to eight entries. The compatibility isDev option no longer enables public diagnostic disclosure. Use server-side logs for full diagnostics. Custom and CRUD MCP tools retain their existing error classification; canonical route product errors are normalized by the shared route executor.

  The MCP SDK is pinned to 1.32.1 because route schema adaptation depends on its validation and registration contract. Upgrade it only with discovery-before-invocation parity and schema-reference tests.

  Preparation also classifies a ZodError thrown by a nested parse inside the input schema as VALIDATION_ERROR; unknown transform exceptions and handler/output Zod errors remain internal. Field-error bounds now preserve safe path/message feedback when localization issue data is too large. executeJsonRoute input failures now throw ApiError rather than raw ZodError; fromZodError retains at most eight fields without invalid values. Unique-constraint product messages omit the conflicting value.

  Delegated handoffs validate credentials and input before invoking execution; product access remains at execution, so an approval may still be followed by a product denial. Approval is not a cached authorization verdict.

### Patch Changes

- Updated dependencies [[`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010), [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010), [`1ed72ab`](https://github.com/questpie/questpie/commit/1ed72abbdf993235953f81836b1c91758bb3f092), [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010), [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010), [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010), [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010), [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010), [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010), [`02fe32a`](https://github.com/questpie/questpie/commit/02fe32a65bdf26ff1b1982be85d6614f0fa14010)]:
  - questpie@3.40.0

## 3.39.0

### Patch Changes

- Updated dependencies [[`b2d1b42`](https://github.com/questpie/questpie/commit/b2d1b42084d9a0f26f9f0dbb58a8a1f915f16378)]:
  - questpie@3.39.0

## 3.38.1

### Patch Changes

- Updated dependencies [[`310f9b9`](https://github.com/questpie/questpie/commit/310f9b9c47b7505bae91509f13c17493395ae97c)]:
  - questpie@3.38.1

## 3.38.0

### Patch Changes

- Updated dependencies [[`83eff96`](https://github.com/questpie/questpie/commit/83eff968297d2eb292f5b1692e949aa7c6324026)]:
  - questpie@3.38.0

## 3.37.0

### Patch Changes

- [#414](https://github.com/questpie/questpie/pull/414) [`93a6042`](https://github.com/questpie/questpie/commit/93a6042ccaf4891e1db888c4c5c859225293d2a0) Thanks [@questpie-autopilot](https://github.com/apps/questpie-autopilot)! - Require MCP TypeScript SDK 1.32.1 to include the session-bound experimental task and bounded HTTP validation fixes (GHSA-22jm-h49p-29qw and GHSA-46jr-4wx8-v453).

- Updated dependencies [[`93a6042`](https://github.com/questpie/questpie/commit/93a6042ccaf4891e1db888c4c5c859225293d2a0)]:
  - questpie@3.37.0

## 3.36.0

### Patch Changes

- Updated dependencies [[`1c6d3e4`](https://github.com/questpie/questpie/commit/1c6d3e448263743554a6c2de9c22c3edf0aa7058)]:
  - questpie@3.36.0

## 3.35.7

### Patch Changes

- Updated dependencies [[`a2d381a`](https://github.com/questpie/questpie/commit/a2d381ae5f6a0c987e983e04fa8f5f4cf5acd134)]:
  - questpie@3.35.7

## 3.35.6

### Patch Changes

- Updated dependencies [[`f486732`](https://github.com/questpie/questpie/commit/f486732f36e64df6c013ca9c2b8e11bcd10dd53e)]:
  - questpie@3.35.6

## 3.35.5

### Patch Changes

- Updated dependencies []:
  - questpie@3.35.5

## 3.35.4

### Patch Changes

- Updated dependencies [[`9afe00e`](https://github.com/questpie/questpie/commit/9afe00e59ae153876fd25817fc5a769011aa4101), [`43e7fa9`](https://github.com/questpie/questpie/commit/43e7fa91caf696051b59d93b995755ffa32bd5d8)]:
  - questpie@3.35.4

## 3.35.3

### Patch Changes

- Updated dependencies [[`b66d92b`](https://github.com/questpie/questpie/commit/b66d92b732cbf8e38bff55258ebba6aef007adb8)]:
  - questpie@3.35.3

## 3.35.2

### Patch Changes

- Updated dependencies []:
  - questpie@3.35.2

## 3.35.1

### Patch Changes

- Updated dependencies [[`4e4bdbc`](https://github.com/questpie/questpie/commit/4e4bdbc1b9fc7d894d8411291b201027eaec852b)]:
  - questpie@3.35.1

## 3.35.0

### Patch Changes

- Updated dependencies [[`9693590`](https://github.com/questpie/questpie/commit/9693590e435eeacf4acb88d0510536ccbe1a3065)]:
  - questpie@3.35.0

## 3.34.2

### Patch Changes

- Updated dependencies [[`9b36b8b`](https://github.com/questpie/questpie/commit/9b36b8b1741354c718f96fee66d13f754494d022)]:
  - questpie@3.34.2

## 3.34.1

### Patch Changes

- Updated dependencies [[`6089b60`](https://github.com/questpie/questpie/commit/6089b60c5ef8ca94fd928bfd18ca3f7c65370f0f)]:
  - questpie@3.34.1

## 3.34.0

### Patch Changes

- [#385](https://github.com/questpie/questpie/pull/385) [`492b0e8`](https://github.com/questpie/questpie/commit/492b0e8bd3a39439cb150038c9ae887611b44e02) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Update the MCP SDK dependency floor to 1.31.0, including the security-fixed OAuth client credential issuer binding. QUESTPIE consumes the SDK server APIs and does not implement an SDK OAuth client provider.

- Updated dependencies [[`492b0e8`](https://github.com/questpie/questpie/commit/492b0e8bd3a39439cb150038c9ae887611b44e02), [`492b0e8`](https://github.com/questpie/questpie/commit/492b0e8bd3a39439cb150038c9ae887611b44e02)]:
  - questpie@3.34.0

## 3.33.0

### Patch Changes

- Updated dependencies [[`5ca50c9`](https://github.com/questpie/questpie/commit/5ca50c915add55aad19e225836f094c840628a5b)]:
  - questpie@3.33.0

## 3.32.0

### Patch Changes

- Updated dependencies [[`e4c6c08`](https://github.com/questpie/questpie/commit/e4c6c08331886cba014f8c890e93814d53271696)]:
  - questpie@3.32.0

## 3.31.0

### Patch Changes

- Updated dependencies [[`054646d`](https://github.com/questpie/questpie/commit/054646d5f6df4b680d7c4e492905a45be7457b0c)]:
  - questpie@3.31.0

## 3.30.0

### Patch Changes

- Updated dependencies [[`4fc9241`](https://github.com/questpie/questpie/commit/4fc92415c9a749b923471a98f56ed928159074dc)]:
  - questpie@3.30.0

## 3.29.0

### Minor Changes

- [#374](https://github.com/questpie/questpie/pull/374) [`2944de0`](https://github.com/questpie/questpie/commit/2944de05112e8ed6f681007a6195856dfce2d652) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add MCP prompts. `mcpPrompts(name, { access, scopes, list, get })` defines a prompt provider that a module contributes under `mcp-prompts/` (codegen category `mcpPrompts`), the same way custom tools are contributed under `mcp-tools/`. The server answers `prompts/list` and `prompts/get` per request with the caller's own context, so each caller sees only the prompts they may use; clients such as Claude Code and claude.ai show them as slash commands, and they add nothing to the `tools/list` catalogue.

  - `access` and `scopes` are required and gate the whole provider on every request, with the same rule evaluation and OAuth scope gate custom tools use. A denied caller sees none of the provider's prompts, and its `list` and `get` never run.
  - `get` returns `null` for a name the caller cannot use. The client receives the same `InvalidParams` "Prompt not found" error as for an unknown name.
  - The `prompts` capability is advertised in `initialize` only when at least one provider is released, without `listChanged`. Remote workload servers never serve prompts.
  - Both requests run inside the existing execution limits. A provider result the MCP schema rejects fails the request as `internal`.
  - `get` may throw `new McpError(ErrorCode.InvalidParams, message)` for missing or invalid arguments; the client receives it as `-32602` with that message. Any other throw stays the opaque `internal`.
  - `prompts/list` returns every prompt in one page and never issues `nextCursor`, so any non-empty `cursor` is rejected with `-32602`.
  - A provider's `scopes` join the advertised OAuth scope catalogue.

  Apps that use the MCP codegen plugin get the new `mcpPrompts` category on their next `questpie generate`.

### Patch Changes

- Updated dependencies []:
  - questpie@3.29.0

## 3.28.11

### Patch Changes

- [#371](https://github.com/questpie/questpie/pull/371) [`6efe6b7`](https://github.com/questpie/questpie/commit/6efe6b74adc4511e07601a35fadccfad30ef0bbc) Thanks [@drepkovsky](https://github.com/drepkovsky)! - `tools/list` no longer carries wire noise that zod v4 / the MCP SDK's JSON Schema codec put on every tool's `inputSchema`/`outputSchema`, and the same diet now applies to the schema-resources listing and workload discovery descriptors (`resources.ts`'s `toJsonSchema` call sites, including its route `inputSchema`/`outputSchema`/`toolInputSchema` fields) since they share the same `toJsonSchema()` helper. The diet:

  - Drops the top-level `$schema` dialect pointer. The MCP SDK's own `tools/list` projection emits JSON Schema **draft-07** by default (not 2020-12); a tuple's draft-07 `items: [...]` + `additionalItems` is first rewritten in place to 2020-12's `prefixItems: [...]` + trailing `items`, so the document is genuinely 2020-12-shaped everywhere before `$schema` is dropped (an absent `$schema` is universally read as 2020-12).
  - Drops `additionalProperties: false`, except inside a `oneOf`, `not`, or `if` subtree, where it can be load-bearing for branch exclusivity or negation semantics for any client-side JSON Schema validator (reproduced: a `oneOf` of two `.strict()` objects, one a superset of the other's keys — stripping `additionalProperties: false` from the narrower branch lets a value that should match exactly one branch match both, which a `oneOf`-aware validator then rejects as ambiguous). Everywhere else it's safe to drop: the MCP SDK always validates call-time arguments against the original zod schema, never against this projected JSON Schema, so removing the annotation changes nothing about what a call gets rejected for.
  - Drops the regex `pattern` on a `format: "uuid"` node while keeping `format` itself. That pattern is the zod-generated uuid regex — the only way `format: "uuid"` appears in these schemas — and is redundant for the same call-time-validates-against-the-original-zod-schema reason as `additionalProperties`. A `pattern` on a node that isn't `format: "uuid"` is a user-authored constraint and is left untouched.

  Consumers whose `tools/list` catalogue was pushing past a client's byte limit (for example claude.ai connectors, capped around 100,000 B) get a smaller catalogue for the same tool set, with no change to which arguments a call accepts or rejects, and no change to `oneOf`/`not`/`if` schema semantics for client-side validators.

- Updated dependencies []:
  - questpie@3.28.11

## 3.28.10

### Patch Changes

- [#370](https://github.com/questpie/questpie/pull/370) [`0c64888`](https://github.com/questpie/questpie/commit/0c64888d92aecf761e5a7ba8b78271ef236e7a15) Thanks [@drepkovsky](https://github.com/drepkovsky)! - A custom tool call whose arguments fail the input schema now answers `invalid_input` with each rejected field's path and message (`MCP operation failed: invalid input — ops.0.clientPath: …`, at most eight issues, 4 KB) instead of the bare sentence. Workload callers (`createWorkloadMcpToolPort`) had no other way to learn which field to fix. Over HTTP/stdio the MCP SDK already reported most of these; failures only the real schema catches (transforms, dates, defaults the advertised schema relaxes) now carry the same detail. Messages written in `refine`/`superRefine` are returned as-is, so they must not contain server data. A ZodError thrown inside a handler stays opaque.

- Updated dependencies []:
  - questpie@3.28.10

## 3.28.9

### Patch Changes

- [#366](https://github.com/questpie/questpie/pull/366) [`0283108`](https://github.com/questpie/questpie/commit/0283108a159633c0c0975895c38d6212da8d5079) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Move auth to Better Auth 1.7.4 so OAuth access tokens can only target registered resources (GHSA-p2fr-6hmx-4528).

  - The OAuth module gains the 1.7 schema: `oauthResource`, `oauthClientResource` and `oauthClientAssertion`, plus new columns on `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent` and `jwks`. Generate and run a migration after upgrading.
  - `validAudiences` is gone in Better Auth 1.7. The MCP endpoint (and the CRDT API audience when collaboration is enabled) is now registered through `resources`; per-client resource links are not enforced, so already registered clients keep working.
  - An app that supplies its own `oauthProvider()` replaces these defaults: rename `validAudiences` to `resources` and set `enforcePerClientResources: false`, or every existing client fails with `invalid_target` (Better Auth 1.7 enforces per-client links by default).
  - Resource rows are only inserted at boot. Removing an audience from config does not disable its row; disable it in `oauthResource`.
  - Better Auth 1.7 advertises DPoP. The MCP endpoint still accepts Bearer tokens only, so a DPoP-bound token is refused there.
  - A dynamic registration that names no `application_type` and carries a redirect a web client may not use (http, loopback or private-use scheme) is registered as `native`, so local MCP clients can still connect.
  - Google and GitHub sign-in verify the provider subject through Better Auth's `accountSubject` instead of the mapped user `id`; stored account ids are unchanged.
  - The auth adapter rethrows Postgres' own error for a missing table or a unique violation, so an auth instance built before migrations ran, or two replicas seeding at once, no longer crash on Bun SQL.

- Updated dependencies [[`0283108`](https://github.com/questpie/questpie/commit/0283108a159633c0c0975895c38d6212da8d5079)]:
  - questpie@3.28.9

## 3.28.8

### Patch Changes

- Updated dependencies [[`8b951e3`](https://github.com/questpie/questpie/commit/8b951e3a12986d95a8c4b50bc0498780de553fe7)]:
  - questpie@3.28.8

## 3.28.7

### Patch Changes

- Updated dependencies [[`38fdcb5`](https://github.com/questpie/questpie/commit/38fdcb52ad27597b379d85bb4f43147d39de6b37)]:
  - questpie@3.28.7

## 3.28.6

### Patch Changes

- [#336](https://github.com/questpie/questpie/pull/336) [`311f030`](https://github.com/questpie/questpie/commit/311f030cef224cce0359d4624c07d5c9dc46eaaf) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Preserve the full request authority context when MCP discovers generated collection/global tools
  and schema resources, so OAuth callers see the same access-filtered catalog as ordinary QUESTPIE
  requests. Generated writes for optimistic-concurrency collections now require and forward
  `expectedRevision` for update and delete operations.
  Consumers can now disable generated relation expansion while keeping relation identifier fields
  available for filtering and projection.
  Generated collection list tools now apply their documented `sort` input to QUESTPIE `orderBy`.
- Updated dependencies [[`311f030`](https://github.com/questpie/questpie/commit/311f030cef224cce0359d4624c07d5c9dc46eaaf)]:
  - questpie@3.28.6

## 3.28.5

### Patch Changes

- Updated dependencies [[`b362f56`](https://github.com/questpie/questpie/commit/b362f5604438b6b9a0b012aefda1189774decd26)]:
  - questpie@3.28.5

## 3.28.4

### Patch Changes

- Updated dependencies [[`ef0b5c4`](https://github.com/questpie/questpie/commit/ef0b5c4dd6cf80e07acab5c56c4b293ca8d21bbf)]:
  - questpie@3.28.4

## 3.28.3

### Patch Changes

- Updated dependencies [[`9d8f88c`](https://github.com/questpie/questpie/commit/9d8f88c486dce850175c1ba43af441faa251e74f)]:
  - questpie@3.28.3

## 3.28.2

### Patch Changes

- Updated dependencies [[`5e37736`](https://github.com/questpie/questpie/commit/5e37736d686e6080d6991564e54762ee074792b2)]:
  - questpie@3.28.2

## 3.28.1

### Patch Changes

- Updated dependencies [[`5f7dbb9`](https://github.com/questpie/questpie/commit/5f7dbb90e69bb104d8bfbddde464ad706d0f415a)]:
  - questpie@3.28.1

## 3.28.0

### Patch Changes

- Updated dependencies [[`c92a0c2`](https://github.com/questpie/questpie/commit/c92a0c28cf2a74d909eae35565b3f5d084cbe23d), [`fe8f86f`](https://github.com/questpie/questpie/commit/fe8f86f7839c23a5ae32592e5c6ef21a6bb8b03f), [`fa440e5`](https://github.com/questpie/questpie/commit/fa440e5f499a4090c73601aff87f8a6071455e34)]:
  - questpie@3.28.0

## 3.27.1

### Patch Changes

- Updated dependencies [[`d425ca9`](https://github.com/questpie/questpie/commit/d425ca9355f11d5b514c2ae7a4dee03f543ca6e6)]:
  - questpie@3.27.1

## 3.27.0

### Patch Changes

- Updated dependencies [[`74b9a6d`](https://github.com/questpie/questpie/commit/74b9a6d35f47d627177966beb81c395f45216790), [`3214843`](https://github.com/questpie/questpie/commit/3214843c46238a66097a5d3bc35e65dc1a7732e2), [`5fff464`](https://github.com/questpie/questpie/commit/5fff46425ee306fd89dddb663b0e60ba33c528a9), [`8a9eef7`](https://github.com/questpie/questpie/commit/8a9eef739bbecc8ba8e9a3444eb8905ef4307585), [`5fff464`](https://github.com/questpie/questpie/commit/5fff46425ee306fd89dddb663b0e60ba33c528a9), [`bd75a6b`](https://github.com/questpie/questpie/commit/bd75a6b01f661fe5277d0905ed35acd7db271953)]:
  - questpie@3.27.0

## 3.26.2

### Patch Changes

- Updated dependencies [[`be5dcd5`](https://github.com/questpie/questpie/commit/be5dcd5b6c0cd6034a15a8ab73d6d767d358a3f7), [`1a81417`](https://github.com/questpie/questpie/commit/1a8141742292e9e17149ec4e6bc88c1c42bdfc3e), [`9f8b921`](https://github.com/questpie/questpie/commit/9f8b921685178d9b4af51bfd7febba02c9a0fee2), [`8d4fbad`](https://github.com/questpie/questpie/commit/8d4fbad5da94ddbd32237ac10c7cf601750afe6a)]:
  - questpie@3.26.2

## 3.26.1

### Patch Changes

- Updated dependencies [[`e1620ea`](https://github.com/questpie/questpie/commit/e1620ea526bf4ab9e3e0d90b0b4df9fc1b8c30e2)]:
  - questpie@3.26.1

## 3.26.0

### Patch Changes

- Updated dependencies [[`c6fbf42`](https://github.com/questpie/questpie/commit/c6fbf42e0b8a199753a92dbe91eb9b5d034d61f6)]:
  - questpie@3.26.0

## 3.25.3

### Patch Changes

- Updated dependencies [[`f72cdfa`](https://github.com/questpie/questpie/commit/f72cdfa26b94ff1f4bcfffeec398e7a79a66b548)]:
  - questpie@3.25.3

## 3.25.2

### Patch Changes

- Updated dependencies [[`974e6b2`](https://github.com/questpie/questpie/commit/974e6b24eeee2d26466c142d06f79cc7ba1f65e7)]:
  - questpie@3.25.2

## 3.25.1

### Patch Changes

- Updated dependencies [[`6542080`](https://github.com/questpie/questpie/commit/65420804940ede8b419bfeed8964d5f1ce32b82b)]:
  - questpie@3.25.1

## 3.25.0

### Patch Changes

- Updated dependencies [[`da70c88`](https://github.com/questpie/questpie/commit/da70c88286f0b5228d500b989554908d8724a463)]:
  - questpie@3.25.0

## 3.24.0

### Patch Changes

- Updated dependencies [[`e23ad85`](https://github.com/questpie/questpie/commit/e23ad853d9c62b3e575d8cb9420ed63fe8924270), [`e23ad85`](https://github.com/questpie/questpie/commit/e23ad853d9c62b3e575d8cb9420ed63fe8924270)]:
  - questpie@3.24.0

## 3.23.0

### Patch Changes

- Updated dependencies [[`bec0c23`](https://github.com/questpie/questpie/commit/bec0c23a78f1318a86c09e8d02f1584c89605c50), [`76bf85c`](https://github.com/questpie/questpie/commit/76bf85c681bf3187338574d8a9b4e21e47ac9051)]:
  - questpie@3.23.0

## 3.22.0

### Patch Changes

- Updated dependencies [[`b5b4a81`](https://github.com/questpie/questpie/commit/b5b4a81f2864d0e17f960b3e1e52c727d45b7124), [`195648d`](https://github.com/questpie/questpie/commit/195648dba74395dfa1d37c6ba9382c40ef63c8e3), [`17b6cab`](https://github.com/questpie/questpie/commit/17b6cabffb8f340270c4caf4f8da36be42310fb7), [`cd62bb8`](https://github.com/questpie/questpie/commit/cd62bb8bf4df98b3f75c4a894ba8148677a3b9ae)]:
  - questpie@3.22.0

## 3.21.1

### Patch Changes

- Updated dependencies [[`5c5f5b6`](https://github.com/questpie/questpie/commit/5c5f5b672acfeca55cf7ffd6db97dec535997bfe)]:
  - questpie@3.21.1

## 3.21.0

### Patch Changes

- Updated dependencies [[`fb6653a`](https://github.com/questpie/questpie/commit/fb6653a8b41d5c7e61bf4fa209b2ec86cf91ec7b)]:
  - questpie@3.21.0

## 3.20.1

### Patch Changes

- Updated dependencies [[`4e4ea31`](https://github.com/questpie/questpie/commit/4e4ea3174bce830b1a8efa95faf381aa36b88b24)]:
  - questpie@3.20.1

## 3.20.0

### Patch Changes

- Updated dependencies [[`030c5dd`](https://github.com/questpie/questpie/commit/030c5dd09be7798fcb696e4e47312c758e855930)]:
  - questpie@3.20.0

## 3.19.2

### Patch Changes

- Updated dependencies [[`8114e59`](https://github.com/questpie/questpie/commit/8114e5966ffce9ecc2dd1c3be844dfff065b8af3)]:
  - questpie@3.19.2

## 3.19.1

### Patch Changes

- Updated dependencies [[`15a9f47`](https://github.com/questpie/questpie/commit/15a9f4726fdd68402532f3d6683b657e02a65863)]:
  - questpie@3.19.1

## 3.19.0

### Patch Changes

- Updated dependencies [[`7510720`](https://github.com/questpie/questpie/commit/7510720b88e1688998f5bfe5e098f7a7b3313b38)]:
  - questpie@3.19.0

## 3.18.0

### Patch Changes

- Updated dependencies [[`62992aa`](https://github.com/questpie/questpie/commit/62992aa22f0708cc0bf545231f1e6f9f47b58516)]:
  - questpie@3.18.0

## 3.17.0

### Minor Changes

- [#186](https://github.com/questpie/questpie/pull/186) [`d6931de`](https://github.com/questpie/questpie/commit/d6931defd2705525091dd0cace56c516a8f9d5c3) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fail-closed remote workload authority across sandbox and MCP.
  - **sandbox**: add a generic, consumer-authorized workload admission path with
    signed single-use transport binding, strict resource limits, canonical broker
    routing, safe audit events, and no product-specific principal model. Sandboxed
    guests can list and invoke an explicitly bound subset of application MCP custom
    tools through opaque, revocable, bounded host sessions; guests never receive
    the application, database, authorizer, or native broker token.
  - **mcp**: require explicit catalog entries for every CRUD operation, route,
    resource, and custom tool; derive OAuth scopes from that same catalog and
    re-authorize discovery and invocation through scopes, RBAC, and an opaque
    workload authorizer. Apply shared input/output, depth, node, deadline,
    cancellation, catalog-size, global-concurrency, and per-principal-concurrency
    bounds across HTTP, stdio, resources, and direct workload tool calls while
    keeping public errors disclosure-safe.
  - Retire the unsupported `@questpie/ai` workspace runtime and its
    worker/fleet/Harness/provider application model. Historical npm versions remain
    available, but QUESTPIE does not publish a compatibility stub.
  - Remove ambient stdio system authority and the private executor spike; sandbox
    execution remains available through QUESTPIE's core executor service.

### Patch Changes

- Updated dependencies [[`f534369`](https://github.com/questpie/questpie/commit/f53436930137368000294877b5f02ced55b2dbf4), [`4be1529`](https://github.com/questpie/questpie/commit/4be15299ffafa8a4808474823815a3dc6d49689d), [`079be69`](https://github.com/questpie/questpie/commit/079be6971f1ff3b8f6aed4a1c8bc0b3182bfcb99), [`b5c2b78`](https://github.com/questpie/questpie/commit/b5c2b78f274d444a0b63867d262025d2ebd592a9), [`d752314`](https://github.com/questpie/questpie/commit/d75231406e016b0e07f36182fc6dc9dbb1f8b224), [`c1ab1c0`](https://github.com/questpie/questpie/commit/c1ab1c0b8873a66a163effbc31ec431a5d442298), [`1a750e0`](https://github.com/questpie/questpie/commit/1a750e02a7c9eea7a52c035b009b78b79742961c), [`158ff0c`](https://github.com/questpie/questpie/commit/158ff0c58933a4b498191d99544222af134bea49), [`875ae8c`](https://github.com/questpie/questpie/commit/875ae8c23fbdebd7e557a86ce4ee19c8c180d9aa), [`5c4804a`](https://github.com/questpie/questpie/commit/5c4804a8f45a34e3b8f20fc1210c2518f18e6f6a)]:
  - questpie@3.17.0

## 3.16.0

### Patch Changes

- Updated dependencies [[`ea5f109`](https://github.com/questpie/questpie/commit/ea5f1096009fec7818b0ffd6ae74412662a3ac6e)]:
  - questpie@3.16.0

## 3.15.2

### Patch Changes

- Updated dependencies [[`734737f`](https://github.com/questpie/questpie/commit/734737fd5a079c4063b6ff49f34fbacf01d8a2e8)]:
  - questpie@3.15.2

## 3.15.1

### Patch Changes

- Updated dependencies [[`1e2691f`](https://github.com/questpie/questpie/commit/1e2691f6d2f310860bf81db2219f23dd4d122d10)]:
  - questpie@3.15.1

## 3.15.0

### Patch Changes

- [#166](https://github.com/questpie/questpie/pull/166) [`0fd1da3`](https://github.com/questpie/questpie/commit/0fd1da363e432653b8c45cef02ed867d3bf34d47) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Advertise OAuth protected-resource metadata at the actual MCP adapter mount path, including generated apps mounted under `/api`, and allow public MCP clients to complete dynamic client registration before the user signs in.

- Updated dependencies [[`3e2dc5e`](https://github.com/questpie/questpie/commit/3e2dc5ed47b0b6fa279586d3ce3d27a2cc3154fb), [`0fd1da3`](https://github.com/questpie/questpie/commit/0fd1da363e432653b8c45cef02ed867d3bf34d47), [`018dfb5`](https://github.com/questpie/questpie/commit/018dfb5b77039d0148a59d371062d08d1b89b691)]:
  - questpie@3.15.0

## 3.3.0

### Minor Changes

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Make the AI, MCP, and sandbox packages publishable with release metadata, README documentation, package typecheck fixes, and stable sandbox adapter tests.

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add MCP-over-OAuth 2.1. An external MCP client can now connect to a QUESTPIE app purely via OAuth 2.1 (dynamic client registration → authorize + PKCE → consent → token → `POST /mcp`), authorized as `scopes ∩ RBAC`: out-of-scope tools are not even listed, and the user's `.access()` rules still apply.

  - **First-class request `principal`** (`user | oauth | system`) — an OAuth access token resolves to the underlying user, so existing RBAC keeps working, with consented scopes layered on top.
  - **Declarative granular scope catalog** — `collections:<name>:read|write|delete`, `globals:<name>:read|write`, `routes:<key>:invoke` (+ coarse `collections:*` umbrellas) DERIVED from the app's collections/globals/routes and merged into the provider at auth-instance build; the MCP scope gate derives its required scopes from the same source, so they never drift.
  - **EdDSA token-verify pinning** — access-token verification is pinned to the exact algorithm the provider issues, rejecting algorithm-substitution.
  - **Composable `oauthModule`** — the OAuth provider + OAuth tables are a self-contained module. `starterModule` bundles it (existing apps unchanged), and a custom-auth / headless (hono/elysia) app can add `oauthModule` on top of its own better-auth user model.
  - Root OAuth/MCP discovery endpoints (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/jwks`); the HTTP `/mcp` route requires a verified principal (401 + `WWW-Authenticate`). Uses `@better-auth/oauth-provider` (replaces the deprecated `mcp` / `oidc-provider` plugins).

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - The MCP HTTP endpoint is now expressed through the codegen route convention instead of a hand-written `module.ts`: one shared `mcpHandler` registered by four single-method route files (`mcp.ts` = POST, `mcp.get.ts`, `mcp.delete.ts`, `mcp.options.ts`) on the same `mcp` path. To support this, the codegen file convention now recognises `.options` and `.head` method suffixes (e.g. `mcp.options.ts` → route key `mcp:OPTIONS`), matching the existing `.get`/`.post`/`.put`/`.patch`/`.delete` handling.

### Patch Changes

- Updated dependencies [[`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92)]:
  - questpie@3.14.0
