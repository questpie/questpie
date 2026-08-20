# ADR 0004: Prove one tracer before product breadth

> Partially superseded by [ADR-0024](./0024-descope-minimal-studio-from-beta-one.md)
> for minimal Studio inspection in the first tracer.

- Status: Accepted
- Date: 2026-08-10

## Context

The v4 workbench contains many accepted design ideas. Implementing the complete
set before one application works would repeat the v3 breadth problem. The
repository has no external users, so a rewrite is possible, but it also has no
external validation of the new product.

## Decision

Implementation starts with one deletion-driven TanStack Barbershop tracer.

The tracer proves static identity and ownership, one authorized Augmentation,
PostgreSQL schema and migrations, Policy, Query, Mutation, Transactional
Dispatch, Change Ledger, Live Query recomputation, concrete client types, crash
recovery, and local plus managed PostgreSQL. ADR-0024 defers Studio until it
owns a useful privileged administration workflow and its authority contract.

Complete Auth, Files, Search, KV, Channels, Workflows, OpenAPI, MCP, Effect, and
managed Cloud remain outside the first tracer. The low-level Fetch boundary is
part of the Runtime, but official host adapters are not a planned product
matrix.

Jobs and Workflows remain accepted architectural product areas. The tracer first
proves their shared transaction, dispatch, lease, idempotency, and observability
spine.

## Consequences

- Accepted later-slice ADRs do not authorize early implementation.
- Each later slice must reuse the proven compiler and Runtime contracts.
- The project can delete a proposed abstraction when the tracer does not need
  its guarantee.
- Roadmap order follows proof dependencies instead of package or source layers.

## Rejected alternatives

- Implement every accepted ADR before an application slice works.
- Port v3 package by package.
- Build Cloud before the open Runtime proves independent value.
