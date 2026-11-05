---
"questpie": minor
"@questpie/sentry": minor
---

Tell apart failures reported from one place, and send frames for your own browser error classes:

- `ErrorReportInfo` gains `fingerprint`: up to four static labels declared in code (1–64 characters `A-Z a-z 0-9 _ - . :`), e.g. `errors.report(error, { source: "background", fingerprint: ["sync", "rejected"] })`. Any other value drops the whole fingerprint. The browser reporter's `report(error, info)` accepts the same field. `@questpie/sentry` sends it as the event fingerprint on top of Sentry's default grouping and as the `questpie.fingerprint` tag, so two failures with different labels at one call site become two issues.
- `createBrowserErrorReporter` gains `errorClasses`. With `formattedStacks`, the stack of an error of a custom class was dropped in the browser, because its prototype could not be told apart from a proxy and `name`, `message` and `code` were not read through it. The prototypes of listed classes are now read like built-in ones (data properties only, no getters), so such errors are sent with frames. The type is still sent only when the name is in `errorNames`. A subclass needs its own entry.
