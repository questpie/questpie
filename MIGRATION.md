# QuestPie v3 Migration Guide

## Breaking Changes

### `app.api` namespace removed (QUE-262)

The `app.api.collections.*` and `app.api.globals.*` accessors have been removed.
Use the top-level accessors directly:

```diff
- const posts = await app.api.collections.posts.find({ limit: 10 });
+ const posts = await app.collections.posts.find({ limit: 10 });

- const settings = await app.api.globals.settings.get();
+ const settings = await app.globals.settings.get();
```

**What changed:** The `app.api` proxy was an unnecessary indirection layer. All
collection and global operations are now available directly on the `app` instance
via `app.collections` and `app.globals`.

**Migration:** Find-and-replace `app.api.collections.` with `app.collections.`
and `app.api.globals.` with `app.globals.` across your codebase.
