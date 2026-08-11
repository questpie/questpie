# Domain docs

QUESTPIE uses a single framework context.

## Layout

- `CONTEXT.md` contains the canonical framework glossary.
- `docs/adr/` contains system-wide architectural decisions.
- API references and implementation specifications do not belong in
  `CONTEXT.md`.

`CONTEXT.md` and `docs/adr/` are created lazily when the grilling session
resolves the first term or architectural decision.

## Before design or implementation

1. Read `CONTEXT.md` if it exists.
2. Read ADRs relevant to the capability being changed.
3. Use canonical glossary terms.
4. Surface contradictions with accepted ADRs.
5. Do not silently introduce synonyms for established terms.

When an accepted decision changes public behavior, follow
`docs/agents/product-documentation.md`. It defines the asynchronous projection
from the internal workbench into finished public product documentation.

## Glossary rules

`CONTEXT.md` defines framework-specific language only.

Each term must:

- have one canonical name;
- have a short definition;
- list rejected synonyms where ambiguity is likely;
- contain no TypeScript signatures or implementation details.

## ADR rules

Create an ADR only when the decision is:

- expensive to reverse;
- surprising without context;
- selected from real alternatives.

API details belong in API specifications. ADRs record durable decisions and
their reasons.
