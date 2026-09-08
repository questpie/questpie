# Scope-private Query input fingerprints

Status: Proposed research, 2026-09-08. This selects no Accepted contract and
claims no implemented or verified adapter behavior. SSR/hydration compatibility
remains a separate unresolved design obligation.

## Recommended dependency and use

For the bounded browser-only experiment, use an exact `@noble/hashes` `2.4.0`
dependency. The npm registry's `latest` metadata returned that version on the
research date; the maintainer's matching package manifest confirms the version,
exports below, ESM packaging, zero runtime dependencies, MIT license and
`sideEffects: false`. Its Node engine is `>=20.19.0`.
Sources: [npm metadata](https://registry.npmjs.org/@noble%2Fhashes/latest),
[versioned manifest](https://github.com/paulmillr/noble-hashes/blob/2.4.0/package.json).

```ts
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

// Inside the private binding owner; never exported or serialized.
const secret = randomBytes(32);
const fingerprint = bytesToHex(hmac(sha256, secret, canonicalInputBytes));
```

The versioned HMAC implementation returns a `Uint8Array` synchronously and
destroys its temporary hash states after producing the digest. The byte utilities
provide hexadecimal encoding and platform `crypto.getRandomValues` randomness;
missing randomness throws. Keep the full 32-byte output, represented as 64 hex
characters. Sources: [HMAC implementation](https://github.com/paulmillr/noble-hashes/blob/2.4.0/src/hmac.ts),
[utilities](https://github.com/paulmillr/noble-hashes/blob/2.4.0/src/utils.ts).

The proposal hashes only the existing compiler-canonical input representation.
The current [generated capture](render-projection.ts) already produces canonical
JSON text; encoding that exact text as UTF-8 supplies these bytes. No new codec,
input normalization, object sorting or handwritten cryptography belongs here.
Retain public Operation identity and the existing random binding partition as
separate Query key elements. Never expose, persist, export or derive the secret
from that public partition, Context or input. The secret belongs to one binding.

## Browser and cost evidence

The maintainer supports major browsers/runtimes, requires `.js` subimports in
v2, and describes an ES2022 compilation target. HMAC/SHA-256 needs no Node crypto
shim or asynchronous WebCrypto call. The README advertises approximately 2.8 KB
gzipped for SHA-256 alone; that is neither the complete HMAC adapter increment
nor a measured QUESTPIE bundle result. Source: [versioned README](https://github.com/paulmillr/noble-hashes/blob/2.4.0/README.md).

Inference from the implementation: each options call hashes its input on the
calling thread, with work proportional to canonical byte length and temporary
hash/encoding allocations. It retains no input lookup table. Before selecting
production behavior, measure the actual Bun browser bundle increment and the
existing input-size population in Firefox. No latency ceiling or legacy-browser
compatibility is established by this research.

## Disclosure and identity limits

RFC 2104 describes HMAC's secret-key construction and recommends random keys;
its security analysis depends on the underlying hash. Here HMAC is used only as
an opaque cache fingerprint. It grants no authorization or Policy authority.
Source: [RFC 2104, sections 2–3 and 6](https://www.rfc-editor.org/rfc/rfc2104.html).

Design inference: a key-only observer without the secret cannot test input
guesses by plain hashing. Equal inputs still reveal equality within a binding.
An actor able to invoke the same binding can obtain fingerprints for guesses;
same-realm script execution or memory inspection defeats this limited boundary.
This is not encryption or a same-realm secrecy guarantee. The maintainer also
warns that JavaScript offers no absolute constant-time or memory-erasure
guarantee. Source: [security caveats](https://github.com/paulmillr/noble-hashes/blob/2.4.0/README.md#security).

Under a pseudorandom 256-bit-output model, the approximate accidental collision
probability across `n` distinct inputs is `n(n-1) / 2^257`. This is a mathematical
model, not collision impossibility or a formally proved application guarantee.
Fresh per-binding secrets deliberately prevent reconstructing identical keys in
another binding; this proposal establishes no SSR dehydration/hydration,
persistence, cross-tab or cross-process key compatibility.

## Comparison with the rejected ordinal map

The current [adapter](query-adapter.ts) retains canonical identities and captured
calls in a private map when options are merely constructed, and rejects the
129th distinct capture. Abandoned options therefore consume binding-owned
capacity without creating a Query cache entry. This is local source evidence,
not a property of TanStack Query itself.

The proposed fingerprint computes stable identity without that map. Options may
still hold their own captured call while reachable, and mounted live Queries
still require explicit lifetime ownership. Removing the identity registry alone
does not prove live subscription cleanup, retirement or cache eviction behavior.
No dependency installation, implementation change, benchmark or acceptance run
was performed for this note.
