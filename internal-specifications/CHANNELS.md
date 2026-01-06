# Channels System Specification

This document defines the **Channels** system for QUESTPIE CMS - a type-safe, real-time communication layer for ephemeral custom events outside of database synchronization.

---

## Purpose

- Provide type-safe pub/sub channels for ephemeral collaboration features (cursor tracking, typing indicators, presence)
- Separate concerns: **Realtime** (DB sync) vs **Channels** (ephemeral application events)
- Enable distributed deployments with pluggable adapters (PostgreSQL NOTIFY, Redis Pub/Sub)
- Maintain serverless compatibility via SSE transport
- Consistent API pattern with Collections (access control, builder pattern)

---

## Distinction: Realtime vs Channels

| Feature         | **Realtime** (existing)                  | **Channels** (new)                             |
| --------------- | ---------------------------------------- | ---------------------------------------------- |
| **Purpose**     | Database change notifications            | Ephemeral custom events                        |
| **Events**      | CRUD operations (create, update, delete) | User-defined events (cursor, typing, presence) |
| **Persistence** | Always logged to `questpie_realtime_log` | **Never persisted** (ephemeral only)           |
| **Access**      | Collection-level access rules            | Channel-level access                           |
| **Use Cases**   | Auto-refresh UI on data changes          | Collaboration, live interactions               |

**Key principle:** Realtime tracks database state, Channels enable ephemeral real-time features.

### When to Use Which?

**Use Realtime (DB sync):**

- ✅ Chat messages (stored in DB, queryable history)
- ✅ Admin changes (versioning, audit trail)
- ✅ Collection CRUD (sync UI state across clients)
- ✅ Notification history (persistent, queryable)

**Use Channels (ephemeral events):**

