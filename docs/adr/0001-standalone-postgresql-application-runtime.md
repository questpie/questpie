# ADR 0001: Make QUESTPIE a standalone PostgreSQL application runtime

- Status: Accepted
- Date: 2026-08-10

## Context

V3 combined an embedded backend framework, a CMS-like Admin, host adapters, and
many integrated services. Research against Adonis, Convex, and Supabase showed
that host-framework breadth and infrastructure checklists do not create a clear
QUESTPIE product.

V3's strongest behavior already depends on one PostgreSQL transaction,
transactional dispatch, durable change capture, worker coordination, and
realtime recovery.

## Decision

QUESTPIE combines an open Static Application Compiler with a PostgreSQL-native
QUESTPIE Runtime that runs as a standalone process by default.

The Runtime owns operation dispatch, workers, realtime sessions, health,
startup, and shutdown. It exposes one low-level Fetch boundary for tests,
special embedding, and incremental adoption.

QUESTPIE does not maintain an official host-adapter matrix or promise lifecycle
parity with web frameworks. Frontend applications remain framework-neutral and
use the generated client.

PostgreSQL is visible and portable. V4.0 does not publish a generic database
engine interface.

## Consequences

- Runtime guarantees have one lifecycle and one deployment target.
- Hono, Elysia, Next, and similar adapter packages are not v4 core surfaces.
- QUESTPIE data remains portable PostgreSQL data. The complete Runtime contract
  is portable only across provider profiles that pass conformance tests.
- A managed Cloud can later operate this Runtime as a separate control plane.

## Rejected alternatives

- Remain an embedded library with an equal adapter for every host.
- Become a general full-stack web framework.
- Become a database-neutral application framework.
- Compete with Supabase by reproducing its infrastructure service list.
