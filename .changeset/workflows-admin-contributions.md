---
"@questpie/workflows": patch
---

Restores the workflows sidebar section and dashboard widgets, which have been
missing since the config-bucket migration.

The module used to contribute its admin surface from `sidebar.ts` and
`dashboard.ts` at the module root. When the convention moved to
`config/admin.ts`, the new file was created with empty arrays and the two old
files were left in the tree — so codegen stopped discovering them, and nothing
replaced what they had contributed. Installing `@questpie/workflows` gave you
its collections, jobs and routes, but no "Workflows" sidebar section, no
"All Workflows" link, and no dashboard widgets.

The `workflow-stats` client widget was unaffected by the migration and has been
registered and shipped in the browser bundle the whole time — there was simply
no server-side dashboard item left to render it.

Now contributed from `config/admin.ts`, with the two dead files removed:

- sidebar: a "Workflows" section with the "All Workflows" page link
- dashboard: the `workflow-stats` widget and the `workflow-recent` timeline

No API change; this is a restoration.
