# Action limits candidate

- Status: falsifiable candidate for the Action Kernel acceptance
- Base: `79b56b6e8adae5c9e32b231bf22193b8b829713e`
- Scope: public limit names and semantics only; no compiler, Runtime, client,
  Effect Identity, or Operation Wire v3 shape is implemented here

ADR-0026 makes limits part of the Action-owned contract but does not fix their
shape. This candidate fills that gap with the existing semantic Operation
vocabulary and keeps raw transport limits separate.

## Selected contract

```ts
type ActionLimits = Readonly<{
	inputBytes: number;
	resultBytes: number;
	durationMilliseconds: number;
}>;
```

`limits` and all three members are required. There are no framework defaults,
partial maps, aliases, or inherited Route/Runtime values. Compilation and
Runtime artifact linking both reject missing or extra keys, negative values,
fractions, non-finite values, and values greater than
`Number.MAX_SAFE_INTEGER`. `inputBytes` and `resultBytes` must be positive;
`durationMilliseconds` is nonnegative. Zero duration is an admitted
fail-closed Action, never unlimited.

The units and measurement are exact:

- `inputBytes` is the byte length of the Runtime's canonical JSON-line encoding
  of the codec-encoded semantic Action input.
- `resultBytes` is the same encoding of either a successful output or one
  authored declared-error payload. This prevents a large declared error from
  bypassing the outcome limit.
- `durationMilliseconds` is elapsed monotonic milliseconds across the semantic
  Action kernel. It is not request travel time or raw response-stream time.

Canonical JSON-line means sorted object keys, JSON primitive rendering, UTF-8,
and one terminal LF. The shared codec must reject non-NFC text and the canonical
kernel must reject non-finite numbers, negative zero, unsupported values,
cycles, and every lone Unicode surrogate. Direct invocation performs the same
codec encode and canonical measurement as network invocation; it cannot skip a
measurement-only encode. Invalid input is `PROTOCOL_UNSUPPORTED`; invalid
handler output or declared-error payload is sanitized `INTERNAL`.

The base Runtime canonical kernel accepts a terminal lone high surrogate while
the compiler kernel rejects it. The independent prerequisite repair landed at
`c68309f3` with runtime/compiler canonical, Mutation, Live Query, Runtime
typecheck, architecture, and diff-check evidence. This proof branch does not
cherry-pick that production commit; it models the same strict rule, and Action
integration must descend from or otherwise contain that exact repair.

## Admission, deadline, and settlement order

The measurable Runtime boundary is:

1. select the statically bound Action and validate trusted Execution facts;
2. capture the local monotonic start and remaining root budget;
3. run the accepted facts-only Action admission expression;
4. after admission succeeds, observe zero or expired duration;
5. validate the Runtime-owned opaque Effect Identity;
6. decode and codec-encode input, measure it, and enforce `inputBytes`;
7. project Action Context and external-effect Services;
8. run the handler with the owned cancellation signal;
9. validate and codec-encode its result or declared error, measure and enforce
   `resultBytes`, then fix the semantic disposition.

Action admission is the accepted closed `public | authenticated | system`
facts-only evaluator; it cannot inspect input. An admission denial therefore
wins over an already exhausted or zero duration and performs no Effect read,
codec work, Service projection, or handler work. This preserves Policy as the
sole nondisclosing authorization model.

The local budget is `min(durationMilliseconds, remaining root budget)`. A
remaining root budget crosses an invocation boundary as a duration, never an
absolute wall-clock instant. Each process converts it to a local monotonic
deadline. Addition saturates at `Number.MAX_SAFE_INTEGER`; it never wraps or
fires a JavaScript timer early because of integer overflow. The exact Operation
Wire v3 field remains outside this decision, but a network adapter must carry
the remaining budget through the already accepted timeout concept or refuse
parity.

An owned deadline abort before the handler starts performs zero handler work.
After start, a validated successful result, declared rejection, or declared
ambiguity wins over a concurrently observed owned abort. The owned deadline is
reported only when the handler rejects with that exact owned reason and no
known outcome exists. An unrelated `AbortError` remains `INTERNAL`.

An oversized post-handler result or declared-error payload becomes a
non-retryable, post-handler `RESOURCE_LIMIT`. It never means that the external
provider rejected or failed to accept the effect, and it never authorizes
automatic or blind manual replay. Operation Wire v3 must make that
post-dispatch/non-replay meaning unambiguous, especially when an authored
`outcomeUnknown` payload itself is oversized. If the wire cannot preserve it,
the Action Kernel acceptance must select a distinct disposition; silently
projecting an ordinary pre-work-looking `RESOURCE_LIMIT` is not acceptable.
Framework failures contain no authored payload and are not charged to
`resultBytes`; the Runtime's separate `responseBytes` bound limits their network
frame.

## Designs compared

### A. Selected: semantic three-axis contract

`inputBytes`, `resultBytes`, and `durationMilliseconds` reuse the Query/Mutation
artifact vocabulary and measure the same semantic value on direct and network
paths. Each diagnostic identifies the exhausted owner. The cost is one
canonical measurement encode on direct invocation; parity and a real byte bound
earn that cost.

### B. Rejected: Route-shaped `{ bodyBytes, durationMs }`

This measures raw Fetch ingress, has no result bound, and gives a direct Action
no honest `body`. Reusing it would conflate the Route escape hatch with a
semantic Operation and would make equivalent direct/network inputs consume
different budgets.

### C. Rejected: aggregate `{ invocationBytes, durationMilliseconds }`

One shared byte counter cannot explain whether input or outcome crossed the
ceiling. More importantly, consuming most of the budget on one side changes the
other side's disclosure behavior and encourages adapters to count wire framing
differently. It is shallower than the selected interface without deleting an
owner or invariant.

Also rejected: zero as unlimited, implicit global defaults, `outputBytes` as a
third Operation synonym, saturating or clamping authored values, measuring raw
JSON text, and letting Route `bodyBytes` or Runtime `requestBytes` satisfy the
Action semantic input limit.

## Falsifiable proof and remaining integration gates

`check.test.ts` drives exact/partial/extra contracts, byte zero, invalid and
overflow values, exact boundary and plus one, Policy-before-limit behavior,
zero and expired durations, Effect-before-input ordering, strict canonical
encoding, multi-byte UTF-8 parity, direct/network semantic equivalence,
root/local budget selection, arithmetic saturation, owned cancellation, known
result/rejection/ambiguity precedence, declared-error payload bypass, and
post-handler result overflow. `type-contract.ts` rejects transport aliases and
partial maps.

This is a proof model, not production integration. The implementation slice
still has to drive compiler normalization/artifact tamper refusal, public
declarations, direct and network adapters, actual monotonic timers, Service
cleanup, output/error sanitation, the Runtime canonical Unicode repair, and
the Operation Wire v3 post-dispatch disposition. It must not choose caller
Effect Identity spelling, grammar, derivation, or domain-input placement here.

The names are an ordinary projection of ADR-0026, but deadline precedence and
post-dispatch resource failure are public Action Kernel semantics. They should
join the focused Action Kernel / Operation Wire v3 Effect Identity acceptance
packet rather than receive an independent acceptance review or land as an
ordinary Product default.
