# OpenTelemetry artifact proof

Status: executable candidate evidence for Proposed ADR-0033

This prototype falsifies drift between the candidate signal projection and the
effective official-adapter configuration. `artifact.ts` emits two canonical
JSON-line artifacts:

- `questpie.opentelemetry-signal-projection` binds the exact installed
  `questpie` version, Semantic Conventions 1.44.0, the closed span graph,
  attribute allowlists, exact per-scope attribute ownership, per-scope event
  owners, event outcomes, and end outcomes, canonical
  PostgreSQL `xid8` transaction identity, exact Envelope event shape, event
  bound, metrics, and histogram boundaries;
- `questpie.opentelemetry-effective-config` binds that projection digest to the
  safe Resource and bounded effective adapter settings.

The event-owner, event-outcome, and end-outcome maps are derived directly from
the executable observation-kernel contract rather than copied into the
artifact builder. The attribute-scope map is exhaustive over the projection's
closed attributes, including the event-only retry delay. The proof
deep-compares every complete map, so adding a scope, event, owner, outcome, or
attribute cannot silently leave artifact bytes behind.

Their SHA-256 digests use distinct NUL-terminated domains. Object insertion
order therefore cannot change bytes, while a projection or package-version
change necessarily changes both bindings.

Exporter endpoint and header values are validated for runtime use but the
artifact records only whether each is configured. Unsupported `OTEL_*`
variables are ignored as required by `BOUNDARY.md`. There is no free Resource
or span attribute input. Closed Operation and PostgreSQL projectors reject raw
Call Identity, Policy evidence, SQL text, and arbitrary attribute maps before
signal creation.

Run the isolated proof with:

```sh
bun test docs/v4/prototypes/opentelemetry-boundary/artifacts/artifact.test.ts
bunx tsc -p docs/v4/prototypes/opentelemetry-boundary/artifacts/tsconfig.json --pretty false
```
