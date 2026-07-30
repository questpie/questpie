---
"questpie": patch
---

Internal: adds a `clone-census` CI ratchet. No runtime or API change.

Counts functions that were copy-pasted rather than shared — same name AND
byte-identical body across two or more files, scored as redundant copies. This
is the defect that produced the live bugs found in this sweep: `interpolate`
existed six times in two behaviours, so `{{ name }}` interpolated in the admin
and rendered literally in core; `toPascalCase` four times in three algorithms,
two of the copies naming published OpenAPI schema components.

Name alone would be noise — `handleClick` appears in six admin components and is
not duplication. Requiring the body to match is what separates the two.

It also surfaces `equalBytes` living in the CRDT layer as three different
implementations: `left.every(...)`, a Node-only `Buffer.from(left).equals(...)`,
and a constant-time XOR accumulation. The last one is constant-time on purpose;
the other two are not, on a path that compares authority tokens.
