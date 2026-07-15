# AGENTS.md

Guidance for AI agents working in this [QUESTPIE](https://questpie.com) project.

## Use the QUESTPIE skills

This project is built on QUESTPIE. Do not work from memory — the framework is
codegen-driven and the APIs evolve. Lean on the installed skills:

- **`questpie`** — collections, globals, routes, jobs, codegen, auth, business
  logic, the typed client + TanStack Query. Invoke it for any server/data work.
- **`questpie-admin`** — admin UI: views, blocks, custom fields, branding,
  dashboard, live preview. Invoke it for any admin panel work.

Invoke skills by name (the `/skill` convention) — they are commands, not files
to read.

**If those skills are NOT installed**, install them first, then trim this file:

```bash
bunx skills@1.5.17 add questpie/questpie --skill questpie questpie-admin --yes --copy
```

The install is project-local and recorded in `skills-lock.json`. Inspect it with
`bunx skills@1.5.17 list --project --json`; refresh it with
`bunx skills@1.5.17 update --project --yes`.

After installing, replace the body of this file with a one-line pointer to the
skills above — they are the always-current source of truth and this doc should
not duplicate them.

## Docs for LLMs

When a skill isn't enough, consult:

- https://questpie.com/llms.txt — doc sitemap
- https://questpie.com/llms-full.txt — full docs in one LLM-optimized file
- http://localhost:3000/api/docs — live API reference (Scalar, dev server running)

## This project

- **Runtime**: TanStack Start (React) + Vite + Nitro, package manager **Bun**
- **Database**: PostgreSQL via Drizzle ORM (Postgres extensions are not
  auto-created — see `README.md`)
- **Auth**: Better Auth (email/password); the `user` collection ships with
  admin — extend it, never replace it
- **Validation**: Zod **v4** (not v3)
- **Source layout**: server contracts in `src/questpie/server/`, admin UI in
  `src/questpie/admin/`, HTTP mount in `src/routes/api/$.ts`, typed client in
  `src/lib/`

## Key scripts

```bash
bun dev                     # Start dev server (port 3000)
bun run scaffold:verify     # Regenerate codegen + type-check
bun run db:push             # Push schema to the local dev database
bun questpie add collection <name>   # Scaffold an entity (auto-runs codegen)
```

## Production database rule

**Never run `bun run db:push` / `questpie push` against production or from a
deployment init container.** It bypasses migration history; `--force` does not
make it production-safe. Generate and commit migrations with `bun run
migrate:create`, then apply them in deployment with `bun run migrate`.
