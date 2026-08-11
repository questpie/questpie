# Documentation authoring

These rules apply to public documentation under `content/docs/`.

## Source contract

- Read the root `SPEC.md`, `CONTEXT.md`, and current ADRs before editing.
- Public docs project accepted behavior. They do not create architecture.
- Do not restore v3 modules, registries, adapters, Admin builders, or ORM types.
- Do not introduce syntax for a product area that has not completed grilling.

## Product voice

- Describe the product in the present tense.
- State one behavior or instruction in one sentence.
- Use one canonical name for one concept.
- Use active voice and name the actor that changes the result.
- State guarantees, limits, errors, and the supported recovery path.
- Keep decision history, work status, and rejected alternatives in internal docs.

## Examples

- Use the Barbershop domain.
- Show the path, imports, complete declaration, call, inferred type, and result.
- Show exact diagnostics for invalid composition or unsafe operations.
- Do not invent an unrelated framework feature inside an example.
