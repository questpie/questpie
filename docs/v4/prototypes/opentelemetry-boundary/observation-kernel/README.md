# Private observation kernel executable proof

Status: deterministic candidate evidence for Proposed ADR-0033

This isolated Bun tracer falsifies the smallest Runtime observation seam. It is
not production code and it does not publish a provider SPI.

`kernel.ts` models one Runtime-owned root Execution plus nested scope lifecycle.
Runtime facts become one closed `ExecutionEventV2` start/event/end union and the
same value is encoded by the repository canonical JSON-line kernel. The
optional callback is the breaking v2 replacement for the existing host `events`
callback; the proof never emits v1 in parallel. The neutral adapter receives
only closed lifecycle input and cannot author Envelope identity, authority,
outcome, or payload.

The executable cases prove:

- Runtime-instance and unsigned-decimal sequence identity, one identity shared
  by every nested semantic scope, null identity for Runtime lifecycle and
  Fetch/Route ingress, exact millisecond time, canonical object-key order, and
  absence of raw Call, Principal, Tenant, Policy, SQL, payload, exception text,
  and stack data;
- all 14 projected span-start shapes plus Runtime lifecycle, exact event/end
  payloads, and one explicit extraction value carrying validated `tracestate`
  into remote-parent ingress;
- a built-in no-op with null durable trace context and no adapter close owner;
- exactly-once `scope.run`, neutral observation bypass after a pre-entry adapter
  fault, preservation of application results and failures, and containment of
  callback re-entry;
- per-Runtime async-context and same-layer suppression isolation across
  interleaved awaits;
- Fetch scope retention through streaming response EOF and idempotent end;
- refusal of late nested materialization or Envelope-counter recreation after
  root end;
- fail-open host callback, adapter event, and adapter end faults; and
- independent Envelope callback limits, injected low-counter exhaustion,
  best-effort end of an existing adapter scope, and refusal of new
  materialization.

Run the proof with:

```sh
bun test docs/v4/prototypes/opentelemetry-boundary/observation-kernel/kernel.test.ts
bunx tsc -p docs/v4/prototypes/opentelemetry-boundary/observation-kernel/tsconfig.json
```

The adapter is deliberately represented as a private structural fixture here.
The Proposed public boundary remains an opaque official handle: this proof does
not authorize application-authored adapters, spans, attributes, or events.
