# Schedule review timeout correction

On 2026-09-08 the owner corrected the agent's use of a five-minute review
deadline: Opus reviews can take approximately 50 minutes. The owner asked to
finish the release, not replace Opus because that short deadline expired.
The agent resumes this acceptance lane on that direction and selects a
60-minute deadline for one fresh follow-up candidate.

The [original terminal result](./ACCEPTANCE-TRANSPORT-NO-RESULT.md) remains
`NO_RESULT: timeout`; it is not relabelled as BLOCKED or PASS. This is an
explicit timeout correction for `STATIC-JOB-SCHEDULES`, not an automatic retry
policy, model fallback, or general exception for other tickets.

Use the existing wrapper's supported option:

```sh
bun run review:accept:v2 -- --manifest docs/v4/prototypes/static-job-schedules/acceptance-manifest.json --timeout-ms 3600000
```

The follow-up uses a fresh committed manifest and the same pinned Opus-medium
reviewer, full diff base, historical URL redaction, proof and acceptance
criteria. Only the transport deadline and its recorded resumption change.
No executable implementation, Runtime limit, test budget, or release gate is
changed. There is no second model in parallel. Another NO_RESULT remains
terminal; BLOCKED permits only finding-scoped repair. Only a genuine committed
and verified PASS permits the separate authority projection.

The wrapper already accepts this timeout; changing its global default or
adding a second review runner is unnecessary. The prior complete quality and
PostgreSQL evidence retains its exact tested heads. Rehash the changed authority
documents and rerun formatting, skill validation, packet safety controls,
`git diff --check`, and credential-free packet preflight before submission.
