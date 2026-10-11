# Shared handler collection contracts

QFM-18, 2026-10-11. Generated service and job contexts previously represented the same
collection APIs through different maps. Passing job collections to a service helper made
TypeScript compare every collection structurally. Both contexts now share the explicit job
API alias. Local members remain explicit to avoid the AppContext/config inference cycle;
module members omit locally overridden keys before composing the handler contract.

A published QUESTPIE 3.34.1 consumer comparison with pinned TypeScript 5.9.2 includes
required text, select literals, relations, populated results and five negative assertions.
The first complete run passed in 70.3 seconds under the shared host admission guard:

| Collections | Baseline instantiations | Shared instantiations | Baseline check | Shared check |
| ----------- | ----------------------: | --------------------: | -------------: | -----------: |
| 10          |                 516,063 |               102,967 |         3.08 s |       0.56 s |
| 50          |               1,348,463 |               149,207 |         9.02 s |       0.92 s |
| 100         |               2,388,963 |               207,007 |        14.41 s |       1.72 s |
| 150         |               3,429,463 |               264,807 |        21.27 s |       1.69 s |

These are isolated declaration-contract measurements, not whole-application speedups.
A later repetition failed its per-case deadline while unrelated legacy compilers ran on the
shared machine; it remains failed evidence. CI checks valid diagnostics and requires the
shared instantiation count to remain below 40% of baseline at 100 and 150 collections.

The real full-app fixture also compiles a result-returning job, a queue-aware collection
hook, a job-to-service helper call, a raw Questpie getter call, populated relations, and a
numeric module collection overridden by a local text collection. Active negative assertions
check operators, required create fields, missing keys and select literals; no-any assertions
check job results. Final semantic runs passed: core 29.2 s; full-app 29.5 s. The generator's
88 template tests passed; the broader 294-test codegen run had one default five-second
mailer timeout, and that file passed separately with the package's 60-second timeout.

Reproduce with `bun scripts/context-type-budget.ts <published-package-directory>`.
The framework CI builds declarations before constructing that consumer package. Full
build, package, example and release acceptance remain CI gates. Autopilot adopts the
codegen change through its existing released-version Bun patch until the upstream release.
