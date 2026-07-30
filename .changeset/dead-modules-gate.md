---
"questpie": patch
---

Internal: adds a `dead-modules` CI ratchet. No runtime or API change.

Source files that nothing can reach from a package's declared `exports`, its
`.generated` output or its `bin` are counted per package and the count may only
go down. It is the first of the gates coming out of the maintenance sweep — the
class it covers (a PoC left in `src/` after the real implementation landed
elsewhere, a deprecated shim outliving its migration) is the one that had
accumulated most quietly, and the one nothing else in CI could see.
