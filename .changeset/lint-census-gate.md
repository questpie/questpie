---
"questpie": patch
---

Internal: adds a `lint-census` CI ratchet. No runtime or API change.

oxlint warning counts are frozen per package per rule and may only go down. The
Lint & Format job gated errors only and said so in its own comment — warnings
were unbounded, and its green did not mean the lint backlog was under control.
This is the follow-up that comment promised.

`no-underscore-dangle` is counted but deliberately not ratcheted: it is 1114 of
the 1443 warnings, and a leading underscore is this codebase's convention for
internal members. Gating it would fail CI for following the house style. 329
warnings remain governed, dominated by `no-unused-vars`.
