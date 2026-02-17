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
| `--no-install`          | Skip dependency installation                |
| `--no-git`              | Skip git initialization                     |

## Templates

### tanstack-start (default)

Full-stack TypeScript project with:

- **TanStack Start** — File-based routing with SSR
- **QUESTPIE** — Collections, globals, auth, storage, jobs pre-configured
- **@questpie/admin** — Admin panel with sidebar, dashboard, and form views
- **Tailwind CSS v4** — Styling with shadcn components
- **Drizzle ORM** — Migrations and typed database access
- **Vite** — Dev server with HMR

The template includes example collections, a site settings global, admin config, and everything wired together — ready to run with `bun dev`.

## What It Creates

```
my-app/
├── src/
│   ├── questpie/
│   │   ├── server/
│   │   │   ├── builder.ts        # q.use(adminModule) setup
│   │   │   ├── cms.ts            # CMS assembly + build
│   │   │   ├── collections/      # Collection definitions
│   │   │   └── globals/          # Global definitions
│   │   └── admin/
│   │       └── admin.ts          # Client admin builder
│   ├── lib/
│   │   ├── cms-client.ts         # Typed CMS client
│   │   └── query-client.ts       # TanStack Query client
│   ├── routes/
│   │   ├── api/cms.ts            # CMS route handler
│   │   └── admin/                # Admin panel routes
│   └── migrations/               # Drizzle migrations
├── questpie.config.ts            # CLI config
├── AGENTS.md                     # AI agent guidance
├── package.json
└── vite.config.ts
```

## After Scaffolding

```bash
cd my-app
cp .env.example .env              # Set DATABASE_URL
bun questpie migrate              # Run migrations
bun dev                           # Start dev server
```

## Documentation

Full documentation: [https://questpie.com/docs/getting-started/quickstart](https://questpie.com/docs/getting-started/quickstart)

## License

MIT
