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
pushed D3 down; it has moved again since and is `:207` today. Three commits apart, two different files, and nobody
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
  `tests/integration/postgres/helpers/beta05-runtime.ts:31`, which on `feat/v4`
  has not held what that record meant for some time. At BETA-05's reviewed head
  `884b5d8a` it is `const beta05FixtureRoot = resolve(` — correct when written,
  and moved by later slices since. **An accepted review record is a snapshot against its own reviewed
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
  prefix, and two of the ten — one in `maintenance-decisions.md` and one in
  `durable-evidence-gaps/FINDING.md`, at the lines they occupied then — were
  bare `postgres-maintenance.ts:130`
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
  **Closed since: the gate now has its membership.** `owner-decisions.md`'s D3
  section states that "'Eight' previously named only a count. The gate now owns
  these eight accepted-backed mismatches, one membership item per contract edge
  rather than one per affected code or example," and follows it with a table of
  them. The complaint above was acted on, and its own line pins have gone stale
  in the process — the phrase "eight divergences" it quotes now appears nowhere
  but in this file. Kept as written, with this closure, because the paragraph is
  the evidence for the entry below it.
  So the gate had a count and no membership, and whoever built it could not know
  when it was done. It also makes the overlap with this section unresolvable: the
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
  at `CONTEXT.md:404`–`:405`. The four bare source pointers in
  `owner-decisions.md`'s operator-surface section resolve to unrelated
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
`beta09/design-context.md:62`'s `` `postgres-maintenance.ts` `staleVersion` `` survived
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

## A third merge, and this one moved nothing — the reason is position, not size

BETA-11 merged at `aa7d2a54`. It changed two production files,
`packages/compiler/src/mutation/postgres.ts` and
`packages/compiler/src/relational/discovery.ts`, for 12 insertions and 5
deletions, plus four test files. Twenty-two record citations point into those six
files. **None of them broke**, and the nine that live in the records this set
maintains were re-read as claims, not only re-resolved as lines: `:138` is still
`SELECT TRUE AS "qp_locked" … LIMIT 1 FOR UPDATE` with no `SKIP LOCKED`,
`:72`–`:75` still builds lock predicates from `operation.keyFields` alone, and
`lock:` at `:137` still precedes `read:` at `:142`, which is what the
statement-timeout gate's argument rests on.

**The tempting conclusion is that small diffs are safe, and it is wrong.** The
hunks are `@@ -306,0 +307,6 @@` and `@@ -319,4 +325 @@` in `mutation/postgres.ts`
and `@@ -187 +187,5 @@` in `discovery.ts`. Every cited anchor — `:54`, `:72`,
`:136`, `:138` — sits **above** the first edited line in its file. Nothing moved
because nothing was inserted before the citations, not because little was
inserted. The same 12 lines added near the top of either file would have shifted
all nine.

**So the gradient across three merges is about where a slice edits, not how
much.** BETA-09 changed 36 files and moved 10 citations; BETA-10 changed 19 and
moved 27, because it rewrote `admit()` near the middle of `postgres-kernel.ts`
and pushed every symbol below it down; BETA-11 changed 6 and moved none. That
refines the previous entry's guess, which read the difference as invasiveness.
Invasiveness correlates, but the mechanism is insertion position relative to
cited lines.

**What this does not change.** The previous entry's rule still holds and is the
one that matters: re-resolving a line never asks whether the sentence is still
true. This merge happens to have moved no lines _and_ falsified no claims, but
those are independent — BETA-10 falsified `tenant-share-control`'s scheduling row
by editing code far from any line that record cited.

## An unresolved "probably fine" in a sweep is a defect left in place

The BETA-10 sweep listed `durable-evidence-gaps/FINDING.md`'s claim that
`claimBatch` "defaults to 64 and is rejected outside 1–64", cited to
`postgres-kernel.ts:257`–`:263`. The line it landed on was the retry-scheduling
`UPDATE`, which is nothing to do with batch bounds. I judged it plausible, did
not resolve it, and moved on. It was stale: at the pre-merge tree `:257`–`:263`
was exactly `const maximumBatch = input.claimBatch ?? 64` and its 1–64 check, and
BETA-10 relocated that block to `:152`–`:158` byte-for-byte. Corrected now.

