# Multi-Tenant & Scoped Data Specification

This document describes the architecture for building multi-tenant applications with Questpie CMS, including scoped globals and tenant-aware data filtering.

## Overview

Multi-tenant applications need to:
1. Identify the current tenant/scope from request context
2. Filter data based on the selected scope
3. Provide UI for scope selection in the admin panel

Questpie supports this through:
- **Context Extension** - Add custom context like `tenantId` or `propertyId`
- **Scoped Globals** - Per-scope settings (each tenant has their own instance)
- **Scope Primitives** - React components for scope selection in admin UI

## Architecture

```
                                 +-----------------+
                                 |   HTTP Request  |
                                 |  (with header)  |
                                 +--------+--------+
                                          |
                    +---------------------v----------------------+
                    |           Context Extension               |
                    |  q.context(({ request }) => ({            |
                    |    propertyId: request.headers.get(...)   |
                    |  }))                                       |
                    +---------------------+----------------------+
                                          |
         +--------------------------------+--------------------------------+
         |                                |                                |
         v                                v                                v
+--------+--------+            +----------+----------+         +-----------+-----------+
|   Collections   |            |   Scoped Globals    |         |    Custom Logic       |
|   (use access)   |            |   scope_id column   |         |    ctx.propertyId     |
+-----------------+            +---------------------+         +-----------------------+
```

## Backend Implementation

### 1. Context Extension

The `.context()` method on `QuestpieBuilder` allows adding custom properties to the request context:

```ts
// src/cms/builder.ts
import { q, adminModule } from "questpie";

export const qb = q
  .use(adminModule)
  .context(async ({ request, session, db }) => {
    // Extract scope from header (set by frontend)
    const propertyId = request.headers.get("x-selected-property");
    
    // Optional: Validate user has access to this property
    if (propertyId && session?.user) {
      const hasAccess = await db.query.propertyMembers.findFirst({
        where: and(
          eq(propertyMembers.userId, session.user.id),
          eq(propertyMembers.propertyId, propertyId)
        )
      });
      if (!hasAccess) {
        throw new Error("Access denied to property");
      }
    }
    
    return { propertyId };
  });
```

The context extension is:
- **Type-safe**: Extended context is available with full TypeScript inference
- **Async**: Can perform database lookups for validation
- **Secure**: Runs server-side with access to session and database

### 2. Scoped Globals

Globals can be scoped to have separate instances per tenant:

```ts
// src/cms/globals/property-settings.ts
const propertySettings = qb
  .global("property_settings")
  .options({
    // Enable scoping - each property gets its own settings
    scoped: (ctx) => ctx.propertyId,
  })
  .fields((f) => ({
    timezone: f.text({ required: true, defaultValue: "UTC" }),
    currency: f.text({ required: true, defaultValue: "USD" }),
    notificationEmail: f.text(),
    bookingLeadTime: f.number({ defaultValue: 24 }),
  }));
```

How scoped globals work:
- Adds a `scope_id` column to the global's table
- Creates a unique index on `(id, scope_id)` to prevent duplicates
- Automatically filters queries by the current scope
- Falls back to `null` scope for global/default settings

### 3. Scoped Collections (via Hooks)

Collections can be scoped using hooks:

```ts
// src/cms/collections/bookings.ts
const bookings = qb
  .collection("bookings")
  .fields((f) => ({
    propertyId: f.text({ required: true }),
    // ... other fields
  }))
  .access({
    // Filter reads by property
    read: async ({ ctx }) => {
      if (ctx.propertyId) {
        return {
          propertyId: { eq: ctx.propertyId }
        };
      }
      return query;
    },
  }).hooks({
    // Auto-assign property on create
    beforeCreate: async ({ ctx, data }) => {
      if (ctx.propertyId) {
        return { ...data, propertyId: ctx.propertyId };
      }
      return data;
    },
  });
```

## Frontend Implementation

### 1. ScopeProvider

