---
"questpie": minor
---

Harden the starter authentication boundary.

- Deny user-mode generic CRUD and introspection for Better Auth infrastructure
  collections while preserving system and Better Auth database operations.
- Scope non-admin starter user CRUD to the current profile and reserve
  identity/authority fields for administrators.
- Project only opaque owned session IDs from session listing and resolve them
  server-side for revocation, so reusable Better Auth bearer tokens never cross
  the list-sessions wire contract.
