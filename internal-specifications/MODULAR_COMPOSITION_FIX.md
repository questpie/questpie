# Fix for Section 6: Modular Composition

**Replace the current Section 6 with this corrected version:**

---

### 6. Modular Composition (Distribute via npm)

**Create reusable modules (without .build()):**

```typescript
// @my-org/blog-module/index.ts
import { defineCollection, defineQCMS, defineJob } from '@questpie/cms/server'
import { varchar, text, timestamp, boolean } from 'drizzle-orm/pg-core'
import { z } from 'zod'

const posts = defineCollection('posts').fields({
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content'),
  publishedAt: timestamp('published_at', { mode: 'date' }),
  isPublished: boolean('is_published').default(false).notNull(),
})

const comments = defineCollection('comments').fields({
  postId: varchar('post_id', { length: 255 }).notNull(),
  content: text('content').notNull(),
})

const publishPost = defineJob({
  name: 'publish-post',
  schema: z.object({ postId: z.string() }),
  handler: async (payload) => {
    // Publish logic
  }
})

// Export module WITHOUT .build() - no runtime config
export const blogModule = defineQCMS({ name: 'blog-module' })
  .collections({ posts, comments })
  .jobs({ publishPost })
  // NO .build() here! Modules are composable building blocks
```

**Compose modules in your main app:**

```typescript
import { defineQCMS } from '@questpie/cms/server'
import { blogModule } from '@my-org/blog-module'
import { ecommerceModule } from '@my-org/ecommerce-module'

// Use .use() to merge entire modules
export const cms = defineQCMS({ name: 'my-shop' })
  .use(blogModule)       // Merge blog collections + jobs
  .use(ecommerceModule)  // Merge ecommerce collections + jobs
  .collections({
    // Add your own collections
    reviews: defineCollection('reviews').fields({ /* ... */ })
  })
  .build({  // Only main app has .build() with runtime config
    db: { url: process.env.DATABASE_URL },
    email: { adapter: smtpAdapter },
    queue: { adapter: pgBossAdapter },
  })

// Type-safe access to all merged collections
const { docs: posts } = await cms.collections.posts.find()  // from blogModule
const { docs: products } = await cms.collections.products.find()  // from ecommerceModule
const { docs: reviews } = await cms.collections.reviews.find()  // your own
```

**Extend module collections with .merge():**

```typescript
import { blogModule } from '@my-org/blog-module'
import { defineCollection, defineQCMS } from '@questpie/cms/server'
import { boolean, integer } from 'drizzle-orm/pg-core'

export const cms = defineQCMS({ name: 'my-shop' })
  .use(blogModule)
  .collections({
    // Override posts collection with additional fields
    posts: blogModule.state.collections.posts.merge(
      defineCollection('posts').fields({
        featured: boolean('featured').default(false),
        viewCount: integer('view_count').default(0),
      })
    )
  })
  .build({ /* ... */ })

// Now posts collection has: title, content, publishedAt, isPublished, featured, viewCount
```

**What this gives you:**
- **Distribute via npm**: Modules are just TypeScript packages, publish anywhere
- **Composable building blocks**: Use `.use()` to merge collections, jobs, globals, auth config
- **Type-safe composition**: Full TypeScript inference across merged modules
- **Extensible**: Use `.merge()` to extend module collections with additional fields, hooks, access rules
- **Reusable logic**: Perfect for agencies building similar apps for multiple clients
- **No runtime coupling**: Modules define schema, main app provides runtime config (.build())

---

**Key points:**
1. Modules use `defineQCMS()` WITHOUT `.build()`
2. Modules export the builder instance, not collections directly
3. Main app uses `.use(module)` to merge
4. Main app calls `.build()` with runtime config
5. Use `module.state.collections.collectionName.merge()` to extend collections