Wrap your admin app with `ScopeProvider` to enable scope selection:

```tsx
// src/app/admin/layout.tsx
import { ScopeProvider } from "@questpie/admin/client";

export default function AdminLayout({ children }) {
  return (
    <ScopeProvider
      headerName="x-selected-property"  // Header to send with requests
      storageKey="admin-property"        // localStorage key for persistence
      defaultScope={null}                // null = show all / global
    >
      {children}
    </ScopeProvider>
  );
}
```

### 2. Create Scoped Client

Use `useScopedFetch` to create a client that automatically includes the scope header:

```tsx
// src/app/admin/client.tsx
import { useScopedFetch, AdminProvider } from "@questpie/admin/client";
import { createClient } from "questpie/client";
import type { cms } from "@/cms";

export function AdminWithScopedClient({ children }) {
  const scopedFetch = useScopedFetch();
  
  const client = useMemo(
    () => createClient<typeof cms>({
      baseURL: "/api",
      fetch: scopedFetch, // Injects x-selected-property header
    }),
    [scopedFetch]
  );
  
  return (
    <AdminProvider client={client} {...otherProps}>
      {children}
    </AdminProvider>
  );
}
```

### 3. Scope Picker in Sidebar

Add a `ScopePicker` to the sidebar using the `afterBrand` slot:

```tsx
// src/app/admin/layout.tsx
import { AdminLayout, ScopePicker } from "@questpie/admin/client";

export default function Layout({ children }) {
  return (
    <AdminLayout
      sidebarProps={{
        afterBrand: (
          <ScopePicker
            collection="properties"    // Fetch options from this collection
            labelField="name"           // Field to use as label
            valueField="id"             // Field to use as value
            placeholder="All Properties"
            allowClear                  // Allow selecting "All"
            clearText="All Properties"
          />
        ),
      }}
      {...otherProps}
    >
      {children}
    </AdminLayout>
  );
}
```

### 4. ScopePicker Options

The `ScopePicker` supports three ways to provide options:

```tsx
// 1. From a collection (most common)
<ScopePicker
  collection="properties"
  labelField="name"
  valueField="id"
/>

// 2. Static options
<ScopePicker
  options={[
    { value: "org_1", label: "Organization 1" },
    { value: "org_2", label: "Organization 2" },
  ]}
/>

// 3. Async loader
<ScopePicker
  loadOptions={async () => {
    const response = await fetch("/api/my-scopes");
    return response.json();
  }}
/>
```

### 5. Accessing Scope in Components

Use the `useScope` hook to access the current scope:

```tsx
import { useScope } from "@questpie/admin/client";

function MyComponent() {
  const { scopeId, setScope, clearScope, isLoading } = useScope();
  
  if (isLoading) return <Skeleton />;
  
  return (
    <div>
      Current property: {scopeId ?? "All"}
      <button onClick={() => setScope("prop_123")}>
        Switch to Property 123
      </button>
      <button onClick={clearScope}>
        View All
      </button>
    </div>
  );
}
```

## Sidebar Slots

`AdminSidebar` provides two slots for custom content:

### `afterBrand`
Content rendered after the brand header. Perfect for scope pickers.
- Only visible when sidebar is expanded (not collapsed)
- Has consistent padding with the sidebar

### `beforeFooter`
Content rendered before the user footer. Useful for:
- Help/support links
- Quick actions
- Status indicators

```tsx
<AdminSidebar
  afterBrand={<ScopePicker collection="properties" />}
  beforeFooter={
    <Button variant="ghost" className="w-full justify-start gap-2">
      <Icon icon="ph:question" />
      Need Help?
    </Button>
  }
/>
```

## Database Schema

### Scoped Global Table

When using `scoped` option, the global's table includes:

```sql
CREATE TABLE property_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  scope_id TEXT,              -- Added by scoped option
  timezone TEXT NOT NULL DEFAULT 'UTC',
  currency TEXT NOT NULL DEFAULT 'USD',
  -- ... other fields
  UNIQUE(id, scope_id)        -- Prevents duplicate scoped instances
);
```

