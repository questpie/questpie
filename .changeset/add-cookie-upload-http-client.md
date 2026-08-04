---
"@questpie/testing": minor
---

Add `createHttpClient` to `@questpie/testing/scenario`, a transport for scenario
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
