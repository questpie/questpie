# Focused candidate comparison

## Hole 1: continue versus restart

### A. Return the ingress trace plan — selected

`extract` returns `remote-parent`, `root-with-links`, or `null`. The official
adapter translates its own static trust-boundary setting once. Runtime receives
the exact fact it needs, validates it once, and starts the scope without knowing
adapter configuration. This has the smallest complete interface and reuses the
already accepted trace-plan vocabulary.

### B. Add a trust-boundary discriminator to extracted context

This is executable but mixes deployment policy into a propagation value and
requires Runtime to repeat the translation. It exposes more concepts for less
leverage.

### C. Read configuration or correlate through a side channel

Rejected. The extraction return would remain incomplete and adapter identity or
call ordering would become hidden interface state.

## Hole 2: terminal before a Response

### A. Exact nullable status with a restricted outcome — selected

Keep the existing field name. A numeric `100..599` means a `Response` existed;
`null` means none existed and is admitted only for `framework_error`,
`cancelled`, or `deadline`. The adapter omits the HTTP status attribute for
`null`. The shape is truthful, compact, and mechanically closed.

### B. Nested `response: received | absent` union

Also truthful, but adds a new wrapper and names for one fact already represented
by the existing status field. It increases every caller and artifact without
adding behavior.

### C. Optional or sentinel status

Rejected. Optionality cannot distinguish omission from response absence, while
a sentinel claims a response code that no `Response` produced.
