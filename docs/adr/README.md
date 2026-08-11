# QUESTPIE v4 architecture decisions

This directory contains only current v4 decisions. Earlier exploratory ADRs
were removed from the clean-state branch because they mixed incompatible
product models. Git history and `docs/v4/research/` preserve the evidence.

## Accepted

1. [Standalone PostgreSQL application runtime](./0001-standalone-postgresql-application-runtime.md)
2. [Reviewable schema and migration lifecycle](./0002-reviewable-schema-lifecycle.md)
3. [Studio as the operational application surface](./0003-studio-is-the-operational-application-surface.md)
4. [One tracer before product breadth](./0004-prove-one-tracer-before-capability-breadth.md)
5. [Principal in core and Auth outside the compiler ABI](./0005-keep-principal-core-and-auth-outside-the-compiler-abi.md)
6. [Transactional v1 schema artifact protocol](./0006-freeze-the-transactional-v1-schema-artifact-protocol.md)
7. [Static composition compiles before runtime](./0007-compile-static-composition-before-runtime.md)

## Open decisions

The schema lifecycle and static composition contracts are accepted for the
first tracer. Operation APIs remain accepted only at the semantic level in
`SPEC.md`; their exact TypeScript API is still open.

An accepted ADR does not authorize implementation outside the current tracer.
