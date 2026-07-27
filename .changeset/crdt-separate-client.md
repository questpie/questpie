---
"questpie": minor
---

**BREAKING (behind a minor — see the note below): `client.crdt` is gone. Use `createCrdtClient(client)` from `questpie/crdt`.**

```diff
+ import { createCrdtClient } from "questpie/crdt";
+
+ const crdt = createCrdtClient(client);
- const article = client.crdt.collections.articles.document({ id });
+ const article = crdt.collections.articles.document({ id });
```

`createClient()` constructed the CRDT API eagerly, so the entire client-side CRDT
implementation shipped in every browser bundle — including the majority of apps
that never open a collaborative document. It was not removable by tree-shaking:
`sideEffects: false` is declared and `dist/client.mjs` is a 1.4 KB re-export
barrel, but neither helps when the coupling is a real call site inside
`createClient()`.

Measured with esbuild through real package resolution, before and after:

| bundle                    | before    | after         |
| ------------------------- | --------- | ------------- |
| `import { createClient }` | 639,619 B | **450,475 B** |
| `+ createCrdtClient`      | 639,649 B | 641,508 B     |

**189,144 bytes (−29.6%) off every app that does not use CRDT.**

`createCrdtClient` takes the client you already built and reuses its realtime
session, so a collaborative app still holds exactly one SSE/Pusher connection —
the "no second provider connection" invariant from realtime v3 is preserved.

Reading `client.crdt` now throws with this migration rather than returning
`undefined`, so the failure points at the access site instead of surfacing later
as "Cannot read properties of undefined".

Released as a **minor** to stay on the 3.x train this repo has been running. It
is a removal of a public member, and `client.crdt` only existed from 3.17.0, so
the practical blast radius is two days wide and there is no first-party consumer
(no admin usage, no example). If you would rather hold a removal for 4.0.0, this
changeset is the thing to change.
