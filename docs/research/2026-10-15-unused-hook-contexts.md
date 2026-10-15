# QFM-29: skip unused full local hook contexts

The measured benefit is small. One bounded local pair of the unchanged Autopilot journal carrier measured 91.618 s baseline and 88.248 s candidate (3.68%). Both executed all 38 cases and 374 assertions without filters or skips. Child CPU was 54.979 s and 53.432 s; owned PostgreSQL CPU 19.359 s and 19.113 s. This does not establish a whole-suite speedup.

The diagnostic used complete isolated framework 3.35.3 sources for both variants, not an installed-dependency patch or a function mock. A Bun preload redirected installed public entrypoints to real source exports and verified export identity before the run. Both variants used the same resolver/counter overhead and app input fingerprint. App-side measurement ran on its Bun 1.4.2 toolchain; framework source/types and final targeted suites use the package's pinned Bun 1.3.13. This is local preparation, not proof that a released app depends on this change.

## Final behavior

Twelve direct local CRUD lifecycle sites pass their original parameters to a private executor. Actual callbacks still receive the original full context and shared executor, including one context shared by callbacks in an array. An absent callback or an empty array instead calls the factored original service extractor and discards its result. It does not assemble a full HookContext or evaluate its lazy tables accessor.

Service resolution, custom namespace projection, request-service factory inputs, dependency order, active scope, errors and disposal stay on their original path. The effective journal app had 44 service registrations, including two request-scoped core services. They were not 44 repeated singleton initializations. Full context constructions decreased 72,570→19,552 in the measured pair; service resolution was deliberately retained.

Combined collection/global hooks still receive their original eager context and use the unchanged shared dispatcher. Core realtime/search callbacks, field hooks, output filtering, validation, transaction boundaries, onAfterCommit and the single shared beforePurge/afterPurge context are unchanged. No cache or new public Questpie API is introduced.

## Rejected approaches and regression controls

The initial unconditional skip passed 90 cases but failed the existing programmatic request-service lifecycle test: creation/disposal became 0 instead of 1. Its failed receipt is retained. A fallback for any request service preserved that behavior but removed useful laziness because core channels/crdt are themselves request-scoped.

A request-only initializer then passed 92 targeted cases. Independent review found a supported custom namespace edge: projecting a singleton into session can change the session object passed to the next request factory. A real regression reproduced the difference. That initializer was removed; the final change calls the original full service extractor instead.

The new regression carrier checks absent/empty callback phases without full context materialization, actual callback order and shared context, original beforeValidate/afterRead transformations across native read modes, request-service creation/disposal with empty arrays, and singleton namespace projection before a request factory. Actual context extraction errors still propagate. The additional two-row read regression preserves synchronous context-construction failure: later row hooks must never run after the first context fails. The private delegator remains synchronous and returns the unchanged shared hook Promise. An earlier async delegator reproduced one unwanted later-row callback; that version remains unpublished.

The QFM-28 relation-metadata controls live in their own `relation-metadata.test.ts` carrier, avoiding unrelated existing legacy test diagnostics while explicitly including both new carriers in the semantic check. The original purge-relations carrier is restored byte-for-byte. Source and full-app semantic types, lint and formatting passed on Bun 1.3.13; the combined runtime integration proof passed all 111 cases and 391 assertions across 11 complete carriers, with zero failures or skips in 97.082 s. The two measured individual journal pairs have not been combined into a summed or whole-CI saving.

Independent Astra review closed the namespace and synchronous error-order findings. Further global-hook elision or service-extractor optimization is outside this change and needs its own evidence. No GitHub publication or merge is authorized for this upstream Task until CLI custody is approved.
