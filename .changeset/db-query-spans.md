---
"questpie": minor
"@questpie/observability": minor
---

Traces database queries and transactions, on every `db` config variant.

The instrumentation attaches to Drizzle's session rather than to the driver.
The driver looks like the obvious seam and is unavailable in exactly the
configurations where query latency matters most — `{ drizzle }` and
`{ create }`, i.e. Hyperdrive, Neon and Vercel Postgres, where the app supplies
its own client. Wrapping only the variants the framework constructs would have
shipped a trace that silently omits queries on serverless deployments, and a
waterfall with the database missing reads as "the database was fast".

Statements inside `db.transaction()` are traced too. SQL text is attached;
parameters never are. `instrumentDbClient` is exported for a client built
entirely outside the framework.
