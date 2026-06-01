---
"@questpie/admin": patch
"@questpie/openapi": patch
"questpie": patch
---

Require an admin-role session for admin RPC routes that expose admin config, content locale callbacks, preview URLs/tokens, actions, widgets, and reactive field handlers, and document that the admin package depends on the Better Auth `session.user.role === "admin"` contract.

Run block custom prefetch functions, `with` expansion, and loaders inside the caller request context so nested collection/global reads inherit the current session, locale, access mode, and workflow stage. Admin block introspection now serializes reactive field/form props and exposes only wire-safe block schema data instead of server-only callback state.

Treat `inputFalse()`, `outputFalse()`, and field-level `.access()` declarations as framework-level runtime access primitives by resolving a single deterministic field access map for CRUD and introspection. Field `.access()` is the base rule, collection/global `.access({ fields })` can override it for compatibility, and `inputFalse()`/`outputFalse()` remain final deny rules. User-mode CRUD calls now reject restricted writes and redact restricted fields from collection/global responses, including nested object and array item paths. OpenAPI collection/global schemas now separate input and response shapes so read-only fields are not advertised as writable and write-only fields are not advertised as returned data.
