---
"questpie": patch
---

Keep active query bindings when a desired topology only advances their resume cursor. Record the accepted cursor atomically so a later rewind still bootstraps; preserve full replacement for changed queries and new connections.
