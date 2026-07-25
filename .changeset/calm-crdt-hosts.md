---
"@questpie/crdt-yjs": minor
"@questpie/elysia": minor
---

Add the Yjs CRDT engine package and the Elysia collaboration host integration.

- Publish typed server and client entrypoints for `@questpie/crdt-yjs`, while keeping its worker entry internal to the package runtime.
- Expose `createElysiaCrdtHost` and its trusted-proxy configuration as the adapter surface for hosting QUESTPIE collaborative documents.
