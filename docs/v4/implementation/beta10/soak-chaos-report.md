# BETA-10 manual soak and chaos report

## Result

`bun run test:soak -- --scenario beta10` passed on local Docker PostgreSQL 17.
The observed manual run completed in 3,089.177 ms:

- ten Runtime instances processed four waves of 20 committed-fact Reactions;
- one worker claimed a run and disappeared without heartbeat or terminal
  transition;
- after the one-second lease expired, the fleet recovered that run;
- three Runtime instances drained and were replaced during the four waves;
- all 80 runs succeeded, exactly 81 attempts existed, no run failed, and every
  drained worker admitted zero work.

The executable scenario and its database assertions are
`tests/load/beta10-soak-chaos.ts:13`–`:150`. The separate manual manifest is
`quality/performance/beta10-soak-chaos.json`; it is not selected by the ordinary
changed or PR lane.

The scenario deliberately stays below the collaboration Reaction's declared
100-row Message reread window. An earlier 200-at-once draft produced
`MESSAGE_UNAVAILABLE` for rows outside that authored Query page. That was an
invalid workload for this fixture, not HA evidence, and is not counted as a
backend failure.

## Chaos boundary

The abandoned claim is the durable-worker crash instrument. A separate
generated-runtime test kills a child process with `SIGKILL`, reconnects through
a fresh Runtime, observes holder generation 2, and receives the missed update
(`tests/integration/postgres/beta07-generated-live-query.test.ts:397`–`:447`).
The soak does not pretend that calling `app.close()` is a process crash; close
is the rolling-removal and drain instrument.
