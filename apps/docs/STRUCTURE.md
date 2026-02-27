# Documentation Structure

Proposed clean structure for QUESTPIE documentation.

## Directory Layout

```
apps/docs/
├── content/
│   ├── index.mdx                      # Homepage
│   │
│   ├── getting-started/
│   │   ├── index.mdx                  # Quick start
│   │   ├── installation.mdx
│   │   ├── your-first-app.mdx
│   │   └── folder-structure.mdx
│   │
│   ├── core-concepts/
│   │   ├── index.mdx
│   │   ├── builder-pattern.mdx
│   │   ├── collections.mdx
│   │   ├── globals.mdx
│   │   ├── fields.mdx
│   │   ├── validation.mdx
│   │   ├── hooks.mdx
│   │   ├── jobs.mdx
│   │   └── auth.mdx
│   │
│   ├── backend/                       # questpie package docs
│   │   ├── index.mdx
│   │   ├── builder-api/
│   │   │   ├── q-builder.mdx          # Main q() builder
│   │   │   ├── collections.mdx
│   │   │   ├── globals.mdx
│   │   │   ├── jobs.mdx
│   │   │   └── auth.mdx
│   │   ├── field-types/
│   │   │   ├── index.mdx
│   │   │   ├── text.mdx
│   │   │   ├── number.mdx
│   │   │   ├── relations.mdx
│   │   │   └── custom-fields.mdx
│   │   ├── validation/
│   │   │   ├── index.mdx
│   │   │   ├── zod-schemas.mdx
│   │   │   └── custom-validation.mdx
│   │   ├── hooks/
│   │   │   ├── index.mdx
│   │   │   ├── lifecycle-hooks.mdx
│   │   │   └── examples.mdx
│   │   ├── jobs/
│   │   │   ├── index.mdx
│   │   │   ├── defining-jobs.mdx
│   │   │   └── scheduling.mdx
│   │   └── migrations/
│   │       ├── index.mdx
│   │       └── running-migrations.mdx
│   │
│   ├── admin/                         # @questpie/admin package docs
│   │   ├── index.mdx                  # Admin overview
│   │   │
│   │   ├── getting-started/
│   │   │   ├── index.mdx
│   │   │   ├── setup.mdx
│   │   │   ├── first-collection.mdx
│   │   │   └── folder-structure.mdx
│   │   │
│   │   ├── builder-api/
│   │   │   ├── index.mdx              # qa() builder overview
│   │   │   ├── qa-builder.mdx         # Main qa() builder
│   │   │   ├── qa-from.mdx            # qa.from() scoped helpers
│   │   │   ├── collections.mdx
│   │   │   ├── globals.mdx
│   │   │   ├── sidebar.mdx
│   │   │   └── dashboard.mdx
│   │   │
│   │   ├── extensibility/              # ⭐ KEY FEATURE!
│   │   │   ├── index.mdx               # Overview of extensibility
│   │   │   ├── core-module.mdx         # Using adminModule
│   │   │   ├── custom-fields/
│   │   │   │   ├── index.mdx
│   │   │   │   ├── creating-fields.mdx
│   │   │   │   ├── field-options.mdx
│   │   │   │   ├── cell-components.mdx
│   │   │   │   └── examples.mdx
│   │   │   ├── custom-views/
│   │   │   │   ├── index.mdx
│   │   │   │   ├── list-views.mdx
│   │   │   │   ├── edit-views.mdx
│   │   │   │   └── examples.mdx
│   │   │   ├── custom-widgets/
│   │   │   │   ├── index.mdx
│   │   │   │   ├── creating-widgets.mdx
│   │   │   │   └── examples.mdx
│   │   │   ├── custom-pages/
│   │   │   │   ├── index.mdx
│   │   │   │   └── examples.mdx
│   │   │   └── building-modules.mdx    # Creating reusable modules
│   │   │
│   │   ├── field-types/
│   │   │   ├── index.mdx               # Built-in fields overview
│   │   │   ├── text.mdx
│   │   │   ├── number.mdx
│   │   │   ├── select.mdx
│   │   │   ├── relation.mdx
│   │   │   ├── json.mdx
│   │   │   └── all-fields.mdx          # Complete reference
│   │   │
│   │   ├── views/
│   │   │   ├── index.mdx               # Built-in views
│   │   │   ├── table-view.mdx
│   │   │   ├── form-view.mdx
│   │   │   └── custom-views.mdx
│   │   │
│   │   ├── components/
│   │   │   ├── index.mdx
│   │   │   ├── fields/
│   │   │   │   ├── text-field.mdx
│   │   │   │   ├── number-field.mdx
│   │   │   │   └── ...
│   │   │   ├── navigation/
│   │   │   │   ├── admin-link.mdx
│   │   │   │   └── sidebar.mdx
│   │   │   └── layout/
│   │   │       └── dashboard.mdx
│   │   │
│   │   ├── hooks/
│   │   │   ├── index.mdx
│   │   │   ├── use-collection.mdx
│   │   │   ├── use-admin-routes.mdx
│   │   │   └── custom-hooks.mdx
│   │   │
│   │   ├── type-safety/
│   │   │   ├── index.mdx
│   │   │   ├── type-helpers.mdx        # CollectionNames, etc.
│   │   │   ├── typed-helpers.mdx       # createAdminHelpers()
│   │   │   └── proxy-pattern.mdx       # ({ r }), ({ v, f })
│   │   │
│   │   └── patterns/
│   │       ├── index.mdx
│   │       ├── no-build-method.mdx     # Why no .build()
│   │       ├── scoped-helpers.mdx      # qa.from() pattern
│   │       ├── icon-components.mdx     # Icons as components
│   │       └── best-practices.mdx
│   │
│   ├── adapters/
│   │   ├── index.mdx
│   │   ├── elysia.mdx
│   │   ├── hono.mdx
│   │   ├── nextjs.mdx
│   │   └── custom-adapter.mdx
│   │
│   ├── recipes/
│   │   ├── index.mdx
│   │   ├── multi-tenant.mdx
│   │   ├── i18n.mdx
│   │   ├── file-uploads.mdx
│   │   ├── custom-auth.mdx
│   │   ├── custom-dashboard.mdx
│   │   └── extending-admin.mdx
│   │
│   ├── examples/
│   │   ├── index.mdx
│   │   ├── blog.mdx
│   │   ├── ecommerce.mdx
│   │   ├── barbershop.mdx
│   │   └── complete-apps.mdx
│   │
│   ├── api-reference/
│   │   ├── backend/
│   │   │   ├── q-builder.mdx
│   │   │   ├── collection-builder.mdx
│   │   │   ├── global-builder.mdx
│   │   │   └── ...
│   │   └── admin/
│   │       ├── qa-builder.mdx
│   │       ├── collection-builder.mdx
│   │       ├── field-builder.mdx
│   │       ├── view-builder.mdx
│   │       └── ...
│   │
│   └── guides/
│       ├── deployment.mdx
│       ├── testing.mdx
│       ├── performance.mdx
│       └── troubleshooting.mdx
│
└── public/
    └── examples/                      # Code examples
        ├── backend/
        │   ├── basic-collection.ts
        │   ├── relations.ts
        │   └── ...
        └── admin/
            ├── basic-config.ts
            ├── custom-field.tsx
            ├── custom-view.tsx
            └── ...
```

