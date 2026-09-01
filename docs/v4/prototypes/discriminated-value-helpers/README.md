# Discriminated value helper evidence

- Status: archived Product evidence for Accepted ADR-0037
- Authority: ADR-0037

This evidence established the exact three-helper boundary before Product
acceptance. Production parity now lives in the public `questpie` export and its
public-root tests; the duplicate executable prototype was deleted.

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

This remains a polymorphic reference **value**, not a polymorphic Relation. Each
variant is resolved by a named Query or Mutation and current Policy.
