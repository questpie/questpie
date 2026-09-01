# Operation documentation seam candidates

- Status: focused design evidence; not Accepted authority
- Fixed requirement: names, methods, paths, schemas, outcomes, and handlers stay
  compiler-derived and are never re-authored as documentation metadata.

## A — one Operation `describe` envelope (recommended)

```ts
defineQuery({
	name: "tickets.detail",
	input,
	output,
	describe: {
		summary: "Fetch one visible ticket",
		description: "Returns null when no visible ticket matches.",
		examples: [{ input: { id: syntheticId } }],
	},
	handler,
});
```

One optional member keeps prose visibly separate from domain Fields and gives
all projections one record. Examples inherit the Operation's codec types.

## B — flat Operation siblings

`summary`, `description`, and `examples` beside `input` and `output` have the
same semantics but collide visually with common domain vocabulary. Three new
top-level keys are not deeper than one grouped record.

## C — codec decorators

`codec.describe(codec.text(), ...)` or fluent `.describe()` would attach prose
to reusable value grammar. It changes every codec kind and consumer, makes
propagation depend on reuse, and risks copying example literals into unrelated
Context, durable, or Operation artifacts. This candidate is rejected.

Field-level prose, error examples, custom groups, and application-specific
generated skills remain named follow-ups. They may reuse the documentation
artifact but cannot add a parallel schema or projection registry.
