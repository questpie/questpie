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
adapter context instead of resolving a second identity. Next route handlers now
return an exact seven-method type while preserving their 3.x configuration
surface. Code that indexed the handler object with an arbitrary string must use
one of the seven exported method names.
