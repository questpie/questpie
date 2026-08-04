---
"@questpie/testing": minor
---

Add `createEvidence` and `createCleanup` to `@questpie/testing/scenario`, and put
every harness in this package on the same bounded, redacted evidence ring.

`createEvidence` holds output in a ring bounded twice, by line count and by
characters per line, so a process that prints forever costs a fixed amount of
memory and one enormous line cannot swallow the tail. Registered secrets are
replaced longest first, which keeps a short secret from splitting a longer one
and leaving the remainder readable. Redaction now happens before truncation: the
other order let a secret straddling the cut keep a half that matched no
registered value and so was never replaced.

Point it at an artifact directory and a failing run writes a manifest naming the
command, the runtime and the outcome, next to the captured output. A passing run
removes the directory, so a green suite leaves nothing behind to be misread later
as the record of a failure.

`createCleanup` tears down in reverse registration order, because a resource is
registered after the thing it depends on. Every step runs even when an earlier
one throws, and `CleanupError` carries all of them: a run that leaked a database
and a port says both, instead of making you fix one and rerun to find the other.
Repeated and concurrent calls share one result, and it works after a partial
setup where later resources were never created.

`startProductionServer` now uses this ring, so its limits and the ones a scenario
sets are the same limits.
