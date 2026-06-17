# CLAUDE.md

This is a [QUESTPIE](https://questpie.com) project. See **`AGENTS.md`** for the
full agent guide — it is the source of truth and this file mirrors it.

## Use the QUESTPIE skill

- **`questpie`** — collections, globals, routes, jobs, codegen, auth, business
  logic, typed client + TanStack Query.

Invoke skills by name (the `/skill` convention); don't work from memory. This is
a **headless API** template (no admin UI), so `questpie-admin` does not apply.

**If it isn't installed**, install it and then trim this file to a pointer:

```bash
bunx skills add questpie/questpie
```

## Docs for LLMs

- https://questpie.com/llms.txt — doc sitemap
- https://questpie.com/llms-full.txt — full docs in one LLM-optimized file
- http://localhost:3000/api/docs — live API reference (dev server running)

## This project

- **Runtime**: Elysia on **Bun** (no bundler — `.js` ESM imports resolve natively)
- **Shape**: headless API — no admin UI, no React; fetch handler at `src/index.ts`
- **Database**: PostgreSQL (Drizzle ORM)
- **Auth**: Better Auth (email/password); typed `better-auth/client` in `src/lib/`
- **Validation**: Zod **v4**

```bash
bun dev                              # Dev server with watch (port 3000)
bun run scaffold:verify              # Regenerate codegen + type-check
bun run db:push                      # Push schema to local dev DB
bun questpie add collection <name>   # Scaffold an entity (auto-runs codegen)
```