- ✅ Cursor tracking (not stored, live only)
- ✅ Typing indicators (temporary state)
- ✅ Presence tracking (who's online)
- ✅ Live progress bars (temporary feedback)
- ✅ Real-time collaboration signals

---

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────┐
│ Client (Browser)                            │
│  - Subscribe via SSE (GET)                  │
│  - Publish via HTTP POST                    │
└──────────────┬──────────────────────────────┘
               │
               │ HTTP/SSE
               │
┌──────────────▼──────────────────────────────┐
│ CMS Server (Any Framework)                  │
│  - Auth check (Better Auth automatic)       │
│  - Validate event schema (Zod)              │
│  - Publish to distributor                   │
└──────────────┬──────────────────────────────┘
               │
               │ Pub/Sub Protocol
               │
┌──────────────▼──────────────────────────────┐
│ Distributor Adapter                         │
│  - PostgreSQL NOTIFY (default, auto-detect) │
│  - Redis Pub/Sub (recommended)              │
│  - In-Memory (single server, dev)           │
└──────────────┬──────────────────────────────┘
               │
               │ Broadcast
               │
┌──────────────▼──────────────────────────────┐
│ All Server Instances                        │
│  - Receive event from distributor           │
│  - Filter by subscribed params              │
│  - Send to SSE clients                      │
└─────────────────────────────────────────────┘
```

### Transport Layer

- **Publish**: `POST /cms/channels/:channel/publish` (JSON body with event + data)
- **Subscribe**: `GET /cms/channels/:channel/subscribe?params=...` (SSE stream)
- **Auth**: Reuses CMS Better Auth session (automatic)

---

## API Design

### 1. defineChannel Builder

Channels are defined using a builder pattern similar to `defineCollection`:

```typescript
import { defineChannel } from "@questpie/cms/server";
import { z } from "zod";

const cursorChannel = defineChannel({
  name: "cursor",

  // Optional: parametric channels (e.g., per-room isolation)
  params: z
    .object({
      roomId: z.string(),
    })
    .optional(),

  // Access control (same pattern as Collections)
  access: {
    publish: "authenticated", // boolean | string (role) | function
    subscribe: true, // Allow all to subscribe
  },
})
  .event("move", {
    schema: z.object({
      userId: z.string(),
      x: z.number(),
      y: z.number(),
    }),
  })
  .event("blur", {
    schema: z.object({
      userId: z.string(),
    }),
  });
```

**Key Design Decisions:**

- ❌ **No `onPublish` handlers** - Pure broadcast only (simplicity first)
- ❌ **No event persistence** - Ephemeral only (use Realtime for persistent events)
- ✅ **Type-safe events** - Schema validation via Zod
- ✅ **Parametric channels** - Isolated by params (e.g., per-room)

### 2. Access Control

Channels reuse the **same access control pattern as Collections**:

```typescript
type ChannelAccessRule<TData = any> =
  | boolean // true = allow all, false = deny all
  | string // Role name (e.g., 'admin')
  | ((ctx: ChannelAccessContext<TData>) => boolean | Promise<boolean>);

interface ChannelAccessContext<TData = any> {
  user?: any; // Current authenticated user (via Better Auth)
  data?: TData; // Event data being published
  params?: any; // Channel params (e.g., { roomId: 'room-123' })
  cms: QCMS; // Full CMS instance
  context?: any; // Request context
}
```

**Examples:**

```typescript
// Boolean access
const publicChannel = defineChannel({
  name: "announcements",
  access: {
    publish: false, // Server-only
    subscribe: true, // Public read
  },
}).event("message", { schema: z.object({ text: z.string() }) });

// Role-based
const adminLogsChannel = defineChannel({
  name: "admin-logs",
  access: {
    publish: "admin",
    subscribe: "moderator",
  },
}).event("action", {
  schema: z.object({
    action: z.string(),
    targetId: z.string(),
  }),
});

// Function-based (custom logic)
const chatChannel = defineChannel({
  name: "chat",
  params: z.object({ roomId: z.string() }),
  access: {
    publish: async ({ user, params, cms }) => {
      const room = await cms.collections.rooms.findOne({
        where: { id: params.roomId },
      });
      return room?.members.includes(user.id) ?? false;
    },
    subscribe: async ({ user, params, cms }) => {
      const room = await cms.collections.rooms.findOne({
        where: { id: params.roomId },
      });
      return room?.members.includes(user.id) ?? false;
    },
  },
})
  .event("message", {
    schema: z.object({ text: z.string(), userId: z.string() }),
  })
  .event("typing", {
    schema: z.object({ userId: z.string(), isTyping: z.boolean() }),
  });
```

### 3. QCMS Builder Integration

Channels are configured via QCMS builder pattern:

```typescript
import { defineQCMS } from "@questpie/cms/server";
import { RedisPubSubAdapter } from "@questpie/cms/server";
import { cursorChannel, chatChannel } from "./channels";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

export const cms = defineQCMS({ name: "my-app" })
  .collections({
    /* ... */
  })
  .channels({
    cursor: cursorChannel,
    chat: chatChannel,
  })
  .build({
    app: { url: process.env.APP_URL },
    db: { url: process.env.DATABASE_URL },

    // Optional: Redis adapter (recommended for production)
    channelsAdapter: new RedisPubSubAdapter({ client: redis }),

    // If missing: auto-detects PostgreSQL NOTIFY from db connection
  });

// Auto-generated routes:
// POST /cms/channels/:channel/publish
// GET  /cms/channels/:channel/subscribe (SSE)
```

### 4. Client API

```typescript
import { createChannelsClient } from "@questpie/cms/client";
import type { cms } from "../server/cms";

const channels = createChannelsClient<typeof cms>({
  baseURL: "http://localhost:3000",
  headers: {
    Authorization: `Bearer ${getToken()}`,
  },
});

// Subscribe (type-safe event handlers)
const unsubscribe = channels.cursor.subscribe(
  { roomId: "room-123" }, // params (type-checked against channel definition)
  {
    move: (data) => {
      // data is type-safe: { userId: string; x: number; y: number }
      updateCursor(data.userId, data.x, data.y);
    },
    blur: (data) => {
      // data is type-safe: { userId: string }
      hideCursor(data.userId);
    },
  },
);

// Publish (type-safe params and data)
await channels.cursor.publish({ roomId: "room-123" }, "move", {
  userId: currentUser.id,
  x: 100,
  y: 200,
});

// Cleanup
unsubscribe();

// Manual debouncing (user-controlled)
let timeout: NodeJS.Timeout;
const publishCursor = (x: number, y: number) => {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    channels.cursor.publish({ roomId: "room-123" }, "move", {
      userId: currentUser.id,
      x,
      y,
    });
  }, 100); // User controls debounce duration
};
```

### 5. Server-Side Publish

Channels can be published from server-side code (queues, hooks, functions):

```typescript
// In a queue job
cms.queue["payment-processed"].work(async ({ data, cms }) => {
  await cms.channels.notifications.publish(
    "payment-success",
    {
      orderId: data.orderId,
      amount: data.amount,
    },
    { userId: data.userId },
  );
});