**The near-miss is the more useful half.** Chasing it, I formed the hypothesis
that BETA-10 had _removed_ the construction-time bound and left only the
per-call check in `admit()` at `:358`, which would have been a real regression —
a kernel built with `claimBatch: 10000` accepting 10,000-row batches. That was
wrong. The check is intact at `:152`–`:158` and the BETA-10 diff touches none of
those lines. Verifying before writing cost one command; writing it first would
have put a fabricated regression into a record whose subject is unasserted
properties.

**So a third way a sweep fails, after renumbering without re-reading and a
detector's blind spot: the reviewer's own hedge.** A sweep that outputs
"plausible" for an item has not checked it, and "plausible" is indistinguishable
from "checked" once the sweep is closed and its count reported. The fix is
mechanical — a sweep should have two outcomes per item, resolved or open, with
open items carried forward by name. This one was reported closed with an
unresolved item inside it.

## A detector for the class the eyeball sweeps kept missing

The previous entry admitted that a sweep item marked "plausible" is unchecked.
Rather than re-eyeball 238 citations, this pass built the check the earlier ones
lacked: for every citation, take the backticked identifiers named in the
surrounding sentence and require at least one to appear within a few lines of
the cited target. Zero overlap means the citation points somewhere that cannot
support the sentence, whatever the line number happens to be. It flagged 40 of
238, and every flag was resolved rather than triaged.

**Most were false positives, and the shape of them is worth knowing.** Range
citations put the anchor several lines past the start — `:107`–`:126` for
`DurableMaintenanceAuthority` lands on the doc comment's `/**` — and table rows
pull identifiers from adjacent cells. A detector tuned tighter would miss real
defects; this one is meant to over-flag and be resolved by hand.

**Eight were real, and none of them were findable by re-resolving a symbol,**
because the citation had drifted onto a line that still parses as plausible
code: `audit` cited to `:384`, which is a `crypto.randomUUID()` inside an
`INSERT` parameter list, when the audit read is `:537`–`:546`;
`durableKernelMarkerStatement` cited to `rows.ts:24`, a member of a state union,
when it is `:138`–`:139`; `acknowledgeAmbiguity`'s event append cited to `:371`,
which is `rejectionCode: "ALREADY_REQUESTED"` inside `cancelRun`, when it is
`:524`. A symbol-anchored sweep asks where `audit` went and finds it; it never
asks whether `:384` was ever `audit`.

**One flag was not a citation problem at all.** Three records asserted that
`DurableMaintenanceOutcome` carries no version. The slice shipped `version:
number` on the union's settled arm, and `hostile-cases.md` already recorded that
closure — while a later paragraph in the same file still said "re-verified the
falsification against the current tree" and listed the fields without it. The
closure and the contradiction were nine lines apart in one file, added by me,
and three sweeps of that file did not surface it because every line it cited
still resolved.

**What would overturn the detector's value:** a run where the real defects are
all caught by symbol re-resolution anyway, which would make this an expensive way
to find nothing. That is testable on the next merge — run both and compare.

## The authority layer had never been swept at all

Five sweeps had run over `packages/` and `tests/` citations. None had touched
the citations that point at ADRs and public projections — the documents that
define v4 behaviour, and therefore the ones a wrong pointer costs most. There
are 41 of them across 25 targets in this record set.

**Three named a path that does not exist**, which is a failure the code sweeps
could not have produced, because a bad code path shows up the moment anything
tries to read it and these had never been read by anything:
`docs/adr/0015-freeze-service-route-and-auth.md` is missing its `-composition`
suffix; `docs/adr/0013:32` carries a bare ADR number and no filename; and
`docs/adr/0014-...:32` contains a literal ellipsis where the filename belongs —
an author's placeholder that was never filled in and that no check ever looked
at. In all three the line number and the quoted text were exactly right, so
every one of them would have passed a content check and failed a reader.

**Of the 37 with a resolvable path, seven flagged and two were real.** Both are
in authority documents, and one is a kind not seen before.

`maintenance-decisions.md` argued that `drainRuntime` is a lifecycle fence
wrongly listed among fenced maintenance commands, citing the accepted projection
_and_ Gate 8, and concluded that "it makes the projection the natural thing to
correct." The projection half is still exactly right
(`docs/v4/runtime-client-envelope-and-studio.md:69`). The Gate 8 half was right
when written and is now false: BETA-10 amended `implementation-gates.md` in
`ebe1cfe8` to carve `drainRuntime` out explicitly, as "the idempotent local
`app.close()` lifecycle fence … not a remotely targeted durable-run maintenance
command" (`:281`–`:284`), leaving the fenced set at three commands
(`:277`–`:280`).

