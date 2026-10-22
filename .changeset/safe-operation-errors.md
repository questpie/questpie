---
"questpie": minor
"@questpie/mcp": minor
---

This minor changes existing HTTP and MCP error contracts and MCP route schemas.
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
