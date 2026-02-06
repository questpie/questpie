# QUESTPIE CMS - Critical Dependencies

**IMPORTANT**: When creating new examples or packages, ALWAYS use these exact versions to ensure compatibility.

## Core Dependencies

### ⚠️ CRITICAL - Must Match Exactly

| Package       | Version   | Notes                                           |
| ------------- | --------- | ----------------------------------------------- |
| `zod`         | `^4.2.1`  | **v4 ONLY!** Not v3.x                           |
| `drizzle-orm` | `^beta`   | **Specific beta version**                       |
| `drizzle-kit` | `^beta`   | **Must match drizzle-orm**                      |
| `better-auth` | `^1.4.9`  | Authentication provider                         |
| `pg`          | `^8.13.1` | PostgreSQL driver                               |
| `pg-boss`     | `^12.5.4` | Queue system (uses Postgres)                    |
| `superjson`   | `^2.2.1`  | Enhanced serialization (Date, Map, Set, BigInt) |

### Frontend Frameworks

| Package                 | Version    | Notes            |
| ----------------------- | ---------- | ---------------- |
| `react`                 | `^19.2.0`  | React 19         |
| `react-dom`             | `^19.2.0`  | React 19 DOM     |
| `@tanstack/react-query` | `^5.62.11` | Data fetching    |
| `@tanstack/react-table` | `^8.20.5`  | Table component  |
| `@tanstack/db`          | `^0.1.1`   | Offline-first DB |
| `react-hook-form`       | `^7.54.0`  | Form library     |

### UI & Styling

| Package             | Version  | Notes              |
| ------------------- | -------- | ------------------ |
| `tailwindcss`       | `^4.0.6` | Tailwind CSS v4    |
| `@tailwindcss/vite` | `^4.0.6` | Vite plugin        |
| `@base-ui/react`    | `^1.0.0` | Base UI components |
| `@hugeicons/react`  | `^1.1.1` | Icon library       |
| `shadcn`            | `^3.6.1` | Component CLI      |

### Build Tools

| Package      | Version   | Notes                     |
| ------------ | --------- | ------------------------- |
| `typescript` | `^5.7.2`  | TypeScript compiler       |
| `bun`        | `1.3.0`   | Runtime & package manager |
| `tsdown`     | `^0.18.3` | Build tool                |
| `vite`       | `^7.1.7`  | Dev server & bundler      |

## How to Check Versions

```bash
# Check zod version across project
grep -r "\"zod\":" packages/*/package.json examples/*/package.json

# Check drizzle-orm version
grep -r "\"drizzle-orm\":" packages/*/package.json examples/*/package.json

# Check all critical deps in CMS package
cat packages/cms/package.json | grep -E "\"(zod|drizzle-orm|better-auth|pg|pg-boss)\":"
```

## When Adding New Examples/Packages

1. **Copy from existing example** (e.g., `examples/portfolio-hono/package.json`)
2. **Verify critical versions match** this document
3. **Never guess versions** - always check existing packages first
4. **Update this doc** if new critical dependencies are added

## Why These Specific Versions?

- **zod v4**: Breaking changes from v3, all schemas use v4 API
- **drizzle-orm beta**: Specific beta build with required features
- **React 19**: Latest stable with new hooks and features
- **Tailwind CSS v4**: New CSS-first architecture
- **TanStack DB 0.1.x**: Early version, API may change

## Workspace Dependencies

Always use `workspace:*` for internal packages:

```json
{
  "dependencies": {
    "@questpie/cms": "workspace:*",
    "@questpie/admin": "workspace:*",
    "@questpie/tanstack-query": "workspace:*"
  }
}
```

## Package Manager

**MUST use Bun** (defined in root package.json):

```json
{
  "packageManager": "bun@1.3.0"
}
```

Do NOT use npm, yarn, or pnpm.