// In a collection hook
export const orders = defineCollection("orders")
  .fields({
    /* ... */
  })
  .hooks({
    afterChange: async ({ data, cms }) => {
      await cms.channels.orderUpdates.publish("status-changed", {
        orderId: data.id,
        status: data.status,
      });
    },
  });
```

---

## Distributor Adapters

Channels use a pluggable adapter interface for distributed pub/sub:

```typescript
// packages/cms/src/server/integrated/channels/adapter.ts

export interface ChannelsAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(
    channel: string,
    event: string,
    data: unknown,
    params?: Record<string, unknown>,
  ): Promise<void>;
  subscribe(channel: string, handler: ChannelEventHandler): () => void;
}

export type ChannelEventHandler = (event: ChannelEvent) => void;

export interface ChannelEvent {
  channel: string;
  event: string;
  data: unknown;
  params?: Record<string, unknown>;
  timestamp: number;
}
```

### 1. PostgreSQL NOTIFY (Default - Auto-detect)

**Pros:**

- ✅ No additional dependencies (reuses CMS database)
- ✅ Serverless compatible
- ✅ Auto-detected from `db` config
- ✅ Simple setup (zero config)

**Cons:**

- ⚠️ Payload size limit (~8KB)
- ⚠️ Single database dependency

**Config:**

```typescript
// Automatically used if no channelsAdapter specified
.build({
  db: { url: process.env.DATABASE_URL }
  // → Auto-detects PostgreSQL NOTIFY
})
```

**Implementation:** Reuses `PgNotifyAdapter` pattern from realtime system.

**Channel naming:** `qcms_channel:{channelName}`

### 2. Redis Pub/Sub (Recommended)

**Pros:**

- ✅ Higher throughput
- ✅ No payload size limits
- ✅ Dedicated messaging infrastructure
- ✅ Lower latency (~50-200ms vs ~100-500ms)

**Cons:**

- ⚠️ Requires Redis instance

**Config:**

```typescript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

.build({
  db: { url: process.env.DATABASE_URL },
  channelsAdapter: new RedisPubSubAdapter({ client: redis })
})
```

**Channel naming:** `qcms:channel:{channelName}`

### 3. In-Memory (Development)

**Pros:**

- ✅ Zero setup
- ✅ Fast for single-server development
- ✅ No external dependencies

**Cons:**

- ❌ Not distributed (single server only)
- ❌ No persistence across restarts

**Config:**

```typescript
.build({
  db: { url: process.env.DATABASE_URL },
  channelsAdapter: new MemoryChannelsAdapter()
})
```

**Use case:** Local development, testing

---

## Advanced Features

### Presence Tracking

Track who is currently subscribed to a channel:

**Server API:**

```typescript
const cursorChannel = defineChannel({
  name: "cursor",
  params: z.object({ roomId: z.string() }),
  presence: {
    enabled: true,
    userInfo: (user) => ({
      id: user.id,
      name: user.name,
      avatar: user.avatar,
    }),
  },
}).event("move", {
  /* ... */
});
```

**Client API:**

```typescript
// Get current presence
const users = await channels.cursor.getPresence({ roomId: "room-123" });
// { users: [{ id: 'u1', name: 'John', avatar: '...' }] }

