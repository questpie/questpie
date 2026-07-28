---
"questpie": patch
---

The client no longer bundles `qs`, cutting **90 KB** from the browser bundle. No
API change and no wire-format change.

Measured with esbuild on `import { createClient } from "questpie/client"`:
431.9 KB → 341.7 KB, and 83 modules → 38. Those are single-file
(`--bundle --outfile`) figures. The saving lands on the **entry chunk** in a real
code-splitting build too, because `qs` was a static import and a static import
always ends up in the chunk that imports it — for reference, the entry chunk with
splitting on is now 175.0 KB, with `pusher-js` correctly in its own lazy chunk.

`qs` is 13 KB but drags `object-inspect` (19 KB), `get-intrinsic` (15 KB) and
their tail — in a bundle whose actual typed client is only 27 KB, query-string
encoding cost more than three times the client itself.

All 25 client call sites used the same options, `{ skipNulls: true, arrayFormat:
"brackets" }`, so they now share one small encoder that implements exactly that
configuration and nothing else. It is not a `qs` replacement; it is the subset
the wire format needs.

The output is byte-identical to `qs.stringify`, asserted differentially against
`qs` itself across scalars, nested objects, arrays, arrays-of-objects, `Date`,
RFC3986 percent-encoding (including `!'()*`, which `encodeURIComponent` leaves
alone) and unicode — plus a round-trip through the `qs.parse` configuration the
server actually uses.

The **server** still parses with `qs`. Server bundle size is not a concern and
correctly parsing untrusted input is a much harder problem than emitting it, so
that side deliberately keeps the library.
