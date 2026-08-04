---
"questpie": patch
---

Fix the realtime client posting an empty topic list when the last subscriber
leaves while the connection is being opened.

`connect()` checks that there are topics, then suspends on `getAuthHeaders()`.
Anything that emptied the topic map in that window — a route change, an effect
cleanup, a double-invoked mount — produced `{ topics: [] }` on the wire. The
server rejects that with `realtime.topicsRequired`, and the client swallowed the
400 because its error path saw an empty map and returned without retrying. It
showed up as silent failed requests on every page load, one per live arm.

The guard is now re-read after the suspension, and the payload is built before
it. If topics emptied and refilled during the await, the connect still goes out
well-formed and the control channel reconciles the topology right after.
