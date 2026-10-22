---
"questpie": patch
---

Preserve Zod wire input types separately from parsed route input. Typed clients now accept the original schema input, including ISO strings piped into Date coercion, transforms, defaults and optional values. Handlers, access rules and LIVE dependency callbacks keep the parsed output type. The distinction survives route parameters and generated definitions; `InferRouteWireInput` is available from the server, services and client entrypoints.

HTTP route parameters are percent-decoded exactly once before route access and execution, matching the literal values supplied through MCP and LIVE. Catch-all parameters retain slashes, and literal percent escapes are not decoded twice. Malformed encoded parameters return BAD_REQUEST (400). Applications that manually decoded HTTP route parameters should remove that extra decoding.