### Query Pattern

```sql
-- Get settings for specific property
SELECT * FROM property_settings 
WHERE scope_id = 'prop_123';

-- Get global/default settings (when no scope)
SELECT * FROM property_settings 
WHERE scope_id IS NULL;
```

## Type Safety

The context extension provides full type inference:

```ts
// Context type is inferred
type ExtendedContext = {
  request: Request;
  session: Session | null;
  db: Database;
  user: User | null;
  propertyId: string | null;  // <-- Added by .context()
};

// Available in all hooks and handlers
hooks: {
  beforeCreate: async ({ ctx }) => {
    ctx.propertyId // string | null - fully typed!
  }
}
```

## Security Considerations

1. **Validate Access**: Always validate that the user has access to the requested scope
2. **Don't Trust Headers**: The scope header can be manipulated - validate server-side
3. **Audit Scope Changes**: Consider logging when users switch scopes
4. **Default to Restrictive**: If no scope is selected, consider showing no data rather than all data

## Example: Barbershop Multi-Property Setup

```ts
// cms/builder.ts
export const qb = q
  .use(adminModule)
  .context(async ({ request, session, db }) => {
    const propertyId = request.headers.get("x-selected-property");
    
    // Validate property access
    if (propertyId && session?.user) {
      const membership = await db.query.propertyStaff.findFirst({
        where: and(
          eq(propertyStaff.userId, session.user.id),
          eq(propertyStaff.propertyId, propertyId)
        )
      });
      
      if (!membership) {
        throw new HTTPException(403, { 
          message: "You don't have access to this property" 
        });
      }
    }
    
    return { propertyId };
  });

// cms/globals/property-settings.ts
export const propertySettings = qb
  .global("property_settings")
  .options({ scoped: (ctx) => ctx.propertyId })
  .fields((f) => ({
    businessName: f.text({ required: true }),
    timezone: f.text({ defaultValue: "America/New_York" }),
    openingHours: f.json(),
  }));

// cms/collections/appointments.ts
export const appointments = qb
  .collection("appointments")
  .fields((f) => ({
    propertyId: f.text({ required: true }),
    clientId: f.relation({ to: "clients" }),
    serviceId: f.relation({ to: "services" }),
    staffId: f.relation({ to: "staff" }),
    startsAt: f.datetime({ required: true }),
    endsAt: f.datetime({ required: true }),
    status: f.select({
      options: ["scheduled", "confirmed", "completed", "cancelled"],
      defaultValue: "scheduled",
    }),
  }))
  .hooks({
    beforeRead: async ({ ctx, query }) => {
      if (ctx.propertyId) {
        return {
          ...query,
          where: and(query.where, eq(schema.appointments.propertyId, ctx.propertyId)),
        };
      }
      return query;
    },
    beforeCreate: async ({ ctx, data }) => ({
      ...data,
      propertyId: ctx.propertyId ?? data.propertyId,
    }),
  });
```

## API Reference

### Backend

| Method/Option                | Description                                   |
| ---------------------------- | --------------------------------------------- |
| `q.context(resolver)`        | Extend request context with custom properties |
| `global.options({ scoped })` | Make global instances per-scope               |

### Frontend

| Export                | Description                                     |
| --------------------- | ----------------------------------------------- |
| `ScopeProvider`       | Context provider for scope selection            |
| `useScope()`          | Access current scope and setters                |
| `useScopeSafe()`      | Like useScope but returns null outside provider |
| `useScopedFetch()`    | Get fetch function that injects scope header    |
| `createScopedFetch()` | Create scoped fetch outside React               |
| `ScopePicker`         | Dropdown component for scope selection          |

### Sidebar Props

| Prop           | Description                                   |
| -------------- | --------------------------------------------- |
| `afterBrand`   | Content after brand header (for scope picker) |
| `beforeFooter` | Content before user footer                    |
