# Migration Guide

## 3.6: system timestamps become `timestamp(3)` (one-time table rewrite)

System timestamp columns (`created_at`, `updated_at`, `deleted_at`,
`version_created_at`, and the internal search/realtime tables) are now
declared with millisecond precision — `timestamp(3)` instead of the Postgres
default `timestamp` (microseconds).

**Why:** JS `Date` has millisecond resolution. With microsecond storage, a
`Date` read through the API was silently *less* than the stored value, so
equality and keyset-cursor comparisons on round-tripped timestamps
(`eq`/`lt`/`gt` with a previously returned `createdAt`) skipped or duplicated
rows. With `timestamp(3)`, a `Date` you read is exactly the value stored.

**What happens on upgrade:** the next `questpie generate` (or `questpie push`)
emits one `ALTER TABLE … ALTER COLUMN … TYPE timestamp(3)` per system
timestamp column. This is a one-time table rewrite:

- Existing microsecond values are **rounded** to milliseconds by Postgres
  (this is the new contract — it also repairs historical rows so cursors over
  old data behave).
- On very large tables, run the migration during a maintenance window (the
  rewrite takes an exclusive lock for its duration).
- No data is lost beyond sub-millisecond digits that were never readable
  through the API.

Apps that genuinely need microsecond precision should declare their own field
with `f.datetime({ precision: 6 })` — the contract change applies only to the
framework's system columns.

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
