# @questpie/testing

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

### Minor Changes

- [`c0ae045`](https://github.com/questpie/questpie/commit/c0ae0451a6c8dc5e7b952c927695bf4270bc45ac) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `createHttpClient` to `@questpie/testing/scenario`, a transport for scenario
  tests against a real production server.

  It carries a cookie jar that absorbs every `Set-Cookie` on a response, replaces a
  cookie when the server sends the same name again, and drops one the server
  expires. Requests can be JSON, text or a multipart upload. Redirects come back to
  the caller rather than being followed, so a login that answers `302` is yours to
  inspect.

  A response keeps its status, headers and raw body. `json()` parses on request and
  throws `HttpJsonError` when the body is not JSON, holding on to the status and
  the raw text, because the useful part of that failure is usually the HTML error
  page a proxy returned.

  Registered secrets and every cookie value are replaced in rendered errors.

  The client is a transport, not an auth DSL. Who logs in, with which credentials
  and against which route stays with your application; you write a domain flow by
  driving the client.

- [`833a1e4`](https://github.com/questpie/questpie/commit/833a1e43e89467f26ad5a72cf158d430053843ec) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `createEvidence` and `createCleanup` to `@questpie/testing/scenario`, and put
  every harness in this package on the same bounded, redacted evidence ring.

  `createEvidence` holds output in a ring bounded twice, by line count and by
  characters per line, so a process that prints forever costs a fixed amount of
  memory and one enormous line cannot swallow the tail. Registered secrets are
  replaced longest first, which keeps a short secret from splitting a longer one
  and leaving the remainder readable. Redaction now happens before truncation: the
  other order let a secret straddling the cut keep a half that matched no
  registered value and so was never replaced.

  Point it at an artifact directory and a failing run writes a manifest naming the
  command, the runtime and the outcome, next to the captured output. A passing run
  removes the directory, so a green suite leaves nothing behind to be misread later
  as the record of a failure.

  `createCleanup` tears down in reverse registration order, because a resource is
  registered after the thing it depends on. Every step runs even when an earlier
  one throws, and `CleanupError` carries all of them: a run that leaked a database
  and a port says both, instead of making you fix one and rerun to find the other.
  Repeated and concurrent calls share one result, and it works after a partial
  setup where later resources were never created.

  `startProductionServer` now uses this ring, so its limits and the ones a scenario
  sets are the same limits.

- [`d3b1ab1`](https://github.com/questpie/questpie/commit/d3b1ab1f2e2bbcf410b1920c81c5def9c89add43) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `drainQueue` and `cycleRealtimeTransport` to `@questpie/testing/scenario`,
  two generic fault levers for scenario tests.

  `drainQueue` waits for a queue to go quiet. Quiet means several consecutive zero
  readings rather than the first one, because a job that enqueues its follow-up
  leaves a gap where the queue reads as empty, and a drain that returns on that gap
  is the flake that fails one run in twenty. It is bounded: a queue that never
  settles fails with the last count it saw instead of hanging the suite.

  `cycleRealtimeTransport` drops a realtime transport and brings it back. It calls
  your own connect and disconnect and touches nothing else, so it never writes to a
  channel ledger or any other durable store. It reconnects even when the disconnect
  throws, because a transport left down by a failed fault injection breaks every
  test after it and points the blame at the wrong place.

  Both take what to probe or drive from the caller, so neither names a queue,
  adapter or channel. Both record what they observed into the shared evidence ring.

## 3.22.0

### Minor Changes

- [`649ca34`](https://github.com/questpie/questpie/commit/649ca3465b394ce56b4bd45906ec27f4edeb82c4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a lease-protected disposable PostgreSQL primitive for production scenario tests.

- [`b5e8d4a`](https://github.com/questpie/questpie/commit/b5e8d4a23296e0895b20ed141dce97dcd1051cb2) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a production server subprocess harness with readiness, restart, bounded logs, redaction, and verified shutdown semantics.

- [`83f89a4`](https://github.com/questpie/questpie/commit/83f89a49a765c36a0c3d38429205408bb68f625a) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add explicit typed anonymous, user, OAuth, and system test actors that run with production request-context semantics.

### Patch Changes

- [`b5b4a81`](https://github.com/questpie/questpie/commit/b5b4a81f2864d0e17f960b3e1e52c727d45b7124) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add the zero-config PGlite `createTestApp()` lifecycle with committed migrations, extension modules, bounded setup, and ordered idempotent disposal. Accept the real PGlite client type directly in QUESTPIE runtime configuration.

- [`a55f92a`](https://github.com/questpie/questpie/commit/a55f92ad92e5b911a6d5a4351c5d5da8ee72f0e8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add the public `@questpie/testing` package with isolated in-process and production-scenario entrypoints.
