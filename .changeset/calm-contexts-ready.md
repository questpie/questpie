---
"questpie": minor
---

Expose provider-neutral Channel subscription readiness after authorization and
replay catch-up for SSE and managed transports. Channel authorization and
presence now receive the complete request-scoped AppContext, including stable
request services and application extensions, with deterministic disposal at the
request or streaming-response boundary.
