# Bounded inverse `toMany` authoring candidates

Status: executable design evidence, not product authority

## Decision pressure

An accepted inverse Relation stores only the literal identity of its owning
`toOne`. That keeps leaf Collection Definitions local and avoids circular
imports, but it also means the declaring Collection does not carry the source
Collection's Fields in its TypeScript type. A projected child list therefore
needs one honest owner for source-Collection inference.

## Candidate A — child-owned `list` overload (leading)

```ts
select: {
  id: true,
  comments: comments.list({
    first: 50,
    where: ({ row }) => row.visibility.equal("public"),
    orderBy: { createdAt: "desc", id: "desc" },
    select: { id: true, body: true, createdAt: true },
  }),
}
```

The source Collection owns child Field, Relation, optional filter, ordering,
and result inference. The parent inverse member accepts only a list branded
with the source Collection identity encoded by `inverseOf`; the compiler
resolves and verifies the complete Relation identity. This adds one deep
structural-query projection to a Collection and requires no ambient registry,
generated import, or second query kernel.

## Candidate B — inline child object

```ts
select: {
  comments: {
    first: 50,
    orderBy: { createdAt: "desc", id: "desc" },
    select: { id: true, body: true },
  },
}
```

This is visually smaller, but the accepted inverse declaration contains only
`collection:comments/relation:ticket`. TypeScript cannot derive the source
Collection's Field map from that string. Making this exact requires an ambient
application registry, a generated descriptor import, or changing the accepted
Relation declaration to carry the source Definition. Those costs violate
leaf-local authoring or reopen an already accepted decision. Reject unless an
executable prototype finds an ordinary-TypeScript inference path.

## Candidate C — generated descriptor builder

```ts
select: ({ relations }) => ({
	comments: relations.comments.list({
		first: 50,
		orderBy: { createdAt: "desc", id: "desc" },
		select: { id: true, body: true },
	}),
});
```

The generated App Contract can know the resolved target exactly, but using it
to author structural Queries restores the two-stage generated authoring loop
that Collection-owned `list` removed. It also splits otherwise identical
Query authoring between source and generated contracts. Retain only as a
negative control.

## Narrow conclusion

Candidate A is currently the only candidate that is exact, leaf-local, and
compatible with the accepted inverse Relation declaration. Runtime semantics
remain undecided by this type proof. In particular, the compiler must still
prove a positive literal `first` no greater than 50, a child-total
`orderBy` ending in a unique constraint, exact inverse target identity, and
the absence of nested cursors before emitting canonical bytes.
