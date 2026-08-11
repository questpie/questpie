# ADR 0005: Keep Principal in core and Auth outside the compiler ABI

- Status: Accepted
- Date: 2026-08-10

## Context

The earlier Auth design made Better Auth plugin schema, client pairing,
ordering, and runtime callbacks a large compiler protocol. Supporting every
Better Auth plugin would require QUESTPIE wrappers or compiler-compatible plugin
metadata.

Authorization does not require QUESTPIE to own credential authentication.
External Auth systems can resolve a trusted token or session into application
identity facts.

## Decision

Core owns Principal, Tenant, Authority, and Policy. Principal exists without a
credential Auth product.

Credential Auth is an integration that resolves a request or token into a
Principal. Better Auth can be a recommended first-party Package that preserves
its native server and client APIs.

Better Auth plugin schema, plugin order, and callback signatures do not define
the QUESTPIE compiler ABI. The first tracer may use one small explicit bootstrap
integration. The complete reusable Auth Package contract is deferred to its own
grill.

If an Auth Package creates PostgreSQL tables, those tables must enter the normal
Compiled Manifest, Migration Plan, checksum, Schema Fingerprint, and Drift
lifecycle. Preserving a native Auth API does not permit a second hidden schema
migrator.

Application profile data remains application-owned. An Auth integration can own
private credential state without forcing application User augmentation.

## Consequences

- Policy and realtime authorization can be designed independently of one Auth
  library.
- QUESTPIE does not wrap every Better Auth plugin.
- Auth schema integration can use normal Definitions when a concrete package
  needs visible application data.
- The full Auth migration and Studio experience remain later work.

## Rejected alternatives

- Make Better Auth a mandatory core capability.
- Compile arbitrary Better Auth plugin internals into every App Contract.
- Remove the stable Principal and leave authorization to handlers.
