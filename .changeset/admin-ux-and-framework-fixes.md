---
"@questpie/admin": minor
"questpie": minor
---

Admin UX overhaul (mobile + surfaces + relations + reactive fields) and a batch
of framework fixes (custom field types, search reindex, migration snapshots,
pg-boss singleton, time field).

## Admin

**Surfaces & theming**

- One canonical floating surface across every overlay — Drawer, Sheet, Command,
  Popover, DropdownMenu, Dialog, Select — a single `--popover` panel at the
  floating radius. Fixes select drawers that rendered a doubled background with
  double padding (the drawer's inset pseudo-panel + the Command painting its
  own panel), and drawers/sheets whose background token (`--background`) didn't
  match the menus' (`--popover`). Sheets slide in full-distance instead of
  fading (a translucent mid-fade read as two forms bleeding through each other),
  show their overlay scrim and are modal by default (resource editor, media
  picker, history sidebar, bulk upload).
- Global search on mobile is one cohesive rounded sheet (was torn into
  square-cornered islands overflowing the drawer); keyboard-hint footer is
  desktop-only.
- Sidebar logo accent follows `--primary` (whitelabel-aware) instead of a
  hardcoded brand purple, so a brand-override stylesheet retints it. The theme
  provider already toggles `.dark`/`.light` on `<html>` (default `system`,
  persisted); docs + the questpie-admin skill now document theme mode, the
  "never wrap the admin in a `.dark` div" portal gotcha, and mirroring
  base.css selectors (`:root,.dark` / `.light,:root.light`) for brand
  overrides. The barbershop example's whitelabel smoke-test is corrected to
  those selectors.

**Menus (Base UI)**

- Submenu triggers gate `openOnHover` on a hover-capable pointer, so on touch a
  tap reliably toggles a submenu open AND closed (default `openOnHover` meant a
  tap could only open, never close, and opening was racy). The sidebar user
  menu now uses proper nested submenus for theme / interface language / content
  language on mobile too, instead of a flat inline dump.

**Reactive fields**

- Field-level reactive admin props — `f.x().admin({ hidden / readOnly /
  disabled: ({ data }) => ... })` — now actually apply. They resolve through
  `useReactiveProps` as component props; the field renderer was only reading
  reactive *field state*, so a `hidden` that evaluated to `true` on the server
  was silently ignored. The renderer now folds the resolved `hidden` /
  `readOnly` / `disabled` props into its visibility/interactivity.

**Relations**

- Multi-relation fields default to a compact Payload-style select control with
  the linked records as chips inside it (chip label opens the record editor,
  × unlinks, the menu shows linked options as checked and carries a pinned
  "Create new …" row). The `list` / `chips` / `table` / `cards` / `grid`
  layouts remain available via `display`; orderable relations keep `list` and
  now reorder by dragging a handle (dnd-kit, keyboard-accessible) instead of
  up/down buttons. Picker options show a secondary context line from the
  target collection's
  list columns. Per-item/per-option collection icons removed (the field label
  carries the icon once). Nested record editors (ResourceSheet) gained a
  context header ("Collection › Edit/Create"); the remove action uses a
  link-break icon to read as "unlink", not "delete".

**Search**

- Record search is consolidated into the global search (⌘K / top-bar), which
  now searches records across every collection with highlights; the per-table
  in-list search is off by default (a collection can opt it back in via
  `showSearch`). Internal OAuth/JWKS collections (`jwks`, `oauthAccessToken`,
  `oauthClient`, `oauthConsent`, `oauthRefreshToken`) are hidden from the admin
  — no longer leaking into global search or the sidebar.

**Tables**

- Auto-generated default columns show up to 6 short scalar fields (was 4) and
  skip wide/heavy types (richText, json, object, array, relation, upload, and
  now textarea) so tables read as populated rather than sparse without blowing
  out row height.

**Misc**

- Removed the redundant mobile Sort sheet (sorting lives in View Options).
- Resource-sheet close button is centered in the header (was absolutely
  positioned and sat too low).
- Array field empty state is just the dashed add button — no placeholder box
  stacked above a second full-width button.
- Select primitives build their merged option map in a single pass (was an
  O(n²) Map clone per option on every keystroke).
- Earlier mobile P0s: `h-dvh` shell (no dead strip / floating bottom bar when
  browser chrome collapses), coarse-pointer snap-back after iOS keyboard
  dismiss, checkbox tap-target no longer swallows taps.

## Framework (`questpie`)

**Custom field types — first-class**

- App-land `fieldType()` definitions work end to end: `questpie/builders`
  exports the operator sets a definition needs, generated factories merge field
  types discovered from the app's `fields/` directory into `f.*`, and emit them
  into the `Questpie.FieldTypesMap` augmentation so `f.<name>()` is first-class
  in the type system (not just wired at runtime). `@questpie/admin/client`
  exports `FieldWrapper` and `useResolvedControl` so custom admin field
  components get the same chrome as built-ins. The barbershop example ships
  `f.rating()` and a new `f.color()` swatch field (with a reactive
  `.admin({ hidden })`) as references. (Follow-up on the typesafety-unification
  branch: the app-field factory type is currently `Field<any>`, so a custom
  field's derived where/create types stay loose.)

**Search reindex**

- New app-layer `reindexCollection` / `reindexAllCollections` iterate a
  collection's records across every locale and rebuild the index (the search
  adapter's `reindex()` could only throw — it has no CRUD access). The
  `/search/reindex/:collection` route now uses it (was 500-ing), and
  `questpie seed` backfills the index after seeding — so seeded records are
  actually searchable (seeds run in a worker-less CLI, so the write-time index
  jobs were previously never processed and the index stayed empty).

**Migration snapshots**

- The migration generator builds the previous cumulative snapshot from the
  UNION of the on-disk `snapshots/*.json` chain (authoritative) and the
  in-memory migration list. Fixes a class of "re-emit an already-applied op"
  bugs (e.g. duplicate `ADD COLUMN` → "column already exists") when a
  codegen-produced migration list drifts out of sync with the snapshots on
  disk, and warns loudly when it does.

**Queue (pg-boss)**

- `singletonKey` now actually dedupes: a job (or publish) can declare a
  `queuePolicy` (`short` / `singleton` / `stately` / …), applied at queue
  creation — declaring it on the job definition means the worker's `listen()`
  and the web's `publish()` create the queue with the same policy. Policies
  only constrain keyed jobs, so non-keyed jobs keep full throughput. When a
  `singletonKey` is passed to a standard-policy queue (where pg-boss silently
  ignores it), the adapter warns once. (BullMQ already deduped via `jobId`.)

**Fields & auth**

- `f.time()` (default `withSeconds: true`) accepts both `HH:MM` and `HH:MM:SS`
  — the admin's native time input emits minute precision, which the previous
  seconds-required regex rejected, making time fields unsavable.
- OAuth adapter glue (`resolveOAuthPrincipal`, well-known metadata proxies,
  legacy principal derivation) is properly typed against better-auth types
  instead of `as unknown as` casts; `/.well-known/oauth-authorization-server`
  answers 501 instead of crashing when the OAuth provider plugin is absent.
