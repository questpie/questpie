# create-questpie

Interactive CLI for scaffolding new QUESTPIE projects.

## Usage

```bash
bunx create-questpie
```

Or with a project name:

```bash
bunx create-questpie my-app
```

## Options

| Flag                    | Description                                 |
| ----------------------- | ------------------------------------------- |
| `-t, --template <name>` | Template to use (default: `tanstack-start`) |
| `--database <name>`     | Database name (default: derived from name)  |
| `--no-install`          | Skip dependency installation                |
| `--no-git`              | Skip git initialization                     |
| `--no-skills`           | Skip project-local QUESTPIE agent skills    |
| `--no-generate`         | Skip post-install QUESTPIE codegen          |

## Templates

| Template                   | Runtime mount                                   | UI       |
| -------------------------- | ----------------------------------------------- | -------- |
| `tanstack-start` (default) | `createFetchHandler` in a TanStack file route   | Admin    |
| `next`                     | `@questpie/next` App Router handlers            | Admin    |
| `hono`                     | `@questpie/hono` on the native Hono app         | Headless |
| `elysia`                   | `@questpie/elysia` composed as an Elysia plugin | Headless |

Every template includes collections, a site-settings global, typed clients,
OpenAPI, Drizzle migrations and the same generated QUESTPIE app surface. Next,
Hono and Elysia install their matching runtime adapter; TanStack Start keeps the
low-level Fetch handler because its file route already uses standard web APIs.

## What It Creates

```
my-app/
├── src/
│   ├── questpie/
│   │   ├── server/
│   │   │   ├── questpie.config.ts # runtimeConfig({ db, app, ... })
│   │   │   ├── modules.ts          # [adminModule, ...] as const
│   │   │   ├── config/            # auth, app, admin, OpenAPI config
│   │   │   ├── .generated/        # Codegen output (app + AppConfig)
│   │   │   ├── collections/       # Collection definitions (auto-discovered)
│   │   │   └── globals/           # Global definitions (auto-discovered)
│   │   └── admin/
│   │       ├── modules.ts         # Client admin modules
│   │       └── .generated/        # Generated admin config
│   ├── lib/
│   │   ├── client.ts              # Typed client
│   │   └── query-client.ts        # TanStack Query client
│   ├── routes/
│   │   ├── api/$.ts               # QUESTPIE route handler
│   │   └── admin/                 # Admin panel routes
│   └── migrations/                # Drizzle migrations
├── questpie.config.ts             # CLI discovery shim
├── AGENTS.md                      # AI agent guidance
├── package.json
└── vite.config.ts
```

## After Scaffolding

```bash
cd my-app
docker compose up -d
bun run scaffold:verify           # Regenerate codegen + type-check
bun run migrate                   # Run migrations
bun run dev                       # Start dev server

# Add entities (auto-runs codegen)
bunx questpie add collection products
bunx questpie add global marketing
```

The scaffolder creates `.env` from `.env.example`, installs project-local QUESTPIE agent skills under `.agents/skills`, and runs `questpie:generate` after dependency installation by default. `questpie add` runs codegen automatically. Use `bun run questpie:generate` only when you create files manually.

Projects generated before the adapter-backed templates remain supported. Their
direct `createFetchHandler` entrypoints use the same core engine. To match a
current Next, Hono or Elysia scaffold, install the corresponding
`@questpie/next`, `@questpie/hono` or `@questpie/elysia` package and replace only
the HTTP mount; keep the existing `/api` base path.

## Documentation

Full documentation: [https://questpie.com/docs/getting-started/quickstart](https://questpie.com/docs/getting-started/quickstart)

## License

MIT
