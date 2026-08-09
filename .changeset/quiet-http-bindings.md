---
"questpie": patch
"@questpie/hono": patch
"@questpie/elysia": patch
"@questpie/next": patch
---

Keep Fetch handler configuration local to each binding and surface ambiguous
route patterns during handler construction instead of silently falling back to
404 responses. Forward safe request-context options through the Hono and Elysia
adapters, keep public HTTP authority in user mode, and preserve native route
fallthrough outside the configured base path. Hono mounts no longer derive
QUESTPIE authority from a mutable `c.user`; use `getSession` for custom mount
identity. Existing `questpieMiddleware` composition reuses one immutable
authority snapshot instead of resolving a second identity. Its native context
stays fully backwards-compatible while the mount derives a private app context
that native middleware cannot forge. Fresh channel and live-query authorization
also stays bound to the private request snapshot. Hono and Elysia share the core-owned
`NativeAdapterConfig` option contract. Next route handlers now return an exact
seven-method type while preserving their 3.x configuration surface. Code that
indexed the handler object with an arbitrary string must use one of the seven
exported method names. The Elysia adapter no longer carries the unused
`@elysiajs/cors` dependency or claims a built-in CORS option; applications that
need cross-origin access must install and compose Elysia's native CORS plugin.
