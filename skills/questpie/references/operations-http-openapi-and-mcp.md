# Operations, HTTP, OpenAPI, and MCP

Read [canonical Operation HTTP and OpenAPI](https://questpie.com/docs/v4/operation-http-and-openapi)
and [basic MCP](https://questpie.com/docs/v4/basic-mcp) before exposing an
Operation.

## Author one Operation contract

Define Query, Mutation, and Action handlers with the generated factories from
`#questpie/app`. Use the Operation `describe` envelope for bounded summary,
description, and codec-typed examples. Set `network: true` only when the
Operation is intended for network exposure.

The compiler derives generated-client methods, canonical HTTP, OpenAPI, and
MCP from the same Resource identity, codecs, Context, outcomes, Policy, and
documentation. Do not repeat a path, parameter list, body schema, MCP name,
error schema, description, or handler for a projection.

Prefer the generated `#questpie/client`. Create an immutable Context scope:

<!-- packed-example: generated-client -->

```ts
import { createClient } from "#questpie/client";

const client = createClient({ baseUrl: location.origin });
const api = client.withContext({ tenantId });

const tickets = await api.queries["tickets.list"]({
	first: 25,
	after: null,
});
```

Use the exact Context and input inferred by the generated client. Credentials
remain transport material and are not Context.

## Know the derived endpoints

- Query: `GET /_questpie/query/<qualified-name>` with input encoded in query
  parameters.
- Mutation: `POST /_questpie/mutation/<qualified-name>` with a JSON body and a
  caller-owned `callId` for replay after response loss.
- Action: `POST /_questpie/action/<qualified-name>` with a JSON body and a
  required caller-owned `effectKey`.
- MCP: `POST /_questpie/mcp`; a network Query, Mutation, or Action becomes
  `query.<name>`, `mutation.<name>`, or `action.<name>`.

Raw Routes keep their authored external-protocol paths. There is no generic
Operation endpoint or fallback transport.

## Select projections once

Select OpenAPI or MCP at the application level in `questpie.json`:

<!-- packed-example: projection-config -->

```json
{
	"projections": {
		"openapi": true,
		"mcp": true
	}
}
```

OpenAPI is descriptive and MCP is an execution adapter; neither grants
authority. MCP exposes only documented network Operations through the same
executor. It adds no sessions, retries, raw Routes, Job control, or authored
MCP metadata.

Handle generated closed result and failure frames rather than parsing server
text. A failed request must not expose credentials, Context values, Policy
evidence, payloads, handler source, stack traces, or PostgreSQL detail.
