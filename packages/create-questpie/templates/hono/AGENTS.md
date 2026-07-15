# AGENTS.md

Guidance for AI agents working in this [QUESTPIE](https://questpie.com) project.

## Use the QUESTPIE skills

This project is built on QUESTPIE. Do not work from memory — the framework is
codegen-driven and the APIs evolve. Lean on the installed skill:

- **`questpie`** — collections, globals, routes, jobs, codegen, auth, business
  logic, the typed client + TanStack Query. Invoke it for any server/data work.

Invoke skills by name (the `/skill` convention) — they are commands, not files
to read. This is a **headless API** template (no admin UI), so the
`questpie-admin` skill does not apply here.

**If the skill is NOT installed**, install it first, then trim this file:

```bash
bunx skills add questpie/questpie
```

After installing, replace the body of this file with a one-line pointer to the
skill above — it is the always-current source of truth and this doc should not
duplicate it.

## Docs for LLMs

When the skill isn't enough, consult:

- https://questpie.com/llms.txt — doc sitemap
- https://questpie.com/llms-full.txt — full docs in one LLM-optimized file
- http://localhost:3000/api/docs — live API reference (Scalar, dev server running)

## This project

- **Runtime**: Hono on **Bun** (no bundler — the QUESTPIE `.js` ESM import
  convention resolves natively). Package manager **Bun**.
- **Shape**: headless API only — no admin UI, no React. The fetch handler is
  mounted at `src/index.ts` under `/api`.
- **Database**: PostgreSQL via Drizzle ORM (Postgres extensions are not
  auto-created — see `README.md`)
- **Auth**: Better Auth (email/password). The typed `better-auth/client` lives
  in `src/lib/auth-client.ts` for a consuming frontend or scripts.
- **Validation**: Zod **v4** (not v3)
- **Source layout**: server contracts in `src/questpie/server/`, HTTP mount in
  `src/index.ts`, typed client + TanStack Query in `src/lib/`

## Key scripts

```bash
bun dev                     # Start dev server with watch (port 3000)
bun run scaffold:verify     # Regenerate codegen + type-check
bun run db:push             # Push schema to the local dev database
bun questpie add collection <name>   # Scaffold an entity (auto-runs codegen)
```

## Production database rule

**Never run `bun run db:push` / `questpie push` against production or from a
deployment init container.** It bypasses migration history; `--force` does not
make it production-safe. Generate and commit migrations with `bun run
migrate:create`, then apply them in deployment with `bun run migrate`.