**So the record's recommendation was adopted, in the gate rather than the
projection, and the record did not know.** That is a decay mode with the
opposite sign to every other entry here: not a claim going stale because the
tree moved away from it, but a claim going stale because the tree moved _toward_
it. The conflict this record identified is now between two v4 authority
documents rather than between an ADR and a projection-plus-gate, and the
projection is its sole remaining source. Correcting the projection is out of
bounds from here, so it is recorded and left.

The second was ordinary: `owner-decisions.md` cited ADR-0021 `:32` for "remote
Studio" (it is `:34`) and `:23` for "keeping minimal Studio inside" beta.1 —
a line that is the release-slice list and never said it. ADR-0021 `:19`–`:21`
now says ADR-0024 removed the minimal Studio path, so both Studio forms are
outside beta.1 and only the reasons differ.

**Judgment call: doc-path existence belongs in every future sweep, ahead of the
content check.** It is one `os.path.exists` per citation and it caught three
unreadable pointers that six sweeps of content checking would never have looked
at. What would overturn it: finding that these three were authored in one sitting
by one hand, which would make it a local lapse rather than a gap in the checking.
All three sit in different files, so that is not the case here.

## The position prediction held, and I had pinned a moving line inside a lesson

Two entries ago this record claimed the decay mechanism is insertion position
relative to cited lines, not diff size, and offered BETA-11 as the case where a
12-line change moved nothing because every hunk began below the citations.
BETA-12 is the other half of that experiment and it went the predicted way.

`packages/compiler/src/artifacts.ts` took a one-line insertion at line 1
(`@@ -0,0 +1 @@`) and a ten-line insertion at `:46` (`@@ -46,0 +48,10 @@`). The
`relational-nondisclosure.json` emission moved from `:453` to `:464` — a shift
of exactly eleven, the sum of the two insertions above it. Two citations in
`beta09/inspection-contract.md` broke and are corrected. Nine files changed;
everything cited below an insertion moved, everything else did not. Size was not
the variable in either direction.

**And the sweep caught a claim of mine that had no business being time-bound.**
The methodological point above — that an accepted review record is a snapshot
against its own reviewed head — was illustrated by saying
`beta05-runtime.ts:31` "is a blank line on `feat/v4` today". BETA-12 touched
that helper and `:31` is now a fixture path. The lesson was never about what
that line currently holds; pinning the present state of a line inside a durable
point makes the point decay at that line's rate for no gain. Rewritten to say
the citation no longer holds what the record meant, which is the part that is
actually stable.

**One detector limitation, recorded because it passed these silently.** The
identifier-overlap check compares backticked names in the claim against the
cited window. Four of the seven citations examined here carry no backticked
identifier in their sentence at all, so there was nothing to compare and the
check reported them clean. It cannot distinguish "verified" from "nothing to
verify". Both real defects in this sweep were found by reading, not by the
detector; its value so far is narrowing where to read, not deciding.

## Two citation forms the sweeps could not see, and a live example of why it matters

A concurrent tick is landing ADR-0025, removing Channels from core. At the time
of this entry its work is committed locally and **not yet on `origin/feat/v4`**
— `39f06353`, fourteen commits ahead. It rewrites `docs/adr/0017`, `0019`,
`0021` and `implementation-gates.md`, which this record set cites.

**Three citations corrected two ticks ago were already broken again**, by work
that has not been published: ADR-0017's two named non-goals moved `:89`–`:90` →
`:93`–`:94`, ADR-0019's `questpie explain projection` line `:52` → `:57`, and
ADR-0021's "remote Studio" `:34` → `:38`. All three were correct at
`origin/feat/v4` and are correct again here against `39f06353`. **If that tick
amends or resets its unpushed commits, these three are what to recheck** —
they are pinned to commits no other machine has seen.

**The bare form was never swept.** The doc sweep matched only citations written
as a path, `` `docs/adr/0021-...md:34` ``. The record set also writes bare
`ADR-0019:52`, and there are 19 of those. Sweeping them found two defects that
predate the channel work and were wrong at `origin` too:
`hostile-cases.md:89` cited `implementation-gates.md:429` for `questpie explain`
when it was `:442` at origin and is `:437` now, and
`beta1-documentation-gap/FINDING.md:210` cited ADR-0021 `:37`–`:38` for the
connected-tracer designation when it was `:39` at origin and is `:43` now.
Neither had ever been looked at by anything.

