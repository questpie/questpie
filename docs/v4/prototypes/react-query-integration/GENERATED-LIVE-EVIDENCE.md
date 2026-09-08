# Generated watch to native Query cache

This extends the R1 checkpoint `110d4896c` with the existing generated SSE client
on 2026-09-08. It does not complete R2 or change accepted architecture.

The same Task IR is rendered twice: one ordinary Query client and one client
whose compiler-projected realtime contract identifies Task detail as watchable.
The sibling derives that capability from the contract. Application code still
calls `.queries["tasks.detail"].options(input)`; it does not repeat watchability,
keys, codec definitions, or endpoint names. The existing `.watch` owns SSE and
acknowledgements. The adapter does not use `.observe` or another result cache.

The initial connected test failed because options still performed an ordinary
GET and opened zero watches. Passing the generated watch capability through
canonical capture to the existing finite-fetch experiment made it pass. Two
subsequent hostile coverage tests passed without another implementation change.
Together the three tests make 14 assertions:

- native fetch resolves with the first Date-decoded snapshot, while a subscribed
  observer receives a later snapshot on the same binding;
- unobserved prefetch sends close and the generated client aborts its stream;
- an authorization-failure frame clears retained native data, closes the
  transport and prevents an old options object from opening another watch.

Tests control only an external Fetch/ReadableStream peer. Frame parsing,
correlation, codec decoding, open/ack/close commands and shutdown execute the
production renderer's generated code. There is no real HTTP server, browser,
Policy evaluation or PostgreSQL transaction in this evidence. This is not the
post-commit fresh-generation proof.

From this directory run `bun run test:live`. The existing `test:generated`,
`test`, `types:generation`, `types:generated` and `types:check` scripts also pass.
Together with the independent-bundle regression below, the combined runtime
count is 23 tests and 86 assertions.

## Type-generation measurement

The first working-directory run resolved TypeScript 7.0.2 from an earlier shared
probe install, despite this prototype's 6.0.2 lockfile. That run is not pinned
TypeScript evidence. The local dependency link was corrected to the previously
isolated 6.0.2 installation; every type project and the measurement passed again.
`measure:generation` now rejects a compiler version different from package.json.
The R0 standalone 6.0.2 result remains unchanged.

One sequential local 6.0.2 run produced the following results. Each synthetic
application alternates Query and Mutation operations from the Task IR. Every
operation is consumed by a typechecked function. The baseline calls the raw
client; the candidate exercises native cache inference and MutationObserver.

| Operations | Variant    | Generated source bytes | Type instantiations | Check time |
| ---------- | ---------- | ---------------------: | ------------------: | ---------: |
| 25         | Raw client |                 52,011 |               2,896 |     0.21 s |
| 25         | Candidate  |                 67,695 |              18,518 |     0.32 s |
| 200        | Raw client |                243,853 |              12,523 |     0.42 s |
| 200        | Candidate  |                353,941 |             112,803 |     0.96 s |

The descriptor has a measurable cost: the 200-operation generated source adds
110,088 bytes, and native consumer types require substantially more
instantiations. These are unminified source sizes and compiler check times, not
browser bundle sizes, startup timings, editor latency, a stable benchmark, or a
release budget. `bun run measure:generation` writes fresh details under ignored
`generated/`; elapsed times will vary.

## Still not safe to ship

The identity table and live cache listener are allocated during options
construction. The provisional cap prevents unlimited entries but does not solve
abandoned renders or reclaim entries on native cache eviction.

A second tools-disabled Opus-high consultation completed in 154,747 ms.
Transport metadata reports `claude-opus-5` and auxiliary
`claude-haiku-4-5-20251001`; the prompt/response remain in the owned external
`questpie-react-cache-consult.JK3dsU` directory. Prompt SHA-256:
`c65ed20a2f734f34ded3f6c71366d30a7af39905c7970b3baf203b2333fb62e3`.
This was design advice, not acceptance.

Its independent-module collision finding was reproduced by actually bundling
and importing another adapter copy. Two different inputs received the same key.
Adding a random per-binding namespace makes the test pass and prevents one
copy's disposal from evicting the other's cache. Binding creation remains
idempotent within one module, and a retired binding remains terminal. The
suggestion to silently rebind a retired scope was not adopted.

The cache-write test uses a native updater function. A direct object-literal
updater hit a TypeScript 6 `NoInfer` diagnostic in that generic call; the updater
function typechecks without a DTO cast. General literal-updater inference has
not been established, so do not present this as complete optimistic API typing.

For render-time identity, the consultation favors computing a secret-keyed
fingerprint instead of allocating an ordinal. That is a candidate, not an
implemented or selected cryptographic contract. Do not hand-roll its suggested
short SipHash implementation, claim collision impossibility, or introduce a
browser-shipped deployment secret. The suggested SSR secret sharing does not
provide secrecy from clients and does not establish matching scope identity.
SSR remains deferred. The next test must reject 10,000 abandoned options
creating cache subscriptions or retaining an input registry; work should begin
only when the native Query actually fetches.

Reserved overrides, initial-failure translation, in-flight Mutation retirement,
React/StrictMode, full compiler source discovery, PostgreSQL observation,
conservative invalidation and ordered optimism remain open. Ordinary one-shot
Queries remain one-shot. Public exports, accepted ADRs, release scope and
Autopilot are unchanged.
