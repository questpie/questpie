# Decoupled Architecture: QuestPie vs Payload

## The Problem with Payload's Approach

Payload tightly couples UI config to backend schema:

```typescript
// Payload: UI config mixed into schema definition
{
  slug: 'posts',
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      // UI config in schema 👎
      admin: {
        position: 'sidebar',
        description: 'Post title',
        placeholder: 'Enter title...'
      }
    }
  ]
}
```

**Problems:**
1. **UI changes require backend modifications** - changing a label means touching backend code
2. **No schema reuse across UIs** - same backend forces same UI config
3. **Harder for AI agents** - UI and data model mixed, risky to modify
4. **Framework lock-in** - tied to Next.js, can't use different UI frameworks
5. **Type system complexity** - custom field types instead of native Drizzle

---

## QuestPie's Decoupled Approach

QuestPie cleanly separates concerns:

```typescript
// Backend: pure data model (Drizzle ORM)
export const posts = defineCollection('posts').fields({
  title: varchar('title', { length: 255 }).notNull(),  // Just data definition
})

// Frontend: separate admin config (optional)
export const adminConfig = defineAdminConfig({
  collections: {
    posts: {
      fields: {
        title: {
          label: 'Post Title',  // UI-only config
          description: 'The title of your blog post',
          placeholder: 'Enter title...'
        }
      }
    }
  }
})
```

---

## Benefits

1. **Backend stays stable** - data model doesn't change when tweaking UI
2. **Multiple frontends** - use same backend with different admin UIs (mobile app, web admin, CLI tools)
3. **AI-safe** - agents can modify UI config without touching data model
4. **Framework-agnostic** - admin UI is React-based but backend works with Elysia, Hono, Next.js, TanStack Start
5. **Agency-friendly** - rebrand admin UI per client without duplicating backend logic
6. **Native tools** - use Drizzle ORM directly, not custom abstractions

---

This section should be inserted into LANDING_PAGE.md after the comparison table, expanding the **vs Payload** bullet point.