**And the identifier detector missed the first of those for a knowable reason.**
Its token pattern is `[A-Za-z_][A-Za-z0-9_.()]{2,}`, which cannot match a
backticked identifier containing a space. The claim's anchor is
`` `questpie explain` ``, so the detector had no name to compare and passed the
line as clean. Two-word symbols, CLI subcommands and file-plus-flag spellings
are all invisible to it.

**Judgment call: a sweep must enumerate its own coverage before reporting a
count.** Every gap found so far has been a form the matcher did not accept —
short-form code paths, bare ADR numbers, multi-word identifiers — and each was
discovered by accident rather than by asking what the pattern excludes. The
cheap discipline is to print the set of citation spellings a sweep matched
alongside its result, so an absent form is visible as absent. What would
overturn this: a sweep that misses a defect in a form it _does_ match, which
would mean the matcher is not the binding constraint.

One correction here was a delayed hazard rather than a fresh error. The previous
entry rewrote `owner-decisions.md` to note that a stale citation had pointed at
`:23`, "the release-slice list". ADR-0021's rewrite moved the minimal-Studio
sentence _onto_ `:23`, so that archaeology now reads as though the original
citation had been right. It is removed rather than renumbered: a record that
narrates which line a claim used to cite acquires a second thing that can decay,
for no benefit the current citation does not already give.

## Enumerating the spellings, as promised — and the one this file is worst at

The previous entry committed to printing which citation spellings a sweep
matches, so an absent form is visible as absent rather than found by accident.
Doing that produced the census below, over every `:NN` in the set.

| spelling                                     | count | swept |
| -------------------------------------------- | ----- | ----- |
| range continuation `` `:NN` `` after a start | 593   | yes   |
| code path, rooted                            | 270   | yes   |
| bare basename                                | 143   | yes   |
| doc path                                     | 42    | yes   |
| suffix path, no root                         | 37    | yes   |
| bare `ADR-NNNN:LL`                           | 20    | yes   |
| root-file path (`CONTEXT.md:NN`)             | 15    | yes   |
| git-ref-qualified `feat/v4-beta-09:path:NN`  | 12    | yes   |
| record-to-record short form                  | 6     | yes   |
| `docs/adr/NNNN:LL`, no filename              | 1     | yes   |

**This table replaces a wrong one, and how it was wrong is the point.** The
first version reported six rows as one census. Only four came from the
classifier that produced the counts; the git-ref and record-to-record rows were
transcribed by hand from two earlier sweeps, and one transcription was off by
one — 11 against 12. The classifier bucketed by the text before `:NN`, so a
git-ref-qualified citation ending `.tsx` landed in the code-path row, and its
`OTHER` bucket of 332 absorbed the difference without anyone noticing. Rebuilt
here with mutually exclusive patterns applied in order, each match consumed, and
an explicit unclassified remainder.

**Range ends were clean.** 212 resolvable range ends checked; the four flags are
whole-file or whole-test spans, not errors. That is a real negative result over
two hundred line numbers no sweep had looked at, and it says the ends drift with
the starts rather than independently — which follows, since a range's ends move
together when a block above them shifts.

**Record-to-record citations were not clean, and this file is the offender.**
Fifteen exist and fourteen are in this record. That is the predictable
consequence of a record whose subject is other records: it pins their line
numbers, and this file has been appended to every tick while the files it cites
were edited in the same ticks. Five were wrong. One of them —
`design-context.md:62` — was **ambiguous rather than stale**: six files in
`docs/v4/implementation/*/` are named `design-context.md`, and the bare form
resolves to `beta04`'s by directory order. It is qualified now.

**The largest was not a citation problem at all.** The D3 entry above complained
that the gate names eight divergences and never lists them. `owner-decisions.md`
now has a D3 section that lists them in a table and says so explicitly. The
complaint was acted on. Its own quotation, "eight divergences", now appears
nowhere in the set except this file — the record was quoting a sentence that has
since been rewritten. Closed in place above rather than deleted, because that
paragraph is the evidence for the entry that follows it.

**So the second instance of a claim going stale because the tree moved toward
it.** The first was `implementation-gates.md` adopting this set's `drainRuntime`
recommendation. Both were found by sweeping for staleness, and in both cases the
"defect" is a record failing to notice it had won. A sweep that only asks
whether a claim still holds will classify these identically to ordinary rot; the
difference is only visible on reading what replaced it.

**Applied the de-pinning lesson to this file rather than restating it.** Four
passages here narrated other records' line numbers inside historical accounts —
which line a stale citation used to occupy, where D3 sat three commits ago. Each
was a second thing that decays for no benefit. They now name the section or the
record instead. What would overturn this: a reader needing to reconstruct a past
tree state exactly, for whom the pin is the point — in which case the commit sha
already recorded beside it is the better anchor.

