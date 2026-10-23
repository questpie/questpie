---
"questpie": minor
---

Preserve Zod wire input types separately from parsed route input. Typed clients now accept the original schema input, including ISO strings piped into Date coercion, transforms, defaults and optional values. Handlers, access rules and LIVE dependency callbacks keep the parsed output type. The distinction survives route parameters and generated definitions; `InferRouteWireInput` is available from the server, services and client entrypoints.

HTTP route parameters are percent-decoded exactly once before route access and execution, matching the literal values supplied through MCP and LIVE. Catch-all parameters retain slashes, and literal percent escapes are not decoded twice. Malformed encoded parameters return BAD_REQUEST (400). Applications that manually decoded HTTP route parameters should remove that extra decoding.

The collection client encodes literal IDs on every by-ID endpoint, preserving IDs such as `50%off` and `a%20b` through reads, mutations, versions and workflow transitions. Pass literal IDs instead of pre-encoding them. Standalone `.` and `..` parameter values are rejected before opening client requests and during LIVE admission because URL normalization cannot preserve them as path segments.
