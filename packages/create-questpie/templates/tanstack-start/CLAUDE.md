# CLAUDE.md

This is a [QUESTPIE](https://questpie.com) project. See **`AGENTS.md`** for the
full agent guide — it is the source of truth and this file mirrors it.

## Use the QUESTPIE skills

- **`questpie`** — collections, globals, routes, jobs, codegen, auth, business
  logic, typed client + TanStack Query.
- **`questpie-admin`** — admin UI: views, blocks, custom fields, branding,
  dashboard, live preview.

Invoke skills by name (the `/skill` convention); don't work from memory.

**If they aren't installed**, install them and then trim this file to a pointer:

```bash
bunx skills add questpie/questpie
```

## Docs for LLMs

- https://questpie.com/llms.txt — doc sitemap
- https://questpie.com/llms-full.txt — full docs in one LLM-optimized file
- http://localhost:3000/api/docs — live API reference (dev server running)

## This project

- **Runtime**: TanStack Start + Vite + Nitro, package manager **Bun**
- **Database**: PostgreSQL (Drizzle ORM)
- **Auth**: Better Auth — extend the admin `user` collection, never replace it
- **Validation**: Zod **v4**

```bash
bun dev                              # Dev server (port 3000)
bun run scaffold:verify              # Regenerate codegen + type-check
bun run db:push                      # Push schema to local dev DB
bun questpie add collection <name>   # Scaffold an entity (auto-runs codegen)
```

**Production database rule:** Never run `db:push` / `questpie push` against
production or in deployment automation. `--force` does not make it safe. Commit
`migrate:create` output and run `migrate` during deployment.
