---
"@questpie/admin": patch
---

fix(admin): delete action from form view and bulk action toolbar visibility

- Fix delete mutation in form view passing plain string instead of `{ id }` object
- Fix post-delete navigation using prop navigate/basePath instead of store versions
- Remove deleted item query from cache instead of invalidating (prevents 404 refetch)
- Fix `mergeServerActions` always overriding bulk/row with empty arrays, preventing default actions (deleteMany, restoreMany, duplicate) from appearing
