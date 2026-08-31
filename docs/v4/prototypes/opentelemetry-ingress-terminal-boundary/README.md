# OpenTelemetry ingress/terminal contract repair

Status: focused candidate evidence for Proposed ADR-0034.

This proof repairs only two executable omissions discovered while pulling
OTEL-02 through the Accepted ADR-0033 interface:

1. one complete extraction return must distinguish continue from restart;
2. a Fetch/Route terminal before `Response` creation must not invent a status.

[`kernel.ts`](./kernel.ts) is the smallest executable type/decoder proof. Its
interface returns one of the already accepted ingress trace plans and uses an
exact disjoint HTTP-end union whose explicit `null` means no `Response` existed.
[`kernel.test.ts`](./kernel.test.ts) exercises continue, restart, retained
tracestate, restart tracestate exclusion, exact keys, invalid context, numeric
response status, response-absent cancellation/failure/deadline shape, and
rejection of successful or structurally incomplete response-absent ends.

The proof does not implement OpenTelemetry, edit ADR-0033's accepted evidence,
publish documentation, or change lifecycle, Policy, transactions, retry, or
application behavior. After formal PASS, a separate authority projection must
update the ADR index, SPEC, CONTEXT, OTEL ticket contract, and HANDOFF. OTEL-02
then replaces the current private extraction/end grammar atomically; no old
decoder or dual path remains.

Run:

```sh
bun test docs/v4/prototypes/opentelemetry-ingress-terminal-boundary/kernel.test.ts
bunx tsc -p docs/v4/prototypes/opentelemetry-ingress-terminal-boundary/tsconfig.json --pretty false
bunx oxlint docs/v4/prototypes/opentelemetry-ingress-terminal-boundary/*.ts
bunx oxfmt --check docs/adr/0034-freeze-explicit-ingress-trace-plans-and-response-absent-http-terminals.md docs/v4/prototypes/opentelemetry-ingress-terminal-boundary
bun docs/v4/prototypes/opentelemetry-ingress-terminal-boundary/staging-check.ts
git diff --check
```
