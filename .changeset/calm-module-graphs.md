---
"questpie": patch
---

Harden module and codegen-plugin graph resolution. Dependency cycles now fail
with their path, repeated object identities deduplicate consistently, and
distinct modules or plugins sharing one name fail instead of silently winning
in one runtime or codegen phase.
