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

## Focused test-host repair review

The [complete reduction](COMPILER-TEST-HOST.md) explains the frozen failure as
test-host dependency selection. The repair after `3fb785621` changes test
orchestration, not production resolution. Both compilations share one ordinary
Bun child and return unmodified maps to the existing equality check.

Independent `start_ssr_boundary` review found one cleanup gap: a terminated
compiler child could leave evaluator/typecheck directories outside the parent's
temporary tree. The child now sets `TMPDIR` to its parent-owned directory. The
reviewer confirmed the repair and found no remaining issue.

Independent Spec review (`nrq01_spec`) found no weakened NRQ-01 guarantee or
unauthorized expansion. Original-before-copy ordering, stale-output controls,
full-map equality, types, transport and the two-version dependency-byte controls
remain enforced. The code neither resets the process between compilations nor
normalizes generated output.

Independent Standards review (`nrq01_standards`) found no code blocker and one
documentation inconsistency: the earlier Immediate continuation still requested
diagnosis while its later paragraph described the repair. That paragraph now
names the reproduced host defect and the remaining repetition/release gates.
These focused reviews do not replace those execution gates or claim a beta.2
acceptance result.

## Exit closure

The frozen test-host repair passes five consecutive full-source consumer runs
and one complete `quality:release` invocation. See the final execution checkpoint
in [NRQ-01-EVIDENCE.md](NRQ-01-EVIDENCE.md). This closes the remaining deterministic
artifact exit requirement alongside the already passing complete-inventory
PostgreSQL startup control. Standards and Spec have no open finding for NRQ-01;
successor browser, golden-consumer and packed-native gates are not included.
