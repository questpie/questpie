# Record-set health

Findings about the record set itself — its citations, its routing documents, and
its own authority surfaces — rather than about the product. Split out of
`HANDOFF.md`, which had grown to 1,490 lines and is read first by every tick.

Base: `feat/v4` at `c54b30ac`.

## What is already swept, and need not be re-derived

- **Citations, axis one (existence and range).** 121 v4-tree citations, none
  past EOF, none naming a missing file. A further 66 point at v3 paths
  (`packages/questpie/src/server|cli|client/`, `packages/workflows/`,
  `packages/admin/`), which are absent from `feat/v4` on purpose.
- **Citations, axis two (does the line say what the sentence claims).** 32
  candidates read; four defects, all in `beta09/owner-decisions.md`; the rest
  correct.
- **The repo-owned skill.** All six branches; every path and script they name.
- **Numbers.** ~30 figures across the guides.

## Method, learned by failing at it

Five instruments produced false findings here. Every one was caught by reading
and none by the checker.

- Run a checker against a case already known **positive** before believing a
  zero.
- A grep hit count is a candidate list, never a finding.
- Branch-only code needs `git show feat/v4-beta-09:<path>`. A bare path resolves
  against `feat/v4` to unrelated code rather than failing, which is worse.
- Accepted review records (`docs/v4/implementation/*/claude-*.md|json`) are
  snapshots against their own reviewed head, not `HEAD`.
- Config is not code: the size ratchet lives in `quality/`, not `scripts/`.
- A citation can go stale **inside the commit that writes it**, when that commit
  also edits the cited file. Re-derive line numbers after the edit, not before.

## Findings

## \*\*`SPEC.md` §16 "Current decision state" is two Accepted ADRs behind, and one

of them supersedes a decision §16 still states in full.**
§16 enumerates ADR-0009 through ADR-0021 and never mentions **ADR-0022**
("Freeze API Ergonomics and Operation Projection", Status: Accepted,
2026-08-14) or **ADR-0023** ("Freeze the Post-Commit Operation Outcome",
Status: Accepted, 2026-08-16). `HANDOFF.md`'s "Current accepted outcome" section declares
authority as "ADR-0008 through ADR-0023 and their accepted workbench/public
projections", so §16 stops two short of its own stated range.
**The supersession is the urgent half.** ADR-0023's header reads
"Supersedes: the incomplete post-commit outcome edge of ADR-0014 and its
retained-pair execution rule for Wire v1 Mutations only". `SPEC.md:583`–`:590`
describes ADR-0014's acceptance with no mention of it, so a reader takes
ADR-0014's post-commit rule as current.
Both omitted decisions have already reached the public guides —
`queries-and-mutations.mdx` documents `COMMITTED_RESULT_UNAVAILABLE` on Wire
v2 (ADR-0023), and `semantic-kernels-and-public-surface.mdx` documents
`QP-COMPOSE-023`/`024` (ADR-0022). So the projection reached the guides and
skipped the spec.
Recorded rather than written: summarising an Accepted ADR into product
authority is a projection act, and the wording is the owner's.
**The rest of `SPEC.md` is clean.\*\* All 17 document paths it names exist, and
all 13 ADR references resolve to files on disk. (`questpie.json` at `:137` is
an application's own config, not a repository file — it flags as missing in a
naive existence sweep.)

## \*\*The repo-owned skill is verified end to end: six branches, one content

defect, one instruction gap.** `SKILL.md` routes to six references and all six
resolve. Every path and script they name exists — `docs/adr/README.md`,
`docs/v4/implementation-gates.md`, `SPEC.md`, `CONTEXT.md`,
`docs/agents/product-documentation.md`, `PROOF-MAP.md`, `CONTRIBUTING.md`,
`SECURITY.md`, and the `architecture:check`, `quality:full`,
`quality:release`, `check:changed`, `review:accept*` scripts.
`codebase.md` checks out in full: `composition/`, `schema/` and `seed/` exist
under `packages/compiler/src`; the size ratchet is real and exact —
`quality/code-architecture.json` has `warningLines: 500` and
`maximumLines: 800`, with the shrink-only `legacy` map present and currently
empty; all five named test directories exist; and `questpie` is the only
package without `private: true`, with compiler, runtime and testkit all
private, exactly as claimed.
The two defects are recorded above: the Barbershop canonical-application
instruction that three guides out of thirteen follow, and the handoff prompt
that dropped `--test`/`--typecheck` (fixed).
**Do not re-derive this\*_; spot-check a branch when you edit it. One trap if
you do: the ratchet thresholds are config, not code — a grep of `scripts/`
and the root `_.json`files finds nothing and invites a false "the ratchet is
unimplemented" finding. They live in`quality/`.