## Closing the census: the last two forms, and the one that cannot be resolved by reading

**Git-ref-qualified citations are clean.** All twelve `feat/v4-beta-09:path:NN`
references resolve against that branch at `d9c4743c`, ends of ranges included,
and the two path-only references to `quality/baselines/beta09-studio-projection.json`
and `beta09/studio-interface.md` exist there too. They must be checked with
`git show feat/v4-beta-09:<path>`, never against the working tree — checking
them against `HEAD` is the same category error as checking an accepted review
record against `HEAD`.

**The rebuild exposed a form neither census had: a path with its root cut off.**
Thirty-seven citations are written like `mutation/postgres.ts:173` or
`relational/query.ts:132` — more than a basename, less than a path. Thirty-two
resolve to exactly one file. **Five do not, and they are the dangerous ones.**
`mutation/postgres.ts` exists under both `packages/compiler/src/` and
`packages/runtime/src/`, as does `relational/query.ts` under `packages/questpie/`
and `packages/runtime/`. A reader who expands the wrong root lands on real code
at that exact line: compiler `mutation/postgres.ts:173` is
`postgresType: postgresType(field.codec)`, runtime's is
`const session = await pool.reserve()`.

All five mean the runtime file — verified by matching each claim against both
candidates — and all five are now written with their full path. **This is the
same confusion the statement-timeout gate already records having made once**,
when an earlier revision attributed the runtime's cancel to the compiler's
`executeAbortable`. That entry treated it as one author's slip. It is better
read as the predictable consequence of a citation form that cannot distinguish
two files, still in use in five places at the time it was written.

**So the census is closed: every spelling enumerated, every form swept.** The
useful residue is not the clean result but the ordering — three of the four
defect classes found across these sweeps were invisible to the matcher rather
than hidden in the data, and the fourth was a hand-count inside a machine table.
A sweep's blind spots have been more productive than its findings, which argues
for spending the first effort on enumerating what a check cannot see.

## Quoted text: one fabricated attribution, and why the check barely works

With the citation census closed, the next class is quoted text — a misquote is
worse than a wrong line number, because a wrong line points at nothing while a
misquote manufactures evidence. Two passes: every quotation near a citation (36
checked), then only quotations introduced by an attribution verb — says, states,
reads, calls it — which is where a claim of verbatim source is actually being
made (229 checked).

**One real defect, and it is the shape the class exists to catch.**
`durable-evidence-gaps/ROUTE-SHAPE.md` argued that ADR-0014 points away from a
route, quoting "use the same Context, Policy, Operation, transaction, error,
result, and observation engine" — verbatim across
`docs/adr/0014-freeze-runtime-client-envelope-and-minimal-studio.md:38`–`:39` — and
then, joined by "and" and still inside quotation marks, "a second route with its
own auth handling is a second engine by another name". That phrase occurs twice
in the repository: at `ROUTE-SHAPE.md:52`, as this record's own unquoted
sentence, and at `:275` inside the quotation marks. **The record quoted itself
in the position where the ADR's second sentence would go.** Nothing in
`docs/adr/` contains it. Corrected to name it as this record's inference.

**Every other flag was mechanical, and the failure modes are worth naming
because two of them are mine.** The 42 attributed-quote flags were dominated by
three classes: the checker pairing a quote with the nearest citation rather than
its actual source; punctuation at quote boundaries, where a record ends a
sentence with a period the source continues with an em dash; and **case**. A
quote lowercased to sit mid-sentence — "six members becomes eight" against
`internal-protocol-v5.md:81`'s "Six members becomes eight." — fails a
case-sensitive match while being a correct quotation. That is the third time in
these sweeps a case-sensitive matcher produced a false alarm on my own reading,
and the second time I nearly recorded a correct quote as a defect.

**Judgment call: this class does not support a mechanical gate, only a
narrowing.** Legitimate quotation routinely changes case, trims punctuation,
elides with `…`, and re-marks nested quotes — `owner-decisions.md` writes
`“Eight”` and a record quoting it must write `'Eight'`. A checker strict enough
to catch the fabricated attribution would reject dozens of correct quotes, and
one loose enough to accept them all accepted this one. What would overturn that:
a normalization that folds case, punctuation and quote glyphs and still leaves
the fabrication visible — plausible, and worth trying before this class is
called closed rather than swept.
