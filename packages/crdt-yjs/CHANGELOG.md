# @questpie/crdt-yjs

## 3.28.2

## 3.28.1

## 3.28.0

## 3.27.1

## 3.27.0

## 3.26.2

## 3.26.1

## 3.26.0

## 3.25.3

## 3.25.2

## 3.25.1

## 3.25.0

## 3.24.0

## 3.23.0

## 3.22.0

## 3.21.1

## 3.21.0

## 3.20.1

## 3.20.0

## 3.19.2

## 3.19.1

## 3.19.0

## 3.18.0

## 3.17.0

### Minor Changes

- [#188](https://github.com/questpie/questpie/pull/188) [`f534369`](https://github.com/questpie/questpie/commit/f53436930137368000294877b5f02ced55b2dbf4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add collection-wide collaborative aggregates with typed text and set fields.
  - Declare collaborative owners and fields with `.collaborative()` and `.crdt()`, then consume their generated, fully typed client and server APIs.
  - Synchronize CRDT bytes through bounded Fetch routes while reusing the existing SSE or Pusher realtime session for opaque dirty hints, with no adapter-specific host or second provider connection.
  - Preserve aggregate-wide atomic transactions, fresh field-level authorization, lifecycle fencing, idempotent retry, offline IndexedDB recovery, and bounded awareness rosters.
  - Create and resolve bounded opaque text anchors through symmetric typed browser and request-scoped server field APIs, preserving ordinary edits while detaching across field or owner recreation.
  - Publish Yjs text engines for browser and server use from `@questpie/crdt-yjs`; its worker entry remains private package runtime machinery, and its bounded pool drains and terminates with application shutdown.
