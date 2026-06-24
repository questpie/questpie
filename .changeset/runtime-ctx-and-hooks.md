---
"questpie": patch
"@questpie/admin": patch
---

Every user-code entry point now establishes the complete ambient `AppContext`, and lifecycle-hook contexts are self-documenting.

**Ambient context (`AsyncLocalStorage`).** Queue/cron job consumers — and queue-dispatched scheduled workflow transitions — did NOT establish ambient context: the queue runner invoked job handlers without `runWithContext`, so the ALS store was empty in jobs. Ambient consumers silently degraded (logger trace, admin-audit actor), ctx-less CRUD lost session/locale, and an email sent from a job crashed with `collections is undefined` (the mailer resolves its template-handler args from the empty store). Jobs now run inside `runWithContext` at system scope, so `getContext()`, ctx-less CRUD (inheriting session/locale), and `email.sendTemplate(...)` all work from a job/cron exactly as they do in an HTTP request.

**Admin server actions** previously received a hand-picked context that omitted `queue`/`email`/`storage`/`kv`/`services`, forcing a stage→`afterChange` workaround for side-effects. They now receive the full `extractAppServices` surface, and `ServerActionContext` extends `AppContextBase` (newly exported from `questpie`) so those services are typed.

**New guarantee:** every user-code entry point — HTTP, CRUD + hooks, jobs/cron, seeds, admin widgets/prefetch, and admin actions — establishes the complete ambient context and hands handlers the full `AppContext`. The queue (listen/runOnce/push/cron) was the only entry point that didn't.

Also in this release:

- **Lifecycle-hook ctx is self-documenting.** The `afterChange` ctx is now a discriminated union on `operation`: `original` is absent on `"create"` and the non-optional previous row on `"update"` (it was `TSelect | undefined` on both, contradicting its own docs). `afterDelete`'s `original` is typed to the deleted row instead of `never`.
- **`email.sendTemplate` honors `replyTo`** (it was silently dropped), and a contextless template handler that reaches for an app service now gets a clear, actionable error instead of a cryptic `collections is undefined`.
- The framework no longer dogfoods the deprecated `update`/`delete` CRUD aliases internally — prefer `updateById`/`updateMany` and `deleteById`/`deleteMany`.
