# Migration Guide

## v3: `app.api` removed (BREAKING)

The `app.api` proxy has been removed. Collection and global APIs are now
direct getters on the `Questpie` instance.

### Before (v2)

```ts
app.api.collections.posts.findMany({ ... })
app.api.globals.settings.findFirst({ ... })
```

### After (v3)

```ts
app.collections.posts.findMany({ ... })
app.globals.settings.findFirst({ ... })
```

### Migration

Find-and-replace across your codebase and tests:

- `app.api.collections` -> `app.collections`
- `app.api.globals` -> `app.globals`
