---
"@questpie/admin": patch
"@questpie/openapi": patch
"questpie": patch
---

Require an admin-role session for admin RPC routes that expose admin config, content locale callbacks, preview URLs/tokens, actions, widgets, and reactive field handlers, and document that the admin package depends on the Better Auth `session.user.role === "admin"` contract.

Run block custom prefetch functions, `with` expansion, and loaders inside the caller request context so nested collection/global reads inherit the current session, locale, access mode, and workflow stage. Admin block introspection now serializes reactive field/form props and exposes only wire-safe block schema data instead of server-only callback state.

Treat `inputFalse()` and `outputFalse()` as framework-level runtime access primitives by deriving field read/write access rules from field definitions, including nested object fields. User-mode CRUD calls now reject writes to `inputFalse()` fields and redact `outputFalse()` fields from collection/global responses. OpenAPI collection/global schemas now separate input and response shapes so read-only fields are not advertised as writable and write-only fields are not advertised as returned data.
