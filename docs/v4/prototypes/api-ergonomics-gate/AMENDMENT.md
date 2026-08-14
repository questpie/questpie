# Required accepted-authority amendment after PASS

This gate intentionally contradicts part of the currently Accepted composition
projection. It cannot become authority by implication. After an explicit
acceptance PASS, the evidence commit must make every amendment below together;
before PASS, none of them is projected.

## `docs/v4/definition-composition.md`

Replace the final two paragraphs under **Identity invariants** with:

> A name can be a strict dotted prefix of another name, such as `booking` and
> `booking.availability`. The Compiled Manifest, App Contract identity index,
> receipts, references, CLI, Studio, and external projections preserve exact
> `<kind>:<qualified-name>` keys and can represent both.
>
> Generated server Operation capability maps are a separate, nested-only call
> projection. Within one Operation kind, a leaf cannot also be a namespace
> prefix: `action:booking` plus `action:booking.availability` fails with
> `QP-COMPOSE-023`. Equal names in different kinds remain valid. The nested
> call spelling never replaces or reinterprets canonical Resource Identity.

After the Qualified Resource Name ABNF, add this semantic restriction without
changing the general grammar:

> `then` remains a valid segment and a valid non-Operation Resource name. An
> Operation projected into a generated server capability map cannot use `then`
> as its final segment because the callable leaf would make that namespace
> Promise-like. Compilation reports `QP-COMPOSE-024`. A non-final `then`
> segment, such as `then.fire`, remains valid.

Extend the closed diagnostic table with:

| Code             | Class                           | Trigger                                                                                    | Exit |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------ | ---- |
| `QP-COMPOSE-023` | `operationProjectionCollision`  | One Operation name is both a leaf and namespace prefix within one generated kind map       | 2    |
| `QP-COMPOSE-024` | `operationProjectionUnsafeName` | An Operation's final name segment is `then` and would make a capability namespace thenable | 2    |

Append `"QP-COMPOSE-023"` and `"QP-COMPOSE-024"` to
`CompositionDiagnosticCodeV1`, and append `"operationProjectionCollision"` and
`"operationProjectionUnsafeName"` to `CompositionDiagnosticClassV1`. Both have
severity `error`, blocking effect `fatal`, and exit `2`. Recovery for 023 is
“rename either Operation so no same-kind leaf is also a namespace prefix”;
recovery for 024 is “rename the Operation's final `then` segment.” Both
diagnostics carry every conflicting or rejected Origin and no secret source.

Replace the hostile-collision row with:

| Case                                                                  | Result                                                 | Recovery                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| One dotted name is a prefix of another outside one Operation kind map | allowed; exact identity maps preserve both             | none                                                     |
| One same-kind Operation leaf is a prefix of another                   | `QP-COMPOSE-023`; no capability declaration is emitted | rename either leaf or namespace                          |
| An Operation's final segment is `then`                                | `QP-COMPOSE-024`; no capability declaration is emitted | rename the final segment; non-final `then` remains valid |

Replace the accepted-risk sentence “Exact full-name key maps are the
canonical, collision-free surface” with:

> Exact full-name identity maps remain canonical and collision-free. Generated
> server call maps are nested-only and compile only after 023/024 projection
> safety checks.

## Public definition-composition page

Apply the same identity/prefix and final-`then` restriction to
`apps/docs/content/docs/v4/definition-composition.mdx`. Replace its prefix
paragraph with:

> Two Resources of different kinds can use the same Qualified Resource Name.
> Exact-key identity maps also preserve strict dotted prefixes. Generated
> server Operation callers are different: they are nested-only, so one
> same-kind Operation cannot be both a callable leaf and a namespace prefix.
> QUESTPIE reports `QP-COMPOSE-023`. An Operation cannot use `then` as its final
> segment because a callable leaf would make that namespace Promise-like;
> QUESTPIE reports `QP-COMPOSE-024`. Non-final `then` remains valid.

Add these exact public diagnostic rows:

| Code             | Class                           | Meaning                                                           |
| ---------------- | ------------------------------- | ----------------------------------------------------------------- |
| `QP-COMPOSE-023` | `operationProjectionCollision`  | One same-kind Operation is both a call leaf and namespace prefix. |
| `QP-COMPOSE-024` | `operationProjectionUnsafeName` | A final `then` Operation segment would make a namespace thenable. |

## Server call examples

Replace only generated **server capability** bracket-key calls with nested
paths. At minimum this includes:

- `apps/docs/content/docs/v4/durable-reactions.mdx`:
  `ctx.actions.delivery.sendMessage` and
  `ctx.mutations.messages.recordDelivery`, plus prose saying the nested path is
  a capability projection while identity stays exact;
- `apps/docs/content/docs/v4/services-routes-and-auth.mdx` and
  `docs/v4/service-route-and-auth-composition.md`: `mutations.delivery.record`;
- `docs/v4/design-fiction/durable-work.md` and
  `docs/v4/design-fiction/routes-actions-and-integrations.md`: all `ctx.actions`
  and `ctx.mutations` server calls;
- `docs/v4/design-fiction/routes-actions-and-integrations.md` and
  `docs/v4/design-fiction/queries-and-mutations.md`: nested `mutations.*` inside
  generated server Execution callbacks.

Direct client/App maps such as `company.actions["delivery.send"]` and canonical
Manifest/receipt/reference keys remain exact-key surfaces and are not rewritten.

The durable Reaction snippet replacement is exactly:

```ts
const delivery = await ctx.actions.delivery.sendMessage(
	{ message },
	{ idempotencyKey: run.effect("deliver-message") },
);

await ctx.mutations.messages.recordDelivery({
	messageId: message.id,
	providerMessageId: delivery.providerMessageId,
});
```

Replace “The bracket-dot syntax is an exact generated Action lookup” with:

> The nested path is the generated server Action capability projection, not a
> string registry or a second Resource identity. Canonical identity remains
> `action:delivery.sendMessage`.

## Decision and ownership projection

Add an Accepted ADR recording this amendment and update `docs/adr/README.md`.
Project the permanent v4 capability map and nested server-call rule into
`docs/v4/semantic-kernels-and-public-surface.md` and its public MDX mirror.
Update `HANDOFF.md` with the reviewed proof head, acceptance evidence head,
measurements, changed authority, and restored BETA-02 frontier.