// Subscribe to presence changes
channels.cursor.subscribePresence(
  { roomId: "room-123" },
  {
    join: (user) => console.log(`${user.name} joined`),
    leave: (user) => console.log(`${user.name} left`),
  },
);
```

**Implementation Notes:**

- Presence is tracked in-memory (resets on server restart)
- Optional: Use Redis for persistent presence (configure in adapter)
- Presence heartbeat: 30s keepalive (configurable)

---

## File Structure

```
packages/cms/src/
├── server/integrated/channels/
│   ├── builder/
│   │   ├── channel-builder.ts       # defineChannel() builder
│   │   ├── channel.ts               # Channel class
│   │   └── types.ts                 # Builder state, event config
│   ├── adapters/
│   │   ├── redis-pubsub.ts          # Redis Pub/Sub adapter
│   │   ├── pg-notify.ts             # PostgreSQL NOTIFY adapter
│   │   └── memory.ts                # In-memory adapter (dev)
│   ├── adapter.ts                   # ChannelsAdapter interface
│   ├── service.ts                   # ChannelsService (registry, pub/sub)
│   ├── routes.ts                    # HTTP routes (publish, subscribe SSE)
│   ├── presence.ts                  # Presence tracking
│   ├── types.ts                     # Core types (ChannelAccess, EventConfig)
│   └── index.ts                     # Public exports
│
├── client/
│   ├── channels.ts                  # createChannelsClient()
│   ├── presence.ts                  # Presence client helpers
│   └── index.ts                     # Exports
│
└── server/config/
    ├── qcms-builder.ts              # Add .channels() method
    └── builder-types.ts             # Add BuilderChannelsMap, channelsAdapter
```

---

## Implementation Phases

### Phase 1: Core MVP

1. ✅ Create `ChannelsAdapter` interface
2. ✅ Implement `PgNotifyChannelsAdapter` (reuse from realtime)
3. ✅ Implement `RedisPubSubAdapter`
4. ✅ Implement `MemoryChannelsAdapter`
5. ✅ Create `defineChannel()` builder
6. ✅ Add `.channels()` to `QCMSBuilder`
7. ✅ Add `channelsAdapter` to runtime config
8. ✅ Create `ChannelsService` (registry, pub/sub)
9. ✅ HTTP routes (POST publish, GET SSE subscribe)
10. ✅ Type-safe client (`createChannelsClient<typeof cms>()`)

### Phase 2: Presence

11. ✅ Presence tracking service
12. ✅ `getPresence()` API (server + client)
13. ✅ `subscribePresence()` client helper

### Phase 3: Integration & Polish

14. ✅ Better Auth integration (automatic session check)
15. ✅ Access control evaluation
16. ✅ Server-side publish API (`cms.channels.*.publish()`)
17. ✅ SSE keepalive implementation (30s default)
18. ✅ Error handling & logging

### Phase 4: Testing

19. Unit tests (builder, access rules, adapters)
20. Integration tests (multi-server distribution)
21. E2E tests (client ↔ server flow)

### Phase 5: Future Enhancements (Post-MVP)

- Rate limiting (global HTTP middleware)
- Metrics & monitoring (event throughput, latency)
- WebSocket transport (optional, for lower latency)
- Message batching (reduce SSE overhead)

---

## Configuration Reference

### Builder Types

```typescript
// packages/cms/src/server/config/builder-types.ts

export type BuilderChannelsMap = Record<string, Channel<any, any>>;

export interface QCMSBuilderState {
  name: string;
  collections: BuilderCollectionsMap;
  globals: BuilderGlobalsMap;
  jobs: BuilderJobsMap;
  emailTemplates: BuilderEmailTemplatesMap;
  functions: BuilderFunctionsMap;
  channels?: BuilderChannelsMap; // NEW
  auth: BetterAuthOptions;
  locale?: LocaleConfig;
  migrations?: Migration[];
}

