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
