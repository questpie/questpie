# ADR-0037: Freeze discriminated value TypeScript helpers

- Status: Accepted
- Date: 2026-09-01
- Owners: Product architecture, public TypeScript surface

## Context

Accepted ADR-0035 publishes an ordinary TypeScript recipe for values such as
`{ kind: "appointment", id } | { kind: "barber", id }`. The recipe deliberately
has no Relation, codec, Field, Policy, dependency, or Runtime meaning. Copying
its mapped types and matcher into every application is unnecessary DX friction,
but turning the recipe into a polymorphic data kernel would invent semantics the
framework cannot enforce.

## Proposed decision

`questpie` exports exactly three framework-neutral TypeScript helpers:

```ts
type DiscriminatedValue<Variants extends Record<string, object>> = // union
type DiscriminatedReference<Targets extends Record<string, unknown>> = // {kind,id}
function matchDiscriminated(value, cases) // exhaustive result union
```

`DiscriminatedValue` maps each string key to a readonly value carrying that
literal `kind`. `DiscriminatedReference` is the common `{ kind, id }`
specialization and preserves each target's branded ID type. `matchDiscriminated`
requires exactly one branch for every member, rejects extra branches in object
literals, narrows each branch parameter, and returns the union of branch return
types. Its runtime checks an own callable branch before invocation and throws a
value-free `TypeError` for an invalid value.

The helpers create no `codec.variant`, codec metadata, generated descriptor,
Relation, foreign key, inverse, join, cascade, Policy traversal, nondisclosure,
Live Query dependency, handler, registry, or Runtime capability. Values cross a
QUESTPIE boundary only through an independently valid codec/Field contract.
Applications resolve a reference through explicit named Operations whose
current Policy remains authoritative.

## Supersession and deletion

This is additive Product DX under ADR-0027. It supersedes only ADR-0035's need
to copy the three local recipe declarations; every semantic disclaimer in that
ADR remains. Once the public helper ships, the public guide imports it and
deletes the inline duplicate. No compatibility alias or second matcher remains.

## Acceptance

Before projection, executable type tests must prove branded-ID preservation,
branch narrowing, exhaustive missing-case rejection, extra-case rejection,
heterogeneous return unions, readonly values, hostile prototype-like kinds, and
absence of codec/Relation/Runtime exports. Independent Product review and
repository gates are required; formal Kernel acceptance is not.

The focused runtime and strict TypeScript evidence passed at the clean Product
candidate. A fresh independent Standards and Spec review returned PASS on both
axes. ADR-0027 therefore accepts this Product projection without a formal
Kernel acceptance manifest.
