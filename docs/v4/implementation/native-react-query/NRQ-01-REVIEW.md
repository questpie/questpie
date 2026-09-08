# NRQ-01 independent implementation review

Reviewed change: `af9cae33c0a89c42c46d780a489e6b43ee7fa5a1` through
`ddc3c8462eacda16194cc5c378211c898aa788b1`. This is ordinary implementation
review, not an architecture acceptance record or aggregate beta.2 PASS.

## Standards

Independent reviewer: `nrq01_standards`.

No confirmed documented-standard breaches or additional heuristic findings.
The review checked the optional peer and bundled build dependency, neutral scope
capability, two-package boundary, narrow Knip classification and negative control,
and progressive deletion under the NRQ-04/05 owners. Neutral `.observe` remains.

The local executable resolver remains a review risk rather than a confirmed
additional defect. Its conditional exports, loaders/assets, activated Package
precedence and emitted `import.meta` controls are relevant, but cannot replace
Gate 2's complete deterministic artifact checks.

## Spec

Independent reviewer: `nrq01_spec`.

No additional implementation defect or unauthorized scope expansion found in
the NRQ-01 capability, exact types, private correlated failure provenance,
independent-bundle interoperability, native cache/watch ownership or optional
package wiring.

One exit requirement remains open: NRQ-01 requires equivalent relocated source
to produce equal generated/artifact bytes and startup with its complete original
integrity inventory. Earlier unexplained equality failures cannot be closed by
later green runs. NRQ-02–06, actual Start browser migration and packed native-hook
acceptance remain explicitly outside this checkpoint's completion claim.

## Frozen repetition after the reviews

The attempted eight-run control stopped on its first failure on a clean
`ddc3c8462` worktree. The exact command was:

```sh
bun test tests/integration/native-react-query.test.ts --timeout=15000 \
  --test-name-pattern='^full-source native options preserve generated transport, codecs and inferred types$'
```

It used task-owned writable `TMPDIR`. Result: **0 pass / 1 fail / 2 filtered
out**, eight assertions, 11 seconds. Complete generated-map equality failed;
the shared split chunk and downstream integrity digests differed. Git HEAD and
clean status were unchanged before and after, and `git diff --check` passed.
Runs two through eight were not executed. This confirms a current defect outside
the broad-suite context; it is not merely a historical dirty-worktree concern.

The original test cleaned its temporary generated bundles. Concise command,
timing and digest evidence was retained in the task-owned diagnostic directory.
Next work must preserve both outputs in a disposable reproducer, compare actual
bundle inputs/resolved graph identities, and repair the cause without filtering
the integrity inventory or normalizing output names. NRQ-01 stays open.
