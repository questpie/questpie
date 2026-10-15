# QFM-29: skip unused full local hook contexts

The measured benefit is small. One bounded local pair of the unchanged Autopilot journal carrier measured91.618s baseline and88.248s candidate (3.68%). Both executed all38 cases and374 assertions without filters or skips. Child CPU was54.979s and53.432s; owned PostgreSQL CPU19.359s and19.113s. This does not establish a whole-suite speedup.

The diagnostic used complete isolated framework3.35.3 sources for both variants, not an installed-dependency patch or a function mock. A Bun preload redirected installed public entrypoints to real source exports and verified export identity before the run. Both variants used the same resolver/counter overhead and app input fingerprint. App-side measurement ran on its Bun1.4.2 toolchain; framework source/types and final targeted suites use the package's pinned Bun1.3.13. This is local preparation, not proof that a released app depends on this change.

## Final behavior

Twelve direct local CRUD lifecycle sites pass their original parameters to a private executor. Actual callbacks still receive the original full context and shared executor, including one context shared by callbacks in an array. An absent callback or an empty array instead calls the factored original service extractor and discards its result. It does not assemble a full HookContext or evaluate its lazy tables accessor.

Service resolution, custom namespace projection, request-service factory inputs, dependency order, active scope, errors and disposal stay on their original path. The effective journal app had44 service registrations, including two request-scoped core services. They were not44 repeated singleton initializations. Full context constructions decreased72,570→19,552 in the measured pair; service resolution was deliberately retained.

Combined collection/global hooks still receive their original eager context and use the unchanged shared dispatcher. Core realtime/search callbacks, field hooks, output filtering, validation, transaction boundaries, onAfterCommit and the single shared beforePurge/afterPurge context are unchanged. No cache or new public Questpie API is introduced.

## Rejected approaches and regression controls

The initial unconditional skip passed90 cases but failed the existing programmatic request-service lifecycle test: creation/disposal became0 instead of1. Its failed receipt is retained. A fallback for any request service preserved that behavior but removed useful laziness because core channels/crdt are themselves request-scoped.

A request-only initializer then passed92 targeted cases. Independent review found a supported custom namespace edge: projecting a singleton into session can change the session object passed to the next request factory. A real regression reproduced the difference. That initializer was removed; the final change calls the original full service extractor instead.

The new regression carrier checks absent/empty callback phases without full context materialization, actual callback order and shared context, original beforeValidate/afterRead transformations across native read modes, request-service creation/disposal with empty arrays, and singleton namespace projection before a request factory. Actual context extraction errors still propagate. Nine existing hook/core/transaction/purge/request suites form the final targeted proof; types include the new regression file explicitly.

Independent Astra review closed the namespace finding. Further global-hook elision or service-extractor optimization is outside this change and needs its own evidence. No GitHub publication or merge is authorized for this upstream Task until CLI custody is approved.
