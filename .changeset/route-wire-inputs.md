---
"questpie": patch
---

Preserve Zod wire input types separately from parsed route input. Typed clients now accept the original schema input, including ISO strings piped into Date coercion, transforms, defaults and optional values. Handlers, access rules and LIVE dependency callbacks keep the parsed output type. The distinction survives route parameters and generated definitions; `InferRouteWireInput` is available from the server, services and client entrypoints.