## Key Sections

### 1. Admin Extensibility ⭐

**Most Important!** This is our USP - showcase extensibility heavily.

**Structure:**

```
admin/extensibility/
├── index.mdx                   # Why extensibility matters
├── core-module.mdx             # Starting point
├── custom-fields/              # Deep dive on custom fields
├── custom-views/               # Deep dive on custom views
├── custom-widgets/             # Deep dive on widgets
├── custom-pages/               # Custom admin pages
└── building-modules.mdx        # Creating reusable modules
```

**Content Focus:**

- Show how easy it is to extend
- Real-world examples
- Before/after comparisons
- Module composition patterns

### 2. Builder API

Clear separation between backend and admin:

**Backend (`backend/builder-api/`):**

- `q()` builder
- Collections, Globals, Jobs, Auth
- **HAS `.build()` method** (runtime instance)

**Admin (`admin/builder-api/`):**

- `qa()` builder
- `qa.from()` scoped helpers
- Collections, Sidebar, Dashboard
- **NO `.build()` method** (state IS config)

### 3. Type Safety

Dedicated section showing TypeScript superpowers:

```
admin/type-safety/
├── type-helpers.mdx         # CollectionNames, GlobalNames
├── typed-helpers.mdx        # createAdminHelpers()
└── proxy-pattern.mdx        # ({ r }), ({ v, f })
```

### 4. Patterns

Document the "why" behind design decisions:

```
admin/patterns/
├── no-build-method.mdx      # Why admin has no .build()
├── scoped-helpers.mdx       # Why qa.from() exists
├── icon-components.mdx      # Why components not strings
└── best-practices.mdx       # Recommended patterns
```

## Content Strategy

### Homepage

- Hero: "Build Extensible Admin UIs"
- Quick start in 3 steps
- Feature highlights (extensibility focus)
- Example showcase

### Getting Started

- Installation
- First QuestPie in 5 minutes
- Folder structure explanation
- Next steps

### Extensibility (Main Focus)

- Multiple detailed guides
- Live examples
- Video tutorials
- Module marketplace (future)

### API Reference

- Auto-generated from TSDoc
- Interactive playground
- Live examples
- TypeScript signatures

## Writing Guidelines

### Code Examples

Always show:

1. **Backend first** (q builder)
2. **Admin second** (qa builder)
3. **Complete example** (full file)
4. **Result** (screenshot/video)

### Callouts

Use for:

- ⚠️ Common pitfalls
- 💡 Pro tips
- 🎯 Best practices
- 📖 Related docs

### Interactive Elements

- Live code playground
- Try it yourself sections
- Before/after comparisons
- Video walkthroughs

## Navigation Structure

```
Sidebar:
├── 🏠 Home
├── 🚀 Getting Started
├── 📚 Core Concepts
├── 🔧 Backend
│   ├── Builder API
│   ├── Field Types
│   ├── Validation
│   ├── Hooks
│   ├── Jobs
│   └── Migrations
├── 🎨 Admin UI
│   ├── Getting Started
│   ├── Builder API
│   ├── ⭐ Extensibility     # Highlighted!
│   │   ├── Custom Fields
│   │   ├── Custom Views
│   │   ├── Custom Widgets
│   │   ├── Custom Pages
│   │   └── Building Modules
│   ├── Field Types
│   ├── Views
│   ├── Components
│   ├── Hooks
│   ├── Type Safety
│   └── Patterns
├── 🔌 Adapters
├── 📖 Recipes
├── 💡 Examples
├── 📘 API Reference
└── 🛠️ Guides
```

## Priority Order

1. **Admin Extensibility** - Core value prop
2. **Getting Started** - Quick wins
3. **Builder API** - Complete reference
4. **Examples** - Real-world use cases
5. **API Reference** - Deep dive

## Next Steps

1. Set up Fumadocs structure
2. Write extensibility guides first
3. Create interactive examples
4. Add video tutorials
5. Build example modules
