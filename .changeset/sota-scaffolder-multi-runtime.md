---
"create-questpie": minor
---

Multi-runtime scaffolding: choose **TanStack Start, Next.js, Hono, or Elysia**.

- **Next.js** (App Router, Turbopack) and **TanStack Start** are full-stack —
  admin UI, OpenAPI/Scalar docs, typed client + TanStack Query.
- **Hono** and **Elysia** are headless API servers on Bun (no admin UI).
- Interactive runtime + module selection; agent skills installed via
  `bunx skills add questpie/questpie`.
- Every template ships an extensionless-import shared core that is
  byte-identical across runtimes; each was boot-verified to start with zero
  errors.