## **The acceptance-verify seam's own trigger fired; CI now enforces it.**

`.agents/skills/questpie-v4/references/proof.md` describes
`bun run review:accept:verify` as the seam letting CI check acceptance
evidence without a model account, and says plainly: "it is not yet wired into
a workflow, so run it locally after committing a record and wire it into CI
when the first v2 record lands on a merged branch."
**That record landed.** `docs/v4/implementation/beta08/REVIEW-04.json` is
`protocolVersion: 2` with `verdict: PASS`, and BETA-08 is merged at
`8389cf5f` (PR #320). All four BETA-08 records are v2; BETA-06 and BETA-07 are
all v1, so BETA-08 is exactly the first.
The condition the skill set for itself is therefore met. It is now wired as the
credential-free `Acceptance record integrity` job at `.github/workflows/ci.yml:17`–`:27`.
That job uses `fetch-depth: 0`, not the full-quality job's shallow checkout,
because the verifier proves the reviewed head is an ancestor of `HEAD`. **Both
halves of that were checked rather than taken on the commit message.**
`verify-acceptance-review.ts:77` runs `git merge-base --is-ancestor <reviewedHead>
HEAD`, and `acceptance-review-packet.ts:204`–`:219` adds two more ancestry
checks, so the full history is genuinely required. `ci.yml`'s triggers are
`pull_request` on `[main, feat/v4]`, so the job runs on the branch where records
actually land rather than only on `main`.

**One limitation, recorded because it will rot silently.** The job pins a single
path — `--record docs/v4/implementation/beta08/REVIEW-04.json` — and the script
accepts exactly one record (`verify-acceptance-review.ts:48`–`:50` fails anything
but `--record <path>`). Checking only the PASS record is correct: the other three
v2 files under `beta08/` are BLOCKED rounds and are not acceptance evidence. The
hazard is the next slice. When BETA-09 accepts with its own v2 PASS record,
nothing adds it to this job, and the gate will keep passing while verifying a
record nobody is changing. The fix is a step per accepted record, or a loop over
the accepted-issue map, and it belongs to whoever accepts the next slice.

**That next slice accepted, and the gap is now live rather than predicted.**
BETA-09 merged at `21e38b21` carrying
`docs/v4/implementation/beta09/REVIEW-BACKEND-02.json` — `protocolVersion: 2`,
`verdict: PASS`, a second accepted record. `.github/workflows/ci.yml:27` still
runs `--record docs/v4/implementation/beta08/REVIEW-04.json` and nothing else,
so the job verifies one of two and stayed green throughout. A check pinned to a
path does not fail when a second path appears; it just stops covering the set.

**The addition would pass today**, which is worth knowing because it makes the
fix a one-line step rather than an investigation:
`bun run review:accept:verify -- --record docs/v4/implementation/beta09/REVIEW-BACKEND-02.json`
exits 0 with "acceptance review verification PASS … ->
`a7545384aa9c8fd5683152414a87c701a76154d3`". Editing `.github/workflows/` is
outside what a design record does, so this states the step rather than taking
it.
**The check itself was run and BETA-08's record passes**, so the wiring gates a
check that is green today rather than one nobody has tried:
`bun run review:accept:verify -- --record docs/v4/implementation/beta08/REVIEW-04.json`
exits 0 with "acceptance review verification PASS … ->
`d0aedd54dc6420b48e632590a6c2319f8516bc9f`", the repinned manifest head.
Verified independently that BETA-08 is the first v2 record, which is what makes
the trigger fire: every review JSON under `beta06/` and `beta07/` is
`protocolVersion: 1` and all four under `beta08/` are `2`.
**What that PASS does and does not establish**, since a green result from an
unexercised tool is worth nothing. The tool discriminates on content: pointed at
BETA-07's v1 record it exits 1 with "record lacks reviewedHead or manifestPath".
It does **not** read the working copy — it resolves the record through
`git show HEAD:<path>`, which is why two attempts to control it with a tampered
file on disk failed on the path and on the file being untracked rather than on
the tampering.
**A deletion breaks a citation without touching the file that carries it, and a
rename does it more quietly still.** Every decay recorded above came from an
insertion shifting line numbers. Two more modes surfaced once records started
being descoped:

- **Deletion.** `65643c1c` removed `apps/studio/`, and two citations in
  `maintenance-decisions.md` — the record that re-scope _promoted_ to current —
  pointed into it. Nothing in that file changed; the target simply stopped
  existing. Fixed at `cc4192b2`.
- **Rename.** `1d85b472` renamed
  `apps/docs/content/docs/v4/services-routes-and-auth.mdx` to `services.mdx`
  while cutting raw-Route material. `api-ergonomics-gate/AMENDMENT.md` still
  names the old path, and the example it cites, `mutations.delivery.record`,
  occurs zero times in `services.mdx`.

**Re-ran the existence axis because a deletion invalidates it silently.** A
sibling closed that axis at 121 citations with none missing; that result predates
both cuts. Re-run over 283 code-path citations, 13 do not resolve on `feat/v4`:
four are branch files legitimately cited when discussing `feat/v4-beta-09`, one
is a path that exists nowhere and is already recorded as such, and the rest are
the deletion and rename above. **Axis one is not a one-time audit — any commit
that deletes or renames a cited path reopens it.**

The prevention that works is visible in the set already: `owner-decisions.md`
cites `feat/v4-beta-09:apps/studio/src/app.tsx:28`–`:33`, branch-prefixed, and
the deletion on `feat/v4` cannot touch it.

**The rename case is the exception, and the sibling who left it alone was right
on the merits, not merely first.** `beta1-documentation-gap/FINDING.md` calls
`AMENDMENT.md`'s work-list "a historical record of a past amendment's scope, not
a live claim". Checked whether that work-list is actually finished rather than
taking the framing: it prescribed replacing generated server capability
bracket-key calls with nested paths, and
`docs/v4/service-route-and-auth-composition.md:54` now reads
`await mutations.delivery.record({ body })` while
`apps/docs/content/docs/v4/durable-reactions.mdx:56`, `:61` read
`ctx.actions.delivery.sendMessage` and `ctx.mutations.messages.recordDelivery`.
**No `ctx.actions[` or `ctx.mutations[` form survives in any guide.** The
conversion landed; the guide that vanished had its content cut rather than
converted. So a stale path in a completed work-list is a record of what was
targeted, and annotating it — which I briefly did and reverted — adds noise to
finished work.

That does not extend to the amendment's other half. `QP-COMPOSE-023` and `-024`
are named by `ADR-0022` and exist in no compiler source, which is recorded
separately and is not historical.

**The conclusion drawn from that was wrong and is corrected here.** It said
tamper-detection inside a conforming committed record is untested and that
testing it would mean committing a bad record. Neither holds. The repository
ships the control: `bun run review:accept:negative-control` runs 62 tests
across four files, all passing, and
`tests/unit/acceptance-review-record.test.ts:82`–`:85` is the exact tamper that
was attempted — it sets `changed.verdict = "BLOCKED"` and asserts
`decodeAcceptanceReviewRecord` throws. Sibling tests reject "record drift",
"a substitution in every bound field", "substituted authority, non-ancestor
base, and path escape".
The chain closes: `verify-acceptance-review.ts:89` calls that same
`decodeAcceptanceReviewRecord`, and `:79` the `prepareAcceptancePacket` the
packet tests cover. So the verify is tamper-checked by construction, and the
earlier note mistook "I could not build a control by hand" for "no control
exists".

## `owner-decisions.md` states an owner answered its three questions. \*\*That

attribution cannot be verified from this repository.** Two of the three are
independently grounded in citations and stand regardless; the attribution still
needs confirming before review.
**The count is also wrong, and the discrepancy is not cosmetic.** The intro at
`:3`–`:7` says three decisions were put to the owner and names them — whether
ADR-0010 grows, whether maintenance Authority is evaluated, and how Studio
assets are packaged. The file then records **four**, D1 through D4, each headed
"**Answered:**". D3 (batching the divergences) and D4 (repairing the glossary)
are not among the three named, so it is unclear whether they carry the same
owner attribution or were settled in-branch.
**D3 is settled by the file itself, in the other direction.** Its subject
reappears at `:181`–`:183` in the author's own "Judgment calls, and what would
overturn them" list — "That batching the divergences is safe" — with an
overturning condition attached. A decision cannot be both an owner answer and
the author's judgment call; the judgment-call framing is the one with
reasoning attached, so treat D3 as needing no owner confirmation and resolve
the heading instead.
D4 is what added `Operational Fact` to `CONTEXT.md`. The recommendation above
to take the argued exception rests on the term's content, not on D4's
provenance, so it holds either way.
**D1's premise holds; one of its three citations does not.** D1 is the
decision seven of the eight divergences are batched under, so its grounding
is worth checking rather than inheriting. Two of three verify exactly:
`docs/adr/0010-freeze-trusted-context-and-relational-policy.md:41` does say
`definePolicy(collection, body)` "binds one closed typed Policy program to one
Collection", and **the durable kernel really has no Collection** — no
`defineCollection` anywhere under `packages/runtime/src/durable/` or
`packages/compiler/src/reaction/`, and the tables are raw DDL in
`questpie_internal` (`internal-protocol-v4-sql.ts:15`). That premise carries
the batching argument and it is sound.
The third citation is wrong. `owner-decisions.md` cites `CONTEXT.md:405` for
"Policy applies to normal clients, direct operations, workers, recomputation,
and Studio". That sentence is at **`:411`**. Line 405 sits inside the
**Authority** definition; `### Policy` does not start until `:407`. The
sentence exists and says what the argument needs, so **the conclusion stands
and only the pointer is broken** — the same citation-axis-two class as the two
found in `statement-timeout-gate/DECISION.md`, in a load-bearing decision this
time.
**D2 has the same defect, and its cause is worth more than the fix.** D2
cites `CONTEXT.md:400`–`:403` for "the immutable class of actions an Execution
may request … cannot be derived from request input". That text is at
`:404`–`:405`; `:400` is the **Tenant** definition, `:402` the `### Authority`
heading, `:401` and `:403` blank. The cited range holds not one word of the
quote.
It was correct when written. At `f092d618^` the text sat at `:402`, inside the
cited range. `f092d618` — the commit that wrote `owner-decisions.md` — also
edited `CONTEXT.md`, and its first hunk (`@@ -25,7 +25,9 @@`) added two lines,
pushing everything below down by two. **The record cited the file and edited
the file in the same commit, and the citations were not re-derived after the
edit.** That is a decay mode this record set has not named: not staleness over
time, but staleness within a single commit.
**D1's is not explained by that**, and I checked before assuming one cause
covers both. The Policy sentence sat at `:409` before the commit and `:411`
after; D1 cites `:405`, which holds it in neither version.
Both quotes exist and both arguments stand. **Rule the pair earns: when a
record edits `CONTEXT.md` and cites `CONTEXT.md` in the same commit, re-derive
every line number after the edit, not before.\*\*
**The same decay has a wider form, and the narrow rule does not catch it.**
That rule runs from a record to itself. The obligation actually runs the other
way: from the file being edited, to everyone who cites it. `c4e6f7cb` fixed my
instance — `statement-timeout-gate/DECISION.md` cited
`inspection-contract.md:164`–`:166` for D3 in two places, then `13992051`,
`70b9b083` and `69c08cc9` inserted blocks into `inspection-contract.md` and
pushed D3 to `:206`. Three commits apart, two different files, and nobody
editing the second file had any reason to look at the first. So: **before
committing an insertion into any record, grep the set for
`<that filename>:[0-9]` and re-derive what you find.** Better still, avoid
creating the pointer: **cite a document by the name of the thing, not by line.**
Checked the doc-to-doc citations that exist and three of four target something
already named — `### D3`, the "Criterion 18 is covered" paragraph, the "One
divergence" paragraph — so the line number adds nothing and is the only part
that decays. Code needs line numbers because a statement has no name; a
document section usually has one. The fourth, a range into BETA-08's
narrower-claims list, both began on a blank line and ended mid-sentence, and is
now cited by naming its two bullets instead. Nothing else catches a stale
pointer
— both stale citations resolved to real lines in the right file, so axis one
passes them, and the citing record was untouched so no diff flags it.
**D2's three tree claims are all true, and two of them cite bare branch paths
— the failure this file's own discipline block names.** Verified each against
`feat/v4-beta-09`:

- `postgres-maintenance.ts:209`–`:210` is exactly
  `input.authorize !== undefined && !(await input.authorize({…}))`. Exact.
- `compiler/src/runtime/application.ts:411` is exactly
  `const durableMaintenance = createPostgresDurableMaintenance({ sql,
application: durableApplication })` — the construction site, passing no
  authorizer. Exact.
- `feat/v4-beta-09:tests/integration/postgres/beta09-authority-guard.test.ts:60`–`:63`
  says what D2 quotes. Exact, **and correctly prefixed**.
  The first two are cited without the `feat/v4-beta-09:` prefix, in the same
  paragraph as the third that has it. **On `feat/v4` those paths resolve to
  something else entirely**: `postgres-maintenance.ts:209`–`:210` is a
  `VERSION_MISMATCH` rejection record, and the string `authorize` does not appear
  anywhere in that file; `application.ts:411` is
  `if (!binding) throw new TypeError(…)`.
  So a reviewer following the citation lands on unrelated code and concludes the
  record cited something that does not exist. **The claims are true and the
  pointers make them look fabricated** — worse than an ordinary stale line,
  because it discredits a correct finding.
  **It is four, not two, and the pattern is systematic in that one file.**
  Swept every bare `packages/…` and `tests/…` citation in the record set for
  the shape "feat/v4 does not match the claim, the branch does".
  `owner-decisions.md` carries four, each with line numbers exactly right for
  `feat/v4-beta-09`: `:100` → `postgres-maintenance.ts:209`–`:210`, the
  `authorize` guard; `:103` → `compiler/src/runtime/application.ts:411`, the
  `createPostgresDurableMaintenance` call; `:46` →
  `compiler/src/runtime/application.ts:464`–`:483`, where the branch has
  `const durable = Object.freeze({` and `feat/v4` has a comment about worker
  polling; and `:46`–`:47` → `runtime/src/application/index.ts:433`–`:447`,
  which on the branch is exactly realtime, then the Studio shell, then Studio
  artifacts, then the wire. **`studio` appears zero times in that file on
  `feat/v4`**, so that sentence cannot be checked against it at all.
  One citation in the same file — the test at `:60`–`:63` — does carry the
  prefix, so the rule was known and applied unevenly rather than missed.
  **Scope of what I checked:** the sweep produced 32 bare citations where the
  two refs differ at the cited line. Most are records correctly citing
  `feat/v4` where the branch merely shifted, including several of mine. I read
  the four above and confirmed them.
  **Read eleven more, and every one is a correct `feat/v4` citation** — which
  bounds the defect to one file rather than leaving it open across the slice.
  Each was verified against the claim, not just the line: three records cite
  `postgres-maintenance.ts:130` for `actorOf` and its
  `principalKernel.is(actor)` brand check, and `:130`–`:131` is exactly that;
  two cite `:61` for `reason` on `cancelRun`, and `:58`–`:61` is exactly that;
  two cite `rows.ts:139` for the `event_sequence` bump, and `:139`–`:141` is
  exactly that; two cite `index.ts:592` and two `compiler/src/runtime/
application.ts:489` for `beginDrain()` reachable only through `close()`, and
  both are exactly that. Those eleven span `acceptance-shape.md`,
  `design-context.md`, `hostile-cases.md`, `maintenance-decisions.md` and
  `studio-purpose.md`.
  **Sweep closed: 32 candidates, all 32 read, 4 defects, all four in
  `owner-decisions.md`.** The remaining 28 are 27 correct `feat/v4` citations
  plus one correct-at-its-own-reviewed-head historical citation. The habit is
  one file's, not the slice's.
  **One methodological point the last candidate earned.**
  `beta05/claude-initial-review.md:18` cites
  `tests/integration/postgres/helpers/beta05-runtime.ts:31`, which is a blank
  line on `feat/v4` today. At BETA-05's reviewed head `884b5d8a` it is
  `const beta05FixtureRoot = resolve(` — correct when written, shifted by one
  since. **An accepted review record is a snapshot against its own reviewed
  head, and checking it against `HEAD` is the wrong ref.** Any future citation
  sweep should exclude `docs/v4/implementation/*/claude-*.md` or resolve them
  against the matching accepted head in the authority table above.
  **The merge invalidated this closed sweep, and that is a fourth decay mode.**
  BETA-09 merged at `21e38b21` and rewrote
  `packages/runtime/src/durable/postgres-maintenance.ts`. Two verifications
  recorded above are now false against `HEAD`: `:130`–`:131` is no longer
  `actorOf` — that function moved to `:179`, and `:130` is now a
  `Promise<Result>` return type — and `compiler/src/runtime/application.ts:489`
  is no longer the `beginDrain()` site, `close()` being `:491` and the drain
  loop `:493`. The paragraphs above are left as written, because they were true
  when they ran and they are the evidence for this entry.
  **Re-running the sweep against the 36 files the merge touched found ten stale
  citations across eight records**, all correct when written, all corrected in
  this pass: the two clusters above; `statement-timeout-gate/DECISION.md` and
  its `ISSUE.md` citing `:111` for a `FOR UPDATE` now at `:160`, in a function
  the slice also renamed `lockRun` → `readRun`; and
  `beta1-documentation-gap/FINDING.md` citing `declarations.ts:113`, now a
  blank line.
  **So the beta05 lesson generalizes past accepted review records.** That case
  concluded a review record is a snapshot against its own reviewed head. A live
  design record citing `HEAD` decays the same way the moment an implementation
  lands: `design-context.md` and `maintenance-decisions.md` have no commit
  touching them since `21e38b21`, so the record is unedited, the claim is
  unchanged, and the citation rotted because someone else's merge moved the
  target. Deletion and rename need an edit to the citing record or the cited
  document. This needs neither, which is why nothing in the record set signals
  it.
  **Two consequences for how citations get written.** First, a citation whose
  anchor is a symbol should name the symbol. The record set already does this
  two rows above one of the defects — `beta09/design-context.md:62` cites
  `` `postgres-maintenance.ts` `staleVersion` `` with no line number, and it did
  not decay. The `actorOf` sites are now written that way. Second, this sweep's
  own detector was regex-scoped to citations carrying a `packages/` or `tests/`
  prefix, and two of the ten — `maintenance-decisions.md:112` and
  `durable-evidence-gaps/FINDING.md:48` — are bare `postgres-maintenance.ts:130`
  and were found only by grepping the specific line number afterwards. A sweep
  that reports a closed count is asserting its detector's coverage as much as
  its verdicts.
  **D3 has a bigger problem than its heading: the eight divergences it batches
  are never listed.** `owner-decisions.md:122`–`:123` commits "the eight
  divergences between accepted documentation and the tree that this slice
  surfaced" to one interstitial gate before BETA-12, and `:126`–`:131` even
  splits them seven-and-one by root cause. No record enumerates them. "Divergence"
  appears eleven times in the whole record set, across seven files: three in this
  file (two of them about D3 itself, one about branch commits), three in
  `owner-decisions.md`, one in `beta09/README.md`'s "One divergence" paragraph about a `hasMore` comment,
  one in `beta09/hostile-cases.md:106` about a test technique, and three in
  unrelated beta03/05/07 records. Checked the `feat/v4-beta-09` branch too,
  including its five files that are not on `feat/v4` — same three mentions, no
  list.
  So the gate has a count and no membership, and whoever builds it cannot know
  when it is done. It also makes the overlap with this section unresolvable: the
  findings catalogued above — eleven diagnostic codes, the Resource Name grammar,
  the JSONB bound, `operation.input`, the Query factory shape, output inference —
  are exactly "accepted documentation against the tree", but whether any is
  already one of the eight cannot be determined. **Enumerating them is the
  precondition for scoping the gate, and this section is a candidate starting
  set, not a replacement.**

  **Resolved.** `beta09/owner-decisions.md` D3 now enumerates eight membership
  items from the accepted-backed catalog: composition diagnostics, Resource
  Name validation, Query input derivation, Query declared errors, Query Policy
  surface resolution, Query execution facts, output inference, and the JSONB
  byte bound. It also records the excluded docs-only and invented findings and
  the evidence that refutes D3's former seven-to-one root-cause explanation.

## Independent validation at `62880614`

- **Claim 9 — CONFIRMED, both halves.** `owner-decisions.md:25` points at
  `CONTEXT.md:405`, while the Policy scope sentence is at `CONTEXT.md:409`–`:412`.
  Its `:81` pointer covers the heading and blanks; the quoted Authority rule is
  at `CONTEXT.md:404`–`:405`. The four bare source pointers at
  `owner-decisions.md:46`, `:49`, `:100`, and `:103` resolve to unrelated
  `feat/v4` code, while `git show feat/v4-beta-09:<path>` reaches exactly the
  durable surface (`compiler/src/runtime/application.ts:464`–`:483`), Studio
  request ordering (`runtime/src/application/index.ts:433`–`:447`), conditional
  authorizer (`runtime/src/durable/postgres-maintenance.ts:209`–`:210`), and
  unauthorised construction site (`compiler/src/runtime/application.ts:411`)
  the prose claims. The nearby authority-guard test already uses the correct
  branch prefix and corroborates the reachability limitation at
  `feat/v4-beta-09:tests/integration/postgres/beta09-authority-guard.test.ts:59`–`:63`.
  Six pointers are defective; every underlying statement is true.
- **Claim 11 — CONFIRMED.** A positive search finds D3's count and seven/one
  assertion at `owner-decisions.md:120`–`:131`. Reading every `divergence` hit
  under the BETA-09 records on both `feat/v4` and `feat/v4-beta-09` finds no
  membership list; the other hits concern a `hasMore` comment, a hostile-test
  technique, or unrelated accepted slices. The gate therefore has a number but
  no replayable scope.

## A fifth mode, and this one is in the checking, not the records

Every entry above is about a record decaying. This one is about the verification
decaying, and it is worse, because it makes the checking silently report on a
tree nobody is looking at.

This tick opened by verifying claims against the working tree while
`git rev-parse HEAD` was **11 commits behind `origin/feat/v4`**. BETA-10 had
merged at `8787e870`; the tree on disk was `2de4cb23`. The first symptom was a
contradiction that took three probes to resolve: `git diff` against the merge
showed `tenant_turn` added, and `grep` could not find it in any file.

**The standing start-of-tick checks cannot detect this.** `git status --short`
prints nothing, because a stale checkout is clean. `git log --oneline
origin/feat/v4..HEAD` prints nothing, because that range is commits _ahead_, and
this is the other direction. `git fetch` updates the remote ref and deliberately
does not move the tree. All three reported the healthy answer. The check that
would have caught it is `git rev-list --count HEAD..origin/feat/v4`, which is not
in the protocol.

**What this costs is the whole discipline, not one claim.** "Verify every claim
against the tree with `file:line`" resolves to whatever the tree happens to be,
and a citation verified against a stale checkout is indistinguishable in the
record from one verified against `HEAD` — same format, same confidence, no
marker. The failure is silent on both sides.

**Judgment call: this is a protocol gap, not a per-tick mistake, so the fix is a
check rather than more care.** Adding `git rev-list --count HEAD..origin/feat/v4`
beside the existing fetch, and fast-forwarding when it is non-zero and the tree
is clean, closes it in one line. What would overturn this: if ticks are ever
expected to hold a deliberately pinned older tree — verifying an accepted record
against its own reviewed head, which the beta05 entry above says is sometimes the
right ref — then fast-forwarding is wrong and the fix is to record the ref each
verification ran against instead.

## The fourth mode fired again one tick later, four times larger

BETA-09's merge moved ten citations across eight records. BETA-10 merged at
`8787e870` one tick after that entry was written and moved **27 citations across
nine records** — `beta09/design-context.md`,
`freshness-and-provenance.md`, `inspection-contract.md`,
`maintenance-decisions.md`, `studio-purpose.md`, and the
`durable-evidence-gaps`, `statement-timeout-gate` and `tenant-share-control`
prototypes. The cause is one rewrite: BETA-10 replaced `admit()` in
`packages/runtime/src/durable/postgres-kernel.ts` and shifted every symbol below
it, so `admit` `:455` → `:357`, `inspect` `:687` → `:652`, `events` `:729` →
`:694`, and `FOR UPDATE SKIP LOCKED` `:504` → `:421`. One citation,
`inspection-contract.md:261`, had already run past the end of a 725-line file.

**Two things this second instance shows that the first could not.** The mode is
not a one-off of an unusually invasive slice — two consecutive merges produced
it, and the second was larger. And it is not confined to line numbers: BETA-10
also falsified a **behavioural** claim. `durable-evidence-gaps/FINDING.md` §4
argued that a horizon-exhausted run retries at the head of the queue because
`admit` orders by `available_at`; the ordering is now `tenant_turn,
available_at, run_id`, so the claim needed a correction about what it contains,
recorded there rather than a new line number.

**The name-anchored citations written after the previous entry did not decay.**
`design-context.md:62`'s `` `postgres-maintenance.ts` `staleVersion` `` survived
both merges, as did the `actorOf` sites converted last tick. The symbol-anchored
sites fixed in this pass are written the same way, which is the only part of this
that compounds in the right direction.

**Judgment call: stop treating each merge's sweep as incidental cleanup.** Two
merges, 37 citations, one behavioural claim, and no record edit in between; the
rate is a property of a docs-first record set that cites a moving tree, not of
any one slice. What would overturn it: a merge that touches `packages/runtime`
and moves nothing, which would show the decay tracks how invasive a slice is
rather than that merges cause it. BETA-10 changing
`postgres-maintenance.ts` by a single line without shifting anything is weak
evidence in that direction already.

## A citation sweep can make a false claim look better sourced

The BETA-10 sweep in the entry above re-pointed
`tenant-share-control/DECISION.md`'s "Nothing schedules on it" row from
`postgres-kernel.ts:123`, `:463` to `:357`, `:378`, because the old lines no
longer held the admission query. The new citation is accurate. The claim it
supports — "`tenant_id` is selected for projection only; admission is
`ORDER BY available_at, run_id` with no tenant term" — was false by then, and
`:378` **is the line that falsifies it**: `ORDER BY tenant_turn, available_at,
run_id`.

So the sweep left a false sentence pointing at correct, current evidence for its
own contradiction. Before the sweep the row was at least visibly stale, citing
lines that no longer resolved. After it, the row read as freshly verified. **A
line-number sweep can raise a claim's apparent credibility while leaving it
wrong**, and that is a worse end state than the decay it repaired.

**The cause is mechanical and worth naming.** Re-resolving a citation asks
"where did this symbol go?" It never asks "does the sentence still hold?" Those
are different questions, and only the first can be automated by matching an
anchor. The three name-anchored conversions in the same sweep have the same
exposure: `` `postgres-maintenance.ts` `actorOf` `` will keep resolving for as
long as `actorOf` exists, including long after any claim about what it does
stops being true.

**Judgment call: a citation sweep must end by reading the sentences it
touched, not only the lines.** This one did not, and the row survived a pass
that was looking directly at it. The cheap version is to re-read every claim
whose citation moved by more than a few lines, on the theory that a large shift
means the surrounding code was rewritten rather than nudged — `:463` → `:378`
here. What would overturn that heuristic: a falsified claim whose citation moved
by one or two lines, which would show shift distance is not a usable proxy and
the only safe rule is to re-read every touched claim.
