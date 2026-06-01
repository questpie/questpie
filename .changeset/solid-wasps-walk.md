---
"@questpie/admin": patch
---

Require an admin-role session for admin RPC routes that expose admin config, content locale callbacks, preview URLs/tokens, actions, widgets, and reactive field handlers, and document that the admin package depends on the Better Auth `session.user.role === "admin"` contract.