export interface QCMSRuntimeConfig {
  app: { url: string };
  db: CMSDbConfig;
  secret?: string;
  storage?: StorageConfig;
  email?: Pick<MailerConfig, "adapter" | "defaults">;
  queue?: { adapter: QueueAdapter };
  search?: SearchConfig;
  realtime?: RealtimeConfig;
  logger?: LoggerConfig;
  kv?: KVConfig;
  migrations?: { directory?: string };

  // NEW: Channels adapter
  channelsAdapter?: ChannelsAdapter; // Auto-detects PG NOTIFY if missing
}
```

### QCMSBuilder Extension

````typescript
// packages/cms/src/server/config/qcms-builder.ts

class QCMSBuilder<TState extends QCMSBuilderState> {
  // ... existing methods

  /**
   * Define channels (as a map for type-safe access)
   *
   * @example
   * ```ts
   * .channels({
   *   cursor: cursorChannel,
   *   chat: chatChannel,
   * })
   * ```
   */
  channels<TNewChannels extends BuilderChannelsMap>(
    channels: TNewChannels,
  ): QCMSBuilder<
    Omit<TState, "channels"> & {
      channels: Omit<TState["channels"], keyof TNewChannels> & TNewChannels;
    }
  > {
    return new QCMSBuilder({
      ...this.state,
      channels: {
        ...this.state.channels,
        ...channels,
      },
    } as any);
  }
}
````

---

## Security Considerations

### 1. Access Control Enforcement

- **Subscribe**: Auth check on SSE connection establishment
- **Publish**: Auth check on every POST request
- **Params validation**: Ensure `params` match Zod schema
- **Data validation**: All event payloads validated against Zod schema

### 2. Authentication

- **Better Auth integration**: Automatic session resolution
- **No custom auth logic**: Reuses existing CMS auth
- **Token-based**: Supports `Authorization` header for client requests

### 3. Rate Limiting

**Status:** Future enhancement (Phase 5)

**Planned approach:** Global HTTP middleware (not channel-specific)

**Rationale:** Simplicity first - rate limiting applies to all HTTP requests, not just channels

### 4. CORS & Headers

- Respects CMS CORS configuration
- Supports custom headers (e.g., `Authorization`)

---

## Performance Considerations

### SSE Keepalive

- **Interval**: 30 seconds (default)
- **Purpose**: Prevent connection timeout, detect dead clients
- **Format**: `:keepalive\n\n` (SSE comment)

### Event Size Limits

- **PostgreSQL NOTIFY**: ~8KB payload limit
- **Redis Pub/Sub**: No hard limit (practical limit ~512KB)
- **Recommendation**: Keep events small (<1KB), use IDs + fetch pattern for large data

### Latency

| Adapter           | Typical Latency | Use Case                 |
| ----------------- | --------------- | ------------------------ |
| PostgreSQL NOTIFY | 100-500ms       | Development, serverless  |
| Redis Pub/Sub     | 50-200ms        | Production, high-traffic |
| In-Memory         | 10-50ms         | Single-server, dev       |

### Connection Limits

- **Browser limit**: ~6 SSE connections per domain
- **Mitigation**: Use subdomains or multiplex channels over single connection (future)

---

## Testing Strategy

### 1. Unit Tests

- `defineChannel()` builder type inference
- Access control rule evaluation
- Event schema validation (Zod)
- Adapter interface compliance

### 2. Integration Tests

- Publish → Adapter → Subscribe flow
- Multi-server distribution (Redis/PG NOTIFY)
- SSE reconnection handling
- Presence tracking accuracy

### 3. E2E Tests

- Client publish → Server → Client subscribe
- Access control enforcement (deny/allow)
- Parametric channel isolation

### 4. Performance Tests

- Throughput (events/second per server)
- Latency (publish → receive time)
- Memory usage (concurrent connections)
- SSE keepalive behavior

---

## Migration Path

For existing apps using custom WebSocket solutions:

1. **Define channels** using `defineChannel()`
2. **Configure adapter** (Redis/PostgreSQL auto-detect)
3. **Replace WebSocket client** with `createChannelsClient()`
4. **Migrate auth** to CMS Better Auth access rules
5. **Test presence tracking** (if needed)
6. **Remove custom WebSocket server** (replaced by SSE + adapter)

---

## Open Questions & Future Work

### 1. Rate Limiting

**Status:** Deferred to Phase 5

**Approach:** Global HTTP middleware (not channel-specific)

**Rationale:** Simplicity first - evaluate need based on real-world usage

### 2. Channel Naming Validation

**Proposal:** Restrict to alphanumeric + `-_` (prevent injection)

**Implementation:** Add validation in `defineChannel()`

### 3. Params Size Limit

**Proposal:** Max 1KB for `params` object (prevent abuse)

**Rationale:** Params are included in every SSE connection URL

### 4. Presence Storage

**Default:** In-memory (resets on restart)

**Optional:** Redis-backed presence (persistent across restarts)

**Decision:** Start with in-memory, add Redis option in Phase 2

### 5. SSE vs WebSocket

**Current:** SSE only (serverless compatible)

**Future:** Optional WebSocket transport for lower latency

**Consideration:** Requires stateful server, more complex deployment

---

## FAQ

**Q: Should I use Channels or Realtime?**
A: **Realtime** for DB changes (auto-refresh UI), **Channels** for ephemeral events (cursor, typing, presence).

**Q: Can I persist channel events to database?**
A: No. Channels are ephemeral-only. If you need persistence, use **Realtime** (which logs to `questpie_realtime_log`).

**Q: Why no `onPublish` handlers?**
A: Simplicity first. Channels are pure broadcast. Use collection hooks or queue jobs for server-side processing.

**Q: Can I use WebSockets instead of SSE?**
A: Currently SSE-only for serverless compatibility. WebSocket support may be added as optional transport in future.

**Q: How do I scale channels across multiple servers?**
A: Use Redis Pub/Sub or PostgreSQL NOTIFY adapter. All servers subscribe to same distributor.

**Q: What's latency?**
A: ~100-500ms with PostgreSQL NOTIFY, ~50-200ms with Redis Pub/Sub, ~10-50ms with in-memory (single server).

**Q: Can I broadcast to all users globally?**
A: Yes, define a channel without `params`. All subscribers receive all events on that channel.

**Q: How do I debug SSE connections?**
A: Browser DevTools → Network → EventStream filter. Look for `GET /cms/channels/:channel/subscribe`.

**Q: What happens if Redis/PostgreSQL goes down?**
A: Channels stop working. SSE connections remain open but no events are delivered. Consider adding health checks.

---

## Examples

See `examples/tanstack-barbershop/` for complete implementation:

- Cursor tracking in collaborative booking calendar
- Presence indicators for active barbers
- Real-time slot availability updates

---

## References

- [SSE Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Redis Pub/Sub](https://redis.io/docs/manual/pubsub/)
- [PostgreSQL NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)
- [Zod Schema Validation](https://zod.dev/)
- [Better Auth](https://www.better-auth.com/)

---

## Summary

The Channels system provides a **type-safe, ephemeral, real-time communication layer** for QUESTPIE CMS:

- ✅ **Simple API**: `defineChannel()` builder, similar to collections
- ✅ **Type-safe**: Full TypeScript inference (server + client)
- ✅ **Flexible**: Pluggable adapters (PostgreSQL NOTIFY, Redis, in-memory)
- ✅ **Serverless-friendly**: SSE transport, auto-detect adapter
- ✅ **Secure**: Better Auth integration, access control
- ✅ **Presence**: Built-in tracking for "who's online"
- ❌ **No persistence**: Ephemeral only (use Realtime for DB sync)
- ❌ **No onPublish**: Pure broadcast (simplicity first)

**Default setup:** Zero config - auto-detects PostgreSQL NOTIFY from database connection.

**Recommended production:** Redis Pub/Sub for lower latency and higher throughput.
