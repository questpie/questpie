# Discriminated value helper prototype

- Status: reviewed Product evidence for Accepted ADR-0037; not production code
- Authority: ADR-0037

This prototype replaces the copy-pasted ADR-0035 recipe with three small
ordinary-TypeScript helpers. It proves type inference and hostile dispatch only;
it is not imported by production packages.

The intended use is:

```ts
type Subject = DiscriminatedReference<{
	appointment: AppointmentId;
	barber: BarberId;
}>;

const label = matchDiscriminated(subject, {
	appointment: ({ id }) => `appointment:${id}`,
	barber: ({ id }) => `barber:${id}`,
});
```

This is a polymorphic reference **value**, not a polymorphic Relation. Each
variant is resolved by a named Query or Mutation and current Policy.
