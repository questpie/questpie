# {{projectName}}

A [QUESTPIE](https://questpie.com) project built with TanStack Start.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.3+)
- [Docker](https://docker.com) (for PostgreSQL)

### Setup

```bash
# Start PostgreSQL
docker compose up -d

# Run database migrations
bun questpie migrate

# Start the dev server
bun dev
```

The admin panel will be available at [http://localhost:3000/admin](http://localhost:3000/admin).

The API docs (Scalar UI) are at [http://localhost:3000/api/docs](http://localhost:3000/api/docs).

## Project Structure

```
src/
  questpie/
    server/
      app.ts                        # Main app configuration
      builder.ts                    # Server-side builder
      rpc.ts                        # RPC router
      collections/
        posts.collection.ts         # Posts collection
      globals/
        site-settings.global.ts     # Site settings
    admin/
      admin.ts                      # Admin UI configuration
      builder.ts                    # Client-side builder
  routes/
    admin.tsx                       # Admin layout
    admin/                          # Admin routes
    api/$.ts                    # API handler
  lib/
    env.ts                          # Type-safe environment variables
    client.ts                   # API client
    auth-client.ts                  # Auth client
    query-client.ts                 # React Query client
  migrations/                       # Database migrations
```

## Scripts

| Command                       | Description              |
| ----------------------------- | ------------------------ |
| `bun dev`                     | Start development server |
| `bun build`                   | Build for production     |
| `bun start`                   | Start production server  |
| `bun questpie migrate`        | Run database migrations  |
| `bun questpie migrate:create` | Create a new migration   |

## Adding Collections

Create a new file following the naming convention:

```
src/questpie/server/collections/my-collection.collection.ts
```

Then register it in `app.ts`:

```ts
import { myCollection } from "./collections/my-collection.collection.js";

// Add to .collections()
.collections({ posts, myCollection })
```

## Adding Globals

```
src/questpie/server/globals/my-global.global.ts
```

Then register in `app.ts`:

```ts
.globals({ siteSettings, myGlobal })
```
