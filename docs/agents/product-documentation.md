# Product documentation projection

Use this workflow when an accepted decision changes public QUESTPIE behavior.
The public root is `apps/docs/content/docs/v4/`. The internal workbench root is
`docs/v4/`.

## Steps

1. Read the projection handoff, its ADRs, and the named terms in `CONTEXT.md`.
2. Update every target page in the public root.
3. Run three independent read-only reviews: fact coverage, prose, and examples.
4. Apply verified findings and run the documentation checks.
5. Mark the internal handoff `verified` when every completion criterion passes.

## Public product voice

- Describe the product in the present tense.
- State behavior, guarantees, limits, errors, and complete usage.
- Use one canonical term for one concept.
- Use active voice and name the actor when it changes the result.
- Use `must` for required user action, `does` for behavior, and `cannot` for a
  hard limit.
- Keep one fact or instruction in one sentence.
- Prefer short words and remove words that add no meaning.
- Use canonical framework terms from `CONTEXT.md`. Use everyday English for all
  other text.
- Use a table for exact mappings. Use a sequence diagram only when order changes
  the result.

Public pages contain the accepted result. Internal workbench files contain
decision history, alternatives, open questions, implementation status, and
review process.

## Examples

- Use TanStack Barbershop as the canonical application.
- Show the file path, imports, complete declaration, call, and observable
  result.
- Use only public names fixed by accepted decisions.
- Show inferred types when type inference is part of the contract.
- Show the exact diagnostic when invalid input is part of the contract.
- Keep each later example focused on one additional option.

## Opus 5 fanout

Run three read-only Claude Opus 5 tasks against the handoff and target pages.

1. **Fact review** maps every handoff fact to a page section and finds
   contradictions with the ADRs and `CONTEXT.md`.
2. **Prose review** applies Orwell-style plain language and ASD-STE-inspired
   English. It finds future voice, passive voice, stale metaphors, filler,
   synonyms, and mixed concepts.
3. **Example review** checks complete imports, one connected Barbershop domain,
   TypeScript inference, security, lifecycle, errors, and navigation.

Review output is evidence, not authority. The projecting agent verifies every
finding against source files before it edits a page.

## Completion criteria

- Every handoff fact appears once in the correct public section.
- Public pages contain no decision status, open question, future promise, ADR
  number, internal path, or implementation instruction.
- Every example is complete and uses only accepted public names.
- Navigation and local links resolve.
- `git diff --check` passes.
- `bun run types:check` passes in `apps/docs`.
